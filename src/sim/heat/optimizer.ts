// HYDRA heat recommendation engine.
// Objective: total footfall-weighted exposure (sum over pedestrian cells of weight × index) under the chosen weather
// and hours. Candidates are street trees near the hottest busy cells and shade canopies at bus stops, markets and gates.
// Lazy greedy by exposure removed per rupee; each candidate's gain is re-traced against the *current* shade field
// (so two trees shading the same footpath are not double counted), and the state is updated exactly after each pick.
import { COVER } from '../types';
import type { Grid } from '../grid';
import { HEAT_CATALOG, HEAT_PARAMS as P, STEP_H, heatCostOf, heatPlanCost, occupiedCells, validateHeat } from './model';
import { applyIntervention, buildObstacles, sunRay, transmit, type Obstacles } from './shadow';
import { ambientTerm, cellIndex, inWindow, pedestrianWeights, simulateHeat, sunSteps, windFactor } from './engine';
import { heatIndexC } from './solar';
import type { HeatIntervention, HeatOptions, HeatResult, HeatSite } from './types';

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** A readable name for a cell: the pedestrian place it belongs to, else the nearest named street. */
export function heatPlaceName(g: Grid, hs: HeatSite, cell: number): string {
  for (const r of hs.receptors) if (r.cells.includes(cell)) return r.name;
  const c0 = cell % g.nx, r0 = (cell / g.nx) | 0;
  for (let rad = 0; rad <= 8; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
    if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
    const c = c0 + dc, r = r0 + dr;
    if (c < 0 || r < 0 || c >= g.nx || r >= g.ny) continue;
    const rd = g.road[r * g.nx + c];
    if (rd >= 0 && g.site.roads[rd].name) return g.site.roads[rd].name;
  }
  return 'a local lane';
}

interface State {
  o: Obstacles; w: Float32Array; steps: { k: number; dc: number; dr: number; slope: number; dni: number }[];
  T: Float32Array[]; dose: Float32Array; index: Float32Array; avail: number; hours: number; amb: number; wf: number; reach: number;
}

function initState(g: Grid, hs: HeatSite, plan: HeatIntervention[], opt: HeatOptions): State {
  const o = buildObstacles(g, hs, plan), w = pedestrianWeights(g, hs);
  const all = sunSteps(g, opt.scenario), steps = all.map((s, k) => ({ s, k })).filter(({ s }) => inWindow(s, opt.window) && s.dni > 0)
    .map(({ s, k }) => ({ k, ...sunRay(s.elev, s.az), dni: s.dni }));
  const avail = steps.reduce((a, s) => a + s.dni * STEP_H, 0), hours = all.filter(s => inWindow(s, opt.window)).length * STEP_H;
  const T = steps.map(() => new Float32Array(g.n)), dose = new Float32Array(g.n), index = new Float32Array(g.n);
  const amb = ambientTerm(heatIndexC(opt.scenario.tempC, opt.scenario.rh)), wf = windFactor(opt.scenario.windMs);
  for (let i = 0; i < g.n; i++) {
    if (g.cover[i] === COVER.BUILDING) continue;
    steps.forEach((s, k) => { const t = transmit(g, o, i, s.dc, s.dr, s.slope); T[k][i] = t; dose[i] += t * s.dni * STEP_H; });
    if (w[i] > 0) index[i] = cellIndex(g, o, i, dose[i], avail, hours, amb, wf).index;
  }
  // how far (cells) a new tree's shadow can reach in this window
  const minSlope = Math.min(...steps.map(s => s.slope), 10);
  const reach = Math.min(12, Math.ceil((P.newTree.h - P.personHeight) / Math.max(0.15, minSlope) / g.dx) + 1);
  return { o, w, steps, T, dose, index, avail, hours, amb, wf, reach };
}

/** Cells whose shade or surface an intervention can change. */
function footprint(g: Grid, iv: HeatIntervention, reach: number) {
  const out: number[] = [], seen = new Set<number>();
  for (const c of iv.cells ?? []) {
    const c0 = c % g.nx, r0 = (c / g.nx) | 0;
    for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
      const cc = c0 + dc, rr = r0 + dr, j = rr * g.nx + cc;
      if (cc < 0 || rr < 0 || cc >= g.nx || rr >= g.ny || seen.has(j) || g.cover[j] === COVER.BUILDING) continue;
      seen.add(j); out.push(j);
    }
  }
  return out;
}

/** Exposure removed (sum of weight × index) if `iv` were added to the current state, with the new per-cell values.
 *  The candidate is applied to the shared shade field, traced, then rolled back. */
