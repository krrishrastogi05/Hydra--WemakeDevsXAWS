// The guided tour: a short, scripted walk through the app that drives it for real (plays the storm, lets HYDRA
// plan, applies the plan, splits the map, runs the showdown, opens the analytics). A spotlight marks the part of
// the screen each step is about; the card can be advanced with Next, Enter or →, and closed with Esc.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { planKey, useStore } from '../store';
import { heatPlanKey, useHeat } from '../heatStore';
import { fmtINR } from '../sim/grid';
import { Icon } from './Chrome';
import { mapMiddle } from './SplitBar';

/** `plain`: nothing is dimmed and the card sits bottom-left, for steps about the map or the analytics view. */
interface Step { title: string; body: () => ReactNode; target?: string; plain?: boolean; run?: () => Promise<void> | void; busy?: string }

const until = (pred: () => boolean, ms = 300000) => new Promise<void>(res => {
  if (pred()) { res(); return; }
  const t0 = Date.now(), id = setInterval(() => { if (pred() || Date.now() - t0 > ms) { clearInterval(id); res(); } }, 200);
});
const S = () => useStore.getState(), Hs = () => useHeat.getState();
const reset = { analytics: null, split: false, tool: 'inspect' as const, draft: null, onboarding: false };

const FLOOD: Step[] = [
  { title: 'A 90-second tour of HYDRA', body: () => <>HYDRA runs a monsoon storm over a real Indian neighbourhood, shows who gets flooded and why, then finds where a limited budget does the most good. We will run a storm, let HYDRA plan, and compare it with the obvious alternative.</>,
    run: () => { useStore.setState({ ...reset, panel: 'overview', view: 'baseline', peak: true, playing: false }); } },
  { title: 'A real neighbourhood', plain: true, body: () => { const s = S().site; return <>{s ? <><b>{s.name}, {s.city}</b>: </> : null}buildings, roads and land use come from OpenStreetMap, the terrain from AWS open elevation data. Red homes take water above the plinth, amber homes get water at the door.</>; } },
  { title: 'Watch the storm', target: '.timeline', body: () => <>The storm plays out minute by minute: rain falls, runs downhill, fills the roadside drains and pools in the low spots. Drag the timeline to scrub, or press <b>Peak</b> for the worst moment at each place.</>,
    run: () => { useStore.setState({ view: 'baseline', time: 0, playing: true, peak: false }); } },
  { title: 'Count the damage', target: '.panel', body: () => { const b = S().baseline?.metrics; return <>With no action, <b>{b?.buildingsFlooded ?? '…'} homes</b> take water and <b>{b ? b.roadKmAffected.toFixed(2) : '…'} km</b> of road is cut. Every figure here comes straight from the simulation.</>; },
    run: () => { useStore.setState({ panel: 'overview' }); } },
  { title: 'Fix it yourself', target: '.toolbar', body: () => <>Pick a drain, rain garden, rooftop harvesting, recharge pit or desilting (keys <kbd>1</kbd>–<kbd>5</kbd>) and place it on the map. A green pin means it is allowed there, red says why not, and the cost shows before you click.</> },
  { title: 'Or let HYDRA plan the budget', target: '.panel', busy: 'HYDRA is simulating the storm and placing the budget…',
    body: () => { const s = S(), r = s.recommendation; return r ? <>HYDRA spent <b>{fmtINR(r.cost)}</b> on <b>{r.plan.length} interventions</b>, each where it removes the most harmful water per rupee. Its plan is now on the map, and the storm has been re-run with it.</> : <>HYDRA simulates the storm, finds the low spots and overloaded drains that do the most harm, and spends the budget where it removes the most harmful water per rupee.</>; },
    run: async () => {
      useStore.setState({ panel: 'optimize', optimize: 'recommend', playing: false });
      await S().recommend('fresh');
      const r = S().recommendation;
      if (!r) return;
      S().setPlan(r.plan);
      await until(() => !S().running && S().currentKey === planKey(S().plan));
      useStore.setState({ panel: 'overview', peak: true });
    } },
  { title: 'Before and after, side by side', plain: true, body: () => <>No action on the left, HYDRA's plan on the right: same storm, same moment. Drag the white handle across the map to compare street by street.</>,
    run: () => { useStore.setState({ split: true, splitX: mapMiddle(), peak: true, playing: false }); } },
  { title: 'Is it just luck?', target: '.panel', busy: 'Running the showdown: HYDRA against 3 random even-spread plans…',
    body: () => <>The showdown spends the same budget three ways: nothing, an even spread at random spots, and HYDRA's plan. Placement, not money, makes the difference.</>,
    run: async () => { useStore.setState({ split: false, panel: 'optimize', optimize: 'showdown' }); await S().runShowdown(); } },
  { title: 'Every number, in depth', plain: true, body: () => <>The analytics view holds the storm timeline, water balance, depth and duration, drain load, hotspots, cost against benefit and the full strategy comparison, with CSV export and print. Open it any time with <kbd>A</kbd>.</>,
    run: () => { useStore.setState({ analytics: 'strategies' }); } },
  { title: 'Your turn', body: () => <>Change the storm or the budget in the top bar, edit HYDRA's plan, or switch to <b>Heat</b> mode (<kbd>H</kbd>) to plan shade for a heatwave. Restart this tour with <kbd>T</kbd>.</>,
    run: () => { useStore.setState({ analytics: null }); } },
];

