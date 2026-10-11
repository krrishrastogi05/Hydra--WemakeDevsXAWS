// Heat-mode sections of the analytics view. Every number comes from heat-engine results (per cell and per half
// hour), the plan and the showdown in the heat store.
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { heatPlanKey, useHeat } from '../../heatStore';
import { fmtINR, type Grid } from '../../sim/grid';
import { DAY_START, HEAT_CATALOG, HEAT_PARAMS as P, HEAT_SCENARIOS, HEAT_WINDOWS, heatCostOf, heatPlanCost } from '../../sim/heat/model';
import { heatIndexBand } from '../../sim/heat/solar';
import type { HeatIntervention, HeatInterventionType, HeatMetrics, HeatResult } from '../../sim/heat/types';
import { SERIES } from '../charts';
import { Empty, Section, Verdict, num } from '../kit';
import { clock, describeHeat, sunShare } from '../heat/HeatPanel';
import { half } from '../../three/geo';
import { DataTable, HBars, Histogram, TimeChart, lineOf, type CsvTable, type Pt } from '../viz';
import { CostView, StatCard, StrategyView } from './common';
import { heatStrat } from './strat';

const pctTxt = (v: number) => `${Math.round(v * 100)}%`;
const KIND: Record<string, string> = { bus_stop: 'Bus stop', market: 'Market', school: 'School gate', hospital: 'Hospital gate', public_space: 'Park', street: 'Street' };

export function useHeatData() {
  const grid = useStore(s => s.grid), site = useStore(s => s.site);
  const s = useHeat(useShallow(st => ({ heat: st.heat, baseline: st.baseline, current: st.current, currentKey: st.currentKey, plan: st.plan, budget: st.budget, scenarioId: st.scenarioId, windowId: st.windowId,
    rec: st.recommendation, sd: st.showdown, running: st.running, busy: st.busy })));
  const run = s.plan.length && s.current && s.currentKey ? s.current : null;
  return { ...s, grid, site, run, stale: !!run && heatPlanKey(s.plan) !== s.currentKey, sc: HEAT_SCENARIOS.find(x => x.id === s.scenarioId)!, win: HEAT_WINDOWS.find(x => x.id === s.windowId)! };
}
type H = ReturnType<typeof useHeatData>;

function Stale({ h }: { h: H }) {
  if (h.running) return <div className="callout soft"><span className="spinner" />Tracing the sun…</div>;
  return h.stale ? <div className="callout">Your plan changed since its last run: plan figures below are from that run.</div> : null;
}

const INDEX_BINS = [0, 20, 35, 50, 65, 80, Infinity], INDEX_LABELS = ['< 20', '20–35', '35–50', '50–65', '65–80', '80+'];
const SUN_BINS = [0, 0.5, 1, 2, 3, Infinity], SUN_LABELS = ['< ½ h', '½–1 h', '1–2 h', '2–3 h', '3 h+'];
function binPed(g: Grid, r: HeatResult, vals: Float32Array, edges: number[]) {
  const out = new Array(edges.length - 1).fill(0);
  for (let i = 0; i < r.n; i++) {
    if (r.weight[i] <= 0) continue;
    let b = 0;
    while (b < out.length - 1 && vals[i] >= edges[b + 1]) b++;
    out[b] += g.A;
  }
  return out;
}

