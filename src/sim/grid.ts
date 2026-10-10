// Shared neighbourhood grid: site JSON -> typed arrays. Used by both the flood and the heat engines.
import { COVER, type SiteData } from './types';

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

export const fmtINR = (v: number) => {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v >= 1e6 ? 1 : 2)} L`;
  return '₹' + Math.round(v).toLocaleString('en-IN');
};
