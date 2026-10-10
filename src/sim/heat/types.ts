// Heat-mode types: trees, pedestrian places, interventions, scenarios, results. Independent of the flood types.

export interface HeatTree { cell: number; x: number; z: number; h: number; r: number; synthetic: boolean }
export type ReceptorKind = 'bus_stop' | 'market' | 'school' | 'hospital' | 'public_space';
export interface HeatReceptor { id: number; kind: ReceptorKind; name: string; cells: number[]; x: number; z: number; footfall: number; synthetic: boolean }
export interface HeatSite {
  id: string; trees: HeatTree[]; receptors: HeatReceptor[];
  stats: { osmTrees: number; syntheticTrees: number; osmReceptors: number; syntheticReceptors: number };
  provenance: { osm: string; synthetic: string[] };
}

export type HeatInterventionType = 'tree' | 'canopy' | 'walkway' | 'coolroof';
export interface HeatIntervention {
  id: string;
  type: HeatInterventionType;
  cells?: number[];      // tree cell, canopy cell, walkway path
  building?: number;     // cool roof
  source?: 'user' | 'hydra' | 'spread';
  reason?: string;
}

export interface HeatScenario { id: string; name: string; doy: number; tempC: number; rh: number; windMs: number; cloud: number; note: string }
export interface HeatWindow { id: string; name: string; start: number; end: number }   // local hours (IST)
export interface HeatOptions { scenario: HeatScenario; window: HeatWindow; keepFrames?: boolean }

export interface SunStep { hour: number; elev: number; az: number; dni: number }   // degrees, degrees from north clockwise, W/m²

export interface HeatMetrics {
  weightedIndex: number;      // footfall-weighted mean exposure index over pedestrian space (0–100)
  meanIndex: number;          // plain mean over pedestrian cells
  exposedArea: number;        // m² of pedestrian space in direct sun at the window's sunniest step
  exposedShare: number;       // 0..1 of pedestrian area
  shadeShare: number;         // 0..1 time-and-area-averaged shade over pedestrian space
  receptorShade: number;      // 0..1 mean shade over bus stops, markets, gates and parks
  hotReceptors: number;       // places with index >= HIGH
  sunHours: number;           // mean hours of direct sun on pedestrian space in the window
  roofHeat: number;           // MWh of solar heat absorbed by roofs in the window
  pedArea: number;            // m² of pedestrian space considered
}
export interface ReceptorScore { id: number; index: number; shade: number; sunHours: number }
export interface HeatHotspot { kind: ReceptorKind | 'street'; name: string; x: number; z: number; index: number; shade: number; sunHours: number; receptor?: number }

export interface HeatResult {
  n: number;
  steps: SunStep[];                 // every half hour, 06:00–19:00
  frames: Uint8Array | null;        // steps.length * n: share of direct sun reaching 1.1 m above the ground (255 = full sun)
  sunFrac: Float32Array;            // 0..1 share of the window's available direct sun that reaches each cell
  sunHours: Float32Array;           // hours of direct sun in the window
  surface: Float32Array;            // 0..1 surface heating term
  exposure: Float32Array;           // 0..100 relative exposure index (pedestrian cells; 0 elsewhere)
  weight: Float32Array;             // footfall weight (0 = not pedestrian space)
  heatIndexC: number;               // NOAA heat index of the air (shade), °C
  ambient: number;                  // 0..1 ambient term
  receptors: ReceptorScore[];
  hotspots: HeatHotspot[];
  metrics: HeatMetrics;
  cost: number; runtimeMs: number;
  source?: 'server' | 'browser';       // where it was calculated (set by src/simClient.ts, not the engine)
}
