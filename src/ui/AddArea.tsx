// "Add your own area": pick a spot in India on a map (or search for it), and the backend builds a new 600 m × 600 m
// neighbourhood from OpenStreetMap and AWS Terrain Tiles. Loaded lazily, with Leaflet, only when opened.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, rememberArea, savedAreas } from '../api';
import { INDIA, SOILS, isCustomSite, type AreaMeta, type SoilId } from '../shared/area';
import { useStore } from '../store';
import { Icon } from './Chrome';

interface Place { display_name: string; lat: string; lon: string; address?: Record<string, string> }
const HALF_M = 300;

export default function AddArea() {
  const close = () => useStore.setState({ addArea: false });
  const mapEl = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), box = useRef<L.Rectangle | null>(null);
  const [pt, setPt] = useState<{ lat: number; lon: number } | null>(null);
  const [form, setForm] = useState({ name: '', city: '', state: '', soil: 'loam' as SoilId });
  const [q, setQ] = useState(''), [places, setPlaces] = useState<Place[] | null>(null), [searching, setSearching] = useState(false);
  const [job, setJob] = useState<AreaMeta | null>(null), [error, setError] = useState(''), [started, setStarted] = useState(0), [, tick] = useState(0);
  const mine = savedAreas();

  const pick = (lat: number, lon: number, fly = false) => {
    setPt({ lat, lon });
    const dLat = HALF_M / 111320, dLon = HALF_M / (111320 * Math.cos((lat * Math.PI) / 180));
    const bounds = L.latLngBounds([lat - dLat, lon - dLon], [lat + dLat, lon + dLon]);
    if (box.current) box.current.setBounds(bounds);
    else if (map.current) box.current = L.rectangle(bounds, { color: '#38bdf8', weight: 2, fillOpacity: 0.15 }).addTo(map.current);
    if (fly) map.current?.setView([lat, lon], 16);
  };

  useEffect(() => {
    if (!mapEl.current) return;
    const m = L.map(mapEl.current, { center: [22.6, 79.5], zoom: 5, minZoom: 4, maxBounds: [[INDIA.s - 4, INDIA.w - 6], [INDIA.n + 4, INDIA.e + 6]] });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
    m.on('click', e => pick(e.latlng.lat, e.latlng.lng));
    map.current = m;
    return () => { m.remove(); map.current = null; box.current = null; };
  }, []);
  useEffect(() => { if (!started || !job || job.status === 'ready' || job.status === 'failed') return; const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, [started, job]);

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=in&limit=5&q=${encodeURIComponent(q.trim())}`);
      setPlaces(r.ok ? await r.json() : []);
    } catch { setPlaces([]); }
    setSearching(false);
  };
  const choose = (p: Place) => {
    const a = p.address ?? {};
    pick(+p.lat, +p.lon, true);
    setForm(f => ({ ...f, name: a.neighbourhood || a.suburb || a.quarter || a.village || a.residential || p.display_name.split(',')[0], city: a.city || a.town || a.state_district || a.county || '', state: a.state || '' }));
    setPlaces(null);
  };

  const build = async () => {
    if (!pt) return;
    setError(''); setStarted(Date.now());
    try {
      let meta = await api.createArea({ lat: pt.lat, lon: pt.lon, ...form });
      setJob(meta);
      if (meta.status !== 'ready') meta = await api.waitForArea(meta.id, setJob);
      if (meta.status === 'ready' && meta.summary) open(meta.summary.id, rememberArea(meta.summary));
      else setError(meta.error ?? 'The build did not finish');
    } catch (e) { setError((e as Error).message); }
    setStarted(0);
  };
  const open = (id: string, list = savedAreas()) => {
    const st = useStore.getState();
    useStore.setState({ sites: [...st.sites.filter(s => !isCustomSite(s.id)), ...list], addArea: false });
    st.loadSite(id);
  };

  const busy = !!started;
  return (
    <div className="modal-back" onClick={busy ? undefined : close}>
      <div className="modal addarea" onClick={e => e.stopPropagation()} role="dialog" aria-label="Add your own area">
        <div className="brief-head">
          <h2><Icon name="target" size={20} /> Add your own area</h2>
          <button className="link close" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </div>
        <p className="sub">Click a built-up neighbourhood anywhere in India, or search for it. HYDRA builds a 600 m × 600 m area from OpenStreetMap and AWS Terrain Tiles, the same way as the three demo cities. It takes about a minute.</p>
        <form className="area-search" onSubmit={e => { e.preventDefault(); search(); }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a locality, e.g. Koramangala, Bengaluru" aria-label="Search a place" disabled={busy} />
          <button className="btn" disabled={searching || busy}>{searching ? 'Searching…' : 'Search'}</button>
        </form>
        {places && (
          <ul className="places">
            {places.map((p, k) => <li key={k}><button className="link" onClick={() => choose(p)}>{p.display_name}</button></li>)}
            {!places.length && <li className="muted">No match in India. Try a nearby landmark, or click the map.</li>}
          </ul>
        )}
        <div className="areamap" ref={mapEl} />
        <div className="area-form">
          <label>Area name<input value={form.name} maxLength={60} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Koramangala 4th Block" disabled={busy} /></label>
          <label>City<input value={form.city} maxLength={40} onChange={e => setForm({ ...form, city: e.target.value })} disabled={busy} /></label>
          <label>State<input value={form.state} maxLength={40} onChange={e => setForm({ ...form, state: e.target.value })} disabled={busy} /></label>
          <label>Soil<select value={form.soil} onChange={e => setForm({ ...form, soil: e.target.value as SoilId })} disabled={busy}>{(Object.keys(SOILS) as SoilId[]).map(k => <option key={k} value={k}>{SOILS[k].label}</option>)}</select></label>
        </div>
        <div className="row-actions">
          <button className="btn primary" onClick={build} disabled={!pt || !form.name.trim() || busy}>{busy ? 'Building…' : 'Build this area'}</button>
          <span className="fine">{pt ? `${pt.lat.toFixed(4)}° N, ${pt.lon.toFixed(4)}° E` : 'No spot picked yet'}</span>
        </div>
        {busy && job && <div className="progress"><div className="bar indeterminate"><i /></div><span>{job.stage} · {Math.round((Date.now() - started) / 1000)} s</span></div>}
        {error && <div className="callout">{error}</div>}
        {mine.length > 0 && (
          <>
            <h4>Your areas</h4>
            <div className="chips">{mine.map(a => <button key={a.id} className="chip" onClick={() => open(a.id)} disabled={busy}>{a.name}{a.city ? `, ${a.city}` : ''}</button>)}</div>
          </>
        )}
        <p className="fine">Building and roads come from OpenStreetMap, so areas OSM maps well work best. Drains, plinths, trees and missing buildings are filled in synthetically and labelled, as in the demo cities.</p>
      </div>
    </div>
  );
}
