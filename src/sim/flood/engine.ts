// HYDRA rain-on-grid engine — a fill-and-spill ("blue spot") pluvial flood model with a drain network.
// Every process is a few lines you can read:
//   rain -> roofs/RWH -> runoff routed downhill (D8 on the depression-filled surface), soaking into permeable ground on the way
//   -> open-drain inlets capture flow -> drains carry it to outfalls, surcharging back to the street when full
//   -> low spots fill like small reservoirs (level from their hypsometric curve) and spill to the next one when full.
// Moving water on streets gets a Manning normal depth from its discharge, so roads show running water too.
import { COVER } from '../types';
import type { Grid } from '../grid';
import type { Hotspot, Intervention, Metrics, SimOptions, SimResult, WaterBudget } from './types';
import { BLOCK_MIN, PARAMS, hyetograph, planCost, tankSize } from './model';

export const DEPTH = { wet: 0.10, road: 0.15 };            // m: waterlogged; two-wheelers stall / traffic stops
// by cover code: OPEN, ROAD, BUILDING, GREEN, WATER, PAVED, CHANNEL
const MANNING = [0.035, 0.016, 0.02, 0.06, 0.03, 0.02, 0.03];
const RATE = [10, 0, 0, 25, 0, 1.5, 0];                   // mm/h infiltration capacity at soil factor 1
const STORE = [50, 0, 0, 100, 0, 5, 0];                   // mm the soil absorbs before it is saturated
const RESIDUAL = 0.15;                                    // share of the rate left once saturated (deep percolation)
const POND_INIT = 0.7;                                    // m, ponds start at their normal level
const INLET = 0.12;                                       // m3/s an open roadside drain can take in per 5 m
const ANTE = { dry: { s: 1.3, f: 1.1 }, normal: { s: 1, f: 1 }, wet: { s: 0.35, f: 0.8 } };
export const ROAD_WEIGHT: Record<string, number> = { motorway: 2, trunk: 2, primary: 1.8, secondary: 1.6, tertiary: 1.3, residential: 1, unclassified: 1, living_street: 0.8, service: 0.6, pedestrian: 0.5, track: 0.4 };
const EPS = 1e-5;                                         // m, gradient imposed across filled flats so every cell drains

/** Harm weight per m3 of water above 10 cm in each cell (roads by class, doorsteps by residents, critical buildings). */
export function harmWeights(g: Grid): Float64Array {
  const w = new Float64Array(g.n);
  for (let i = 0; i < g.n; i++) {
    const cv = g.cover[i];
    if (cv === COVER.BUILDING || cv === COVER.WATER || cv === COVER.CHANNEL || g.blocked[i]) continue;
    w[i] = cv === COVER.ROAD && g.road[i] >= 0 ? (ROAD_WEIGHT[g.site.roads[g.road[i]].cls] ?? 1) : 0.2;
  }
  g.site.buildings.forEach((b, k) => {
    const fr = g.frontage[k];
    if (!fr.length) return;
    const add = (b.residents + 5 + (b.critical ? 25 : 0)) * 0.5 / fr.length;
    for (const c of fr) w[c] += add;
  });
  return w;
}

export class Heap {   // binary min-heap of (key, value)
  k: number[] = []; v: number[] = [];
  push(key: number, val: number) { const { k, v } = this; k.push(key); v.push(val); let i = k.length - 1; while (i) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; } }
  pop(): [number, number] { const { k, v } = this; const top: [number, number] = [k[0], v[0]]; const lk = k.pop()!, lv = v.pop()!; if (k.length) { k[0] = lk; v[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; } } return top; }
  get size() { return this.k.length; }
}

