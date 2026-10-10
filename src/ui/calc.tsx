// Shared by the flood and heat panels: where a result was calculated, and the progress of a long calculation.
import { apiRegion, useBackend } from '../api';
import type { CalcSource } from '../shared/calc';

export function CalcSourceTag({ source }: { source?: CalcSource }) {
  const api = useBackend(s => s.status);
  if (!source) return null;
  if (source === 'server') {
    return apiRegion
      ? <p className="calc-src server" title="Every number here was calculated by the HYDRA API on AWS Lambda; the browser only draws it">Calculated on AWS Lambda ({apiRegion})</p>
      : <p className="calc-src server" title="Every number here was calculated by the HYDRA API; the browser only draws it">Calculated by the HYDRA API</p>;
  }
  return api === 'up'
    ? <p className="calc-src" title="The HYDRA API did not answer, so the same engine ran in this browser">Calculated in your browser: the API did not answer</p>
    : <p className="calc-src" title="No HYDRA API is set up for this copy of the app, so the engine runs in this browser">Calculated in your browser</p>;
}

/** p from 0 to 1, or below 0 while waiting on the API, which reports no progress. */
export function ProgressBar({ busy }: { busy: { p: number; msg: string } | null }) {
  if (!busy) return null;
  return (
    <div className="progress">
      <div className={`bar${busy.p < 0 ? ' indeterminate' : ''}`}><i style={busy.p < 0 ? undefined : { width: `${Math.round(busy.p * 100)}%` }} /></div>
      <span>{busy.msg}</span>
    </div>
  );
}