function evaluate(g: Grid, st: State, iv: HeatIntervention) {
  const o = st.o, touched = footprint(g, iv, 1), saved = touched.map(j => [o.canBase[j], o.canTop[j], o.canTrans[j], o.treeCov[j]]), maxTop = o.maxTop;
  const covBefore = new Map(touched.map((j, k) => [j, saved[k][3]]));
  applyIntervention(g, o, iv);
  let gain = 0, hoursCut = 0, cellsCut = 0, area = 0;
  const upd: { i: number; T: number[]; dose: number; index: number }[] = [];
  for (const i of footprint(g, iv, st.reach)) {
    let dose = st.dose[i], changed = false, cut = 0;
    const Ts = st.steps.map((s, k) => {
      const t = transmit(g, o, i, s.dc, s.dr, s.slope);
      if (t !== st.T[k][i]) { changed = true; dose += (t - st.T[k][i]) * s.dni * STEP_H; if (st.T[k][i] > 0.5 && t <= 0.5) cut += STEP_H; }
      return t;
    });
    if (!changed && (covBefore.get(i) ?? o.treeCov[i]) === o.treeCov[i]) continue;
    const index = st.w[i] > 0 ? cellIndex(g, o, i, dose, st.avail, st.hours, st.amb, st.wf).index : 0;
    gain += st.w[i] * (st.index[i] - index);
    if (st.w[i] > 0 && st.index[i] - index > 0.5) area += g.A;
    if (st.w[i] > 0 && cut > 0) { hoursCut += cut; cellsCut++; }
    upd.push({ i, T: Ts, dose, index });
  }
  touched.forEach((j, k) => { [o.canBase[j], o.canTop[j], o.canTrans[j], o.treeCov[j]] = saved[k]; });
  o.maxTop = maxTop;
  return { gain, upd, hoursCut: cellsCut ? hoursCut / cellsCut : 0, area };
}

export interface HeatOptimizeOptions extends HeatOptions { budget: number; base?: HeatIntervention[]; onProgress?: (p: number, msg: string) => void }

export function optimizeHeat(g: Grid, hs: HeatSite, opt: HeatOptimizeOptions): { plan: HeatIntervention[]; result: HeatResult } {
  const base = opt.base ?? [], plan = [...base];
  let left = opt.budget - base.reduce((a, iv) => a + heatCostOf(g, iv), 0);
  opt.onProgress?.(0.05, 'Tracing the sun across the neighbourhood');
  const st = initState(g, hs, plan, { ...opt, keepFrames: false });

  // candidates near the heaviest heat burden (weight × index)
  opt.onProgress?.(0.15, 'Finding the hottest busy places');
  const burden = [...Array(g.n).keys()].filter(i => st.w[i] >= 0.8).sort((a, b) => st.w[b] * st.index[b] - st.w[a] * st.index[a]).slice(0, 260);
  const occupied = occupiedCells(hs, plan), cands: HeatIntervention[] = [], seen = new Set<string>();
  const push = (iv: HeatIntervention) => {
    const key = `${iv.type}${iv.cells![0]}`;
    if (seen.has(key) || validateHeat(g, hs, iv, plan)) return;
    seen.add(key); cands.push(iv);
  };
  for (const i of burden) {
    const c0 = i % g.nx, r0 = (i / g.nx) | 0;
    for (const [dc, dr] of [[0, 0], ...N8]) {
      const cc = c0 + dc, rr = r0 + dr;
      if (cc < 0 || rr < 0 || cc >= g.nx || rr >= g.ny) continue;
      const j = rr * g.nx + cc;
      if (!occupied.has(j)) push({ id: '', type: 'tree', cells: [j] });
    }
  }
  for (const r of hs.receptors) if (r.kind !== 'public_space') for (const c of r.cells) if (!occupied.has(c) && st.w[c] > 0) push({ id: '', type: 'canopy', cells: [c] });

  // lazy greedy on exposure removed per rupee
  opt.onProgress?.(0.25, `Scoring ${cands.length} candidate trees and canopies`);
  type Q = { iv: HeatIntervention; ratio: number; stamp: number };
  let stamp = 0;
  const queue: Q[] = cands.map(iv => ({ iv, ratio: evaluate(g, st, iv).gain / heatCostOf(g, iv), stamp: 0 })).filter(q => q.ratio > 0);
  const budget0 = Math.max(1, left);
  while (queue.length) {
    queue.sort((a, b) => b.ratio - a.ratio);
    const top = queue.shift()!, cost = heatCostOf(g, top.iv);
    if (cost > left) continue;
    if (validateHeat(g, hs, top.iv, plan)) continue;
    if (top.stamp !== stamp) {   // stale: re-trace against the current shade
      const r = evaluate(g, st, top.iv);
      top.ratio = r.gain / cost; top.stamp = stamp;
      if (top.ratio > 0) queue.push(top);
      continue;
    }
    const r = evaluate(g, st, top.iv);
    if (r.gain <= 0) continue;
    // accept: commit the new shade and indices
    applyIntervention(g, st.o, top.iv);
    for (const u of r.upd) { u.T.forEach((t, k) => { st.T[k][u.i] = t; }); st.dose[u.i] = u.dose; st.index[u.i] = u.index; }
    const place = heatPlaceName(g, hs, top.iv.cells![0]);
    const iv: HeatIntervention = {
      ...top.iv, id: uid('h'), source: 'hydra',
      reason: `${top.iv.type === 'canopy' ? 'Shelters people waiting at' : 'Shades the busy stretch at'} ${place}: ${Math.round(r.area)} m² of pedestrian space gets cooler, ` +
        `${r.hoursCut > 0 ? `up to ${r.hoursCut.toFixed(1)} h less direct sun in the ${opt.window.name.toLowerCase()}. ` : ''}` +
        `${HEAT_CATALOG[top.iv.type].short} removes ${Math.round(r.gain)} exposure points per ₹${Math.round(cost / 1000)}k, the best value left.`,
    };
    plan.push(iv); left -= cost; stamp++;
    opt.onProgress?.(0.25 + 0.7 * Math.min(1, 1 - left / budget0), `Picked ${plan.length - base.length}: ${HEAT_CATALOG[iv.type].short.toLowerCase()} at ${place}`);
    if (left < 12000) break;
  }
  opt.onProgress?.(0.97, 'Re-running the full sun path with the plan');
  return { plan, result: simulateHeat(g, hs, plan, { ...opt, keepFrames: false }) };
}