const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Surface routing structure for one plan: depression-filled surface, D8 receivers, lakes (low spots) and their outlets. */
export function buildSurface(g: Grid, z: Float64Array, solid: Uint8Array) {
  const { n, nx, ny, dx } = g;
  const filled = new Float64Array(n).fill(Infinity), fE = new Float64Array(n).fill(Infinity), heap = new Heap();
  const okDiag = (i: number, dc: number, dr: number) => !solid[i - dc] || !solid[i - dr * nx];   // not squeezing between two building corners
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const i = r * nx + c;
    if (solid[i]) continue;
    if (!r || !c || r === ny - 1 || c === nx - 1 || g.cover[i] === COVER.CHANNEL) { filled[i] = fE[i] = z[i]; heap.push(z[i], i); }
  }
  while (heap.size) {   // priority-flood with an epsilon gradient (Barnes et al. 2014)
    const [, i] = heap.pop(), c = i % nx, r = (i / nx) | 0;
    for (const [dc, dr] of NB8) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
      const j = rr * nx + cc;
      if (solid[j] || fE[j] !== Infinity || (dc && dr && !okDiag(j, dc, dr))) continue;
      filled[j] = Math.max(z[j], filled[i]); fE[j] = Math.max(z[j], fE[i] + EPS); heap.push(fE[j], j);
    }
  }
  // D8 steepest descent on the epsilon-filled surface; -1 = leaves the area (box edge or river)
  const rec = new Int32Array(n).fill(-1), slope = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (solid[i] || fE[i] === Infinity) continue;
    const c = i % nx, r = (i / nx) | 0;
    let best = -1, bs = 0;
    for (const [dc, dr] of NB8) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
      const j = rr * nx + cc;
      if (solid[j] || fE[j] === Infinity || (dc && dr && !okDiag(j, dc, dr))) continue;
      const s = (fE[i] - fE[j]) / ((dc && dr ? Math.SQRT2 : 1) * dx);
      if (s > bs) { bs = s; best = j; }
    }
    if (g.cover[i] === COVER.CHANNEL) best = -1;
    rec[i] = best; slope[i] = Math.max(0.002, (filled[i] - (best >= 0 ? filled[best] : filled[i] - 0.002 * dx)) / dx);
  }
  // lakes = connected low spots sharing one fill level; their outlet is the lowest cell on the filled surface
  const lakeOf = new Int32Array(n).fill(-1), lakes: { cells: number[]; zs: number[]; level: number; cap: number; outlet: number }[] = [];
  for (let s = 0; s < n; s++) {
    if (lakeOf[s] >= 0 || solid[s] || fE[s] === Infinity || filled[s] - z[s] < 0.003) continue;
    const id = lakes.length, cells = [s]; lakeOf[s] = id;
    for (let h = 0; h < cells.length; h++) {
      const i = cells[h], c = i % nx, r = (i / nx) | 0;
      for (const [dc, dr] of NB8) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
        const j = rr * nx + cc;
        if (lakeOf[j] >= 0 || solid[j] || fE[j] === Infinity || filled[j] - z[j] < 0.003 || Math.abs(filled[j] - filled[i]) > 1e-9) continue;
        lakeOf[j] = id; cells.push(j);
      }
    }
    cells.sort((a, b) => z[a] - z[b]);
    let cap = 0, outlet = cells[0];
    for (const i of cells) { cap += (filled[i] - z[i]) * g.A; if (fE[i] < fE[outlet]) outlet = i; }
    lakes.push({ cells, zs: cells.map(i => z[i]), level: filled[s], cap, outlet });
  }
  // lake outlets may sit just outside the lake cells (the spill cell); make sure the outlet drains out of the lake
  for (const L of lakes) {
    let o = L.outlet, guard = 0;
    while (rec[o] >= 0 && lakeOf[rec[o]] === lakeOf[L.outlet] && guard++ < n) o = rec[o];
    L.outlet = o;
  }
  const order = Array.from({ length: n }, (_, i) => i).filter(i => !solid[i] && fE[i] !== Infinity).sort((a, b) => fE[b] - fE[a]);
  return { filled, fE, rec, slope, lakeOf, lakes, order };
}

/** Water level of a lake holding volume V (hypsometric curve over its cells). */
function lakeLevel(zs: number[], V: number, A: number) {
  if (V <= 0) return zs[0];
  let vol = 0;
  for (let k = 0; k < zs.length; k++) {
    const next = k + 1 < zs.length ? zs[k + 1] : Infinity, add = (next - zs[k]) * (k + 1) * A;
    if (vol + add >= V) return zs[k] + (V - vol) / ((k + 1) * A);
    vol += add;
  }
  return zs[zs.length - 1];
}

