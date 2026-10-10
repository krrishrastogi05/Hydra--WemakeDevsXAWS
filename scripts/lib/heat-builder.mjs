// HYDRA heat-mode data builder: trees and pedestrian places (bus stops, markets, school gates, parks)
// -> the HeatSite in src/sim/heat/types.ts. Takes the flood builder's SiteData for the shared grid and never changes it.
// Used by scripts/fetch-heat.mjs and by the backend's area builder. Raw downloads go through `cache` (get/set by key).
import { memoryCache } from './site-builder.mjs';

const UA = 'HYDRA-hackathon/1.0 (educational climate simulator)';
const C = { OPEN: 0, ROAD: 1, BUILDING: 2, GREEN: 3, WATER: 4, PAVED: 5, CHANNEL: 6 };   // as src/sim/types.ts
const RANK = { motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5, residential: 4, unclassified: 4, living_street: 3, service: 2, pedestrian: 1, track: 1 };
// Street-tree density on road verges (share of verge cells, after spacing). Illustrative, tuned to how leafy each area looks
// on satellite imagery; replace with a tree census where one exists.
const VERGE_DENSITY = { gurugram: 0.10, chennai: 0.16, ranchi: 0.24 };
const PARK_DENSITY = 0.22;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mPerDegLat = phi => 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const mPerDegLon = phi => 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
const hash = n => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

async function overpass(id, bb, cache) {
  const key = `${id}.heat.osm.json`, hit = await cache.get(key);
  if (hit) return JSON.parse(hit.toString('utf8'));
  const b = `${bb.s},${bb.w},${bb.n},${bb.e}`;
  const q = `[out:json][timeout:120];(
    node["natural"="tree"](${b}); way["natural"="tree_row"](${b});
    node["highway"="bus_stop"](${b}); node["public_transport"="platform"](${b});
    node["amenity"="marketplace"](${b}); way["amenity"="marketplace"](${b});
    node["shop"](${b});
  ); out tags geom;`;
  for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        await cache.set(key, Buffer.from(JSON.stringify(j)));
        return j;
      } catch (e) { console.warn(`  ${ep}: ${e.message}, retrying`); await sleep(3000 * (t + 1)); }
    }
  }
  throw new Error('Overpass failed');
}

