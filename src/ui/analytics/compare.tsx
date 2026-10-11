// "Compare plans": save named plans, then set any of them side by side. Each saved plan carries its own
// no-action baseline, so plans made for different storms or days are compared as improvements.
import { useState } from 'react';
import { useStore } from '../../store';
import { fmtINR } from '../../sim/grid';
import { useSaved, type SavedEntry } from '../../savedPlans';
import { Empty, Section, num } from '../kit';
import { HBars, Scatter } from '../viz';
import { SERIES } from '../charts';
import { Icon } from '../Chrome';

// categorical slots, in the validated order: identity only, assigned by position in the comparison
export const PLAN_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];

type Def = { label: string; key: string; fmt: (v: number) => string; better: 'lower' | 'higher'; scale?: number };
const FLOOD_DEFS: Def[] = [
  { label: 'Homes with water inside', key: 'buildingsFlooded', fmt: v => num(v), better: 'lower' },
  { label: 'Residents affected', key: 'residentsAffected', fmt: v => num(v), better: 'lower' },
  { label: 'Roads cut', key: 'roadKmAffected', fmt: v => `${num(v, 2)} km`, better: 'lower' },
  { label: 'Waterlogged area', key: 'floodedArea', fmt: v => `${num(v, 2)} ha`, better: 'lower', scale: 1e-4 },
  { label: 'Road disruption', key: 'roadKmHours', fmt: v => `${num(v, 2)} km·h`, better: 'lower' },
  { label: 'Peak standing water', key: 'peakPonded', fmt: v => `${num(v)} m³`, better: 'lower' },
  { label: 'Schools & hospitals hit', key: 'criticalAffected', fmt: v => num(v), better: 'lower' },
  { label: 'Flood impact', key: 'impact', fmt: v => num(v, 0), better: 'lower' },
];
const HEAT_DEFS: Def[] = [
  { label: 'High-exposure places', key: 'hotReceptors', fmt: v => num(v), better: 'lower' },
  { label: 'Shade where people wait', key: 'receptorShade', fmt: v => `${Math.round(v)}%`, better: 'higher', scale: 100 },
  { label: 'Exposure at busy places', key: 'weightedIndex', fmt: v => num(v, 1), better: 'lower' },
  { label: 'Street space in sun at midday', key: 'exposedShare', fmt: v => `${Math.round(v)}%`, better: 'lower', scale: 100 },
  { label: 'Direct sun per spot', key: 'sunHours', fmt: v => `${num(v, 2)} h`, better: 'lower' },
  { label: 'Shade over walkable space', key: 'shadeShare', fmt: v => `${Math.round(v)}%`, better: 'higher', scale: 100 },
  { label: 'Heat absorbed by roofs', key: 'roofHeat', fmt: v => `${num(v)} MWh`, better: 'lower' },
];

/** % improvement over the plan's own no-action baseline (positive = better). */
const gainPct = (d: Def, e: SavedEntry) => {
  const b = e.base[d.key] ?? 0, v = e.metrics[d.key] ?? 0;
  if (!b) return 0;
  return d.better === 'lower' ? (1 - v / b) * 100 : ((v - b) / Math.abs(b)) * 100;
};
const headline = (e: SavedEntry) => (e.mode === 'flood'
  ? { value: (e.base.buildingsFlooded ?? 0) - (e.metrics.buildingsFlooded ?? 0), unit: 'home kept dry', units: 'homes kept dry' }
  : { value: (e.base.hotReceptors ?? 0) - (e.metrics.hotReceptors ?? 0), unit: 'place cooled', units: 'places cooled' });
const impactCut = (e: SavedEntry) => gainPct(e.mode === 'flood' ? FLOOD_DEFS[7] : HEAT_DEFS[2], e);

export function SaveBar() {
  const mode = useStore(s => s.mode), notify = useStore(s => s.notify);
  const n = useSaved(s => s.entries.length);
  const [name, setName] = useState(''), [msg, setMsg] = useState<string | null>(null);
  const save = () => {
    const r = useSaved.getState().saveCurrent(name.trim() || `Plan ${n + 1}`);
    if (typeof r === 'string') { setMsg(r); return; }
    setName(''); setMsg(null); notify(`Saved "${r.name}"`);
  };
  return (
    <div className="savebar">
      <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder={`Name this ${mode} plan, e.g. "Drains first"`} maxLength={48} aria-label="Plan name" />
      <button className="btn primary sm" onClick={save}><Icon name="plus" size={13} />Save current plan</button>
      {msg && <span className="bad">{msg}</span>}
    </div>
  );
}