/** Drain network with the plan applied: capacity per cell, downstream link, outfall handling, upstream-first order. */
export function buildDrains(g: Grid, ivs: Intervention[], z: Float64Array) {
  const { n, nx, ny, dx } = g;
  const desilted = new Set(ivs.filter(i => i.type === 'desilt').map(i => i.unit!));
  const newDrain = new Uint8Array(n);
  for (const iv of ivs) if (iv.type === 'drain') iv.cells!.forEach(c => { newDrain[c] = 1; });
  const units = new Map(g.site.drains.map(u => [u.id, u]));
  const cap = new Float64Array(n), vmax = new Float64Array(n), isDrain = new Uint8Array(n);
  const outKind = new Int8Array(n), outTarget = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (g.drain[i] >= 0) {
      const u = units.get(g.drain[i])!;
      cap[i] = u.cap * (1 - (desilted.has(u.id) ? PARAMS.desiltTo : u.silt)); vmax[i] = 0.8 + 3 * u.cap; isDrain[i] = 1;
    }
    if (newDrain[i]) { cap[i] += PARAMS.newDrainCap; vmax[i] += 2; isDrain[i] = 1; }
  }
  for (const [cell, o] of g.outfall) if (isDrain[cell]) { outKind[cell] = o.kind === 'pond' && o.target >= 0 ? 2 : 1; outTarget[cell] = o.target; }
  for (let i = 0; i < n; i++) {
    if (!newDrain[i] || outKind[i]) continue;
    const c = i % nx, r = (i / nx) | 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
      const j = rr * nx + cc;
      if (g.cover[j] === COVER.CHANNEL) { outKind[i] = 1; }
      else if (g.cover[j] === COVER.WATER && !outKind[i]) { outKind[i] = 2; outTarget[i] = j; }
    }
    if (!outKind[i] && (c === 0 || r === 0 || c === nx - 1 || r === ny - 1) && z[i] <= g.edgeOutfallZ + 0.05) outKind[i] = 1;
  }
  // Dijkstra from the outfalls; climbing costs 400 m of extra length per metre, so gravity routes win
  const dist = new Float64Array(n).fill(Infinity), down = new Int32Array(n).fill(-2), heap = new Heap();
  for (let i = 0; i < n; i++) if (isDrain[i] && outKind[i]) { dist[i] = 0; down[i] = -1; heap.push(0, i); }
  while (heap.size) {
    const [dv, v] = heap.pop();
    if (dv > dist[v]) continue;
    const c = v % nx, r = (v / nx) | 0;
    for (const [dc, dr] of NB8) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
      const u = rr * nx + cc;
      if (!isDrain[u] || outKind[u]) continue;
      // bigger, cleaner drains offer less resistance, so flow at a junction prefers them; climbing is heavily penalised
      const cost = dv + (dr && dc ? Math.SQRT2 : 1) * dx * Math.sqrt(0.3 / Math.max(cap[v], 0.05)) + 400 * Math.max(0, z[v] - z[u]);
      if (cost < dist[u]) { dist[u] = cost; down[u] = v; heap.push(cost, u); }
    }
  }
  // slope-dependent capacity (Manning: Q ∝ √S), relative to a 0.4 % design slope
  for (let i = 0; i < n; i++) if (isDrain[i] && down[i] >= 0) {
    const j = down[i], step = (i % nx !== j % nx && ((i / nx) | 0) !== ((j / nx) | 0) ? Math.SQRT2 : 1) * dx;
    cap[i] *= Math.min(1.3, Math.max(0.4, Math.sqrt(Math.max((z[i] - z[j]) / step, 0.0004) / 0.004)));
  }
  const cells: number[] = [];
  for (let i = 0; i < n; i++) if (isDrain[i]) cells.push(i);
  const order = [...cells].sort((a, b) => (dist[b] === Infinity ? 1e18 : dist[b]) - (dist[a] === Infinity ? 1e18 : dist[a]));
  return { cap, vmax, isDrain, down, dist, outKind, outTarget, cells, order };
}

/** Apply a plan to the terrain. Only new drains reshape the ground (an open drain is a channel with a lip);
 *  rain gardens and recharge pits are storage devices: they catch water, they do not open new flow paths. */
