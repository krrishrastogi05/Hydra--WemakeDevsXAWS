// Top bar, tool palette, budget meter, legend, toasts and the first-run guide.
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, planKey, type Mode, type Tool } from '../store';
import { useBackend } from '../api';
import { isCustomSite } from '../shared/area';
import { useHeat } from '../heatStore';
import { HEAT_CATALOG } from '../sim/heat/model';
import { HEAT_TOOLS, HeatControls, HeatLegend, heatToolHow } from './heat/HeatChrome';
import { fmtINR } from '../sim/grid';
import { CATALOG, STORMS, planCost } from '../sim/flood/model';
import type { InterventionType } from '../sim/flood/types';

/** Secondary tab strip inside a panel tab, for splitting a long data view into short, scannable sections. */
export function SubTabs<K extends string>({ tabs, active, onChange }: { tabs: readonly { id: K; label: string }[]; active: K; onChange: (id: K) => void }) {
  return <div className="subtabs">{tabs.map(t => <button key={t.id} className={active === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>{t.label}</button>)}</div>;
}

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
    sun: <><circle cx="10" cy="10" r="3.6" /><path d="M10 2v2m0 12v2M2 10h2m12 0h2M4.3 4.3l1.4 1.4m8.6 8.6l1.4 1.4M4.3 15.7l1.4-1.4m8.6-8.6l1.4-1.4" /></>,
    tree: <><path d="M10 18v-6" /><path d="M10 2.5c3.5 0 6 2.6 6 5.6 0 2.6-2.5 4.2-6 4.2s-6-1.6-6-4.2c0-3 2.5-5.6 6-5.6z" /></>,
    canopy: <><path d="M2.5 8L10 4l7.5 4z" /><path d="M5 8v9m10-9v9" /></>,
    walkway: <><path d="M3 7h14" /><path d="M4 7v9m6-9v9m6-9v9" /><path d="M2 17h16" /></>,
    coolroof: <><path d="M3 10l7-6 7 6" /><path d="M5 9v8h10V9" /><path d="M13 2.5l1-1m2 3l1.3-.3M16 6l1 1" /></>,
    doc: <><path d="M5 2.5h7l3.5 3.5v11.5h-10.5z" /><path d="M12 2.5V6h3.5M7.5 10h5m-5 3h5" /></>,
    link: <><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1" /><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1" /></>,
    plus: <path d="M10 4v12M4 10h12" />,
  };
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[name]}</svg>;
}

const BUDGETS = [10e5, 25e5, 50e5, 75e5, 1e7, 2e7];

function ModeSwitch() {
  const mode = useStore(s => s.mode), setMode = useStore(s => s.setMode);
  const opt = (m: Mode, icon: string, label: string, hint: string) => (
    <button className={`m-${m}${mode === m ? ' on' : ''}`} onClick={() => setMode(m)} title={hint} aria-pressed={mode === m}><Icon name={icon} size={15} />{label}</button>
  );
  return (
    <div className="modes" role="group" aria-label="Simulation mode">
      {opt('flood', 'drop', 'Flood', 'Monsoon flooding: storms, drains, rain gardens')}
      {opt('heat', 'sun', 'Heat', 'Urban heat: sun, shade, trees and canopies')}
    </div>
  );
}

function FloodControls() {
  // subscribe to just what the bar shows, so playback ticks do not re-render it
  const s = useStore(useShallow(st => ({ stormId: st.stormId, setStorm: st.setStorm, antecedent: st.antecedent, setAntecedent: st.setAntecedent,
    budget: st.budget, setBudget: st.setBudget, grid: st.grid, plan: st.plan, currentKey: st.currentKey, running: st.running, runPlan: st.runPlan, busy: st.busy, recommend: st.recommend, runShowdown: st.runShowdown })));
  const stale = s.plan.length > 0 && planKey(s.plan) !== s.currentKey;
  const spent = s.grid ? planCost(s.grid, s.plan) : 0;
  return (
    <>
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
      <button className="btn" disabled={!!s.busy} onClick={() => s.recommend()} title={s.plan.length ? 'Build on your current plan with the budget that is left' : `Let HYDRA plan ${fmtINR(s.budget)}`}>Recommend</button>
      <button className="btn accent" disabled={!!s.busy} onClick={() => s.runShowdown()}>Budget showdown</button>
    </>
  );
}