type Progress = (p: number, msg: string) => void;

/** HYDRA's shade recommendation for a budget, as the panels show it. Used by the Web Worker and the API alike. */
export function recommendHeat(g: Grid, hs: HeatSite, opts: HeatOptions, budget: number, base: HeatIntervention[], onProgress?: Progress) {
  const o = optimizeHeat(g, hs, { ...opts, budget, base, onProgress });
  return { plan: o.plan, metrics: o.result.metrics, cost: heatPlanCost(g, o.plan) };
}

/** Budget showdown: no action vs three even-spread shade plans vs HYDRA's plan, on the same day and budget. */
export function showdownHeat(g: Grid, hs: HeatSite, opts: HeatOptions, budget: number, onProgress?: Progress) {
  const quick = { ...opts, keepFrames: false };
  onProgress?.(0.02, 'Tracing the sun with no action');
  const base = simulateHeat(g, hs, [], quick).metrics;
  const spreads = [1, 2, 3].map((seed, k) => {
    onProgress?.(0.06 + k * 0.1, `Even spread, random plan ${k + 1} of 3`);
    const plan = heatEvenSpread(g, hs, budget, seed);
    return { plan, cost: heatPlanCost(g, plan), metrics: simulateHeat(g, hs, plan, quick).metrics };
  });
  const o = optimizeHeat(g, hs, { ...opts, budget, onProgress: (p, msg) => onProgress?.(0.36 + p * 0.62, `HYDRA · ${msg}`) });
  return { budget, base, spreads, hydra: { plan: o.plan, cost: heatPlanCost(g, o.plan), metrics: o.result.metrics } };
}

/** The same money spread evenly: trees and canopies at random pedestrian spots, ignoring where the heat is. */
export function heatEvenSpread(g: Grid, hs: HeatSite, budget: number, seed: number): HeatIntervention[] {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const w = pedestrianWeights(g, hs), plan: HeatIntervention[] = [];
  const treeSpots = [...Array(g.n).keys()].filter(i => (g.cover[i] === COVER.OPEN || g.cover[i] === COVER.PAVED || g.cover[i] === COVER.GREEN) && w[i] > 0);
  const shadeSpots = [...Array(g.n).keys()].filter(i => g.cover[i] === COVER.ROAD && w[i] > 0);
  let left = budget, tries = 0;
  for (const type of ['canopy', 'tree'] as const) {
    let share = type === 'canopy' ? budget * 0.5 : left;
    while (share >= heatCostOf(g, { id: '', type, cells: [0] }) && tries++ < 5000) {
      const pool = type === 'tree' ? treeSpots : shadeSpots, c = pool[Math.floor(rnd() * pool.length)];
      const iv: HeatIntervention = { id: uid('s'), type, cells: [c], source: 'spread' };
      if (validateHeat(g, hs, iv, plan)) continue;
      const cost = heatCostOf(g, iv);
      plan.push(iv); share -= cost; left -= cost;
    }
  }
  return plan;
}
