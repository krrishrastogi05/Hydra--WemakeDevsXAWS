// The engine, as promises. When the HYDRA API is up, every run is calculated by it (backend /calc routes, on AWS Lambda
// when deployed); without an API, or if a call fails, the same engine runs here in Web Workers. Each result says where
// it was calculated.
// Flood and heat each have their own workers and never share state. "sim" answers quick runs; "opt" does the heavy
// optimisation, so the user can keep exploring meanwhile.
import { apiRegion, calcOnServer, useBackend } from './api';
import type { CalcSource, FloodCalc, HeatCalc, HeatOptimizeResult, HeatShowdownResult, OptimizeResult, ShowdownResult } from './shared/calc';
import type { SiteData } from './sim/types';
import type { Intervention, SimOptions, SimResult } from './sim/flood/types';
import type { HeatIntervention, HeatOptions, HeatResult, HeatSite } from './sim/heat/types';

export type { HeatOptimizeResult, HeatShowdownResult, OptimizeResult, ShowdownResult } from './shared/calc';

type Progress = (p: number, msg: string) => void;   // p < 0: no measure of progress (a call to the API)
const SERVER = apiRegion ? 'AWS Lambda' : 'the HYDRA API';
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

/** Runs `remote` on the API when it is up, else (or when it fails) `local` in this browser, and tags the result. */
async function either<T extends { source?: CalcSource }>(remote: () => Promise<T>, local: () => Promise<T>): Promise<T> {
  if (useBackend.getState().status === 'up') {
    try { return Object.assign(await remote(), { source: 'server' as const }); }
    catch (e) { console.warn('HYDRA API could not calculate this, so it runs in the browser instead:', (e as Error).message); }
  }
  return Object.assign(await local(), { source: 'browser' as const });
}

// ---------- flood ----------
const sim = makeWorker(() => new Worker(new URL('./sim/flood/worker.ts', import.meta.url), { type: 'module' }));
const opt = makeWorker(() => new Worker(new URL('./sim/flood/worker.ts', import.meta.url), { type: 'module' }));
let floodSite = '';
const floodCalc = (plan: Intervention[], opts: SimOptions, budget?: number): FloodCalc =>
  ({ siteId: floodSite, stormId: opts.storm.id, antecedent: opts.antecedent, plan, ...(budget != null ? { budget } : {}) });

export const engine = {
  load: (site: SiteData) => { floodSite = site.id; return Promise.all([sim({ kind: 'load', site }), opt({ kind: 'load', site })]); },
  simulate: (plan: Intervention[], opts: SimOptions) => either(
    () => calcOnServer<SimResult>('flood', 'simulate', floodCalc(plan, opts)),
    () => sim<SimResult>({ kind: 'simulate', plan, opts })),
  optimize: (budget: number, base: Intervention[], opts: SimOptions, onProgress?: Progress) => either(
    () => { onProgress?.(-1, `HYDRA is planning on ${SERVER}…`); return calcOnServer<OptimizeResult>('flood', 'optimize', floodCalc(base, opts, budget)); },
    () => opt<OptimizeResult>({ kind: 'optimize', budget, base, opts }, onProgress)),
  showdown: (budget: number, opts: SimOptions, onProgress?: Progress) => either(
    () => { onProgress?.(-1, `Running the showdown on ${SERVER}…`); return calcOnServer<ShowdownResult>('flood', 'showdown', floodCalc([], opts, budget)); },
    () => opt<ShowdownResult>({ kind: 'showdown', budget, opts }, onProgress)),
};

// ---------- heat (workers start the first time heat mode is opened) ----------
const hsim = makeWorker(() => new Worker(new URL('./sim/heat/worker.ts', import.meta.url), { type: 'module' }));
const hopt = makeWorker(() => new Worker(new URL('./sim/heat/worker.ts', import.meta.url), { type: 'module' }));
let heatSite = '';
const heatCalc = (plan: HeatIntervention[], opts: HeatOptions, budget?: number): HeatCalc =>
  ({ siteId: heatSite, scenarioId: opts.scenario.id, windowId: opts.window.id, plan, ...(budget != null ? { budget } : {}) });

export const heatEngine = {
  load: (site: SiteData, heat: HeatSite) => { heatSite = site.id; return Promise.all([hsim({ kind: 'load', site, heat }), hopt({ kind: 'load', site, heat })]); },
  simulate: (plan: HeatIntervention[], opts: HeatOptions) => either(
    () => calcOnServer<HeatResult>('heat', 'simulate', heatCalc(plan, opts)),
    () => hsim<HeatResult>({ kind: 'simulate', plan, opts })),
  optimize: (budget: number, base: HeatIntervention[], opts: HeatOptions, onProgress?: Progress) => either(
    () => { onProgress?.(-1, `HYDRA is planning shade on ${SERVER}…`); return calcOnServer<HeatOptimizeResult>('heat', 'optimize', heatCalc(base, opts, budget)); },
    () => hopt<HeatOptimizeResult>({ kind: 'optimize', budget, base, opts }, onProgress)),
  showdown: (budget: number, opts: HeatOptions, onProgress?: Progress) => either(
    () => { onProgress?.(-1, `Running the showdown on ${SERVER}…`); return calcOnServer<HeatShowdownResult>('heat', 'showdown', heatCalc([], opts, budget)); },
    () => hopt<HeatShowdownResult>({ kind: 'showdown', budget, opts }, onProgress)),
};
