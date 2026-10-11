// Right-hand panel, flood mode: Overview, Analytics, Plan & cost, Optimize (Recommend + Showdown), and About.
import { useShallow } from 'zustand/react/shallow';
import { useStore, planKey, recKey, MIN_FILL, type Panel as PanelId } from '../store';
import { fmtINR, type Grid } from '../sim/grid';
import { CATALOG, PARAMS, STORMS, costOf, planCost } from '../sim/flood/model';
import type { Intervention, InterventionType, Metrics, SimResult } from '../sim/flood/types';
import { placeName } from '../sim/flood/optimizer';
import { DEPTH } from '../sim/flood/engine';
import { CompareBars, LineSeries, ShareBars, type BarRow } from './charts';
import { Icon } from './Chrome';
import { cellX, cellZ, half } from '../three/geo';
import { heatPlanKey, useHeat } from '../heatStore';
import { HEAT_SCENARIOS, HEAT_WINDOWS } from '../sim/heat/model';
import { HeatTab } from './heat/HeatPanel';
import { ShareReport } from './Share';
import { CalcSourceTag, ProgressBar } from './calc';
import { BudgetBreakdown, Empty, Metric, Optimize, Section, ValueRows, Verdict, num } from './kit';

const m3 = (v: number) => `${num(Math.round(v))} m³`;
const pct = (a: number, b: number) => (a > 0 ? Math.round((1 - b / a) * 100) : 0);
const peakOf = (ys: ArrayLike<number>) => { let m = 0; for (let i = 0; i < ys.length; i++) m = Math.max(m, ys[i]); return m; };

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

/** A lower-is-better flood metric against no action. */
function Kpi({ label, base, after, fmt, hint }: { label: string; base: number; after: number | null; fmt: (v: number) => string; hint?: string }) {
  const d = after == null ? 0 : pct(base, after);
  return <Metric label={label} value={fmt(after ?? base)} hint={hint} base={fmt(base)} change={after == null ? undefined : `${Math.abs(d)}%`} tone={d > 0 ? 'good' : d < 0 ? 'bad' : 'flat'} />;
}

/** The plan run that matches the plan as it is now, if there is one. */
function useFloodRuns() {
  return useStore(useShallow(st => ({ grid: st.grid, baseline: st.baseline, current: st.current, currentKey: st.currentKey, plan: st.plan, view: st.view, stormId: st.stormId, budget: st.budget, running: st.running, runPlan: st.runPlan })));
}

/** Conditions at the playback time, read from the same run the map is drawing; the plan run is compared with no action at the same moment. */
function LiveNow({ shown, base }: { shown: SimResult; base: SimResult | null }) {
  const s = useStore(useShallow(st => ({ time: st.time, peak: st.peak, playing: st.playing, stormId: st.stormId })));
  const L = shown.live;
  if (!L) return null;
  if (s.peak) return <p className="fine">Showing the <b>peak flood</b>, the deepest water each place reached. Press play or drag the timeline to follow the storm minute by minute.</p>;
  const step = shown.nFrames > 1 ? shown.frameTimes[1] - shown.frameTimes[0] : 1, k = Math.min(shown.nFrames - 1, Math.round(s.time / step));
  const kb = base ? Math.min(base.nFrames - 1, k) : -1, B = base?.live;
  const storm = STORMS.find(x => x.id === s.stormId)!, rainNow = shown.rainSeries[k];
  const row = (label: string, v: number, b: number | undefined, fmt: (v: number) => string) => (
    <div className="kv"><span>{label}</span><b>{fmt(v)}{b != null && Math.abs(b - v) > 1e-6 && <em className={v < b ? 'good' : 'bad'}> (no action: {fmt(b)})</em>}</b></div>
  );
  const hh = Math.floor(s.time / 60), mm = Math.floor(s.time % 60);
  return (
    <Section title="Right now" hint={`T+${hh}:${String(mm).padStart(2, '0')} · ${rainNow > 0 ? `raining ${Math.round(rainNow)} mm/h` : s.time > 0 ? 'rain stopped, draining' : 'before the rain'}`} aside={s.playing ? <span className="live-dot">Live</span> : null}>
      <div className="kvs">
        {row('Rain fallen so far', L.rainMm[k], undefined, v => `${num(v, 1)} of ${storm.totalMm} mm`)}
        {row('Homes with water inside', L.homesFlooded[k], B && B.homesFlooded[kb], v => num(v))}
        {row('Residents affected', L.residents[k], B && B.residents[kb], v => num(v))}
        {row('Roads cut (> 15 cm)', L.roadKmCut[k], B && B.roadKmCut[kb], v => `${num(v, 2)} km`)}
        {row('Waterlogged area (> 10 cm)', L.wetArea[k] / 1e4, B && B.wetArea[kb] / 1e4, v => `${num(v, 2)} ha`)}
        {row('Standing water', shown.pondedSeries[k], base ? base.pondedSeries[kb] : undefined, m3)}
        {row('Drains overflowing', L.drainOverflowM[k], B && B.drainOverflowM[kb], v => `${num(v)} m`)}
      </div>
    </Section>
  );
}

