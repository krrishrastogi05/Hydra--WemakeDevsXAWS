// Shared plans: save the active mode's plan to get a link, and open a link (?plan=<id>) with the same neighbourhood,
// conditions, budget and plan. Lives outside store.ts because it drives both the flood and the heat store.
import { API_URL, api } from './api';
import { useHeat } from './heatStore';
import { useStore } from './store';
import { HEAT_WINDOWS, validateHeat } from './sim/heat/model';
import { validate } from './sim/flood/model';
import type { Antecedent, Intervention } from './sim/flood/types';
import type { HeatIntervention } from './sim/heat/types';
import type { NewPlan, SavedPlan } from './shared/plan';

/** Saves the active plan and returns its link. */
export async function sharePlan(): Promise<string> {
  const s = useStore.getState(), h = useHeat.getState();
  if (!s.site) throw new Error('No neighbourhood loaded');
  const base = { siteId: s.site.id, siteName: `${s.site.name}, ${s.site.city}` };
  const p: NewPlan = s.mode === 'flood'
    ? { ...base, mode: 'flood', settings: { stormId: s.stormId, antecedent: s.antecedent, budget: s.budget }, plan: s.plan }
    : { ...base, mode: 'heat', settings: { scenarioId: h.scenarioId, windowId: h.windowId, budget: h.budget }, plan: h.plan };
  if (!p.plan.length) throw new Error('The plan is empty');
  const { id } = await api.savePlan(p);
  return `${location.origin}${location.pathname}?plan=${id}#${p.siteId}${p.mode === 'heat' ? '/heat' : ''}`;
}

/** App start: opens a shared plan when the URL has ?plan=<id>, otherwise the normal start. */
export async function boot() {
  const params = new URLSearchParams(location.search), id = params.get('plan');
  const store = useStore.getState();
  if (!id || !API_URL) return store.init();
  let saved: SavedPlan | null = null, why = '';
  try { saved = await api.getPlan(id); } catch (e) { why = (e as Error).message; }
  if (!saved) { await store.init(); useStore.getState().notify(`Could not open the shared plan: ${why}`, 'error'); return; }

  // conditions first, so the first run already uses the shared storm or day
  if (saved.mode === 'flood') {
    useStore.setState({ mode: 'flood', stormId: saved.settings.stormId, antecedent: saved.settings.antecedent as Antecedent, budget: saved.settings.budget });
  } else {
    const w = HEAT_WINDOWS.find(x => x.id === saved.settings.windowId) ?? HEAT_WINDOWS[0];
    useStore.setState({ mode: 'heat' });
    useHeat.setState({ scenarioId: saved.settings.scenarioId, windowId: w.id, budget: saved.settings.budget, hour: Math.round((w.start + w.end) / 2) });
  }
  await store.init({ siteId: saved.siteId, demos: false });
  const s = useStore.getState();
  if (s.site?.id !== saved.siteId) { s.notify('The shared plan is for a neighbourhood that is no longer available', 'error'); return; }

  // keep only interventions that still fit the neighbourhood (each checked against the ones kept before it)
  let kept = 0;
  if (saved.mode === 'flood') {
    const plan: Intervention[] = [];
    for (const iv of saved.plan) if (!validate(s.grid!, iv, plan)) plan.push(iv);
    kept = plan.length;
    if (plan.length) s.setPlan(plan);
  } else {
    await heatReady();
    const h = useHeat.getState(), plan: HeatIntervention[] = [];
    if (h.heat) for (const iv of saved.plan) if (!validateHeat(s.grid!, h.heat, iv, plan)) plan.push(iv);
    kept = plan.length;
    if (plan.length) h.setPlan(plan);
  }
  params.delete('plan');
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  useStore.setState({ onboarding: false, panel: 'plan' });
  const dropped = saved.plan.length - kept;
  s.notify(`Opened a shared plan: ${kept} interventions on ${saved.siteName}${dropped ? ` (${dropped} no longer fit and were left out)` : ''}`);
}

/** Resolves once heat mode has finished loading this neighbourhood (successfully or not). */
function heatReady() {
  const done = () => { const h = useHeat.getState(); return !h.loading && h.siteId === useStore.getState().site?.id && (!!h.baseline || !h.heat); };
  return new Promise<void>(resolve => {
    if (done()) return resolve();
    const stop = useHeat.subscribe(() => { if (done()) { stop(); resolve(); } });
  });
}
