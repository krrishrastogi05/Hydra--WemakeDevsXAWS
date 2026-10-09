// Site JSON -> typed-array grid, plus the intervention catalogue, costs, validation and design storms.
import { COVER, type Intervention, type InterventionType, type SiteData, type Storm } from './types';

export interface Grid {
  site: SiteData;
  nx: number; ny: number; n: number; dx: number; A: number;
  z: Float64Array;          // ground elevation, m above site.zBase
  cover: Uint8Array; bldg: Int32Array; road: Int32Array; drain: Int32Array;
  bCells: number[][];       // cells of each building
  blocked: Uint8Array;      // enclosed courtyards: treated as part of the adjacent building (their pipes reach the street)
  courtyard: number[][];    // courtyard cells whose rain leaves through each building's downpipes
  frontage: number[][];     // free cells next to each building (downpipes, doorsteps)
  roadCells: number[][];    // cells of each road
  unitCells: Map<number, number[]>;   // existing drain cells per drain unit (road id)
  outfall: Map<number, { kind: 'boundary' | 'channel' | 'pond'; target: number }>;
  edgeOutfallZ: number;     // a new drain reaching the box edge below this level is an outfall
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const DEPRESSION_CAP = 0.4;   // m: deepest closed basin kept (buildings count as walls)

/** Priority-flood from the box edge with buildings as walls; basins deeper than `cap` are raised to it.
 *  Real low spots stay as <= 40 cm waterlogging points; deeper bowls are SRTM artefacts with no culvert modelled. */
function conditionWithBuildings(z: Float64Array, cover: Uint8Array, blocked: Uint8Array, nx: number, ny: number, cap: number) {
  const n = nx * ny, filled = new Float64Array(n).fill(Infinity), keys: number[] = [], vals: number[] = [];
  const wall = (i: number) => cover[i] === COVER.BUILDING || blocked[i] === 1;
  const push = (k: number, v: number) => { keys.push(k); vals.push(v); let i = keys.length - 1; while (i) { const p = (i - 1) >> 1; if (keys[p] <= keys[i]) break; [keys[p], keys[i]] = [keys[i], keys[p]]; [vals[p], vals[i]] = [vals[i], vals[p]]; i = p; } };
  const pop = () => { const k0 = keys[0], v0 = vals[0], lk = keys.pop()!, lv = vals.pop()!; if (keys.length) { keys[0] = lk; vals[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < keys.length && keys[l] < keys[m]) m = l; if (r < keys.length && keys[r] < keys[m]) m = r; if (m === i) break; [keys[m], keys[i]] = [keys[i], keys[m]]; [vals[m], vals[i]] = [vals[i], vals[m]]; i = m; } } return [k0, v0]; };
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const i = r * nx + c;
    if ((!r || !c || r === ny - 1 || c === nx - 1) && !wall(i)) { filled[i] = z[i]; push(z[i], i); }
  }
  while (keys.length) {
    const [h, i] = pop(), c = i % nx, r = (i / nx) | 0;
    if (h > filled[i]) continue;
    for (const [dc, dr] of N4) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
      const j = rr * nx + cc;
      if (wall(j) || filled[j] !== Infinity) continue;
      filled[j] = Math.max(h, z[j]); push(filled[j], j);
    }
  }
  for (let i = 0; i < n; i++) if (filled[i] !== Infinity && filled[i] - z[i] > cap) z[i] = filled[i] - cap;
}