function Status() {
  const s = useFloodRuns();
  const stale = s.plan.length > 0 && planKey(s.plan) !== s.currentKey;
  if (s.running) return <div className="callout soft"><span className="spinner" />Recalculating {stale ? 'with your latest plan' : 'for the new conditions'}…</div>;
  if (stale) return <div className="callout">Your plan changed since the last run. <button className="link" onClick={() => s.runPlan(true)}>Run the storm again</button></div>;
  return null;
}

function Overview() {
  const s = useFloodRuns();
  if (!s.grid || !s.baseline) return null;
  const b = s.baseline.metrics, planRes: SimResult | null = s.current && s.currentKey ? s.current : null, a = planRes?.metrics ?? null;
  const shown = (s.view === 'plan' && planRes) || s.baseline, storm = STORMS.find(x => x.id === s.stormId)!;
  const spent = planCost(s.grid, s.plan), dry = a ? b.buildingsFlooded - a.buildingsFlooded : 0, cut = a ? pct(b.impact, a.impact) : 0;
  return (
    <div className="tab">
      <Status />
      {a ? (
        <Verdict tone={cut > 0 ? 'good' : 'warn'} kicker="Your plan">
          {cut > 0
            ? <>Keeps <b>{num(Math.max(0, dry))} {Math.abs(dry) === 1 ? 'home' : 'homes'}</b> dry and cuts flood impact by <b>{cut}%</b> for <b>{fmtINR(spent)}</b>.</>
            : <>Spends <b>{fmtINR(spent)}</b> but does not reduce flood impact yet. Check that drains connect to an outfall, or press <b>Recommend</b>.</>}
        </Verdict>
      ) : (
        <Verdict tone="neutral" kicker="No action" actions={!s.plan.length && <button className="btn primary sm" onClick={() => useStore.getState().recommend()}>Recommend a plan for {fmtINR(s.budget)}</button>}>
          In this storm <b>{num(b.buildingsFlooded)} homes</b> take water and <b>{num(b.roadKmAffected, 2)} km</b> of road is cut. Place interventions with the tools on the left, or let HYDRA plan the budget.
        </Verdict>
      )}
      <Section title="Impact" hint={`whole storm · ${storm.totalMm} mm in ${storm.durationMin / 60} h · change vs no action`} aside={<CalcSourceTag source={shown.source} />}>
        <div className="metrics">
          <Kpi label="Homes with water inside" base={b.buildingsFlooded} after={a?.buildingsFlooded ?? null} fmt={v => num(v)} hint="Water at the doorstep rose above the plinth" />
          <Kpi label="Residents affected (est.)" base={b.residentsAffected} after={a?.residentsAffected ?? null} fmt={v => num(v)} />
          <Kpi label="Roads cut (> 15 cm)" base={b.roadKmAffected} after={a?.roadKmAffected ?? null} fmt={v => `${num(v, 2)} km`} hint="Depth at which two-wheelers stall" />
          <Kpi label="Waterlogged area" base={b.floodedArea / 1e4} after={a ? a.floodedArea / 1e4 : null} fmt={v => `${num(v, 2)} ha`} hint="Street depth above 10 cm" />
          <Kpi label="Road disruption" base={b.roadKmHours} after={a?.roadKmHours ?? null} fmt={v => `${num(v, 1)} km·h`} hint="Kilometres of road × hours above 15 cm" />
          <Kpi label="Flood impact index" base={100} after={a ? (a.impact / Math.max(1e-9, b.impact)) * 100 : null} fmt={v => num(v)} hint="Harm-weighted standing water (roads by class, homes by residents, schools and hospitals ×), no action = 100" />
        </div>
      </Section>
      <LiveNow shown={shown} base={shown !== s.baseline ? s.baseline : null} />
    </div>
  );
}

