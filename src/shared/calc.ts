// Calculation requests (the API's /calc routes, backend/src/calc.ts). The browser sends ids and the plan; the server
// builds the storm or the day from the same tables and runs the engine. floodRunOptions() and heatRunOptions() are the
// only source of run settings for both sides, so a result calculated on AWS matches one calculated in the browser.
import { STORMS } from '../sim/flood/model';
import { HEAT_SCENARIOS, HEAT_WINDOWS } from '../sim/heat/model';
import type { Antecedent, Intervention, Metrics, SimOptions } from '../sim/flood/types';
import type { HeatIntervention, HeatMetrics, HeatOptions } from '../sim/heat/types';
import { validateItems, word } from './plan';

export type CalcMode = 'flood' | 'heat';
export type CalcOp = 'simulate' | 'optimize' | 'showdown';
/** Where a result was calculated: by the HYDRA API (on AWS Lambda when deployed), or by a Web Worker in this browser. */
export type CalcSource = 'server' | 'browser';

/** simulate: the plan to run. optimize: the plan to keep and build on, plus the budget. showdown: the budget. */
export interface FloodCalc { siteId: string; stormId: string; antecedent: Antecedent; plan: Intervention[]; budget?: number }
export interface HeatCalc { siteId: string; scenarioId: string; windowId: string; plan: HeatIntervention[]; budget?: number }

export interface OptimizeResult { plan: Intervention[]; metrics: Metrics; cost: number; rounds: number[]; source?: CalcSource }
export interface ShowdownResult {
  budget: number; base: Metrics;
  spreads: { plan: Intervention[]; cost: number; metrics: Metrics }[];
  hydra: { plan: Intervention[]; cost: number; metrics: Metrics };
  source?: CalcSource;
}
export interface HeatOptimizeResult { plan: HeatIntervention[]; metrics: HeatMetrics; cost: number; source?: CalcSource }
export interface HeatShowdownResult {
  budget: number; base: HeatMetrics;
  spreads: { plan: HeatIntervention[]; cost: number; metrics: HeatMetrics }[];
  hydra: { plan: HeatIntervention[]; cost: number; metrics: HeatMetrics };
  source?: CalcSource;
}

const ANTECEDENTS: Antecedent[] = ['dry', 'normal', 'wet'];
export const floodRunOptions = (stormId: string, antecedent: Antecedent, keepFrames = true): SimOptions =>
  ({ storm: STORMS.find(x => x.id === stormId) ?? STORMS[0], antecedent, keepFrames, recessionMin: 60, frameEveryMin: 2 });
export const heatRunOptions = (scenarioId: string, windowId: string, keepFrames = true): HeatOptions => ({
  scenario: HEAT_SCENARIOS.find(x => x.id === scenarioId) ?? HEAT_SCENARIOS[0],
  window: HEAT_WINDOWS.find(x => x.id === windowId) ?? HEAT_WINDOWS[0], keepFrames,
});

/** Returns an error message, or null when the request is well formed (placement on the map is checked on the grid). */
export function validateCalc(mode: CalcMode, op: CalcOp, x: unknown): string | null {
  const r = x as Partial<FloodCalc & HeatCalc>;
  if (!r || typeof r !== 'object') return 'Expected a JSON object';
  if (!word(r.siteId)) return 'siteId is malformed';
  if (mode === 'flood') {
    if (!STORMS.some(s => s.id === r.stormId)) return `stormId must be one of ${STORMS.map(s => s.id).join(', ')}`;
    if (!ANTECEDENTS.includes(r.antecedent as Antecedent)) return `antecedent must be one of ${ANTECEDENTS.join(', ')}`;
  } else {
    if (!HEAT_SCENARIOS.some(s => s.id === r.scenarioId)) return `scenarioId must be one of ${HEAT_SCENARIOS.map(s => s.id).join(', ')}`;
    if (!HEAT_WINDOWS.some(w => w.id === r.windowId)) return `windowId must be one of ${HEAT_WINDOWS.map(w => w.id).join(', ')}`;
  }
  if (op !== 'simulate' && (typeof r.budget !== 'number' || !(r.budget > 0 && r.budget <= 1e8))) return 'budget must be between ₹1 and ₹10 Cr';
  return validateItems(mode, r.plan ?? []);
}