export function HeatSummary({ h }: { h: H }) {
  const share = useMemo(() => ({ none: h.baseline ? sunShare(h.baseline) : null, plan: h.run ? sunShare(h.run) : null }), [h.baseline, h.run]);
  if (!h.baseline || !h.heat || !h.grid || !h.site) return null;
  const b = h.baseline.metrics, a = h.run?.metrics, spent = heatPlanCost(h.grid, h.plan);
  const card = (label: string, k: keyof HeatMetrics, fmt: (v: number) => string, higher = false, hint?: string, spark = false) => {
    const base = b[k], now = a ? a[k] : null, rel = now == null || !base ? 0 : ((now - base) / Math.abs(base)) * 100, good = now != null && (higher ? now > base : now < base) && Math.abs(rel) > 0.05;
    const bad = now != null && (higher ? now < base : now > base) && Math.abs(rel) > 0.05;
    return <StatCard label={label} hint={hint} value={fmt(now ?? base)} base={fmt(base)} change={now == null ? undefined : `${num(Math.abs(rel), Math.abs(rel) < 10 ? 1 : 0)}%`} tone={good ? 'good' : bad ? 'bad' : 'flat'}
      spark={spark && share.none ? { ys: share.plan ?? share.none, base: share.plan ? share.none : undefined } : undefined} />;
  };
  const cooled = a ? b.hotReceptors - a.hotReceptors : 0, shade = a ? (a.receptorShade - b.receptorShade) * 100 : 0;
  return (
    <>
      <Stale h={h} />
      {a ? (
        <Verdict tone={cooled > 0 || shade > 0 ? 'good' : 'warn'} kicker="Your plan">
          For <b>{fmtINR(spent)}</b> across <b>{h.plan.length} interventions</b>, <b>{num(Math.max(0, cooled))} high-exposure places</b> drop below {P.high} and shade where people wait rises by <b>{num(Math.max(0, shade), 0)} points</b>.
        </Verdict>
      ) : (
        <Verdict tone="neutral" kicker="No action">On a <b>{h.sc.name.toLowerCase()}</b> ({h.sc.tempC} °C, {h.sc.rh} % RH), <b>{num(b.hotReceptors)} of {h.heat.receptors.length}</b> places where people wait are highly exposed in the {h.win.name.toLowerCase()}.</Verdict>
      )}
      <div className="stats">
        {card('Exposure at busy places', 'weightedIndex', v => num(v, 1), false, 'Footfall-weighted exposure index (0–100)')}
        {card(`High-exposure places (of ${h.heat.receptors.length})`, 'hotReceptors', v => num(v), false, `Index ${P.high} or more`)}
        {card('Shade where people wait', 'receptorShade', pctTxt, true)}
        {card('Street space in sun at midday', 'exposedShare', pctTxt, false, undefined, true)}
        {card('Direct sun per spot', 'sunHours', v => `${num(v, 1)} h`)}
        {card('Shade over all walkable space', 'shadeShare', pctTxt, true)}
        {card('Mean exposure index', 'meanIndex', v => num(v, 1))}
        {card('Heat absorbed by roofs', 'roofHeat', v => `${num(v, 0)} MWh`, false, 'Cool roofs cut this')}
      </div>
      <div className="an-grid">
        <Section title="Scenario">
          <div className="kvs">
            <div className="kv"><span>Neighbourhood</span><b>{h.site.name}, {h.site.city}</b></div>
            <div className="kv"><span>Day</span><b>{h.sc.name}</b></div>
            <div className="kv"><span>Weather</span><b>{h.sc.tempC} °C · {h.sc.rh} % RH · wind {h.sc.windMs} m/s</b></div>
            <div className="kv"><span>Heat index in the shade</span><b>{num(h.baseline.heatIndexC, 1)} °C ({heatIndexBand(h.baseline.heatIndexC)})</b></div>
            <div className="kv"><span>Hours studied</span><b>{h.win.name}</b></div>
            <div className="kv"><span>Walkable space</span><b>{num(b.pedArea / 1e4, 1)} ha</b></div>
            <div className="kv"><span>Trees · places people wait</span><b>{num(h.heat.trees.length)} · {num(h.heat.receptors.length)}</b></div>
          </div>
        </Section>
        <Section title="Hottest places" hint={a ? 'your plan' : 'no action'}>
          <HBars rows={(h.run ?? h.baseline).hotspots.slice(0, 6).map(x => ({ label: x.name, sub: `${KIND[x.kind]} · ${num(x.sunHours, 1)} h sun`, value: x.index, color: x.index >= P.high ? '#ef4444' : x.index >= P.moderate ? '#f59e0b' : '#22c55e' }))} fmt={v => num(v, 0)} max={100} />
          <p className="fine">Exposure index, 0–100: moderate from {P.moderate}, high from {P.high}.</p>
        </Section>
      </div>
    </>
  );
}

