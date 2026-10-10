/// <reference lib="webworker" />
// Runs the engine off the main thread. Requests: load | simulate | optimize | showdown.
import { loadGrid, type Grid } from '../grid';
import { simulate } from './engine';
import { recommend, showdown } from './optimizer';
import type { SiteData } from '../types';
import type { Intervention, SimOptions, SimResult } from './types';

let grid: Grid | null = null;
const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const buffers = (r: SimResult) => [r.frames, r.drainFrames, r.maxDepth, r.timeOver, r.surcharge, r.doorstep, r.throughVol, r.drainPeak, r.drainCap, ...(r.live ? Object.values(r.live) : [])]
  .filter((a): a is NonNullable<typeof a> => !!a).map(a => a.buffer as ArrayBuffer);

self.onmessage = (e: MessageEvent) => {
  const { id, kind } = e.data as { id: number; kind: string };
  try {
    if (kind === 'load') { grid = loadGrid(e.data.site as SiteData); post({ id, ok: true }); return; }
    if (!grid) throw new Error('No site loaded');
    const opts = e.data.opts as SimOptions;
    if (kind === 'simulate') {
      const r = simulate(grid, e.data.plan as Intervention[], opts);
      post({ id, ok: true, data: r }, buffers(r));
    } else if (kind === 'optimize') {
      post({ id, ok: true, data: recommend(grid, opts, e.data.budget, e.data.base, (p, msg) => post({ id, progress: p, msg })) });
    } else if (kind === 'showdown') {
      post({ id, ok: true, data: showdown(grid, opts, e.data.budget, (p, msg) => post({ id, progress: p, msg })) });
    }
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
