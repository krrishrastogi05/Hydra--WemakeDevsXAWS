// API tests against local storage (no AWS, no network).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, describe, it } from 'node:test';
import { handle } from '../src/api';
import { config } from '../src/config';
import { areaFile } from '../src/jobs';
import { localStore } from '../src/store';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-api-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const cfg = { ...config(), storage: 'local' as const, dataDir: dir };
const store = localStore(dir);
const call = async (method: string, p: string, body?: unknown) => {
  const res = await handle(cfg, store, { method, path: p, body: body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body) });
  return { ...res, json: res.body && !Buffer.isBuffer(res.body) ? JSON.parse(res.body) : null };
};

const PLAN = {
  siteId: 'gurugram', siteName: 'Jacobpura, Old Gurugram', mode: 'flood',
  settings: { stormId: 'heavy', antecedent: 'normal', budget: 25e5 },
  plan: [{ id: 'iv1', type: 'pit', cells: [5000], source: 'hydra', reason: 'Low spot' }, { id: 'iv2', type: 'desilt', unit: 3, source: 'user' }],
};

describe('HYDRA API', () => {
  it('reports health and answers CORS preflight', async () => {
    const h = await call('GET', '/health');
    assert.equal(h.status, 200);
    assert.deepEqual(h.json, { ok: true, storage: 'local' });
    const o = await call('OPTIONS', '/plans');
    assert.equal(o.status, 204);
    assert.equal(o.headers['access-control-allow-origin'], '*');
  });

  it('saves and reloads a plan', async () => {
    const c = await call('POST', '/plans', PLAN);
    assert.equal(c.status, 201);
    assert.match(c.json.id, /^[A-Za-z0-9]{10}$/);
    const g = await call('GET', `/plans/${c.json.id}`);
    assert.equal(g.status, 200);
    assert.deepEqual(g.json.plan, PLAN.plan);
    assert.equal(g.json.mode, 'flood');
    assert.equal((await call('GET', '/plans/nope')).status, 404);
  });

  it('rejects malformed plans and bodies', async () => {
    assert.equal((await call('POST', '/plans', { ...PLAN, mode: 'storm' })).status, 400);
    assert.equal((await call('POST', '/plans', { ...PLAN, plan: [{ id: 'x', type: 'tree', cells: [1] }] })).status, 400);
    assert.equal((await call('POST', '/plans', { ...PLAN, plan: [] })).status, 400);
    assert.equal((await call('POST', '/plans', '{not json')).status, 400);
    assert.equal((await call('POST', '/plans', 'x'.repeat(500_000))).status, 413);
  });

  it('validates new areas and serves built ones gzipped', async () => {
    const ok = { lat: 28.46, lon: 77.03, name: 'Test', city: 'Gurugram', state: 'Haryana', soil: 'loam' };
    assert.equal((await call('POST', '/areas', { ...ok, lat: 51.5, lon: -0.1 })).status, 400);
    assert.equal((await call('POST', '/areas', { ...ok, soil: 'sand' })).status, 400);
    assert.equal((await call('POST', '/areas', { ...ok, name: ' ' })).status, 400);
    assert.equal((await call('GET', '/areas/a-0123456789/data')).status, 404);
    await store.putFile(areaFile('a-0123456789', 'data'), '{"id":"a-0123456789"}');
    const res = await handle(cfg, store, { method: 'GET', path: '/areas/a-0123456789/data', body: null, acceptGzip: true });
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(gunzipSync(res.body as Buffer).toString(), '{"id":"a-0123456789"}');
  });

  it('returns 404 for unknown routes', async () => {
    assert.equal((await call('GET', '/nothing')).status, 404);
    assert.equal((await call('POST', '/briefs', {})).status, 404);
    assert.equal((await call('DELETE', '/plans/abc')).status, 404);
  });
});
