// HYDRA heat-mode data: trees and pedestrian places (bus stops, markets, school gates, parks)
// -> public/data/<site>.heat.json. Reads the flood pipeline's public/data/<site>.json for the shared grid and never writes it.
// Usage: node scripts/fetch-heat.mjs [siteId ...]      (default: every site in public/data/sites.json)
// Raw downloads are cached in data/raw/<site>.heat.osm.json so re-runs are offline and reproducible. The builder itself
// lives in scripts/lib/heat-builder.mjs, shared with the backend's "add your own area" job.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHeat } from './lib/heat-builder.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data');
fs.mkdirSync(RAW, { recursive: true });

const cache = {
  get: async key => { const f = path.join(RAW, key); return fs.existsSync(f) ? fs.readFileSync(f) : null; },
  set: async (key, buf) => fs.writeFileSync(path.join(RAW, key), buf),
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const all = JSON.parse(fs.readFileSync(path.join(OUT, 'sites.json'), 'utf8')).map(s => s.id);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : all;
for (const id of ids) {
  const site = JSON.parse(fs.readFileSync(path.join(OUT, `${id}.json`), 'utf8'));
  const out = await buildHeat(site, { cache });
  const file = path.join(OUT, `${id}.heat.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`  wrote public/data/${id}.heat.json (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  await sleep(1500);
}