export function TopBar() {
  const s = useStore(useShallow(st => ({ sites: st.sites, siteId: st.siteId, loadSite: st.loadSite, mode: st.mode, grid: st.grid })));
  const backend = useBackend(st => st.status);
  // the demo cities, plus the user's own area while it is open (the rest are listed in the Add area dialog)
  const shown = s.sites.filter(x => !isCustomSite(x.id) || x.id === s.siteId);
  return (
    <header className="topbar">
      <div className="logo"><Icon name={s.mode === 'heat' ? 'sun' : 'drop'} size={20} /><b>HYDRA</b><span>Climate-resilient city simulator</span></div>
      <nav className="cities" aria-label="Neighbourhood">
        {shown.map(x => (
          <button key={x.id} className={`${x.id === s.siteId ? 'on' : ''}${isCustomSite(x.id) ? ' custom' : ''}`} onClick={() => x.id !== s.siteId && s.loadSite(x.id)} title={x.blurb}>
            {x.city || 'Your area'}<small>{x.name.split(',')[0]}</small>
          </button>
        ))}
        {backend === 'up' && (
          <button className="add" onClick={() => useStore.setState({ addArea: true })} title="Build any neighbourhood in India from OpenStreetMap and AWS terrain data">
            <span><Icon name="plus" size={13} /> Area</span><small>anywhere in India</small>
          </button>
        )}
      </nav>
      {s.grid && <ModeSwitch />}
      <div className="controls">{s.mode === 'flood' ? <FloodControls /> : <HeatControls />}</div>
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
  const mode = useStore(s => s.mode), tool = useStore(s => s.tool);
  const floodUndo = useStore(s => s.undo), floodCan = useStore(s => s.undoStack.length > 0);
  const heatUndo = useHeat(s => s.undo), heatCan = useHeat(s => s.undoStack.length > 0);
  const [undo, canUndo] = mode === 'flood' ? [floodUndo, floodCan] : [heatUndo, heatCan];
  const tools: { id: Tool; icon: string; label: string; key: string; color?: string }[] = [
    { id: 'inspect', icon: 'inspect', label: 'Inspect', key: 'V' },
    ...(mode === 'flood' ? TOOLS.slice(1, -1).map(t => ({ ...t, color: CATALOG[t.id as InterventionType].color }))
      : HEAT_TOOLS.map(t => ({ id: t.id, icon: t.icon, label: HEAT_CATALOG[t.id].name, key: t.key, color: HEAT_CATALOG[t.id].color }))),
    { id: 'erase', icon: 'erase', label: 'Remove', key: 'X' },
  ];
  const info = mode === 'flood' ? (tool in CATALOG ? CATALOG[tool as InterventionType] : null) : (tool in HEAT_CATALOG ? HEAT_CATALOG[tool as keyof typeof HEAT_CATALOG] : null);
  const how = mode === 'flood'
    ? (tool === 'drain' ? 'Drag on the map to draw. ' : tool === 'rwh' ? 'Click a roof. ' : tool === 'desilt' ? 'Click a brown roadside drain. ' : 'Click open ground. ')
    : (tool in heatToolHow ? heatToolHow[tool as keyof typeof heatToolHow] : '');
  return (
    <>
      <aside className="toolbar" aria-label="Tools">
        {tools.map(t => (
          <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => useStore.setState({ tool: t.id, draft: null })} title={`${t.label} (${t.key})`}
            style={t.color ? { ['--tc' as string]: t.color } : undefined}>
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
          <small>{how}Green preview = allowed, red = not allowed. Esc to stop.</small>
        </div>
      )}
      {tool === 'erase' && <div className="toolhint"><b>Remove</b><p>{mode === 'flood' ? 'Click an intervention (or a roof with rainwater harvesting) to remove it.' : 'Click a planned tree, canopy or walkway (or a cool roof) to remove it.'}</p></div>}
    </>
  );
}

export function MapLegend() {
  const mode = useStore(s => s.mode);
  return mode === 'flood' ? <FloodLegend /> : <HeatLegend />;
}

function FloodLegend() {
  const s = useStore(useShallow(st => ({ overlay: st.overlay, showLabels: st.showLabels, showDrains: st.showDrains, set: st.set })));
  return (
    <div className="maplegend">
      <div className="lg-title">Water depth</div>
      <div className="ramp"><i /><span>1 cm</span><span>20 cm</span><span>45 cm+</span></div>
      <div className="lg-title">Buildings</div>
      <div className="swatches"><span><i style={{ background: '#d64545' }} />water above plinth</span><span><i style={{ background: '#e0a030' }} />water at the door</span></div>
      <div className="lg-title">Drains</div>
      <div className="swatches"><span><i style={{ background: '#2b2620', boxShadow: 'inset 0 0 0 1px #86837c' }} />silted, idle</span><span><i style={{ background: '#38bdf8' }} />flowing</span><span><i style={{ background: '#fb923c' }} />full</span><span><i style={{ background: '#ef4444' }} />overflowing</span></div>
      <div className="toggles">
        <label><input type="checkbox" checked={s.overlay === 'risk'} onChange={e => s.set({ overlay: e.target.checked ? 'risk' : 'none' })} />Risk heat-map</label>
        <label><input type="checkbox" checked={s.overlay === 'sources'} onChange={e => s.set({ overlay: e.target.checked ? 'sources' : 'none' })} />Data sources <em>violet = synthetic</em></label>
        <label><input type="checkbox" checked={s.showLabels} onChange={e => s.set({ showLabels: e.target.checked })} />Labels</label>
        <label><input type="checkbox" checked={s.showDrains} onChange={e => s.set({ showDrains: e.target.checked })} />Drains</label>
      </div>
      <GraphicsToggle />
    </div>
  );
}

/** High = ambient occlusion, anti-aliasing, outlines, sharper ground; Low = lighter for older laptops. */
export function GraphicsToggle() {
  const quality = useStore(s => s.quality), setQuality = useStore(s => s.setQuality);
  return (
    <div className="gfx" role="group" aria-label="Graphics quality">
      <span>Graphics</span>
      {(['high', 'low'] as const).map(q => <button key={q} className={quality === q ? 'on' : ''} onClick={() => setQuality(q)}>{q === 'high' ? 'High' : 'Low'}</button>)}
    </div>
  );
}

export function Toast() {
  const t = useStore(s => s.toast);
  return t ? <div className={`toast ${t.kind}`} role="status">{t.msg}</div> : null;
}

export function Onboarding() {
  const open = useStore(s => s.onboarding), site = useStore(s => s.site), setMode = useStore(s => s.setMode);
  if (!open) return null;
  const close = (mode?: Mode) => { try { localStorage.setItem('hydra-onboarded', '1'); } catch { /* private mode */ } useStore.setState({ onboarding: false }); if (mode) setMode(mode); };
  return (
    <div className="modal-back" onClick={() => close()}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Welcome to HYDRA">
        <h2><Icon name="drop" size={22} /> HYDRA</h2>
        <p className="lead">Test climate fixes in a real Indian neighbourhood before spending real money. {site ? `${site.name}, ${site.city}` : 'Each area'} is built from OpenStreetMap and AWS open terrain data.</p>
        <div className="modecards">
          <button className="modecard m-flood" onClick={() => close('flood')}>
            <b><Icon name="drop" /> Flood</b>
            <span>Run a monsoon storm, see where water collects and why, then add drains, rain gardens, harvesting, recharge pits or desilting.</span>
          </button>
          <button className="modecard m-heat" onClick={() => close('heat')}>
            <b><Icon name="sun" /> Heat</b>
            <span>Trace the sun through a hot day, find bus stops, markets and streets with no shade, then plant trees or add canopies.</span>
          </button>
        </div>
        <p className="fine">In both modes: re-run the same conditions to compare, let <kbd>Recommend</kbd> spend a fixed budget, and use <kbd>Budget showdown</kbd> to compare a data-driven plan with spending the same money evenly. Switch any time with the toggle at the top (or <kbd>H</kbd>). The two modes use separate models, plans and budgets. Both are simplified, transparent models with stated assumptions, not engineering design tools. Synthetic data is labelled.</p>
      </div>
    </div>
  );
}
