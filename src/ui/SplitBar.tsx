// The divider for the before/after split view: drag it across the map; labels name each side.
import { useStore } from '../store';
import { fmtINR } from '../sim/grid';
import { planCost } from '../sim/flood/model';
import { useSplitOn } from '../three/split';

/** The middle of the map area that is not covered by the side panel, as a share of the window width. */
export function mapMiddle() {
  const panel = document.querySelector('.panel')?.getBoundingClientRect();
  return Math.max(0.2, Math.min(0.8, ((panel ? panel.left : innerWidth) / 2) / innerWidth));
}

export function SplitBar() {
  const on = useSplitOn(), x = useStore(s => s.splitX);
  const n = useStore(s => s.plan.length), spent = useStore(s => (s.grid ? planCost(s.grid, s.plan) : 0));
  if (!on) return null;
  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => useStore.setState({ splitX: Math.max(0.06, Math.min(0.94, ev.clientX / innerWidth)) });
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div className="splitbar" style={{ left: `${x * 100}%` }}>
      <span className="split-tag left">No action</span>
      <span className="split-tag right">Your plan · {n} · {fmtINR(spent)}</span>
      <i className="split-line" />
      <button className="split-handle" onPointerDown={drag} aria-label="Drag to compare no action with your plan" title="Drag to compare">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 5L2 10l5 5M13 5l5 5-5 5" /></svg>
      </button>
    </div>
  );
}