export function loadGrid(site: SiteData): Grid {
  const { nx, ny } = site, n = nx * ny, dx = site.cellSize;
  const z = new Float64Array(n), cover = new Uint8Array(n);
  for (let i = 0; i < n; i++) { z[i] = site.z[i] / 100; cover[i] = site.cover.charCodeAt(i) - 48; }
  const bldg = Int32Array.from(site.bldg), road = Int32Array.from(site.road), drain = Int32Array.from(site.drain);
  const bCells: number[][] = site.buildings.map(() => []);
  for (let i = 0; i < n; i++) if (bldg[i] >= 0) bCells[bldg[i]].push(i);
  // enclosed pockets of open ground (courtyards boxed in by buildings, not touching the box edge)
  const blocked = new Uint8Array(n), courtyard: number[][] = site.buildings.map(() => []), comp = new Int32Array(n).fill(-1);
  for (let s0 = 0; s0 < n; s0++) {
    if (comp[s0] >= 0 || cover[s0] === COVER.BUILDING) continue;
    const q = [s0]; comp[s0] = s0; let edge = false, owner = -1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h] % nx, r = (q[h] / nx) | 0;
      if (!c || !r || c === nx - 1 || r === ny - 1) edge = true;
      for (const [dc, dr] of N4) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
        const j = rr * nx + cc;
        if (cover[j] === COVER.BUILDING) { if (owner < 0) owner = bldg[j]; continue; }
        if (comp[j] < 0) { comp[j] = s0; q.push(j); }
      }
    }
    if (!edge && q.length < 80 && owner >= 0) for (const i of q) { blocked[i] = 1; courtyard[owner].push(i); }
  }
  conditionWithBuildings(z, cover, blocked, nx, ny, DEPRESSION_CAP);
  const free = (i: number) => !blocked[i] && cover[i] !== COVER.BUILDING && cover[i] !== COVER.WATER && cover[i] !== COVER.CHANNEL;
  const frontage = bCells.map(cells => {
    const s = new Set<number>();
    for (const i of cells) {
      const c = i % nx, r = (i / nx) | 0;
      for (const [dc, dr] of N4) {
        const cc = c + dc, rr = r + dr;
        if (cc >= 0 && rr >= 0 && cc < nx && rr < ny && free(rr * nx + cc)) s.add(rr * nx + cc);
      }
    }
    if (!s.size && cells.length) {          // enclosed: nearest free cell by BFS
      const seen = new Set(cells), q = [...cells];
      for (let h = 0; h < q.length && !s.size; h++) {
        const c = q[h] % nx, r = (q[h] / nx) | 0;
        for (const [dc, dr] of N4) {
          const cc = c + dc, rr = r + dr, j = rr * nx + cc;
          if (cc < 0 || rr < 0 || cc >= nx || rr >= ny || seen.has(j)) continue;
          seen.add(j); if (free(j)) { s.add(j); break; } q.push(j);
        }
      }
    }
    return [...s];
  });
  const roadCells: number[][] = site.roads.map(() => []);
  for (let i = 0; i < n; i++) if (road[i] >= 0 && cover[i] === COVER.ROAD) roadCells[road[i]].push(i);
  const unitCells = new Map<number, number[]>();
  for (let i = 0; i < n; i++) if (drain[i] >= 0) { if (!unitCells.has(drain[i])) unitCells.set(drain[i], []); unitCells.get(drain[i])!.push(i); }
  const outfall = new Map<number, { kind: 'boundary' | 'channel' | 'pond'; target: number }>();
  let edgeOutfallZ = -Infinity;
  for (const o of site.outfalls) {
    let target = -1;
    if (o.kind === 'pond') {
      const c = o.cell % nx, r = (o.cell / nx) | 0;
      for (const [dc, dr] of N4) { const j = (r + dr) * nx + c + dc; if (c + dc >= 0 && c + dc < nx && r + dr >= 0 && r + dr < ny && cover[j] === COVER.WATER) target = j; }
    }
    outfall.set(o.cell, { kind: o.kind, target });
    if (o.kind === 'boundary') edgeOutfallZ = Math.max(edgeOutfallZ, z[o.cell]);
  }
  return { site, nx, ny, n, dx, A: dx * dx, z, cover, bldg, road, drain, bCells, blocked, courtyard, frontage, roadCells, unitCells, outfall, edgeOutfallZ };
}

