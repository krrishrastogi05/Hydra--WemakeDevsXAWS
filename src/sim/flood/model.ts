// Flood mode: intervention catalogue, costs, validation and design storms.
import { COVER } from '../types';
import type { Grid } from '../grid';
import type { Intervention, InterventionType, Storm } from './types';

// ---------------- interventions ----------------
// Unit costs are indicative 2024 Indian rates; replace with the local CPWD / state PWD schedule of rates.
export const PARAMS = {
  newDrainCap: 0.4,        // m3/s, 0.6 x 0.6 m RCC drain at ~0.5 % slope (Manning n 0.015)
  gardenDepth: 0.25,       // m depression
  gardenRate: 60,          // mm/h through engineered media
  gardenMedia: 0.25,       // m of water held in media voids
  gardenExfil: 15,         // mm/h into native soil once media is full (x soil factor)
  pitStore: 2.5,           // m3
  pitRate: 1.0,            // L/s recharge (x soil factor)
  pitSump: 0.15,           // m inlet depression
  rwhDepth: 0.04,          // m of roof rain a tank holds (40 L per m2 of roof)
  desiltTo: 0.1,           // silt fraction after desilting
};
export const CATALOG: Record<InterventionType, { name: string; short: string; unit: string; color: string; key: string; blurb: string }> = {
  drain:  { name: 'Stormwater drain', short: 'Drain', unit: '₹6,000 per metre', color: '#7dd3fc', key: '1', blurb: 'New RCC drain (0.4 m³/s). Drag along a road towards an existing drain or the area edge. It only helps if it connects to an outfall.' },
  garden: { name: 'Rain garden', short: 'Rain garden', unit: '₹1.2 L per 10 × 10 m', color: '#4ade80', key: '2', blurb: 'Sunken planted bed (25 cm) that soaks up street runoff at 60 mm/h. Works best on sandy or loamy soil.' },
  rwh:    { name: 'Rooftop rainwater harvesting', short: 'Roof RWH', unit: '₹12,000 + ₹2,800 per m³', color: '#38bdf8', key: '3', blurb: 'Gutters + tank holding the first 40 mm of roof rain, so it never reaches the street.' },
  pit:    { name: 'Recharge pit', short: 'Recharge pit', unit: '₹40,000 each', color: '#fbbf24', key: '4', blurb: 'Gravel pit with a recharge bore at a low spot: 2.5 m³ store, ~1 L/s into the aquifer.' },
  desilt: { name: 'Drain desilting', short: 'Desilt', unit: '₹600 per metre', color: '#a78bfa', key: '5', blurb: 'Clear silt and solid waste from an existing roadside drain: capacity 50 % → 90 %.' },
};

export const tankSize = (roofArea: number) => Math.min(30, Math.max(3, roofArea * PARAMS.rwhDepth));

export function costOf(g: Grid, iv: Intervention): number {
  switch (iv.type) {
    case 'drain': return (iv.cells?.length ?? 0) * g.dx * 6000;
    case 'garden': return (iv.cells?.length ?? 0) * g.A * 1200;
    case 'pit': return 40000;
    case 'rwh': { const b = iv.building ?? -1; const roof = (g.bCells[b]?.length ?? 0) * g.A; return Math.round(12000 + 2800 * tankSize(roof)); }
    case 'desilt': return Math.round((g.unitCells.get(iv.unit ?? -1)?.length ?? 0) * g.dx * 600);
  }
}
export const planCost = (g: Grid, ivs: Intervention[]) => ivs.reduce((s, iv) => s + costOf(g, iv), 0);

/** Cells already used by a plan (so two interventions cannot share a cell). */
export function usedCells(ivs: Intervention[]) {
  const s = new Set<number>();
  for (const iv of ivs) if (iv.type !== 'rwh' && iv.type !== 'desilt') iv.cells?.forEach(c => s.add(c));
  return s;
}

const GARDEN_OK = new Set<number>([COVER.OPEN, COVER.GREEN, COVER.PAVED]);
const PIT_OK = new Set<number>([COVER.OPEN, COVER.GREEN, COVER.PAVED, COVER.ROAD]);
const DRAIN_OK = new Set<number>([COVER.OPEN, COVER.GREEN, COVER.PAVED, COVER.ROAD]);

