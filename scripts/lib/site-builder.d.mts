// Types for site-builder.mjs, so the TypeScript backend can import it.
import type { SiteData } from '../../src/sim/types';

export interface RawCache { get(key: string): Promise<Buffer | null>; set(key: string, buf: Buffer): Promise<void> }
export interface SiteSettings {
  name: string; city: string; state: string; lat: number; lon: number;
  soil: { name: string; factor: number }; smoothSigma: number; levels: number[]; infill: number; ground: string; blurb: string;
}
export const CELL: number;
export const HALF: number;
export function memoryCache(): RawCache;
export function buildSite(id: string, settings: SiteSettings, io?: { cache?: RawCache; stage?: (msg: string) => void }): Promise<SiteData>;