export function planTerrain(g: Grid, ivs: Intervention[]) {
  const z = Float64Array.from(g.z), garden = new Uint8Array(g.n);
  for (const iv of ivs) {
    if (iv.type === 'garden') for (const c of iv.cells!) garden[c] = 1;
    else if (iv.type === 'drain') for (const c of iv.cells!) if (g.drain[c] < 0) z[c] -= 0.12;
  }
  return { z, garden };
}

export function simulate(g: Grid, ivs: Intervention[], opt: SimOptions): SimResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { n, dx, A } = g;
  const dt = opt.dt ?? 60, recess = opt.recessionMin ?? 60, frameEvery = Math.max(1, Math.round((opt.frameEveryMin ?? 2) * 60 / dt));
  const keep = opt.keepFrames !== false;
  const soilF = g.site.soil.factor, ante = ANTE[opt.antecedent];

  // ---- cell properties; the plan changes some of them ----
  const { z, garden } = planTerrain(g, ivs), cover = g.cover;
  const solid = new Uint8Array(n), land = new Uint8Array(n);
  const f = new Float64Array(n), fres = new Float64Array(n), smax = new Float64Array(n), soil = new Float64Array(n), nMan = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cv = cover[i];
    solid[i] = cv === COVER.BUILDING || g.blocked[i] ? 1 : 0;
    land[i] = !solid[i] && cv !== COVER.WATER && cv !== COVER.CHANNEL ? 1 : 0;
    f[i] = RATE[cv] * soilF * ante.f / 3.6e6 * dt;          // m per step
    fres[i] = f[i] * RESIDUAL;
    smax[i] = STORE[cv] * ante.s / 1000;
    nMan[i] = MANNING[cv];
  }
  const S = buildSurface(g, z, solid);
  const { rec, slope, lakeOf, lakes, order } = S;
  const lakeStore = new Float64Array(lakes.length), lakeIn = new Float64Array(lakes.length), lakeLvl = new Float64Array(lakes.length);
  lakes.forEach((L, k) => {
    let v = 0;
    for (const c of L.cells) if (cover[c] === COVER.WATER) v += Math.min(POND_INIT, L.level - z[c]) * A;
    lakeStore[k] = v; lakeLvl[k] = lakeLevel(L.zs, v, A);
  });
  const initialStore = lakeStore.reduce((a, b) => a + b, 0);
  const isOutletOf = new Int32Array(n).fill(-1);
  lakes.forEach((L, k) => { isOutletOf[L.outlet] = k; });

  const B = { rain: 0, infiltrated: 0, harvested: 0, gardens: 0, pits: 0, drains: 0, channel: 0, edge: 0 };
  const nb = g.bCells.length, tankCap = new Float64Array(nb), tank = new Float64Array(nb);
  // storage devices: rain gardens (bowl + media, soak away into native soil) and recharge pits (store, recharge bore)
  const devAt = new Int32Array(n).fill(-1), devCap: number[] = [], devRate: number[] = [], devArea: number[] = [], devGarden: boolean[] = [];
  for (const iv of ivs) {
    if (iv.type === 'pit' || iv.type === 'garden') {
      const k = devCap.length, area = iv.cells!.length * A, isG = iv.type === 'garden';
      iv.cells!.forEach(c => { devAt[c] = k; });
      devCap.push(isG ? (PARAMS.gardenDepth + PARAMS.gardenMedia) * area : PARAMS.pitStore);
      devRate.push(isG ? PARAMS.gardenExfil * soilF / 3.6e6 * dt * area : PARAMS.pitRate * soilF / 1000 * dt);
      devArea.push(area); devGarden.push(isG);
    }
    else if (iv.type === 'rwh') tankCap[iv.building!] = tankSize(g.bCells[iv.building!].length * A);
  }
  const devStore = new Float64Array(devCap.length);
  const capture = (c: number, v: number) => {   // a device at cell c takes what it can hold
    const k = devAt[c], take = Math.min(v, devCap[k] - devStore[k]);
    if (take <= 0) return 0;
    devStore[k] += take;
    if (devGarden[k]) B.gardens += take; else B.pits += take;
    return take;
  };
  const net = buildDrains(g, ivs, z);
  const { cap, vmax, isDrain, down, outKind, outTarget, order: dOrder } = net;
  const store = new Float64Array(n), dIn = new Float64Array(n), util = new Float32Array(n), pending = new Float64Array(n);
  const lip = new Float64Array(n);
  for (let i = 0; i < n; i++) lip[i] = garden[i] ? 9 : isDrain[i] ? 0.12 : 0;

  // ---- outputs ----
  const blocks = hyetograph(opt.storm), stormSec = opt.storm.durationMin * 60;
  const steps = Math.ceil((stormSec + recess * 60) / dt), nFrames = Math.floor(steps / frameEvery) + 1;
  const frames = keep ? new Uint16Array(nFrames * n) : null;
  const drainFrames = keep ? new Uint8Array(nFrames * net.cells.length) : null;
  const frameTimes = new Float32Array(nFrames), rainSeries = new Float32Array(nFrames), pondedSeries = new Float32Array(nFrames);
  const maxD = new Float32Array(n), timeOver = new Float32Array(n), surcharge = new Float32Array(n), depth = new Float64Array(n);
  const w = new Float64Array(n), through = new Float32Array(n), drainPeak = new Float32Array(n);
  const lakeSpill = new Float32Array(lakes.length), lakeInflow = new Float32Array(lakes.length);

  // what the storm is doing at each frame, by the same rules as the end-of-event metrics below (only for playback runs)
  const rainCumSeries = new Float32Array(nFrames), wetAreaSeries = new Float32Array(nFrames), roadCutSeries = new Float32Array(nFrames);
  const homesSeries = new Float32Array(nFrames), residentsSeries = new Float32Array(nFrames), overflowSeries = new Float32Array(nFrames);
  const sd = new Float64Array(n);
  const liveMetrics = (k: number) => {
    let wet = 0;
    for (let i = 0; i < n; i++) { sd[i] = land[i] && !garden[i] ? depth[i] - lip[i] : 0; if (sd[i] > DEPTH.wet) wet += A; }
    let roadKm = 0;
    g.site.roads.forEach((rd, r) => {
      const cells = g.roadCells[r];
      if (!cells.length) return;
      let cut = 0;
      for (const c of cells) if (sd[c] > DEPTH.road) cut++;
      roadKm += rd.length / 1000 * cut / cells.length;
    });
    let homes = 0, residents = 0;
    g.site.buildings.forEach((b, k2) => {
      const fr = g.frontage[k2];
      if (!fr.length) return;
      let ground = 0, top = -Infinity;
      for (const c of fr) { ground += g.z[c]; if (sd[c] > 0.005) top = Math.max(top, z[c] + sd[c]); }
      if (top - ground / fr.length > b.plinth) { homes++; residents += b.residents; }
    });
    let over = 0;
    for (const c of net.cells) if (util[c] < 0) over++;
    rainCumSeries[k] = B.rain / (A * n) * 1000; wetAreaSeries[k] = wet; roadCutSeries[k] = roadKm;
    homesSeries[k] = homes; residentsSeries[k] = residents; overflowSeries[k] = over * dx;
  };

  let surchargeTot = 0, peakPonded = 0, frame = 0;
  const lakeOfCell = lakeOf;

  const record = (t: number, rainNow: number) => {
    let ponded = 0;
    for (let i = 0; i < n; i++) if (land[i] && !garden[i]) ponded += depth[i] * A;
    if (frame < nFrames) {
      if (frames) { const o = frame * n; for (let i = 0; i < n; i++) frames[o + i] = Math.min(65535, Math.round(depth[i] * 1000)); }
      if (drainFrames) { const o = frame * net.cells.length; net.cells.forEach((c, k) => { drainFrames[o + k] = util[c] < 0 ? 255 : Math.round(Math.min(1, util[c]) * 254); }); }
      if (keep) liveMetrics(frame);
      frameTimes[frame] = t / 60; rainSeries[frame] = rainNow; pondedSeries[frame] = ponded; frame++;
    }
    return ponded;
  };
  record(0, 0);

  for (let s = 0; s < steps; s++) {
    const t = s * dt, bi = Math.floor(t / (BLOCK_MIN * 60));
    const rainMmH = t < stormSec && bi < blocks.length ? blocks[bi] / BLOCK_MIN * 60 : 0;
    const r = rainMmH / 3.6e6 * dt;

    // 1. rain on open cells; roofs and courtyards drain through downpipes after filling any RWH tank
    for (let i = 0; i < n; i++) { w[i] = pending[i]; pending[i] = 0; }
    if (r > 0) {
      B.rain += r * A * n;
      for (let i = 0; i < n; i++) if (!solid[i]) w[i] += r * A;
      for (let b = 0; b < nb; b++) {
        const cells = g.bCells[b].length + g.courtyard[b].length;
        if (!cells) continue;
        let v = r * cells * A;
        if (tankCap[b] > 0) { const take = Math.min(v, tankCap[b] - tank[b]); tank[b] += take; B.harvested += take; v -= take; }
        if (v <= 0) continue;
        const fr = g.frontage[b];
        if (!fr.length) { B.edge += v; continue; }
        for (const c of fr) w[c] += v / fr.length;
      }
    }
    // devices empty into the soil / aquifer every minute
    for (let k = 0; k < devStore.length; k++) devStore[k] -= Math.min(devStore[k], devRate[k]);
    // 2. route downhill (highest first): soak into permeable ground, recharge pits, drain inlets, then on to the receiver.
    //    Water reaching a low spot joins its lake; a lake is settled when its outlet is reached and spills what it cannot hold.
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      let q = w[i]; w[i] = 0;
      through[i] += q;
      const L = lakeOfCell[i];
      if (L >= 0) lakeInflow[L] += q;
      if (L >= 0 && isOutletOf[i] !== L) { lakeIn[L] += q; depth[i] = 0; continue; }
      if (L >= 0) q += lakeIn[L];   // the lake's outlet: settle the lake first
      if (L >= 0) {
        const lake = lakes[L];
        let V = lakeStore[L] + q; lakeIn[L] = 0;
        // infiltration and pits under the wetted part of the lake
        const lvl = lakeLevel(lake.zs, V, A);
        for (let m = 0; m < lake.cells.length && lake.zs[m] < lvl; m++) {
          const c = lake.cells[m], rate = soil[c] < smax[c] ? f[c] : fres[c];
          if (rate > 0 && V > 0) { const inf = Math.min(V, rate * A); V -= inf; soil[c] += inf / A; if (garden[c]) B.gardens += inf; else B.infiltrated += inf; }
          if (devAt[c] >= 0 && V > 0) V -= capture(c, V);
          if (isDrain[c] && V > 0) { const take = Math.min(V, INLET * dt); V -= take; dIn[c] += take; }   // drains under ponded water
        }
        const over = Math.max(0, V - lake.cap);
        lakeStore[L] = V - over; lakeLvl[L] = lakeLevel(lake.zs, lakeStore[L], A); lakeSpill[L] += over;
        q = over;
        if (q <= 0) { depth[i] = Math.max(0, lakeLvl[L] - z[i]); continue; }
      }
      if (q > 0 && land[i]) {
        const rate = soil[i] < smax[i] ? f[i] : fres[i];
        if (rate > 0) { const inf = Math.min(q, rate * A); q -= inf; soil[i] += inf / A; if (garden[i]) B.gardens += inf; else B.infiltrated += inf; }
        if (devAt[i] >= 0 && q > 0) q -= capture(i, q);
        if (isDrain[i] && q > 0) { const take = Math.min(q, INLET * dt); q -= take; dIn[i] += take; }
      }
      // depth of moving water: Manning normal depth across one 5 m cell
      const Q = q / dt;
      depth[i] = L >= 0 ? Math.max(0, lakeLvl[L] - z[i]) : Q > 1e-6 ? Math.min(0.5, Math.pow(Q / dx * nMan[i] / Math.sqrt(slope[i]), 0.6)) : 0;
      if (q <= 0) continue;
      const rv = rec[i];
      if (rv >= 0) w[rv] += q;
      else if (cover[i] === COVER.CHANNEL) B.channel += q;
      else B.edge += q;
    }
    for (let i = 0; i < n; i++) if (garden[i] && devAt[i] >= 0) depth[i] = Math.min(PARAMS.gardenDepth, devStore[devAt[i]] / devArea[devAt[i]]);
    // lake depths across each low spot
    for (let L = 0; L < lakes.length; L++) {
      const lk = lakes[L], lv = lakeLvl[L];
      for (let m = 0; m < lk.cells.length; m++) depth[lk.cells[m]] = Math.max(0, lv - lk.zs[m]);
    }
    // 3. drains: capacity-limited routing from upstream to the outfalls; overflow surcharges onto the street next minute
    for (let k = 0; k < dOrder.length; k++) {
      const i = dOrder[k], avail = store[i] + dIn[i];
      dIn[i] = 0;
      const out = down[i] === -2 ? 0 : Math.min(avail, cap[i] * dt);
      let st = avail - out;
      util[i] = cap[i] > 0 ? out / (cap[i] * dt) : 0;
      if (st > vmax[i]) { const sur = st - vmax[i]; st = vmax[i]; pending[i] += sur; surcharge[i] += sur; surchargeTot += sur; util[i] = -1; }
      drainPeak[i] = Math.max(drainPeak[i], util[i] < 0 ? 2 : util[i]);
      store[i] = st;
      if (out > 0) {
        if (down[i] >= 0) dIn[down[i]] += out;
        else if (outKind[i] === 2) pending[outTarget[i]] += out;
        else B.drains += out;
      }
    }
    // 4. record maxima of street depth (water held inside an open drain or pit sump is not on the street)
    for (let i = 0; i < n; i++) {
      if (!land[i]) continue;
      const sd = depth[i] - lip[i];
      if (sd > maxD[i]) maxD[i] = sd;
      if (sd > DEPTH.road) timeOver[i] += dt / 60;
    }
    if ((s + 1) % frameEvery === 0) peakPonded = Math.max(peakPonded, record((s + 1) * dt, rainMmH));
  }

  // ---- results ----
  let lakeEnd = 0, drainStore = 0, pend = 0;
  for (let k = 0; k < lakes.length; k++) lakeEnd += lakeStore[k] + lakeIn[k];   // + water that arrived after its low spot settled
  for (let i = 0; i < n; i++) { drainStore += store[i]; pend += pending[i]; }
  const standingEnd = lakeEnd + pend - initialStore;
  const budget: WaterBudget = {
    ...B, standingEnd, drainStore,
    error: B.rain - (B.infiltrated + B.harvested + B.gardens + B.pits + B.drains + B.channel + B.edge + standingEnd + drainStore),
  };
  const site = g.site;
  // water at the door = highest water surface on the frontage above the plot level (mean frontage ground)
  const doorstep = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    const fr = g.frontage[b];
    if (!fr.length) continue;
    let ground = 0, top = -Infinity;
    for (const c of fr) { ground += g.z[c]; if (maxD[c] > 0.005) top = Math.max(top, z[c] + maxD[c]); }
    doorstep[b] = Math.max(0, top - ground / fr.length);
  }
  const hw = harmWeights(g);
  let impact = 0, floodedArea = 0, maxDepth = 0, endPonded = 0;
  for (let i = 0; i < n; i++) {
    if (!land[i] || garden[i]) continue;
    if (maxD[i] > DEPTH.wet) { floodedArea += A; impact += hw[i] * (maxD[i] - DEPTH.wet) * A; }
    maxDepth = Math.max(maxDepth, maxD[i]);
    endPonded += depth[i] * A;
  }
  let atRisk = 0, flooded = 0, residents = 0, critical = 0;
  site.buildings.forEach((b, k) => {
    if (!g.frontage[k].length) return;
    const ds = doorstep[k];
    if (ds > b.plinth) { flooded++; residents += b.residents; impact += (b.residents + 5 + (b.critical ? 25 : 0)) * (ds - b.plinth) * 20; }
    else if (ds > DEPTH.wet) atRisk++;
    if (b.critical && ds > DEPTH.wet) critical++;
  });
  let roadKm = 0, roadKmAffected = 0, roadKmHours = 0;
  site.roads.forEach((rd, k) => {
    const cells = g.roadCells[k];
    if (!cells.length) return;
    let wet = 0, hrs = 0;
    for (const c of cells) { if (maxD[c] > DEPTH.road) wet++; hrs += timeOver[c] / 60; }
    roadKm += rd.length / 1000;
    roadKmAffected += rd.length / 1000 * wet / cells.length;
    roadKmHours += rd.length / 1000 * hrs / cells.length;
  });
  const metrics: Metrics = {
    rainMm: opt.storm.totalMm, rainVolume: B.rain, runoffVolume: B.rain - B.infiltrated - B.harvested,
    peakPonded, endPonded, floodedArea, maxDepth, roadKm, roadKmAffected, roadKmHours,
    buildingsAtRisk: atRisk, buildingsFlooded: flooded, residentsAffected: residents, criticalAffected: critical,
    drainSurcharge: surchargeTot, impact,
  };
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    n, nFrames: frame, frames, frameTimes, rainSeries, pondedSeries,
    ...(keep ? { live: { rainMm: rainCumSeries, wetArea: wetAreaSeries, roadKmCut: roadCutSeries, homesFlooded: homesSeries, residents: residentsSeries, drainOverflowM: overflowSeries } } : {}),
    drainCells: Int32Array.from(net.cells), drainFrames,
    maxDepth: maxD, timeOver, surcharge, doorstep, drainDown: Int32Array.from(net.cells.map(c => down[c])),
    throughVol: through, drainPeak, drainCap: Float32Array.from(cap), lakeSpill, lakeInflow,
    metrics, budget, hotspots: findHotspots(g, maxD, garden, land, doorstep, hw), cost: planCost(g, ivs), runtimeMs: now - t0,
  };
}

