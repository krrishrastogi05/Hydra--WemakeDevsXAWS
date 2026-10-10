// The /calc routes: the engine (src/sim, the same code as the browser's Web Workers) run on the server.
//   POST /calc/{flood|heat}/simulate   -> the full result: every number in the Results tab and the map's animation
//                                         (binary, src/shared/wire.ts; under 1 MB gzipped even for a 6 h storm)
//   POST /calc/{flood|heat}/optimize   -> HYDRA's recommended plan for a budget (JSON)
//   POST /calc/{flood|heat}/showdown   -> no action vs even spread vs HYDRA for a budget (JSON)
// The browser sends ids and a plan. The server loads the neighbourhood itself, builds the storm or the day with the
// shared run settings, checks every intervention with the map's placement rules and recomputes costs, so no number
// in a result comes from the client.
import fs from 'node:fs/promises';
import path from 'node:path';
import { isCustomSite } from '../../src/shared/area';
import { floodRunOptions, heatRunOptions, validateCalc, type CalcMode, type CalcOp, type FloodCalc, type HeatCalc } from '../../src/shared/calc';
import { pack } from '../../src/shared/wire';
import { loadGrid, type Grid } from '../../src/sim/grid';
import { simulate } from '../../src/sim/flood/engine';
import { validate } from '../../src/sim/flood/model';
import { recommend, showdown } from '../../src/sim/flood/optimizer';
import { simulateHeat } from '../../src/sim/heat/engine';
import { validateHeat } from '../../src/sim/heat/model';
import { recommendHeat, showdownHeat } from '../../src/sim/heat/optimizer';
import type { HeatSite } from '../../src/sim/heat/types';
import type { SiteData, SiteSummary } from '../../src/sim/types';
import type { Config } from './config';
import { HttpError, send, type Res } from './http';
import { areaFile } from './jobs';
import type { Store } from './store';

export async function calc(cfg: Config, store: Store, mode: CalcMode, op: CalcOp, body: unknown, gzip: boolean): Promise<Res> {
  const err = validateCalc(mode, op, body);
  if (err) throw new HttpError(400, err);
  const t0 = Date.now();
  const result = mode === 'flood' ? await flood(cfg, store, op, body as FloodCalc) : await heat(cfg, store, op, body as HeatCalc);
  const timing = { 'server-timing': `engine;dur=${Date.now() - t0}` };
  return op === 'simulate'
    ? send(cfg, pack(result), 'application/octet-stream', gzip, timing)
    : send(cfg, JSON.stringify(result), 'application/json', gzip, timing);
}

async function flood(cfg: Config, store: Store, op: CalcOp, r: FloodCalc) {
  const grid = await siteGrid(cfg, store, r.siteId);
  checkPlan(r.plan ?? [], (iv, before) => validate(grid, iv, before));
  const opts = floodRunOptions(r.stormId, r.antecedent, op === 'simulate');
  if (op === 'simulate') return simulate(grid, r.plan ?? [], opts);
  if (op === 'optimize') return recommend(grid, opts, r.budget!, r.plan ?? []);
  return showdown(grid, opts, r.budget!);
}

async function heat(cfg: Config, store: Store, op: CalcOp, r: HeatCalc) {
  const [grid, hs] = await Promise.all([siteGrid(cfg, store, r.siteId), siteHeat(cfg, store, r.siteId)]);
  checkPlan(r.plan ?? [], (iv, before) => validateHeat(grid, hs, iv, before));
  const opts = heatRunOptions(r.scenarioId, r.windowId, op === 'simulate');
  if (op === 'simulate') return simulateHeat(grid, hs, r.plan ?? [], opts);
  if (op === 'optimize') return recommendHeat(grid, hs, opts, r.budget!, r.plan ?? []);
  return showdownHeat(grid, hs, opts, r.budget!);
}

/** Checks each intervention against the ones before it, as the map does when they are placed one by one. */
function checkPlan<T extends { type: string }>(plan: T[], check: (iv: T, before: T[]) => string | null) {
  const before: T[] = [];
  plan.forEach((iv, k) => {
    const e = check(iv, before);
    if (e) throw new HttpError(400, `Intervention ${k + 1} (${iv.type}): ${e}`);
    before.push(iv);
  });
}

// Neighbourhoods stay in memory while the Lambda is warm: reading a site and building its grid takes ~100 ms.
const grids = new Map<string, Promise<Grid>>(), heats = new Map<string, Promise<HeatSite>>();
let demos: Promise<Set<string>> | null = null;

function cached<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>) {
  let p = map.get(key);
  if (!p) {
    p = load();
    map.set(key, p);
    p.catch(() => map.delete(key));
    if (map.size > 8) map.delete(map.keys().next().value!);
  }
  return p;
}
const siteGrid = (cfg: Config, store: Store, id: string) => cached(grids, id, async () => loadGrid(JSON.parse(await siteFile(cfg, store, id, 'data')) as SiteData));
const siteHeat = (cfg: Config, store: Store, id: string) => cached(heats, id, async () => JSON.parse(await siteFile(cfg, store, id, 'heat')) as HeatSite);

/** The demo cities ship with the API (copied from public/data at build time); added areas come from storage. */
async function siteFile(cfg: Config, store: Store, id: string, kind: 'data' | 'heat') {
  if (isCustomSite(id)) {
    const body = await store.getFile(areaFile(id, kind));
    if (body == null) throw new HttpError(404, 'This area is not built yet');
    return body;
  }
  demos ??= fs.readFile(path.join(cfg.siteDir, 'sites.json'), 'utf8')
    .then(s => new Set((JSON.parse(s) as SiteSummary[]).map(x => x.id)), e => { demos = null; throw e; });
  if (!(await demos).has(id)) throw new HttpError(404, `Unknown neighbourhood "${id}"`);
  return fs.readFile(path.join(cfg.siteDir, `${id}${kind === 'heat' ? '.heat' : ''}.json`), 'utf8');
}
