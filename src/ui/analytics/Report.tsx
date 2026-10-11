// One-click report: every analytics section, the plan comparison and the officer brief, laid out as a light,
// paginated document. It opens as a preview and calls the print dialog, where "Save as PDF" gives the file.
import { useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import { templateBrief } from '../../brief';
import { collectBriefInput } from '../../briefInput';
import { useSaved } from '../../savedPlans';
import { Icon } from '../Chrome';
import { Rich } from '../Share';
import { ComparePlans } from './compare';
import * as F from './flood';
import * as Ht from './heat';

const none = () => {};

function Page({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return <section className="rp-page"><header className="rp-head"><h2>{title}</h2>{sub && <span>{sub}</span>}</header>{children}</section>;
}

export default function Report() {
  const mode = useStore(s => s.mode), site = useStore(s => s.site);
  const f = F.useFlood(), h = Ht.useHeatData();
  const saved = useSaved(s => s.entries.filter(e => e.mode === mode && e.siteId === site?.id).length);
  const close = () => useStore.setState({ report: false });
  // the brief describes the latest run of the plan; without a plan it is skipped
  const brief = useMemo(() => { const i = collectBriefInput(); return typeof i === 'string' ? null : templateBrief(i); }, [f.run, h.run]);
  useEffect(() => {
    document.body.classList.add('printing-report');
    const t = setTimeout(() => window.print(), 1200);   // charts measure themselves first
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { clearTimeout(t); document.body.classList.remove('printing-report'); window.removeEventListener('keydown', onKey, true); };
  }, []);
  const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const cond = mode === 'flood' ? `${f.storm.name} · ${f.storm.totalMm} mm in ${f.storm.durationMin / 60} h · ${f.antecedent} soil` : `${h.sc.name} · ${h.sc.tempC} °C · ${h.win.name}`;
  const n = mode === 'flood' ? f.plan.length : h.plan.length;
  const sections: [string, string, ReactNode][] = mode === 'flood' ? [
    ['Summary', 'headline results and key moments', <F.Summary f={f} />],
    ['Storm timeline', 'rain, water, homes and roads, minute by minute', <F.Timeline f={f} />],
    ['Water balance', 'where every drop went', <F.WaterBalance f={f} />],
    ['Depth and duration', 'how deep, and for how long', <F.DepthDuration f={f} />],
    ['Drainage', 'load on the drain network', <F.Drainage f={f} />],
    ['Hotspots', 'streets and facilities hit', <F.Hotspots f={f} close={none} />],
    ['Cost and value', 'budget, value for money, cost against benefit', <F.Cost f={f} />],
    ...(f.sd ? [['Strategies', 'HYDRA against an even spread of the same budget', <F.Strategies f={f} close={none} />] as [string, string, ReactNode]] : []),
    ['Data and method', 'sources, parameters, model checks', <F.Method f={f} />],
  ] : [
    ['Summary', 'headline results and the hottest places', <Ht.HeatSummary h={h} />],
    ['Sun through the day', 'sun height, sunlight and shade', <Ht.HeatDay h={h} />],
    ['Exposure', 'how exposed walkable space is', <Ht.HeatExposure h={h} />],
    ['Places people wait', 'bus stops, markets, gates, parks', <Ht.HeatPlaces h={h} close={none} />],
    ['Cost and value', 'budget, value for money, cost against benefit', <Ht.HeatCost h={h} />],
    ...(h.sd ? [['Strategies', 'HYDRA against an even spread of the same budget', <Ht.HeatStrategies h={h} close={none} />] as [string, string, ReactNode]] : []),
    ['Data and method', 'sources, parameters, model checks', <Ht.HeatMethod h={h} />],
  ];
  return createPortal(
    <div className="rp-back">
      <div className="rp-bar">
        <b><Icon name="doc" size={16} /> Report preview</b>
        <span>{sections.length + (saved ? 1 : 0) + (brief ? 1 : 0) + 1} pages · choose <b>Save as PDF</b> as the printer</span>
        <button className="btn primary sm" onClick={() => window.print()}><Icon name="print" size={14} />Print / Save PDF</button>
        <button className="an-x" onClick={close} aria-label="Close the report"><Icon name="close" /></button>
      </div>
      <article className="report print-report">
        <section className="rp-page rp-cover">
          <span className="rp-kicker">HYDRA · {mode === 'flood' ? 'Monsoon flood' : 'Urban heat'} assessment</span>
          <h1>{site ? `${site.name}, ${site.city}` : 'Neighbourhood'}</h1>
          <p className="rp-lead">{cond}</p>
          <dl className="rp-facts">
            <div><dt>Prepared</dt><dd>{date}</dd></div>
            <div><dt>Plan</dt><dd>{n ? `${n} interventions` : 'no plan yet (no-action baseline)'}</dd></div>
            <div><dt>Budget</dt><dd>₹{((mode === 'flood' ? f.budget : h.budget) / 1e5).toFixed(1)} lakh</dd></div>
            <div><dt>Data</dt><dd>OpenStreetMap, AWS Terrain Tiles; synthetic data labelled</dd></div>
          </dl>
          <ol className="rp-toc">{sections.map(([t]) => <li key={t}>{t}</li>)}{saved > 0 && <li>Saved plans compared</li>}{brief && <li>Officer brief</li>}</ol>
          <p className="rp-note">HYDRA is a transparent screening model, not an engineering design tool. Unit costs are indicative; confirm with survey, detailed design and the local schedule of rates.</p>
        </section>
        {sections.map(([t, sub, body]) => <Page key={t} title={t} sub={sub}>{body}</Page>)}
        {saved > 0 && <Page title="Saved plans compared" sub="each against its own no-action baseline"><ComparePlans close={none} report /></Page>}
        {brief && (
          <Page title="Officer brief" sub="for the ward officer, English and Hindi">
            <div className="rp-brief"><Rich text={brief.en} /></div>
            <div className="rp-brief" lang="hi"><Rich text={brief.hi} /></div>
          </Page>
        )}
      </article>
    </div>,
    document.body,
  );
}
