// Heat mode's playback bar (hour of the day) and the hover / click inspector that explains each spot's exposure.
import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { heatPlanKey, useHeat } from '../../heatStore';
import { fmtINR } from '../../sim/grid';
import { COVER_NAMES } from '../../sim/types';
import { DAY_END, DAY_START, HEAT_CATALOG, HEAT_PARAMS as P, HEAT_WINDOWS, SURFACE, heatCostOf } from '../../sim/heat/model';
import { heatPlaceName } from '../../sim/heat/optimizer';
import { roofTops } from '../../sim/heat/shadow';
import { frameIndex, indexColor } from '../../three/heat/HeatLayer';
import { Icon } from '../Chrome';
import { clock } from './HeatPanel';

const compass = (az: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8];

export function HeatTimeline() {
  const s = useHeat(useShallow(st => ({ playing: st.playing, summary: st.summary, hour: st.hour, speed: st.speed, view: st.view, baseline: st.baseline, current: st.current, currentKey: st.currentKey, plan: st.plan, windowId: st.windowId })));
  const res = (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline;
  const win = HEAT_WINDOWS.find(w => w.id === s.windowId)!;
  const hasPlanRun = !!s.current && s.currentKey !== '' && s.current !== s.baseline;
  useEffect(() => {
    if (!s.playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const st = useHeat.getState(), h = Math.min(DAY_END, st.hour + (now - last) / 1000 * 1.2 * st.speed);   // 1.2 hours per second at 1x
      last = now;
      useHeat.setState({ hour: h, ...(h >= DAY_END ? { playing: false, summary: true } : {}) });
      if (h < DAY_END) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [s.playing]);
  const maxElev = useMemo(() => Math.max(1, ...(res?.steps.map(x => x.elev) ?? [1])), [res]);
  if (!res) return null;
  const step = res.steps[frameIndex(res, s.hour)];
  const play = () => useHeat.setState({ playing: !s.playing, summary: false, ...(s.hour >= DAY_END - 0.01 || s.summary ? { hour: DAY_START } : {}) });
  const span = DAY_END - DAY_START;
  return (
    <div className="timeline">
      <button className="btn primary round" onClick={play} aria-label={s.playing ? 'Pause' : 'Play the day'}><Icon name={s.playing ? 'pause' : 'play'} size={16} /></button>
      <div className="ab" role="group" aria-label="Which result to show">
        <button className={s.view === 'baseline' ? 'on' : ''} onClick={() => useHeat.setState({ view: 'baseline' })}>No action</button>
        <button className={s.view === 'plan' ? 'on' : ''} disabled={!hasPlanRun} onClick={() => useHeat.setState({ view: 'plan' })} title={hasPlanRun ? '' : 'Add shade and press Run the day'}>
          Your plan{hasPlanRun && heatPlanKey(s.plan) !== s.currentKey ? ' (outdated)' : ''}
        </button>
      </div>
      <button className={`btn ghost${s.summary ? ' on' : ''}`} onClick={() => useHeat.setState({ summary: !s.summary, playing: false })} title="Show the exposure index over the chosen hours">Exposure</button>
      <div className="scrub">
        <svg className="rainstrip sunstrip" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden>
          <rect x={((win.start - DAY_START) / span) * 100} y={0} width={((win.end - win.start) / span) * 100} height={20} className="win" />
          {res.steps.map((x, i) => <rect key={i} x={((x.hour - 0.25 - DAY_START) / span) * 100} y={20 - (Math.max(0, x.elev) / maxElev) * 19} width={100 / res.steps.length + 0.05} height={(Math.max(0, x.elev) / maxElev) * 19} className={!s.summary && x.hour <= s.hour ? 'past' : ''} />)}
        </svg>
        <input type="range" min={DAY_START} max={DAY_END} step={0.25} value={s.summary ? (win.start + win.end) / 2 : s.hour} aria-label="Time of day"
          onChange={e => useHeat.setState({ hour: +e.target.value, summary: false, playing: false })} />
      </div>
      <div className="clock">
        <b>{s.summary ? `${win.start}:00–${win.end}:00` : clock(s.hour)}</b>
        <span>{s.summary ? 'exposure over these hours' : step.elev > 0 ? `sun ${Math.round(step.elev)}° up, ${compass(step.az)}` : 'sun below the horizon'}</span>
      </div>
      <select value={s.speed} onChange={e => useHeat.setState({ speed: +e.target.value })} aria-label="Playback speed"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
    </div>
  );
}

export function HeatInspector() {
  const st = useStore(useShallow(x => ({ hover: x.hover, selection: x.selection, grid: x.grid })));
  const s = useHeat(useShallow(x => ({ heat: x.heat, baseline: x.baseline, current: x.current, currentKey: x.currentKey, plan: x.plan, summary: x.summary, hour: x.hour })));
  const g = st.grid;
  const roofs = useMemo(() => (g ? roofTops(g) : []), [g]);
  if (!g || !s.baseline || !s.heat) return null;
  const hovered = st.hover ? (st.hover.building >= 0 ? { kind: 'building' as const, building: st.hover.building } : st.hover.cell >= 0 ? { kind: 'cell' as const, cell: st.hover.cell } : null) : null;
  const target = hovered ?? st.selection;
  if (!target) return <div className="inspector muted">Hover the map to see how hot a street, stop or square gets and why. Click to pin. <button className="link tour-link" onClick={() => useStore.setState({ tour: 0 })}>New here? Take the tour</button><br /><small>Drag to rotate · Shift-drag or right-drag to pan · Hold Space and move the mouse (or press the arrow keys) to pan · Scroll to zoom</small></div>;
  const plan = s.current && s.currentKey ? s.current : null, pinned = !hovered && !!st.selection, b0 = s.baseline;
  const close = pinned ? <button className="x" onClick={() => useStore.setState({ selection: null })} aria-label="Unpin"><Icon name="close" size={14} /></button> : null;
  const cmp = (label: string, a: number, b: number | null, fmt: (v: number) => string, lowerBetter = true) => (
    <div className="kv"><span>{label}</span><b>{fmt(a)}{b != null && Math.abs(b - a) > 1e-6 && <em className={(b < a) === lowerBetter ? 'good' : 'bad'}> → {fmt(b)}</em>}</b></div>
  );
  if (target.kind === 'building') {
    const k = target.building, b = g.site.buildings[k], roof = g.bCells[k].length * g.A, cool = s.plan.find(p => p.type === 'coolroof' && p.building === k);
    const height = isFinite(roofs[k]) ? b.levels * P.storey + b.plinth : 0;
    return (
      <div className="inspector">
        <div className="ins-head"><b>{b.name || `${b.use} building`}</b>{close}</div>
        <div className="tags"><span>{b.levels} floor{b.levels > 1 ? 's' : ''}{b.levelsSynthetic ? '*' : ''}</span><span>{b.synthetic ? 'synthetic footprint' : 'OpenStreetMap'}</span></div>
        <div className="kv"><span>Height (casts shade)</span><b>{height.toFixed(1)} m</b></div>
        <div className="kv"><span>Roof area</span><b>{Math.round(roof)} m²</b></div>
        <div className="kv"><span>Cool roof</span><b>{cool ? 'planned · albedo 0.2 → 0.7' : `${fmtINR(heatCostOf(g, { id: 'x', type: 'coolroof', building: k }))} to coat`}</b></div>
        <small>Cool roofs cut heat absorbed by the building; they do not shade the street. * synthetic or estimated, see About</small>
      </div>
    );
  }
  const c = target.cell, cv = g.cover[c], r = plan ?? b0;
  const receptor = s.heat.receptors.find(x => x.cells.includes(c));
  const here = s.plan.filter(p => p.cells?.includes(c)), tree = s.heat.trees.find(t => t.cell === c);
  const k = frameIndex(r, s.hour), sunNow = r.frames ? r.frames[k * g.n + c] / 255 : null;
  if (cv === 2 || b0.weight[c] <= 0) return <div className="inspector"><div className="ins-head"><b>{COVER_NAMES[cv]}</b>{close}</div><small>Not pedestrian space, so it is not scored.</small></div>;
  const why: string[] = [];
  if (r.sunFrac[c] > 0.7) why.push('little shade in these hours'); else if (r.sunFrac[c] < 0.3) why.push('mostly shaded');
  if (SURFACE[cv] >= 0.8) why.push(cv === 1 ? 'dark asphalt heats up' : 'hard paving heats up');
  if (cv === 3) why.push('grass stays cooler');
  if (receptor) why.push(`many people wait here (${receptor.kind.replace('_', ' ')})`);
  return (
    <div className="inspector">
      <div className="ins-head"><b>{receptor ? receptor.name : COVER_NAMES[cv]}</b>{close}</div>
      <div className="tags"><span>{heatPlaceName(g, s.heat, c)}</span>{receptor?.synthetic && <span>synthetic place</span>}{tree && <span>{tree.synthetic ? 'synthetic tree' : 'OSM tree'}</span>}</div>
      <div className="kv"><span>Exposure index</span><b style={{ color: indexColor(r.exposure[c]) }}>{Math.round(b0.exposure[c])}{plan && Math.abs(plan.exposure[c] - b0.exposure[c]) > 0.05 && <em className={plan.exposure[c] < b0.exposure[c] ? 'good' : 'bad'}> → {Math.round(plan.exposure[c])}</em>}</b></div>
      {cmp('Direct sun in the window', b0.sunHours[c], plan ? plan.sunHours[c] : null, v => `${v.toFixed(1)} h`)}
      {cmp('Share of the sun that gets through', b0.sunFrac[c], plan ? plan.sunFrac[c] : null, v => `${Math.round(v * 100)}%`)}
      {cmp('Surface heating term', b0.surface[c], plan ? plan.surface[c] : null, v => v.toFixed(2))}
      <div className="kv"><span>Air (heat index, same everywhere)</span><b>{b0.heatIndexC.toFixed(1)} °C</b></div>
      {!s.summary && sunNow != null && <div className="kv"><span>At {clock(s.hour)}</span><b>{sunNow > 0.5 ? 'in direct sun' : sunNow > 0.05 ? 'dappled shade' : 'in shade'}</b></div>}
      <div className="kv"><span>Footfall weight</span><b>{b0.weight[c].toFixed(1)}</b></div>
      {here.map(p => <div key={p.id} className="kv"><span>{HEAT_CATALOG[p.type].name}</span><b>{fmtINR(heatCostOf(g, p))}</b></div>)}
      {why.length > 0 && <small>Why: {why.join('; ')}.</small>}
    </div>
  );
}