/** Returns an error message, or null when the intervention can be placed. */
export function validate(g: Grid, iv: Intervention, plan: Intervention[]): string | null {
  const used = usedCells(plan.filter(p => p.id !== iv.id));
  switch (iv.type) {
    case 'garden': {
      if (!iv.cells?.length) return 'No cells';
      for (const c of iv.cells) {
        if (!GARDEN_OK.has(g.cover[c])) return 'Rain gardens need open, green or paved ground (not roads or buildings)';
        if (g.drain[c] >= 0) return 'There is already a drain here';
        if (used.has(c)) return 'Something is already built here';
      }
      return null;
    }
    case 'pit': {
      const c = iv.cells?.[0] ?? -1;
      if (c < 0 || !PIT_OK.has(g.cover[c])) return 'Recharge pits go on ground, paving or a road edge';
      if (used.has(c)) return 'Something is already built here';
      return null;
    }
    case 'drain': {
      if (!iv.cells?.length) return 'Drag to draw a drain';
      for (const c of iv.cells) {
        if (!DRAIN_OK.has(g.cover[c])) return 'Drains cannot pass through buildings or water';
        if (used.has(c)) return 'Something is already built here';
      }
      return null;
    }
    case 'rwh': {
      const b = iv.building ?? -1;
      if (b < 0 || !g.bCells[b]?.length) return 'Pick a building';
      if (plan.some(p => p.type === 'rwh' && p.building === b && p.id !== iv.id)) return 'This roof already harvests rain';
      return null;
    }
    case 'desilt': {
      if (!g.unitCells.has(iv.unit ?? -1)) return 'Pick an existing roadside drain';
      if (plan.some(p => p.type === 'desilt' && p.unit === iv.unit && p.id !== iv.id)) return 'Already desilted';
      return null;
    }
  }
}

/** 2 x 2 rain-garden footprint anchored at a cell (clipped to the grid). */
export function gardenFootprint(g: Grid, cell: number) {
  const c = Math.min(g.nx - 2, cell % g.nx), r = Math.min(g.ny - 2, (cell / g.nx) | 0);
  return [r * g.nx + c, r * g.nx + c + 1, (r + 1) * g.nx + c, (r + 1) * g.nx + c + 1];
}

// ---------------- design storms ----------------
// Magnitudes follow IMD categories (daily): heavy 64.5–115.5 mm, very heavy 115.6–204.4 mm,
// extremely heavy >= 204.5 mm; IMD calls >= 100 mm in an hour over a small area a cloudburst.
export const STORMS: Storm[] = [
  { id: 'heavy', name: 'Heavy monsoon spell', totalMm: 65, durationMin: 120, profile: 'peaked', note: '65 mm in 2 h: an IMD "heavy rainfall" day packed into one afternoon spell.' },
  { id: 'veryheavy', name: 'Very heavy downpour', totalMm: 120, durationMin: 180, profile: 'peaked', note: '120 mm in 3 h: IMD "very heavy" (115.6–204.4 mm/day), the kind of evening that jams Gurugram and floods Velachery.' },
  { id: 'cloudburst', name: 'Cloudburst-type burst', totalMm: 100, durationMin: 60, profile: 'peaked', note: '100 mm in 1 h: meets IMD\'s cloudburst threshold (≥ 100 mm/h).' },
  { id: 'extreme', name: 'Extreme day (2015-type)', totalMm: 220, durationMin: 360, profile: 'peaked', note: '220 mm in 6 h: IMD "extremely heavy" (≥ 204.5 mm/day). Illustrative of Chennai, Dec 2015.' },
];
export const BLOCK_MIN = 5;
/** Rain depth (mm) in each 5-minute block. Peaked = Gaussian burst at 40 % of the storm plus a 12 % background. */
export function hyetograph(s: Storm): number[] {
  const nb = Math.max(1, Math.round(s.durationMin / BLOCK_MIN)), w: number[] = [];
  for (let k = 0; k < nb; k++) {
    const t = (k + 0.5) / nb;
    w.push(s.profile === 'uniform' ? 1 : Math.exp(-(((t - 0.4) / 0.18) ** 2)) + 0.12);
  }
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map(v => v / sum * s.totalMm);
}