const HEAT: Step[] = [
  { title: 'A 90-second tour of heat mode', busy: 'Tracing the sun across the neighbourhood…', body: () => <>Heat mode traces the sun through a hot day over the same neighbourhood, finds the bus stops, markets and streets where people wait in full sun, and spends a shade budget where it helps the most people.</>,
    run: async () => { useStore.setState({ ...reset, panel: 'overview' }); await until(() => !!Hs().baseline && !Hs().loading); } },
  { title: 'Play the day', target: '.timeline', body: () => <>Watch the shadows move hour by hour. Blue is shade, yellow is direct sun, and the pins mark the places people wait.</>,
    run: () => { useHeat.setState({ summary: false, hour: 7, playing: true, view: 'baseline' }); } },
  { title: 'Who bakes in the sun', target: '.panel', body: () => { const b = Hs().baseline?.metrics; return <>With no action, <b>{b?.hotReceptors ?? '…'} places</b> where people wait are highly exposed, with only <b>{b ? Math.round(b.receptorShade * 100) : '…'}%</b> of the sun blocked there.</>; },
    run: () => { useStore.setState({ panel: 'overview' }); } },
  { title: 'Plant shade yourself', target: '.toolbar', body: () => <>Street trees, shade canopies, shaded walkways and cool roofs (keys <kbd>1</kbd>–<kbd>4</kbd>). A green pin means allowed, red says why not.</> },
  { title: 'Or let HYDRA plan the shade', target: '.panel', busy: 'HYDRA is trying every nearby tree and canopy…',
    body: () => { const r = Hs().recommendation; return r ? <>HYDRA spent <b>{fmtINR(r.cost)}</b> on <b>{r.plan.length}</b> trees and canopies, each scored by exposure removed per rupee. It is now on the map.</> : <>HYDRA scores every candidate tree and canopy by exposure removed per rupee, against the shade already there.</>; },
    run: async () => {
      useHeat.setState({ playing: false });
      useStore.setState({ panel: 'optimize', optimize: 'recommend' });
      await Hs().recommend('fresh');
      const r = Hs().recommendation;
      if (!r) return;
      Hs().setPlan(r.plan);
      await until(() => !Hs().running && Hs().currentKey === heatPlanKey(Hs().plan));
      useStore.setState({ panel: 'overview' });
    } },
  { title: 'Is it just luck?', target: '.panel', busy: 'Running the showdown…', body: () => <>Same day, same budget, three strategies. Placement, not money, makes the difference.</>,
    run: async () => { useStore.setState({ panel: 'optimize', optimize: 'showdown' }); await Hs().runShowdown(); } },
  { title: 'Every number, in depth', plain: true, body: () => <>Sun height and sunlight through the day, exposure distributions, every place people wait, cost against benefit and the full comparison. Open it any time with <kbd>A</kbd>.</>,
    run: () => { useStore.setState({ analytics: 'strategies' }); } },
  { title: 'Your turn', body: () => <>Change the day or hours in the top bar, edit HYDRA's plan, or switch back to <b>Flood</b> mode (<kbd>H</kbd>). Restart this tour with <kbd>T</kbd>.</>,
    run: () => { useStore.setState({ analytics: null }); } },
];

type Box = { left: number; top: number; width: number; height: number } | null;

