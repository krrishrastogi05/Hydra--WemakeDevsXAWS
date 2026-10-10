// Shadow casting on the 5 m grid. Buildings (and hills) are solid blocks; tree crowns and shade structures are
// semi-transparent layers between a base and a top height. A ray from a pedestrian (1.1 m up) toward the sun is
// traced cell by cell (exact grid traversal): it is blocked if it enters a cell below that cell's solid top, and
// it loses light each time it passes through a canopy layer.
import { COVER } from '../types';
import type { Grid } from '../grid';
import { HEAT_PARAMS as P } from './model';
import type { HeatIntervention, HeatSite } from './types';

export interface Obstacles {
  top: Float32Array;        // solid top, m above site.zBase: roof for building cells, ground elsewhere
  canBase: Float32Array; canTop: Float32Array;
  canTrans: Float32Array;   // 1 = no canopy layer in this cell
  treeCov: Float32Array;    // 0..1 share of the cell under a tree crown
  maxTop: number;
}

/** Roof height of each building (m above zBase): lowest ground under it + storeys + plinth. */
export function roofTops(g: Grid) {
  return g.site.buildings.map((b, k) => {
    let base = Infinity;
    for (const c of g.bCells[k]) base = Math.min(base, g.z[c]);
    return isFinite(base) ? base + b.levels * P.storey + b.plinth : -Infinity;
  });
}

const SUB = 4;   // sub-samples per cell side for crown coverage
function addTree(g: Grid, o: Obstacles, x: number, z: number, h: number, r: number) {
  const { nx, ny, dx } = g, c0 = Math.floor(x / dx), r0 = Math.floor(z / dx), reach = Math.ceil(r / dx);
  const ci = Math.min(g.n - 1, Math.max(0, r0 * nx + c0)), ground = g.z[ci], base = ground + h * P.trunkShare, top = ground + h;
  for (let rr = r0 - reach; rr <= r0 + reach; rr++) for (let cc = c0 - reach; cc <= c0 + reach; cc++) {
    if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
    let hit = 0;
    for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) {
      const px = (cc + (a + 0.5) / SUB) * dx, pz = (rr + (b + 0.5) / SUB) * dx;
      if ((px - x) ** 2 + (pz - z) ** 2 <= r * r) hit++;
    }
    if (!hit) continue;
    const j = rr * nx + cc, cov = hit / (SUB * SUB);
    if (g.cover[j] === COVER.BUILDING) continue;   // crowns over roofs do not shade the street below
    layer(o, j, base, top, 1 - cov * (1 - P.treeTrans));
    o.treeCov[j] = Math.min(1, o.treeCov[j] + cov);
  }
}
function layer(o: Obstacles, j: number, base: number, top: number, trans: number) {
  if (o.canTrans[j] >= 1) { o.canBase[j] = base; o.canTop[j] = top; o.canTrans[j] = trans; }
  else { o.canBase[j] = Math.min(o.canBase[j], base); o.canTop[j] = Math.max(o.canTop[j], top); o.canTrans[j] *= trans; }
  if (top > o.maxTop) o.maxTop = top;
}

/** Apply one plan item to the obstacle field (trees, canopies, walkways; cool roofs change no geometry). */
export function applyIntervention(g: Grid, o: Obstacles, iv: HeatIntervention) {
  if (iv.type === 'tree') {
    const c = iv.cells![0];
    addTree(g, o, ((c % g.nx) + 0.5) * g.dx, (((c / g.nx) | 0) + 0.5) * g.dx, P.newTree.h, P.newTree.r);
  } else if (iv.type === 'canopy' || iv.type === 'walkway') {
    for (const c of iv.cells!) layer(o, c, g.z[c] + P.canopyBase, g.z[c] + P.canopyTop, P.canopyTrans);
  }
}

export function buildObstacles(g: Grid, hs: HeatSite, plan: HeatIntervention[], roofs = roofTops(g)): Obstacles {
  const n = g.n, top = new Float32Array(n);
  let maxTop = 0;
  for (let i = 0; i < n; i++) {
    const b = g.bldg[i];
    top[i] = g.cover[i] === COVER.BUILDING && b >= 0 && isFinite(roofs[b]) ? roofs[b] : g.z[i];
    if (top[i] > maxTop) maxTop = top[i];
  }
  const o: Obstacles = { top, canBase: new Float32Array(n), canTop: new Float32Array(n), canTrans: new Float32Array(n).fill(1), treeCov: new Float32Array(n), maxTop };
  for (const t of hs.trees) addTree(g, o, t.x, t.z, t.h, t.r);
  for (const iv of plan) applyIntervention(g, o, iv);
  return o;
}

export function cloneObstacles(o: Obstacles): Obstacles {
  return { top: o.top, canBase: o.canBase.slice(), canTop: o.canTop.slice(), canTrans: o.canTrans.slice(), treeCov: o.treeCov.slice(), maxTop: o.maxTop };
}

/** Unit horizontal direction toward the sun in grid steps (column = east, row = south) and the ray's rise per metre. */
export function sunRay(elevDeg: number, azDeg: number) {
  const a = azDeg * Math.PI / 180;
  return { dc: Math.sin(a), dr: -Math.cos(a), slope: Math.tan(elevDeg * Math.PI / 180) };
}

/** Share of direct sun (0..1) reaching a person standing in cell i. `maxCells` limits the trace (for local updates). */
export function transmit(g: Grid, o: Obstacles, i: number, dc: number, dr: number, slope: number, maxCells = Infinity): number {
  const nx = g.nx, ny = g.ny, rise = slope * g.dx, p = g.z[i] + P.personHeight;
  let c = i % nx, r = (i / nx) | 0;
  const sc = dc > 0 ? 1 : -1, sr = dr > 0 ? 1 : -1;
  const ddc = Math.abs(dc) > 1e-9 ? 1 / Math.abs(dc) : Infinity, ddr = Math.abs(dr) > 1e-9 ? 1 / Math.abs(dr) : Infinity;
  let tc = 0.5 * ddc, tr = 0.5 * ddr, t0 = 0, T = 1;
  for (;;) {
    const t1 = Math.min(tc, tr), j = r * nx + c, hIn = p + t0 * rise;
    if (hIn > o.maxTop || t0 > maxCells) return T;
    if (j !== i && hIn < o.top[j]) return 0;
    if (o.canTrans[j] < 1 && hIn < o.canTop[j] && p + t1 * rise > o.canBase[j]) { T *= o.canTrans[j]; if (T < 0.005) return 0; }
    if (tc < tr) { c += sc; t0 = tc; tc += ddc; } else { r += sr; t0 = tr; tr += ddr; }
    if (c < 0 || r < 0 || c >= nx || r >= ny) return T;   // beyond the modelled area: assume open sky
  }
}
