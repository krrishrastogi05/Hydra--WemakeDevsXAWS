// Saved and shared plans: what the app stores so a link reopens the same neighbourhood, conditions and plan.
// Shared by the frontend and the backend.
import type { Intervention } from '../sim/flood/types';
import type { HeatIntervention } from '../sim/heat/types';

export interface FloodSettings { stormId: string; antecedent: string; budget: number }
export interface HeatSettings { scenarioId: string; windowId: string; budget: number }
export type NewPlan =
  | { siteId: string; siteName: string; mode: 'flood'; settings: FloodSettings; plan: Intervention[] }
  | { siteId: string; siteName: string; mode: 'heat'; settings: HeatSettings; plan: HeatIntervention[] };
export type SavedPlan = NewPlan & { id: string; v: 1; createdAt: string };

const TYPES = { flood: ['drain', 'garden', 'rwh', 'pit', 'desilt'], heat: ['tree', 'canopy', 'walkway', 'coolroof'] };
const SOURCES = ['user', 'hydra', 'spread'];
const MAX = { items: 1500, cells: 600 };

export const word = (v: unknown, max = 40) => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v) && v.length <= max;
const int = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1e7;

/** Returns an error message, or null when the plan is well formed (whether it fits the site is checked when it loads). */
export function validateNewPlan(x: unknown): string | null {
  const p = x as NewPlan;
  if (!p || typeof p !== 'object') return 'Expected a JSON object';
  if (!word(p.siteId)) return 'siteId is malformed';
  if (typeof p.siteName !== 'string' || p.siteName.length > 120) return 'siteName is malformed';
  if (p.mode !== 'flood' && p.mode !== 'heat') return 'mode must be "flood" or "heat"';
  const s = p.settings as Partial<FloodSettings & HeatSettings>;
  if (!s || typeof s.budget !== 'number' || !(s.budget > 0 && s.budget <= 1e10)) return 'settings.budget is malformed';
  if (p.mode === 'flood' ? !word(s.stormId) || !word(s.antecedent) : !word(s.scenarioId) || !word(s.windowId)) return 'settings are malformed';
  if (!Array.isArray(p.plan) || !p.plan.length) return `plan must have 1–${MAX.items} interventions`;
  return validateItems(p.mode, p.plan);
}

/** Checks the shape of each intervention in a flood or heat plan (placement on the map is checked against the grid). */
export function validateItems(mode: 'flood' | 'heat', plan: unknown): string | null {
  if (!Array.isArray(plan) || plan.length > MAX.items) return `plan must be a list of at most ${MAX.items} interventions`;
  for (const iv of plan as (Intervention | HeatIntervention)[]) {
    if (!iv || typeof iv !== 'object' || !word(iv.id) || !TYPES[mode].includes(iv.type)) return 'plan has an unknown intervention';
    if (iv.cells != null && (!Array.isArray(iv.cells) || iv.cells.length > MAX.cells || !iv.cells.every(int))) return 'plan has malformed cells';
    if (iv.building != null && !int(iv.building)) return 'plan has a malformed building';
    if ('unit' in iv && iv.unit != null && !int(iv.unit)) return 'plan has a malformed drain';
    if (iv.source != null && !SOURCES.includes(iv.source)) return 'plan has a malformed source';
    if (iv.reason != null && (typeof iv.reason !== 'string' || iv.reason.length > 500)) return 'plan has a malformed reason';
  }
  return null;
}
