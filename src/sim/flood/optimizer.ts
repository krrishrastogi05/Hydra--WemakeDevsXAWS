// HYDRA recommendation engine.
// Each round: simulate -> find harmful low spots (water above 10 cm, weighted by road class, residents and
// critical buildings) -> trace where every cell's runoff ends up (D8 + spill chains) -> score every candidate
// (roof RWH, rain garden, recharge pit, relief drain, desilting) by harmful water removed per rupee ->
// lazy-greedy picks within the round budget -> re-simulate and refine.
import { COVER } from '../types';
import type { Grid } from '../grid';
import type { Intervention, SimOptions, SimResult } from './types';
import { DEPTH, buildSurface, harmWeights, planTerrain, simulate, Heap } from './engine';
import { PARAMS, costOf, gardenFootprint, planCost, tankSize, usedCells, validate } from './model';

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Human name for where a cell is: its road, or the nearest named road within ~30 m. */
export function placeName(g: Grid, cell: number): string {
  const { nx, ny } = g, c0 = cell % nx, r0 = (cell / nx) | 0;
  for (let rad = 0; rad <= 6; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
    if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
    const c = c0 + dc, r = r0 + dr;
    if (c < 0 || r < 0 || c >= nx || r >= ny) continue;
    const rid = g.road[r * nx + c];
    if (rid >= 0) { const rd = g.site.roads[rid]; return rd.name || (rd.cls === 'service' ? 'a service lane' : 'a residential lane'); }
  }
  return 'open ground';
}

interface Ctx {
  E: Float64Array; H: Float64Array; R: Float64Array; spill: Float64Array; next: Int32Array; inflow: Float64Array;
  tgt: Int32Array; lowCell: Int32Array; through: Float32Array; lakeOf: Int32Array; nL: number;
}

function analyse(g: Grid, plan: Intervention[], res: SimResult): Ctx {
  const { n, A } = g;
  const { z } = planTerrain(g, plan);
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = g.cover[i] === COVER.BUILDING || g.blocked[i] ? 1 : 0;
  const S = buildSurface(g, z, solid), nL = S.lakes.length, hw = harmWeights(g);
  const E = new Float64Array(nL), H = new Float64Array(nL), lowCell = new Int32Array(nL);
  const tgt = new Int32Array(n).fill(-1);
  for (let k = S.order.length - 1; k >= 0; k--) {   // lowest first: a cell's runoff ends in the first low spot downhill
    const i = S.order[k];
    tgt[i] = S.lakeOf[i] >= 0 ? S.lakeOf[i] : S.rec[i] >= 0 ? tgt[S.rec[i]] : -1;
  }
  S.lakes.forEach((L, k) => { lowCell[k] = L.cells[0]; });
  for (let i = 0; i < n; i++) {   // harmful water in low spots, plus fast flows attributed to where they end
    const ex = Math.max(0, res.maxDepth[i] - DEPTH.wet) * A, L = tgt[i];
    if (ex <= 0 || L < 0) continue;
    E[L] += ex; H[L] += hw[i] * ex;
  }
  g.site.buildings.forEach((b, k) => {
    if (res.doorstep[k] <= b.plinth) return;
    let best = -1, bd = -1;
    for (const c of g.frontage[k]) if (res.maxDepth[c] > bd) { bd = res.maxDepth[c]; best = c; }
    const L = best >= 0 ? tgt[best] : -1;
    if (L >= 0) H[L] += (b.residents + 5 + (b.critical ? 25 : 0)) * (res.doorstep[k] - b.plinth) * 20;
  });
  const next = new Int32Array(nL).fill(-1);
  S.lakes.forEach((L, k) => { const r = S.rec[L.outlet]; next[k] = r >= 0 ? tgt[r] : -1; if (next[k] === k) next[k] = -1; });
  return {
    E, H, R: Float64Array.from(E), spill: Float64Array.from(res.lakeSpill.length === nL ? res.lakeSpill : new Float32Array(nL)), next,
    inflow: Float64Array.from(res.lakeInflow.length === nL ? res.lakeInflow : new Float32Array(nL)), tgt, lowCell, through: res.throughVol, lakeOf: S.lakeOf, nL,
  };
}

/** Harm avoided by removing dV m3 that would have entered low spot L. A full low spot passes its spill on first. */
function gain(ctx: Ctx, L: number, dV: number, commit: boolean) {
  let b = 0;
  for (let guard = 0; L >= 0 && dV > 1e-6 && guard < 60; guard++) {
    const sp = Math.min(dV, ctx.spill[L]), r = Math.min(dV - sp, ctx.R[L]);
    if (r > 0 && ctx.E[L] > 0) b += r * ctx.H[L] / ctx.E[L];
    if (commit) { ctx.spill[L] -= sp; ctx.R[L] -= r; }
    dV = sp; L = ctx.next[L];
  }
  return b;
}

