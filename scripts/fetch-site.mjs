// HYDRA data pipeline: OpenStreetMap (Overpass) + Terrain Tiles on the AWS Registry of Open Data
// -> public/data/<site>.json, a 5 m simulation grid with buildings, roads, drains and terrain.
// Usage: node scripts/fetch-site.mjs [siteId ...]      (default: all sites)
// Raw downloads are cached in data/raw so re-runs are offline and reproducible.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const CELL = 5;          // m
const DEPRESSION_CAP = 0.45;   // m, deepest closed depression kept after conditioning
const HALF = 300;        // m, half-width of the neighbourhood box (600 m x 600 m)
const N = (2 * HALF) / CELL;
const UA = 'HYDRA-hackathon/1.0 (educational flood simulator)';

// Site settings. Everything marked synthetic here is surfaced in the app's provenance panel.
export const SITES = {
  gurugram: {
    name: 'Jacobpura, Old Gurugram', city: 'Gurugram', state: 'Haryana', lat: 28.4624763, lon: 77.0276631,
    soil: { name: 'Sandy loam (Aravalli foothill alluvium)', factor: 1.25 },
    smoothSigma: 5, levels: [1, 2, 2, 3, 3, 4], infill: 0.45, ground: '#d9c7a3',
    blurb: 'Dense old-city core on the Aravalli foothill slope; heavy paving sends runoff downhill to low chowks.',
  },
  chennai: {
    name: 'Velachery', city: 'Chennai', state: 'Tamil Nadu', lat: 12.9801655, lon: 80.2228506,
    soil: { name: 'Clayey marsh soil (Pallikaranai basin), high water table', factor: 0.45 },
    smoothSigma: 7, levels: [1, 2, 2, 3, 4, 5], infill: 0.5, ground: '#cfc6b4',
    blurb: 'Very flat, low-lying former wetland that flooded in 2015 and 2023; water has few places to go.',
  },
  ranchi: {
    name: 'Lalpur', city: 'Ranchi', state: 'Jharkhand', lat: 23.375328, lon: 85.3384361,
    soil: { name: 'Lateritic red soil (Chota Nagpur plateau)', factor: 0.85 },
    smoothSigma: 4, levels: [1, 1, 2, 2, 3], infill: 0.85, ground: '#c99a7a',
    blurb: 'Undulating plateau town; OSM has few buildings here, so most footprints are synthetic infill.',
  },
};

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mPerDegLat = phi => 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const mPerDegLon = phi => 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

async function fetchRetry(url, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
      if (r.ok) return r;
      console.warn(`  ${r.status} from ${url.slice(0, 60)}… retrying`);
    } catch (e) { console.warn(`  ${e.message} … retrying`); }
    await sleep(3000 * (i + 1));
  }
  throw new Error('fetch failed: ' + url);
}

