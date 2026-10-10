// App state (zustand). The UI never computes hydrology: every number comes from an engine result in here.
import { create } from 'zustand';
import { API_URL, api, checkBackend, rememberArea, savedAreas, siteDataUrl, useBackend } from './api';
import { isCustomSite } from './shared/area';
import { floodRunOptions } from './shared/calc';
import { engine, type OptimizeResult, type ShowdownResult } from './simClient';
import { loadGrid, type Grid } from './sim/grid';
import { CATALOG, costOf, gardenFootprint, planCost, validate } from './sim/flood/model';
import type { SiteData, SiteSummary } from './sim/types';
import type { Antecedent, Intervention, InterventionType, SimOptions, SimResult } from './sim/flood/types';
import type { HeatInterventionType } from './sim/heat/types';

// Two modes share the neighbourhood, camera, tools rail and panels; their engines, plans and results are separate
// (flood state lives here, heat state in heatStore.ts).
export type Mode = 'flood' | 'heat';
export type Tool = 'inspect' | InterventionType | HeatInterventionType | 'erase';
export type Quality = 'high' | 'low';
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
  onboarding: boolean; addArea: boolean;
  quality: Quality; qualityChosen: boolean; setQuality: (q: Quality) => void;
  // actions
  /** Loads the site list and the first site: `siteId`, else the one in the URL hash. `demos: false` skips ?demo= links. */
  init: (opts?: { siteId?: string; demos?: boolean }) => Promise<void>;
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
export const simOptions = (s: Pick<State, 'stormId' | 'antecedent'>, keepFrames = true): SimOptions => floodRunOptions(s.stormId, s.antecedent, keepFrames);
const condKey = (s: Pick<State, 'siteId' | 'stormId' | 'antecedent'>) => `${s.siteId}|${s.stormId}|${s.antecedent}`;
let ivSeq = 0, baselineSeq = 0;
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
  toast: null, flyTo: null, addArea: false,
  onboarding: (() => { if (location.search.includes('noguide')) return false; try { return localStorage.getItem('hydra-onboarded') !== '1'; } catch { return true; } })(),
  quality: (() => { try { return localStorage.getItem('hydra-quality') === 'low' ? 'low' : 'high'; } catch { return 'high'; } })(),
  // a choice the viewer made by hand is never overridden by the automatic fallback
  qualityChosen: (() => { try { return localStorage.getItem('hydra-quality') != null; } catch { return false; } })(),
  setQuality: quality => { try { localStorage.setItem('hydra-quality', quality); } catch { /* private mode */ } set({ quality, qualityChosen: true }); },

  set: p => set(p),
  notify: (msg, kind = 'info') => { clearTimeout(toastTimer); set({ toast: { msg, kind } }); toastTimer = setTimeout(() => set({ toast: null }), 3800); },

  init: async (opts = {}) => {
    try {
      const [demoSites] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}data/sites.json`).then(r => r.json() as Promise<SiteSummary[]>),
        checkBackend(),
      ]);
      // areas added through the API (remembered by this browser) follow the bundled demo sites
      let sites = [...demoSites, ...(API_URL ? savedAreas() : [])];
      const want = opts.siteId ?? location.hash.slice(1).split('/')[0];
      if (isCustomSite(want) && !sites.some(s => s.id === want) && useBackend.getState().status === 'up') {
        try { const a = await api.getArea(want); if (a.status === 'ready' && a.summary) sites = [...demoSites, ...rememberArea(a.summary)]; } catch { /* unknown area: fall back below */ }
      }
      set({ sites });
      await get().loadSite(sites.some(s => s.id === want) ? want : 'gurugram');
      if (opts.demos === false) return;
      // demo links: ?demo=showdown runs the budget showdown, ?demo=plan applies HYDRA's recommendation and plays the storm
      const demo = get().mode === 'flood' ? new URLSearchParams(location.search).get('demo') : null;   // heat demos: heatStore.ts
      if (demo === 'showdown') get().runShowdown();
      else if (demo === 'plan') { await get().recommend('fresh'); const rec = get().recommendation; if (rec) { get().setPlan(rec.plan); set({ panel: 'results' }); } }
    } catch (e) { set({ error: `Could not load site data: ${(e as Error).message}`, loading: null }); }
  },

  loadSite: async id => {
    set({ loading: 'Loading neighbourhood data…' });
    let site: SiteData;
    try {
      const res = await fetch(siteDataUrl(id, 'data'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      site = await res.json() as SiteData;
    } catch (e) {
      if (!get().site) throw e;   // first load: init shows the error screen
      set({ loading: null }); get().notify(`Could not open this neighbourhood (${(e as Error).message})`, 'error'); return;
    }
    set({ siteId: id, plan: [], undoStack: [], baseline: null, current: null, currentKey: '', recommendation: null, showdown: null, selection: null, hover: null, draft: null, playing: false, time: 0 });
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
    const cond = condKey(get()), seq = ++baselineSeq;
    set({ running: true });
    const baseline = await engine.simulate([], simOptions(get()));
    // a newer storm / soil choice was made while this ran: its own run will land, so drop this one
    if (seq !== baselineSeq || condKey(get()) !== cond) return;
    const s = get();
    set({ baseline, running: false, ...(s.plan.length ? {} : { current: baseline, currentKey: '', view: 'baseline' as const }) });
  },

  runPlan: async (autoplay = true) => {
    const { plan } = get(), key = planKey(plan), cond = condKey(get());
    set({ running: true });
    const current = await engine.simulate(plan, simOptions(get()));
    if (planKey(get().plan) !== key || condKey(get()) !== cond) { set({ running: false }); return; }   // plan or storm changed meanwhile
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
