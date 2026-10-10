// "Share and report" in the Plan tab (both modes): the ward-officer brief in English and Hindi, and a share link.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackend } from '../api';
import { templateBrief, type Brief } from '../brief';
import { collectBriefInput } from '../briefInput';
import { heatPlanKey, useHeat } from '../heatStore';
import { sharePlan } from '../sharedPlan';
import { planKey, useStore } from '../store';
import { Icon } from './Chrome';

export function ShareReport() {
  const mode = useStore(s => s.mode), notify = useStore(s => s.notify);
  const key = useStore(s => planKey(s.plan)), heatKey = useHeat(s => heatPlanKey(s.plan));
  const backend = useBackend(s => s.status);
  const [brief, setBrief] = useState<Brief | null>(null), [preparing, setPreparing] = useState(false);
  const [link, setLink] = useState<string | null>(null), [sharing, setSharing] = useState(false);
  useEffect(() => setLink(null), [mode, key, heatKey]);   // a link is for the plan as it was when shared

  const openBrief = async () => {
    setPreparing(true);
    // the brief describes the plan's last run, so make sure that run is current
    if (mode === 'flood') { const s = useStore.getState(); if (planKey(s.plan) !== s.currentKey) await s.runPlan(false); }
    else { const h = useHeat.getState(); if (heatPlanKey(h.plan) !== h.currentKey) await h.runPlan(false); }
    setPreparing(false);
    const input = collectBriefInput();
    if (typeof input === 'string') { notify(input, 'error'); return; }
    setBrief(templateBrief(input));
  };

  const share = async () => {
    setSharing(true);
    try {
      const url = await sharePlan();
      setLink(url);
      try { await navigator.clipboard.writeText(url); notify('Link copied. Anyone with it can open this plan.'); } catch { notify('Link ready: copy it from the box below.'); }
    } catch (e) { notify(`Could not save the plan: ${(e as Error).message}`, 'error'); }
    setSharing(false);
  };

  return (
    <section className="share-report">
      <h4>Share and report</h4>
      <div className="row-actions">
        <button className="btn" onClick={openBrief} disabled={preparing}><Icon name="doc" size={15} />{preparing ? 'Running the plan…' : 'Officer brief'} <small className="muted">EN · हिं</small></button>
        {backend === 'up' && <button className="btn" onClick={share} disabled={sharing}><Icon name="link" size={15} />{sharing ? 'Saving…' : 'Copy share link'}</button>}
      </div>
      {link && <input className="sharelink" readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label="Share link" />}
      {backend !== 'up' && <p className="fine">{backend === 'checking' ? 'Connecting to the HYDRA API…' : 'Share links need the HYDRA API (backend/).'}</p>}
      {brief && <BriefModal brief={brief} onClose={() => setBrief(null)} />}
    </section>
  );
}

function BriefModal({ brief, onClose }: { brief: Brief; onClose: () => void }) {
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const notify = useStore(s => s.notify);
  const copy = async () => { try { await navigator.clipboard.writeText(brief[lang]); notify('Brief copied'); } catch { notify('Could not copy: select the text instead', 'error'); } };
  // portalled to <body>: the side panel's backdrop-filter would otherwise trap this fixed overlay inside the panel
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div className="modal brief" onClick={e => e.stopPropagation()} role="dialog" aria-label="Officer brief">
        <div className="brief-head">
          <h2><Icon name="doc" size={20} /> Officer brief</h2>
          <div className="langs" role="group" aria-label="Language">{(['en', 'hi'] as const).map(l => <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l === 'en' ? 'English' : 'हिन्दी'}</button>)}</div>
          <button className="link close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <article className="brief-body print-brief" lang={lang}><Rich text={brief[lang]} /></article>
        <p className="fine">Built from the simulation numbers in the Results tab. HYDRA is a screening model and its costs are indicative.</p>
        <div className="row-actions">
          <button className="btn" onClick={copy}>Copy text</button>
          <button className="btn" onClick={() => window.print()}>Print or save as PDF</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Markdown-lite (as produced in src/brief.ts): "## " headings, "- " bullets, **bold**, paragraphs. No HTML is
// ever injected; everything renders as text nodes.
const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, k) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={k}>{part.slice(2, -2)}</b> : part));
function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { const items = list; out.push(<ul key={out.length}>{items.map((l, k) => <li key={k}>{inline(l)}</li>)}</ul>); list = []; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^[-*] /.test(line)) { list.push(line.slice(2)); continue; }
    flush();
    if (!line) continue;
    out.push(line.startsWith('#') ? <h3 key={out.length}>{inline(line.replace(/^#+\s*/, ''))}</h3> : <p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return <>{out}</>;
}
