// Types for heat-builder.mjs, so the TypeScript backend can import it.
import type { SiteData } from '../../src/sim/types';
import type { HeatSite } from '../../src/sim/heat/types';
import type { RawCache } from './site-builder.mjs';

export function buildHeat(site: SiteData, io?: { cache?: RawCache; stage?: (msg: string) => void }): Promise<HeatSite>;
