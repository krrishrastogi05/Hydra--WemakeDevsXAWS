// Ward-officer brief: a one-page summary of the plan in English and Hindi, written in the browser from the
// simulation numbers only (src/briefInput.ts collects them). No server and no AI involved.

export interface BriefText { en: string; hi: string }
export interface BriefMetric { label: BriefText; unit: BriefText; before: number; after: number; digits: number; better: 'lower' | 'higher' }
export interface BriefInput {
  mode: 'flood' | 'heat';
  site: { name: string; city: string; state: string };
  conditions: BriefText;          // the storm or the day and hours, one line
  budget: number; spent: number;  // rupees
  mix: { kind: BriefText; count: number; cost: number }[];
  picks: { kind: BriefText; where: string; cost: number; reason?: string }[];   // biggest first
  metrics: BriefMetric[];         // no action -> with the plan, same conditions
  hotspots: string[];             // worst places with no action
}
/** Markdown-lite: "## " headings, "- " bullets, **bold**, blank-line paragraphs. */
export interface Brief { en: string; hi: string }

// ---------- formatting ----------
export function rupees(v: number, lang: 'en' | 'hi' = 'en') {
  const [cr, l] = lang === 'hi' ? ['करोड़', 'लाख'] : ['Cr', 'L'];
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} ${cr}`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v >= 1e6 ? 1 : 2)} ${l}`;
  return '₹' + Math.round(v).toLocaleString('en-IN');
}
export const metricValue = (m: BriefMetric, v: number, lang: 'en' | 'hi') => {
  const s = v.toLocaleString('en-IN', { maximumFractionDigits: m.digits, minimumFractionDigits: m.digits }), u = m.unit[lang];
  return !u ? s : u === '%' ? `${s}%` : `${s} ${u}`;
};
const change = (m: BriefMetric) => {
  if (Math.abs(m.before) < 1e-9) return '';
  const d = Math.round(((m.after - m.before) / Math.abs(m.before)) * 100);
  return d ? ` (${d > 0 ? '+' : '−'}${Math.abs(d)}%)` : '';
};