export function HeatDay({ h }: { h: H }) {
  const share = useMemo(() => ({ none: h.baseline ? sunShare(h.baseline) : null, plan: h.run ? sunShare(h.run) : null }), [h.baseline, h.run]);
  if (!h.baseline || !share.none) return null;
  const st = h.baseline.steps, xs = st.map(s => s.hour - DAY_START), xFmt = (v: number) => clock(v + DAY_START);
  const marks = [{ x: h.win.start - DAY_START, label: 'window' }, { x: h.win.end - DAY_START, label: '' }];
  const one = (label: string, ys: number[], color: string) => [{ key: label, label, color, xs, ys, area: true }];
  return (
    <>
      <Stale h={h} />
      <div className="an-grid">
        <Section title="Walkable space in direct sun" hint="through the day"><TimeChart lines={[lineOf('none', xs, share.none), ...(share.plan ? [lineOf('plan', xs, share.plan, true)] : [])]} fmt={v => `${Math.round(v)}%`} xFmt={xFmt} marks={marks} /></Section>
        <Section title="Sun height" hint="degrees above the horizon"><TimeChart lines={one('Sun elevation', st.map(s => Math.max(0, s.elev)), '#f59e0b')} fmt={v => `${Math.round(v)}°`} xFmt={xFmt} marks={marks} /></Section>
        <Section title="Direct sunlight" hint="W/m² on a surface facing the sun, clear-sky model"><TimeChart lines={one('Direct normal irradiance', st.map(s => s.dni), '#fb923c')} fmt={v => num(v)} xFmt={xFmt} marks={marks} /></Section>
        <Section title="Sun path" hint="every half hour">
          <DataTable rows={st.filter(s => s.elev > 0)} max={8} cols={[
            { key: 't', label: 'Time', render: s => clock(s.hour) },
            { key: 'e', label: 'Elevation', num: true, render: s => `${Math.round(s.elev)}°`, sort: s => s.elev },
            { key: 'a', label: 'Azimuth', num: true, render: s => `${Math.round(s.az)}°` },
            { key: 'd', label: 'DNI', num: true, render: s => `${num(s.dni)} W/m²`, sort: s => s.dni },
          ]} />
        </Section>
      </div>
    </>
  );
}

export function HeatExposure({ h }: { h: H }) {
  const d = useMemo(() => {
    if (!h.grid || !h.baseline) return null;
    const g = h.grid, r = h.run;
    return {
      idx: { none: binPed(g, h.baseline, h.baseline.exposure, INDEX_BINS), plan: r ? binPed(g, r, r.exposure, INDEX_BINS) : null },
      sun: { none: binPed(g, h.baseline, h.baseline.sunHours, SUN_BINS), plan: r ? binPed(g, r, r.sunHours, SUN_BINS) : null },
    };
  }, [h.grid, h.baseline, h.run]);
  if (!d || !h.baseline) return null;
  const ser = (x: { none: number[]; plan: number[] | null }) => [{ key: 'none' as const, values: x.none }, ...(x.plan ? [{ key: 'plan' as const, values: x.plan }] : [])];
  const ha = (v: number) => `${num(v / 1e4, 2)} ha`;
  const hot = (v: number[]) => v[4] + v[5];
  return (
    <>
      <Stale h={h} />
      <div className="an-grid">
        <Section title="Exposure across walkable space" hint="area by exposure index"><Histogram bins={INDEX_LABELS} series={ser(d.idx)} fmt={ha} xLabel="exposure index" height={240} /></Section>
        <Section title="Hours of direct sun" hint={`area by sun hours, ${h.win.name.toLowerCase()}`}><Histogram bins={SUN_LABELS} series={ser(d.sun)} fmt={ha} xLabel="direct sun" height={240} /></Section>
        <Section title="In numbers">
          <table className="ledger">
            <thead><tr><th>Measure</th><th>No action</th>{d.idx.plan && <th>Your plan</th>}</tr></thead>
            <tbody>
              <tr><td>Walkable space at index 65+</td><td>{ha(hot(d.idx.none))}</td>{d.idx.plan && <td>{ha(hot(d.idx.plan))}</td>}</tr>
              <tr><td>Walkable space with 3 h+ of sun</td><td>{ha(d.sun.none[4])}</td>{d.sun.plan && <td>{ha(d.sun.plan[4])}</td>}</tr>
              <tr><td>Shade over walkable space</td><td>{pctTxt(h.baseline.metrics.shadeShare)}</td>{h.run && <td>{pctTxt(h.run.metrics.shadeShare)}</td>}</tr>
              <tr><td>Space in sun when the sun is highest</td><td>{num(h.baseline.metrics.exposedArea / 1e4, 2)} ha</td>{h.run && <td>{num(h.run.metrics.exposedArea / 1e4, 2)} ha</td>}</tr>
            </tbody>
          </table>
          <p className="fine">Index = {P.wSun * 100} × sun dose + {P.wSurface * 100} × surface heating + {P.wAmbient * 100} × air heat. A relative index for comparing places and plans, not a health measure.</p>
        </Section>
      </div>
    </>
  );
}

