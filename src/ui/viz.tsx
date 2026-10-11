// Responsive charts for the analytics view. They measure their container and draw at real pixel size, so text
// stays crisp at any width. Series colours carry identity only; all text uses ink tokens; "no action" is always
// dashed or hollow so it never relies on its muted colour alone. Every chart has hover detail.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SERIES, type BarRow, type SeriesKey } from './charts';

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** A round axis maximum at or above v (1, 2, 2.5, 5 × 10ⁿ). */
export function niceMax(v: number) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

export interface LegendItem { label: string; color: string; hollow?: boolean }
export function LegendRow({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return <div className="v-legend">{items.map(i => <span key={i.label}><i style={i.hollow ? { border: `1.5px dashed ${i.color}`, background: 'none' } : { background: i.color }} />{i.label}</span>)}</div>;
}
const legendOf = (k: SeriesKey): LegendItem => ({ label: SERIES[k].name, color: SERIES[k].color, hollow: k === 'none' });

function Tip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  const right = x > w * 0.6;
  return <div className="v-tip" style={right ? { right: w - x + 12, top: y } : { left: x + 12, top: y }}>{children}</div>;
}

// ---------- time series ----------
export interface Line { key: string; label: string; color: string; dashed?: boolean; area?: boolean; xs: ArrayLike<number>; ys: ArrayLike<number> }
export const lineOf = (key: SeriesKey, xs: ArrayLike<number>, ys: ArrayLike<number>, area = false): Line => ({ key, label: SERIES[key].name, color: SERIES[key].color, dashed: key === 'none', area, xs, ys });

export function TimeChart({ lines, fmt, height = 210, xFmt = v => `${Math.round(v)}`, xLabel, marks = [] }: {
  lines: Line[]; fmt: (v: number) => string; height?: number; xFmt?: (v: number) => string; xLabel?: string; marks?: { x: number; label: string }[];
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hx, setHx] = useState<number | null>(null);
  const L = 48, R = 12, T = 10, B = 28, W = Math.max(w, 160), H = height;
  const { x0, x1, ymax } = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, ymax = 0;
    for (const l of lines) for (let i = 0; i < l.xs.length; i++) { x0 = Math.min(x0, l.xs[i]); x1 = Math.max(x1, l.xs[i]); ymax = Math.max(ymax, l.ys[i]); }
    return { x0: isFinite(x0) ? x0 : 0, x1: x1 > x0 ? x1 : x0 + 1, ymax: niceMax(ymax * 1.05) };
  }, [lines]);
  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R), sy = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const nearest = (l: Line, x: number) => { let b = 0; for (let i = 1; i < l.xs.length; i++) if (Math.abs(l.xs[i] - x) < Math.abs(l.xs[b] - x)) b = i; return b; };
  const xt = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);
  return (
    <div className="viz" ref={ref} onMouseLeave={() => setHx(null)}>
      <LegendRow items={lines.map(l => ({ label: l.label, color: l.color, hollow: l.dashed }))} />
      {w > 0 && (
        <svg width={W} height={H} role="img" aria-label={lines.map(l => l.label).join(', ')}
          onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); const x = x0 + ((e.clientX - r.left - L) / (W - L - R)) * (x1 - x0); setHx(Math.max(x0, Math.min(x1, x))); }}>
          {[0, 0.25, 0.5, 0.75, 1].map(f => <g key={f}><line className="v-grid" x1={L} x2={W - R} y1={sy(ymax * f)} y2={sy(ymax * f)} /><text className="v-axis" x={L - 6} y={sy(ymax * f) + 4} textAnchor="end">{fmt(ymax * f)}</text></g>)}
          {xt.map((x, i) => <text key={i} className="v-axis" x={sx(x)} y={H - 10} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{xFmt(x)}</text>)}
          {xLabel && <text className="v-axis" x={(L + W - R) / 2} y={H} textAnchor="middle">{xLabel}</text>}
          {marks.map(m => <g key={m.label}><line className="v-mark" x1={sx(m.x)} x2={sx(m.x)} y1={T} y2={H - B} /><text className="v-axis" x={sx(m.x) + 4} y={T + 10}>{m.label}</text></g>)}
          {lines.map(l => {
            let d = '';
            for (let i = 0; i < l.xs.length; i++) d += `${i ? 'L' : 'M'}${sx(l.xs[i]).toFixed(1)} ${sy(l.ys[i]).toFixed(1)}`;
            return (
              <g key={l.key}>
                {l.area && l.xs.length > 1 && <path d={`${d}L${sx(l.xs[l.xs.length - 1])} ${sy(0)}L${sx(l.xs[0])} ${sy(0)}Z`} fill={l.color} opacity={0.12} />}
                <path d={d} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={l.dashed ? '6 4' : undefined} />
              </g>
            );
          })}
          {hx != null && <line className="v-cross" x1={sx(hx)} x2={sx(hx)} y1={T} y2={H - B} />}
          {hx != null && lines.map(l => { const i = nearest(l, hx); return <circle key={l.key} cx={sx(l.xs[i])} cy={sy(l.ys[i])} r={4.5} fill={l.color} stroke="var(--panel-solid)" strokeWidth={2} />; })}
        </svg>
      )}
      {hx != null && w > 0 && (
        <Tip x={sx(hx)} y={18} w={W}>
          <b>{xFmt(hx)}</b>
          {lines.map(l => <div key={l.key}><i style={{ background: l.color }} />{l.label}: <b>{fmt(l.ys[nearest(l, hx)])}</b></div>)}
        </Tip>
      )}
    </div>
  );
}

