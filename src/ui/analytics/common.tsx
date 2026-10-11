// Analytics pieces shared by flood and heat: stat cards, the strategy comparison, and the cost view. Each mode
// turns its own results into the neutral shapes below, so both modes present the same way.
import type { ReactNode } from 'react';
import { fmtINR } from '../../sim/grid';
import { SERIES, type BarRow } from '../charts';
import { BudgetBreakdown, Section, ValueRows, Verdict, num, type CostPart } from '../kit';
import { DataTable, Donut, GroupedBars, HBars, Scatter, Spark, StackRows, type Pt } from '../viz';

export function StatCard({ label, value, change, tone, base, spark, hint }: { label: string; value: string; change?: string; tone?: 'good' | 'bad' | 'flat'; base?: string; spark?: { ys: ArrayLike<number>; base?: ArrayLike<number> }; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <span className="metric-label">{label}</span>
      <b className="stat-value">{value}</b>
      {change != null
        ? <span className={`metric-delta ${tone ?? 'flat'}`}>{tone === 'good' ? '▼' : tone === 'bad' ? '▲' : '='} {change} <em>vs {base}</em></span>
        : <span className="metric-delta flat"><em>no action</em></span>}
      {spark && <Spark ys={spark.ys} base={spark.base} color={change != null ? SERIES.plan.color : SERIES.none.color} />}
    </div>
  );
}

