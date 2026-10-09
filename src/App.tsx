import { useEffect } from 'react';
import { useStore, type Tool } from './store';
import { Scene } from './three/Scene';
import { MapLegend, Onboarding, Toast, Toolbar, TopBar } from './ui/Chrome';
import { SidePanel } from './ui/Panel';
import { Inspector, Timeline } from './ui/Timeline';

const KEYS: Record<string, Tool> = { '1': 'drain', '2': 'garden', '3': 'rwh', '4': 'pit', '5': 'desilt', v: 'inspect', x: 'erase' };

export default function App() {
  const loading = useStore(s => s.loading), error = useStore(s => s.error), ready = useStore(s => !!s.grid && !!s.baseline);
  useEffect(() => { useStore.getState().init(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); s.undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (KEYS[k]) useStore.setState({ tool: KEYS[k], draft: null });
      else if (k === 'escape') useStore.setState({ tool: 'inspect', draft: null, selection: null });
      else if (k === ' ') { e.preventDefault(); useStore.setState({ playing: !s.playing, peak: false, ...(s.peak ? { time: 0 } : {}) }); }
      else if (k === 'p') useStore.setState({ peak: !s.peak, playing: false });
      else if (k === 'r' && !s.running) { if (s.plan.length) s.runPlan(true); else useStore.setState({ time: 0, playing: true, peak: false }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="app">
      <div className="stage"><Scene /></div>
      <TopBar />
      {ready && (
        <>
          <Toolbar />
          <SidePanel />
          <Timeline />
          <Inspector />
          <MapLegend />
        </>
      )}
      <Toast />
      {ready && <Onboarding />}
      {(loading || error) && <div className="loader"><div className="drop" /><p>{error ?? loading}</p></div>}
    </div>
  );
}
