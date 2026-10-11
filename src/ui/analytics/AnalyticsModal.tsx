// Full-screen analytics: every chart, table and comparison behind the side panel's summary, for presenting and
// exporting. Loaded on demand. Sections differ by mode; the shell, export and print are shared.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import { Icon } from '../Chrome';
import { downloadCsv } from '../viz';
import * as F from './flood';
import * as Ht from './heat';
import { ComparePlans } from './compare';

const FLOOD = [
  { id: 'summary', label: 'Summary', hint: 'Headline results and key moments' },
  { id: 'timeline', label: 'Storm timeline', hint: 'Rain, water, homes and roads, minute by minute' },
  { id: 'water', label: 'Water balance', hint: 'Where every drop went' },
  { id: 'depth', label: 'Depth & duration', hint: 'How deep, and for how long' },
  { id: 'drains', label: 'Drainage', hint: 'Load on the drain network' },
  { id: 'hotspots', label: 'Hotspots', hint: 'Streets and facilities hit' },
  { id: 'cost', label: 'Cost & value', hint: 'Budget, value for money, cost against benefit' },
  { id: 'strategies', label: 'Strategies', hint: 'HYDRA against an even spread' },
  { id: 'compare', label: 'Compare plans', hint: 'Your saved plans, side by side' },
  { id: 'method', label: 'Data & method', hint: 'Sources, parameters, model checks' },
];
const HEAT = [
  { id: 'summary', label: 'Summary', hint: 'Headline results and the hottest places' },
  { id: 'timeline', label: 'Sun through the day', hint: 'Sun height, sunlight and shade' },
  { id: 'exposure', label: 'Exposure', hint: 'How exposed walkable space is' },
  { id: 'places', label: 'Places people wait', hint: 'Bus stops, markets, gates, parks' },
  { id: 'cost', label: 'Cost & value', hint: 'Budget, value for money, cost against benefit' },
  { id: 'strategies', label: 'Strategies', hint: 'HYDRA against an even spread' },
  { id: 'compare', label: 'Compare plans', hint: 'Your saved plans, side by side' },
  { id: 'method', label: 'Data & method', hint: 'Sources, parameters, model checks' },
];

export default function AnalyticsModal() {
  const section = useStore(s => s.analytics), mode = useStore(s => s.mode), site = useStore(s => s.site);
  const f = F.useFlood(), h = Ht.useHeatData();
  const close = () => useStore.setState({ analytics: null });
  const nav = mode === 'flood' ? FLOOD : HEAT, cur = nav.find(x => x.id === section) ?? nav[0];
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.scrollTo(0, 0); }, [cur.id, mode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const go = (id: string) => useStore.setState({ analytics: id });
  const cond = mode === 'flood' ? `${f.storm.name} · ${f.storm.totalMm} mm` : `${h.sc.name} · ${h.win.name}`;
  const n = mode === 'flood' ? f.plan.length : h.plan.length;
  const exportCsv = () => downloadCsv(`hydra-${mode}-${site?.id ?? 'area'}.csv`, mode === 'flood' ? F.floodCsv(f) : Ht.heatCsv(h));

  const content = (() => {
    if (cur.id === 'compare') return <ComparePlans close={close} />;
    if (mode === 'flood') {
      switch (cur.id) {
        case 'timeline': return <F.Timeline f={f} />;
        case 'water': return <F.WaterBalance f={f} />;
        case 'depth': return <F.DepthDuration f={f} />;
        case 'drains': return <F.Drainage f={f} />;
        case 'hotspots': return <F.Hotspots f={f} close={close} />;
        case 'cost': return <F.Cost f={f} />;
        case 'strategies': return <F.Strategies f={f} close={close} />;
        case 'method': return <F.Method f={f} />;
        default: return <F.Summary f={f} />;
      }
    }
    if (!h.baseline) return <div className="callout soft"><span className="spinner" />Preparing heat mode…</div>;
    switch (cur.id) {
      case 'timeline': return <Ht.HeatDay h={h} />;
      case 'exposure': return <Ht.HeatExposure h={h} />;
      case 'places': return <Ht.HeatPlaces h={h} close={close} />;
      case 'cost': return <Ht.HeatCost h={h} />;
      case 'strategies': return <Ht.HeatStrategies h={h} close={close} />;
      case 'method': return <Ht.HeatMethod h={h} />;
      default: return <Ht.HeatSummary h={h} />;
    }
  })();

  // portalled to <body>: the panels' backdrop-filter would otherwise trap this fixed overlay
  return createPortal(
    <div className="an-back" onClick={close}>
      <div className="an-modal" role="dialog" aria-modal="true" aria-label="Analytics" onClick={e => e.stopPropagation()}>
        <header className="an-head">
          <div className="an-title">
            <span className="kicker"><Icon name="chart" size={14} /> {mode === 'flood' ? 'Flood' : 'Heat'} analytics</span>
            <h2>{site ? `${site.name}, ${site.city}` : 'Analytics'}</h2>
            <span className="an-sub">{cond} · {n ? `your plan, ${n} interventions` : 'no plan yet'}</span>
          </div>
          <div className="an-tools">
            <button className="btn primary sm" onClick={() => useStore.setState({ report: true })} title="A paginated report of every section, ready to save as PDF"><Icon name="doc" size={14} />Report (PDF)</button>
            <button className="btn sm" onClick={exportCsv} title="Download the key figures, time series and tables as CSV"><Icon name="download" size={14} />Export CSV</button>
            <button className="btn sm" onClick={() => window.print()} title="Print this section, or save it as a PDF"><Icon name="print" size={14} />Print section</button>
            <button className="an-x" onClick={close} aria-label="Close analytics"><Icon name="close" /></button>
          </div>
        </header>
        <nav className="an-nav" aria-label="Analytics sections">
          {nav.map(x => <button key={x.id} className={x.id === cur.id ? 'on' : ''} onClick={() => go(x.id)}><b>{x.label}</b><small>{x.hint}</small></button>)}
          <p className="an-keys"><kbd>A</kbd> opens and closes this view · <kbd>Esc</kbd> closes</p>
        </nav>
        <div className="an-body print-an" ref={body}>
          <div className="an-section-head"><h3>{cur.label}</h3><span>{cur.hint}</span></div>
          {content}
        </div>
      </div>
    </div>,
    document.body,
  );
}