interface Cand { iv: Intervention; cost: number; L: number; vol: number; parts?: [number, number][]; why: string }

const GARDEN_OK = new Set<number>([COVER.OPEN, COVER.GREEN, COVER.PAVED]);
const PIT_OK = new Set<number>([COVER.OPEN, COVER.GREEN, COVER.PAVED, COVER.ROAD]);
const DRAIN_OK = new Set<number>([COVER.OPEN, COVER.GREEN, COVER.PAVED, COVER.ROAD]);
const m3 = (v: number) => `${Math.round(v).toLocaleString('en-IN')} m³`;

function candidates(g: Grid, plan: Intervention[], res: SimResult, ctx: Ctx, opt: SimOptions): Cand[] {
  const { n, nx, ny, A } = g, out: Cand[] = [];
  const P = opt.storm.totalMm / 1000, Tst = opt.storm.durationMin * 60, soilF = g.site.soil.factor;
  const used = usedCells(plan), harmful = (L: number) => L >= 0 && ctx.H[L] > 0;
  const spotName = (L: number) => `the low spot on ${placeName(g, ctx.lowCell[L])}`;
  // where water from a cell ends up, and how much passes it (low spots collect their whole inflow at the bottom)
  const reach = (i: number) => { const L = ctx.lakeOf[i]; return L >= 0 && ctx.lowCell[L] === i ? ctx.inflow[L] : ctx.through[i]; };

  // rooftop RWH
  const hasRwh = new Set(plan.filter(p => p.type === 'rwh').map(p => p.building));
  g.site.buildings.forEach((b, k) => {
    if (hasRwh.has(k) || !g.bCells[k].length || !g.frontage[k].length) return;
    const roof = g.bCells[k].length * A, vol = Math.min(tankSize(roof), P * roof);
    let best = g.frontage[k][0];
    for (const c of g.frontage[k]) if (ctx.through[c] > ctx.through[best]) best = c;
    const L = ctx.tgt[best];
    if (!harmful(L)) return;
    const iv: Intervention = { id: uid('rwh'), type: 'rwh', building: k, source: 'hydra' };
    out.push({ iv, cost: costOf(g, iv), L, vol, why: `Stores the first ${m3(vol)} from a ${Math.round(roof)} m² roof that drains to ${spotName(L)}.` });
  });
  // recharge pits and rain gardens: the bottom of every harmful low spot + the busiest flow paths
  const spots = new Set<number>();
  for (let L = 0; L < ctx.nL; L++) if (harmful(L)) spots.add(ctx.lowCell[L]);
  const flowCells = [...Array(n).keys()].filter(i => harmful(ctx.tgt[i]) && ctx.lakeOf[i] < 0 && g.cover[i] !== COVER.BUILDING)
    .sort((a, b) => ctx.through[b] - ctx.through[a]).slice(0, 250);
  const pitVol = PARAMS.pitStore + PARAMS.pitRate * soilF / 1000 * Tst;
  const gardenVol = (PARAMS.gardenDepth + PARAMS.gardenMedia) * 4 * A + PARAMS.gardenExfil * soilF / 3.6e6 * Tst * 4 * A;
  for (const i of [...spots, ...flowCells]) {
    const L = ctx.tgt[i];
    if (!harmful(L) || used.has(i)) continue;
    if (PIT_OK.has(g.cover[i])) {
      const iv: Intervention = { id: uid('pit'), type: 'pit', cells: [i], source: 'hydra' }, vol = Math.min(pitVol, reach(i));
      out.push({ iv, cost: costOf(g, iv), L, vol, why: `${spots.has(i) ? 'Sits at the lowest point of' : 'Intercepts runoff heading to'} ${spotName(L)}; recharges ~${m3(vol)} into the aquifer.` });
    }
    const fp = gardenFootprint(g, i);
    if (fp.every(c => GARDEN_OK.has(g.cover[c]) && g.drain[c] < 0 && !used.has(c))) {
      const iv: Intervention = { id: uid('garden'), type: 'garden', cells: fp, source: 'hydra' }, vol = Math.min(gardenVol, reach(i));
      out.push({ iv, cost: costOf(g, iv), L, vol, why: `${spots.has(i) ? 'Turns the bottom of' : 'Catches street runoff before'} ${spotName(L)} into a rain garden that soaks up ~${m3(vol)}.` });
    }
  }
  // relief drains: from the bottom of each harmful low spot to a drain with spare capacity or an outfall, by gravity
  const lakesByHarm = [...Array(ctx.nL).keys()].filter(harmful).sort((a, b) => ctx.H[b] - ctx.H[a]).slice(0, 30);
  const drainSet = new Map<number, number>();   // existing drain cell -> its unit
  for (let i = 0; i < n; i++) if (g.drain[i] >= 0) drainSet.set(i, g.drain[i]);
  for (const L of lakesByHarm) {
    const start = ctx.lowCell[L], z0 = g.z[start], level = z0 + Math.max(0.1, ctx.E[L] > 0 ? 0.2 : 0.1);
    const dist = new Map<number, number>([[start, 0]]), prev = new Map<number, number>(), heap = new Heap();
    heap.push(0, start);
    let goal = -1, goalKind = '';
    while (heap.size) {
      const [dv, v] = heap.pop();
      if (dv > (dist.get(v) ?? Infinity)) continue;
      if (v !== start) {
        const peak = res.drainPeak[v], isExisting = drainSet.has(v);
        const edge = v % nx === 0 || v % nx === nx - 1 || ((v / nx) | 0) === 0 || ((v / nx) | 0) === ny - 1;
        const spare = peak >= 2 ? 0 : res.drainCap[v] * (1 - Math.min(1, peak));
        if (isExisting && spare >= 0.12 && g.z[v] < level && ctx.tgt[v] !== L) { goal = v; goalKind = 'drain'; break; }
        if (edge && g.z[v] <= g.edgeOutfallZ + 0.05 && g.z[v] < level) { goal = v; goalKind = 'edge'; break; }
      }
      if (dv > 100 * g.dx) continue;
      const c = v % nx, r = (v / nx) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
        const u = rr * nx + cc;
        if (!DRAIN_OK.has(g.cover[u]) || used.has(u) || g.z[u] > z0 + 0.6) continue;
        const step = (dc && dr ? Math.SQRT2 : 1) * g.dx * (g.cover[u] === COVER.ROAD ? 1 : 1.4);
        const nd = dv + step;
        if (nd < (dist.get(u) ?? Infinity)) { dist.set(u, nd); prev.set(u, v); heap.push(nd, u); }
      }
    }
    if (goal < 0) continue;
    const path: number[] = [];
    for (let v = goalKind === 'drain' ? prev.get(goal)! : goal; v !== undefined; v = prev.get(v)!) { path.push(v); if (v === start) break; }
    if (!path.length) continue;
    const spare = goalKind === 'edge' ? PARAMS.newDrainCap : Math.min(PARAMS.newDrainCap, res.drainCap[goal] * (1 - Math.min(1, res.drainPeak[goal])));
    const vol = Math.min(spare * Tst * 0.6, ctx.inflow[L]);
    const iv: Intervention = { id: uid('drain'), type: 'drain', cells: path.reverse(), source: 'hydra' };
    out.push({ iv, cost: costOf(g, iv), L, vol, why: `${path.length * g.dx} m relief drain from ${spotName(L)} to ${goalKind === 'edge' ? 'the trunk outfall at the edge of the area' : `the drain on ${placeName(g, goal)}, which still has spare capacity`}; carries ~${m3(vol)}.` });
  }
  // desilting existing drains that surcharged
  for (const [unit, cells] of g.unitCells) {
    if (plan.some(p => p.type === 'desilt' && p.unit === unit)) continue;
    const u = g.site.drains.find(d => d.id === unit);
    if (!u) continue;
    let sv = 0;
    for (const c of cells) sv += res.surcharge[c];
    if (sv < 1) continue;
    const recover = Math.min(sv, u.cap * (u.silt - PARAMS.desiltTo) * Tst * 0.5);
    const parts: [number, number][] = [];
    for (const c of cells) if (res.surcharge[c] > 0) parts.push([ctx.tgt[c], recover * res.surcharge[c] / sv]);
    const iv: Intervention = { id: uid('desilt'), type: 'desilt', unit, source: 'hydra' };
    out.push({ iv, cost: costOf(g, iv), L: -1, vol: recover, parts, why: `Desilting the ${Math.round(cells.length * g.dx)} m drain along ${placeName(g, cells[0])} stops ~${m3(recover)} of the ${m3(sv)} it overflowed onto the street.` });
  }
  return out.filter(c => c.cost > 0 && c.vol > 0.5);
}