// ---------- the template brief ----------
const T = {
  en: {
    title: (i: BriefInput) => `${i.mode === 'flood' ? 'Flood' : 'Heat'} resilience brief: ${i.site.name}, ${i.site.city}`,
    meta: (i: BriefInput) => `Prepared with HYDRA · ${i.conditions.en} · budget ${rupees(i.budget)}`,
    problem: 'The problem', plan: (i: BriefInput) => `The plan (${rupees(i.spent)} of ${rupees(i.budget)})`,
    worst: 'Worst places with no action', picks: 'Where the money goes first',
    effect: (i: BriefInput) => `Expected effect (same ${i.mode === 'flood' ? 'storm' : 'day'}, simulated)`,
    noAction: (i: BriefInput) => `With no action, ${i.metrics.slice(0, 2).map(m => `${m.label.en.toLowerCase()}: ${metricValue(m, m.before, 'en')}`).join('; ')}.`,
    next: 'Next steps', caveats: 'Caveats',
    steps: (i: BriefInput) => [
      'Walk the top locations with the ward engineer: check levels, ownership and utilities before a detailed estimate.',
      'Price the works from the local CPWD or state PWD schedule of rates; HYDRA unit costs are indicative.',
      i.mode === 'flood' ? 'Coordinate with the stormwater drain department so new drains reach a working outfall.' : 'Coordinate with horticulture (trees) and transport (bus shelters); new trees take years to give full shade.',
    ],
    notes: (i: BriefInput) => [
      `HYDRA is a screening model for comparing options, not a ${i.mode === 'flood' ? 'hydraulic design' : 'heat-stress or health'} tool.`,
      'Some inputs are synthetic and labelled in the app (for example drain sizes, plinth heights, trees and footfall).',
    ],
  },
  hi: {
    title: (i: BriefInput) => `${i.mode === 'flood' ? 'बाढ़' : 'गर्मी'} से बचाव का सारांश: ${i.site.name}, ${i.site.city}`,
    meta: (i: BriefInput) => `HYDRA से तैयार · ${i.conditions.hi} · बजट ${rupees(i.budget, 'hi')}`,
    problem: 'समस्या', plan: (i: BriefInput) => `योजना (${rupees(i.budget, 'hi')} में से ${rupees(i.spent, 'hi')})`,
    worst: 'बिना कदम उठाए सबसे प्रभावित जगहें', picks: 'पैसा सबसे पहले कहाँ लगे',
    effect: (i: BriefInput) => `अनुमानित असर (वही ${i.mode === 'flood' ? 'बारिश' : 'दिन'}, सिमुलेशन)`,
    noAction: (i: BriefInput) => `कोई कदम न उठाने पर: ${i.metrics.slice(0, 2).map(m => `${m.label.hi} ${metricValue(m, m.before, 'hi')}`).join('; ')}।`,
    next: 'आगे के कदम', caveats: 'सीमाएँ',
    steps: (i: BriefInput) => [
      'वार्ड इंजीनियर के साथ प्रमुख जगहों का निरीक्षण करें: विस्तृत अनुमान से पहले ढलान, ज़मीन का स्वामित्व और पाइपलाइन/केबल जाँचें।',
      'कामों की लागत स्थानीय CPWD या राज्य PWD की दर-सूची से निकालें; HYDRA की लागत केवल सांकेतिक है।',
      i.mode === 'flood' ? 'स्टॉर्मवॉटर ड्रेन विभाग से समन्वय करें ताकि नए नाले किसी चालू निकास तक पहुँचें।' : 'उद्यान विभाग (पेड़) और परिवहन विभाग (बस शेल्टर) से समन्वय करें; नए पेड़ों को पूरी छाया देने में कई साल लगते हैं।',
    ],
    notes: (i: BriefInput) => [
      `HYDRA विकल्पों की तुलना के लिए एक स्क्रीनिंग मॉडल है, ${i.mode === 'flood' ? 'नाली की इंजीनियरिंग डिज़ाइन' : 'हीट-स्ट्रेस या स्वास्थ्य आकलन'} का साधन नहीं।`,
      'कुछ आँकड़े अनुमानित (सिंथेटिक) हैं और ऐप में चिह्नित हैं (जैसे नालों का आकार, प्लिंथ की ऊँचाई, पेड़ और पैदल आवाजाही)।',
    ],
  },
};

function write(i: BriefInput, lang: 'en' | 'hi') {
  const t = T[lang], out: string[] = [];
  out.push(`## ${t.title(i)}`, '', t.meta(i), '');
  out.push(`## ${t.problem}`, '', t.noAction(i));
  if (i.hotspots.length) out.push('', `**${t.worst}:** ${i.hotspots.slice(0, 5).join('; ')}`);
  out.push('', `## ${t.plan(i)}`, '');
  for (const m of i.mix) out.push(`- ${m.count} × ${m.kind[lang]}: ${rupees(m.cost, lang)}`);
  if (i.picks.length) {
    out.push('', `**${t.picks}:**`, '');
    for (const p of i.picks.slice(0, 5)) out.push(`- ${p.kind[lang]}, ${p.where} (${rupees(p.cost, lang)})${lang === 'en' && p.reason ? `: ${p.reason}` : ''}`);
  }
  out.push('', `## ${t.effect(i)}`, '');
  for (const m of i.metrics) out.push(`- ${m.label[lang]}: ${metricValue(m, m.before, lang)} → **${metricValue(m, m.after, lang)}**${change(m)}`);
  out.push('', `## ${t.next}`, '');
  for (const s of t.steps(i)) out.push(`- ${s}`);
  out.push('', `## ${t.caveats}`, '');
  for (const s of t.notes(i)) out.push(`- ${s}`);
  return out.join('\n');
}

/** The no-AI brief, built only from the numbers in the input. */
export function templateBrief(i: BriefInput): Brief {
  return { en: write(i, 'en'), hi: write(i, 'hi') };
}
