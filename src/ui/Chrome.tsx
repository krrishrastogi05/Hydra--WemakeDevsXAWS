// Top bar, tool palette, budget meter, legend, toasts and the first-run guide.
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, planKey, type Tool } from '../store';
import { fmtINR } from '../sim/grid';
import { CATALOG, STORMS, planCost } from '../sim/flood/model';
import type { InterventionType } from '../sim/flood/types';

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p: Record<string, ReactNode> = {
    inspect: <path d="M5 3l12 7-5 1.5L9.5 17z" />,
    drain: <><path d="M3 8h14M3 12h14" /><path d="M12 5l3 3-3 3" /></>,
    garden: <path d="M10 17V9m0 0C10 5 13 3 17 3c0 4-3 6-7 6zm0 2C10 8 7 6 3 6c0 3 3 5 7 5z" />,
    rwh: <><path d="M3 9l7-6 7 6v8H3z" /><path d="M10 9c1.6 2 2.4 3.1 2.4 4a2.4 2.4 0 0 1-4.8 0c0-.9.8-2 2.4-4z" /></>,
    pit: <><circle cx="10" cy="10" r="7" /><path d="M10 6v7m-3-3l3 3 3-3" /></>,
    desilt: <><path d="M4 16l7-7m2-2l3-3" /><path d="M10 6l4 4-3 3-4-4z" /></>,
    erase: <path d="M4 13l7-7 5 5-7 7H6zM9 18h8" />,
    undo: <path d="M7 5L3 9l4 4M3 9h9a5 5 0 0 1 0 10H8" />,
    play: <path d="M6 4l11 6-11 6z" />, pause: <path d="M6 4h3v12H6zm5 0h3v12h-3z" />,
    drop: <path d="M10 2c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" />,
    target: <><circle cx="10" cy="10" r="6" /><circle cx="10" cy="10" r="2" /></>,
    close: <path d="M5 5l10 10M15 5L5 15" />,
  };
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[name]}</svg>;
}

const BUDGETS = [10e5, 25e5, 50e5, 75e5, 1e7, 2e7];

export function TopBar() {
  // subscribe to just what the bar shows, so playback ticks do not re-render it
  const s = useStore(useShallow(st => ({ sites: st.sites, siteId: st.siteId, loadSite: st.loadSite, stormId: st.stormId, setStorm: st.setStorm, antecedent: st.antecedent, setAntecedent: st.setAntecedent,
    budget: st.budget, setBudget: st.setBudget, grid: st.grid, plan: st.plan, currentKey: st.currentKey, running: st.running, runPlan: st.runPlan, busy: st.busy, recommend: st.recommend, runShowdown: st.runShowdown })));
  const stale = s.plan.length > 0 && planKey(s.plan) !== s.currentKey;
  const spent = s.grid ? planCost(s.grid, s.plan) : 0;
  return (
    <header className="topbar">
      <div className="logo"><Icon name="drop" size={20} /><b>HYDRA</b><span>Climate-resilient city simulator</span></div>
      <nav className="cities" aria-label="Neighbourhood">
        {s.sites.map(x => (
          <button key={x.id} className={x.id === s.siteId ? 'on' : ''} onClick={() => x.id !== s.siteId && s.loadSite(x.id)} title={x.blurb}>
            {x.city}<small>{x.name.split(',')[0]}</small>
          </button>
        ))}
      </nav>
      <div className="controls">
        <label>Storm<select value={s.stormId} onChange={e => s.setStorm(e.target.value)}>{STORMS.map(st => <option key={st.id} value={st.id}>{st.name} · {st.totalMm} mm / {st.durationMin / 60} h</option>)}</select></label>
        <label>Soil<select value={s.antecedent} onChange={e => s.setAntecedent(e.target.value as 'dry' | 'normal' | 'wet')}><option value="dry">Dry (early monsoon)</option><option value="normal">Normal</option><option value="wet">Wet (after days of rain)</option></select></label>
        <label>Budget<select value={s.budget} onChange={e => s.setBudget(+e.target.value)}>{BUDGETS.map(b => <option key={b} value={b}>{fmtINR(b)}</option>)}</select></label>
        <div className="meter" title={`${fmtINR(spent)} of ${fmtINR(s.budget)} committed`}>
          <div className="meter-bar">{(Object.keys(CATALOG) as InterventionType[]).map(t => {
            const v = s.grid ? planCost(s.grid, s.plan.filter(p => p.type === t)) : 0;
            return v ? <i key={t} style={{ width: `${(v / s.budget) * 100}%`, background: CATALOG[t].color }} /> : null;
          })}</div>
          <span>{fmtINR(spent)} <em>/ {fmtINR(s.budget)}</em></span>
        </div>
        <button className="btn primary" disabled={s.running || !s.grid} onClick={() => (s.plan.length ? s.runPlan(true) : useStore.setState({ time: 0, playing: true, peak: false, view: 'baseline' }))}>
          <Icon name="play" size={14} />{s.running ? 'Simulating…' : 'Run storm'}{stale && <i className="dot" title="Plan changed since the last run" />}
        </button>
        <button className="btn" disabled={!!s.busy} onClick={() => s.recommend('fresh')}>Recommend</button>
        <button className="btn accent" disabled={!!s.busy} onClick={() => s.runShowdown()}>Budget showdown</button>
      </div>
    </header>
  );
}

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'inspect', icon: 'inspect', label: 'Inspect', key: 'V' },
  { id: 'drain', icon: 'drain', label: CATALOG.drain.name, key: '1' },
  { id: 'garden', icon: 'garden', label: CATALOG.garden.name, key: '2' },
  { id: 'rwh', icon: 'rwh', label: CATALOG.rwh.name, key: '3' },
  { id: 'pit', icon: 'pit', label: CATALOG.pit.name, key: '4' },
  { id: 'desilt', icon: 'desilt', label: CATALOG.desilt.name, key: '5' },
  { id: 'erase', icon: 'erase', label: 'Remove', key: 'X' },
];