export function HeatPlaces({ h, close }: { h: H; close: () => void }) {
  const [which, setWhich] = useState<'none' | 'plan'>(h.run ? 'plan' : 'none');
  if (!h.heat || !h.baseline || !h.grid) return null;
  const g = h.grid, r = which === 'plan' && h.run ? h.run : h.baseline;
  const by = (res: HeatResult) => new Map(res.receptors.map(x => [x.id, x]));
  const bm = by(h.baseline), pm = h.run ? by(h.run) : null;
  const rows = h.heat.receptors.map(rc => ({ rc, b: bm.get(rc.id), p: pm?.get(rc.id) }));
  const kinds = [...new Set(h.heat.receptors.map(x => x.kind))];
  const fly = (x: number, z: number) => { useStore.setState({ flyTo: { x: x - half(g), z: z - half(g), t: Date.now() } }); close(); };
  const score = (x: typeof rows[number]) => (which === 'plan' && x.p ? x.p : x.b);
  return (
    <>
      <Stale h={h} />
      {h.run && <div className="seg"><button className={which === 'none' ? 'on' : ''} onClick={() => setWhich('none')}>No action</button><button className={which === 'plan' ? 'on' : ''} onClick={() => setWhich('plan')}>Your plan</button></div>}
      <div className="an-grid">
        <Section title="Exposure by kind of place" hint="average index">
          <HBars rows={kinds.map(k => { const xs = rows.filter(x => x.rc.kind === k); const v = xs.reduce((a, x) => a + (score(x)?.index ?? 0), 0) / Math.max(1, xs.length); return { label: KIND[k], sub: `${xs.length} places`, value: v, color: v >= P.high ? '#ef4444' : v >= P.moderate ? '#f59e0b' : '#22c55e' }; })} fmt={v => num(v, 0)} max={100} />
        </Section>
        <Section title="Shade where people wait" hint="share of direct sun blocked">
          <HBars rows={rows.slice().sort((a, b) => (score(a)?.shade ?? 0) - (score(b)?.shade ?? 0)).slice(0, 8).map(x => ({ label: x.rc.name, sub: KIND[x.rc.kind], value: (score(x)?.shade ?? 0) * 100, color: SERIES.plan.color }))} fmt={v => `${Math.round(v)}%`} max={100} />
          <p className="fine">The eight least shaded places.</p>
        </Section>
        <Section title={`All ${rows.length} places people wait`} hint={`${which === 'plan' ? 'your plan' : 'no action'} · click a row to fly there`}>
          <DataTable rows={rows} initial="idx" onRow={x => fly(x.rc.x, x.rc.z)} cols={[
            { key: 'name', label: 'Place', render: x => <>{x.rc.name}{x.rc.synthetic && <em className="syn-tag">synthetic</em>}</>, sort: x => x.rc.name },
            { key: 'kind', label: 'Kind', render: x => KIND[x.rc.kind], sort: x => x.rc.kind },
            { key: 'foot', label: 'Footfall', num: true, render: x => num(x.rc.footfall, 1), sort: x => x.rc.footfall },
            { key: 'idx', label: 'Index', num: true, render: x => { const s = score(x); return s ? <span className={`state ${s.index >= P.high ? 'water' : s.index >= P.moderate ? 'at' : 'dry'}`}>{Math.round(s.index)}</span> : '—'; }, sort: x => score(x)?.index ?? 0 },
            { key: 'shade', label: 'Shade', num: true, render: x => pctTxt(score(x)?.shade ?? 0), sort: x => score(x)?.shade ?? 0 },
            { key: 'sun', label: 'Sun', num: true, render: x => `${num(score(x)?.sunHours ?? 0, 1)} h`, sort: x => score(x)?.sunHours ?? 0 },
            ...(h.run ? [{ key: 'chg', label: 'Change', num: true, render: (x: typeof rows[number]) => { const d = (x.p?.index ?? 0) - (x.b?.index ?? 0); return <span className={d < -0.5 ? 'good' : d > 0.5 ? 'bad' : 'muted'}>{d > 0 ? '+' : ''}{num(d, 1)}</span>; }, sort: (x: typeof rows[number]) => (x.p?.index ?? 0) - (x.b?.index ?? 0) }] : []),
          ]} />
          <p className="fine">{r === h.baseline ? 'No action.' : 'Your plan.'} High from {P.high}, moderate from {P.moderate}.</p>
        </Section>
      </div>
    </>
  );
}