/** Builds heat-mode data for a site built by site-builder.mjs. Returns the HeatSite object. */
export async function buildHeat(site, { cache = memoryCache(), stage = () => {} } = {}) {
  const id = site.id;
  const N = site.nx, CELL = site.cellSize, HALF = (N * CELL) / 2, n = N * N;
  const [lat, lon] = site.center, phi = lat * Math.PI / 180, mLat = mPerDegLat(phi), mLon = mPerDegLon(phi), pad = 20;
  const bb = { s: lat - (HALF + pad) / mLat, n: lat + (HALF + pad) / mLat, w: lon - (HALF + pad) / mLon, e: lon + (HALF + pad) / mLon };
  const toXZ = (la, lo) => [(lo - lon) * mLon + HALF, (lat - la) * mLat + HALF];
  const cellOf = (x, z) => { const c = Math.floor(x / CELL), r = Math.floor(z / CELL); return c < 0 || r < 0 || c >= N || r >= N ? -1 : r * N + c; };
  const cx = i => (i % N + 0.5) * CELL, cz = i => (((i / N) | 0) + 0.5) * CELL;
  const cover = Uint8Array.from(site.cover, ch => ch.charCodeAt(0) - 48);
  const N4 = i => { const c = i % N, r = (i / N) | 0, out = []; for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const cc = c + dc, rr = r + dr; if (cc >= 0 && rr >= 0 && cc < N && rr < N) out.push(rr * N + cc); } return out; };
  const groundOK = i => cover[i] === C.OPEN || cover[i] === C.GREEN || cover[i] === C.PAVED;
  const roadRank = i => (site.road[i] >= 0 ? RANK[site.roads[site.road[i]].cls] ?? 0 : 0);
  const roadName = i => { for (const j of [i, ...N4(i)]) if (site.road[j] >= 0 && site.roads[site.road[j]].name) return site.roads[site.road[j]].name; return ''; };

  console.log(`\n[${id}] ${site.name}, ${site.city}`);
  stage('Downloading trees, bus stops and markets from OpenStreetMap');
  const osm = await overpass(id, bb, cache);
  stage('Placing trees and the places where people wait');

  // ---- trees: OSM first, then synthetic street and park trees where OSM is silent ----
  const trees = [], treeAt = new Int32Array(n).fill(-1);
  const addTree = (x, z, h, r, synthetic) => {
    const i = cellOf(x, z);
    if (i < 0 || cover[i] === C.BUILDING || cover[i] === C.WATER || cover[i] === C.CHANNEL || treeAt[i] >= 0) return;
    treeAt[i] = trees.length;
    trees.push({ cell: i, x: +x.toFixed(1), z: +z.toFixed(1), h: +h.toFixed(1), r: +r.toFixed(1), synthetic });
  };
  const num = v => { const f = parseFloat(v); return isFinite(f) && f > 0 ? f : 0; };
  for (const e of osm.elements) {
    if (e.type === 'node' && e.tags?.natural === 'tree') {
      const [x, z] = toXZ(e.lat, e.lon);
      addTree(x, z, Math.min(25, num(e.tags.height) || 9), Math.min(8, num(e.tags.diameter_crown) / 2 || 3.5), false);
    } else if (e.type === 'way' && e.tags?.natural === 'tree_row' && e.geometry) {
      const pts = e.geometry.map(g => toXZ(g.lat, g.lon));
      for (let k = 0; k + 1 < pts.length; k++) {
        const L = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]), steps = Math.max(1, Math.round(L / 8));
        for (let s = 0; s < steps; s++) addTree(pts[k][0] + (pts[k + 1][0] - pts[k][0]) * s / steps, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * s / steps, 9, 3.5, false);
      }
    }
  }
  const osmTrees = trees.length;
  const nearTree = (i, rad) => { const c = i % N, r = (i / N) | 0; for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) { const cc = c + dc, rr = r + dr; if (cc >= 0 && rr >= 0 && cc < N && rr < N && treeAt[rr * N + cc] >= 0) return true; } return false; };
  const dens = VERGE_DENSITY[id] ?? 0.15;
  for (let i = 0; i < n; i++) {
    if (!groundOK(i)) continue;
    const verge = N4(i).some(j => cover[j] === C.ROAD);
    const p = verge ? dens : cover[i] === C.GREEN ? PARK_DENSITY : 0;
    if (!p || hash(i * 7 + 3) > p * 2.2 || nearTree(i, 1)) continue;   // spacing >= 2 cells (10 m)
    const u = hash(i * 13 + 5);
    addTree(cx(i) + (hash(i + 11) - 0.5) * 2, cz(i) + (hash(i + 17) - 0.5) * 2, 6 + u * 6, 2.5 + u * 2, true);
  }
  console.log(`  trees: ${osmTrees} OSM + ${trees.length - osmTrees} synthetic`);

  // ---- pedestrian places (receptors) ----
  const receptors = [];
  const patch = (i0, rad, ok = j => cover[j] !== C.BUILDING && cover[j] !== C.WATER && cover[j] !== C.CHANNEL) => {
    const c0 = i0 % N, r0 = (i0 / N) | 0, out = [];
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) { const cc = c0 + dc, rr = r0 + dr; if (cc >= 0 && rr >= 0 && cc < N && rr < N && ok(rr * N + cc)) out.push(rr * N + cc); }
    return out;
  };
  // nearest road-side cell (non-building cell touching a road, or the road edge itself)
  const snapToKerb = i0 => {
    if (i0 < 0) return -1;
    const seen = new Set([i0]), q = [i0];
    for (let h = 0; h < q.length && h < 400; h++) {
      const i = q[h];
      if (cover[i] !== C.BUILDING && cover[i] !== C.WATER && cover[i] !== C.CHANNEL && (cover[i] === C.ROAD || N4(i).some(j => cover[j] === C.ROAD))) return i;
      for (const j of N4(i)) if (!seen.has(j)) { seen.add(j); q.push(j); }
    }
    return -1;
  };
  const addReceptor = (kind, name, cells, footfall, synthetic) => {
    if (!cells.length) return;
    const x = cells.reduce((a, i) => a + cx(i), 0) / cells.length, z = cells.reduce((a, i) => a + cz(i), 0) / cells.length;
    receptors.push({ id: receptors.length, kind, name, cells, x: +x.toFixed(1), z: +z.toFixed(1), footfall, synthetic });
  };
  const taken = (i, rad) => receptors.some(r => Math.hypot(r.x - cx(i), r.z - cz(i)) < rad);

  // bus stops
  for (const e of osm.elements) if (e.type === 'node' && (e.tags?.highway === 'bus_stop' || e.tags?.public_transport === 'platform')) {
    const i = snapToKerb(cellOf(...toXZ(e.lat, e.lon)));
    if (i < 0 || taken(i, 30)) continue;
    addReceptor('bus_stop', `Bus stop${e.tags.name ? ` · ${e.tags.name}` : roadName(i) ? ` · ${roadName(i)}` : ''}`, patch(i, 1), 3, false);
  }
  const osmStops = receptors.length;
  if (osmStops < 3) {   // synthetic stops every ~220 m along the main roads
    for (const rd of [...site.roads].sort((a, b) => (RANK[b.cls] ?? 0) - (RANK[a.cls] ?? 0) || b.length - a.length)) {
      if ((RANK[rd.cls] ?? 0) < 4 || rd.length < 150) continue;
      let acc = 110;
      for (let k = 0; k + 1 < rd.pts.length; k++) {
        const [ax, az] = rd.pts[k], [bx, bz] = rd.pts[k + 1], L = Math.hypot(bx - ax, bz - az);
        for (let s = 0; s < L; s += 10) {
          acc += 10;
          if (acc < 220) continue;
          const i = snapToKerb(cellOf(ax + (bx - ax) * s / L, az + (bz - az) * s / L));
          if (i < 0 || taken(i, 120)) continue;
          acc = 0;
          addReceptor('bus_stop', `Bus stop · ${rd.name || 'main road'}`, patch(i, 1), 3, true);
        }
      }
      if (receptors.length >= 6) break;
    }
  }

  // markets: OSM marketplaces, then clusters of shops, then a synthetic market street on the busiest main road
  for (const e of osm.elements) if (e.tags?.amenity === 'marketplace') {
    const [x, z] = e.type === 'node' ? toXZ(e.lat, e.lon) : e.geometry ? e.geometry.map(g => toXZ(g.lat, g.lon)).reduce((a, p, _, arr) => [a[0] + p[0] / arr.length, a[1] + p[1] / arr.length], [0, 0]) : [-1, -1];
    const i = snapToKerb(cellOf(x, z));
    if (i >= 0 && !taken(i, 40)) addReceptor('market', e.tags.name || `Market · ${roadName(i) || 'local'}`, patch(i, 2), 4, false);
  }
  const shops = osm.elements.filter(e => e.type === 'node' && e.tags?.shop).map(e => toXZ(e.lat, e.lon)).filter(([x, z]) => cellOf(x, z) >= 0);
  const used = new Set();
  for (let a = 0; a < shops.length; a++) {
    if (used.has(a)) continue;
    const near = shops.map((p, b) => [b, Math.hypot(p[0] - shops[a][0], p[1] - shops[a][1])]).filter(([b, d]) => d < 45 && !used.has(b)).map(([b]) => b);
    if (near.length < 4) continue;
    near.forEach(b => used.add(b));
    const x = near.reduce((s, b) => s + shops[b][0], 0) / near.length, z = near.reduce((s, b) => s + shops[b][1], 0) / near.length;
    const i = snapToKerb(cellOf(x, z));
    if (i >= 0 && !taken(i, 40)) addReceptor('market', `Shops · ${roadName(i) || 'market lane'}`, patch(i, 2), 4, false);
  }
  if (!receptors.some(r => r.kind === 'market')) {
    // densest frontage: road cells of rank >= 4 with the most building cells within 15 m (roads named bazaar / market first)
    let best = -1, bestScore = -1;
    for (let i = 0; i < n; i++) {
      if (cover[i] !== C.ROAD || roadRank(i) < 4) continue;
      const s = patch(i, 3, j => cover[j] === C.BUILDING).length + roadRank(i) - Math.hypot(cx(i) - HALF, cz(i) - HALF) / 60 + (/bazaa?r|market|mandi|chowk/i.test(roadName(i)) ? 25 : 0);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    if (best >= 0) addReceptor('market', `Market street · ${roadName(best) || 'main road'}`, patch(best, 2), 4, true);
  }

  // school and hospital gates (the buildings are OSM-tagged; the gate is the nearest kerb)
  site.buildings.forEach((b, k) => {
    if (!b.critical) return;
    const cxB = b.poly.reduce((a, p) => a + p[0], 0) / b.poly.length, czB = b.poly.reduce((a, p) => a + p[1], 0) / b.poly.length;
    const i = snapToKerb(cellOf(cxB, czB));
    if (i < 0 || taken(i, 40)) return;
    addReceptor(/Hospital|Clinic/.test(b.use) ? 'hospital' : /School|College/.test(b.use) ? 'school' : 'public_space', `${b.name || b.use} gate`, patch(i, 1), 3, false);
  });

  // parks and open public spaces: green components of 20+ cells
  const comp = new Int32Array(n).fill(-1);
  for (let s = 0; s < n; s++) {
    if (cover[s] !== C.GREEN || comp[s] >= 0) continue;
    const q = [s]; comp[s] = s;
    for (let h = 0; h < q.length; h++) for (const j of N4(q[h])) if (cover[j] === C.GREEN && comp[j] < 0) { comp[j] = s; q.push(j); }
    if (q.length < 20) continue;
    const mid = q[Math.floor(q.length / 2)];
    if (taken(mid, 60)) continue;
    addReceptor('public_space', `Park / open ground · ${roadName(snapToKerb(mid)) || 'local'}`, q.slice(0, 80), 2, false);
  }
  const syn = receptors.filter(r => r.synthetic).length;
  console.log(`  receptors: ${receptors.length - syn} from OSM + ${syn} synthetic (${['bus_stop', 'market', 'school', 'hospital', 'public_space'].map(k => `${receptors.filter(r => r.kind === k).length} ${k}`).join(', ')})`);

  const out = {
    id, trees, receptors,
    stats: { osmTrees, syntheticTrees: trees.length - osmTrees, osmReceptors: receptors.length - syn, syntheticReceptors: syn },
    provenance: {
      osm: `© OpenStreetMap contributors (ODbL), Overpass API (trees, bus stops, marketplaces, shops), downloaded ${new Date().toISOString().slice(0, 10)}`,
      synthetic: [
        `Street trees on road verges (${Math.round(dens * 100)} % of verge cells, 10 m spacing) and park trees where OpenStreetMap maps none`,
        'Tree heights 6–12 m and canopy radius 2.5–4.5 m when OSM has no height or crown tags',
        ...(osmStops < 3 ? ['Bus stops every ~220 m on main roads (OSM maps fewer than 3 here)'] : []),
        ...(receptors.some(r => r.kind === 'market' && r.synthetic) ? ['Market street placed on the main road with the densest building frontage'] : []),
        'Footfall weights per place type (bus stop 3, market 4, school or hospital gate 3, park 2) are illustrative',
      ],
    },
  };
  return out;
}