async function overpass(site, bb) {
  const file = path.join(RAW, `${site}.osm.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const b = `${bb.s},${bb.w},${bb.n},${bb.e}`;
  const q = `[out:json][timeout:120];(
    way["building"](${b}); way["highway"](${b}); way["waterway"](${b});
    way["natural"~"water|wood|scrub|grassland|wetland"](${b}); relation["natural"="water"](${b});
    way["landuse"](${b}); way["leisure"](${b}); way["amenity"](${b});
    node["amenity"~"school|hospital|clinic|college|kindergarten|place_of_worship|police|fire_station"](${b});
    node["place"](${b});
  ); out tags geom;`;
  for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const r = await fetchRetry(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 3);
      const j = await r.json();
      fs.writeFileSync(file, JSON.stringify(j));
      return j;
    } catch (e) { console.warn('  overpass endpoint failed:', ep, e.message); }
  }
  throw new Error('All Overpass endpoints failed');
}

// AWS Terrain Tiles (terrarium PNG): elevation = R*256 + G + B/256 - 32768
const Z = 15;
const lon2tx = lon => (lon + 180) / 360 * 2 ** Z;
const lat2ty = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** Z; };
const tiles = new Map();
function tile(tx, ty) {   // promise cached so concurrent samples share one download
  const key = `${tx}_${ty}`;
  if (!tiles.has(key)) tiles.set(key, (async () => {
    const file = path.join(RAW, `terrarium_${Z}_${key}.png`);
    if (!fs.existsSync(file)) {
      const r = await fetchRetry(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
    return PNG.sync.read(fs.readFileSync(file));
  })());
  return tiles.get(key);
}
async function elevation(lat, lon) {   // bilinear sample in tile pixel space
  const fx = lon2tx(lon) * 256 - 0.5, fy = lat2ty(lat) * 256 - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const px = async (X, Y) => {
    const t = await tile(Math.floor(X / 256), Math.floor(Y / 256)), i = ((Y & 255) * 256 + (X & 255)) * 4;
    return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
  };
  const [a, b, c, d] = await Promise.all([px(x0, y0), px(x0 + 1, y0), px(x0, y0 + 1), px(x0 + 1, y0 + 1)]);
  return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
}

function gaussianSmooth(src, w, h, sigma) {
  const r = Math.ceil(sigma * 3), k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const ks = k.reduce((a, b) => a + b, 0);
  const tmp = new Float64Array(w * h), out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let i = -r; i <= r; i++) s += k[i + r] * src[y * w + Math.min(w - 1, Math.max(0, x + i))];
    tmp[y * w + x] = s / ks;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let i = -r; i <= r; i++) s += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
    out[y * w + x] = s / ks;
  }
  return out;
}

// Priority-flood (Barnes et al. 2014) from the box edge, then cap every closed depression at `cap` metres.
// SRTM over cities leaves 1–2 m deep artificial bowls; real low spots survive as shallow (<= cap) waterlogging points.
function conditionDepressions(z, N, cap) {
  const n = N * N, filled = new Float64Array(n), seen = new Uint8Array(n);
  const heap = [], push = (h, i) => { heap.push([h, i]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!r || !c || r === N - 1 || c === N - 1) { const i = r * N + c; filled[i] = z[i]; seen[i] = 1; push(z[i], i); }
  while (heap.length) {
    const [h, i] = pop(), c = i % N, r = (i / N) | 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= N || rr >= N) continue;
      const j = rr * N + cc;
      if (seen[j]) continue;
      seen[j] = 1; filled[j] = Math.max(h, z[j]); push(filled[j], j);
    }
  }
  let raised = 0;
  for (let i = 0; i < n; i++) if (filled[i] - z[i] > cap) { z[i] = filled[i] - cap; raised++; }
  return raised;
}

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

// cover codes shared with src/sim/model.ts
const C = { OPEN: 0, ROAD: 1, BUILDING: 2, GREEN: 3, WATER: 4, PAVED: 5, CHANNEL: 6 };
const ROAD_W = { motorway: 20, trunk: 18, primary: 14, secondary: 11, tertiary: 9, residential: 6, unclassified: 6, living_street: 5, service: 4, pedestrian: 4, track: 4 };
const ROAD_RANK = { motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5, residential: 4, unclassified: 4, living_street: 3, service: 2, pedestrian: 1, track: 1 };
const DRAIN_CAP = { motorway: 1.0, trunk: 0.9, primary: 0.8, secondary: 0.6, tertiary: 0.4, residential: 0.18, unclassified: 0.18, living_street: 0.12, service: 0.12 };
const WATERWAY_W = { river: 16, canal: 8, stream: 4, drain: 3, ditch: 2 };
const RESIDENTIAL = new Set(['yes', 'house', 'residential', 'apartments', 'detached', 'terrace', 'semidetached_house', 'dormitory', 'hut']);
const CRITICAL = { school: 'School', college: 'College', kindergarten: 'School', hospital: 'Hospital', clinic: 'Clinic', police: 'Police station', fire_station: 'Fire station' };

async function buildSite(id) {
  const S = SITES[id];
  const phi = S.lat * Math.PI / 180, mLat = mPerDegLat(phi), mLon = mPerDegLon(phi);
  const pad = 40;
  const bb = { s: S.lat - (HALF + pad) / mLat, n: S.lat + (HALF + pad) / mLat, w: S.lon - (HALF + pad) / mLon, e: S.lon + (HALF + pad) / mLon };
  const toXZ = (lat, lon) => [(lon - S.lon) * mLon + HALF, (S.lat - lat) * mLat + HALF];   // x east, z south, metres from the NW corner
  const toLatLon = (x, z) => [S.lat - (z - HALF) / mLat, S.lon + (x - HALF) / mLon];
  const rnd = mulberry32([...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const n = N * N, idx = (c, r) => r * N + c;
  const inGrid = (c, r) => c >= 0 && r >= 0 && c < N && r < N;

  console.log(`\n[${id}] ${S.name}, ${S.city}`);
  // ---- terrain: sample on a padded grid, smooth away SRTM 1 m steps, crop ----
  const M = 30, W2 = N + 2 * M;
  const raw = new Float64Array(W2 * W2);
  for (let r = 0; r < W2; r++) {
    const row = await Promise.all(Array.from({ length: W2 }, (_, c) => elevation(...toLatLon((c - M + 0.5) * CELL, (r - M + 0.5) * CELL))));
    raw.set(row, r * W2);
  }
  const sm = gaussianSmooth(raw, W2, W2, S.smoothSigma);
  const z = new Float64Array(n);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) z[idx(c, r)] = sm[(r + M) * W2 + c + M];
  let zr = [Infinity, -Infinity]; for (const v of z) { zr[0] = Math.min(zr[0], v); zr[1] = Math.max(zr[1], v); }
  const raised = conditionDepressions(z, N, DEPRESSION_CAP);
  console.log(`  terrain ${zr[0].toFixed(1)}–${zr[1].toFixed(1)} m (relief ${(zr[1] - zr[0]).toFixed(1)} m), ${tiles.size} AWS tiles, ${raised} cells conditioned`);

  // ---- OSM ----
  const osm = await overpass(id, bb);
  const ways = osm.elements.filter(e => e.type === 'way' && e.geometry);
  const polysOf = e => e.type === 'way' ? [e.geometry.map(g => toXZ(g.lat, g.lon))]
    : (e.members || []).filter(m => m.role === 'outer' && m.geometry).map(m => m.geometry.map(g => toXZ(g.lat, g.lon)));
  const cover = new Uint8Array(n).fill(C.OPEN);
  const fillPoly = (poly, fn) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, zz] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, zz); z1 = Math.max(z1, zz); }
    let hit = 0;
    for (let r = Math.max(0, Math.floor(z0 / CELL)); r <= Math.min(N - 1, Math.floor(z1 / CELL)); r++)
      for (let c = Math.max(0, Math.floor(x0 / CELL)); c <= Math.min(N - 1, Math.floor(x1 / CELL)); c++)
        if (pointInPoly((c + 0.5) * CELL, (r + 0.5) * CELL, poly)) { fn(idx(c, r)); hit++; }
    return hit;
  };
  const strokeLine = (pts, radius, fn) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      for (let r = Math.max(0, Math.floor((Math.min(az, bz) - radius) / CELL)); r <= Math.min(N - 1, Math.floor((Math.max(az, bz) + radius) / CELL)); r++)
        for (let c = Math.max(0, Math.floor((Math.min(ax, bx) - radius) / CELL)); c <= Math.min(N - 1, Math.floor((Math.max(ax, bx) + radius) / CELL)); c++)
          if (distSeg((c + 0.5) * CELL, (r + 0.5) * CELL, ax, az, bx, bz) <= radius) fn(idx(c, r));
    }
  };

  // land use / green / paved
  const greenTags = e => /^(park|garden|playground|pitch|recreation_ground|golf_course|nature_reserve)$/.test(e.tags.leisure || '') ||
    /^(grass|forest|meadow|village_green|orchard|farmland|recreation_ground|cemetery|plant_nursery|greenfield)$/.test(e.tags.landuse || '') ||
    /^(wood|scrub|grassland|wetland)$/.test(e.tags.natural || '');
  for (const e of osm.elements) if (e.tags && (e.type === 'way' || e.type === 'relation')) {
    if (greenTags(e)) polysOf(e).forEach(p => fillPoly(p, i => { cover[i] = C.GREEN; }));
    else if (e.tags.amenity === 'parking' || /^(railway|construction|garages)$/.test(e.tags.landuse || '')) polysOf(e).forEach(p => fillPoly(p, i => { cover[i] = C.PAVED; }));
  }
  const waterBodies = [];
  for (const e of osm.elements) if (e.tags && (e.tags.natural === 'water' || e.tags.landuse === 'reservoir' || e.tags.landuse === 'basin')) {
    const kind = /river|canal|stream/.test(e.tags.water || '') ? 'channel' : 'pond';
    for (const p of polysOf(e)) if (fillPoly(p, i => { cover[i] = kind === 'channel' ? C.CHANNEL : C.WATER; }))
      waterBodies.push({ name: e.tags.name || (kind === 'pond' ? 'Pond' : 'Channel'), kind, poly: p.map(q => q.map(v => +v.toFixed(1))) });
  }
  const waterways = [];
  for (const e of ways) if (e.tags.waterway && WATERWAY_W[e.tags.waterway]) {
    const pts = e.geometry.map(g => toXZ(g.lat, g.lon));
    strokeLine(pts, Math.max(WATERWAY_W[e.tags.waterway] / 2, 2.6), i => { if (cover[i] !== C.WATER) cover[i] = C.CHANNEL; });
    waterways.push({ name: e.tags.name || e.tags.waterway, kind: e.tags.waterway, pts: pts.map(q => q.map(v => +v.toFixed(1))) });
  }

  // roads
  const roadOf = new Int32Array(n).fill(-1), roads = [], roadCore = new Uint8Array(n);   // core = on the centreline, keeps lanes connected
  for (const e of ways) {
    const cls = e.tags.highway;
    if (!ROAD_W[cls]) continue;
    const pts = e.geometry.map(g => toXZ(g.lat, g.lon));
    const width = e.tags.width ? Math.max(3, parseFloat(e.tags.width) || ROAD_W[cls]) : ROAD_W[cls];
    const rid = roads.length;
    let cells = 0;
    const mark = (i, core) => {
      if (cover[i] === C.WATER || cover[i] === C.CHANNEL) return;     // bridges keep the water below
      const prev = roadOf[i];
      if (prev < 0 || (prev !== rid && ROAD_RANK[cls] > ROAD_RANK[roads[prev].cls])) roadOf[i] = rid;
      cover[i] = C.ROAD; cells++;
      if (core) roadCore[i] = 1;
    };
    strokeLine(pts, Math.max(width / 2, 2.0), i => mark(i, false));   // true carriageway width (a lane narrower than a cell keeps its centre cells)
    // walk the centreline so every lane stays 4-connected: on a diagonal step, add the orthogonal cell nearer the line
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(L / 0.5));
      let pc = -1, pr = -1;
      for (let s = 0; s <= steps; s++) {
        const x = ax + (bx - ax) * s / steps, z = az + (bz - az) * s / steps, c = Math.floor(x / CELL), r = Math.floor(z / CELL);
        if (inGrid(c, r)) {
          mark(idx(c, r), true);
          if (pc >= 0 && c !== pc && r !== pr) {
            const d1 = distSeg((c + 0.5) * CELL, (pr + 0.5) * CELL, ax, az, bx, bz), d2 = distSeg((pc + 0.5) * CELL, (r + 0.5) * CELL, ax, az, bx, bz);
            if (d1 <= d2 ? inGrid(c, pr) : !inGrid(pc, r)) mark(idx(c, pr), true); else if (inGrid(pc, r)) mark(idx(pc, r), true);
          }
        }
        pc = c; pr = r;
      }
    }
    let length = 0;
    for (let k = 0; k < pts.length - 1; k++) {   // length inside the box only
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], steps = 8;
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps, mx = ax + (bx - ax) * (t0 + t1) / 2, mz = az + (bz - az) * (t0 + t1) / 2;
        if (mx >= 0 && mz >= 0 && mx < 2 * HALF && mz < 2 * HALF) length += Math.hypot(bx - ax, bz - az) / steps;
      }
    }
    roads.push({ id: rid, name: e.tags.name || e.tags['name:en'] || '', cls, width, length: +length.toFixed(1), pts: pts.map(q => q.map(v => +v.toFixed(1))) });
  }

  // buildings (OSM)
  const bldOf = new Int32Array(n).fill(-1), buildings = [];
  const amenityNodes = osm.elements.filter(e => e.type === 'node' && e.tags && CRITICAL[e.tags.amenity]).map(e => ({ xz: toXZ(e.lat, e.lon), kind: CRITICAL[e.tags.amenity], name: e.tags.name || '' }));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const plinth = () => { const u = rnd(); return u < 0.2 ? 0.15 : u < 0.65 ? 0.3 : u < 0.9 ? 0.45 : 0.6; };
  function addBuilding(poly, tags, synthetic) {
    const bid = buildings.length;
    // a real house wins over a road's shoulder; only the lane's centreline cells (which keep it connected) stay road
    let cells = fillPoly(poly, i => { if (bldOf[i] < 0 && cover[i] !== C.WATER && cover[i] !== C.CHANNEL && !(cover[i] === C.ROAD && (roadCore[i] || synthetic))) { bldOf[i] = bid; cover[i] = C.BUILDING; roadOf[i] = -1; } });
    if (!cells) {   // smaller than a cell: claim the centroid cell if free
      const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
      const c = Math.floor(cx / CELL), r = Math.floor(cz / CELL);
      if (!inGrid(c, r) || bldOf[idx(c, r)] >= 0 || cover[idx(c, r)] === C.ROAD || cover[idx(c, r)] >= C.WATER && cover[idx(c, r)] !== C.PAVED) return;
      bldOf[idx(c, r)] = bid; cover[idx(c, r)] = C.BUILDING;
    }
    let area = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
    area = Math.abs(area / 2);
    const lv = parseInt(tags['building:levels']) || (tags.height ? Math.round(parseFloat(tags.height) / 3.2) : 0);
    const levels = lv > 0 ? Math.min(lv, 20) : pick(S.levels);
    let kind = tags.amenity && CRITICAL[tags.amenity] ? CRITICAL[tags.amenity] : tags.building === 'school' ? 'School' : tags.building === 'hospital' ? 'Hospital' : null;
    let name = tags.name || '';
    if (!kind) for (const a of amenityNodes) if (pointInPoly(a.xz[0], a.xz[1], poly)) { kind = a.kind; name = name || a.name; }
    const use = kind ? kind : RESIDENTIAL.has(tags.building || 'yes') ? 'Residential' : /commercial|retail|office|shop/.test(tags.building) ? 'Commercial' : /temple|mosque|church|religious/.test(tags.building) ? 'Religious' : /industrial|warehouse/.test(tags.building) ? 'Industrial' : 'Residential';
    const households = use === 'Residential' ? Math.max(1, Math.round(levels * area * 0.7 / 75)) : 0;
    buildings.push({
      id: bid, name, use, critical: !!kind, levels, levelsSynthetic: !(lv > 0), plinth: plinth(), area: +area.toFixed(1),
      residents: Math.round(households * 4.4), synthetic: !!synthetic, poly: poly.map(q => q.map(v => +v.toFixed(1))),
    });
  }
  for (const e of ways) if (e.tags.building && e.tags.building !== 'no' && e.tags.building !== 'roof') addBuilding(e.geometry.map(g => toXZ(g.lat, g.lon)), e.tags, false);
  const osmBuildings = buildings.length;

  // distance to road (cells) for infill and drains
  const dRoad = new Int32Array(n).fill(1e9), q = [];
  for (let i = 0; i < n; i++) if (cover[i] === C.ROAD) { dRoad[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], c = i % N, r = (i / N) | 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr;
      if (inGrid(cc, rr) && dRoad[idx(cc, rr)] > dRoad[i] + 1) { dRoad[idx(cc, rr)] = dRoad[i] + 1; q.push(idx(cc, rr)); }
    }
  }
  // synthetic infill: 3x3-cell plots near roads with no OSM building nearby (OSM coverage gaps)
  const nearBuilding = i => { const c = i % N, r = (i / N) | 0; for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { const cc = c + dc, rr = r + dr; if (inGrid(cc, rr) && bldOf[idx(cc, rr)] >= 0 && bldOf[idx(cc, rr)] < osmBuildings) return true; } return false; };
  for (let br = 0; br < N; br += 3) for (let bc = 0; bc < N; bc += 3) {
    const cand = [];
    for (let r = br; r < Math.min(N, br + 3); r++) for (let c = bc; c < Math.min(N, bc + 3); c++) {
      const i = idx(c, r);
      if (cover[i] === C.OPEN && dRoad[i] >= 1 && dRoad[i] <= 8 && !nearBuilding(i)) cand.push([c, r]);
    }
    if (cand.length < 5 || rnd() > S.infill) continue;
    const drop = Math.floor(rnd() * 4);   // leave one edge open as a lane / setback
    const keep = cand.filter(([c, r]) => !((drop === 0 && r === br) || (drop === 1 && r === br + 2) || (drop === 2 && c === bc) || (drop === 3 && c === bc + 2)));
    if (keep.length < 3) continue;
    const xs = keep.map(k => k[0]), rs = keep.map(k => k[1]);
    const c0 = Math.min(...xs), c1 = Math.max(...xs) + 1, r0 = Math.min(...rs), r1 = Math.max(...rs) + 1;
    const inset = 0.6;
    addBuilding([[c0 * CELL + inset, r0 * CELL + inset], [c1 * CELL - inset, r0 * CELL + inset], [c1 * CELL - inset, r1 * CELL - inset], [c0 * CELL + inset, r1 * CELL - inset]], { building: 'yes' }, true);
  }
  console.log(`  ${osmBuildings} OSM buildings + ${buildings.length - osmBuildings} synthetic infill, ${roads.length} roads, ${waterBodies.length} water bodies, ${waterways.length} waterways`);

  // ---- micro-topography (synthetic, documented) ----
  const noise = new Float64Array(n); for (let i = 0; i < n; i++) noise[i] = rnd() - 0.5;
  const micro = gaussianSmooth(noise, N, N, 2.2);
  let mstd = 0; for (const v of micro) mstd += v * v; mstd = Math.sqrt(mstd / n);
  for (let i = 0; i < n; i++) {
    z[i] += micro[i] / mstd * 0.025;                      // +/- ~3 cm uneven ground, potholes
    if (cover[i] === C.ROAD) z[i] -= 0.05;                // road surface just below plot level
    if (cover[i] === C.WATER) z[i] -= 1.2;                // pond bed below banks
    if (cover[i] === C.CHANNEL) z[i] -= 1.5;              // nala / river bed
  }

  // ---- existing open roadside drains (synthetic layout on real roads) ----
  const drainOf = new Int32Array(n).fill(-1), drainUnits = new Map();
  for (let i = 0; i < n; i++) {
    if (cover[i] !== C.ROAD || roadOf[i] < 0) continue;
    const cls = roads[roadOf[i]].cls;
    if (!DRAIN_CAP[cls]) continue;
    const c = i % N, r = (i / N) | 0;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => { const cc = c + dc, rr = r + dr; return inGrid(cc, rr) && cover[idx(cc, rr)] !== C.ROAD; });
    if (!edge) continue;
    drainOf[i] = roadOf[i];
    if (!drainUnits.has(roadOf[i])) drainUnits.set(roadOf[i], { id: roadOf[i], cap: DRAIN_CAP[cls], silt: 0.5, cells: 0 });
    drainUnits.get(roadOf[i]).cells++;
  }
  for (let i = 0; i < n; i++) if (drainOf[i] >= 0) z[i] -= 0.12;   // open drain lip draws street water in

  // outfalls: drains touching a nala/river or pond, plus the low half of drain cells on the box edge
  const outfalls = [];
  const edgeDrains = [];
  for (let i = 0; i < n; i++) {
    if (drainOf[i] < 0) continue;
    const c = i % N, r = (i / N) | 0;
    let kind = null;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr;
      if (!inGrid(cc, rr)) continue;
      if (cover[idx(cc, rr)] === C.CHANNEL) kind = 'channel';
      else if (cover[idx(cc, rr)] === C.WATER && !kind) kind = 'pond';
    }
    if (kind) outfalls.push({ cell: i, kind });
    else if (c === 0 || r === 0 || c === N - 1 || r === N - 1) edgeDrains.push(i);
  }
  const zs = edgeDrains.map(i => z[i]).sort((a, b) => a - b), cut = zs[Math.floor(zs.length * 0.45)] ?? Infinity;
  for (const i of edgeDrains) if (z[i] <= cut) outfalls.push({ cell: i, kind: 'boundary' });

  // labels: named roads (longest first), places, critical facilities
  const labels = [];
  const seen = new Set();
  for (const rd of [...roads].sort((a, b) => b.length - a.length)) {
    if (!rd.name || seen.has(rd.name) || rd.length < 60) continue;
    seen.add(rd.name);
    let best = null, bd = Infinity;
    for (const p of rd.pts) { const d = Math.hypot(p[0] - HALF, p[1] - HALF); if (p[0] > 20 && p[1] > 20 && p[0] < 2 * HALF - 20 && p[1] < 2 * HALF - 20 && d < bd) { bd = d; best = p; } }
    if (best) labels.push({ text: rd.name, x: best[0], z: best[1], kind: 'road' });
    if (labels.length >= 8) break;
  }
  for (const e of osm.elements) if (e.type === 'node' && e.tags?.place && e.tags.name) {
    const [x, zz] = toXZ(e.lat, e.lon);
    if (x > 0 && zz > 0 && x < 2 * HALF && zz < 2 * HALF) labels.push({ text: e.tags.name, x: +x.toFixed(1), z: +zz.toFixed(1), kind: 'place' });
  }

  const zmin = Math.min(...z);
  const out = {
    id, name: S.name, city: S.city, state: S.state, center: [S.lat, S.lon], blurb: S.blurb, groundColor: S.ground,
    cellSize: CELL, nx: N, ny: N, zBase: +zmin.toFixed(2),
    soil: S.soil,
    z: Array.from(z, v => Math.round((v - zmin) * 100)),       // cm above zBase
    cover: Array.from(cover).join(''),
    bldg: Array.from(bldOf), road: Array.from(roadOf), drain: Array.from(drainOf),
    buildings, roads, drains: [...drainUnits.values()], outfalls, waterBodies, waterways, labels,
    stats: { osmBuildings, syntheticBuildings: buildings.length - osmBuildings, roads: roads.length, drainCells: [...drainOf].filter(v => v >= 0).length, relief: +(zr[1] - zr[0]).toFixed(2) },
    provenance: {
      terrain: `Terrain Tiles on the AWS Registry of Open Data (s3://elevation-tiles-prod, terrarium z${Z}, SRTM-derived ~30 m), Gaussian-smoothed σ=${S.smoothSigma * CELL} m and resampled to ${CELL} m`,
      osm: `© OpenStreetMap contributors (ODbL), Overpass API, downloaded ${new Date().toISOString().slice(0, 10)}`,
      synthetic: [
        'Building infill where OpenStreetMap has no footprints (marked "synthetic" in the inspector)',
        'Building levels when OSM has no building:levels tag',
        'Plinth heights (0.15–0.6 m) and residents (4.4 per household, 75 m² per dwelling)',
        'Roadside open-drain layout and sizes by road class; existing drains assumed 50 % silted',
        'Micro-relief ±3 cm, road surface −5 cm, drain lip −12 cm, pond beds −1.2 m',
        'Soil infiltration factor for the city',
      ],
    },
  };
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(out));
  console.log(`  wrote public/data/${id}.json (${(fs.statSync(path.join(OUT, `${id}.json`)).size / 1024).toFixed(0)} KB), ${out.stats.drainCells} drain cells, ${outfalls.length} outfalls`);
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SITES);
for (const id of ids) {
  if (!SITES[id]) { console.error('unknown site', id); continue; }
  await buildSite(id);
  await sleep(2000);   // be polite to Overpass
}
fs.writeFileSync(path.join(OUT, 'sites.json'), JSON.stringify(Object.entries(SITES).map(([id, s]) => ({ id, name: s.name, city: s.city, state: s.state, blurb: s.blurb }))));