// ---------- columns: one series over time (rainfall) ----------
export function Columns({ xs, ys, color, fmt, height = 170, xFmt = v => `${Math.round(v)}`, xLabel, label }: {
  xs: ArrayLike<number>; ys: ArrayLike<number>; color: string; fmt: (v: number) => string; height?: number; xFmt?: (v: number) => string; xLabel?: string; label: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const L = 48, R = 12, T = 10, B = 28, W = Math.max(w, 160), H = height, n = xs.length;
  const ymax = useMemo(() => { let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, ys[i]); return niceMax(m * 1.05); }, [ys, n]);
  const x0 = n ? xs[0] : 0, x1 = n > 1 ? xs[n - 1] : x0 + 1, step = (W - L - R) / Math.max(1, n);
  const sy = (v: number) => T + (1 - v / ymax) * (H - T - B);
  return (
    <div className="viz" ref={ref} onMouseLeave={() => setHi(null)}>
      {w > 0 && (
        <svg width={W} height={H} role="img" aria-label={label}>
          {[0, 0.5, 1].map(f => <g key={f}><line className="v-grid" x1={L} x2={W - R} y1={sy(ymax * f)} y2={sy(ymax * f)} /><text className="v-axis" x={L - 6} y={sy(ymax * f) + 4} textAnchor="end">{fmt(ymax * f)}</text></g>)}
          {Array.from({ length: n }, (_, i) => {
            const h = sy(0) - sy(ys[i]);
            return <rect key={i} x={L + i * step + step * 0.12} y={sy(ys[i])} width={Math.max(1, step * 0.76)} height={Math.max(0, h)} rx={1.5} fill={color} opacity={hi == null || hi === i ? 1 : 0.45}
              onMouseEnter={() => setHi(i)} />;
          })}
          <text className="v-axis" x={L} y={H - 10}>{xFmt(x0)}</text>
          <text className="v-axis" x={W - R} y={H - 10} textAnchor="end">{xFmt(x1)}</text>
          {xLabel && <text className="v-axis" x={(L + W - R) / 2} y={H - 10} textAnchor="middle">{xLabel}</text>}
        </svg>
      )}
      {hi != null && w > 0 && <Tip x={L + hi * step} y={12} w={W}><b>{xFmt(xs[hi])}</b><div>{label}: <b>{fmt(ys[hi])}</b></div></Tip>}
    </div>
  );
}