// ---------------- interventions ----------------
// Unit costs are indicative 2024 Indian rates; replace with the local CPWD / state PWD schedule of rates.
export const PARAMS = {
  newDrainCap: 0.4,        // m3/s, 0.6 x 0.6 m RCC drain at ~0.5 % slope (Manning n 0.015)
  gardenDepth: 0.25,       // m depression
  gardenRate: 60,          // mm/h through engineered media
  gardenMedia: 0.25,       // m of water held in media voids
  gardenExfil: 15,         // mm/h into native soil once media is full (x soil factor)
  pitStore: 2.5,           // m3
  pitRate: 1.0,            // L/s recharge (x soil factor)
  pitSump: 0.15,           // m inlet depression
  rwhDepth: 0.04,          // m of roof rain a tank holds (40 L per m2 of roof)
  desiltTo: 0.1,           // silt fraction after desilting
};
export const CATALOG: Record<InterventionType, { name: string; short: string; unit: string; color: string; key: string; blurb: string }> = {
  drain:  { name: 'Stormwater drain', short: 'Drain', unit: '₹6,000 per metre', color: '#7dd3fc', key: '1', blurb: 'New RCC drain (0.4 m³/s). Drag along a road towards an existing drain or the area edge. It only helps if it connects to an outfall.' },
  garden: { name: 'Rain garden', short: 'Rain garden', unit: '₹1.2 L per 10 × 10 m', color: '#4ade80', key: '2', blurb: 'Sunken planted bed (25 cm) that soaks up street runoff at 60 mm/h. Works best on sandy or loamy soil.' },
  rwh:    { name: 'Rooftop rainwater harvesting', short: 'Roof RWH', unit: '₹12,000 + ₹2,800 per m³', color: '#38bdf8', key: '3', blurb: 'Gutters + tank holding the first 40 mm of roof rain, so it never reaches the street.' },
  pit:    { name: 'Recharge pit', short: 'Recharge pit', unit: '₹40,000 each', color: '#fbbf24', key: '4', blurb: 'Gravel pit with a recharge bore at a low spot: 2.5 m³ store, ~1 L/s into the aquifer.' },
  desilt: { name: 'Drain desilting', short: 'Desilt', unit: '₹600 per metre', color: '#a78bfa', key: '5', blurb: 'Clear silt and solid waste from an existing roadside drain: capacity 50 % → 90 %.' },
};

export const tankSize = (roofArea: number) => Math.min(30, Math.max(3, roofArea * PARAMS.rwhDepth));

export function costOf(g: Grid, iv: Intervention): number {
  switch (iv.type) {
    case 'drain': return (iv.cells?.length ?? 0) * g.dx * 6000;
    case 'garden': return (iv.cells?.length ?? 0) * g.A * 1200;
    case 'pit': return 40000;
    case 'rwh': { const b = iv.building ?? -1; const roof = (g.bCells[b]?.length ?? 0) * g.A; return Math.round(12000 + 2800 * tankSize(roof)); }
    case 'desilt': return Math.round((g.unitCells.get(iv.unit ?? -1)?.length ?? 0) * g.dx * 600);
  }
}
export const planCost = (g: Grid, ivs: Intervention[]) => ivs.reduce((s, iv) => s + costOf(g, iv), 0);

/** Cells already used by a plan (so two interventions cannot share a cell). */
export function usedCells(ivs: Intervention[]) {
  const s = new Set<number>();
  for (const iv of ivs) if (iv.type !== 'rwh' && iv.type !== 'desilt') iv.cells?.forEach(c => s.add(c));
  return s;
}

const GARDEN_OK = new Set<number>([COVER.OPEN, COVER.GREEN, COVER.PAVED]);
const PIT_OK = new Set<number>([COVER.OPEN, COVER.GREEN, COVER.PAVED, COVER.ROAD]);
const DRAIN_OK = new Set<number>([COVER.OPEN, COVER.GREEN, COVER.PAVED, COVER.ROAD]);

