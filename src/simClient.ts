// Promise wrapper around the engine workers. "sim" answers quick storm runs; "opt" does the heavy optimisation,
// so the user can keep exploring while a recommendation is computed.
import type { Intervention, Metrics, SimOptions, SimResult, SiteData } from './sim/types';

type Progress = (p: number, msg: string) => void;
function makeWorker() {
  const w = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: Progress }>();
  let seq = 0;
  w.onmessage = e => {
    const m = e.data, p = pending.get(m.id);
    if (!p) return;
    if ('progress' in m) { p.onProgress?.(m.progress, m.msg); return; }
    pending.delete(m.id);
    if (m.ok) p.resolve(m.data); else p.reject(new Error(m.error));
  };
  return <T>(msg: Record<string, unknown>, onProgress?: Progress) => new Promise<T>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    w.postMessage({ ...msg, id });
  });
}
const sim = makeWorker(), opt = makeWorker();

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
