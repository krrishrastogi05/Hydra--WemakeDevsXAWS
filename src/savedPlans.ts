// Named plans saved in this browser, for side-by-side comparison. Each entry keeps its own no-action baseline
// (same storm or day), so plans made under different conditions are compared as improvements, never raw.
import { create } from 'zustand';
import { planKey, useStore } from './store';
import { heatPlanKey, useHeat } from './heatStore';
import { STORMS, planCost } from './sim/flood/model';
import { HEAT_SCENARIOS, HEAT_WINDOWS, heatPlanCost } from './sim/heat/model';
import type { Antecedent, Intervention } from './sim/flood/types';
import type { HeatIntervention } from './sim/heat/types';

export interface SavedEntry {
  id: string; name: string; mode: 'flood' | 'heat'; siteId: string;
  cond: string;                                  // human-readable conditions
  settings: Record<string, string | number>;     // flood: stormId, antecedent, budget · heat: scenarioId, windowId, budget
  plan: (Intervention | HeatIntervention)[]; cost: number;
  metrics: Record<string, number>; base: Record<string, number>; savedAt: string;
}

const KEY = 'hydra-saved-plans', MAX = 24;
const load = (): SavedEntry[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const persist = (xs: SavedEntry[]) => { try { localStorage.setItem(KEY, JSON.stringify(xs)); } catch { /* private mode or full: kept for this visit */ } };

interface SavedState {
  entries: SavedEntry[];
  /** ids picked for comparison */
  picked: string[];
  saveCurrent: (name: string) => SavedEntry | string;
  remove: (id: string) => void; rename: (id: string, name: string) => void; toggle: (id: string) => void;
  open: (id: string) => Promise<void>;
}

const nums = (m: object) => Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'number')) as Record<string, number>;

export const useSaved = create<SavedState>((set, get) => ({
  entries: load(), picked: [],

  /** Saves the active mode's plan with the numbers of its latest run; returns an error message when it cannot. */
  saveCurrent: name => {
    const s = useStore.getState(), site = s.site, grid = s.grid;
    if (!site || !grid) return 'No neighbourhood loaded';
    const id = `p${Date.now().toString(36)}`, savedAt = new Date().toISOString();
    let entry: SavedEntry;
    if (s.mode === 'flood') {
      if (!s.plan.length) return 'The plan is empty';
      if (!s.baseline || !s.current || s.currentKey !== planKey(s.plan)) return 'Run the storm with this plan first';
      const storm = STORMS.find(x => x.id === s.stormId)!;
      entry = { id, name, mode: 'flood', siteId: site.id, savedAt, cond: `${storm.name} · ${storm.totalMm} mm · ${s.antecedent} soil`,
        settings: { stormId: s.stormId, antecedent: s.antecedent, budget: s.budget }, plan: s.plan, cost: planCost(grid, s.plan), metrics: nums(s.current.metrics), base: nums(s.baseline.metrics) };
    } else {
      const h = useHeat.getState();
      if (!h.plan.length) return 'The plan is empty';
      if (!h.baseline || !h.current || h.currentKey !== heatPlanKey(h.plan)) return 'Run the day with this plan first';
      const sc = HEAT_SCENARIOS.find(x => x.id === h.scenarioId)!, w = HEAT_WINDOWS.find(x => x.id === h.windowId)!;
      entry = { id, name, mode: 'heat', siteId: site.id, savedAt, cond: `${sc.name} · ${w.name}`,
        settings: { scenarioId: h.scenarioId, windowId: h.windowId, budget: h.budget }, plan: h.plan, cost: heatPlanCost(grid, h.plan), metrics: nums(h.current.metrics), base: nums(h.baseline.metrics) };
    }
    const entries = [entry, ...get().entries].slice(0, MAX);
    persist(entries);
    set({ entries, picked: [entry.id, ...get().picked].slice(0, 5) });
    return entry;
  },
  remove: id => { const entries = get().entries.filter(e => e.id !== id); persist(entries); set({ entries, picked: get().picked.filter(p => p !== id) }); },
  rename: (id, name) => { const entries = get().entries.map(e => (e.id === id ? { ...e, name } : e)); persist(entries); set({ entries }); },
  toggle: id => { const p = get().picked; set({ picked: p.includes(id) ? p.filter(x => x !== id) : [...p, id].slice(-5) }); },

  /** Puts a saved plan back on the map, with the storm or day it was made for, and runs it. */
  open: async id => {
    const e = get().entries.find(x => x.id === id), s = useStore.getState();
    if (!e || e.siteId !== s.site?.id) return;
    // fresh ids, so they never collide with interventions added in this visit
    const stamp = Date.now().toString(36), plan = e.plan.map((p, k) => ({ ...p, id: `s${stamp}${k}` }));
    if (e.mode === 'flood') {
      if (s.mode !== 'flood') s.setMode('flood');
      useStore.setState({ stormId: String(e.settings.stormId), antecedent: e.settings.antecedent as Antecedent, budget: Number(e.settings.budget), plan: plan as Intervention[], recommendation: null, showdown: null });
      await useStore.getState().runBaseline();
      await useStore.getState().runPlan(false);
    } else {
      if (s.mode !== 'heat') s.setMode('heat');
      await useHeat.getState().ensure();
      useHeat.setState({ scenarioId: String(e.settings.scenarioId), windowId: String(e.settings.windowId), budget: Number(e.settings.budget), plan: plan as HeatIntervention[], recommendation: null, showdown: null });
      await useHeat.getState().runBaseline();
      await useHeat.getState().runPlan(false);
    }
  },
}));