/** Returns an error message, or null when the intervention can be placed. */
export function validate(g: Grid, iv: Intervention, plan: Intervention[]): string | null {
  const used = usedCells(plan.filter(p => p.id !== iv.id));
  switch (iv.type) {
    case 'garden': {
      if (!iv.cells?.length) return 'No cells';
      for (const c of iv.cells) {
        if (!GARDEN_OK.has(g.cover[c])) return 'Rain gardens need open, green or paved ground (not roads or buildings)';
        if (g.drain[c] >= 0) return 'There is already a drain here';
        if (used.has(c)) return 'Something is already built here';
      }
      return null;
    }
    case 'pit': {
      const c = iv.cells?.[0] ?? -1;
      if (c < 0 || !PIT_OK.has(g.cover[c])) return 'Recharge pits go on ground, paving or a road edge';
      if (used.has(c)) return 'Something is already built here';
      return null;
    }
    case 'drain': {
      if (!iv.cells?.length) return 'Drag to draw a drain';
      for (const c of iv.cells) {
        if (!DRAIN_OK.has(g.cover[c])) return 'Drains cannot pass through buildings or water';
        if (used.has(c)) return 'Something is already built here';
      }
      return null;
    }
    case 'rwh': {
      const b = iv.building ?? -1;
      if (b < 0 || !g.bCells[b]?.length) return 'Pick a building';
      if (plan.some(p => p.type === 'rwh' && p.building === b && p.id !== iv.id)) return 'This roof already harvests rain';
      return null;
    }
    case 'desilt': {
      if (!g.unitCells.has(iv.unit ?? -1)) return 'Pick an existing roadside drain';
      if (plan.some(p => p.type === 'desilt' && p.unit === iv.unit && p.id !== iv.id)) return 'Already desilted';
      return null;
    }
  }
}

/** 2 x 2 rain-garden footprint anchored at a cell (clipped to the grid). */
export function gardenFootprint(g: Grid, cell: number) {
  const c = Math.min(g.nx - 2, cell % g.nx), r = Math.min(g.ny - 2, (cell / g.nx) | 0);
  return [r * g.nx + c, r * g.nx + c + 1, (r + 1) * g.nx + c, (r + 1) * g.nx + c + 1];
}

// ---------------- design storms ----------------
// Magnitudes follow IMD categories (daily): heavy 64.5–115.5 mm, very heavy 115.6–204.4 mm,
// extremely heavy >= 204.5 mm; IMD calls >= 100 mm in an hour over a small area a cloudburst.
export const STORMS: Storm[] = [
  { id: 'heavy', name: 'Heavy monsoon spell', totalMm: 65, durationMin: 120, profile: 'peaked', note: '65 mm in 2 h: an IMD "heavy rainfall" day packed into one afternoon spell.' },
  { id: 'veryheavy', name: 'Very heavy downpour', totalMm: 120, durationMin: 180, profile: 'peaked', note: '120 mm in 3 h: IMD "very heavy" (115.6–204.4 mm/day), the kind of evening that jams Gurugram and floods Velachery.' },
  { id: 'cloudburst', name: 'Cloudburst-type burst', totalMm: 100, durationMin: 60, profile: 'peaked', note: '100 mm in 1 h: meets IMD\'s cloudburst threshold (≥ 100 mm/h).' },
  { id: 'extreme', name: 'Extreme day (2015-type)', totalMm: 220, durationMin: 360, profile: 'peaked', note: '220 mm in 6 h: IMD "extremely heavy" (≥ 204.5 mm/day). Illustrative of Chennai, Dec 2015.' },
];
export const BLOCK_MIN = 5;
/** Rain depth (mm) in each 5-minute block. Peaked = Gaussian burst at 40 % of the storm plus a 12 % background. */
export function hyetograph(s: Storm): number[] {
  const nb = Math.max(1, Math.round(s.durationMin / BLOCK_MIN)), w: number[] = [];
  for (let k = 0; k < nb; k++) {
    const t = (k + 0.5) / nb;
    w.push(s.profile === 'uniform' ? 1 : Math.exp(-(((t - 0.4) / 0.18) ** 2)) + 0.12);
  }
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map(v => v / sum * s.totalMm);
}

export const fmtINR = (v: number) => {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v >= 1e6 ? 1 : 2)} L`;
  return '₹' + Math.round(v).toLocaleString('en-IN');
};