const candGain = (ctx: Ctx, c: Cand, commit: boolean) => c.parts ? c.parts.reduce((s, [L, v]) => s + gain(ctx, L, v, commit), 0) : gain(ctx, c.L, c.vol, commit);

export interface OptimizeOptions extends SimOptions { budget: number; base?: Intervention[]; rounds?: number; onProgress?: (p: number, msg: string) => void }

/** Spend the budget where it removes the most harmful water per rupee. Returns the plan (base + picks) and its simulation. */
export function optimize(g: Grid, opt: OptimizeOptions): { plan: Intervention[]; result: SimResult; rounds: number[] } {
  const rounds = opt.rounds ?? 6, plan = [...(opt.base ?? [])];
  const simOpt: SimOptions = { ...opt, keepFrames: false };
  const impacts: number[] = [];
  let res = simulate(g, plan, simOpt);
  impacts.push(res.metrics.impact);
  let best = { len: plan.length, res, impact: res.metrics.impact };
  for (let r = 0; r < rounds; r++) {
    const left = opt.budget - planCost(g, plan);
    if (left < 20000) break;
    const roundBudget = r >= 2 ? left : left * (r === 0 ? 0.5 : 0.65);
    opt.onProgress?.((r + 0.2) / rounds, `Round ${r + 1}: tracing runoff to ${res.hotspots.length} waterlogging spots`);
    const ctx = analyse(g, plan, res), cands = candidates(g, plan, res, ctx, opt);
    const heap = new Heap();   // min-heap on -ratio
    cands.forEach((c, k) => heap.push(-candGain(ctx, c, false) / c.cost, k));
    let spent = 0;
    while (heap.size) {
      const [negRatio, k] = heap.pop(), c = cands[k];
      const ratio = candGain(ctx, c, false) / c.cost;   // lazy re-evaluation: earlier picks reduce what is left to fix
      if (ratio <= 1e-9) continue;
      if (heap.size && ratio < -heap.k[0] - 1e-12 && ratio < -negRatio - 1e-12) { heap.push(-ratio, k); continue; }
      if (spent + c.cost > roundBudget) continue;
      if (validate(g, c.iv, plan)) continue;
      candGain(ctx, c, true);
      plan.push({ ...c.iv, reason: c.why });
      spent += c.cost;
    }
    if (!spent) break;   // nothing cost-effective left
    opt.onProgress?.((r + 0.8) / rounds, `Round ${r + 1}: re-simulating the storm with ${plan.length} interventions`);
    res = simulate(g, plan, simOpt);
    impacts.push(res.metrics.impact);
    if (res.metrics.impact >= best.impact) { plan.length = best.len; res = best.res; break; }   // this round did not help: keep the best plan
    best = { len: plan.length, res, impact: res.metrics.impact };
    if (opt.budget - planCost(g, plan) < opt.budget * 0.04) break;
  }
  return { plan, result: res, rounds: impacts };
}

