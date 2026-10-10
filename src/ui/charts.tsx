// Small SVG charts. Series colours carry identity only; all text uses ink tokens. Every chart has hover detail.
import { useMemo, useState, type ReactNode } from 'react';

export const SERIES = {
  none: { name: 'No action', color: '#8a96a6' },
  spread: { name: 'Even spread', color: '#d95926' },
  hydra: { name: 'HYDRA plan', color: '#3987e5' },
  plan: { name: 'Your plan', color: '#199e70' },
} as const;
export type SeriesKey = keyof typeof SERIES;

export function Legend({ keys }: { keys: SeriesKey[] }) {
  return <div className="legend-row">{keys.map(k => <span key={k}><i style={{ background: SERIES[k].color }} />{SERIES[k].name}</span>)}</div>;
}

export interface BarRow { label: string; hint?: string; values: Partial<Record<SeriesKey, number>>; range?: Partial<Record<SeriesKey, [number, number]>>; fmt: (v: number) => string; better?: 'lower' | 'higher' }

/** Grouped horizontal bars, one group per metric; each group has its own scale (no shared axis is implied). */
export function CompareBars({ rows, keys }: { rows: BarRow[]; keys: SeriesKey[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const W = 300, labelW = 0, barH = 9, gap = 3, groupGap = 22;
  let y = 0;
  const groups = rows.map(r => {
    const max = Math.max(1e-9, ...keys.map(k => Math.max(r.values[k] ?? 0, r.range?.[k]?.[1] ?? 0)));
    const g = { r, y0: y + 16, max };
    y += 16 + keys.length * (barH + gap) + groupGap;
    return g;
  });
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <Legend keys={keys} />
      <svg viewBox={`0 0 ${W} ${y}`} width="100%" role="img" aria-label={rows.map(r => r.label).join(', ')}>
        {groups.map(({ r, y0, max }) => (
          <g key={r.label}>
            <text x={0} y={y0 - 5} className="c-label">{r.label}{r.hint ? <tspan className="c-hint"> · {r.hint}</tspan> : null}</text>
            {keys.map((k, j) => {
              const v = r.values[k];
              if (v == null) return null;
              const by = y0 + j * (barH + gap), w = Math.max(2, (v / max) * (W - labelW - 70)), rg = r.range?.[k];
              return (
                <g key={k} onMouseMove={e => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, body: <><b>{r.label}</b><br />{SERIES[k].name}: {r.fmt(v)}{rg ? <><br />range of 3 plans: {r.fmt(rg[0])} – {r.fmt(rg[1])}</> : null}</> })}>
                  <rect x={labelW} y={by - 2} width={W - 60} height={barH + 4} fill="transparent" />
                  <path d={`M${labelW} ${by} h${w - 4} a4 4 0 0 1 4 4 v${barH - 8} a4 4 0 0 1 -4 4 h${-(w - 4)} z`} fill={SERIES[k].color} />
                  {rg && <line x1={labelW + (rg[0] / max) * (W - labelW - 70)} x2={labelW + (rg[1] / max) * (W - labelW - 70)} y1={by + barH / 2} y2={by + barH / 2} className="c-range" />}
                  <text x={labelW + w + 6} y={by + barH - 1} className="c-val">{r.fmt(v)}</text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      {tip && <div className="tip" style={{ left: tip.x + 12, top: tip.y + 8 }}>{tip.body}</div>}
    </div>
  );
}

/** Time series lines on one shared axis, with a crosshair tooltip. */
export function LineSeries({ series, unit, fmt, xLabel = 'minutes after rain starts', xFmt = (v: number) => `${Math.round(v)} min` }: { series: { key: SeriesKey; xs: ArrayLike<number>; ys: ArrayLike<number> }[]; unit: string; fmt: (v: number) => string; xLabel?: string; xFmt?: (v: number) => string }) {
  const [hx, setHx] = useState<number | null>(null);
  const W = 300, H = 120, L = 34, B = 18, T = 8;
  const { xmax, ymax } = useMemo(() => {
    let xmax = 1, ymax = 1;
    for (const s of series) for (let i = 0; i < s.xs.length; i++) { xmax = Math.max(xmax, s.xs[i]); ymax = Math.max(ymax, s.ys[i]); }
    return { xmax, ymax: ymax * 1.08 };
  }, [series]);
  const sx = (x: number) => L + (x / xmax) * (W - L - 6), sy = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const ticks = [0, ymax / 2, ymax];
  const at = (s: (typeof series)[number], x: number) => { let best = 0; for (let i = 0; i < s.xs.length; i++) if (Math.abs(s.xs[i] - x) < Math.abs(s.xs[best] - x)) best = i; return best; };
  return (
    <div className="chart" onMouseLeave={() => setHx(null)}>
      <Legend keys={series.map(s => s.key)} />
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${unit} over time`}
        onMouseMove={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width * W - L) / (W - L - 6) * xmax; setHx(Math.max(0, Math.min(xmax, x))); }}>
        {ticks.map(t => <g key={t}><line x1={L} x2={W - 6} y1={sy(t)} y2={sy(t)} className="c-grid" /><text x={L - 5} y={sy(t) + 3} className="c-axis" textAnchor="end">{fmt(t)}</text></g>)}
        <text x={L} y={H - 4} className="c-axis">{xFmt(0).replace(/ min$/, '')}</text><text x={W - 6} y={H - 4} className="c-axis" textAnchor="end">{xFmt(xmax)}</text>
        <text x={(L + W) / 2} y={H - 4} className="c-axis" textAnchor="middle">{xLabel}</text>
        {series.map(s => {
          let d = '';
          for (let i = 0; i < s.xs.length; i++) d += `${i ? 'L' : 'M'}${sx(s.xs[i]).toFixed(1)} ${sy(s.ys[i]).toFixed(1)}`;
          return <path key={s.key} d={d} fill="none" stroke={SERIES[s.key].color} strokeWidth={2} strokeLinejoin="round" />;
        })}
        {hx != null && <line x1={sx(hx)} x2={sx(hx)} y1={T} y2={H - B} className="c-cross" />}
        {hx != null && series.map(s => { const i = at(s, hx); return <circle key={s.key} cx={sx(s.xs[i])} cy={sy(s.ys[i])} r={4} fill={SERIES[s.key].color} stroke="#121b26" strokeWidth={2} />; })}
      </svg>
      {hx != null && (
        <div className="tip" style={{ left: `${(sx(hx) / W) * 100}%`, top: 24 }}>
          <b>{xFmt(hx)}</b>
          {series.map(s => <div key={s.key}>{SERIES[s.key].name}: {fmt(s.ys[at(s, hx)])} {unit}</div>)}
        </div>
      )}
    </div>
  );
}

/** Single-hue share bars (one series, so no legend): where the rain went. */
export function ShareBars({ rows, total, fmt }: { rows: { label: string; value: number; note?: string }[]; total: number; fmt: (v: number) => string }) {
  const [hi, setHi] = useState<number | null>(null);
  return (
    <div className="share">
      {rows.map((r, k) => (
        <div key={r.label} className={`share-row${hi === k ? ' hi' : ''}`} onMouseEnter={() => setHi(k)} onMouseLeave={() => setHi(null)} title={r.note}>
          <span className="share-label">{r.label}</span>
          <span className="share-bar"><i style={{ width: `${Math.max(0.5, (r.value / Math.max(1, total)) * 100)}%` }} /></span>
          <span className="share-val">{fmt(r.value)} <em>{Math.round((r.value / Math.max(1, total)) * 100)}%</em></span>
        </div>
      ))}
    </div>
  );
}

/** Rain intensity strip for the timeline (single hue, one bar per frame). */
export function RainStrip({ times, rain, now, end }: { times: ArrayLike<number>; rain: ArrayLike<number>; now: number; end: number }) {
  const max = Math.max(1, ...Array.from(rain));
  return (
    <svg className="rainstrip" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden>
      {Array.from(rain).map((r, i) => <rect key={i} x={(times[i] / end) * 100} y={20 - (r / max) * 19} width={100 / rain.length + 0.05} height={(r / max) * 19} className={times[i] <= now ? 'past' : ''} />)}
    </svg>
  );
}
