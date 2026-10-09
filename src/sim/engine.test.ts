import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { loadGrid, STORMS } from './model';
import { simulate } from './engine';
import type { SiteData } from './types';

const load = (id: string) => loadGrid(JSON.parse(fs.readFileSync(`public/data/${id}.json`, 'utf8')) as SiteData);
const storm = STORMS.find(s => s.id === 'veryheavy')!;

describe('engine', () => {
  for (const id of ['gurugram', 'chennai', 'ranchi']) {
    it(`${id}: conserves mass and reports metrics`, () => {
      const g = load(id);
      const r = simulate(g, [], { storm, antecedent: "normal", keepFrames: false, dt: Number(process.env.DT ?? 60) });
      const m = r.metrics, b = r.budget;
      console.log(id, `${r.runtimeMs.toFixed(0)} ms`, JSON.stringify({
        rain: Math.round(b.rain), infil: Math.round(b.infiltrated), drains: Math.round(b.drains), edge: Math.round(b.edge),
        standing: Math.round(b.standingEnd), drainStore: Math.round(b.drainStore), err: b.error.toFixed(2),
        flooded: Math.round(m.floodedArea), maxDepth: m.maxDepth.toFixed(2), roadKmAff: m.roadKmAffected.toFixed(2),
        roadKmH: m.roadKmHours.toFixed(2), bFlooded: m.buildingsFlooded, atRisk: m.buildingsAtRisk, residents: m.residentsAffected,
        impact: Math.round(m.impact), hotspots: r.hotspots.slice(0, 3).map(h => `${h.road} ${h.maxDepth.toFixed(2)}m`),
      }));
      expect(Math.abs(b.error) / b.rain).toBeLessThan(0.01);
      expect(m.floodedArea).toBeGreaterThan(0);
    });
  }
});
