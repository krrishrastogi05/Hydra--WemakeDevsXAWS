// Presentational building blocks shared by both modes' side panels, so every section reads the same way.
import type { ReactNode } from 'react';
import { fmtINR } from '../sim/grid';
import { useStore, type OptimizeView } from '../store';
import { Icon, SubTabs } from './Chrome';

export const num = (v: number, d = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

/** A titled card: the unit every panel section is built from. */
export function Section({ title, hint, aside, children, flush }: { title: string; hint?: ReactNode; aside?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className={`card${flush ? ' flush' : ''}`}>
      <header className="card-head"><h3>{title}</h3>{hint && <small>{hint}</small>}{aside && <span className="card-aside">{aside}</span>}</header>
      {children}
    </section>
  );
}

/** The one-line answer at the top of Overview: what this scenario means, in plain words. */
export function Verdict({ tone, kicker, children, actions }: { tone: 'neutral' | 'good' | 'warn'; kicker: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={`verdict ${tone}`}>
      <span className="kicker">{kicker}</span>
      <p>{children}</p>
      {actions && <div className="row-actions">{actions}</div>}
    </div>
  );
}

/** A metric tile: current value, and when there is a comparison, the change against no action. */
export function Metric({ label, value, base, change, tone, hint }: { label: string; value: string; base?: string; change?: string; tone?: 'good' | 'bad' | 'flat'; hint?: string }) {
  return (
    <div className="metric" title={hint}>
      <span className="metric-label">{label}</span>
      <b className="metric-value">{value}</b>
      {change != null
        ? <span className={`metric-delta ${tone ?? 'flat'}`}>{tone === 'good' ? '▼' : tone === 'bad' ? '▲' : '='} {change} <em>vs {base}</em></span>
        : <span className="metric-delta flat"><em>no action</em></span>}
    </div>
  );
}

export interface CostPart { label: string; color: string; count: number; cost: number }

/** Budget used, split by intervention type, as a bar and a small table. */
export function BudgetBreakdown({ spent, budget, parts, note }: { spent: number; budget: number; parts: CostPart[]; note?: ReactNode }) {
  const used = parts.filter(p => p.count > 0), left = Math.max(0, budget - spent), pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  return (
    <div className="budget">
      <div className="budget-top">
        <div><span className="metric-label">Committed</span><b>{fmtINR(spent)}</b></div>
        <div><span className="metric-label">Budget</span><b>{fmtINR(budget)}</b></div>
        <div><span className="metric-label">Remaining</span><b className={left === 0 && spent > 0 ? 'warn' : ''}>{fmtINR(left)}</b></div>
      </div>
      <div className="budget-bar" role="img" aria-label={`${Math.round(pct)}% of the budget committed`}>
        {used.map(p => <i key={p.label} style={{ width: `${(p.cost / Math.max(budget, spent)) * 100}%`, background: p.color }} title={`${p.label}: ${fmtINR(p.cost)}`} />)}
      </div>
      <span className="budget-pct">{Math.round(pct)}% of the budget committed</span>
      {used.length > 0 && (
        <table className="ledger">
          <thead><tr><th>Intervention</th><th>Qty</th><th>Cost</th><th>Share</th></tr></thead>
          <tbody>
            {used.map(p => (
              <tr key={p.label}><td><i style={{ background: p.color }} />{p.label}</td><td>{p.count}</td><td>{fmtINR(p.cost)}</td><td>{spent > 0 ? Math.round((p.cost / spent) * 100) : 0}%</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td>Total</td><td>{used.reduce((a, p) => a + p.count, 0)}</td><td>{fmtINR(spent)}</td><td>100%</td></tr></tfoot>
        </table>
      )}
      {note && <p className="fine">{note}</p>}
    </div>
  );
}

/** Rupees per unit of benefit; shows a dash when there is no benefit to divide by. */
export function ValueRows({ rows }: { rows: { label: string; cost: number; benefit: number; unit: string }[] }) {
  return (
    <div className="value-rows">
      {rows.map(r => (
        <div key={r.label} className="value-row">
          <span>{r.label}</span>
          <b>{r.benefit > 1e-9 ? `${fmtINR(r.cost / r.benefit)} ` : '— '}<em>{r.benefit > 1e-9 ? `per ${r.unit}` : 'no gain yet'}</em></b>
        </div>
      ))}
    </div>
  );
}

/** Empty state with a single next step. */
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><b>{title}</b><p>{children}</p></div>;
}

const OPT_TABS = [{ id: 'recommend', label: 'Recommend' }, { id: 'showdown', label: 'Showdown' }] as const;

/** Recommend and Showdown as one "compare strategies" section; both modes use it. */
export function Optimize({ recommend, showdown }: { recommend: ReactNode; showdown: ReactNode }) {
  const view = useStore(s => s.optimize);
  return (
    <div className="tab">
      <SubTabs tabs={OPT_TABS} active={view} onChange={(v: OptimizeView) => useStore.setState({ optimize: v })} />
      {view === 'recommend' ? recommend : showdown}
    </div>
  );
}

/** Opens the full analytics view at a section. */
export const openAnalytics = (section = 'summary') => useStore.setState({ analytics: section });
export function MoreLink({ section, children }: { section: string; children: ReactNode }) {
  return <button className="link more" onClick={() => openAnalytics(section)}>{children} <Icon name="expand" size={12} /></button>;
}