export type Better = 'lower' | 'higher';
export interface StratMetric { label: string; hint?: string; fmt: (v: number) => string; better: Better; none: number; hydra: number; spreads: number[] }
export interface Part { label: string; color: string; value: number }
export interface StratData {
  budget: number;
  /** the outcome people care about most, counted in units (homes kept dry, hot places cooled) */
  headline: { label: string; unit: string; units: string; none: number; hydra: number; spreads: number[]; better: Better };
  /** the overall harm index, compared as a % improvement */
  impact: { label: string; none: number; hydra: number; spreads: number[]; better: Better };
  metrics: StratMetric[];
  cost: { hydra: number; spreads: number[] };
  mix: { hydra: Part[]; spreads: Part[][] };
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const gain = (b: Better, none: number, x: number) => (b === 'lower' ? none - x : x - none);
const improve = (b: Better, none: number, x: number) => (none ? (b === 'lower' ? (1 - x / none) * 100 : ((x - none) / Math.abs(none)) * 100) : 0);

export function stratSummary(d: StratData) {
  const h = d.headline, i = d.impact;
  const hydraGain = gain(h.better, h.none, h.hydra), spreadGains = h.spreads.map(v => gain(h.better, h.none, v)), spreadGain = avg(spreadGains);
  const hydraCut = improve(i.better, i.none, i.hydra), spreadCuts = i.spreads.map(v => improve(i.better, i.none, v)), spreadCut = avg(spreadCuts);
  const spreadCost = avg(d.cost.spreads);
  return { hydraGain, spreadGain, spreadGains, hydraCut, spreadCut, spreadCuts, spreadCost, ratio: spreadCut > 0.05 ? hydraCut / spreadCut : null };
}

/** No action, even spread and HYDRA side by side; used in the side panel and the analytics view. */
export function StrategyCards({ d }: { d: StratData }) {
  const s = stratSummary(d), hydraWins = s.hydraCut >= s.spreadCut;
  const card = (key: 'none' | 'spread' | 'hydra', title: string, g: number, cut: number, cost: number, note?: string) => (
    <div className={`strat ${key}${key === 'hydra' && hydraWins ? ' best' : ''}`}>
      <div className="strat-top"><i className={`sw ${key}`} />{title}{key === 'hydra' && hydraWins && <span className="badge">Best</span>}</div>
      <b className="strat-big">{key === 'none' ? '—' : num(Math.max(0, g), g % 1 && Math.abs(g) < 10 ? 1 : 0)}</b>
      <span className="strat-unit">{d.headline.units} {d.headline.better === 'lower' ? 'better off' : 'improved'}</span>
      <dl>
        <div><dt>{d.impact.label}</dt><dd>{key === 'none' ? 'baseline' : `${cut >= 0 ? '−' : '+'}${num(Math.abs(cut), 1)}%`}</dd></div>
        <div><dt>Spent</dt><dd>{key === 'none' ? '₹0' : fmtINR(cost)}</dd></div>
        <div><dt>Per {d.headline.unit}</dt><dd>{key === 'none' || g <= 1e-9 ? '—' : fmtINR(cost / g)}</dd></div>
      </dl>
      {note && <small>{note}</small>}
    </div>
  );
  return (
    <div className="strats">
      {card('none', 'No action', 0, 0, 0)}
      {card('spread', 'Even spread', s.spreadGain, s.spreadCut, s.spreadCost, `average of ${d.cost.spreads.length} random plans`)}
      {card('hydra', 'HYDRA plan', s.hydraGain, s.hydraCut, d.cost.hydra, 'placed by risk and terrain')}
    </div>
  );
}

export function StrategyVerdict({ d, place }: { d: StratData; place: string }) {
  const s = stratSummary(d);
  const better = s.hydraCut > s.spreadCut;
  return (
    <Verdict tone={better ? 'good' : 'warn'} kicker={better ? 'HYDRA wins' : 'Close call'}>
      For the same <b>{fmtINR(d.budget)}</b>, HYDRA's plan cuts {d.impact.label.toLowerCase()} by <b>{num(s.hydraCut, 1)}%</b> against <b>{num(s.spreadCut, 1)}%</b> for an even spread
      {s.ratio ? <>, <b>{num(s.ratio, 1)}×</b> the effect</> : null}. Same {place}, same budget: only the placement differs.
    </Verdict>
  );
}

const rowsOf = (d: StratData): BarRow[] => d.metrics.map(m => ({
  label: m.label, hint: m.hint, fmt: m.fmt, better: m.better,
  values: { none: m.none, spread: avg(m.spreads), hydra: m.hydra },
  range: { spread: [Math.min(...m.spreads), Math.max(...m.spreads)] },
}));

/** The full comparison for the analytics view. */
export function StrategyView({ d, place, actions }: { d: StratData; place: string; actions?: ReactNode }) {
  const s = stratSummary(d);
  const plans = [...s.spreadCuts.map((c, k) => ({ label: `Even spread · plan ${k + 1}`, value: c, color: SERIES.spread.color, cost: d.cost.spreads[k], g: s.spreadGains[k] })), { label: 'HYDRA plan', value: s.hydraCut, color: SERIES.hydra.color, cost: d.cost.hydra, g: s.hydraGain }]
    .sort((a, b) => b.value - a.value);
  return (
    <>
      <StrategyVerdict d={d} place={place} />
      <StrategyCards d={d} />
      {actions && <div className="row-actions">{actions}</div>}
      <div className="an-grid">
        <Section title="Outcome by metric" hint="each metric on its own scale · bar = average, line = range of the random plans">
          <GroupedBars keys={['none', 'spread', 'hydra']} rows={rowsOf(d)} />
        </Section>
        <div className="an-col">
          <Section title="Every plan, ranked" hint={`${d.impact.label.toLowerCase()} cut, same budget`}>
            <HBars rows={plans.map(p => ({ label: p.label, sub: fmtINR(p.cost), value: p.value, color: p.color }))} fmt={v => `${num(v, 1)}%`} />
            <p className="fine">HYDRA is compared with every random plan, not just their average: chance does not explain the gap.</p>
          </Section>
          <Section title="Cost per result" hint={`rupees per ${d.headline.unit} · lower is better`}>
            <HBars rows={plans.filter(p => p.g > 1e-9).map(p => ({ label: p.label, value: p.cost / p.g, color: p.color }))} fmt={v => fmtINR(v)} />
            {plans.some(p => p.g <= 1e-9) && <p className="fine">Plans with no {d.headline.units} improved are left out.</p>}
          </Section>
        </div>
        <Section title="Where each strategy spends" hint="cost by intervention type">
          <StackRows rows={[...d.mix.spreads.map((m, k) => ({ label: `Even spread · ${k + 1}`, parts: m })), { label: 'HYDRA plan', parts: d.mix.hydra }]} fmt={v => fmtINR(v)} />
        </Section>
      </div>
    </>
  );
}

export interface LedgerItem { name: string; type: string; color: string; cost: number; source?: string }

/** Budget, value for money, cost against benefit for every strategy run so far, and the most expensive items. */
export function CostView({ spent, budget, parts, value, frontier, items, benefitLabel, note }: {
  spent: number; budget: number; parts: CostPart[]; value: { label: string; cost: number; benefit: number; unit: string }[] | null;
  frontier: Pt[]; items: LedgerItem[]; benefitLabel: string; note: string;
}) {
  return (
    <div className="an-grid">
      <Section title="Budget"><BudgetBreakdown spent={spent} budget={budget} parts={parts} note={note} /></Section>
      <div className="an-col">
        <Section title="Spend by type">
          {spent > 0 ? <Donut parts={parts.filter(p => p.cost > 0).map(p => ({ label: p.label, color: p.color, value: p.cost }))} center={fmtINR(spent)} sub="committed" /> : <p className="sub">Nothing committed yet.</p>}
        </Section>
        <Section title="Value for money" hint={value ? 'from the latest run of your plan' : undefined}>
          {value ? <ValueRows rows={value} /> : <p className="sub">Place interventions and run the scenario to see the rupees each result costs.</p>}
        </Section>
      </div>
      <Section title="Cost against benefit" hint="every strategy calculated so far · up and to the left is better" aside={undefined}>
        {frontier.length > 1
          ? <Scatter pts={frontier} xFmt={v => fmtINR(v)} yFmt={v => `${num(v, 0)}%`} xLabel="Spent" yLabel={benefitLabel} />
          : <p className="sub">Run your plan, Recommend or the Showdown to plot strategies here.</p>}
      </Section>
      {items.length > 0 && (
        <Section title="Line items" hint={`${items.length} interventions · click a column to sort`}>
          <DataTable<LedgerItem> initial="cost" rows={items} cols={[
            { key: 'name', label: 'Intervention', render: r => r.name, sort: r => r.name },
            { key: 'type', label: 'Type', render: r => <span className="type-pill"><i style={{ background: r.color }} />{r.type}</span>, sort: r => r.type },
            { key: 'source', label: 'By', render: r => r.source === 'hydra' ? 'HYDRA' : r.source === 'spread' ? 'even spread' : 'you', sort: r => r.source ?? 'user' },
            { key: 'cost', label: 'Cost', num: true, render: r => fmtINR(r.cost), sort: r => r.cost },
          ]} />
        </Section>
      )}
    </div>
  );
}