function Analytics() {
  const s = useFloodRuns();
  if (!s.grid || !s.baseline) return null;
  const planRes: SimResult | null = s.current && s.currentKey ? s.current : null;
  const shown = (s.view === 'plan' && planRes) || s.baseline, bud = shown.budget, which = shown === s.baseline ? 'no action' : 'your plan';
  return (
    <div className="tab">
      <Status />
      <Section title="Standing water over time" hint="volume on streets and open ground">
        <LineSeries unit="m³" fmt={v => (v >= 1000 ? `${num(v / 1000, 1)}k` : num(v))} series={[
          { key: 'none', xs: s.baseline.frameTimes, ys: s.baseline.pondedSeries },
          ...(planRes ? [{ key: 'plan' as const, xs: planRes.frameTimes, ys: planRes.pondedSeries }] : []),
        ]} />
      </Section>
      <Section title="Where the rain went" hint={`${which} · ${m3(bud.rain)} fell`}>
        <ShareBars total={bud.rain} fmt={m3} rows={[
          { label: 'Soaked into the ground', value: bud.infiltrated },
          { label: 'Stored by rooftop harvesting', value: bud.harvested },
          { label: 'Absorbed by rain gardens and pits', value: bud.gardens + bud.pits },
          { label: 'Carried away by drains', value: bud.drains + bud.drainStore },
          { label: 'Ran off the area over the surface', value: bud.edge + bud.channel },
          { label: 'Still standing at the end', value: Math.max(0, bud.standingEnd) },
        ]} />
        <p className="fine">Water balance closes to {num(Math.abs(bud.error), 2)} m³ of {m3(bud.rain)}. This run took {Math.round(shown.runtimeMs)} ms.</p>
      </Section>
      <Section title="Waterlogging hotspots" hint={`${which} · click to fly there`}>
        <ol className="hotspots">
          {shown.hotspots.slice(0, 8).map((h, k) => (
            <li key={k}><button onClick={() => useStore.setState({ flyTo: { x: h.x - half(s.grid!), z: h.z - half(s.grid!), t: Date.now() } })}>
              <b>{h.road}</b><span>{Math.round(h.maxDepth * 100)} cm deep · {num(h.area)} m²{h.buildingsFlooded ? ` · ${h.buildingsFlooded} ${h.buildingsFlooded === 1 ? 'home takes' : 'homes take'} water` : ''}</span>
            </button></li>
          ))}
          {!shown.hotspots.length && <li className="muted">No street is under more than 15 cm.</li>}
        </ol>
      </Section>
    </div>
  );
}