export function HeatCost({ h }: { h: H }) {
  if (!h.grid || !h.baseline || !h.heat) return null;
  const g = h.grid, types = Object.keys(HEAT_CATALOG) as HeatInterventionType[], spent = heatPlanCost(g, h.plan), b = h.baseline.metrics, a = h.run?.metrics;
  const cut = (base: HeatMetrics, m: HeatMetrics) => (base.weightedIndex ? (1 - m.weightedIndex / base.weightedIndex) * 100 : 0);
  const pts: Pt[] = [{ id: 'none', label: 'No action', x: 0, y: 0, color: SERIES.none.color, hollow: true }];
  if (a && !h.stale) pts.push({ id: 'plan', label: 'Your plan', x: spent, y: cut(b, a), color: SERIES.plan.color, r: 8 });
  if (h.rec) pts.push({ id: 'rec', label: 'Recommended', x: h.rec.cost, y: cut(b, h.rec.metrics), color: SERIES.hydra.color });
  if (h.sd) {
    h.sd.spreads.forEach((x, k) => pts.push({ id: `s${k}`, label: k === 0 ? 'Even spread' : '', x: x.cost, y: cut(h.sd!.base, x.metrics), color: SERIES.spread.color, r: 5, note: `random plan ${k + 1}` }));
    pts.push({ id: 'sdh', label: h.rec ? 'Showdown HYDRA' : 'HYDRA plan', x: h.sd.hydra.cost, y: cut(h.sd.base, h.sd.hydra.metrics), color: SERIES.hydra.color, r: 6 });
  }
  return (
    <>
      <Stale h={h} />
      <CostView spent={spent} budget={h.budget} benefitLabel="Exposure cut at busy places"
        parts={types.map(t => { const items = h.plan.filter(p => p.type === t); return { label: HEAT_CATALOG[t].name, color: HEAT_CATALOG[t].color, count: items.length, cost: heatPlanCost(g, items) }; })}
        value={a ? [
          { label: 'Per high-exposure place cooled', cost: spent, benefit: b.hotReceptors - a.hotReceptors, unit: 'place' },
          { label: 'Per point of shade where people wait', cost: spent, benefit: (a.receptorShade - b.receptorShade) * 100, unit: 'point' },
          { label: 'Per index point at busy places', cost: spent, benefit: b.weightedIndex - a.weightedIndex, unit: 'point' },
          { label: 'Per MWh less roof heat', cost: spent, benefit: b.roofHeat - a.roofHeat, unit: 'MWh' },
        ] : null}
        frontier={pts}
        items={h.plan.map((iv: HeatIntervention) => ({ name: describeHeat(g, h.heat!, iv), type: HEAT_CATALOG[iv.type].short, color: HEAT_CATALOG[iv.type].color, cost: heatCostOf(g, iv), source: iv.source }))}
        note="Illustrative 2024 rates, not a schedule of rates. Trees are modelled at maturity, which takes years." />
    </>
  );
}

export function HeatStrategies({ h, close }: { h: H; close: () => void }) {
  const d = heatStrat(h.sd, h.grid), st = useHeat.getState();
  if (h.busy) return <div className="callout soft"><span className="spinner" />{h.busy.msg}</div>;
  if (!d) return <Empty title="No showdown yet">Run the budget showdown to compare HYDRA's shade plan with spending the same {fmtINR(h.budget)} evenly. <button className="btn accent sm" onClick={() => st.runShowdown()}>Run the showdown</button></Empty>;
  return <StrategyView d={d} place="day" actions={<>
    <button className="btn primary sm" onClick={() => { st.setPlan(h.sd!.hydra.plan); close(); }}>Use HYDRA's plan</button>
    <button className="btn sm" onClick={() => st.runShowdown()}>Run again</button>
  </>} />;
}

