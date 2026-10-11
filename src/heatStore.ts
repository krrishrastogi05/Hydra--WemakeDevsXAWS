// Heat-mode state (zustand). Separate from the flood state in store.ts: its own weather, plan, budget, results and
// recommendations. It shares only the neighbourhood (site, grid), the tool, hover/selection and the toast with the main store.
import { create } from 'zustand';
import { useStore } from './store';
import { siteDataUrl } from './api';
import { heatRunOptions } from './shared/calc';
import { heatEngine, type HeatOptimizeResult, type HeatShowdownResult } from './simClient';
import { HEAT_CATALOG, HEAT_WINDOWS, heatCostOf, heatPlanCost, validateHeat } from './sim/heat/model';
import { fmtINR } from './sim/grid';
import type { HeatIntervention, HeatOptions, HeatResult, HeatSite } from './sim/heat/types';

interface HeatState {
  siteId: string; heat: HeatSite | null; loading: boolean;
  scenarioId: string; windowId: string; budget: number;
  plan: HeatIntervention[]; undoStack: HeatIntervention[][];
  baseline: HeatResult | null; current: HeatResult | null; currentKey: string; running: boolean;
  view: 'plan' | 'baseline';
  summary: boolean;            // true: exposure over the chosen hours; false: sun and shade at `hour`
  hour: number; playing: boolean; speed: number;
  overlay: 'exposure' | 'none';
  busy: { p: number; msg: string } | null;
  recommendation: HeatOptimizeResult | null; showdown: HeatShowdownResult | null;
  ensure: () => Promise<void>;
  setScenario: (id: string) => void; setWindow: (id: string) => void; setBudget: (b: number) => void;
  runBaseline: () => Promise<void>; runPlan: (show?: boolean) => Promise<void>;
  add: (iv: Omit<HeatIntervention, 'id'>) => boolean; remove: (id: string) => void; undo: () => void; clearPlan: () => void;
  setPlan: (plan: HeatIntervention[]) => void;
  /** 'auto' builds on the current plan when there is one. */
  recommend: (mode?: 'fresh' | 'fill' | 'auto') => Promise<void>; runShowdown: () => Promise<void>;
}

export const heatPlanKey = (plan: HeatIntervention[]) => plan.map(p => p.id).join('|');
export const heatOptions = (s: Pick<HeatState, 'scenarioId' | 'windowId'>, keepFrames = true): HeatOptions => heatRunOptions(s.scenarioId, s.windowId, keepFrames);
let ivSeq = 0, demoDone = false;
const fresh = { plan: [], undoStack: [], baseline: null, current: null, currentKey: '', running: false, view: 'baseline' as const, summary: true, playing: false, recommendation: null, showdown: null, busy: null };

