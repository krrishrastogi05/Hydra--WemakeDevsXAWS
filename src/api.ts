// Client for the HYDRA API (backend/): saved plans and new areas. The simulator itself never needs it;
// without an API (no VITE_API_URL in a production build) the app stays a static site and these features step aside.
import { create } from 'zustand';
import { isCustomSite, type AreaMeta, type AreaRequest } from './shared/area';
import type { NewPlan, SavedPlan } from './shared/plan';
import type { SiteSummary } from './sim/types';

export const API_URL = String(import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')).replace(/\/+$/, '');

interface Health { ok: boolean; storage: string }
export const useBackend = create<{ status: 'off' | 'checking' | 'up' | 'down'; health: Health | null }>(() => ({ status: API_URL ? 'checking' : 'off', health: null }));

export async function checkBackend() {
  if (!API_URL) return;
  try { useBackend.setState({ status: 'up', health: await call<Health>('GET', '/health') }); }
  catch { useBackend.setState({ status: 'down', health: null }); }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const r = await fetch(API_URL + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `HYDRA API error ${r.status}`);
  return data as T;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Calls `get` every `everyMs` until `done` holds, or throws after `timeoutMs`. */
async function poll<T>(get: () => Promise<T>, done: (t: T) => boolean, everyMs: number, timeoutMs: number, onTick?: (t: T) => void) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const t = await get();
    onTick?.(t);
    if (done(t)) return t;
    if (Date.now() > end) throw new Error('Timed out waiting for the HYDRA API');
    await sleep(everyMs);
  }
}

export const api = {
  savePlan: (p: NewPlan) => call<{ id: string }>('POST', '/plans', p),
  getPlan: (id: string) => call<SavedPlan>('GET', `/plans/${encodeURIComponent(id)}`),
  createArea: (r: AreaRequest) => call<AreaMeta>('POST', '/areas', r),
  getArea: (id: string) => call<AreaMeta>('GET', `/areas/${encodeURIComponent(id)}`),
  /** Polls an area build until it is ready or failed, reporting each status. */
  waitForArea: (id: string, onTick: (a: AreaMeta) => void) => poll(() => api.getArea(id), a => a.status === 'ready' || a.status === 'failed', 2000, 10 * 60_000, onTick),
};

/** Where a site's data lives: the bundled demo sites ship with the app, custom areas come from the API. */
export const siteDataUrl = (id: string, kind: 'data' | 'heat') =>
  isCustomSite(id) ? `${API_URL}/areas/${id}/${kind}` : `${import.meta.env.BASE_URL}data/${id}${kind === 'heat' ? '.heat' : ''}.json`;

// Areas this browser has added or opened, so they stay in the neighbourhood list (a per-viewer convenience).
const AREAS_KEY = 'hydra-areas';
export function savedAreas(): SiteSummary[] {
  try { const v = JSON.parse(localStorage.getItem(AREAS_KEY) ?? '[]'); return Array.isArray(v) ? v.filter(a => isCustomSite(a?.id)) : []; } catch { return []; }
}
export function rememberArea(a: SiteSummary) {
  const list = [a, ...savedAreas().filter(x => x.id !== a.id)].slice(0, 12);
  try { localStorage.setItem(AREAS_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  return list;
}
