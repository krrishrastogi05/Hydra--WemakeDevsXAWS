// Promise wrappers around the engine workers. Flood and heat each have their own workers and never share state.
// "sim" answers quick runs; "opt" does the heavy optimisation, so the user can keep exploring meanwhile.
import type { SiteData } from './sim/types';
import type { Intervention, Metrics, SimOptions, SimResult } from './sim/flood/types';
import type { HeatIntervention, HeatMetrics, HeatOptions, HeatResult, HeatSite } from './sim/heat/types';

type Progress = (p: number, msg: string) => void;
function makeWorker(create: () => Worker) {
  let w: Worker | null = null;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: Progress }>();
  let seq = 0;
  const get = () => {
    if (w) return w;
    w = create();
    w.onmessage = e => {
      const m = e.data, p = pending.get(m.id);
      if (!p) return;
      if ('progress' in m) { p.onProgress?.(m.progress, m.msg); return; }
      pending.delete(m.id);
      if (m.ok) p.resolve(m.data); else p.reject(new Error(m.error));
    };
    return w;
  };
  return <T>(msg: Record<string, unknown>, onProgress?: Progress) => new Promise<T>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    get().postMessage({ ...msg, id });
  });
}

// ---------- flood ----------
const sim = makeWorker(() => new Worker(new URL('./sim/flood/worker.ts', import.meta.url), { type: 'module' }));
const opt = makeWorker(() => new Worker(new URL('./sim/flood/worker.ts', import.meta.url), { type: 'module' }));

export interface OptimizeResult { plan: Intervention[]; metrics: Metrics; cost: number; rounds: number[] }
export interface ShowdownResult {
  budget: number; base: Metrics;
  spreads: { plan: Intervention[]; cost: number; metrics: Metrics }[];
  hydra: { plan: Intervention[]; cost: number; metrics: Metrics };
}
export const engine = {
  load: (site: SiteData) => Promise.all([sim({ kind: 'load', site }), opt({ kind: 'load', site })]),
  simulate: (plan: Intervention[], opts: SimOptions) => sim<SimResult>({ kind: 'simulate', plan, opts }),
  optimize: (budget: number, base: Intervention[], opts: SimOptions, onProgress?: Progress) => opt<OptimizeResult>({ kind: 'optimize', budget, base, opts }, onProgress),
  showdown: (budget: number, opts: SimOptions, onProgress?: Progress) => opt<ShowdownResult>({ kind: 'showdown', budget, opts }, onProgress),
};

// ---------- heat (workers start the first time heat mode is opened) ----------
const hsim = makeWorker(() => new Worker(new URL('./sim/heat/worker.ts', import.meta.url), { type: 'module' }));
const hopt = makeWorker(() => new Worker(new URL('./sim/heat/worker.ts', import.meta.url), { type: 'module' }));

export interface HeatOptimizeResult { plan: HeatIntervention[]; metrics: HeatMetrics; cost: number }
export interface HeatShowdownResult {
  budget: number; base: HeatMetrics;
  spreads: { plan: HeatIntervention[]; cost: number; metrics: HeatMetrics }[];
  hydra: { plan: HeatIntervention[]; cost: number; metrics: HeatMetrics };
}
export const heatEngine = {
  load: (site: SiteData, heat: HeatSite) => Promise.all([hsim({ kind: 'load', site, heat }), hopt({ kind: 'load', site, heat })]),
  simulate: (plan: HeatIntervention[], opts: HeatOptions) => hsim<HeatResult>({ kind: 'simulate', plan, opts }),
  optimize: (budget: number, base: HeatIntervention[], opts: HeatOptions, onProgress?: Progress) => hopt<HeatOptimizeResult>({ kind: 'optimize', budget, base, opts }, onProgress),
  showdown: (budget: number, opts: HeatOptions, onProgress?: Progress) => hopt<HeatShowdownResult>({ kind: 'showdown', budget, opts }, onProgress),
};