export const useHeat = create<HeatState>((set, get) => ({
  siteId: '', heat: null, loading: false,
  scenarioId: 'heatwave', windowId: 'afternoon', budget: 25e5,
  ...fresh, hour: 14, speed: 1, overlay: 'exposure',

  // load this neighbourhood's trees and pedestrian places and trace the baseline, once per site
  ensure: async () => {
    const { site } = useStore.getState();
    if (!site || get().loading || (get().siteId === site.id && get().baseline)) return;
    set({ loading: true, siteId: site.id, ...fresh, heat: null });
    try {
      const res = await fetch(siteDataUrl(site.id, 'heat'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const heat = await res.json() as HeatSite;
      if (useStore.getState().site?.id !== site.id) { set({ loading: false }); return; }
      await heatEngine.load(site, heat);
      set({ heat });
      await get().runBaseline();
    } catch (e) { useStore.getState().notify(`Could not load heat data: ${(e as Error).message}`, 'error'); }
    set({ loading: false });
    // demo links (?demo=showdown | ?demo=plan with #city/heat), once per page load
    const demo = new URLSearchParams(location.search).get('demo');
    if (demo && !demoDone && get().baseline) {
      demoDone = true;
      if (demo === 'showdown') get().runShowdown();
      else if (demo === 'plan') { await get().recommend('fresh'); const rec = get().recommendation; if (rec) { get().setPlan(rec.plan); useStore.setState({ panel: 'results' }); } }
    }
  },

  setScenario: scenarioId => { set({ scenarioId, recommendation: null, showdown: null }); get().runBaseline().then(() => { if (get().plan.length) get().runPlan(false); }); },
  setWindow: windowId => {
    const w = HEAT_WINDOWS.find(x => x.id === windowId) ?? HEAT_WINDOWS[0];
    set({ windowId, recommendation: null, showdown: null, hour: Math.round((w.start + w.end) / 2) });
    get().runBaseline().then(() => { if (get().plan.length) get().runPlan(false); });
  },
  setBudget: budget => set({ budget, recommendation: null, showdown: null }),

  runBaseline: async () => {
    if (!get().heat) return;
    set({ running: true });
    const baseline = await heatEngine.simulate([], heatOptions(get()));
    set({ baseline, running: false, ...(get().plan.length ? {} : { current: baseline, currentKey: '', view: 'baseline' as const }) });
  },
  runPlan: async (show = true) => {
    const { plan } = get(), key = heatPlanKey(plan);
    if (!plan.length) { set({ current: get().baseline, currentKey: '', view: 'baseline' }); return; }
    set({ running: true });
    const current = await heatEngine.simulate(plan, heatOptions(get()));
    if (heatPlanKey(get().plan) !== key) { set({ running: false }); return; }
    set({ current, currentKey: key, running: false, view: 'plan', ...(show ? { summary: true, playing: false } : {}) });
  },

  add: partial => {
    const { grid, notify } = useStore.getState(), { heat, plan, budget } = get();
    if (!grid || !heat) return false;
    const iv = { ...partial, id: `hv${Date.now().toString(36)}${(ivSeq++).toString(36)}`, source: partial.source ?? 'user' } as HeatIntervention;
    const err = validateHeat(grid, heat, iv, plan);
    if (err) { notify(err, 'error'); return false; }
    const cost = heatCostOf(grid, iv), spent = heatPlanCost(grid, plan);
    if (spent + cost > budget) { notify(`Over budget: ${HEAT_CATALOG[iv.type].name} costs ${fmtINR(cost)}, only ${fmtINR(budget - spent)} left`, 'error'); return false; }
    set({ plan: [...plan, iv], undoStack: [...get().undoStack, plan].slice(-50) });
    heatPlanChanged();
    return true;
  },
  remove: id => { const { plan } = get(); set({ plan: plan.filter(p => p.id !== id), undoStack: [...get().undoStack, plan].slice(-50) }); heatPlanChanged(); },
  undo: () => { const st = get().undoStack; if (!st.length) return; set({ plan: st[st.length - 1], undoStack: st.slice(0, -1) }); heatPlanChanged(); },
  clearPlan: () => { const { plan } = get(); if (!plan.length) return; set({ plan: [], undoStack: [...get().undoStack, plan] }); heatPlanChanged(); },
  setPlan: plan => { clearTimeout(heatRunTimer); set({ plan, undoStack: [...get().undoStack, get().plan].slice(-50) }); get().runPlan(true); },

  recommend: async (want = 'auto') => {
    const s = get(), mode = want === 'auto' ? (s.plan.length ? 'fill' : 'fresh') : want;
    set({ busy: { p: 0, msg: 'Starting the shade optimizer…' } });
    useStore.setState({ panel: 'recommend' });
    try {
      const rec = await heatEngine.optimize(s.budget, mode === 'fill' ? s.plan : [], heatOptions(s, false), (p, msg) => set({ busy: { p, msg } }));
      set({ recommendation: rec, busy: null });
    } catch (e) { set({ busy: null }); useStore.getState().notify((e as Error).message, 'error'); }
  },
  runShowdown: async () => {
    const s = get();
    set({ busy: { p: 0, msg: 'Setting up the showdown…' } });
    useStore.setState({ panel: 'showdown' });
    try {
      const sd = await heatEngine.showdown(s.budget, heatOptions(s, false), (p, msg) => set({ busy: { p, msg } }));
      set({ showdown: sd, busy: null });
    } catch (e) { set({ busy: null }); useStore.getState().notify((e as Error).message, 'error'); }
  },
}));

// a new neighbourhood starts heat mode from scratch; heat data loads the first time heat mode is opened for it
useStore.subscribe((s, prev) => {
  if (s.site && s.site !== prev.site) { useHeat.setState({ siteId: '', heat: null, ...fresh }); if (s.mode === 'heat') useHeat.getState().ensure(); }
  else if (s.mode === 'heat' && prev.mode !== 'heat') useHeat.getState().ensure();
});

/** Results follow the plan as it is now: re-run the day shortly after an edit (quick successive edits run once). */
let heatRunTimer: ReturnType<typeof setTimeout> | undefined;
function heatPlanChanged() {
  clearTimeout(heatRunTimer);
  const h = useHeat.getState();
  if (!h.plan.length) { useHeat.setState({ current: h.baseline, currentKey: '', view: 'baseline' }); return; }
  heatRunTimer = setTimeout(() => {
    const st = useHeat.getState();
    if (st.plan.length && heatPlanKey(st.plan) !== st.currentKey) st.runPlan(false);
  }, 400);
}