function rng(seed: number) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** "No data" plan: the same budget split evenly across four types, placed at random valid spots. */
export function evenSpread(g: Grid, budget: number, seed: number): Intervention[] {
  const R = rng(seed), plan: Intervention[] = [], share = budget / 4, { n } = g;
  const spend = (make: () => Intervention | null, tries = 4000) => {
    let used = 0;
    for (let t = 0; t < tries; t++) {
      const iv = make();
      if (!iv || validate(g, iv, plan)) continue;
      const c = costOf(g, iv);
      if (used + c > share) { if (used > share * 0.8) break; continue; }
      plan.push(iv); used += c;
    }
  };
  const pick = <T,>(arr: T[]) => arr[Math.floor(R() * arr.length)];
  const roadCells = [...Array(n).keys()].filter(i => g.cover[i] === COVER.ROAD);
  spend(() => ({ id: uid('rwh'), type: 'rwh', building: Math.floor(R() * g.site.buildings.length), source: 'spread' }));
  spend(() => ({ id: uid('garden'), type: 'garden', cells: gardenFootprint(g, Math.floor(R() * n)), source: 'spread' }));
  spend(() => ({ id: uid('pit'), type: 'pit', cells: [Math.floor(R() * n)], source: 'spread' }));
  spend(() => {   // a straight 30 m drain along a random road
    const s = pick(roadCells), dir = pick([1, -1, g.nx, -g.nx]), cells: number[] = [];
    for (let k = 0, c = s; k < 6; k++, c += dir) { if (c < 0 || c >= n || g.cover[c] !== COVER.ROAD || (Math.abs(dir) === 1 && Math.floor(c / g.nx) !== Math.floor(s / g.nx))) break; cells.push(c); }
    return cells.length >= 4 ? { id: uid('drain'), type: 'drain', cells, source: 'spread' } : null;
  }, 400);
  return plan;
}
