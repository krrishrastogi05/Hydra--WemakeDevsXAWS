// App state (zustand). The UI never computes hydrology: every number comes from an engine result in here.
import { create } from 'zustand';
import { engine, type OptimizeResult, type ShowdownResult } from './simClient';
import { loadGrid, type Grid } from './sim/grid';
import { CATALOG, STORMS, costOf, gardenFootprint, planCost, validate } from './sim/flood/model';
import type { SiteData, SiteSummary } from './sim/types';
import type { Antecedent, Intervention, InterventionType, SimOptions, SimResult } from './sim/flood/types';
import type { HeatInterventionType } from './sim/heat/types';

// Two modes share the neighbourhood, camera, tools rail and panels; their engines, plans and results are separate
// (flood state lives here, heat state in heatStore.ts).
export type Mode = 'flood' | 'heat';
export type Tool = 'inspect' | InterventionType | HeatInterventionType | 'erase';
export type Panel = 'results' | 'plan' | 'recommend' | 'showdown' | 'about';
export type Selection = { kind: 'cell'; cell: number } | { kind: 'building'; building: number } | null;

interface State {
  mode: Mode; setMode: (m: Mode) => void;
  sites: SiteSummary[]; siteId: string; site: SiteData | null; grid: Grid | null; loading: string | null; error: string | null;
  stormId: string; antecedent: Antecedent; budget: number;
  plan: Intervention[]; undoStack: Intervention[][];
  tool: Tool; hover: { cell: number; building: number } | null; selection: Selection; draft: number[] | null;
  baseline: SimResult | null; current: SimResult | null; currentKey: string; running: boolean;
  view: 'plan' | 'baseline'; peak: boolean; time: number; playing: boolean; speed: number;
  overlay: 'none' | 'risk' | 'sources'; showLabels: boolean; showDrains: boolean;
  panel: Panel; busy: { p: number; msg: string } | null;
  recommendation: OptimizeResult | null; showdown: ShowdownResult | null;
  toast: { msg: string; kind: 'info' | 'error' } | null; flyTo: { x: number; z: number; t: number } | null;
  onboarding: boolean;
  // actions
  init: () => Promise<void>;
  loadSite: (id: string) => Promise<void>;
  setStorm: (id: string) => void; setAntecedent: (a: Antecedent) => void; setBudget: (b: number) => void;
  runBaseline: () => Promise<void>; runPlan: (autoplay?: boolean) => Promise<void>;
  add: (iv: Omit<Intervention, 'id'>) => boolean; remove: (id: string) => void; undo: () => void; clearPlan: () => void;
  setPlan: (plan: Intervention[]) => void;
  recommend: (mode: 'fresh' | 'fill') => Promise<void>; runShowdown: () => Promise<void>;
  notify: (msg: string, kind?: 'info' | 'error') => void;
  set: (p: Partial<State>) => void;
}

export const planKey = (plan: Intervention[]) => plan.map(p => p.id).join('|');
export const simOptions = (s: Pick<State, 'stormId' | 'antecedent'>, keepFrames = true): SimOptions =>
  ({ storm: STORMS.find(x => x.id === s.stormId) ?? STORMS[0], antecedent: s.antecedent, keepFrames, recessionMin: 60, frameEveryMin: 2 });
let ivSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const modeFromUrl = (): Mode => (location.hash.split('/')[1] === 'heat' || new URLSearchParams(location.search).get('mode') === 'heat' ? 'heat' : 'flood');
const writeHash = (id: string, mode: Mode) => history.replaceState(null, '', `#${id}${mode === 'heat' ? '/heat' : ''}`);

