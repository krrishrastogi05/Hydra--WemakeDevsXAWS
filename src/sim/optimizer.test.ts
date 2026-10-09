import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { loadGrid, planCost, STORMS, CATALOG } from './model';
import { simulate } from './engine';
import { evenSpread, optimize } from './optimizer';
import type { SiteData } from './types';

const load = (id: string) => loadGrid(JSON.parse(fs.readFileSync(`public/data/${id}.json`, 'utf8')) as SiteData);
const opt = { storm: STORMS.find(s => s.id === 'veryheavy')!, antecedent: 'normal' as const };
const BUDGET = 25e5;

describe('optimizer', () => {
  for (const id of ['gurugram', 'chennai', 'ranchi']) {
    it(`${id}: data-driven plan beats an even spread of the same budget`, () => {
      const g = load(id);
      const t0 = Date.now();
      const base = simulate(g, [], { ...opt, keepFrames: false }).metrics;
      const spreads = [1, 2, 3].map(seed => { const p = evenSpread(g, BUDGET, seed); return { cost: planCost(g, p), m: simulate(g, p, { ...opt, keepFrames: false }).metrics }; });
      const o = optimize(g, { ...opt, budget: BUDGET });
      const cost = planCost(g, o.plan), m = o.result.metrics;
      const avg = (k: 'impact' | 'buildingsFlooded' | 'roadKmAffected') => spreads.reduce((s, x) => s + x.m[k], 0) / spreads.length;
      const mix: Record<string, number> = {};
      for (const iv of o.plan) mix[CATALOG[iv.type].short] = (mix[CATALOG[iv.type].short] ?? 0) + 1;
      console.log(id, `${Date.now() - t0} ms`, JSON.stringify({
        impact: [Math.round(base.impact), Math.round(avg('impact')), Math.round(m.impact)],
        bFlooded: [base.buildingsFlooded, +avg('buildingsFlooded').toFixed(1), m.buildingsFlooded],
        roadKm: [+base.roadKmAffected.toFixed(2), +avg('roadKmAffected').toFixed(2), +m.roadKmAffected.toFixed(2)],
        cost: [Math.round(spreads[0].cost), Math.round(cost)], rounds: o.rounds.map(Math.round), mix,
      }));
      console.log(id, 'top picks:', o.plan.slice(0, 4).map(p => p.reason).join(' | '));
      expect(cost).toBeLessThanOrEqual(BUDGET);
      expect(m.impact).toBeLessThan(avg('impact'));
    });
  }
});
