/// <reference lib="webworker" />
// Runs the heat engine off the main thread. Requests: load | simulate | optimize | showdown. Independent of the flood worker.
import { loadGrid, type Grid } from '../grid';
import type { SiteData } from '../types';
import { simulateHeat } from './engine';
import { heatPlanCost } from './model';
import { heatEvenSpread, optimizeHeat } from './optimizer';
import type { HeatIntervention, HeatOptions, HeatResult, HeatSite } from './types';

let grid: Grid | null = null, heat: HeatSite | null = null;
const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const buffers = (r: HeatResult) => [r.frames, r.sunFrac, r.sunHours, r.surface, r.exposure, r.weight]
  .filter((a): a is NonNullable<typeof a> => !!a).map(a => a.buffer as ArrayBuffer);

self.onmessage = (e: MessageEvent) => {
  const { id, kind } = e.data as { id: number; kind: string };
  try {
    if (kind === 'load') { grid = loadGrid(e.data.site as SiteData); heat = e.data.heat as HeatSite; post({ id, ok: true }); return; }
    if (!grid || !heat) throw new Error('No site loaded');
    const opts = e.data.opts as HeatOptions;
    if (kind === 'simulate') {
      const r = simulateHeat(grid, heat, e.data.plan as HeatIntervention[], opts);
      post({ id, ok: true, data: r }, buffers(r));
    } else if (kind === 'optimize') {
      const o = optimizeHeat(grid, heat, { ...opts, budget: e.data.budget, base: e.data.base, onProgress: (p, msg) => post({ id, progress: p, msg }) });
      post({ id, ok: true, data: { plan: o.plan, metrics: o.result.metrics, cost: heatPlanCost(grid, o.plan) } });
    } else if (kind === 'showdown') {
      const budget = e.data.budget as number, quick = { ...opts, keepFrames: false };
      post({ id, progress: 0.02, msg: 'Tracing the sun with no action' });
      const base = simulateHeat(grid, heat, [], quick).metrics;
      const spreads = [1, 2, 3].map((seed, k) => {
        post({ id, progress: 0.06 + k * 0.1, msg: `Even spread, random plan ${k + 1} of 3` });
        const plan = heatEvenSpread(grid!, heat!, budget, seed);
        return { plan, cost: heatPlanCost(grid!, plan), metrics: simulateHeat(grid!, heat!, plan, quick).metrics };
      });
      const o = optimizeHeat(grid, heat, { ...opts, budget, onProgress: (p, msg) => post({ id, progress: 0.36 + p * 0.62, msg: `HYDRA · ${msg}` }) });
      post({ id, ok: true, data: { budget, base, spreads, hydra: { plan: o.plan, cost: heatPlanCost(grid, o.plan), metrics: o.result.metrics } } });
    }
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
