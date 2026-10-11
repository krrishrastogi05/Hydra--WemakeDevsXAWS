// Heat mode's side-panel tabs: results, plan, recommendations, the budget showdown, and assumptions.
// Same tabs and building blocks as flood mode; every number comes from a heat-engine result.
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { heatPlanKey, useHeat } from '../../heatStore';
import { fmtINR, type Grid } from '../../sim/grid';
import { DAY_START, HEAT_CATALOG, HEAT_PARAMS as P, HEAT_SCENARIOS, HEAT_WINDOWS, ROAD_FOOT, SURFACE, heatCostOf, heatPlanCost } from '../../sim/heat/model';
import { heatPlaceName } from '../../sim/heat/optimizer';
import { heatIndexBand } from '../../sim/heat/solar';
import type { HeatIntervention, HeatInterventionType, HeatMetrics, HeatResult, HeatSite } from '../../sim/heat/types';
import { CompareBars, LineSeries, type BarRow } from '../charts';
import { Icon } from '../Chrome';
import { ShareReport } from '../Share';
import { CalcSourceTag, ProgressBar } from '../calc';
import { cellX, cellZ, half } from '../../three/geo';
import { BudgetBreakdown, Empty, Metric, Optimize, Section, ValueRows, Verdict } from '../kit';

