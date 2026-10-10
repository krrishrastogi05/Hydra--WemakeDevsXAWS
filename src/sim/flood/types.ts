// Flood-mode types: interventions, storms, results.

export type InterventionType = 'drain' | 'garden' | 'rwh' | 'pit' | 'desilt';
export interface Intervention {
  id: string;
  type: InterventionType;
  cells?: number[];      // drain path, garden footprint, pit cell
  building?: number;     // rwh
  unit?: number;         // desilt (drain unit id = road id)
  source?: 'user' | 'hydra' | 'spread';
  reason?: string;       // why the optimizer picked it
}

export type StormProfile = 'peaked' | 'uniform';
export interface Storm { id: string; name: string; totalMm: number; durationMin: number; profile: StormProfile; note: string }
export type Antecedent = 'dry' | 'normal' | 'wet';
export interface SimOptions {
  storm: Storm; antecedent: Antecedent;
  recessionMin?: number;   // minutes simulated after the rain stops
  frameEveryMin?: number;  // animation frame spacing
  dt?: number;             // seconds
  keepFrames?: boolean;    // false for optimizer runs
}

export interface WaterBudget {
  rain: number; infiltrated: number; harvested: number; gardens: number; pits: number;
  drains: number; channel: number; edge: number; standingEnd: number; drainStore: number; error: number;
}
export interface Metrics {
  rainMm: number; rainVolume: number; runoffVolume: number; peakPonded: number; endPonded: number;
  floodedArea: number; maxDepth: number; roadKm: number; roadKmAffected: number; roadKmHours: number;
  buildingsAtRisk: number; buildingsFlooded: number; residentsAffected: number; criticalAffected: number;
  drainSurcharge: number; impact: number;
}
export interface Hotspot {
  cell: number; x: number; z: number; maxDepth: number; area: number; volume: number;
  road: string; buildingsFlooded: number; impact: number;
}
export interface SimResult {
  n: number; nFrames: number;
  frames: Uint16Array | null;        // nFrames * n, depth in mm
  frameTimes: Float32Array;          // minutes
  rainSeries: Float32Array;          // mm/h at each frame
  pondedSeries: Float32Array;        // m3 of standing water on land at each frame
  drainCells: Int32Array;            // cells that carry a drain
  drainFrames: Uint8Array | null;    // nFrames * drainCells.length, utilisation 0..255 (255 = surcharging)
  maxDepth: Float32Array;            // m
  timeOver: Float32Array;            // minutes above the road-stop depth
  surcharge: Float32Array;           // m3 surcharged from drains back to the street, per cell
  doorstep: Float32Array;            // max depth at each building's frontage
  drainDown: Int32Array;             // downstream drain cell (-1 outfall, -2 not connected), per drain cell
  throughVol: Float32Array;          // m3 of runoff that passed each cell during the event
  drainPeak: Float32Array;           // per cell: peak drain utilisation (0..1), 2 = surcharged
  drainCap: Float32Array;            // per cell: effective drain capacity, m3/s (0 = no drain)
  lakeSpill: Float32Array;           // m3 each low spot passed on downstream once full
  lakeInflow: Float32Array;          // m3 that reached each low spot
  metrics: Metrics; budget: WaterBudget; hotspots: Hotspot[];
  cost: number; runtimeMs: number;
}