export const useStore = create<State>((set, get) => ({
  mode: modeFromUrl(),
  setMode: mode => {
    if (mode === get().mode) return;
    set({ mode, tool: 'inspect', draft: null, selection: null, hover: null, playing: false });
    writeHash(get().siteId, mode);
  },
  sites: [], siteId: 'gurugram', site: null, grid: null, loading: 'Loading HYDRA…', error: null,
  stormId: 'heavy', antecedent: 'normal', budget: 50e5,
  plan: [], undoStack: [],
  tool: 'inspect', hover: null, selection: null, draft: null,
  baseline: null, current: null, currentKey: '', running: false,
  view: 'baseline', peak: true, time: 0, playing: false, speed: 1,
  overlay: 'none', showLabels: true, showDrains: true,
  panel: 'results', busy: null, recommendation: null, showdown: null,
  toast: null, flyTo: null,
  onboarding: (() => { if (location.search.includes('noguide')) return false; try { return localStorage.getItem('hydra-onboarded') !== '1'; } catch { return true; } })(),

  set: p => set(p),
  notify: (msg, kind = 'info') => { clearTimeout(toastTimer); set({ toast: { msg, kind } }); toastTimer = setTimeout(() => set({ toast: null }), 3800); },

  init: async () => {
    try {
      const sites = await (await fetch(`${import.meta.env.BASE_URL}data/sites.json`)).json() as SiteSummary[];
      const fromHash = location.hash.slice(1).split('/')[0];
      set({ sites });
      await get().loadSite(sites.some(s => s.id === fromHash) ? fromHash : 'gurugram');
      // demo links: ?demo=showdown runs the budget showdown, ?demo=plan applies HYDRA's recommendation and plays the storm
      const demo = new URLSearchParams(location.search).get('demo');
      if (demo === 'showdown') get().runShowdown();
      else if (demo === 'plan') { await get().recommend('fresh'); const rec = get().recommendation; if (rec) { get().setPlan(rec.plan); set({ panel: 'results' }); } }
    } catch (e) { set({ error: `Could not load site data: ${(e as Error).message}`, loading: null }); }
  },

  loadSite: async id => {
    set({ loading: 'Loading neighbourhood data…', siteId: id, plan: [], undoStack: [], baseline: null, current: null, currentKey: '', recommendation: null, showdown: null, selection: null, hover: null, draft: null, playing: false, time: 0 });
    const site = await (await fetch(`${import.meta.env.BASE_URL}data/${id}.json`)).json() as SiteData;
    const grid = loadGrid(site);
    writeHash(id, get().mode);
    set({ site, grid, loading: 'Preparing the flood engine…' });
    await engine.load(site);
    await get().runBaseline();
    set({ loading: null });
  },

  setStorm: stormId => { set({ stormId, recommendation: null, showdown: null }); get().runBaseline().then(() => { if (get().plan.length) get().runPlan(false); }); },
  setAntecedent: antecedent => { set({ antecedent, recommendation: null, showdown: null }); get().runBaseline().then(() => { if (get().plan.length) get().runPlan(false); }); },
  setBudget: budget => set({ budget, recommendation: null, showdown: null }),

  runBaseline: async () => {
    set({ running: true });
    const baseline = await engine.simulate([], simOptions(get()));
    const s = get();
    set({ baseline, running: false, ...(s.plan.length ? {} : { current: baseline, currentKey: '', view: 'baseline' as const }) });
  },

  runPlan: async (autoplay = true) => {
    const { plan } = get(), key = planKey(plan);
    set({ running: true });
    const current = await engine.simulate(plan, simOptions(get()));
    if (planKey(get().plan) !== key) { set({ running: false }); return; }   // plan changed meanwhile
    set({ current, currentKey: key, running: false, view: 'plan', ...(autoplay ? { time: 0, playing: true, peak: false } : {}) });
  },

  add: partial => {
    const { grid, plan, budget } = get();
    if (!grid) return false;
    const iv = { ...partial, id: `iv${Date.now().toString(36)}${(ivSeq++).toString(36)}`, source: partial.source ?? 'user' } as Intervention;
    const err = validate(grid, iv, plan);
    if (err) { get().notify(err, 'error'); return false; }
    const cost = costOf(grid, iv), spent = planCost(grid, plan);
    if (spent + cost > budget) { get().notify(`Over budget: ${CATALOG[iv.type].name} costs ₹${Math.round(cost).toLocaleString('en-IN')}, only ₹${Math.round(budget - spent).toLocaleString('en-IN')} left`, 'error'); return false; }
    set({ plan: [...plan, iv], undoStack: [...get().undoStack, plan].slice(-50) });
    return true;
  },
  remove: id => { const { plan } = get(); set({ plan: plan.filter(p => p.id !== id), undoStack: [...get().undoStack, plan].slice(-50) }); },
  undo: () => { const st = get().undoStack; if (!st.length) return; set({ plan: st[st.length - 1], undoStack: st.slice(0, -1) }); },
  clearPlan: () => { const { plan } = get(); if (!plan.length) return; set({ plan: [], undoStack: [...get().undoStack, plan], current: get().baseline, currentKey: '', view: 'baseline' }); },
  setPlan: plan => { set({ plan, undoStack: [...get().undoStack, get().plan].slice(-50) }); get().runPlan(true); },

  recommend: async mode => {
    const s = get();
    set({ busy: { p: 0, msg: 'Starting the optimizer…' }, panel: 'recommend' });
    try {
      const rec = await engine.optimize(s.budget, mode === 'fill' ? s.plan : [], simOptions(s, false), (p, msg) => set({ busy: { p, msg } }));
      set({ recommendation: rec, busy: null });
    } catch (e) { set({ busy: null }); get().notify((e as Error).message, 'error'); }
  },
  runShowdown: async () => {
    const s = get();
    set({ busy: { p: 0, msg: 'Setting up the showdown…' }, panel: 'showdown' });
    try {
      const sd = await engine.showdown(s.budget, simOptions(s, false), (p, msg) => set({ busy: { p, msg } }));
      set({ showdown: sd, busy: null });
    } catch (e) { set({ busy: null }); get().notify((e as Error).message, 'error'); }
  },
}));

// helpers used by the scene and tools
export const isFloodTool = (t: Tool): t is InterventionType => t in CATALOG;
export function footprintFor(tool: Tool, grid: Grid, cell: number): number[] {
  if (tool === 'garden') return gardenFootprint(grid, cell);
  return [cell];
}