/** Connected waterlogged patches (> road-stop depth), ranked by harm. */
function findHotspots(g: Grid, maxD: Float32Array, garden: Uint8Array, land: Uint8Array, doorstep: Float32Array, w: Float64Array): Hotspot[] {
  const { n, nx, ny, A } = g, comp = new Int32Array(n).fill(-1), out: Hotspot[] = [];
  const hot = (i: number) => land[i] && !garden[i] && maxD[i] > DEPTH.road;
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || !hot(s)) continue;
    const id = out.length, q = [s]; comp[s] = id;
    let vol = 0, mx = 0, deep = s, harm = 0, sx = 0, sz = 0;
    const roads = new Map<number, number>(), bset = new Set<number>();
    for (let h = 0; h < q.length; h++) {
      const i = q[h], c = i % nx, r = (i / nx) | 0;
      vol += (maxD[i] - DEPTH.wet) * A; harm += w[i] * (maxD[i] - DEPTH.wet) * A;
      if (maxD[i] > mx) { mx = maxD[i]; deep = i; }
      sx += (c + 0.5) * g.dx; sz += (r + 0.5) * g.dx;
      if (g.road[i] >= 0) roads.set(g.road[i], (roads.get(g.road[i]) ?? 0) + 1);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
        const j = rr * nx + cc;
        if (g.bldg[j] >= 0) bset.add(g.bldg[j]);
        if (comp[j] < 0 && hot(j)) { comp[j] = id; q.push(j); }
      }
    }
    let rname = '';
    if (!roads.size) {   // nearest road within ~30 m of the deepest cell
      const c0 = deep % nx, r0 = (deep / nx) | 0;
      for (let rad = 1; rad <= 6 && !roads.size; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        const cc = c0 + dc, rr = r0 + dr;
        if (Math.max(Math.abs(dr), Math.abs(dc)) === rad && cc >= 0 && rr >= 0 && cc < nx && rr < ny && g.road[rr * nx + cc] >= 0) roads.set(g.road[rr * nx + cc], 1);
      }
    }
    if (roads.size) {
      const [rid] = [...roads.entries()].sort((a, b) => b[1] - a[1])[0];
      const rd = g.site.roads[rid];
      rname = rd.name || (rd.cls === 'residential' || rd.cls === 'unclassified' ? 'Residential lane' : rd.cls === 'service' ? 'Service lane' : `${rd.cls[0].toUpperCase()}${rd.cls.slice(1)} road`);
    }
    let bf = 0;
    for (const b of bset) if (doorstep[b] > g.site.buildings[b].plinth) bf++;
    out.push({ cell: deep, x: sx / q.length, z: sz / q.length, maxDepth: mx, area: q.length * A, volume: vol, road: rname || 'Open ground', buildingsFlooded: bf, impact: harm });
  }
  return out.sort((a, b) => b.impact - a.impact).slice(0, 12);
}
