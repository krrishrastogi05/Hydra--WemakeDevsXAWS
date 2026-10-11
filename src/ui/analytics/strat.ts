// Showdown results turned into the neutral strategy shape used by the side panel and the analytics view.
import type { Grid } from '../../sim/grid';
import { CATALOG, planCost } from '../../sim/flood/model';
import type { Intervention, InterventionType, Metrics } from '../../sim/flood/types';
import { HEAT_CATALOG, heatPlanCost } from '../../sim/heat/model';
import type { HeatIntervention, HeatInterventionType, HeatMetrics } from '../../sim/heat/types';
import type { HeatShowdownResult, ShowdownResult } from '../../shared/calc';
import { num } from '../kit';
import type { StratData } from './common';

export function floodStrat(sd: ShowdownResult | null, g: Grid | null): StratData | null {
  if (!sd || !g) return null;
  const mix = (plan: Intervention[]) => (Object.keys(CATALOG) as InterventionType[]).map(t => ({ label: CATALOG[t].short, color: CATALOG[t].color, value: planCost(g, plan.filter(p => p.type === t)) }));
  const m = (label: string, k: keyof Metrics, fmt: (v: number) => string, scale = 1, hint?: string) => ({ label, hint, fmt, better: 'lower' as const, none: (sd.base[k] as number) * scale, hydra: (sd.hydra.metrics[k] as number) * scale, spreads: sd.spreads.map(x => (x.metrics[k] as number) * scale) });
  return {
    budget: sd.budget,
    headline: { label: 'Homes with water inside', unit: 'home kept dry', units: 'homes', better: 'lower', none: sd.base.buildingsFlooded, hydra: sd.hydra.metrics.buildingsFlooded, spreads: sd.spreads.map(x => x.metrics.buildingsFlooded) },
    impact: { label: 'Flood impact', better: 'lower', none: sd.base.impact, hydra: sd.hydra.metrics.impact, spreads: sd.spreads.map(x => x.metrics.impact) },
    metrics: [
      m('Homes with water inside', 'buildingsFlooded', v => num(v, v % 1 ? 1 : 0)),
      m('Residents affected', 'residentsAffected', v => num(Math.round(v))),
      m('Roads cut', 'roadKmAffected', v => `${num(v, 2)} km`, 1, 'deeper than 15 cm'),
      m('Waterlogged area', 'floodedArea', v => `${num(v, 2)} ha`, 1e-4),
      m('Road disruption', 'roadKmHours', v => `${num(v, 2)} km·h`),
      m('Flood impact', 'impact', v => num(v), 100 / Math.max(1e-9, sd.base.impact), 'no action = 100'),
    ],
    cost: { hydra: sd.hydra.cost, spreads: sd.spreads.map(x => x.cost) },
    mix: { hydra: mix(sd.hydra.plan), spreads: sd.spreads.map(x => mix(x.plan)) },
  };
}


export function heatStrat(sd: HeatShowdownResult | null, g: Grid | null): StratData | null {
  if (!sd || !g) return null;
  const mix = (plan: HeatIntervention[]) => (Object.keys(HEAT_CATALOG) as HeatInterventionType[]).map(t => ({ label: HEAT_CATALOG[t].short, color: HEAT_CATALOG[t].color, value: heatPlanCost(g, plan.filter(p => p.type === t)) }));
  const m = (label: string, k: keyof HeatMetrics, fmt: (v: number) => string, better: 'lower' | 'higher', scale = 1, hint?: string) => ({ label, hint, fmt, better, none: sd.base[k] * scale, hydra: sd.hydra.metrics[k] * scale, spreads: sd.spreads.map(x => x.metrics[k] * scale) });
  return {
    budget: sd.budget,
    headline: { label: 'High-exposure places', unit: 'place cooled', units: 'places', better: 'lower', none: sd.base.hotReceptors, hydra: sd.hydra.metrics.hotReceptors, spreads: sd.spreads.map(x => x.metrics.hotReceptors) },
    impact: { label: 'Exposure at busy places', better: 'lower', none: sd.base.weightedIndex, hydra: sd.hydra.metrics.weightedIndex, spreads: sd.spreads.map(x => x.metrics.weightedIndex) },
    metrics: [
      m('High-exposure places', 'hotReceptors', v => num(v, v % 1 ? 1 : 0), 'lower'),
      m('Shade where people wait', 'receptorShade', v => `${Math.round(v)}%`, 'higher', 100, 'higher is better'),
      m('Exposure at busy places', 'weightedIndex', v => num(v, 1), 'lower', 1, 'footfall-weighted index'),
      m('Street space in sun at midday', 'exposedShare', v => `${Math.round(v)}%`, 'lower', 100),
      m('Direct sun per spot', 'sunHours', v => `${num(v, 2)} h`, 'lower'),
    ],
    cost: { hydra: sd.hydra.cost, spreads: sd.spreads.map(x => x.cost) },
    mix: { hydra: mix(sd.hydra.plan), spreads: sd.spreads.map(x => mix(x.plan)) },
  };
}