const num = (v: number, d = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const pctTxt = (v: number) => `${Math.round(v * 100)}%`;
export const clock = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const KIND: Record<string, string> = { bus_stop: 'bus stop', market: 'market', school: 'school gate', hospital: 'hospital gate', public_space: 'park', street: 'street' };

function HKpi({ label, base, after, fmt, hint, higherBetter = false }: { label: string; base: number; after: number | null; fmt: (v: number) => string; hint?: string; higherBetter?: boolean }) {
  const diff = after == null ? 0 : (after - base) * (higherBetter ? 1 : -1), rel = base ? Math.abs(after! - base) / Math.abs(base) : 0;
  return <Metric label={label} value={fmt(after ?? base)} hint={hint} base={fmt(base)} change={after == null ? undefined : `${Math.round(rel * 100)}%`} tone={diff > 1e-9 ? 'good' : diff < -1e-9 ? 'bad' : 'flat'} />;
}

function sunShare(r: HeatResult) {   // share of pedestrian space in direct sun at each step
  const n = r.n, ys = new Float32Array(r.steps.length);
  if (!r.frames) return ys;
  let ped = 0;
  for (let i = 0; i < n; i++) if (r.weight[i] > 0) ped++;
  r.steps.forEach((_, k) => { let s = 0; for (let i = 0; i < n; i++) if (r.weight[i] > 0 && r.frames![k * n + i] > 127) s++; ys[k] = ped ? (s / ped) * 100 : 0; });
  return ys;
}

export function flyToHeat(g: Grid, iv: HeatIntervention) {
  let x = 0, z = 0;
  if (iv.type === 'coolroof') { const b = g.site.buildings[iv.building!]; x = b.poly.reduce((a, p) => a + p[0], 0) / b.poly.length - half(g); z = b.poly.reduce((a, p) => a + p[1], 0) / b.poly.length - half(g); }
  else { const c = iv.cells![Math.floor(iv.cells!.length / 2)]; x = cellX(g, c); z = cellZ(g, c); }
  useStore.setState({ flyTo: { x, z, t: Date.now() } });
}
export function describeHeat(g: Grid, hs: HeatSite, iv: HeatIntervention) {
  if (iv.type === 'coolroof') { const b = g.site.buildings[iv.building!]; return `${b.name || b.use} roof, ${Math.round(g.bCells[iv.building!].length * g.A)} m²`; }
  if (iv.type === 'walkway') return `${iv.cells!.length * g.dx} m along ${heatPlaceName(g, hs, iv.cells![0])}`;
  return `at ${heatPlaceName(g, hs, iv.cells![0])}`;
}

function useHeatRuns() {
  return useHeat(useShallow(st => ({ heat: st.heat, baseline: st.baseline, current: st.current, currentKey: st.currentKey, plan: st.plan, view: st.view, scenarioId: st.scenarioId, windowId: st.windowId, budget: st.budget, runPlan: st.runPlan, running: st.running, recommend: st.recommend })));
}

function Status() {
  const s = useHeatRuns();
  const stale = s.plan.length > 0 && heatPlanKey(s.plan) !== s.currentKey;
  if (s.running) return <div className="callout soft"><span className="spinner" />Tracing the sun {stale ? 'with your latest plan' : 'for the new conditions'}…</div>;
  if (stale) return <div className="callout">Your plan changed since the last run. <button className="link" onClick={() => s.runPlan(true)}>Run the day again</button></div>;
  return null;
}

function Overview() {
  const grid = useStore(s => s.grid);
  const s = useHeatRuns();
  if (!grid || !s.baseline || !s.heat) return null;
  const planRes = s.current && s.currentKey ? s.current : null;
  const b = s.baseline.metrics, a = planRes?.metrics ?? null, shown = (s.view === 'plan' && planRes) || s.baseline;
  const sc = HEAT_SCENARIOS.find(x => x.id === s.scenarioId)!, win = HEAT_WINDOWS.find(x => x.id === s.windowId)!;
  const spent = heatPlanCost(grid, s.plan), cooled = a ? b.hotReceptors - a.hotReceptors : 0, shade = a ? Math.round((a.receptorShade - b.receptorShade) * 100) : 0;
  return (
    <div className="tab">
      <Status />
      {a ? (
        <Verdict tone={cooled > 0 || shade > 0 ? 'good' : 'warn'} kicker="Your plan">
          {cooled > 0 || shade > 0
            ? <>Brings <b>{num(Math.max(0, cooled))} high-exposure {Math.abs(cooled) === 1 ? 'place' : 'places'}</b> below {P.high} and adds <b>{num(Math.max(0, shade))} points</b> of shade where people wait, for <b>{fmtINR(spent)}</b>.</>
            : <>Spends <b>{fmtINR(spent)}</b> but adds little shade where people wait. Trees and canopies work best at bus stops, markets and gates.</>}
        </Verdict>
      ) : (
        <Verdict tone="neutral" kicker="No action" actions={!s.plan.length && <button className="btn primary sm" onClick={() => s.recommend()}>Recommend a plan for {fmtINR(s.budget)}</button>}>
          On this day <b>{num(b.hotReceptors)} of {s.heat.receptors.length}</b> places where people wait are highly exposed, with only <b>{pctTxt(b.receptorShade)}</b> of the sun blocked there.
        </Verdict>
      )}
      <Section title="Heat at street level" hint={`${sc.name} · ${win.name.toLowerCase()} · change vs no action`} aside={<CalcSourceTag source={shown.source} />}>
        <p className="fine">Air in the shade: heat index <b>{num(s.baseline.heatIndexC, 1)} °C</b> (NOAA band: {heatIndexBand(s.baseline.heatIndexC)}). Sun and hot surfaces add to that on exposed streets, which is what these numbers compare.</p>
        <div className="metrics">
          <HKpi label="Exposure at busy places" base={b.weightedIndex} after={a?.weightedIndex ?? null} fmt={v => num(v, 1)} hint="Relative exposure index (0–100), weighted by how many people use each spot" />
          <HKpi label={`High-exposure places (of ${s.heat.receptors.length})`} base={b.hotReceptors} after={a?.hotReceptors ?? null} fmt={v => num(v)} hint={`Bus stops, markets, gates and parks with an index of ${P.high} or more`} />
          <HKpi label="Shade where people wait" base={b.receptorShade} after={a?.receptorShade ?? null} fmt={pctTxt} higherBetter hint="Share of the window's direct sun that is blocked at bus stops, markets, gates and parks" />
          <HKpi label="Street space in sun at midday" base={b.exposedShare} after={a?.exposedShare ?? null} fmt={pctTxt} hint="Share of pedestrian space in direct sun when the sun is highest in the window" />
          <HKpi label="Direct sun per spot" base={b.sunHours} after={a?.sunHours ?? null} fmt={v => `${num(v, 1)} h`} hint="Average hours of direct sun on pedestrian space in the window" />
          <HKpi label="Heat absorbed by roofs" base={b.roofHeat} after={a?.roofHeat ?? null} fmt={v => `${num(v, 0)} MWh`} hint="Solar heat soaked up by all roofs in the window; cool roofs cut this" />
        </div>
      </Section>
    </div>
  );
}

function Analytics() {
  const grid = useStore(s => s.grid);
  const s = useHeatRuns();
  const planRes = s.current && s.currentKey ? s.current : null;
  const baseSun = useMemo(() => (s.baseline ? sunShare(s.baseline) : null), [s.baseline]);
  const planSun = useMemo(() => (planRes ? sunShare(planRes) : null), [planRes]);
  if (!grid || !s.baseline || !s.heat) return null;
  const shown = (s.view === 'plan' && planRes) || s.baseline, which = shown === s.baseline ? 'no action' : 'your plan';
  const xs = s.baseline.steps.map(st => st.hour - DAY_START);
  return (
    <div className="tab">
      <Status />
      <Section title="Pedestrian space in direct sun" hint="through the day">
        {baseSun && <LineSeries unit="%" fmt={v => `${Math.round(v)}%`} xLabel="time of day" xFmt={v => clock(v + DAY_START)} series={[
          { key: 'none', xs, ys: baseSun }, ...(planSun ? [{ key: 'plan' as const, xs, ys: planSun }] : []),
        ]} />}
        <p className="fine">A relative index for comparing places and plans under the same weather, not a heat-stress (UTCI/WBGT) or health measure. This run took {Math.round(shown.runtimeMs)} ms.</p>
      </Section>
      <Section title="Hottest places" hint={`${which} · click to fly there`}>
        <ol className="hotspots heat">
          {shown.hotspots.slice(0, 8).map((h, k) => (
            <li key={k}><button onClick={() => useStore.setState({ flyTo: { x: h.x - half(grid), z: h.z - half(grid), t: Date.now() } })}>
              <b>{h.name}</b><span>index {Math.round(h.index)} · {KIND[h.kind]} · {num(h.sunHours, 1)} h of direct sun · {pctTxt(h.shade)} shaded</span>
            </button></li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

function PlanCost() {
  const grid = useStore(s => s.grid);
  const s = useHeat(useShallow(st => ({ heat: st.heat, baseline: st.baseline, current: st.current, currentKey: st.currentKey, plan: st.plan, budget: st.budget, remove: st.remove, clearPlan: st.clearPlan, runPlan: st.runPlan, running: st.running })));
  if (!grid || !s.heat || !s.baseline) return null;
  const types = Object.keys(HEAT_CATALOG) as HeatInterventionType[], spent = heatPlanCost(grid, s.plan);
  const parts = types.map(t => { const items = s.plan.filter(p => p.type === t); return { label: HEAT_CATALOG[t].name, color: HEAT_CATALOG[t].color, count: items.length, cost: heatPlanCost(grid, items) }; });
  const run = s.plan.length && s.current && s.currentKey === heatPlanKey(s.plan) ? s.current : null;
  const b = s.baseline.metrics, a = run?.metrics;
  return (
    <div className="tab">
      <Section title="Budget" hint="heat budget, separate from flood"><BudgetBreakdown spent={spent} budget={s.budget} parts={parts} note="Illustrative 2024 rates, not a schedule of rates. Trees are modelled at maturity, which takes years." /></Section>
      {s.plan.length > 0 && (
        <Section title="Value for money" hint={a ? 'from the latest run of this plan' : 'run the day with this plan to see it'}>
          {a ? <ValueRows rows={[
            { label: 'Per high-exposure place cooled', cost: spent, benefit: b.hotReceptors - a.hotReceptors, unit: 'place' },
            { label: 'Per point of shade where people wait', cost: spent, benefit: (a.receptorShade - b.receptorShade) * 100, unit: 'point' },
            { label: 'Per index point at busy places', cost: spent, benefit: b.weightedIndex - a.weightedIndex, unit: 'point' },
            { label: 'Per MWh less roof heat', cost: spent, benefit: b.roofHeat - a.roofHeat, unit: 'MWh' },
          ]} /> : <button className="btn sm" disabled={s.running} onClick={() => s.runPlan(true)}>{s.running ? 'Running…' : 'Run the day with this plan'}</button>}
        </Section>
      )}
      <Section title="Interventions" hint={s.plan.length ? `${s.plan.length} placed` : undefined} aside={s.plan.length > 0 && <button className="link danger" onClick={s.clearPlan}>Clear all</button>}>
        {!s.plan.length && <Empty title="No shade added yet">Pick a tool on the left (keys 1–4) and place it on the map, or open <b>Optimize</b> to let HYDRA plan the budget.</Empty>}
        {types.map(t => {
          const items = s.plan.filter(p => p.type === t);
          if (!items.length) return null;
          return (
            <div key={t} className="group" style={{ ['--tc' as string]: HEAT_CATALOG[t].color }}>
              <h4><i />{HEAT_CATALOG[t].name} <small>{items.length} · {fmtINR(heatPlanCost(grid, items))}</small></h4>
              {items.slice(0, 40).map(iv => (
                <div key={iv.id} className="item">
                  <div className="item-main">
                    <span>{describeHeat(grid, s.heat!, iv)}</span>
                    <span className={`src ${iv.source}`}>{iv.source === 'hydra' ? 'HYDRA' : iv.source === 'spread' ? 'even spread' : 'you'}</span>
                    <b>{fmtINR(heatCostOf(grid, iv))}</b>
                  </div>
                  {iv.reason && <p className="why">{iv.reason}</p>}
                  <div className="item-actions">
                    <button className="link" onClick={() => flyToHeat(grid, iv)}><Icon name="target" size={13} /> Show</button>
                    <button className="link danger" onClick={() => s.remove(iv.id)}><Icon name="close" size={12} /> Remove</button>
                  </div>
                </div>
              ))}
              {items.length > 40 && <p className="fine">…and {items.length - 40} more.</p>}
            </div>
          );
        })}
      </Section>
      {s.plan.length > 0 && <ShareReport />}
    </div>
  );
}

function Progress() {
  return <ProgressBar busy={useHeat(s => s.busy)} />;
}
function mix(plan: HeatIntervention[]) {
  const m = new Map<HeatInterventionType, number>();
  plan.forEach(p => m.set(p.type, (m.get(p.type) ?? 0) + 1));
  return [...m.entries()];
}
function rows(b: HeatMetrics, x: HeatMetrics, spread?: HeatMetrics[]): BarRow[] {
  const avg = (k: keyof HeatMetrics) => (spread ? spread.reduce((a, m) => a + m[k], 0) / spread.length : undefined);
  const rng = (k: keyof HeatMetrics, f = 1): [number, number] | undefined => (spread ? [Math.min(...spread.map(m => m[k] * f)), Math.max(...spread.map(m => m[k] * f))] : undefined);
  const r = (label: string, k: keyof HeatMetrics, fmt: (v: number) => string, f = 1, hint?: string, better: 'lower' | 'higher' = 'lower'): BarRow => ({
    label, hint, fmt, better,
    values: { none: b[k] * f, hydra: x[k] * f, ...(spread ? { spread: avg(k)! * f } : {}) },
    range: spread ? { spread: rng(k, f)! } : undefined,
  });
  return [
    r('High-exposure places', 'hotReceptors', v => num(v, v % 1 ? 1 : 0)),
    r('Shade where people wait', 'receptorShade', v => `${Math.round(v)}%`, 100, 'bus stops, markets, gates, parks', 'higher'),
    r('Exposure at busy places', 'weightedIndex', v => num(v, 1), 1, 'footfall-weighted index'),
    r('Street space in sun at midday', 'exposedShare', v => `${Math.round(v)}%`, 100),
  ];
}

function Recommend() {
  const grid = useStore(s => s.grid);
  const s = useHeat(useShallow(st => ({ heat: st.heat, baseline: st.baseline, budget: st.budget, plan: st.plan, rec: st.recommendation, busy: st.busy, recommend: st.recommend, setPlan: st.setPlan, windowId: st.windowId })));
  if (!grid || !s.baseline || !s.heat) return null;
  const b = s.baseline.metrics, r = s.rec, left = s.budget - heatPlanCost(grid, s.plan);
  return (
    <>
      <Section title="Let HYDRA plan the budget" hint={s.plan.length ? `your plan: ${s.plan.length} items, ${fmtINR(Math.max(0, left))} left` : `budget ${fmtINR(s.budget)}`}>
        <p className="sub">HYDRA traces the sun through the chosen hours, finds where many people stand in strong sun (bus stops, markets, gates, busy streets), and tries every nearby tree and canopy, scored by exposure removed per rupee against the shade already there.</p>
        <div className="row-actions">
          <button className="btn primary" disabled={!!s.busy} onClick={() => s.recommend('fresh')}>Plan {fmtINR(s.budget)}</button>
          <button className="btn" disabled={!!s.busy || !s.plan.length || left < 12000} onClick={() => s.recommend('fill')}>Improve my plan</button>
        </div>
        <Progress />
      </Section>
      {r && !s.busy && (
        <Section title="Recommended plan" hint={`${r.plan.length} interventions · ${fmtINR(r.cost)}`} aside={<CalcSourceTag source={r.source} />}>
          <CompareBars keys={['none', 'hydra']} rows={rows(b, r.metrics)} />
          <div className="chips">{mix(r.plan).map(([t, n]) => <span key={t} style={{ ['--tc' as string]: HEAT_CATALOG[t].color }}><i />{n} × {HEAT_CATALOG[t].short}</span>)}</div>
          <div className="row-actions"><button className="btn primary" onClick={() => { s.setPlan(r.plan); useStore.setState({ panel: 'overview' }); }}>Apply this plan</button></div>
          <h4>Why these places</h4>
          <ol className="reasons">{r.plan.filter(p => p.reason).slice(0, 12).map(p => <li key={p.id} style={{ ['--tc' as string]: HEAT_CATALOG[p.type].color }}><b>{HEAT_CATALOG[p.type].short}</b> {p.reason} <em>{fmtINR(heatCostOf(grid, p))}</em></li>)}</ol>
          {r.plan.length > 12 && <p className="fine">…and {r.plan.length - 12} more in Plan & cost once applied.</p>}
          <p className="fine">Cool roofs are never picked here: they cut heat absorbed by buildings, not the sun on people in the street. Add them by hand if indoor heat is the goal.</p>
        </Section>
      )}
    </>
  );
}

function Showdown() {
  const grid = useStore(s => s.grid);
  const s = useHeat(useShallow(st => ({ budget: st.budget, sd: st.showdown, busy: st.busy, run: st.runShowdown, setPlan: st.setPlan })));
  if (!grid) return null;
  const sd = s.sd;
  let headline = null;
  if (sd) {
    const avg = (k: keyof HeatMetrics) => sd.spreads.reduce((a, x) => a + x.metrics[k], 0) / sd.spreads.length;
    const coolH = sd.base.hotReceptors - sd.hydra.metrics.hotReceptors, coolS = sd.base.hotReceptors - avg('hotReceptors');
    const shadeH = (sd.hydra.metrics.receptorShade - sd.base.receptorShade) * 100, shadeS = (avg('receptorShade') - sd.base.receptorShade) * 100;
    headline = (
      <>
        <div className="headline">
          <div><b>{num(Math.max(0, coolH))}</b><span>high-exposure places brought below {P.high} by HYDRA's plan</span></div>
          <div><b>{num(Math.max(0, coolS), 1)}</b><span>by an even spread of the same {fmtINR(sd.budget)}</span></div>
        </div>
        <p className="sub">Shade where people wait rises by <b>{num(shadeH, 0)} points</b> with HYDRA against <b>{num(shadeS, 1)}</b> for the even spread. Same weather, same hours, same budget: only the placement differs.</p>
      </>
    );
  }
  return (
    <>
      <Section title="Budget showdown" hint={`same day, same ${fmtINR(s.budget)}`}>
        <p className="sub">Three strategies: do nothing; spend it <b>evenly</b> on trees and canopies at random street spots (average of 3 such plans, with their range); or let <b>HYDRA</b> place shade where the sun and the people are.</p>
        <div className="row-actions"><button className="btn accent" disabled={!!s.busy} onClick={s.run}>{sd ? 'Run again' : 'Run the showdown'}</button></div>
        <Progress />
      </Section>
      {sd && !s.busy && (
        <Section title="Result" aside={<CalcSourceTag source={sd.source} />}>
          {headline}
          <CompareBars keys={['none', 'spread', 'hydra']} rows={rows(sd.base, sd.hydra.metrics, sd.spreads.map(x => x.metrics))} />
          <p className="fine">Spent: even spread {fmtINR(sd.spreads.reduce((a, x) => a + x.cost, 0) / sd.spreads.length)} on average, HYDRA {fmtINR(sd.hydra.cost)}. HYDRA's mix: {mix(sd.hydra.plan).map(([t, n]) => `${n} ${HEAT_CATALOG[t].short.toLowerCase()}${n > 1 ? 's' : ''}`).join(', ')}.</p>
          <div className="row-actions">
            <button className="btn primary" onClick={() => { s.setPlan(sd.hydra.plan); useStore.setState({ panel: 'overview' }); }}>Use HYDRA's plan</button>
            <button className="btn ghost" onClick={() => { s.setPlan(sd.spreads[0].plan); useStore.setState({ panel: 'overview' }); }}>Show an even-spread plan</button>
          </div>
        </Section>
      )}
    </>
  );
}

function AboutTab() {
  const site = useStore(s => s.site), heat = useHeat(s => s.heat);
  if (!site || !heat) return null;
  return (
    <div className="tab about"><section className="card">
      <h4>{site.name}, {site.city}: heat mode</h4>
      <p>{heat.trees.length} trees ({heat.stats.osmTrees} from OpenStreetMap, {heat.stats.syntheticTrees} synthetic) and {heat.receptors.length} places where people wait or gather ({heat.stats.osmReceptors} from OSM, {heat.stats.syntheticReceptors} synthetic). Buildings, roads and terrain are the same as in flood mode.</p>
      <h4>How the exposure index works</h4>
      <ol>
        <li><b>Sun path</b> for the chosen day at {site.center[0].toFixed(2)}° N, {site.center[1].toFixed(2)}° E every half hour (NOAA solar position equations), with clear-sky direct sunlight (Meinel model) reduced by cloud.</li>
        <li><b>Shadows:</b> a ray from each 5 m cell, {P.personHeight} m above the ground, is traced toward the sun. Buildings ({P.storey} m per storey + plinth) and hills block it. Tree crowns let {Math.round(P.treeTrans * 100)} % through; canopies and walkways {Math.round(P.canopyTrans * 100)} %.</li>
        <li><b>Index (0–100)</b> = {P.wSun * 100} × sun dose (direct sun received ÷ {P.dniRef} W/m² for the whole window) + {P.wSurface * 100} × surface heating + {P.wAmbient * 100} × air heat. Sun and surface terms fall {P.windCool * 100} % per m/s of wind.</li>
        <li><b>Surface heating</b> by cover: road {SURFACE[1]}, paving {SURFACE[5]}, bare ground {SURFACE[0]}, grass {SURFACE[3]}, rising with the sun it receives; × {P.underTree} under tree crowns.</li>
        <li><b>Air heat</b> from the NOAA heat index of temperature and humidity: 27 °C → 0, 52 °C → 1. It is the same everywhere; only shade and surfaces differ between streets.</li>
        <li><b>Busy places count more:</b> road footfall weights {ROAD_FOOT.primary} (main roads) to {ROAD_FOOT.service} (service lanes); bus stops 3, markets 4, school and hospital gates 3, parks 2. "High" means an index of {P.high}+.</li>
      </ol>
      <h4>Interventions and indicative costs</h4>
      <ul>{(Object.keys(HEAT_CATALOG) as HeatInterventionType[]).map(t => <li key={t}><b>{HEAT_CATALOG[t].name}</b>: {HEAT_CATALOG[t].unit}. {HEAT_CATALOG[t].blurb}</li>)}</ul>
      <p className="fine">Costs are illustrative 2024 rates, not a schedule of rates. Trees are modelled at maturity ({P.newTree.h} m, {P.newTree.r} m crown), which takes years. Roof heat assumes roof albedo {P.roofAlbedo}, cool roof {P.coolRoofAlbedo}.</p>
      <h4>Data</h4>
      <ul>
        <li><b>Trees and places:</b> {heat.provenance.osm}.</li>
        <li><b>Buildings, roads, terrain:</b> {site.provenance.osm}; {site.provenance.terrain}.</li>
        <li><b>Synthetic, and labelled as such:</b> {heat.provenance.synthetic.join('; ')}.</li>
      </ul>
      <h4>Limits</h4>
      <p>This is a transparent relative-exposure model for comparing places and plans under the same weather. It is not UTCI, WBGT or mean radiant temperature, and it does not predict heatstroke or other health outcomes. It ignores reflected sunlight from walls, night-time heat release, air movement between streets and anything beyond the 600 m box (edge cells see open sky). Use it to target shade, then check on the ground.</p>
    </section></div>
  );
}

export function HeatTab({ panel }: { panel: string }) {
  const ready = useHeat(s => !!s.baseline && !!s.heat), loading = useHeat(s => s.loading);
  if (!ready) return <div className="tab"><p className="sub"><span className="spinner" />{loading ? 'Tracing the sun across the neighbourhood…' : 'Preparing heat mode…'}</p></div>;
  if (panel === 'overview') return <Overview />;
  if (panel === 'analytics') return <Analytics />;
  if (panel === 'plan') return <PlanCost />;
  if (panel === 'optimize') return <Optimize recommend={<Recommend />} showdown={<Showdown />} />;
  return <AboutTab />;
}
