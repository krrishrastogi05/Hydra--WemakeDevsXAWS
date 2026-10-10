// HTTP API, independent of the transport: the Lambda handler (API Gateway HTTP API) and the local dev server both
// call handle(). Routes:
//   GET  /health
//   POST /plans             -> 201 { id }                                             GET /plans/{id}
//   POST /areas             -> 202 area status                                        GET /areas/{id}
//   GET  /areas/{id}/data   GET /areas/{id}/heat   (the built area, once ready)
//   POST /calc/{flood|heat}/{simulate|optimize|showdown}   (calc.ts: the engine, run on the server)
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { validateAreaRequest, type AreaMeta, type AreaRequest } from '../../src/shared/area';
import type { CalcMode, CalcOp } from '../../src/shared/calc';
import { validateNewPlan, type NewPlan, type SavedPlan } from '../../src/shared/plan';
import { calc } from './calc';
import type { Config } from './config';
import { HttpError, cors, json, type Req, type Res } from './http';
import { areaFile, areaKey, dispatch } from './jobs';
import type { Store } from './store';

const MAX_BODY = 400_000;
const STALE_MS = 10 * 60_000;   // a job not updated for this long is assumed lost and may be restarted
const now = () => new Date().toISOString();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const newId = () => { const a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = randomBytes(10); return Array.from(b, x => a[x % a.length]).join(''); };
const stale = (t: string) => Date.now() - Date.parse(t) > STALE_MS;

function parse(body: string | null): unknown {
  if (!body) throw new HttpError(400, 'Expected a JSON body');
  if (body.length > MAX_BODY) throw new HttpError(413, 'Request body is too large');
  try { return JSON.parse(body); } catch { throw new HttpError(400, 'Body is not valid JSON'); }
}

export async function handle(cfg: Config, store: Store, req: Req): Promise<Res> {
  try {
    if (req.method === 'OPTIONS') return { status: 204, headers: cors(cfg), body: '' };
    const parts = req.path.replace(/\/+$/, '').split('/').filter(Boolean), [root, id, sub] = parts;
    const route = `${req.method} /${root ?? ''}${id ? '/:id' : ''}${sub ? `/${sub}` : ''}`;
    if (id && !/^[A-Za-z0-9-]{1,40}$/.test(id)) throw new HttpError(404, 'Not found');
    switch (route) {
      case 'GET /health': return json(cfg, 200, { ok: true, storage: cfg.storage });
      case 'POST /plans': return await createPlan(cfg, store, parse(req.body));
      case 'GET /plans/:id': return await getRecord(cfg, store, `plan#${id}`, (p: SavedPlan) => p, { 'cache-control': 'public, max-age=31536000, immutable' });
      case 'POST /areas': return await createArea(cfg, store, parse(req.body));
      case 'GET /areas/:id': return await getRecord(cfg, store, areaKey(id), (a: AreaMeta) => a);
      case 'GET /areas/:id/data': case 'GET /areas/:id/heat': return await areaData(cfg, store, id, sub as 'data' | 'heat', !!req.acceptGzip);
      case 'POST /calc/:id/simulate': case 'POST /calc/:id/optimize': case 'POST /calc/:id/showdown':
        if (id !== 'flood' && id !== 'heat') throw new HttpError(404, 'Not found');
        return await calc(cfg, store, id as CalcMode, sub as CalcOp, parse(req.body), !!req.acceptGzip);
      default: throw new HttpError(404, 'Not found');
    }
  } catch (e) {
    if (e instanceof HttpError) return json(cfg, e.status, { error: e.message });
    console.error(e);
    return json(cfg, 500, { error: 'Internal error' });
  }
}

async function getRecord<T>(cfg: Config, store: Store, key: string, view: (r: T) => unknown, headers?: Record<string, string>) {
  const r = await store.get<T>(key);
  if (!r) throw new HttpError(404, 'Not found');
  return json(cfg, 200, view(r), headers);
}

async function createPlan(cfg: Config, store: Store, body: unknown) {
  const err = validateNewPlan(body);
  if (err) throw new HttpError(400, err);
  const p = body as NewPlan;
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newId(), saved = { ...p, id, v: 1, createdAt: now() } as SavedPlan;
    if (await store.put(`plan#${id}`, saved, { ifAbsent: true })) return json(cfg, 201, { id });
  }
  throw new HttpError(500, 'Could not allocate a plan id');
}

async function createArea(cfg: Config, store: Store, body: unknown) {
  const err = validateAreaRequest(body);
  if (err) throw new HttpError(400, err);
  const b = body as AreaRequest;
  const request: AreaRequest = { lat: +b.lat.toFixed(5), lon: +b.lon.toFixed(5), name: b.name.trim(), city: b.city.trim(), state: b.state.trim(), soil: b.soil };
  // The same spot (to ~10 m), soil and name always map to the same area, so a repeat request reuses the build.
  const id = 'a-' + sha(JSON.stringify([request.lat.toFixed(4), request.lon.toFixed(4), request.soil, request.name, request.city, request.state])).slice(0, 10);
  const old = await store.get<AreaMeta>(areaKey(id));
  if (old && (old.status === 'ready' || ((old.status === 'queued' || old.status === 'building') && !stale(old.updatedAt)))) return json(cfg, old.status === 'ready' ? 200 : 202, old);
  const meta: AreaMeta = { id, status: 'queued', stage: 'Waiting to start', request, createdAt: old?.createdAt ?? now(), updatedAt: now() };
  await store.put(areaKey(id), meta);
  await dispatch(cfg, store, { kind: 'area', id });
  return json(cfg, 202, meta);
}

async function areaData(cfg: Config, store: Store, id: string, kind: 'data' | 'heat', gzip: boolean): Promise<Res> {
  const body = await store.getFile(areaFile(id, kind));
  if (body == null) throw new HttpError(404, 'This area is not built yet');
  // A built area never changes, so browsers and CDNs may keep it.
  const headers = { ...cors(cfg), 'content-type': 'application/json', 'cache-control': 'public, max-age=31536000, immutable' };
  return gzip ? { status: 200, headers: { ...headers, 'content-encoding': 'gzip' }, body: gzipSync(body) } : { status: 200, headers, body };
}
