/// <reference lib="webworker" />
// Runs the heat engine off the main thread. Requests: load | simulate | optimize | showdown. Independent of the flood worker.
import { loadGrid, type Grid } from '../grid';
import type { SiteData } from '../types';
import { simulateHeat } from './engine';
import { recommendHeat, showdownHeat } from './optimizer';
import type { HeatIntervention, HeatOptions, HeatResult, HeatSite } from './types';

let grid: Grid | null = null, heat: HeatSite | null = null;
const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const buffers = (r: HeatResult) => [r.frames, r.sunFrac, r.sunHours, r.surface, r.exposure, r.weight]
  .filter((a): a is NonNullable<typeof a> => !!a).map(a => a.buffer as ArrayBuffer);

self.onmessage = (e: MessageEvent) => {
  const { id, kind } = e.data as { id: number; kind: string };
  try {
    if (kind === 'load') { grid = loadGrid(e.data.site as SiteData); heat = e.data.heat as HeatSite; post({ id, ok: true }); return; }
    if (!grid || !heat) throw new Error('No site loaded');
    const opts = e.data.opts as HeatOptions;
    if (kind === 'simulate') {
      const r = simulateHeat(grid, heat, e.data.plan as HeatIntervention[], opts);
      post({ id, ok: true, data: r }, buffers(r));
    } else if (kind === 'optimize') {
      post({ id, ok: true, data: recommendHeat(grid, heat, opts, e.data.budget, e.data.base, (p, msg) => post({ id, progress: p, msg })) });
    } else if (kind === 'showdown') {
      post({ id, ok: true, data: showdownHeat(grid, heat, opts, e.data.budget, (p, msg) => post({ id, progress: p, msg })) });
    }
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
