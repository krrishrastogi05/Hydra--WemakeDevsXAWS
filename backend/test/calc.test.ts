// The /calc routes against the engine itself: a result from the API must equal a direct run of src/sim, number for
// number (local storage, no AWS or network).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, describe, it } from 'node:test';
import { handle } from '../src/api';
import { config } from '../src/config';
import { localStore } from '../src/store';
import { floodRunOptions, heatRunOptions } from '../../src/shared/calc';
import { unpack } from '../../src/shared/wire';
import { loadGrid } from '../../src/sim/grid';
import { simulate } from '../../src/sim/flood/engine';
import { simulateHeat } from '../../src/sim/heat/engine';
import type { SimResult } from '../../src/sim/flood/types';
import type { HeatResult } from '../../src/sim/heat/types';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-calc-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const cfg = { ...config(), storage: 'local' as const, dataDir: dir };
const store = localStore(dir);
const post = (p: string, body: unknown, acceptGzip = false) => handle(cfg, store, { method: 'POST', path: p, body: JSON.stringify(body), acceptGzip });
const asJson = (body: string | Buffer) => JSON.parse(body.toString());
const asResult = <T>(b: Buffer) => unpack<T>(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(cfg.siteDir, file), 'utf8'));

const FLOOD = { siteId: 'gurugram', stormId: 'heavy', antecedent: 'normal', plan: [] };
const HEAT = { siteId: 'chennai', scenarioId: 'heatwave', windowId: 'afternoon', plan: [] };

describe('calculation API', () => {
  it('runs a storm with exactly the numbers of a direct engine run', async () => {
    const res = await post('/calc/flood/simulate', FLOOD, true);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'gzip');
    const r = asResult<SimResult>(gunzipSync(res.body as Buffer));
    const direct = simulate(loadGrid(read('gurugram.json')), [], floodRunOptions('heavy', 'normal'));
    assert.deepEqual(r.metrics, direct.metrics);
    assert.deepEqual(r.budget, direct.budget);
    assert.deepEqual(r.hotspots, direct.hotspots);
    assert.ok(r.frames instanceof Uint16Array && bytes(r.frames).equals(bytes(direct.frames!)));
    assert.ok(bytes(r.maxDepth).equals(bytes(direct.maxDepth)));
  });

  it('recommends a plan, and the server re-runs it to the predicted numbers', async () => {
    const o = await post('/calc/flood/optimize', { ...FLOOD, budget: 10e5 });
    assert.equal(o.status, 200);
    const rec = asJson(o.body);
    assert.ok(rec.plan.length > 0 && rec.cost <= 10e5);
    const again = await post('/calc/flood/simulate', { ...FLOOD, plan: rec.plan });
    assert.equal(again.status, 200);
    assert.deepEqual(asResult<SimResult>(again.body as Buffer).metrics, rec.metrics);
  });

  it('runs the budget showdown', async () => {
    const res = await post('/calc/flood/showdown', { ...FLOOD, budget: 10e5 });
    assert.equal(res.status, 200);
    const sd = asJson(res.body);
    assert.equal(sd.spreads.length, 3);
    assert.ok(sd.hydra.metrics.impact < sd.base.impact);
  });

  it('traces a day and recommends shade the same way', async () => {
    const res = await post('/calc/heat/simulate', HEAT);
    assert.equal(res.status, 200);
    const direct = simulateHeat(loadGrid(read('chennai.json')), read('chennai.heat.json'), [], heatRunOptions('heatwave', 'afternoon'));
    assert.deepEqual(asResult<HeatResult>(res.body as Buffer).metrics, direct.metrics);
    const rec = asJson((await post('/calc/heat/optimize', { ...HEAT, budget: 5e5 })).body);
    assert.ok(rec.plan.length > 0 && rec.cost <= 5e5);
    const again = await post('/calc/heat/simulate', { ...HEAT, plan: rec.plan });
    assert.deepEqual(asResult<HeatResult>(again.body as Buffer).metrics, rec.metrics);
    assert.equal(asJson((await post('/calc/heat/showdown', { ...HEAT, budget: 5e5 })).body).spreads.length, 3);
  });

  it('rejects bad requests and placements the map would not allow', async () => {
    assert.equal((await post('/calc/flood/simulate', { ...FLOOD, stormId: 'tsunami' })).status, 400);
    assert.equal((await post('/calc/heat/simulate', { ...HEAT, windowId: 'night' })).status, 400);
    assert.equal((await post('/calc/flood/optimize', FLOOD)).status, 400);   // no budget
    assert.equal((await post('/calc/flood/simulate', { ...FLOOD, siteId: 'atlantis' })).status, 404);
    assert.equal((await post('/calc/flood/simulate', { ...FLOOD, siteId: 'a-0123456789' })).status, 404);   // area not built
    assert.equal((await post('/calc/rain/simulate', FLOOD)).status, 404);
    const g = loadGrid(read('gurugram.json')), roof = g.bCells.find(c => c.length)![0];
    const bad = await post('/calc/flood/simulate', { ...FLOOD, plan: [{ id: 'p1', type: 'pit', cells: [roof] }] });
    assert.equal(bad.status, 400);
    assert.match(asJson(bad.body).error, /^Intervention 1 \(pit\): Recharge pits go on/);
  });
});