// ---------- grouped histogram: a distribution under several scenarios ----------
export interface HistSeries { key: SeriesKey; values: number[] }
export function Histogram({ bins, series, fmt, height = 210, xLabel }: { bins: string[]; series: HistSeries[]; fmt: (v: number) => string; height?: number; xLabel?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const L = 52, R = 12, T = 10, B = xLabel ? 40 : 26, W = Math.max(w, 160), H = height;
  const ymax = niceMax(Math.max(0, ...series.flatMap(s => s.values)) * 1.08);
  const gw = (W - L - R) / bins.length, bw = Math.min(30, (gw * 0.74) / series.length);
  const sy = (v: number) => T + (1 - v / ymax) * (H - T - B);
  return (
    <div className="viz" ref={ref} onMouseLeave={() => setHi(null)}>
      <LegendRow items={series.map(s => legendOf(s.key))} />
      {w > 0 && (
        <svg width={W} height={H} role="img" aria-label={bins.join(', ')}>
          {[0, 0.25, 0.5, 0.75, 1].map(f => <g key={f}><line className="v-grid" x1={L} x2={W - R} y1={sy(ymax * f)} y2={sy(ymax * f)} /><text className="v-axis" x={L - 6} y={sy(ymax * f) + 4} textAnchor="end">{fmt(ymax * f)}</text></g>)}
          {bins.map((b, i) => {
            const gx = L + i * gw + (gw - bw * series.length - 2 * (series.length - 1)) / 2;
            return (
              <g key={b} onMouseEnter={() => setHi(i)}>
                <rect x={L + i * gw} y={T} width={gw} height={H - T - B} fill={hi === i ? 'rgba(148,178,210,.06)' : 'transparent'} />
                {series.map((s, j) => {
                  const v = s.values[i] ?? 0, y = sy(v), hollow = s.key === 'none';
                  return <rect key={s.key} x={gx + j * (bw + 2)} y={y} width={bw} height={Math.max(0, sy(0) - y)} rx={2}
                    fill={hollow ? 'rgba(138,150,166,.12)' : SERIES[s.key].color} stroke={hollow ? SERIES[s.key].color : 'none'} strokeWidth={hollow ? 1.5 : 0} strokeDasharray={hollow ? '3 2' : undefined} />;
                })}
                <text className="v-axis" x={L + i * gw + gw / 2} y={H - B + 14} textAnchor="middle">{b}</text>
              </g>
            );
          })}
          {xLabel && <text className="v-axis" x={(L + W - R) / 2} y={H - 4} textAnchor="middle">{xLabel}</text>}
        </svg>
      )}
      {hi != null && w > 0 && (
        <Tip x={L + hi * gw + gw / 2} y={12} w={W}>
          <b>{bins[hi]}</b>
          {series.map(s => <div key={s.key}><i style={{ background: SERIES[s.key].color }} />{SERIES[s.key].name}: <b>{fmt(s.values[hi] ?? 0)}</b></div>)}
        </Tip>
      )}
    </div>
  );
}

// ---------- horizontal bars (HTML, so long labels wrap) ----------
export interface HBar { label: string; sub?: ReactNode; value: number; color?: string; hollow?: boolean; onClick?: () => void }
export function HBars({ rows, fmt, max }: { rows: HBar[]; fmt: (v: number) => string; max?: number }) {
  const m = max ?? Math.max(1e-9, ...rows.map(r => Math.abs(r.value)));
  return (
    <div className="hbars">
      {rows.map((r, k) => {
        const Tag = r.onClick ? 'button' : 'div';
        return (
          <Tag key={k} className={`hbar${r.onClick ? ' click' : ''}`} onClick={r.onClick}>
            <span className="hbar-label">{r.label}{r.sub && <small>{r.sub}</small>}</span>
            <span className="hbar-track"><i style={{ width: `${Math.max(0.6, (Math.abs(r.value) / m) * 100)}%`, ...(r.hollow ? { background: 'none', border: `1.5px dashed ${r.color}` } : { background: r.color ?? 'var(--accent)' }) }} /></span>
            <span className="hbar-val">{fmt(r.value)}</span>
          </Tag>
        );
      })}
    </div>
  );
}

/** Metric-by-metric comparison of scenarios; each metric has its own scale. Spread shows its range across plans. */
export function GroupedBars({ rows, keys }: { rows: BarRow[]; keys: SeriesKey[] }) {
  return (
    <div className="gbars">
      <LegendRow items={keys.map(legendOf)} />
      {rows.map(r => {
        const max = Math.max(1e-9, ...keys.map(k => Math.max(r.values[k] ?? 0, r.range?.[k]?.[1] ?? 0)));
        return (
          <div key={r.label} className="gbar">
            <div className="gbar-head"><b>{r.label}</b>{r.hint && <small>{r.hint}</small>}</div>
            {keys.map(k => {
              const v = r.values[k];
              if (v == null) return null;
              const rg = r.range?.[k], hollow = k === 'none';
              return (
                <div key={k} className="gbar-row" title={`${SERIES[k].name}: ${r.fmt(v)}${rg ? ` (range ${r.fmt(rg[0])} – ${r.fmt(rg[1])})` : ''}`}>
                  <span className="hbar-track">
                    <i style={{ width: `${Math.max(0.6, (v / max) * 100)}%`, ...(hollow ? { background: 'none', border: `1.5px dashed ${SERIES[k].color}` } : { background: SERIES[k].color }) }} />
                    {rg && <em className="gbar-range" style={{ left: `${(rg[0] / max) * 100}%`, width: `${Math.max(0.5, ((rg[1] - rg[0]) / max) * 100)}%` }} />}
                  </span>
                  <span className="hbar-val">{r.fmt(v)}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---------- scatter: cost against benefit ----------
export interface Pt { id: string; label: string; x: number; y: number; color: string; hollow?: boolean; r?: number; note?: string }
export function Scatter({ pts, xFmt, yFmt, xLabel, yLabel, height = 280 }: { pts: Pt[]; xFmt: (v: number) => string; yFmt: (v: number) => string; xLabel: string; yLabel: string; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<string | null>(null);
  const L = 54, R = 20, T = 14, B = 42, W = Math.max(w, 200), H = height;
  const xmax = niceMax(Math.max(1, ...pts.map(p => p.x)) * 1.12), ylo = Math.min(0, ...pts.map(p => p.y)), ymax = niceMax(Math.max(1, ...pts.map(p => p.y)) * 1.12);
  const sx = (x: number) => L + (x / xmax) * (W - L - R), sy = (y: number) => T + (1 - (y - ylo) / (ymax - ylo)) * (H - T - B);
  const h = pts.find(p => p.id === hi);
  return (
    <div className="viz" ref={ref} onMouseLeave={() => setHi(null)}>
      {w > 0 && (
        <svg width={W} height={H} role="img" aria-label={`${yLabel} against ${xLabel}`}>
          {[0, 0.25, 0.5, 0.75, 1].map(f => { const y = ylo + (ymax - ylo) * f; return <g key={f}><line className="v-grid" x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} /><text className="v-axis" x={L - 6} y={sy(y) + 4} textAnchor="end">{yFmt(y)}</text></g>; })}
          {[0, 0.25, 0.5, 0.75, 1].map(f => <text key={f} className="v-axis" x={sx(xmax * f)} y={H - 24} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>{xFmt(xmax * f)}</text>)}
          <text className="v-axis" x={(L + W - R) / 2} y={H - 6} textAnchor="middle">{xLabel}</text>
          <text className="v-axis" transform={`translate(12 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
          {pts.map(p => {
            const x = sx(p.x), y = sy(p.y), r = p.r ?? 7, right = x > W * 0.66;
            return (
              <g key={p.id} onMouseEnter={() => setHi(p.id)}>
                <circle cx={x} cy={y} r={r + 6} fill="transparent" />
                <circle cx={x} cy={y} r={r} fill={p.hollow ? 'var(--panel-solid)' : p.color} stroke={p.hollow ? p.color : 'var(--panel-solid)'} strokeWidth={2} strokeDasharray={p.hollow ? '3 2' : undefined} />
                <text className="v-pt" x={right ? x - r - 6 : x + r + 6} y={y + 4} textAnchor={right ? 'end' : 'start'}>{p.label}</text>
              </g>
            );
          })}
        </svg>
      )}
      {h && w > 0 && <Tip x={sx(h.x)} y={Math.max(8, sy(h.y) - 40)} w={W}><b>{h.label}</b><div>{xLabel}: <b>{xFmt(h.x)}</b></div><div>{yLabel}: <b>{yFmt(h.y)}</b></div>{h.note && <div>{h.note}</div>}</Tip>}
    </div>
  );
}

// ---------- donut: shares of one total ----------
export function Donut({ parts, center, sub }: { parts: { label: string; color: string; value: number }[]; center: string; sub?: string }) {
  const [hi, setHi] = useState<number | null>(null);
  const total = parts.reduce((a, p) => a + p.value, 0), R = 46, C = 2 * Math.PI * R, gap = parts.filter(p => p.value > 0).length > 1 ? 2 : 0;
  let off = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" width={150} height={150} role="img" aria-label={parts.map(p => `${p.label} ${Math.round((p.value / Math.max(1e-9, total)) * 100)}%`).join(', ')}>
        <circle cx={60} cy={60} r={R} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={16} />
        {parts.map((p, k) => {
          const len = total > 0 ? (p.value / total) * C : 0, seg = Math.max(0, len - gap);
          const el = <circle key={k} cx={60} cy={60} r={R} fill="none" stroke={p.color} strokeWidth={hi === k ? 19 : 16} strokeDasharray={`${seg} ${C - seg}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" onMouseEnter={() => setHi(k)} onMouseLeave={() => setHi(null)} />;
          off += len;
          return el;
        })}
        <text x={60} y={hi == null ? 60 : 57} textAnchor="middle" className="donut-c">{hi == null ? center : `${Math.round((parts[hi].value / Math.max(1e-9, total)) * 100)}%`}</text>
        <text x={60} y={74} textAnchor="middle" className="donut-s">{hi == null ? sub : parts[hi].label.slice(0, 18)}</text>
      </svg>
      <ul className="donut-key">{parts.filter(p => p.value > 0).map(p => <li key={p.label}><i style={{ background: p.color }} />{p.label}<b>{total > 0 ? Math.round((p.value / total) * 100) : 0}%</b></li>)}</ul>
    </div>
  );
}

// ---------- stacked rows: how each strategy splits its spend ----------
export function StackRows({ rows, fmt }: { rows: { label: string; parts: { label: string; color: string; value: number }[] }[]; fmt: (v: number) => string }) {
  const max = Math.max(1e-9, ...rows.map(r => r.parts.reduce((a, p) => a + p.value, 0)));
  const keys = [...new Map(rows.flatMap(r => r.parts.filter(p => p.value > 0)).map(p => [p.label, p])).values()];
  return (
    <div className="stacks">
      <LegendRow items={keys.map(p => ({ label: p.label, color: p.color }))} />
      {rows.map(r => {
        const t = r.parts.reduce((a, p) => a + p.value, 0);
        return (
          <div key={r.label} className="stack-row">
            <span className="hbar-label">{r.label}</span>
            <span className="stack-track" style={{ width: `${(t / max) * 100}%` }}>{r.parts.filter(p => p.value > 0).map(p => <i key={p.label} title={`${p.label}: ${fmt(p.value)}`} style={{ flex: p.value, background: p.color }} />)}</span>
            <span className="hbar-val">{fmt(t)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A tiny trend line for a stat card. */
export function Spark({ ys, color, base }: { ys: ArrayLike<number>; color: string; base?: ArrayLike<number> }) {
  const n = ys.length;
  if (n < 2) return null;
  let m = 1e-9;
  for (let i = 0; i < n; i++) m = Math.max(m, ys[i], base ? base[i] ?? 0 : 0);
  const path = (a: ArrayLike<number>) => Array.from({ length: n }, (_, i) => `${i ? 'L' : 'M'}${((i / (n - 1)) * 100).toFixed(2)} ${(26 - (a[i] / m) * 24).toFixed(2)}`).join('');
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden>
      {base && <path d={path(base)} fill="none" stroke={SERIES.none.color} strokeWidth={1.5} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
      <path d={path(ys)} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------- sortable table ----------
export interface Col<T> { key: string; label: string; num?: boolean; render: (r: T) => ReactNode; sort?: (r: T) => number | string }
export function DataTable<T>({ cols, rows, initial, onRow, max = 12 }: { cols: Col<T>[]; rows: T[]; initial?: string; onRow?: (r: T) => void; max?: number }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initial ? { key: initial, dir: -1 } : null);
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => {
    const c = cols.find(x => x.key === sort?.key);
    if (!c?.sort || !sort) return rows;
    return [...rows].sort((a, b) => { const x = c.sort!(a), y = c.sort!(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [rows, cols, sort]);
  const shown = all ? sorted : sorted.slice(0, max);
  return (
    <div className="dtable">
      <table>
        <thead><tr>{cols.map(c => (
          <th key={c.key} className={c.num ? 'num' : ''}>
            {c.sort ? <button onClick={() => setSort(s => ({ key: c.key, dir: s?.key === c.key && s.dir === -1 ? 1 : -1 }))}>{c.label}{sort?.key === c.key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}</button> : c.label}
          </th>
        ))}</tr></thead>
        <tbody>{shown.map((r, k) => <tr key={k} className={onRow ? 'click' : ''} onClick={onRow ? () => onRow(r) : undefined}>{cols.map(c => <td key={c.key} className={c.num ? 'num' : ''}>{c.render(r)}</td>)}</tr>)}</tbody>
      </table>
      {rows.length > max && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
    </div>
  );
}

// ---------- CSV export ----------
export type CsvTable = { title: string; rows: (string | number)[][] };
export function downloadCsv(name: string, tables: CsvTable[]) {
  const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = tables.map(t => [t.title, ...t.rows.map(r => r.map(esc).join(','))].join('\n')).join('\n\n');
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
