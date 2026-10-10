// Shared site types (both modes). Flood types live in ./flood/types, heat types in ./heat/types.

export const COVER = { OPEN: 0, ROAD: 1, BUILDING: 2, GREEN: 3, WATER: 4, PAVED: 5, CHANNEL: 6 } as const;
export const COVER_NAMES = ['Open ground (kutcha)', 'Road', 'Building', 'Green space', 'Pond / lake', 'Paved yard', 'River / nala'];

export interface SiteBuilding {
  id: number; name: string; use: string; critical: boolean; levels: number; levelsSynthetic: boolean;
  plinth: number; area: number; residents: number; synthetic: boolean; poly: [number, number][];
}
export interface SiteRoad { id: number; name: string; cls: string; width: number; length: number; pts: [number, number][] }
export interface SiteDrainUnit { id: number; cap: number; silt: number; cells: number }
export interface SiteData {
  id: string; name: string; city: string; state: string; center: [number, number]; blurb: string; groundColor: string;
  cellSize: number; nx: number; ny: number; zBase: number;
  soil: { name: string; factor: number };
  z: number[]; cover: string; bldg: number[]; road: number[]; drain: number[];
  buildings: SiteBuilding[]; roads: SiteRoad[]; drains: SiteDrainUnit[];
  outfalls: { cell: number; kind: 'boundary' | 'channel' | 'pond' }[];
  waterBodies: { name: string; kind: string; poly: [number, number][] }[];
  waterways: { name: string; kind: string; pts: [number, number][] }[];
  labels: { text: string; x: number; z: number; kind: string }[];
  stats: { osmBuildings: number; syntheticBuildings: number; roads: number; drainCells: number; relief: number };
  provenance: { terrain: string; osm: string; synthetic: string[] };
}
export interface SiteSummary { id: string; name: string; city: string; state: string; blurb: string }