export function Tour() {
  const step = useStore(s => s.tour), mode = useStore(s => s.mode);
  const steps = useRef<Step[]>(FLOOD), [busy, setBusy] = useState(false), [box, setBox] = useState<Box>(null);
  const card = useRef<HTMLDivElement>(null), [pos, setPos] = useState({ left: 0, top: 0 });
  const [, tick] = useState(0);
  const end = () => useStore.setState({ tour: null });
  const next = () => { const t = useStore.getState().tour; if (t == null) return; useStore.setState({ tour: t + 1 >= steps.current.length ? null : t + 1 }); };

  // pick the script when the tour starts, then run each step's action on entry
  useEffect(() => { if (step === 0) steps.current = useStore.getState().mode === 'heat' ? HEAT : FLOOD; }, [step]);
  useEffect(() => {
    if (step == null) return;
    const st = steps.current[step];
    if (!st?.run) { setBusy(false); return; }
    let live = true;
    setBusy(true);
    Promise.resolve(st.run()).catch(() => {}).finally(() => { if (live && useStore.getState().tour === step) { setBusy(false); tick(n => n + 1); } });
    return () => { live = false; };
  }, [step]);

  // follow the highlighted element as the layout changes
  useEffect(() => {
    if (step == null) return;
    let raf = 0;
    const loop = () => {
      const sel = steps.current[step]?.target, el = sel ? document.querySelector(sel) : null, r = el?.getBoundingClientRect();
      setBox(b => {
        const n = r && r.width > 0 ? { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null;
        return b?.left === n?.left && b?.top === n?.top && b?.width === n?.width && b?.height === n?.height ? b : n;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // place the card beside the highlight, on the side with room
  useLayoutEffect(() => {
    const c = card.current;
    if (!c) return;
    const cw = c.offsetWidth, ch = c.offsetHeight, m = 16, W = innerWidth, H = innerHeight;
    const clampX = (x: number) => Math.max(12, Math.min(W - cw - 12, x)), clampY = (y: number) => Math.max(70, Math.min(H - ch - 12, y));
    if (steps.current[step ?? 0]?.plain) { const tl = document.querySelector('.timeline')?.getBoundingClientRect(); setPos({ left: 24, top: clampY((tl ? tl.top : H) - ch - m) }); return; }
    if (!box) { const right = document.querySelector('.panel')?.getBoundingClientRect().left ?? W; setPos({ left: clampX((right - cw) / 2), top: clampY(H * 0.3) }); return; }
    if (box.left > W * 0.55) setPos({ left: clampX(box.left - cw - m), top: clampY(box.top + 60) });
    else if (box.top > H * 0.55) setPos({ left: clampX(box.left + 40), top: clampY(box.top - ch - m) });
    else if (box.left + box.width < W * 0.3) setPos({ left: clampX(box.left + box.width + m), top: clampY(box.top) });
    else setPos({ left: clampX(box.left + box.width / 2 - cw / 2), top: clampY(box.top + box.height + m) });
  }, [box, step, busy, mode]);

  useEffect(() => {
    if (step == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); end(); }
      else if ((e.key === 'Enter' || e.key === 'ArrowRight') && !busy) { e.preventDefault(); next(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (step == null) return null;
  const all = steps.current, st = all[step];
  if (!st) return null;
  const last = step === all.length - 1;
  return createPortal(
    <div className="tour">
      {st.plain ? null : box ? <div className="tour-spot" style={{ left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 }} /> : <div className="tour-dim" />}
      <div className="tour-card" ref={card} style={pos} role="dialog" aria-label={st.title}>
        <div className="tour-top"><span className="kicker">Tour · {step + 1} of {all.length}</span><button className="an-x sm" onClick={end} aria-label="End the tour"><Icon name="close" size={14} /></button></div>
        <h3>{st.title}</h3>
        <p>{st.body()}</p>
        {busy && st.busy && <div className="tour-busy"><span className="spinner" />{st.busy}</div>}
        <div className="tour-foot">
          <div className="tour-dots">{all.map((_, k) => <i key={k} className={k === step ? 'on' : k < step ? 'done' : ''} />)}</div>
          {!last && <button className="link" onClick={end}>Skip</button>}
          <button className="btn primary sm" disabled={busy} onClick={next}>{busy ? 'Working…' : last ? 'Finish' : 'Next'} {!busy && !last && <span aria-hidden>→</span>}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