function PlanCost() {
  const s = useStore(useShallow(st => ({ grid: st.grid, baseline: st.baseline, current: st.current, currentKey: st.currentKey, plan: st.plan, budget: st.budget, remove: st.remove, clearPlan: st.clearPlan, runPlan: st.runPlan, running: st.running })));
  const g = s.grid;
  if (!g || !s.baseline) return null;
  const types = Object.keys(CATALOG) as InterventionType[], spent = planCost(g, s.plan);
  const parts = types.map(t => { const items = s.plan.filter(p => p.type === t); return { label: CATALOG[t].name, color: CATALOG[t].color, count: items.length, cost: planCost(g, items) }; });
  const run = s.plan.length && s.current && s.currentKey === planKey(s.plan) ? s.current : null;
  const b = s.baseline.metrics, a = run?.metrics;
  return (
    <div className="tab">
      <Section title="Budget"><BudgetBreakdown spent={spent} budget={s.budget} parts={parts} note="Indicative 2024 Indian unit rates. Use the local CPWD / PWD schedule of rates for a real estimate." /></Section>
      {s.plan.length > 0 && (
        <Section title="Value for money" hint={a ? 'from the latest run of this plan' : 'run the storm with this plan to see it'}>
          {a ? <ValueRows rows={[
            { label: 'Per home kept dry', cost: spent, benefit: b.buildingsFlooded - a.buildingsFlooded, unit: 'home' },
            { label: 'Per resident protected', cost: spent, benefit: b.residentsAffected - a.residentsAffected, unit: 'resident' },
            { label: 'Per 1% less flood impact', cost: spent, benefit: (1 - a.impact / Math.max(1e-9, b.impact)) * 100, unit: '1%' },
            { label: 'Per m³ less peak standing water', cost: spent, benefit: peakOf(s.baseline.pondedSeries) - peakOf(run!.pondedSeries), unit: 'm³' },
          ]} /> : <button className="btn sm" disabled={s.running} onClick={() => s.runPlan(true)}>{s.running ? 'Running…' : 'Run the storm with this plan'}</button>}
        </Section>
      )}
      <Section title="Interventions" hint={s.plan.length ? `${s.plan.length} placed` : undefined} aside={s.plan.length > 0 && <button className="link danger" onClick={s.clearPlan}>Clear all</button>}>
        {!s.plan.length && <Empty title="No interventions yet">Pick a tool on the left (keys 1–5) and place it on the map, or open <b>Optimize</b> to let HYDRA plan the budget.</Empty>}
        {types.map(t => {
          const items = s.plan.filter(p => p.type === t);
          if (!items.length) return null;
          return (
            <div key={t} className="group" style={{ ['--tc' as string]: CATALOG[t].color }}>
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
                    <button className="link" onClick={() => flyToIntervention(g, iv)}><Icon name="target" size={13} /> Show</button>
                    <button className="link danger" onClick={() => s.remove(iv.id)}><Icon name="close" size={12} /> Remove</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </Section>
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

function Recommend() {
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
    <>
      <Section title="Let HYDRA plan the budget" hint={hasPlan ? `your plan: ${s.plan.length} items, ${fmtINR(Math.max(0, left))} left` : `budget ${fmtINR(s.budget)}`}>
        <p className="sub">HYDRA simulates the storm, finds the low spots and overloaded drains that do the most harm (weighted by residents, road importance, schools and hospitals), and spends the budget where it removes the most harmful water per rupee. It then searches two ways (big rounds, and small verified steps) and keeps whichever plan removes more harm; every step is checked by re-running the storm.</p>
        <div className="row-actions">
          {hasPlan
            ? <button className="btn primary" disabled={!!s.busy || !canFill} onClick={() => s.recommend('fill')} title={canFill ? 'Keeps everything in your plan and spends what is left' : 'Your plan already uses the budget: raise it in the top bar, or start over'}>Improve my plan</button>
            : <button className="btn primary" disabled={!!s.busy} onClick={() => s.recommend('fresh')}>Plan {fmtINR(s.budget)}</button>}
          {hasPlan && <button className="btn" disabled={!!s.busy} onClick={() => s.recommend('fresh')} title="Ignores your plan and plans the whole budget">Start over</button>}
        </div>
        <Progress />
      </Section>
      {r && !s.busy && (
        <Section title="Recommended plan" hint={`${r.mode === 'fill' ? `your ${r.basePlan.length} + ${added} new` : `${r.plan.length} interventions`} · ${fmtINR(r.cost)}`} aside={<CalcSourceTag source={r.source} />}>
          {stale && <div className="callout">Your plan, budget or storm changed since this recommendation. <button className="link" onClick={() => s.recommend(r.mode === 'fill' && hasPlan ? 'fill' : hasPlan ? 'auto' : 'fresh')}>Recommend again</button></div>}
          {added === 0 && r.mode === 'fill'
            ? <p className="sub">HYDRA found nothing more worth buying with what is left: no remaining spot removes enough harmful water per rupee.</p>
            : <CompareBars keys={mine && r.mode === 'fill' ? ['none', 'plan', 'hydra'] : ['none', 'hydra']} rows={rows(b, r.metrics, undefined, mine && r.mode === 'fill' ? mine : undefined)} />}
          {r.greedy && r.greedy.impact > r.metrics.impact + 1e-6 && (
            <p className="fine">Refined search: flood impact {num(r.greedy.impact / Math.max(1e-9, b.impact) * 100)} → {num(r.metrics.impact / Math.max(1e-9, b.impact) * 100)} (no action = 100) compared with a single greedy pass; every change was checked by re-running the storm.</p>
          )}
          <div className="chips">{mix(newItems).map(([t, n]) => <span key={t} style={{ ['--tc' as string]: CATALOG[t].color }}><i />{n} × {CATALOG[t].short}</span>)}</div>
          <div className="row-actions">
            <button className="btn primary" disabled={applied || stale} onClick={() => { s.setPlan(r.plan); useStore.setState({ panel: 'overview' }); }}>
              {applied ? 'Applied' : r.mode === 'fill' ? 'Add these to my plan' : hasPlan ? 'Replace my plan' : 'Apply this plan'}
            </button>
          </div>
          {newItems.some(p => p.reason) && (
            <>
              <h4>Why these places</h4>
              <ol className="reasons">{newItems.filter(p => p.reason).slice(0, 14).map(p => <li key={p.id} style={{ ['--tc' as string]: CATALOG[p.type].color }}><b>{CATALOG[p.type].short}</b> {p.reason} <em>{fmtINR(costOf(g, p))}</em></li>)}</ol>
              {newItems.length > 14 && <p className="fine">…and {newItems.length - 14} more in Plan & cost once applied.</p>}
            </>
          )}
        </Section>
      )}
    </>
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

function Showdown() {
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
      <>
        <div className="headline">
          <div><b>{num(Math.max(0, savedH))}</b><span>homes kept dry by HYDRA's plan</span></div>
          <div><b>{num(Math.max(0, savedS), 1)}</b><span>by an even spread of the same {fmtINR(sd.budget)}</span></div>
        </div>
        <p className="sub">Flood impact falls <b>{cutH}%</b> with HYDRA against <b>{cutS}%</b> for the even spread{cutS > 0 ? `, ${num(cutH / cutS, 1)}× the effect for the same money` : ''}. Same storm, same budget, same neighbourhood: only the placement differs.</p>
      </>
    );
  }
  return (
    <>
      <Section title="Budget showdown" hint={`same storm, same ${fmtINR(s.budget)}`}>
        <p className="sub">Three strategies: do nothing; spend it <b>evenly</b> on drains, rain gardens, roof harvesting and pits at random spots (average of 3 such plans, with their range); or let <b>HYDRA</b> place it using terrain, drainage connectivity and flood risk.</p>
        <div className="row-actions"><button className="btn accent" disabled={!!s.busy} onClick={s.run}>{sd ? 'Run again' : 'Run the showdown'}</button></div>
        <Progress />
      </Section>
      {sd && !s.busy && (
        <Section title="Result" aside={<CalcSourceTag source={sd.source} />}>
          {headline}
          <CompareBars keys={['none', 'spread', 'hydra']} rows={rows(sd.base, sd.hydra.metrics, sd.spreads.map(x => x.metrics))} />
          <p className="fine">Spent: even spread {fmtINR(sd.spreads.reduce((a, x) => a + x.cost, 0) / sd.spreads.length)} on average, HYDRA {fmtINR(sd.hydra.cost)}. HYDRA's mix: {mix(sd.hydra.plan).map(([t, n]) => `${n} ${CATALOG[t].short.toLowerCase()}`).join(', ')}.</p>
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
  const site = useStore(s => s.site);
  if (!site) return null;
  return (
    <div className="tab about">
      <Section title={`${site.name}, ${site.city}`} hint={site.state}>
        <p>{site.blurb} Soil: {site.soil.name} (infiltration factor ×{site.soil.factor}). Relief {site.stats.relief} m across 600 m × 600 m, on a 5 m grid.</p>
      </Section>
      <Section title="How the simulation works">
        <ol>
          <li><b>Rain</b> falls as a design storm in 5-minute blocks (IMD categories: heavy 64.5–115.5 mm/day, very heavy 115.6–204.4, extremely heavy ≥ 204.5; cloudburst ≥ 100 mm/h).</li>
          <li><b>Roofs</b> drain through downpipes onto the street, unless a rooftop harvesting tank (40 mm of roof rain) catches it first.</li>
          <li><b>Runoff</b> flows downhill along the steepest path, soaking into permeable ground on the way (open ground 10, green 25, paving 1.5 mm/h × soil factor, until the soil is saturated).</li>
          <li><b>Open roadside drains</b> take in up to 0.12 m³/s per 5 m and carry it to outfalls, routed by gravity. Existing drains run at 50 % capacity (silt and solid waste). When full they overflow back onto the street.</li>
          <li><b>Low spots</b> fill like small reservoirs and spill to the next one when full. Moving water on streets gets a Manning normal depth.</li>
          <li><b>Harm</b> is water above 10 cm, weighted by road class, residents at the doorstep (4.4 per household), and ×25 for schools and hospitals. Homes count as flooded when water at the door rises above their plinth.</li>
        </ol>
      </Section>
      <Section title="Interventions and indicative costs">
        <ul>{(Object.keys(CATALOG) as InterventionType[]).map(t => <li key={t}><b>{CATALOG[t].name}</b>: {CATALOG[t].unit}. {CATALOG[t].blurb}</li>)}</ul>
        <p className="fine">Parameters: new drain {PARAMS.newDrainCap} m³/s; rain garden {PARAMS.gardenDepth * 100} cm deep, {PARAMS.gardenRate} mm/h media; recharge pit {PARAMS.pitStore} m³ + {PARAMS.pitRate} L/s × soil; desilting to {Math.round(PARAMS.desiltTo * 100)} % silt. Unit costs are indicative 2024 Indian rates: use the local CPWD / PWD schedule of rates for real budgets. Street depth thresholds: waterlogged {DEPTH.wet * 100} cm, roads cut {DEPTH.road * 100} cm.</p>
      </Section>
      <Section title="Data">
        <ul>
          <li><b>Buildings, roads, land use:</b> {site.provenance.osm}. {site.stats.osmBuildings} buildings from OSM, {site.stats.syntheticBuildings} synthetic.</li>
          <li><b>Terrain:</b> {site.provenance.terrain}. Depressions deeper than 40 cm are treated as elevation-data artefacts and partly filled (buildings count as walls).</li>
          <li><b>Synthetic, and labelled as such:</b> {site.provenance.synthetic.join('; ')}.</li>
        </ul>
      </Section>
      <Section title="Limits">
        <p>This is a transparent screening model, not a hydraulic design tool. Water routing is quasi-steady (no travel time within a minute), drains are a single gravity network, and outfalls are assumed to have capacity beyond the area. Use it to compare options and target budgets, then confirm with detailed survey and design.</p>
      </Section>
    </div>
  );
}

const TABS: { id: Exclude<PanelId, 'about'>; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'analytics', label: 'Analytics' }, { id: 'plan', label: 'Plan & cost' }, { id: 'optimize', label: 'Optimize' }];

/** Where you are and what the numbers describe, above every section. */
function PanelHead() {
  const site = useStore(s => s.site), mode = useStore(s => s.mode), stormId = useStore(s => s.stormId);
  const f = useStore(useShallow(st => ({ plan: st.plan.length, key: planKey(st.plan), currentKey: st.currentKey, running: st.running })));
  const h = useHeat(useShallow(st => ({ scenarioId: st.scenarioId, windowId: st.windowId, plan: st.plan.length, key: heatPlanKey(st.plan), currentKey: st.currentKey, running: st.running })));
  if (!site) return null;
  const cond = mode === 'flood'
    ? STORMS.find(x => x.id === stormId)?.name
    : `${HEAT_SCENARIOS.find(x => x.id === h.scenarioId)?.name ?? ''} · ${HEAT_WINDOWS.find(x => x.id === h.windowId)?.name ?? ''}`;
  const [n, running, matches] = mode === 'flood' ? [f.plan, f.running, f.plan > 0 && f.key === f.currentKey] : [h.plan, h.running, h.plan > 0 && h.key === h.currentKey];
  const status = running ? ['busy', 'Simulating'] : !n ? ['base', 'No action'] : matches ? ['plan', `Plan · ${n}`] : ['stale', 'Plan changed'];
  return (
    <div className="panel-head">
      <div><b>{site.name}</b><span>{site.city} · {cond}</span></div>
      <span className={`status ${status[0]}`}>{status[1]}</span>
    </div>
  );
}

// The tabs are shared by both modes; the content comes from the active mode.
export function SidePanel() {
  const panel = useStore(s => s.panel), mode = useStore(s => s.mode);
  return (
    <aside className="panel">
      <PanelHead />
      <nav className="tabs">
        {TABS.map(t => <button key={t.id} className={panel === t.id ? 'on' : ''} onClick={() => useStore.setState({ panel: t.id })}>{t.label}</button>)}
        <button className={`info${panel === 'about' ? ' on' : ''}`} onClick={() => useStore.setState({ panel: panel === 'about' ? 'overview' : 'about' })} title="Method, data and assumptions" aria-label="Method, data and assumptions">i</button>
      </nav>
      <div className="panel-body">
        {mode === 'heat' ? <HeatTab panel={panel} /> : (
          <>
            {panel === 'overview' && <Overview />}
            {panel === 'analytics' && <Analytics />}
            {panel === 'plan' && <PlanCost />}
            {panel === 'optimize' && <Optimize recommend={<Recommend />} showdown={<Showdown />} />}
            {panel === 'about' && <AboutTab />}
          </>
        )}
      </div>
    </aside>
  );
}
