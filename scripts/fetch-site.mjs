// HYDRA data pipeline: OpenStreetMap (Overpass) + Terrain Tiles on the AWS Registry of Open Data
// -> public/data/<site>.json, a 5 m simulation grid with buildings, roads, drains and terrain.
// Usage: node scripts/fetch-site.mjs [siteId ...]      (default: all sites)
// Raw downloads are cached in data/raw so re-runs are offline and reproducible. The builder itself lives in
// scripts/lib/site-builder.mjs, shared with the backend's "add your own area" job.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './lib/site-builder.mjs';
import { SITES } from './lib/demo-sites.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// data/raw as the download cache
const cache = {
  get: async key => { const f = path.join(RAW, key); return fs.existsSync(f) ? fs.readFileSync(f) : null; },
  set: async (key, buf) => fs.writeFileSync(path.join(RAW, key), buf),
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SITES);
for (const id of ids) {
  if (!SITES[id]) { console.error('unknown site', id); continue; }
  const out = await buildSite(id, SITES[id], { cache });
  const file = path.join(OUT, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`  wrote public/data/${id}.json (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  await sleep(2000);   // be polite to Overpass
}
fs.writeFileSync(path.join(OUT, 'sites.json'), JSON.stringify(Object.entries(SITES).map(([id, s]) => ({ id, name: s.name, city: s.city, state: s.state, blurb: s.blurb }))));
