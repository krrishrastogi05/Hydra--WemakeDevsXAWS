// Playback bar and the hover / click inspector.
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, planKey } from '../store';
import { fmtINR } from '../sim/grid';
import { CATALOG, PARAMS, costOf, tankSize } from '../sim/flood/model';
import { COVER_NAMES } from '../sim/types';
import { placeName } from '../sim/flood/optimizer';
import { DEPTH } from '../sim/flood/engine';
import { Icon } from './Chrome';
import { RainStrip } from './charts';

export function Timeline() {
  const s = useStore(useShallow(st => ({ playing: st.playing, peak: st.peak, time: st.time, speed: st.speed, view: st.view, baseline: st.baseline, current: st.current, currentKey: st.currentKey, plan: st.plan, storm: st.stormId })));
  const res = (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline;
  const end = res ? res.frameTimes[res.nFrames - 1] : 0;
  const hasPlanRun = !!s.current && s.currentKey !== '' && s.current !== s.baseline;
  useEffect(() => {
    if (!s.playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const st = useStore.getState(), t = Math.min(end, st.time + (now - last) / 1000 * 12 * st.speed);   // 12 storm-minutes per second at 1x
      last = now;
      useStore.setState({ time: t, ...(t >= end ? { playing: false, peak: true } : {}) });
      if (t < end) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [s.playing, end]);
  if (!res) return null;
  const step = res.nFrames > 1 ? res.frameTimes[1] - res.frameTimes[0] : 1, k = Math.min(res.nFrames - 1, Math.round(s.time / step));
  const rain = s.peak ? 0 : res.rainSeries[k], hh = Math.floor(s.time / 60), mm = Math.floor(s.time % 60);
  const play = () => useStore.setState({ playing: !s.playing, peak: false, ...(s.time >= end || s.peak ? { time: 0 } : {}) });
  return (
    <div className="timeline">
      <button className="btn primary round" onClick={play} aria-label={s.playing ? 'Pause' : 'Play the storm'}><Icon name={s.playing ? 'pause' : 'play'} size={16} /></button>
      <div className="ab" role="group" aria-label="Which result to show">
        <button className={s.view === 'baseline' ? 'on' : ''} onClick={() => useStore.setState({ view: 'baseline' })}>No action</button>
        <button className={s.view === 'plan' ? 'on' : ''} disabled={!hasPlanRun} onClick={() => useStore.setState({ view: 'plan' })} title={hasPlanRun ? '' : 'Add interventions and press Run storm'}>
          Your plan{hasPlanRun && planKey(s.plan) !== s.currentKey ? ' (outdated)' : ''}
        </button>
      </div>
      <button className={`btn ghost${s.peak ? ' on' : ''}`} onClick={() => useStore.setState({ peak: !s.peak, playing: false })} title="Show the deepest water each place reached">Peak</button>
      <div className="scrub">
        <RainStrip times={res.frameTimes} rain={res.rainSeries} now={s.peak ? end : s.time} end={end} />
        <input type="range" min={0} max={end} step={0.5} value={s.peak ? end : s.time} aria-label="Storm time"
          onChange={e => useStore.setState({ time: +e.target.value, peak: false, playing: false })} />
      </div>
      <div className="clock">
        <b>{s.peak ? 'Peak flood' : `T+${hh}:${String(mm).padStart(2, '0')}`}</b>
        <span>{s.peak ? 'deepest water reached' : rain > 0 ? `raining ${Math.round(rain)} mm/h` : s.time > 0 ? 'rain stopped, draining' : 'press play'}</span>
      </div>
      <select value={s.speed} onChange={e => useStore.setState({ speed: +e.target.value })} aria-label="Playback speed"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
    </div>
  );
}

const cm = (m: number) => `${Math.round(m * 100)} cm`;

export function Inspector() {
  const s = useStore(useShallow(st => ({ hover: st.hover, selection: st.selection, grid: st.grid, baseline: st.baseline, current: st.current, currentKey: st.currentKey, plan: st.plan, tool: st.tool })));
  const g = s.grid;
  if (!g || !s.baseline) return null;
  // what is under the pointer always wins; a pinned (clicked) item shows when the pointer is off the map
  const hovered = s.hover ? (s.hover.building >= 0 ? { kind: 'building' as const, building: s.hover.building } : s.hover.cell >= 0 ? { kind: 'cell' as const, cell: s.hover.cell } : null) : null;
  const target = hovered ?? s.selection;
  if (!target) return <div className="inspector muted">Hover the map to inspect a street, drain or building. Click to pin.<br /><small>Drag to rotate · Shift-drag or right-drag to pan · Hold Space and move the mouse to pan · Scroll to zoom</small></div>;
  const plan = s.current && s.currentKey ? s.current : null, pinned = !hovered && !!s.selection;
  const close = pinned ? <button className="x" onClick={() => useStore.setState({ selection: null })} aria-label="Unpin"><Icon name="close" size={14} /></button> : null;
  const cmp = (label: string, a: number, b: number | null, fmt: (v: number) => string, lowerBetter = true) => (
    <div className="kv"><span>{label}</span><b>{fmt(a)}{b != null && Math.abs(b - a) > 1e-6 && <em className={(b < a) === lowerBetter ? 'good' : 'bad'}> → {fmt(b)}</em>}</b></div>
  );
  if (target.kind === 'building') {
    const k = target.building, b = g.site.buildings[k], base = s.baseline.doorstep[k], after = plan ? plan.doorstep[k] : null;
    const status = (d: number) => (d > b.plinth ? 'water enters (above plinth)' : d > DEPTH.wet ? 'water at the door' : 'stays dry');
    const rwh = s.plan.find(p => p.type === 'rwh' && p.building === k), roof = g.bCells[k].length * g.A;
    return (
      <div className="inspector">
        <div className="ins-head"><b>{b.name || `${b.use} building`}</b>{close}</div>
        <div className="tags"><span>{b.levels} floor{b.levels > 1 ? 's' : ''}{b.levelsSynthetic ? '*' : ''}</span><span>{b.synthetic ? 'synthetic footprint' : 'OpenStreetMap'}</span>{b.critical && <span className="crit">critical facility</span>}</div>
        {cmp('Water at the door (peak)', base, after, cm)}
        <div className="kv"><span>Plinth height*</span><b>{cm(b.plinth)}</b></div>
        <div className="kv"><span>Status</span><b className={base > b.plinth ? 'bad' : base > DEPTH.wet ? 'warn' : 'good'}>{status(after ?? base)}</b></div>
        {b.residents > 0 && <div className="kv"><span>Residents (estimate)*</span><b>{b.residents}</b></div>}
        <div className="kv"><span>Roof area</span><b>{Math.round(roof)} m²</b></div>
        <div className="kv"><span>Rooftop harvesting</span><b>{rwh ? `installed · ${tankSize(roof).toFixed(1)} m³ tank` : `${fmtINR(costOf(g, { id: 'x', type: 'rwh', building: k }))} for a ${tankSize(roof).toFixed(1)} m³ tank`}</b></div>
        <small>* synthetic or estimated, see About</small>
      </div>
    );
  }
  const c = target.cell, cv = g.cover[c], unit = g.drain[c], u = unit >= 0 ? g.site.drains.find(d => d.id === unit) : undefined;
  const desilted = s.plan.some(p => p.type === 'desilt' && p.unit === unit);
  const here = s.plan.filter(p => p.cells?.includes(c));
  return (
    <div className="inspector">
      <div className="ins-head"><b>{COVER_NAMES[cv]}</b>{close}</div>
      <div className="tags"><span>{placeName(g, c)}</span><span>{(g.site.zBase + g.z[c]).toFixed(1)} m above sea level</span></div>
      {cmp('Peak water on the street', s.baseline.maxDepth[c], plan ? plan.maxDepth[c] : null, cm)}
      {cmp('Time above 15 cm', s.baseline.timeOver[c], plan ? plan.timeOver[c] : null, v => `${Math.round(v)} min`)}
      {cmp('Runoff passing this spot', s.baseline.throughVol[c], plan ? plan.throughVol[c] : null, v => `${Math.round(v).toLocaleString('en-IN')} m³`)}
      {u && <div className="kv"><span>Roadside drain</span><b>{desilted ? 'desilted' : `${Math.round(u.silt * 100)} % silted`} · design {u.cap.toFixed(2)} m³/s</b></div>}
      {u && <div className="kv"><span>Peak load (no action)</span><b className={s.baseline.drainPeak[c] >= 2 ? 'bad' : s.baseline.drainPeak[c] > 0.9 ? 'warn' : ''}>{s.baseline.drainPeak[c] >= 2 ? 'overflowing' : `${Math.round(s.baseline.drainPeak[c] * 100)} % of capacity`}</b></div>}
      {here.map(p => <div key={p.id} className="kv"><span>{CATALOG[p.type].name}</span><b>{fmtINR(costOf(g, p))}</b></div>)}
      {cv === 1 && !u && <small>No drain on this stretch. The drain tool can add one (₹6,000/m, {PARAMS.newDrainCap} m³/s).</small>}
    </div>
  );
}
