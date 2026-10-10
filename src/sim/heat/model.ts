// Heat mode: scenarios, time windows, model parameters, intervention catalogue, costs and validation.
import { COVER } from '../types';
import type { Grid } from '../grid';
import type { HeatIntervention, HeatInterventionType, HeatScenario, HeatSite, HeatWindow } from './types';

// Weather inputs. Temperatures follow IMD heatwave criteria (plains: max >= 40 °C and >= 4.5 °C above normal);
// humidity, wind and cloud are typical values for the season, not forecasts.
export const HEAT_SCENARIOS: HeatScenario[] = [
  { id: 'heatwave', name: 'Pre-monsoon heatwave', doy: 140, tempC: 44, rh: 20, windMs: 2.5, cloud: 0.05, note: '20 May, 44 °C, 20 % humidity, clear sky: an IMD heatwave day on the north Indian plains.' },
  { id: 'humid', name: 'Humid hot day', doy: 158, tempC: 37, rh: 62, windMs: 3, cloud: 0.15, note: '7 June, 37 °C, 62 % humidity: sticky pre-monsoon heat, as on the coast before the monsoon arrives.' },
  { id: 'summer', name: 'Ordinary summer day', doy: 115, tempC: 39, rh: 30, windMs: 3, cloud: 0.1, note: '25 April, 39 °C, 30 % humidity: a normal hot day, below heatwave level.' },
  { id: 'break', name: 'Monsoon break, sunny spells', doy: 205, tempC: 34, rh: 75, windMs: 2, cloud: 0.4, note: '24 July, 34 °C, 75 % humidity, 40 % cloud: a muggy break in the monsoon.' },
];
export const HEAT_WINDOWS: HeatWindow[] = [
  { id: 'afternoon', name: 'Afternoon 12:00–16:00', start: 12, end: 16 },
  { id: 'morning', name: 'Morning commute 8:00–11:00', start: 8, end: 11 },
  { id: 'evening', name: 'Evening 16:00–19:00', start: 16, end: 19 },
  { id: 'day', name: 'Whole day 7:00–18:00', start: 7, end: 18 },
];
export const DAY_START = 6, DAY_END = 19, STEP_H = 0.5;   // sun steps every half hour

export const HEAT_PARAMS = {
  personHeight: 1.1,     // m: where sun on a pedestrian is tested (mid-body)
  storey: 3.2,           // m per floor (same as the 3D buildings)
  treeTrans: 0.25,       // share of direct sun through a mature canopy
  trunkShare: 0.4,       // canopy starts at 40 % of tree height
  canopyBase: 2.6, canopyTop: 3.4, canopyTrans: 0.05,   // shade canopy / walkway roof
  newTree: { h: 8, r: 3.5 },                            // mature street tree (neem / peepal size class)
  wSun: 0.5, wSurface: 0.2, wAmbient: 0.3,              // index weights
  dniRef: 950,           // W/m²: clear midday beam used to normalise the sun dose
  windCool: 0.04,        // radiant terms reduced 4 % per m/s of wind (up to 5 m/s)
  underTree: 0.85,       // surface term under a canopy (evapotranspiration, shaded ground)
  high: 60, moderate: 45,
  roofAlbedo: 0.2, coolRoofAlbedo: 0.7,
};
// Surface heating by cover (relative): dark asphalt > paving > bare ground > grass. Code order: OPEN, ROAD, BUILDING, GREEN, WATER, PAVED, CHANNEL.
export const SURFACE = [0.6, 1.0, 0, 0.25, 0, 0.8, 0];
// Footfall weight by road class (relative pedestrian use; illustrative).
export const ROAD_FOOT: Record<string, number> = { motorway: 0.3, trunk: 1.2, primary: 1.5, secondary: 1.5, tertiary: 1.2, residential: 0.8, unclassified: 0.8, living_street: 0.9, service: 0.5, pedestrian: 1.5, track: 0.3 };

export const HEAT_CATALOG: Record<HeatInterventionType, { name: string; short: string; unit: string; color: string; key: string; blurb: string }> = {
  tree:     { name: 'Street tree', short: 'Tree', unit: '₹12,000 each (incl. guard + 3 yrs care)', color: '#22c55e', key: '1', blurb: 'Native shade tree, modelled at maturity: 8 m tall, 3.5 m crown, lets 25 % of direct sun through. Not on the carriageway.' },
  canopy:   { name: 'Shade canopy', short: 'Canopy', unit: '₹1.5 L each (5 × 5 m)', color: '#f59e0b', key: '2', blurb: 'Steel-and-sheet shelter at 2.6–3.4 m for a bus stop, market or gate. Blocks 95 % of direct sun from day one.' },
  walkway:  { name: 'Shaded walkway', short: 'Walkway', unit: '₹7,500 per metre', color: '#fb923c', key: '3', blurb: 'Continuous canopy over a footpath. Drag along the street edge.' },
  coolroof: { name: 'Cool roof', short: 'Cool roof', unit: '₹350 per m² of roof', color: '#e0f2fe', key: '4', blurb: 'White reflective roof coating: roof albedo 0.2 → 0.7. Cuts heat absorbed by the roof (and the room below); it does not shade the street.' },
};

export function heatCostOf(g: Grid, iv: HeatIntervention): number {
  switch (iv.type) {
    case 'tree': return 12000;
    case 'canopy': return 150000;
    case 'walkway': return (iv.cells?.length ?? 0) * g.dx * 7500;
    case 'coolroof': return Math.round((g.bCells[iv.building ?? -1]?.length ?? 0) * g.A * 350);
  }
}
export const heatPlanCost = (g: Grid, ivs: HeatIntervention[]) => ivs.reduce((s, iv) => s + heatCostOf(g, iv), 0);

const TREE_OK = new Set<number>([COVER.OPEN, COVER.GREEN, COVER.PAVED]);
const SHADE_OK = new Set<number>([COVER.OPEN, COVER.GREEN, COVER.PAVED, COVER.ROAD]);

/** Cells already holding a tree or shade structure (existing trees and the plan). */
export function occupiedCells(hs: HeatSite, plan: HeatIntervention[]) {
  const s = new Set<number>(hs.trees.map(t => t.cell));
  for (const iv of plan) if (iv.type !== 'coolroof') iv.cells?.forEach(c => s.add(c));
  return s;
}

/** Returns an error message, or null when the intervention can be placed. */
export function validateHeat(g: Grid, hs: HeatSite, iv: HeatIntervention, plan: HeatIntervention[]): string | null {
  const used = occupiedCells(hs, plan.filter(p => p.id !== iv.id));
  switch (iv.type) {
    case 'tree': {
      const c = iv.cells?.[0] ?? -1;
      if (c < 0 || !TREE_OK.has(g.cover[c])) return 'Trees go on open ground, paving or green space (not on the road or a building)';
      if (used.has(c)) return 'There is already a tree or shade structure here';
      return null;
    }
    case 'canopy': case 'walkway': {
      if (!iv.cells?.length) return iv.type === 'walkway' ? 'Drag along a street to draw a walkway' : 'No cell';
      for (const c of iv.cells) {
        if (!SHADE_OK.has(g.cover[c])) return 'Shade structures go on streets, paving or open ground (not on buildings or water)';
        if (used.has(c)) return 'There is already a tree or shade structure here';
      }
      return null;
    }
    case 'coolroof': {
      const b = iv.building ?? -1;
      if (b < 0 || !g.bCells[b]?.length) return 'Pick a building';
      if (plan.some(p => p.type === 'coolroof' && p.building === b && p.id !== iv.id)) return 'This roof is already a cool roof';
      return null;
    }
  }
}
