// HYDRA heat engine: a transparent, relative pedestrian heat-exposure index.
//   sun path (NOAA) -> shadows from buildings, tree crowns and shade structures (ray traced on the 5 m grid)
//   -> per cell: direct-sun dose over the chosen hours + surface heating (asphalt > paving > soil > grass)
//      + ambient heat (NOAA heat index of the air), radiant terms trimmed by wind
//   -> weighted by footfall (road class; bus stops, markets, gates and parks count more).
// It ranks places and compares plans under the same weather. It is not UTCI / WBGT and does not predict heat illness.
import { COVER } from '../types';
import type { Grid } from '../grid';
import { DAY_END, DAY_START, HEAT_PARAMS as P, ROAD_FOOT, STEP_H, SURFACE, heatPlanCost } from './model';
import { buildObstacles, roofTops, sunRay, transmit, type Obstacles } from './shadow';
import { directNormal, heatIndexC, sunPosition } from './solar';
import type { HeatHotspot, HeatIntervention, HeatOptions, HeatResult, HeatScenario, HeatSite, HeatWindow, ReceptorScore, SunStep } from './types';

/** Sun every half hour (interval midpoints) from DAY_START to DAY_END, local time. */
export function sunSteps(g: Grid, sc: HeatScenario): SunStep[] {
  const [lat, lon] = g.site.center, out: SunStep[] = [];
  for (let h = DAY_START + STEP_H / 2; h < DAY_END; h += STEP_H) {
    const { elev, az } = sunPosition(lat, lon, sc.doy, h);
    out.push({ hour: h, elev, az, dni: directNormal(elev, sc.cloud) });
  }
  return out;
}
export const inWindow = (s: SunStep, w: HeatWindow) => s.hour >= w.start && s.hour < w.end;

/** Footfall weight per cell (0 = not pedestrian space). */
export function pedestrianWeights(g: Grid, hs: HeatSite): Float32Array {
  const w = new Float32Array(g.n);
  for (let i = 0; i < g.n; i++) {
    const cv = g.cover[i];
    if (cv === COVER.BUILDING || cv === COVER.WATER || cv === COVER.CHANNEL) continue;
    w[i] = g.blocked[i] ? 0.15 : cv === COVER.ROAD ? (ROAD_FOOT[g.road[i] >= 0 ? g.site.roads[g.road[i]].cls : 'residential'] ?? 0.8) : cv === COVER.GREEN ? 0.4 : 0.3;
  }
  for (const r of hs.receptors) for (const c of r.cells) if (w[c] > 0 || g.cover[c] !== COVER.BUILDING) w[c] = Math.max(w[c], r.footfall);
  return w;
}

export const ambientTerm = (hiC: number) => Math.max(0, Math.min(1, (hiC - 27) / 25));
export const windFactor = (ms: number) => 1 - P.windCool * Math.min(5, Math.max(0, ms));

/** Exposure index of one cell from its sun dose (W·h/m² over the window) and cover. */
export function cellIndex(g: Grid, o: Obstacles, i: number, dose: number, avail: number, hours: number, amb: number, wf: number) {
  const frac = avail > 0 ? dose / avail : 0;
  const surface = SURFACE[g.cover[i]] * (0.3 + 0.7 * frac) * (o.treeCov[i] > 0.3 ? P.underTree : 1);
  const sdose = hours > 0 ? dose / (P.dniRef * hours) : 0;
  return { frac, surface, index: Math.max(0, Math.min(100, 100 * ((P.wSun * sdose + P.wSurface * surface) * wf + P.wAmbient * amb))) };
}

