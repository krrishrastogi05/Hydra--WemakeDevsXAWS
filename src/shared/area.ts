// "Add your own area": the request the app sends, the soil presets, and the status record the backend keeps while
// it builds the area. Shared by the frontend and the backend.
import type { SiteSummary } from '../sim/types';

export const SOILS = {
  loam: { name: 'Loam (default when the soil is not known)', factor: 1.0, label: 'Not sure / loam' },
  alluvial: { name: 'Sandy or alluvial loam', factor: 1.25, label: 'Sandy / alluvial (Indo-Gangetic plain)' },
  laterite: { name: 'Lateritic red soil', factor: 0.85, label: 'Red / lateritic (plateaus, Western Ghats)' },
  black: { name: 'Black cotton soil (clayey, swells when wet)', factor: 0.5, label: 'Black cotton (Deccan)' },
  clay: { name: 'Clay or marshy soil, high water table', factor: 0.45, label: 'Clay / marshy (coastal, former wetland)' },
} as const;
export type SoilId = keyof typeof SOILS;

export interface AreaRequest { lat: number; lon: number; name: string; city: string; state: string; soil: SoilId }

export type AreaStatus = 'queued' | 'building' | 'ready' | 'failed';
export interface AreaMeta {
  id: string; status: AreaStatus; stage: string; error?: string;
  request: AreaRequest; createdAt: string; updatedAt: string;
  summary?: SiteSummary; stats?: { osmBuildings: number; syntheticBuildings: number; roads: number; relief: number };
}

/** Custom areas get ids like "a-3f9c1e2b7d" (the demo sites are plain words), so the app knows where to load them from. */
export const isCustomSite = (id: string) => /^a-[0-9a-f]{10}$/.test(id);

// Roughly India's bounding box: the cost rates, IMD storm categories and heat scenarios assume an Indian city.
export const INDIA = { s: 6.5, n: 37.5, w: 68, e: 97.5 };

/** Returns an error message, or null when the request is usable. */
export function validateAreaRequest(x: unknown): string | null {
  const r = x as AreaRequest;
  if (!r || typeof r !== 'object') return 'Expected a JSON object';
  if (typeof r.lat !== 'number' || typeof r.lon !== 'number' || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return 'lat and lon must be numbers';
  if (r.lat < INDIA.s || r.lat > INDIA.n || r.lon < INDIA.w || r.lon > INDIA.e) return 'HYDRA covers neighbourhoods in India only';
  if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 60) return 'Give the area a name (up to 60 characters)';
  if (typeof r.city !== 'string' || r.city.length > 40 || typeof r.state !== 'string' || r.state.length > 40) return 'city and state must be text (up to 40 characters)';
  if (!(r.soil in SOILS)) return `soil must be one of ${Object.keys(SOILS).join(', ')}`;
  return null;
}

/** Site settings for the flood builder (scripts/lib/site-builder.mjs) from a request. */
export function areaSettings(r: AreaRequest) {
  const soil = SOILS[r.soil];
  return {
    name: r.name.trim(), city: r.city.trim() || 'Custom area', state: r.state.trim(), lat: r.lat, lon: r.lon,
    soil: { name: soil.name, factor: soil.factor },
    smoothSigma: 5, levels: [1, 2, 2, 3, 3, 4], infill: 0.5, ground: '#d4c6a6',
    blurb: `Added by a HYDRA user at ${r.lat.toFixed(4)}° N, ${r.lon.toFixed(4)}° E. Soil, as chosen by the user: ${soil.name}.`,
  };
}
