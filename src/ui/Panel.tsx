// Right-hand panel: results, plan, recommendations, the budget showdown, and assumptions.
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, planKey, recKey, MIN_FILL, type Panel as PanelId } from '../store';
import { fmtINR, type Grid } from '../sim/grid';
import { CATALOG, PARAMS, STORMS, costOf, planCost } from '../sim/flood/model';
import type { Intervention, InterventionType, Metrics, SimResult } from '../sim/flood/types';
import { placeName } from '../sim/flood/optimizer';
import { DEPTH } from '../sim/flood/engine';
import { CompareBars, LineSeries, ShareBars, type BarRow } from './charts';
import { Icon, SubTabs } from './Chrome';
import { cellX, cellZ, half } from '../three/geo';
import { useHeat } from '../heatStore';
import { HeatTab } from './heat/HeatPanel';
import { ShareReport } from './Share';
import { CalcSourceTag, ProgressBar } from './calc';

const num = (v: number, d = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const m3 = (v: number) => `${num(Math.round(v))} m³`;
const pct = (a: number, b: number) => (a > 0 ? Math.round((1 - b / a) * 100) : 0);

function flyToIntervention(g: Grid, iv: Intervention) {
  let x = 0, z = 0;
  if (iv.type === 'rwh') { const b = g.site.buildings[iv.building!]; x = b.poly.reduce((a, p) => a + p[0], 0) / b.poly.length - half(g); z = b.poly.reduce((a, p) => a + p[1], 0) / b.poly.length - half(g); }
  else { const cells = iv.type === 'desilt' ? g.unitCells.get(iv.unit!) ?? [] : iv.cells ?? []; const c = cells[Math.floor(cells.length / 2)] ?? 0; x = cellX(g, c); z = cellZ(g, c); }
  useStore.setState({ flyTo: { x, z, t: Date.now() } });
}
export function describe(g: Grid, iv: Intervention) {
  if (iv.type === 'rwh') { const b = g.site.buildings[iv.building!]; return `${b.name || b.use} roof near ${placeName(g, g.frontage[iv.building!][0] ?? 0)}`; }
  if (iv.type === 'desilt') { const cells = g.unitCells.get(iv.unit!) ?? []; return `${Math.round(cells.length * g.dx)} m along ${placeName(g, cells[0] ?? 0)}`; }
  if (iv.type === 'drain') return `${iv.cells!.length * g.dx} m from ${placeName(g, iv.cells![0])}`;
  return `on ${placeName(g, iv.cells![0])}`;
}

function Kpi({ label, base, after, fmt, hint }: { label: string; base: number; after: number | null; fmt: (v: number) => string; hint?: string }) {
  const d = after == null ? 0 : pct(base, after);
  return (
    <div className="kpi" title={hint}>
      <span className="kpi-label">{label}</span>
      <b>{fmt(after ?? base)}</b>
      {after != null ? <span className={`delta ${d > 0 ? 'good' : d < 0 ? 'bad' : ''}`}>{d > 0 ? '▼' : d < 0 ? '▲' : '='} {Math.abs(d)}% vs {fmt(base)}</span> : <span className="delta">no action</span>}
    </div>
  );
}

/** Conditions at the playback time, read from the same run the map is drawing; the plan run is compared with no action at the same moment. */
function LiveNow({ shown, base }: { shown: SimResult; base: SimResult | null }) {
  const s = useStore(useShallow(st => ({ time: st.time, peak: st.peak, playing: st.playing, stormId: st.stormId })));
  const L = shown.live;
  if (!L) return null;
  if (s.peak) return <div className="callout soft">Showing the <b>peak flood</b> (deepest water each place reached). Press play or drag the timeline to watch the storm unfold, minute by minute.</div>;
  const step = shown.nFrames > 1 ? shown.frameTimes[1] - shown.frameTimes[0] : 1, k = Math.min(shown.nFrames - 1, Math.round(s.time / step));
  const kb = base ? Math.min(base.nFrames - 1, k) : -1, B = base?.live;
  const storm = STORMS.find(x => x.id === s.stormId)!, rainNow = shown.rainSeries[k];
  const row = (label: string, v: number, b: number | undefined, fmt: (v: number) => string) => (
    <div className="kv"><span>{label}</span><b>{fmt(v)}{b != null && Math.abs(b - v) > 1e-6 && <em className={v < b ? 'good' : 'bad'}> (no action: {fmt(b)})</em>}</b></div>
  );
  const hh = Math.floor(s.time / 60), mm = Math.floor(s.time % 60);
  return (
    <div className="live">
      <h4>Right now <small>T+{hh}:{String(mm).padStart(2, '0')} · {rainNow > 0 ? `raining ${Math.round(rainNow)} mm/h` : s.time > 0 ? 'rain stopped, draining' : 'before the rain'}{s.playing ? ' · live' : ''}</small></h4>
      {row('Rain fallen so far', L.rainMm[k], undefined, v => `${num(v, 1)} of ${storm.totalMm} mm`)}
      {row('Homes with water inside', L.homesFlooded[k], B && B.homesFlooded[kb], v => num(v))}
      {row('Residents affected', L.residents[k], B && B.residents[kb], v => num(v))}
      {row('Roads cut (> 15 cm)', L.roadKmCut[k], B && B.roadKmCut[kb], v => `${num(v, 2)} km`)}
      {row('Waterlogged area (> 10 cm)', L.wetArea[k] / 1e4, B && B.wetArea[kb] / 1e4, v => `${num(v, 2)} ha`)}
      {row('Standing water', shown.pondedSeries[k], base ? base.pondedSeries[kb] : undefined, m3)}
      {row('Drains overflowing', L.drainOverflowM[k], B && B.drainOverflowM[kb], v => `${num(v)} m`)}
    </div>
  );
}

const RESULT_TABS = [{ id: 'overview', label: 'Overview' }, { id: 'water', label: 'Water balance' }, { id: 'hotspots', label: 'Hotspots' }] as const;
type ResultSub = (typeof RESULT_TABS)[number]['id'];

function Results() {
  const s = useStore(useShallow(st => ({ grid: st.grid, baseline: st.baseline, current: st.current, currentKey: st.currentKey, plan: st.plan, view: st.view, stormId: st.stormId, runPlan: st.runPlan, running: st.running })));
  const [sub, setSub] = useState<ResultSub>('overview');
  if (!s.grid || !s.baseline) return null;
  const b = s.baseline.metrics, planRes: SimResult | null = s.current && s.currentKey ? s.current : null, a = planRes?.metrics ?? null;
  const shown = (s.view === 'plan' && planRes) || s.baseline, bud = shown.budget, storm = STORMS.find(x => x.id === s.stormId)!;
  const stale = s.plan.length > 0 && planKey(s.plan) !== s.currentKey;
  return (
    <div className="tab">
      <p className="sub">{storm.name}: {storm.note}</p>
      <CalcSourceTag source={shown.source} />
      {s.running ? <div className="callout soft">Recalculating {stale ? 'with your latest plan' : `for ${storm.name.toLowerCase()}`}…</div>
        : stale && <div className="callout">Your plan changed. <button className="link" onClick={() => s.runPlan(true)}>Run the same storm again</button> to update these numbers.</div>}
      {!a && !s.plan.length && <div className="callout soft">These are the results with <b>no action</b>. Place interventions, or press <b>Recommend</b>, then run the same storm to compare.</div>}
      <LiveNow shown={shown} base={shown !== s.baseline ? s.baseline : null} />
      <SubTabs tabs={RESULT_TABS} active={sub} onChange={setSub} />
      {sub === 'overview' && (
        <>
          <h4>Whole storm <small>(worst moment at each place, {storm.totalMm} mm in {storm.durationMin / 60} h)</small></h4>
          <div className="kpis">
            <Kpi label="Homes with water inside" base={b.buildingsFlooded} after={a?.buildingsFlooded ?? null} fmt={v => num(v)} hint="Water at the doorstep rose above the plinth" />
            <Kpi label="Residents affected (est.)" base={b.residentsAffected} after={a?.residentsAffected ?? null} fmt={v => num(v)} />
            <Kpi label="Roads cut (> 15 cm)" base={b.roadKmAffected} after={a?.roadKmAffected ?? null} fmt={v => `${num(v, 2)} km`} hint="Depth at which two-wheelers stall" />
            <Kpi label="Waterlogged area" base={b.floodedArea / 1e4} after={a ? a.floodedArea / 1e4 : null} fmt={v => `${num(v, 2)} ha`} hint="Street depth above 10 cm" />
            <Kpi label="Road disruption" base={b.roadKmHours} after={a?.roadKmHours ?? null} fmt={v => `${num(v, 1)} km·h`} hint="Kilometres of road × hours above 15 cm" />
            <Kpi label="Flood impact index" base={100} after={a ? (a.impact / Math.max(1e-9, b.impact)) * 100 : null} fmt={v => num(v)} hint="Harm-weighted standing water (roads by class, homes by residents, schools and hospitals ×), no action = 100" />
          </div>
        </>
      )}
      {sub === 'water' && (
        <>
          <h4>Standing water over time</h4>
          <LineSeries unit="m³" fmt={v => (v >= 1000 ? `${num(v / 1000, 1)}k` : num(v))} series={[
            { key: 'none', xs: s.baseline.frameTimes, ys: s.baseline.pondedSeries },
            ...(planRes ? [{ key: 'plan' as const, xs: planRes.frameTimes, ys: planRes.pondedSeries }] : []),
          ]} />
          <h4>Where the rain went <small>({s.view === 'plan' && planRes ? 'your plan' : 'no action'}, {m3(bud.rain)} fell)</small></h4>
          <ShareBars total={bud.rain} fmt={m3} rows={[
            { label: 'Soaked into the ground', value: bud.infiltrated },
            { label: 'Stored by rooftop harvesting', value: bud.harvested },
            { label: 'Absorbed by rain gardens and pits', value: bud.gardens + bud.pits },
            { label: 'Carried away by drains', value: bud.drains + bud.drainStore },
            { label: 'Ran off the area over the surface', value: bud.edge + bud.channel },
            { label: 'Still standing at the end', value: Math.max(0, bud.standingEnd) },
          ]} />
          <p className="fine">Model check: water balance closes to {num(Math.abs(bud.error), 2)} m³ of {m3(bud.rain)}; this run took {Math.round(shown.runtimeMs)} ms.</p>
        </>
      )}
      {sub === 'hotspots' && (
        <>
          <h4>Waterlogging hotspots <small>(click to fly there)</small></h4>
          <ol className="hotspots">
            {shown.hotspots.slice(0, 6).map((h, k) => (
              <li key={k}><button onClick={() => useStore.setState({ flyTo: { x: h.x - half(s.grid!), z: h.z - half(s.grid!), t: Date.now() } })}>
                <b>{h.road}</b><span>{Math.round(h.maxDepth * 100)} cm deep · {num(h.area)} m²{h.buildingsFlooded ? ` · ${h.buildingsFlooded} ${h.buildingsFlooded === 1 ? 'home takes' : 'homes take'} water` : ''}</span>
              </button></li>
            ))}
            {!shown.hotspots.length && <li className="muted">No street is under more than 15 cm.</li>}
          </ol>
        </>
      )}
    </div>
  );
}

function PlanTab() {
  const s = useStore(useShallow(st => ({ grid: st.grid, plan: st.plan, budget: st.budget, remove: st.remove, clearPlan: st.clearPlan, runPlan: st.runPlan, running: st.running })));
  const g = s.grid;
  if (!g) return null;
  const types = Object.keys(CATALOG) as InterventionType[], spent = planCost(g, s.plan);
  return (
    <div className="tab">
      <div className="budgetline"><b>{fmtINR(spent)}</b> of {fmtINR(s.budget)} committed · {fmtINR(Math.max(0, s.budget - spent))} left</div>
      {!s.plan.length && <div className="callout soft">No interventions yet. Pick a tool on the left (keys 1–5) and place it on the map, or press <b>Recommend</b>.</div>}
      {types.map(t => {
        const items = s.plan.filter(p => p.type === t);
        if (!items.length) return null;
        return (
          <section key={t} className="group" style={{ ['--tc' as string]: CATALOG[t].color }}>
            <h4><i />{CATALOG[t].name} <small>{items.length} · {fmtINR(planCost(g, items))}</small></h4>
            {items.map(iv => (
              <div key={iv.id} className="item">
                <div className="item-main">
                  <span>{describe(g, iv)}</span>
                  <span className={`src ${iv.source}`}>{iv.source === 'hydra' ? 'HYDRA' : iv.source === 'spread' ? 'even spread' : 'you'}</span>
                  <b>{fmtINR(costOf(g, iv))}</b>
                </div>
                {iv.reason && <p className="why">{iv.reason}</p>}
                <div className="item-actions">
                  <button className="link" onClick={() => flyToIntervention(g, iv)}><Icon name="target" size={13} /> show</button>
                  <button className="link danger" onClick={() => s.remove(iv.id)}><Icon name="close" size={12} /> remove</button>
                </div>
              </div>
            ))}
          </section>
        );
      })}
      {s.plan.length > 0 && <div className="row-actions"><button className="btn primary" onClick={() => s.runPlan(true)} disabled={s.running}>Run storm with this plan</button><button className="btn ghost" onClick={s.clearPlan}>Clear</button></div>}
      {s.plan.length > 0 && <ShareReport />}
    </div>
  );
}

function Progress() {
  return <ProgressBar busy={useStore(s => s.busy)} />;
}

function mix(plan: Intervention[]) {
  const m = new Map<InterventionType, number>();
  plan.forEach(p => m.set(p.type, (m.get(p.type) ?? 0) + 1));
  return [...m.entries()];
}

function RecommendTab() {
  const s = useStore(useShallow(st => ({ grid: st.grid, baseline: st.baseline, current: st.current, currentKey: st.currentKey, budget: st.budget, plan: st.plan, rec: st.recommendation, busy: st.busy, recommend: st.recommend, setPlan: st.setPlan,
    siteId: st.siteId, stormId: st.stormId, antecedent: st.antecedent })));
  const g = s.grid;
  if (!g || !s.baseline) return null;
  const b = s.baseline.metrics, r = s.rec, spent = planCost(g, s.plan), left = s.budget - spent, hasPlan = s.plan.length > 0;
  const canFill = left >= MIN_FILL;
  // out of date when the storm, soil, budget, or (for a plan built on yours) your plan changed since it was made
  const applied = !!r && planKey(r.plan) === planKey(s.plan);
  const stale = !!r && !applied && r.forKey !== recKey(s, r.mode);
  // your plan's numbers, when the storm has been run with it as it is now
  const mine = hasPlan && s.current && s.currentKey === planKey(s.plan) ? s.current.metrics : null;
  const added = r ? r.plan.length - r.basePlan.length : 0, newItems = r ? r.plan.slice(r.basePlan.length) : [];
  return (
    <div className="tab">
      <p className="sub">HYDRA simulates the storm, finds the low spots and overloaded drains that do the most harm (weighted by residents, road importance, schools and hospitals), traces where every drop of runoff ends up, and spends the budget where it removes the most harmful water per rupee. It then re-simulates and refines.</p>
      <div className="budgetline">{hasPlan ? <>Your plan: <b>{s.plan.length}</b> interventions, {fmtINR(spent)} of {fmtINR(s.budget)} · {fmtINR(Math.max(0, left))} left</> : <>No plan yet · budget {fmtINR(s.budget)}</>}</div>
      <div className="row-actions">
        {hasPlan
          ? <button className="btn primary" disabled={!!s.busy || !canFill} onClick={() => s.recommend('fill')} title={canFill ? 'Keeps everything in your plan and spends what is left' : 'Your plan already uses the budget: raise it in the top bar, or start over'}>Improve my plan ({fmtINR(Math.max(0, left))} left)</button>
          : <button className="btn primary" disabled={!!s.busy} onClick={() => s.recommend('fresh')}>Plan {fmtINR(s.budget)} from scratch</button>}
        {hasPlan && <button className="btn" disabled={!!s.busy} onClick={() => s.recommend('fresh')} title="Ignores your plan and plans the whole budget">Start over with {fmtINR(s.budget)}</button>}
      </div>
      <Progress />
      {r && !s.busy && (
        <>
          {stale && <div className="callout">Your plan, budget or storm changed since this recommendation. <button className="link" onClick={() => s.recommend(r.mode === 'fill' && hasPlan ? 'fill' : hasPlan ? 'auto' : 'fresh')}>Recommend again</button> for the current setup.</div>}
          <h4>Predicted result <small>({r.mode === 'fill' ? `your ${r.basePlan.length} + ${added} new` : `${r.plan.length} interventions`}, {fmtINR(r.cost)} spent)</small></h4>
          <CalcSourceTag source={r.source} />
          {added === 0 && r.mode === 'fill'
            ? <div className="callout soft">HYDRA found nothing more worth buying with what is left: no remaining spot removes enough harmful water per rupee.</div>
            : <CompareBars keys={mine && r.mode === 'fill' ? ['none', 'plan', 'hydra'] : ['none', 'hydra']} rows={rows(b, r.metrics, undefined, mine && r.mode === 'fill' ? mine : undefined)} />}
          <div className="chips">{mix(newItems).map(([t, n]) => <span key={t} style={{ ['--tc' as string]: CATALOG[t].color }}><i />{n} × {CATALOG[t].short}</span>)}</div>
          <div className="row-actions">
            <button className="btn primary" disabled={applied || stale} onClick={() => { s.setPlan(r.plan); useStore.setState({ panel: 'results' }); }}>
              {applied ? 'Applied: see Results' : r.mode === 'fill' ? 'Add these to my plan and run the storm' : hasPlan ? 'Replace my plan and run the storm' : 'Apply and run the storm'}
            </button>
          </div>
          <h4>Why these places</h4>
          <ol className="reasons">{newItems.filter(p => p.reason).slice(0, 14).map(p => <li key={p.id} style={{ ['--tc' as string]: CATALOG[p.type].color }}><b>{CATALOG[p.type].short}</b> {p.reason} <em>{fmtINR(costOf(g, p))}</em></li>)}</ol>
          {newItems.length > 14 && <p className="fine">…and {newItems.length - 14} more in the Plan tab once applied.</p>}
        </>
      )}
    </div>
  );
}

function rows(b: Metrics, x: Metrics, spread?: Metrics[], mine?: Metrics): BarRow[] {
  const avg = (k: keyof Metrics) => (spread ? spread.reduce((a, m) => a + (m[k] as number), 0) / spread.length : undefined);
  const rng = (k: keyof Metrics, f = 1): [number, number] | undefined => (spread ? [Math.min(...spread.map(m => (m[k] as number) * f)), Math.max(...spread.map(m => (m[k] as number) * f))] : undefined);
  const r = (label: string, k: keyof Metrics, fmt: (v: number) => string, f = 1, hint?: string): BarRow => ({
    label, hint, fmt,
    values: { none: (b[k] as number) * f, hydra: (x[k] as number) * f, ...(spread ? { spread: avg(k)! * f } : {}), ...(mine ? { plan: (mine[k] as number) * f } : {}) },
    range: spread ? { spread: rng(k, f)! } : undefined,
  });
  return [
    r('Homes with water inside', 'buildingsFlooded', v => num(v, v % 1 ? 1 : 0)),
    r('Residents affected', 'residentsAffected', v => num(Math.round(v))),
    r('Roads cut', 'roadKmAffected', v => `${num(v, 2)} km`, 1, 'deeper than 15 cm'),
    r('Waterlogged area', 'floodedArea', v => `${num(v, 2)} ha`, 1e-4),
    r('Flood impact', 'impact', v => num(v), 100 / Math.max(1e-9, b.impact), 'no action = 100'),
  ];
}

function ShowdownTab() {
  const s = useStore(useShallow(st => ({ grid: st.grid, budget: st.budget, sd: st.showdown, busy: st.busy, run: st.runShowdown, setPlan: st.setPlan })));
  const g = s.grid;
  if (!g) return null;
  const sd = s.sd;
  let headline = null;
  if (sd) {
    const avg = (k: keyof Metrics) => sd.spreads.reduce((a, x) => a + (x.metrics[k] as number), 0) / sd.spreads.length;
    const savedH = sd.base.buildingsFlooded - sd.hydra.metrics.buildingsFlooded, savedS = sd.base.buildingsFlooded - avg('buildingsFlooded');
    const cutH = pct(sd.base.impact, sd.hydra.metrics.impact), cutS = pct(sd.base.impact, avg('impact'));
    headline = (
      <div className="headline">
        <div><b>{num(Math.max(0, savedH))}</b><span>homes kept dry by HYDRA's plan</span></div>
        <div><b>{num(Math.max(0, savedS), 1)}</b><span>by an even spread of the same {fmtINR(sd.budget)}</span></div>
        <p>Flood impact falls <b>{cutH}%</b> with HYDRA against <b>{cutS}%</b> for the even spread{cutS > 0 ? `, ${num(cutH / cutS, 1)}× the effect for the same money` : ''}. Same storm, same budget, same neighbourhood. Only the placement differs.</p>
      </div>
    );
  }
  return (
    <div className="tab">
      <p className="sub">Same storm, same {fmtINR(s.budget)}, three strategies: do nothing; spend it <b>evenly</b> across drains, rain gardens, roof harvesting and pits at random spots (the average of 3 such plans, with their range); or let <b>HYDRA</b> place it using terrain, drainage connectivity and flood risk.</p>
      <button className="btn accent" disabled={!!s.busy} onClick={s.run}>{sd ? 'Run again' : 'Run the showdown'}</button>
      <Progress />
      {sd && !s.busy && (
        <>
          {headline}
          <CalcSourceTag source={sd.source} />
          <CompareBars keys={['none', 'spread', 'hydra']} rows={rows(sd.base, sd.hydra.metrics, sd.spreads.map(x => x.metrics))} />
          <p className="fine">Spent: even spread {fmtINR(sd.spreads.reduce((a, x) => a + x.cost, 0) / sd.spreads.length)} on average, HYDRA {fmtINR(sd.hydra.cost)}. HYDRA's mix: {mix(sd.hydra.plan).map(([t, n]) => `${n} ${CATALOG[t].short.toLowerCase()}`).join(', ')}.</p>
          <div className="row-actions">
            <button className="btn primary" onClick={() => { s.setPlan(sd.hydra.plan); useStore.setState({ panel: 'results' }); }}>Show HYDRA's plan on the map</button>
            <button className="btn ghost" onClick={() => { s.setPlan(sd.spreads[0].plan); useStore.setState({ panel: 'results' }); }}>Show an even-spread plan</button>
          </div>
        </>
      )}
    </div>
  );
}

function AboutTab() {
  const site = useStore(s => s.site);
  if (!site) return null;
  return (
    <div className="tab about">
      <h4>{site.name}, {site.city}, {site.state}</h4>
      <p>{site.blurb} Soil: {site.soil.name} (infiltration factor ×{site.soil.factor}). Relief {site.stats.relief} m across 600 m × 600 m, on a 5 m grid.</p>
      <h4>How the simulation works</h4>
      <ol>
        <li><b>Rain</b> falls as a design storm in 5-minute blocks (IMD categories: heavy 64.5–115.5 mm/day, very heavy 115.6–204.4, extremely heavy ≥ 204.5; cloudburst ≥ 100 mm/h).</li>
        <li><b>Roofs</b> drain through downpipes onto the street, unless a rooftop harvesting tank (40 mm of roof rain) catches it first.</li>
        <li><b>Runoff</b> flows downhill along the steepest path, soaking into permeable ground on the way (open ground 10, green 25, paving 1.5 mm/h × soil factor, until the soil is saturated).</li>
        <li><b>Open roadside drains</b> take in up to 0.12 m³/s per 5 m and carry it to outfalls, routed by gravity. Existing drains run at 50 % capacity (silt and solid waste). When full they overflow back onto the street.</li>
        <li><b>Low spots</b> fill like small reservoirs and spill to the next one when full. Moving water on streets gets a Manning normal depth.</li>
        <li><b>Harm</b> is water above 10 cm, weighted by road class, residents at the doorstep (4.4 per household), and ×25 for schools and hospitals. Homes count as flooded when water at the door rises above their plinth.</li>
      </ol>
      <h4>Interventions and indicative costs</h4>
      <ul>
        {(Object.keys(CATALOG) as InterventionType[]).map(t => <li key={t}><b>{CATALOG[t].name}</b>: {CATALOG[t].unit}. {CATALOG[t].blurb}</li>)}
      </ul>
      <p className="fine">Parameters: new drain {PARAMS.newDrainCap} m³/s; rain garden {PARAMS.gardenDepth * 100} cm deep, {PARAMS.gardenRate} mm/h media; recharge pit {PARAMS.pitStore} m³ + {PARAMS.pitRate} L/s × soil; desilting to {Math.round(PARAMS.desiltTo * 100)} % silt. Unit costs are indicative 2024 Indian rates: use the local CPWD / PWD schedule of rates for real budgets. Street depth thresholds: waterlogged {DEPTH.wet * 100} cm, roads cut {DEPTH.road * 100} cm.</p>
      <h4>Data</h4>
      <ul>
        <li><b>Buildings, roads, land use:</b> {site.provenance.osm}. {site.stats.osmBuildings} buildings from OSM, {site.stats.syntheticBuildings} synthetic.</li>
        <li><b>Terrain:</b> {site.provenance.terrain}. Depressions deeper than 40 cm are treated as elevation-data artefacts and partly filled (buildings count as walls).</li>
        <li><b>Synthetic, and labelled as such:</b> {site.provenance.synthetic.join('; ')}.</li>
      </ul>
      <h4>Limits</h4>
      <p>This is a transparent screening model, not a hydraulic design tool. Water routing is quasi-steady (no travel time within a minute), drains are a single gravity network, and outfalls are assumed to have capacity beyond the area. Use it to compare options and target budgets, then confirm with detailed survey and design.</p>
    </div>
  );
}

const TABS: { id: PanelId; label: string }[] = [{ id: 'results', label: 'Results' }, { id: 'plan', label: 'Plan' }, { id: 'recommend', label: 'Recommend' }, { id: 'showdown', label: 'Showdown' }, { id: 'about', label: 'About' }];

// The tabs are shared by both modes; the content comes from the active mode.
export function SidePanel() {
  const panel = useStore(s => s.panel), mode = useStore(s => s.mode), nFlood = useStore(s => s.plan.length), nHeat = useHeat(s => s.plan.length);
  const n = mode === 'flood' ? nFlood : nHeat;
  return (
    <aside className="panel">
      <nav className="tabs">{TABS.map(t => <button key={t.id} className={panel === t.id ? 'on' : ''} onClick={() => useStore.setState({ panel: t.id })}>{t.label}{t.id === 'plan' && n ? <span className="count">{n}</span> : null}</button>)}</nav>
      <div className="panel-body">
        {mode === 'heat' ? <HeatTab panel={panel} /> : (
          <>
            {panel === 'results' && <Results />}
            {panel === 'plan' && <PlanTab />}
            {panel === 'recommend' && <RecommendTab />}
            {panel === 'showdown' && <ShowdownTab />}
            {panel === 'about' && <AboutTab />}
          </>
        )}
      </div>
    </aside>
  );
}
