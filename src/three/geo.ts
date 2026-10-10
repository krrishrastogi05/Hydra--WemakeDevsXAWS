// Grid <-> world helpers. World: x east, z south, y up (metres). Terrain relief is exaggerated x2 for readability.
import type { Grid } from '../sim/grid';

export const VE = 2;
export const half = (g: Grid) => (g.nx * g.dx) / 2;
export const cellX = (g: Grid, i: number) => ((i % g.nx) + 0.5) * g.dx - half(g);
export const cellZ = (g: Grid, i: number) => (((i / g.nx) | 0) + 0.5) * g.dx - half(g);
export const cellY = (g: Grid, i: number) => g.z[i] * VE;
export function cellAt(g: Grid, x: number, z: number) {
  const c = Math.floor((x + half(g)) / g.dx), r = Math.floor((z + half(g)) / g.dx);
  return c < 0 || r < 0 || c >= g.nx || r >= g.ny ? -1 : r * g.nx + c;
}
/** Cells on a straight line between two cells, stepping one axis at a time (4-connected, no diagonal gaps). */
export function lineCells(g: Grid, a: number, b: number) {
  const nx = g.nx;
  let c = a % nx, r = (a / nx) | 0, ic = 0, ir = 0;
  const c1 = b % nx, r1 = (b / nx) | 0, dc = Math.abs(c1 - c), dr = Math.abs(r1 - r), sc = Math.sign(c1 - c), sr = Math.sign(r1 - r);
  const out = [r * nx + c];
  while (ic < dc || ir < dr) {
    if ((0.5 + ic) / dc < (0.5 + ir) / dr) { c += sc; ic++; } else { r += sr; ir++; }
    out.push(r * nx + c);
  }
  return out;
}
export const hash = (n: number) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