export function HeatMethod({ h }: { h: H }) {
  if (!h.heat || !h.baseline || !h.site) return null;
  const s = h.heat.stats;
  return (
    <div className="an-grid">
      <Section title="Data sources">
        <div className="kvs">
          <div className="kv"><span>Trees from OSM / synthetic</span><b>{num(s.osmTrees)} / {num(s.syntheticTrees)}</b></div>
          <div className="kv"><span>Places from OSM / synthetic</span><b>{num(s.osmReceptors)} / {num(s.syntheticReceptors)}</b></div>
          <div className="kv"><span>Buildings, roads, terrain</span><b>same as flood mode</b></div>
        </div>
        <div className="prov-bar"><i style={{ flex: s.osmTrees + s.osmReceptors }} /><i className="syn" style={{ flex: s.syntheticTrees + s.syntheticReceptors }} /></div>
        <p className="fine">Synthetic, and labelled in the app: {h.heat.provenance.synthetic.join('; ')}.</p>
      </Section>
      <Section title="Model parameters">
        <table className="ledger">
          <tbody>
            <tr><td>Index weights: sun · surface · air</td><td>{P.wSun * 100} · {P.wSurface * 100} · {P.wAmbient * 100}</td></tr>
            <tr><td>Sun through tree crowns · canopies</td><td>{Math.round(P.treeTrans * 100)} % · {Math.round(P.canopyTrans * 100)} %</td></tr>
            <tr><td>Person height for shade tracing</td><td>{P.personHeight} m</td></tr>
            <tr><td>New tree at maturity</td><td>{P.newTree.h} m tall, {P.newTree.r} m crown</td></tr>
            <tr><td>Roof albedo · cool roof</td><td>{P.roofAlbedo} · {P.coolRoofAlbedo}</td></tr>
            <tr><td>Moderate · high exposure</td><td>{P.moderate} · {P.high}</td></tr>
          </tbody>
        </table>
      </Section>
      <Section title="Model check">
        <div className="kvs">
          <div className="kv"><span>Run time</span><b>{Math.round(h.baseline.runtimeMs)} ms</b></div>
          <div className="kv"><span>Calculated</span><b>{h.baseline.source === 'server' ? 'HYDRA API (AWS)' : 'in this browser'}</b></div>
          <div className="kv"><span>Sun positions traced</span><b>{h.baseline.steps.length} (every half hour)</b></div>
          <div className="kv"><span>Location</span><b>{h.site.center[0].toFixed(3)}° N, {h.site.center[1].toFixed(3)}° E</b></div>
        </div>
      </Section>
      <Section title="Limits">
        <p className="sub">A transparent relative-exposure model for comparing places and plans under the same weather. It is not UTCI, WBGT or mean radiant temperature, and it does not predict health outcomes. It ignores reflected sunlight, night-time heat release and air movement between streets.</p>
      </Section>
    </div>
  );
}

export function heatCsv(h: H): CsvTable[] {
  if (!h.baseline || !h.grid || !h.heat) return [];
  const b = h.baseline.metrics, a = h.run?.metrics, g = h.grid;
  const ks = Object.keys(b) as (keyof HeatMetrics)[];
  const bm = new Map(h.baseline.receptors.map(x => [x.id, x])), pm = h.run ? new Map(h.run.receptors.map(x => [x.id, x])) : null;
  return [
    { title: `HYDRA heat analytics,${h.site?.name ?? ''} ${h.site?.city ?? ''},${h.sc.name},${h.win.name}`, rows: [] },
    { title: 'Metric,No action,Your plan', rows: ks.map(k => [k, +b[k].toFixed(4), a ? +a[k].toFixed(4) : '']) },
    { title: 'Place,Kind,Footfall,Index no action,Index plan,Shade no action,Shade plan', rows: h.heat.receptors.map(rc => [rc.name, rc.kind, rc.footfall, +(bm.get(rc.id)?.index ?? 0).toFixed(1), pm ? +(pm.get(rc.id)?.index ?? 0).toFixed(1) : '', +(bm.get(rc.id)?.shade ?? 0).toFixed(3), pm ? +(pm.get(rc.id)?.shade ?? 0).toFixed(3) : '']) },
    { title: 'Intervention,Type,Cost (INR),Placed by', rows: h.plan.map(iv => [describeHeat(g, h.heat!, iv), HEAT_CATALOG[iv.type].name, Math.round(heatCostOf(g, iv)), iv.source ?? 'user']) },
  ];
}