function Row({ e, color, picked, close }: { e: SavedEntry; color?: string; picked: boolean; close: () => void }) {
  const s = useSaved(), [edit, setEdit] = useState(false), [name, setName] = useState(e.name), h = headline(e);
  const commit = () => { setEdit(false); if (name.trim() && name !== e.name) s.rename(e.id, name.trim()); };
  return (
    <div className={`saved${picked ? ' picked' : ''}`} style={color ? { ['--pc' as string]: color } : undefined}>
      <label className="saved-pick" title="Compare this plan"><input type="checkbox" checked={picked} onChange={() => s.toggle(e.id)} /><i /></label>
      <div className="saved-main">
        {edit ? <input autoFocus value={name} onChange={x => setName(x.target.value)} onBlur={commit} onKeyDown={x => x.key === 'Enter' && commit()} maxLength={48} />
          : <b onDoubleClick={() => setEdit(true)}>{e.name}</b>}
        <small>{e.cond} · {e.plan.length} interventions · {fmtINR(e.cost)} · {new Date(e.savedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
      </div>
      <span className="saved-kpi"><b>{num(Math.max(0, h.value))}</b><small>{h.units}</small></span>
      <span className="saved-kpi"><b>{num(impactCut(e), 1)}%</b><small>{e.mode === 'flood' ? 'impact cut' : 'exposure cut'}</small></span>
      <div className="saved-act">
        <button className="btn sm" onClick={async () => { close(); await s.open(e.id); }} title="Put this plan back on the map, with its conditions">Open</button>
        <button className="link" onClick={() => setEdit(true)}>Rename</button>
        <button className="link danger" onClick={() => s.remove(e.id)}>Delete</button>
      </div>
    </div>
  );
}

export function ComparePlans({ close, report }: { close: () => void; report?: boolean }) {
  const mode = useStore(s => s.mode), siteId = useStore(s => s.site?.id);
  const all = useSaved(s => s.entries), pickedIds = useSaved(s => s.picked);
  const mine = all.filter(e => e.mode === mode && e.siteId === siteId);
  const chosen = pickedIds.map(id => mine.find(e => e.id === id)).filter((e): e is SavedEntry => !!e);
  // in the report, compare everything saved when nothing is ticked
  const picked = report && !chosen.length ? mine.slice(0, 5) : chosen;
  const color = (e: SavedEntry) => PLAN_COLORS[picked.indexOf(e)];
  const defs = mode === 'flood' ? FLOOD_DEFS : HEAT_DEFS;
  const mixed = new Set(picked.map(e => e.cond)).size > 1;
  return (
    <>
      {!report && <Section title="Save the plan on the map" hint="saved in this browser, for this neighbourhood"><SaveBar /></Section>}
      {!report && <Section title="Saved plans" hint={mine.length ? `${mine.length} saved · tick up to 5 to compare · double-click a name to rename` : undefined}>
        {mine.length ? <div className="saved-list">{mine.map(e => <Row key={e.id} e={e} picked={pickedIds.includes(e.id)} color={picked.includes(e) ? color(e) : undefined} close={close} />)}</div>
          : <Empty title="No saved plans yet">Build a plan (or let HYDRA recommend one), run it, then save it above. Change something and save again to compare the two.</Empty>}
      </Section>}
      {picked.length >= 1 && (
        <>
          {mixed && <div className="callout">These plans were made for different conditions, so each is compared with its own no-action baseline (as an improvement), not by raw numbers.</div>}
          <Section title="Side by side" hint="value · change against the plan's own no-action baseline · best in bold">
            <div className="dtable">
              <table className="cmp">
                <thead><tr><th>Metric</th>{picked.map(e => <th key={e.id} className="num"><span className="cmp-head"><i style={{ background: color(e) }} />{e.name}</span></th>)}</tr></thead>
                <tbody>
                  <tr><td>Spent</td>{picked.map(e => <td key={e.id} className="num">{fmtINR(e.cost)}</td>)}</tr>
                  <tr><td>Interventions</td>{picked.map(e => <td key={e.id} className="num">{e.plan.length}</td>)}</tr>
                  {defs.map(d => {
                    const gains = picked.map(e => gainPct(d, e)), best = Math.max(...gains);
                    return (
                      <tr key={d.key}><td>{d.label}</td>{picked.map((e, k) => {
                        const g = gains[k];
                        return <td key={e.id} className={`num${picked.length > 1 && g === best && g > 0.05 ? ' best' : ''}`}>{d.fmt((e.metrics[d.key] ?? 0) * (d.scale ?? 1))}<em className={g > 0.05 ? 'good' : g < -0.05 ? 'bad' : 'muted'}>{g > 0 ? '▼' : g < 0 ? '▲' : '='} {num(Math.abs(g), 1)}%</em></td>;
                      })}</tr>
                    );
                  })}
                  <tr><td>Conditions</td>{picked.map(e => <td key={e.id} className="num cmp-cond">{e.cond}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <p className="fine">▼ means better than no action under the same conditions (fewer flooded homes, less exposure, or more shade where higher is better).</p>
          </Section>
          <div className="an-grid">
            <div className="an-col">
              <Section title={mode === 'flood' ? 'Flood impact cut' : 'Exposure cut at busy places'} hint="against each plan's own baseline">
                <HBars rows={picked.map(e => ({ label: e.name, sub: fmtINR(e.cost), value: impactCut(e), color: color(e) }))} fmt={v => `${num(v, 1)}%`} />
              </Section>
              <Section title="Cost per result" hint={`rupees per ${headline(picked[0]).unit} · lower is better`}>
                {picked.some(e => headline(e).value > 0)
                  ? <HBars rows={picked.filter(e => headline(e).value > 0).map(e => ({ label: e.name, value: e.cost / headline(e).value, color: color(e) }))} fmt={v => fmtINR(v)} />
                  : <p className="sub">None of these plans has a headline improvement yet.</p>}
              </Section>
            </div>
            <Section title="Cost against benefit" hint="up and to the left is better">
              <Scatter pts={[{ id: 'none', label: 'No action', x: 0, y: 0, color: SERIES.none.color, hollow: true }, ...picked.map(e => ({ id: e.id, label: e.name, x: e.cost, y: impactCut(e), color: color(e), r: 8, note: e.cond }))]}
                xFmt={v => fmtINR(v)} yFmt={v => `${num(v, 0)}%`} xLabel="Spent" yLabel={mode === 'flood' ? 'Flood impact cut' : 'Exposure cut'} />
            </Section>
          </div>
        </>
      )}
    </>
  );
}