export function Toolbar() {
  const tool = useStore(s => s.tool), undo = useStore(s => s.undo), canUndo = useStore(s => s.undoStack.length > 0);
  const info = tool !== 'inspect' && tool !== 'erase' ? CATALOG[tool] : null;
  return (
    <>
      <aside className="toolbar" aria-label="Tools">
        {TOOLS.map(t => (
          <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => useStore.setState({ tool: t.id, draft: null })} title={`${t.label} (${t.key})`}
            style={t.id !== 'inspect' && t.id !== 'erase' ? { ['--tc' as string]: CATALOG[t.id as InterventionType].color } : undefined}>
            <Icon name={t.icon} /><kbd>{t.key}</kbd>
          </button>
        ))}
        <hr />
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
      </aside>
      {info && (
        <div className="toolhint" style={{ ['--tc' as string]: info.color }}>
          <b>{info.name}</b><span className="cost">{info.unit}</span>
          <p>{info.blurb}</p>
          <small>{tool === 'drain' ? 'Drag on the map to draw. ' : tool === 'rwh' ? 'Click a roof. ' : tool === 'desilt' ? 'Click a brown roadside drain. ' : 'Click open ground. '}Green preview = allowed, red = not allowed. Esc to stop.</small>
        </div>
      )}
      {tool === 'erase' && <div className="toolhint"><b>Remove</b><p>Click an intervention (or a roof with rainwater harvesting) to remove it.</p></div>}
    </>
  );
}

export function MapLegend() {
  const s = useStore(useShallow(st => ({ overlay: st.overlay, showLabels: st.showLabels, showDrains: st.showDrains, set: st.set })));
  return (
    <div className="maplegend">
      <div className="lg-title">Water depth</div>
      <div className="ramp"><i /><span>1 cm</span><span>20 cm</span><span>45 cm+</span></div>
      <div className="lg-title">Buildings</div>
      <div className="swatches"><span><i style={{ background: '#ef4444' }} />water above plinth</span><span><i style={{ background: '#f59e0b' }} />water at the door</span></div>
      <div className="lg-title">Drains</div>
      <div className="swatches"><span><i style={{ background: '#5f4c34' }} />silted, idle</span><span><i style={{ background: '#38bdf8' }} />flowing</span><span><i style={{ background: '#fb923c' }} />full</span><span><i style={{ background: '#ef4444' }} />overflowing</span></div>
      <div className="toggles">
        <label><input type="checkbox" checked={s.overlay === 'risk'} onChange={e => s.set({ overlay: e.target.checked ? 'risk' : 'none' })} />Risk heat-map</label>
        <label><input type="checkbox" checked={s.overlay === 'sources'} onChange={e => s.set({ overlay: e.target.checked ? 'sources' : 'none' })} />Data sources <em>violet = synthetic</em></label>
        <label><input type="checkbox" checked={s.showLabels} onChange={e => s.set({ showLabels: e.target.checked })} />Labels</label>
        <label><input type="checkbox" checked={s.showDrains} onChange={e => s.set({ showDrains: e.target.checked })} />Drains</label>
      </div>
    </div>
  );
}

export function Toast() {
  const t = useStore(s => s.toast);
  return t ? <div className={`toast ${t.kind}`} role="status">{t.msg}</div> : null;
}

export function Onboarding() {
  const open = useStore(s => s.onboarding), site = useStore(s => s.site);
  if (!open) return null;
  const close = () => { try { localStorage.setItem('hydra-onboarded', '1'); } catch { /* private mode */ } useStore.setState({ onboarding: false }); };
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Welcome to HYDRA">
        <h2><Icon name="drop" size={22} /> HYDRA</h2>
        <p className="lead">Every monsoon, the same streets go under. HYDRA shows <b>why</b>, and where a limited budget does the most good.</p>
        <ol>
          <li><b>See the flood.</b> {site ? `${site.name}, ${site.city}` : 'A real neighbourhood'} is built from OpenStreetMap and AWS open terrain data. Press <kbd>Run storm</kbd> to watch rain, silted drains and low spots in action.</li>
          <li><b>Fix it within budget.</b> Draw drains, add rain gardens, rooftop rainwater harvesting, recharge pits or drain desilting. Every one changes the physics.</li>
          <li><b>Compare.</b> Re-run the same storm, let <kbd>Recommend</kbd> spend the budget for you, and use <kbd>Budget showdown</kbd> to pit a data-driven plan against spending the same money evenly.</li>
        </ol>
        <p className="fine">Simplified, transparent models with stated assumptions; not an engineering design tool. Synthetic data is labelled.</p>
        <button className="btn primary" onClick={close}>Start exploring</button>
      </div>
    </div>
  );
}