export function simulateHeat(g: Grid, hs: HeatSite, plan: HeatIntervention[], opt: HeatOptions): HeatResult {
  const t0 = performance.now(), n = g.n, keep = opt.keepFrames !== false;
  const o = buildObstacles(g, hs, plan);
  const steps = sunSteps(g, opt.scenario), w = pedestrianWeights(g, hs);
  const frames = keep ? new Uint8Array(steps.length * n) : null;
  const dose = new Float32Array(n), sunH = new Float32Array(n);
  const ground: number[] = [];
  for (let i = 0; i < n; i++) if (g.cover[i] !== COVER.BUILDING) ground.push(i);
  let avail = 0, hours = 0, peakK = -1;
  steps.forEach((s, k) => { if (inWindow(s, opt.window)) { avail += s.dni * STEP_H; hours += STEP_H; if (peakK < 0 || s.elev > steps[peakK].elev) peakK = k; } });
  const peakT = new Float32Array(n);   // sun at the window's highest sun step
  steps.forEach((s, k) => {
    const win = inWindow(s, opt.window);
    if (!win && !keep) return;
    if (s.dni <= 0) return;   // sun below the horizon: frame stays 0 (shade)
    const { dc, dr, slope } = sunRay(s.elev, s.az);
    for (const i of ground) {
      const T = transmit(g, o, i, dc, dr, slope);
      if (frames) frames[k * n + i] = Math.round(T * 255);
      if (k === peakK) peakT[i] = T;
      if (win) { dose[i] += T * s.dni * STEP_H; if (T > 0.5) sunH[i] += STEP_H; }
    }
  });
  if (frames) for (let k = 0; k < steps.length; k++) if (steps[k].dni > 0) for (let i = 0; i < n; i++) if (g.cover[i] === COVER.BUILDING) frames[k * n + i] = 255;   // roofs in sun

  const hiC = heatIndexC(opt.scenario.tempC, opt.scenario.rh), amb = ambientTerm(hiC), wf = windFactor(opt.scenario.windMs);
  const sunFrac = new Float32Array(n), surface = new Float32Array(n), exposure = new Float32Array(n);
  let sw = 0, swe = 0, se = 0, cnt = 0, shade = 0, sh = 0, exposed = 0, ped = 0;
  for (const i of ground) {
    const c = cellIndex(g, o, i, dose[i], avail, hours, amb, wf);
    sunFrac[i] = c.frac; surface[i] = c.surface;
    if (w[i] <= 0) continue;
    exposure[i] = c.index;
    sw += w[i]; swe += w[i] * c.index; se += c.index; cnt++;
    shade += 1 - c.frac; sh += sunH[i]; ped++;
    if (peakT[i] > 0.5) exposed++;
  }

  // places people wait or gather
  const receptors: ReceptorScore[] = hs.receptors.map(r => {
    let ix = 0, sd = 0, hr = 0, k = 0;
    for (const c of r.cells) { if (w[c] <= 0) continue; ix += exposure[c]; sd += 1 - sunFrac[c]; hr += sunH[c]; k++; }
    return { id: r.id, index: k ? ix / k : 0, shade: k ? sd / k : 0, sunHours: k ? hr / k : 0 };
  });
  // hottest named streets (footfall-weighted mean over each road's cells)
  const roadAcc = new Map<string, { w: number; e: number; s: number; h: number; k: number; x: number; z: number }>();
  for (const i of ground) {
    if (g.cover[i] !== COVER.ROAD || g.road[i] < 0 || w[i] <= 0) continue;
    const name = g.site.roads[g.road[i]].name;
    if (!name) continue;
    const a = roadAcc.get(name) ?? { w: 0, e: 0, s: 0, h: 0, k: 0, x: 0, z: 0 };
    a.w += w[i]; a.e += w[i] * exposure[i]; a.s += 1 - sunFrac[i]; a.h += sunH[i]; a.k++; a.x += ((i % g.nx) + 0.5) * g.dx; a.z += (((i / g.nx) | 0) + 0.5) * g.dx;
    roadAcc.set(name, a);
  }
  const hotspots: HeatHotspot[] = [
    ...hs.receptors.map((r, k) => ({ kind: r.kind, name: r.name, x: r.x, z: r.z, index: receptors[k].index, shade: receptors[k].shade, sunHours: receptors[k].sunHours, receptor: r.id })),
    ...[...roadAcc.entries()].filter(([, a]) => a.k >= 8).map(([name, a]) => ({ kind: 'street' as const, name, x: a.x / a.k, z: a.z / a.k, index: a.e / a.w, shade: a.s / a.k, sunHours: a.h / a.k })),
  ].sort((a, b) => b.index - a.index);

  // roofs: solar heat absorbed (roofs assumed unshaded)
  const roofs = roofTops(g), cool = new Set(plan.filter(p => p.type === 'coolroof').map(p => p.building!));
  let roofSun = 0;
  for (const s of steps) if (inWindow(s, opt.window)) roofSun += s.dni * Math.sin(Math.max(0, s.elev) * Math.PI / 180) * STEP_H;   // Wh/m²
  let roofHeat = 0;
  g.bCells.forEach((cells, k) => { if (isFinite(roofs[k])) roofHeat += cells.length * g.A * (1 - (cool.has(k) ? P.coolRoofAlbedo : P.roofAlbedo)) * roofSun; });

  return {
    n, steps, frames, sunFrac, sunHours: sunH, surface, exposure, weight: w, heatIndexC: hiC, ambient: amb, receptors, hotspots,
    metrics: {
      weightedIndex: sw ? swe / sw : 0, meanIndex: cnt ? se / cnt : 0,
      exposedArea: exposed * g.A, exposedShare: ped ? exposed / ped : 0, shadeShare: ped ? shade / ped : 0,
      receptorShade: receptors.length ? receptors.reduce((a, r) => a + r.shade, 0) / receptors.length : 0,
      hotReceptors: receptors.filter(r => r.index >= P.high).length, sunHours: ped ? sh / ped : 0,
      roofHeat: roofHeat / 1e6, pedArea: ped * g.A,
    },
    cost: heatPlanCost(g, plan), runtimeMs: performance.now() - t0,
  };
}
