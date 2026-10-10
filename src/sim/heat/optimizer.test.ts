import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { loadGrid } from '../grid';
import type { SiteData } from '../types';
import { simulateHeat } from './engine';
import { HEAT_CATALOG, HEAT_SCENARIOS, HEAT_WINDOWS, heatPlanCost } from './model';
import { heatEvenSpread, optimizeHeat } from './optimizer';
import type { HeatSite } from './types';

const BUDGET = 25e5;
const opt = { scenario: HEAT_SCENARIOS[0], window: HEAT_WINDOWS[0], keepFrames: false };

describe('heat optimizer', () => {
  for (const id of ['gurugram', 'chennai', 'ranchi']) {
    it(`${id}: data-driven shade plan beats an even spread of the same budget`, () => {
      const g = loadGrid(JSON.parse(fs.readFileSync(`public/data/${id}.json`, 'utf8')) as SiteData);
      const hs = JSON.parse(fs.readFileSync(`public/data/${id}.heat.json`, 'utf8')) as HeatSite;
      const t0 = Date.now();
      const base = simulateHeat(g, hs, [], opt).metrics;
      const spreads = [1, 2, 3].map(seed => simulateHeat(g, hs, heatEvenSpread(g, hs, BUDGET, seed), opt).metrics);
      const o = optimizeHeat(g, hs, { ...opt, budget: BUDGET });
      const m = o.result.metrics, cost = heatPlanCost(g, o.plan);
      const avg = (k: 'weightedIndex' | 'receptorShade' | 'hotReceptors') => spreads.reduce((s, x) => s + x[k], 0) / spreads.length;
      const mix: Record<string, number> = {};
      for (const iv of o.plan) mix[HEAT_CATALOG[iv.type].short] = (mix[HEAT_CATALOG[iv.type].short] ?? 0) + 1;
      console.log(id, `${Date.now() - t0} ms`, JSON.stringify({
        wIdx: [base.weightedIndex.toFixed(2), avg('weightedIndex').toFixed(2), m.weightedIndex.toFixed(2)],
        rShade: [base.receptorShade.toFixed(2), avg('receptorShade').toFixed(2), m.receptorShade.toFixed(2)],
        hot: [base.hotReceptors, avg('hotReceptors').toFixed(1), m.hotReceptors], cost: Math.round(cost), mix,
      }));
      console.log(id, 'top picks:', o.plan.slice(0, 3).map(p => p.reason).join(' | '));
      expect(cost).toBeLessThanOrEqual(BUDGET);
      expect(base.weightedIndex - m.weightedIndex).toBeGreaterThan(base.weightedIndex - avg('weightedIndex'));
    });
  }
});
