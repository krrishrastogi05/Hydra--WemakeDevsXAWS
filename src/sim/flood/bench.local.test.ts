import { it } from 'vitest';
import fs from 'node:fs';
import { loadGrid } from '../grid';
import { STORMS, planCost } from './model';
import { optimize, recommend, showdown } from './optimizer';
import type { SiteData } from '../types';
it('bench', () => {
  const acc = { old: [] as number[], neu: [] as number[], ms: [] as number[], sd: [] as number[], over: 0, worse: 0 };
  for (const id of ['gurugram', 'chennai', 'ranchi']) {
    const g = loadGrid(JSON.parse(fs.readFileSync(`public/data/${id}.json`, 'utf8')) as SiteData);
    for (const sid of ['heavy', 'veryheavy', 'extreme']) for (const budget of [25e5, 50e5, 1e7]) {
      const opts = { storm: STORMS.find(s => s.id === sid)!, antecedent: 'normal' as const };
      const old = optimize(g, { ...opts, budget }), base = old.rounds[0];
      let t = performance.now(); const r = recommend(g, opts, budget, []); const ms = performance.now() - t;
      t = performance.now(); showdown(g, opts, budget); const sd = performance.now() - t;
      const co = (1 - old.result.metrics.impact / base) * 100, cn = (1 - r.metrics.impact / base) * 100;
      acc.old.push(co); acc.neu.push(cn); acc.ms.push(ms); acc.sd.push(sd);
      if (r.cost > budget) acc.over++;
      if (cn < co - 1e-9) acc.worse++;
      console.log(`ROW ${id} ${sid} ${budget / 1e5}L | old ${co.toFixed(1)}% (${(planCost(g, old.plan) / 1e5).toFixed(1)}L) -> new ${cn.toFixed(1)}% (${(r.cost / 1e5).toFixed(1)}L) | homes ${old.result.metrics.buildingsFlooded} -> ${r.metrics.buildingsFlooded} | recommend ${(ms / 1000).toFixed(1)}s showdown ${(sd / 1000).toFixed(1)}s`);
    }
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`SUM mean harm cut old ${mean(acc.old).toFixed(2)}% new ${mean(acc.neu).toFixed(2)}% | recommend mean ${(mean(acc.ms) / 1000).toFixed(1)}s max ${(Math.max(...acc.ms) / 1000).toFixed(1)}s | showdown max ${(Math.max(...acc.sd) / 1000).toFixed(1)}s | over budget ${acc.over} | worse than old ${acc.worse}`);
}, 3600000);
