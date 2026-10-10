import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { loadGrid, type Grid } from '../grid';
import { COVER, type SiteData } from '../types';
import { heatIndexC, sunPosition } from './solar';
import { buildObstacles, sunRay, transmit } from './shadow';
import { simulateHeat } from './engine';
import { HEAT_SCENARIOS, HEAT_WINDOWS } from './model';
import type { HeatIntervention, HeatSite } from './types';

const maxElev = (lat: number, lon: number, doy: number) => { let m = -90; for (let h = 9; h < 15; h += 0.01) m = Math.max(m, sunPosition(lat, lon, doy, h).elev); return m; };

describe('solar', () => {
  it('noon elevation matches 90 - |lat - declination|', () => {
    expect(Math.abs(maxElev(28.61, 77.21, 172) - (90 - (28.61 - 23.44)))).toBeLessThan(0.5);    // Delhi, June solstice
    expect(Math.abs(maxElev(13.08, 80.27, 80) - (90 - 13.08))).toBeLessThan(1.0);               // Chennai, March equinox
  });
  it('morning sun is in the east, afternoon sun in the west', () => {
    const am = sunPosition(23.37, 85.33, 100, 8), pm = sunPosition(23.37, 85.33, 100, 16);
    expect(am.az).toBeGreaterThan(60); expect(am.az).toBeLessThan(120);
    expect(pm.az).toBeGreaterThan(240); expect(pm.az).toBeLessThan(300);
  });
  it('heat index follows the NOAA table', () => {
    expect(Math.abs(heatIndexC(32.2, 70) - 41.1)).toBeLessThan(1);    // 90 °F, 70 % -> 106 °F
    expect(Math.abs(heatIndexC(26, 40) - 26)).toBeLessThan(1);
  });
});

// 20 x 20 cells of 5 m, flat, one 2 x 2-cell three-storey block at columns/rows 9–10
function toyGrid(): Grid {
  const nx = 20, n = nx * nx, cover = new Uint8Array(n), bldg = new Int32Array(n).fill(-1);
  const bCells: number[][] = [[]];
  for (const r of [9, 10]) for (const c of [9, 10]) { const i = r * nx + c; cover[i] = COVER.BUILDING; bldg[i] = 0; bCells[0].push(i); }
  return {
    nx, ny: nx, n, dx: 5, A: 25, z: new Float64Array(n), cover, bldg, bCells, blocked: new Uint8Array(n), road: new Int32Array(n).fill(-1),
    site: { center: [23, 80], buildings: [{ levels: 3, plinth: 0.3 }], roads: [] },
  } as unknown as Grid;
}
const emptySite: HeatSite = { id: 'toy', trees: [], receptors: [], stats: { osmTrees: 0, syntheticTrees: 0, osmReceptors: 0, syntheticReceptors: 0 }, provenance: { osm: '', synthetic: [] } };
const at = (c: number, r: number) => r * 20 + c;

describe('shadow', () => {
  const g = toyGrid();
  it('a building shades the side away from the sun only', () => {
    const o = buildObstacles(g, emptySite, []), east = sunRay(30, 90);
    expect(transmit(g, o, at(8, 9), east.dc, east.dr, east.slope)).toBe(0);    // west of the block, sun in the east
    expect(transmit(g, o, at(11, 9), east.dc, east.dr, east.slope)).toBe(1);   // east of the block
    expect(transmit(g, o, at(9, 4), east.dc, east.dr, east.slope)).toBe(1);    // well north of it
  });
  it('a tree crown lets about a quarter of the sun through; a canopy almost none', () => {
    const hs = { ...emptySite, trees: [{ cell: at(4, 15), x: 22.5, z: 77.5, h: 8, r: 3.5, synthetic: false }] };
    const o = buildObstacles(g, hs, [{ id: 'c', type: 'canopy', cells: [at(15, 15)] }]), high = sunRay(75, 180);
    const tTree = transmit(g, o, at(4, 15), high.dc, high.dr, high.slope);
    expect(tTree).toBeGreaterThan(0.2); expect(tTree).toBeLessThan(0.5);
    expect(transmit(g, o, at(15, 15), high.dc, high.dr, high.slope)).toBeLessThan(0.06);
  });
});

describe('heat engine', () => {
  const opt = { scenario: HEAT_SCENARIOS[0], window: HEAT_WINDOWS[0], keepFrames: false };
  it('adding trees never raises exposure; a cool roof leaves the street unchanged', () => {
    const g = toyGrid(), hs = { ...emptySite, receptors: [{ id: 0, kind: 'bus_stop' as const, name: 'stop', cells: [at(14, 12)], x: 72.5, z: 62.5, footfall: 3, synthetic: true }] };
    const base = simulateHeat(g, hs, [], opt);
    const trees: HeatIntervention[] = [{ id: 't1', type: 'tree', cells: [at(14, 13)] }, { id: 't2', type: 'tree', cells: [at(13, 12)] }];
    const withTrees = simulateHeat(g, hs, trees, opt);
    for (let i = 0; i < g.n; i++) expect(withTrees.exposure[i]).toBeLessThanOrEqual(base.exposure[i] + 1e-4);
    expect(withTrees.metrics.weightedIndex).toBeLessThan(base.metrics.weightedIndex);
    const roof = simulateHeat(g, hs, [{ id: 'r', type: 'coolroof', building: 0 }], opt);
    expect(Array.from(roof.exposure)).toEqual(Array.from(base.exposure));
    expect(roof.metrics.roofHeat).toBeLessThan(base.metrics.roofHeat);
  });
  for (const id of ['gurugram', 'chennai', 'ranchi']) {
    it(`${id}: runs on the real neighbourhood`, () => {
      const g = loadGrid(JSON.parse(fs.readFileSync(`public/data/${id}.json`, 'utf8')) as SiteData);
      const hs = JSON.parse(fs.readFileSync(`public/data/${id}.heat.json`, 'utf8')) as HeatSite;
      const r = simulateHeat(g, hs, [], { ...opt, keepFrames: true });
      const m = r.metrics;
      console.log(id, `${r.runtimeMs.toFixed(0)} ms`, JSON.stringify({
        wIdx: m.weightedIndex.toFixed(1), mean: m.meanIndex.toFixed(1), exposed: (m.exposedShare * 100).toFixed(0) + '%', shade: (m.shadeShare * 100).toFixed(0) + '%',
        rShade: (m.receptorShade * 100).toFixed(0) + '%', hot: m.hotReceptors, sunH: m.sunHours.toFixed(2), roof: m.roofHeat.toFixed(1), HI: r.heatIndexC.toFixed(1),
        top: r.hotspots.slice(0, 3).map(h => `${h.name} ${h.index.toFixed(0)}`),
      }));
      expect(m.weightedIndex).toBeGreaterThan(10); expect(m.weightedIndex).toBeLessThan(100);
      expect(m.shadeShare).toBeGreaterThan(0); expect(m.shadeShare).toBeLessThan(1);
    });
  }
});
