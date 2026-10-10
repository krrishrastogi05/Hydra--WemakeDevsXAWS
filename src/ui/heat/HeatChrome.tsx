// Heat mode's top-bar controls, tool list and map legend. Same layout as flood mode, different content.
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { heatPlanKey, useHeat } from '../../heatStore';
import { fmtINR } from '../../sim/grid';
import { HEAT_CATALOG, HEAT_PARAMS, HEAT_SCENARIOS, HEAT_WINDOWS, heatPlanCost } from '../../sim/heat/model';
import type { HeatInterventionType } from '../../sim/heat/types';
import { exposureColor } from '../../three/heat/HeatLayer';
import { GraphicsToggle, Icon } from '../Chrome';

export const HEAT_BUDGETS = [5e5, 10e5, 25e5, 50e5, 1e7];

export function HeatControls() {
  const grid = useStore(s => s.grid);
  const s = useHeat(useShallow(st => ({ scenarioId: st.scenarioId, setScenario: st.setScenario, windowId: st.windowId, setWindow: st.setWindow, budget: st.budget, setBudget: st.setBudget,
    plan: st.plan, currentKey: st.currentKey, running: st.running, runPlan: st.runPlan, busy: st.busy, recommend: st.recommend, runShowdown: st.runShowdown, ready: !!st.baseline })));
  const stale = s.plan.length > 0 && heatPlanKey(s.plan) !== s.currentKey;
  const spent = grid ? heatPlanCost(grid, s.plan) : 0;
  return (
    <>
      <label>Day<select value={s.scenarioId} onChange={e => s.setScenario(e.target.value)}>{HEAT_SCENARIOS.map(x => <option key={x.id} value={x.id}>{x.name} · {x.tempC} °C / {x.rh} %</option>)}</select></label>
      <label>Hours<select value={s.windowId} onChange={e => s.setWindow(e.target.value)}>{HEAT_WINDOWS.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>Budget<select value={s.budget} onChange={e => s.setBudget(+e.target.value)}>{HEAT_BUDGETS.map(b => <option key={b} value={b}>{fmtINR(b)}</option>)}</select></label>
      <div className="meter" title={`${fmtINR(spent)} of ${fmtINR(s.budget)} committed`}>
        <div className="meter-bar">{(Object.keys(HEAT_CATALOG) as HeatInterventionType[]).map(t => {
          const v = grid ? heatPlanCost(grid, s.plan.filter(p => p.type === t)) : 0;
          return v ? <i key={t} style={{ width: `${(v / s.budget) * 100}%`, background: HEAT_CATALOG[t].color }} /> : null;
        })}</div>
        <span>{fmtINR(spent)} <em>/ {fmtINR(s.budget)}</em></span>
      </div>
      <button className="btn primary" disabled={s.running || !s.ready} onClick={() => (s.plan.length ? s.runPlan(true) : useHeat.setState({ summary: false, hour: 7, playing: true, view: 'baseline' }))}>
        <Icon name="play" size={14} />{s.running ? 'Tracing…' : s.plan.length ? 'Run the day' : 'Play the day'}{stale && <i className="dot" title="Plan changed since the last run" />}
      </button>
      <button className="btn" disabled={!!s.busy || !s.ready} onClick={() => s.recommend('fresh')}>Recommend</button>
      <button className="btn accent" disabled={!!s.busy || !s.ready} onClick={() => s.runShowdown()}>Budget showdown</button>
    </>
  );
}

export const HEAT_TOOLS: { id: HeatInterventionType; icon: string; key: string }[] = [
  { id: 'tree', icon: 'tree', key: '1' }, { id: 'canopy', icon: 'canopy', key: '2' }, { id: 'walkway', icon: 'walkway', key: '3' }, { id: 'coolroof', icon: 'coolroof', key: '4' },
];
export const heatToolHow: Record<HeatInterventionType, string> = {
  tree: 'Click open ground, paving or a park next to the street. ', canopy: 'Click a bus stop, market or gate (or any street cell). ',
  walkway: 'Drag along a footpath. ', coolroof: 'Click a roof. ',
};

export function HeatLegend() {
  const s = useStore(useShallow(st => ({ overlay: st.overlay, showLabels: st.showLabels, set: st.set })));
  const h = useHeat(useShallow(st => ({ overlay: st.overlay, summary: st.summary })));
  const ramp = [30, 47, 63, 80].map(v => `rgb(${exposureColor(v).join(',')})`).join(', ');
  return (
    <div className="maplegend">
      {h.summary ? (
        <>
          <div className="lg-title">Pedestrian heat exposure (index)</div>
          <div className="ramp heat"><i style={{ background: `linear-gradient(90deg, ${ramp})` }} /><span>mild</span><span>{HEAT_PARAMS.moderate}</span><span>{HEAT_PARAMS.high}+ high</span></div>
        </>
      ) : (
        <>
          <div className="lg-title">Sun and shade at this hour</div>
          <div className="swatches"><span><i style={{ background: '#ffc45c' }} />direct sun</span><span><i style={{ background: '#1e4078' }} />shade</span></div>
        </>
      )}
      <div className="lg-title">Places people wait</div>
      <div className="swatches"><span><i style={{ background: '#ef4444' }} />high</span><span><i style={{ background: '#f59e0b' }} />moderate</span><span><i style={{ background: '#22c55e' }} />lower</span></div>
      <div className="lg-title">Shade</div>
      <div className="swatches"><span><i style={{ background: '#3f7d3a' }} />tree</span><span><i style={{ background: '#4ade80' }} />planned tree</span><span><i style={{ background: '#e9a23b' }} />canopy</span><span><i style={{ background: '#f8fbff' }} />cool roof</span></div>
      <div className="toggles">
        <label><input type="checkbox" checked={h.overlay === 'exposure'} onChange={e => useHeat.setState({ overlay: e.target.checked ? 'exposure' : 'none' })} />Exposure / shade map</label>
        <label><input type="checkbox" checked={s.overlay === 'sources'} onChange={e => s.set({ overlay: e.target.checked ? 'sources' : 'none' })} />Data sources <em>violet = synthetic</em></label>
        <label><input type="checkbox" checked={s.showLabels} onChange={e => s.set({ showLabels: e.target.checked })} />Labels</label>
      </div>
      <GraphicsToggle />
    </div>
  );
}
