/// <reference lib="webworker" />
// Runs the engine off the main thread. Requests: load | simulate | optimize | showdown.
import { loadGrid, planCost, type Grid } from './model';
import { simulate } from './engine';
import { evenSpread, optimize } from './optimizer';
import type { Intervention, SimOptions, SimResult, SiteData } from './types';

let grid: Grid | null = null;
const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const buffers = (r: SimResult) => [r.frames, r.drainFrames, r.maxDepth, r.timeOver, r.surcharge, r.doorstep, r.throughVol, r.drainPeak, r.drainCap]
  .filter((a): a is NonNullable<typeof a> => !!a).map(a => a.buffer as ArrayBuffer);

self.onmessage = (e: MessageEvent) => {
  const { id, kind } = e.data as { id: number; kind: string };
  try {
    if (kind === 'load') { grid = loadGrid(e.data.site as SiteData); post({ id, ok: true }); return; }
    if (!grid) throw new Error('No site loaded');
    const opts = e.data.opts as SimOptions;
    if (kind === 'simulate') {
      const r = simulate(grid, e.data.plan as Intervention[], opts);
      post({ id, ok: true, data: r }, buffers(r));
    } else if (kind === 'optimize') {
      const o = optimize(grid, { ...opts, budget: e.data.budget, base: e.data.base, onProgress: (p, msg) => post({ id, progress: p, msg }) });
      post({ id, ok: true, data: { plan: o.plan, metrics: o.result.metrics, cost: planCost(grid, o.plan), rounds: o.rounds } });
    } else if (kind === 'showdown') {
      const budget = e.data.budget as number, quick = { ...opts, keepFrames: false };
      post({ id, progress: 0.02, msg: 'Simulating the neighbourhood with no action' });
      const base = simulate(grid, [], quick).metrics;
      const spreads = [1, 2, 3].map((seed, k) => {
        post({ id, progress: 0.06 + k * 0.1, msg: `Even spread, random plan ${k + 1} of 3` });
        const plan = evenSpread(grid!, budget, seed);
        return { plan, cost: planCost(grid!, plan), metrics: simulate(grid!, plan, quick).metrics };
      });
      const o = optimize(grid, { ...opts, budget, onProgress: (p, msg) => post({ id, progress: 0.36 + p * 0.62, msg: `HYDRA · ${msg}` }) });
      post({ id, ok: true, data: { budget, base, spreads, hydra: { plan: o.plan, cost: planCost(grid, o.plan), metrics: o.result.metrics } } });
    }
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
