import { useEffect } from 'react';
import { useStore, type Tool } from './store';
import { Scene } from './three/Scene';
import { MapLegend, Onboarding, Toast, Toolbar, TopBar } from './ui/Chrome';
import { SidePanel } from './ui/Panel';
import { Inspector, Timeline } from './ui/Timeline';
import { useHeat } from './heatStore';
import { HeatInspector, HeatTimeline } from './ui/heat/HeatTimeline';
import { DAY_START } from './sim/heat/model';

const KEYS: Record<string, Tool> = { '1': 'drain', '2': 'garden', '3': 'rwh', '4': 'pit', '5': 'desilt', v: 'inspect', x: 'erase' };
const HEAT_KEYS: Record<string, Tool> = { '1': 'tree', '2': 'canopy', '3': 'walkway', '4': 'coolroof', v: 'inspect', x: 'erase' };

export default function App() {
  const loading = useStore(s => s.loading), error = useStore(s => s.error), ready = useStore(s => !!s.grid && !!s.baseline), mode = useStore(s => s.mode);
  const heatLoading = useHeat(s => s.loading);
  useEffect(() => { useStore.getState().init(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const s = useStore.getState(), h = useHeat.getState(), heat = s.mode === 'heat';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (heat) h.undo(); else s.undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase(), keys = heat ? HEAT_KEYS : KEYS;
      if (keys[k]) useStore.setState({ tool: keys[k], draft: null });
      else if (k === 'escape') useStore.setState({ tool: 'inspect', draft: null, selection: null });
      else if (k === 'h') s.setMode(heat ? 'flood' : 'heat');
      else if (heat) {
        if (k === ' ') { e.preventDefault(); useHeat.setState({ playing: !h.playing, summary: false, ...(h.summary ? { hour: DAY_START } : {}) }); }
        else if (k === 'p') useHeat.setState({ summary: !h.summary, playing: false });
        else if (k === 'r' && !h.running && h.plan.length) h.runPlan(true);
      }
      else if (k === ' ') { e.preventDefault(); useStore.setState({ playing: !s.playing, peak: false, ...(s.peak ? { time: 0 } : {}) }); }
      else if (k === 'p') useStore.setState({ peak: !s.peak, playing: false });
      else if (k === 'r' && !s.running) { if (s.plan.length) s.runPlan(true); else useStore.setState({ time: 0, playing: true, peak: false }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="app" data-mode={mode}>
      <div className="stage"><Scene /></div>
      <TopBar />
      {ready && (
        <>
          <Toolbar />
          <SidePanel />
          {mode === 'flood' ? <><Timeline /><Inspector /></> : <><HeatTimeline /><HeatInspector /></>}
          <MapLegend />
        </>
      )}
      <Toast />
      {ready && <Onboarding />}
      {(loading || error) && <div className="loader"><div className="drop" /><p>{error ?? loading}</p></div>}
      {!loading && !error && mode === 'heat' && heatLoading && <div className="loader soft"><div className="drop sun" /><p>Tracing the sun across the neighbourhood…</p></div>}
    </div>
  );
}
