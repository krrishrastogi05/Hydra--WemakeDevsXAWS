// Flood-mode sections of the analytics view. Every number comes from the simulation results (per cell and per
// frame), the plan and the showdown in the store; nothing is estimated here.
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { planKey, useStore } from '../../store';
import { fmtINR, type Grid } from '../../sim/grid';
import { CATALOG, PARAMS, STORMS, costOf, planCost } from '../../sim/flood/model';
import { DEPTH } from '../../sim/flood/engine';
import type { Intervention, InterventionType, Metrics, SimResult } from '../../sim/flood/types';
import { COVER } from '../../sim/types';
import { SERIES, type SeriesKey } from '../charts';
import { Empty, Section, Verdict, num } from '../kit';
import { describe } from '../Panel';
import { half } from '../../three/geo';
import { Columns, DataTable, HBars, Histogram, TimeChart, lineOf, type CsvTable, type Pt } from '../viz';
import { CostView, StatCard, StrategyView } from './common';
import { floodStrat } from './strat';

const m3 = (v: number) => `${num(Math.round(v))} m³`;
const compact = (v: number) => (Math.abs(v) >= 1e5 ? `${num(v / 1e3, 0)}k` : Math.abs(v) >= 1e3 ? `${num(v / 1e3, 1)}k` : num(v, v < 10 && v % 1 ? 1 : 0));
const pct = (a: number, b: number) => (a > 0 ? (1 - b / a) * 100 : 0);
const tmin = (m: number) => `T+${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const peakAt = (r: SimResult) => { let k = 0; for (let i = 1; i < r.pondedSeries.length; i++) if (r.pondedSeries[i] > r.pondedSeries[k]) k = i; return r.frameTimes[k]; };
const firstHomes = (r: SimResult) => { const h = r.live?.homesFlooded; if (!h) return null; for (let i = 0; i < h.length; i++) if (h[i] > 0) return r.frameTimes[i]; return null; };

export function useFlood() {
  const s = useStore(useShallow(st => ({ grid: st.grid, site: st.site, baseline: st.baseline, current: st.current, currentKey: st.currentKey, plan: st.plan, budget: st.budget,
    stormId: st.stormId, antecedent: st.antecedent, rec: st.recommendation, sd: st.showdown, running: st.running, busy: st.busy })));
  const run = s.plan.length && s.current && s.currentKey ? s.current : null;
  return { ...s, run, stale: !!run && planKey(s.plan) !== s.currentKey, storm: STORMS.find(x => x.id === s.stormId)! };
}
type F = ReturnType<typeof useFlood>;

function Stale({ f }: { f: F }) {
  if (f.running) return <div className="callout soft"><span className="spinner" />Recalculating…</div>;
  return f.stale ? <div className="callout">Your plan changed since its last run: plan figures below are from that run.</div> : null;
}

// ---------- distributions ----------
const DEPTH_BINS = [0.01, 0.05, 0.1, 0.15, 0.3, 0.45, Infinity], DEPTH_LABELS = ['1–5 cm', '5–10', '10–15', '15–30', '30–45', '45 cm+'];
const TIME_BINS = [1, 30, 60, 120, 180, Infinity], TIME_LABELS = ['< 30 min', '30–60', '1–2 h', '2–3 h', '3 h+'];
function binArea(g: Grid, vals: Float32Array, edges: number[]) {
  const out = new Array(edges.length - 1).fill(0);
  for (let i = 0; i < g.n; i++) {
    if (g.cover[i] === COVER.BUILDING) continue;
    const v = vals[i];
    if (v < edges[0]) continue;
    let b = 0;
    while (b < out.length - 1 && v >= edges[b + 1]) b++;
    out[b] += g.A;
  }
  return out;
}
const DRAIN_CLASSES = ['Idle', 'Flowing', 'Near capacity', 'Full', 'Overflowing'];
function drainStats(g: Grid, r: SimResult) {
  const m = [0, 0, 0, 0, 0];
  let disconnected = 0, newM = 0;
  r.drainCells.forEach((c, k) => {
    const p = r.drainPeak[c], cls = p >= 2 ? 4 : p >= 0.97 ? 3 : p >= 0.7 ? 2 : p >= 0.05 ? 1 : 0;
    m[cls] += g.dx;
    if (g.drain[c] < 0) { newM += g.dx; if (r.drainDown[k] === -2) disconnected += g.dx; }
  });
  let surcharge = 0, spilled = 0, filled = 0;
  for (let i = 0; i < g.n; i++) { surcharge += r.surcharge[i]; if (r.lakeInflow[i] > 0.01) filled++; if (r.lakeSpill[i] > 0.01) spilled++; }
  return { m, total: m.reduce((a, x) => a + x, 0), disconnected, newM, surcharge, filled, spilled };
}

// ---------- sections ----------
export function Summary({ f }: { f: F }) {
  if (!f.grid || !f.baseline || !f.site) return null;
  const b = f.baseline.metrics, a = f.run?.metrics, B = f.baseline.live, P = f.run?.live;
  const spent = planCost(f.grid, f.plan);
  const card = (label: string, k: keyof Metrics, fmt: (v: number) => string, spark?: [ArrayLike<number> | undefined, ArrayLike<number> | undefined], hint?: string, scale = 1) => {
    const base = (b[k] as number) * scale, now = a ? (a[k] as number) * scale : null, d = now == null ? 0 : pct(base, now);
    return <StatCard label={label} hint={hint} value={fmt(now ?? base)} base={fmt(base)} change={now == null ? undefined : `${num(Math.abs(d), Math.abs(d) < 10 ? 1 : 0)}%`} tone={d > 0.05 ? 'good' : d < -0.05 ? 'bad' : 'flat'}
      spark={spark?.[0] ? { ys: (now == null ? spark[0] : spark[1] ?? spark[0])!, base: now == null ? undefined : spark[0] } : undefined} />;
  };
  const residents = f.grid.site.buildings.reduce((x, bb) => x + bb.residents, 0), synth = f.site.stats.syntheticBuildings;
  const moments = (r: SimResult) => ({ first: firstHomes(r), peak: peakAt(r), end: r.budget.standingEnd });
  const mb = moments(f.baseline), mp = f.run ? moments(f.run) : null;
  return (
    <>
      <Stale f={f} />
      {a ? (
        <Verdict tone={pct(b.impact, a.impact) > 0 ? 'good' : 'warn'} kicker="Your plan">
          For <b>{fmtINR(spent)}</b> across <b>{f.plan.length} interventions</b>, <b>{num(Math.max(0, b.buildingsFlooded - a.buildingsFlooded))} homes</b> stay dry, <b>{num(Math.max(0, b.residentsAffected - a.residentsAffected))} fewer residents</b> are affected and flood impact falls <b>{num(pct(b.impact, a.impact), 1)}%</b>.
        </Verdict>
      ) : (
        <Verdict tone="neutral" kicker="No action">In a <b>{f.storm.name.toLowerCase()}</b> ({f.storm.totalMm} mm in {f.storm.durationMin / 60} h), <b>{num(b.buildingsFlooded)} homes</b> take water, <b>{num(b.residentsAffected)} residents</b> are affected and <b>{num(b.roadKmAffected, 2)} km</b> of road is cut.</Verdict>
      )}
      <div className="stats">
        {card('Homes with water inside', 'buildingsFlooded', v => num(v), [B?.homesFlooded, P?.homesFlooded], 'Water at the doorstep rose above the plinth')}
        {card('Residents affected (est.)', 'residentsAffected', v => num(v), [B?.residents, P?.residents])}
        {card('Roads cut (> 15 cm)', 'roadKmAffected', v => `${num(v, 2)} km`, [B?.roadKmCut, P?.roadKmCut])}
        {card('Waterlogged area', 'floodedArea', v => `${num(v, 2)} ha`, [B?.wetArea, P?.wetArea], 'Street depth above 10 cm', 1e-4)}
        {card('Peak standing water', 'peakPonded', m3, [f.baseline.pondedSeries, f.run?.pondedSeries])}
        {card('Deepest water', 'maxDepth', v => `${num(v * 100)} cm`)}
        {card('Drain overflow', 'drainSurcharge', m3, [B?.drainOverflowM, P?.drainOverflowM], 'Water pushed back onto streets by full drains')}
        {card('Schools & hospitals hit', 'criticalAffected', v => num(v), undefined, 'Critical facilities with water at the door')}
      </div>
      <div className="an-grid">
        <Section title="Scenario">
          <div className="kvs">
            <div className="kv"><span>Neighbourhood</span><b>{f.site.name}, {f.site.city}</b></div>
            <div className="kv"><span>Storm</span><b>{f.storm.name} · {f.storm.totalMm} mm in {f.storm.durationMin / 60} h</b></div>
            <div className="kv"><span>Soil before the storm</span><b>{f.antecedent}</b></div>
            <div className="kv"><span>Rain volume on the area</span><b>{m3(f.baseline.budget.rain)}</b></div>
            <div className="kv"><span>Area modelled</span><b>{num((f.grid.n * f.grid.A) / 1e4, 0)} ha · {f.grid.dx} m grid</b></div>
            <div className="kv"><span>Buildings</span><b>{num(f.grid.site.buildings.length)} ({num(synth)} synthetic)</b></div>
            <div className="kv"><span>Residents (estimate)</span><b>{num(residents)}</b></div>
            <div className="kv"><span>Soil</span><b>{f.site.soil.name} · infiltration ×{f.site.soil.factor}</b></div>
          </div>
        </Section>
        <Section title="Key moments" hint="minutes after the rain starts">
          <table className="ledger">
            <thead><tr><th>Moment</th><th>No action</th>{mp && <th>Your plan</th>}</tr></thead>
            <tbody>
              <tr><td>First home takes water</td><td>{mb.first == null ? 'never' : tmin(mb.first)}</td>{mp && <td>{mp.first == null ? 'never' : tmin(mp.first)}</td>}</tr>
              <tr><td>Rain stops</td><td>{tmin(f.storm.durationMin)}</td>{mp && <td>{tmin(f.storm.durationMin)}</td>}</tr>
              <tr><td>Most water on the streets</td><td>{tmin(mb.peak)}</td>{mp && <td>{tmin(mp.peak)}</td>}</tr>
              <tr><td>Still standing at the end</td><td>{m3(mb.end)}</td>{mp && <td>{m3(mp.end)}</td>}</tr>
            </tbody>
          </table>
          {mp && mb.first != null && mp.first != null && mp.first > mb.first && <p className="fine">Your plan buys <b>{Math.round(mp.first - mb.first)} more minutes</b> before the first home floods: time to move people and goods.</p>}
        </Section>
      </div>
    </>
  );
}

export function Timeline({ f }: { f: F }) {
  if (!f.baseline) return null;
  const B = f.baseline, P = f.run, xs = B.frameTimes, marks = [{ x: f.storm.durationMin, label: 'rain stops' }];
  const two = (yb: ArrayLike<number>, yp: ArrayLike<number> | undefined, area = false) => [lineOf('none', xs, yb), ...(P && yp ? [lineOf('plan', P.frameTimes, yp, area)] : [])];
  const xFmt = (v: number) => `${Math.round(v)} min`;
  return (
    <>
      <Stale f={f} />
      <div className="an-grid">
        <Section title="Rainfall intensity" hint={`${f.storm.name} · IMD design storm`}>
          <Columns xs={xs} ys={B.rainSeries} color={SERIES.hydra.color} fmt={v => `${num(v)} mm/h`} xFmt={xFmt} label="Rain" />
          <p className="fine">Peak {num(Math.max(...B.rainSeries))} mm/h. {f.storm.note}</p>
        </Section>
        <Section title="Standing water" hint="m³ on streets and open ground"><TimeChart lines={two(B.pondedSeries, P?.pondedSeries, true)} fmt={compact} xFmt={xFmt} marks={marks} /></Section>
        {B.live ? (
          <>
            <Section title="Homes with water inside"><TimeChart lines={two(B.live.homesFlooded, P?.live?.homesFlooded)} fmt={v => num(v)} xFmt={xFmt} marks={marks} /></Section>
            <Section title="Residents affected"><TimeChart lines={two(B.live.residents, P?.live?.residents)} fmt={compact} xFmt={xFmt} marks={marks} /></Section>
            <Section title="Roads cut" hint="km deeper than 15 cm"><TimeChart lines={two(B.live.roadKmCut, P?.live?.roadKmCut)} fmt={v => `${num(v, 2)}`} xFmt={xFmt} marks={marks} /></Section>
            <Section title="Drains overflowing" hint="metres of drain surcharging"><TimeChart lines={two(B.live.drainOverflowM, P?.live?.drainOverflowM)} fmt={compact} xFmt={xFmt} marks={marks} /></Section>
            <Section title="Rain fallen so far" hint="mm, cumulative"><TimeChart lines={[lineOf('none', xs, B.live.rainMm, true)].map(l => ({ ...l, label: 'Rain', color: SERIES.hydra.color, dashed: false }))} fmt={v => num(v)} xFmt={xFmt} marks={marks} /></Section>
            <Section title="Waterlogged area" hint="ha deeper than 10 cm"><TimeChart lines={two(Float32Array.from(B.live.wetArea, v => v / 1e4), P?.live ? Float32Array.from(P.live.wetArea, v => v / 1e4) : undefined)} fmt={v => num(v, 2)} xFmt={xFmt} marks={marks} /></Section>
          </>
        ) : <Section title="Conditions over time"><p className="sub">This result came from an older API without per-minute conditions.</p></Section>}
      </div>
    </>
  );
}

export function WaterBalance({ f }: { f: F }) {
  if (!f.baseline) return null;
  const rows = (r: SimResult) => [
    ['Soaked into the ground', r.budget.infiltrated], ['Stored by rooftop harvesting', r.budget.harvested], ['Absorbed by rain gardens and pits', r.budget.gardens + r.budget.pits],
    ['Carried away by drains', r.budget.drains + r.budget.drainStore], ['Ran off over the surface', r.budget.edge + r.budget.channel], ['Still standing at the end', Math.max(0, r.budget.standingEnd)],
  ] as [string, number][];
  const b = rows(f.baseline), p = f.run ? rows(f.run) : null, rain = f.baseline.budget.rain;
  const keys: SeriesKey[] = p ? ['none', 'plan'] : ['none'];
  return (
    <>
      <Stale f={f} />
      <div className="an-grid">
        <Section title="Where the rain went" hint={`${m3(rain)} fell on the area · share of all rain`}>
          <Histogram bins={['Ground', 'Roof tanks', 'Gardens & pits', 'Drains', 'Surface', 'Standing']} series={keys.map(k => ({ key: k, values: (k === 'none' ? b : p!).map(([, v]) => (v / rain) * 100) }))} fmt={v => `${num(v, v < 10 ? 1 : 0)}%`} height={240} />
        </Section>
        <Section title="Water balance" hint="m³ · every drop accounted for">
          <table className="ledger">
            <thead><tr><th>Destination</th><th>No action</th>{p && <><th>Your plan</th><th>Change</th></>}</tr></thead>
            <tbody>{b.map(([label, v], k) => <tr key={label}><td>{label}</td><td>{m3(v)}</td>{p && <><td>{m3(p[k][1])}</td><td className={p[k][1] - v > 0.5 ? (k === 5 ? 'bad' : 'good') : p[k][1] - v < -0.5 ? (k === 5 ? 'good' : '') : ''}>{p[k][1] - v >= 0 ? '+' : '−'}{m3(Math.abs(p[k][1] - v))}</td></>}</tr>)}</tbody>
            <tfoot><tr><td>Rain</td><td>{m3(rain)}</td>{p && <><td>{m3(rain)}</td><td /></>}</tr></tfoot>
          </table>
          <p className="fine">Mass balance closes to {num(Math.abs(f.baseline.budget.error), 2)} m³{p ? ` (no action) and ${num(Math.abs(f.run!.budget.error), 2)} m³ (your plan)` : ''} out of {m3(rain)}.</p>
        </Section>
        {p && (
          <Section title="What your plan changed" hint="m³ moved between destinations">
            <HBars rows={b.map(([label, v], k) => ({ label, value: p[k][1] - v, color: p[k][1] - v >= 0 ? SERIES.plan.color : SERIES.spread.color }))} fmt={v => `${v >= 0 ? '+' : '−'}${m3(Math.abs(v))}`} />
            <p className="fine">Green: more water went this way. Orange: less. Good plans move water out of "standing" and into the ground, tanks and drains.</p>
          </Section>
        )}
      </div>
    </>
  );
}

export function DepthDuration({ f }: { f: F }) {
  const data = useMemo(() => {
    if (!f.grid || !f.baseline) return null;
    const g = f.grid, r = f.run;
    return {
      depth: { none: binArea(g, f.baseline.maxDepth, DEPTH_BINS), plan: r ? binArea(g, r.maxDepth, DEPTH_BINS) : null },
      time: { none: binArea(g, f.baseline.timeOver, TIME_BINS), plan: r ? binArea(g, r.timeOver, TIME_BINS) : null },
    };
  }, [f.grid, f.baseline, f.run]);
  if (!data || !f.baseline) return null;
  const series = (d: { none: number[]; plan: number[] | null }) => [{ key: 'none' as const, values: d.none }, ...(d.plan ? [{ key: 'plan' as const, values: d.plan }] : [])];
  const wet = (v: number[]) => v.reduce((a, x) => a + x, 0);
  return (
    <>
      <Stale f={f} />
      <div className="an-grid">
        <Section title="How deep the water got" hint="area of street and ground by peak depth"><Histogram bins={DEPTH_LABELS} series={series(data.depth)} fmt={v => `${compact(v)} m²`} xLabel="peak depth" height={240} /></Section>
        <Section title="How long roads stayed cut" hint="area deeper than 15 cm, by duration"><Histogram bins={TIME_LABELS} series={series(data.time)} fmt={v => `${compact(v)} m²`} xLabel="time above 15 cm" height={240} /></Section>
        <Section title="In numbers">
          <table className="ledger">
            <thead><tr><th>Measure</th><th>No action</th>{data.depth.plan && <th>Your plan</th>}</tr></thead>
            <tbody>
              <tr><td>Ground wetter than 1 cm</td><td>{num(wet(data.depth.none) / 1e4, 2)} ha</td>{data.depth.plan && <td>{num(wet(data.depth.plan) / 1e4, 2)} ha</td>}</tr>
              <tr><td>Deeper than 15 cm (two-wheelers stall)</td><td>{num(data.depth.none.slice(3).reduce((a, x) => a + x, 0) / 1e4, 2)} ha</td>{data.depth.plan && <td>{num(data.depth.plan.slice(3).reduce((a, x) => a + x, 0) / 1e4, 2)} ha</td>}</tr>
              <tr><td>Deeper than 45 cm (cars stall)</td><td>{num(data.depth.none[5] / 1e4, 2)} ha</td>{data.depth.plan && <td>{num(data.depth.plan[5] / 1e4, 2)} ha</td>}</tr>
              <tr><td>Road cut for over 2 hours</td><td>{num((data.time.none[3] + data.time.none[4]) / 1e4, 2)} ha</td>{data.time.plan && <td>{num((data.time.plan[3] + data.time.plan[4]) / 1e4, 2)} ha</td>}</tr>
              <tr><td>Road disruption</td><td>{num(f.baseline.metrics.roadKmHours, 2)} km·h</td>{f.run && <td>{num(f.run.metrics.roadKmHours, 2)} km·h</td>}</tr>
            </tbody>
          </table>
          <p className="fine">Thresholds: waterlogged above {DEPTH.wet * 100} cm, road cut above {DEPTH.road * 100} cm.</p>
        </Section>
      </div>
    </>
  );
}

export function Drainage({ f }: { f: F }) {
  const st = useMemo(() => (f.grid && f.baseline ? { none: drainStats(f.grid, f.baseline), plan: f.run ? drainStats(f.grid, f.run) : null } : null), [f.grid, f.baseline, f.run]);
  if (!st || !f.grid) return null;
  return (
    <>
      <Stale f={f} />
      <div className="an-grid">
        <Section title="How hard the drains worked" hint="metres of drain by peak load"><Histogram bins={DRAIN_CLASSES} series={[{ key: 'none', values: st.none.m }, ...(st.plan ? [{ key: 'plan' as const, values: st.plan.m }] : [])]} fmt={v => `${compact(v)} m`} height={240} /></Section>
        <Section title="Network">
          <table className="ledger">
            <thead><tr><th>Measure</th><th>No action</th>{st.plan && <th>Your plan</th>}</tr></thead>
            <tbody>
              <tr><td>Drain length</td><td>{num(st.none.total)} m</td>{st.plan && <td>{num(st.plan.total)} m</td>}</tr>
              <tr><td>New drains</td><td>—</td>{st.plan && <td>{num(st.plan.newM)} m</td>}</tr>
              <tr><td>Overflowing at peak</td><td>{num(st.none.m[4])} m</td>{st.plan && <td>{num(st.plan.m[4])} m</td>}</tr>
              <tr><td>Water pushed back onto streets</td><td>{m3(st.none.surcharge)}</td>{st.plan && <td>{m3(st.plan.surcharge)}</td>}</tr>
              <tr><td>Low spots that filled</td><td>{num(st.none.filled)} cells</td>{st.plan && <td>{num(st.plan.filled)} cells</td>}</tr>
              <tr><td>…and spilled downstream</td><td>{num(st.none.spilled)} cells</td>{st.plan && <td>{num(st.plan.spilled)} cells</td>}</tr>
            </tbody>
          </table>
          {st.plan && st.plan.disconnected > 0 && <div className="callout">{num(st.plan.disconnected)} m of your new drains do not reach an outfall, so they carry no water away. Extend them to an existing drain or the area edge.</div>}
          <p className="fine">Existing drains run at 50 % of design capacity (silt and solid waste); desilting cuts the silt to {Math.round(PARAMS.desiltTo * 100)} %, restoring about 90 % of capacity.</p>
        </Section>
      </div>
    </>
  );
}

export function Hotspots({ f, close }: { f: F; close: () => void }) {
  const [which, setWhich] = useState<'none' | 'plan'>(f.run ? 'plan' : 'none');
  if (!f.grid || !f.baseline) return null;
  const g = f.grid, r = which === 'plan' && f.run ? f.run : f.baseline, other = r === f.baseline ? f.run : f.baseline;
  const total = r.hotspots.reduce((a, h) => a + h.impact, 0) || 1;
  const fly = (x: number, z: number) => { useStore.setState({ flyTo: { x: x - half(g), z: z - half(g), t: Date.now() } }); close(); };
  const crit = g.site.buildings.map((b, k) => ({ b, k })).filter(x => x.b.critical);
  const status = (res: SimResult | null | undefined, k: number) => { if (!res) return '—'; const d = res.doorstep[k], b = g.site.buildings[k]; return d > b.plinth ? 'water inside' : d > DEPTH.wet ? 'water at the door' : 'dry'; };
  return (
    <>
      <Stale f={f} />
      {f.run && <div className="seg"><button className={which === 'none' ? 'on' : ''} onClick={() => setWhich('none')}>No action</button><button className={which === 'plan' ? 'on' : ''} onClick={() => setWhich('plan')}>Your plan</button></div>}
      <div className="an-grid">
        <Section title="Share of flood harm" hint="top hotspots · click to fly there">
          {r.hotspots.length ? <HBars rows={r.hotspots.slice(0, 8).map((h, k) => ({ label: `${k + 1}. ${h.road}`, sub: `${Math.round(h.maxDepth * 100)} cm deep`, value: (h.impact / total) * 100, color: SERIES.spread.color, onClick: () => fly(h.x, h.z) }))} fmt={v => `${num(v, 1)}%`} />
            : <Empty title="No hotspots">No street is under more than 15 cm.</Empty>}
        </Section>
        <Section title="Schools and hospitals" hint={`${crit.length} in the area`}>
          {crit.length ? <DataTable rows={crit} max={8} cols={[
            { key: 'n', label: 'Facility', render: x => x.b.name || x.b.use, sort: x => x.b.name },
            { key: 'a', label: 'No action', render: x => <span className={`state ${status(f.baseline, x.k).split(' ')[0]}`}>{status(f.baseline, x.k)}</span> },
            ...(f.run ? [{ key: 'p', label: 'Your plan', render: (x: { k: number }) => <span className={`state ${status(f.run, x.k).split(' ')[0]}`}>{status(f.run, x.k)}</span> }] : []),
          ]} /> : <p className="sub">No schools or hospitals mapped here.</p>}
        </Section>
        <Section title="All waterlogging hotspots" hint="click a row to fly there">
          <DataTable rows={r.hotspots} initial="impact" onRow={h => fly(h.x, h.z)} cols={[
            { key: 'road', label: 'Street', render: h => h.road, sort: h => h.road },
            { key: 'depth', label: 'Peak depth', num: true, render: h => `${Math.round(h.maxDepth * 100)} cm`, sort: h => h.maxDepth },
            { key: 'area', label: 'Area', num: true, render: h => `${num(h.area)} m²`, sort: h => h.area },
            { key: 'vol', label: 'Volume', num: true, render: h => m3(h.volume), sort: h => h.volume },
            { key: 'homes', label: 'Homes', num: true, render: h => num(h.buildingsFlooded), sort: h => h.buildingsFlooded },
            { key: 'impact', label: 'Harm share', num: true, render: h => `${num((h.impact / total) * 100, 1)}%`, sort: h => h.impact },
          ]} />
          {other && <p className="fine">Showing {which === 'plan' ? 'your plan' : 'no action'}: {r.hotspots.length} hotspots, against {other.hotspots.length} with {which === 'plan' ? 'no action' : 'your plan'}.</p>}
        </Section>
      </div>
    </>
  );
}

export function Cost({ f }: { f: F }) {
  if (!f.grid || !f.baseline) return null;
  const g = f.grid, types = Object.keys(CATALOG) as InterventionType[], spent = planCost(g, f.plan), b = f.baseline.metrics, a = f.run?.metrics;
  const peak = (r: SimResult) => Math.max(...r.pondedSeries);
  const pts: Pt[] = [{ id: 'none', label: 'No action', x: 0, y: 0, color: SERIES.none.color, hollow: true }];
  if (a && !f.stale) pts.push({ id: 'plan', label: 'Your plan', x: spent, y: pct(b.impact, a.impact), color: SERIES.plan.color, r: 8 });
  if (f.rec) pts.push({ id: 'rec', label: 'Recommended', x: f.rec.cost, y: pct(b.impact, f.rec.metrics.impact), color: SERIES.hydra.color, note: `${f.rec.plan.length} interventions` });
  if (f.sd) {
    f.sd.spreads.forEach((x, k) => pts.push({ id: `s${k}`, label: k === 0 ? 'Even spread' : '', x: x.cost, y: pct(f.sd!.base.impact, x.metrics.impact), color: SERIES.spread.color, r: 5, note: `random plan ${k + 1}` }));
    pts.push({ id: 'sdh', label: f.rec ? 'Showdown HYDRA' : 'HYDRA plan', x: f.sd.hydra.cost, y: pct(f.sd.base.impact, f.sd.hydra.metrics.impact), color: SERIES.hydra.color, r: 6 });
  }
  return (
    <>
      <Stale f={f} />
      <CostView spent={spent} budget={f.budget} benefitLabel="Flood impact cut"
        parts={types.map(t => { const items = f.plan.filter(p => p.type === t); return { label: CATALOG[t].name, color: CATALOG[t].color, count: items.length, cost: planCost(g, items) }; })}
        value={a ? [
          { label: 'Per home kept dry', cost: spent, benefit: b.buildingsFlooded - a.buildingsFlooded, unit: 'home' },
          { label: 'Per resident protected', cost: spent, benefit: b.residentsAffected - a.residentsAffected, unit: 'resident' },
          { label: 'Per km of road kept open', cost: spent, benefit: b.roadKmAffected - a.roadKmAffected, unit: 'km' },
          { label: 'Per 1% less flood impact', cost: spent, benefit: pct(b.impact, a.impact), unit: '1%' },
          { label: 'Per m³ less peak standing water', cost: spent, benefit: peak(f.baseline) - peak(f.run!), unit: 'm³' },
        ] : null}
        frontier={pts}
        items={f.plan.map((iv: Intervention) => ({ name: describe(g, iv), type: CATALOG[iv.type].short, color: CATALOG[iv.type].color, cost: costOf(g, iv), source: iv.source }))}
        note="Indicative 2024 Indian unit rates. Use the local CPWD / PWD schedule of rates for a real estimate." />
    </>
  );
}

export function Strategies({ f, close }: { f: F; close: () => void }) {
  const d = floodStrat(f.sd, f.grid);
  const st = useStore.getState();
  if (f.busy) return <div className="callout soft"><span className="spinner" />{f.busy.msg}</div>;
  if (!d) return <Empty title="No showdown yet">Run the budget showdown to compare HYDRA's plan with spending the same {fmtINR(f.budget)} evenly. <button className="btn accent sm" onClick={() => st.runShowdown()}>Run the showdown</button></Empty>;
  return <StrategyView d={d} place="storm" actions={<>
    <button className="btn primary sm" onClick={() => { st.setPlan(f.sd!.hydra.plan); close(); }}>Use HYDRA's plan</button>
    <button className="btn sm" onClick={() => st.runShowdown()}>Run again</button>
  </>} />;
}

export function Method({ f }: { f: F }) {
  if (!f.site || !f.baseline) return null;
  const s = f.site;
  return (
    <div className="an-grid">
      <Section title="Data sources">
        <div className="kvs">
          <div className="kv"><span>Buildings, roads, land use</span><b>OpenStreetMap</b></div>
          <div className="kv"><span>Terrain</span><b>AWS Terrain Tiles (SRTM)</b></div>
          <div className="kv"><span>Buildings from OSM / synthetic</span><b>{num(s.stats.osmBuildings)} / {num(s.stats.syntheticBuildings)}</b></div>
          <div className="kv"><span>Relief across the area</span><b>{s.stats.relief} m</b></div>
        </div>
        <div className="prov-bar"><i style={{ flex: s.stats.osmBuildings }} /><i className="syn" style={{ flex: s.stats.syntheticBuildings }} /></div>
        <p className="fine">Synthetic, and labelled in the app: {s.provenance.synthetic.join('; ')}.</p>
      </Section>
      <Section title="Model parameters">
        <table className="ledger">
          <tbody>
            <tr><td>New drain capacity</td><td>{PARAMS.newDrainCap} m³/s</td></tr>
            <tr><td>Rain garden depth · media rate</td><td>{PARAMS.gardenDepth * 100} cm · {PARAMS.gardenRate} mm/h</td></tr>
            <tr><td>Recharge pit store · rate</td><td>{PARAMS.pitStore} m³ · {PARAMS.pitRate} L/s × soil</td></tr>
            <tr><td>Silt left after desilting</td><td>{Math.round(PARAMS.desiltTo * 100)} %</td></tr>
            <tr><td>Soil infiltration factor</td><td>×{s.soil.factor} ({s.soil.name})</td></tr>
            <tr><td>Waterlogged · road-cut depth</td><td>{DEPTH.wet * 100} cm · {DEPTH.road * 100} cm</td></tr>
          </tbody>
        </table>
      </Section>
      <Section title="Model check">
        <div className="kvs">
          <div className="kv"><span>Mass balance error</span><b>{num(Math.abs(f.baseline.budget.error), 3)} m³ of {m3(f.baseline.budget.rain)}</b></div>
          <div className="kv"><span>Run time</span><b>{Math.round(f.baseline.runtimeMs)} ms</b></div>
          <div className="kv"><span>Calculated</span><b>{f.baseline.source === 'server' ? 'HYDRA API (AWS)' : 'in this browser'}</b></div>
          <div className="kv"><span>Time step · frames</span><b>{f.baseline.nFrames} frames over {Math.round(f.baseline.frameTimes[f.baseline.nFrames - 1])} min</b></div>
        </div>
      </Section>
      <Section title="Limits">
        <p className="sub">A transparent screening model, not a hydraulic design tool. Water routing is quasi-steady, drains are a single gravity network, and outfalls are assumed to have capacity beyond the area. Unit costs are indicative. Use it to compare options and target budgets, then confirm with survey and detailed design.</p>
      </Section>
    </div>
  );
}

export function floodCsv(f: F): CsvTable[] {
  if (!f.baseline || !f.grid) return [];
  const b = f.baseline.metrics, a = f.run?.metrics, g = f.grid;
  const ms: [string, keyof Metrics][] = [['Homes with water inside', 'buildingsFlooded'], ['Residents affected', 'residentsAffected'], ['Roads cut (km)', 'roadKmAffected'], ['Waterlogged area (m2)', 'floodedArea'],
    ['Road disruption (km h)', 'roadKmHours'], ['Peak standing water (m3)', 'peakPonded'], ['Deepest water (m)', 'maxDepth'], ['Drain overflow (m3)', 'drainSurcharge'], ['Critical facilities affected', 'criticalAffected'], ['Flood impact index', 'impact']];
  const B = f.baseline, P = f.run;
  return [
    { title: `HYDRA flood analytics,${f.site?.name ?? ''} ${f.site?.city ?? ''},${f.storm.name},${f.storm.totalMm} mm`, rows: [] },
    { title: 'Metric,No action,Your plan', rows: ms.map(([l, k]) => [l, +(b[k] as number).toFixed(3), a ? +(a[k] as number).toFixed(3) : '']) },
    { title: 'Minute,Rain (mm/h),Standing water no action (m3),Standing water plan (m3),Homes flooded no action,Homes flooded plan', rows: Array.from(B.frameTimes, (t, i) => [t, +B.rainSeries[i].toFixed(1), Math.round(B.pondedSeries[i]), P ? Math.round(P.pondedSeries[i] ?? 0) : '', B.live?.homesFlooded[i] ?? '', P?.live?.homesFlooded[i] ?? '']) },
    { title: 'Hotspot (no action),Peak depth (m),Area (m2),Volume (m3),Homes flooded', rows: B.hotspots.map(h => [h.road, +h.maxDepth.toFixed(2), Math.round(h.area), Math.round(h.volume), h.buildingsFlooded]) },
    { title: 'Intervention,Type,Cost (INR),Placed by', rows: f.plan.map(iv => [describe(g, iv), CATALOG[iv.type].name, Math.round(costOf(g, iv)), iv.source ?? 'user']) },
  ];
}
