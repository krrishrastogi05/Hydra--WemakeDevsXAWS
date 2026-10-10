// Local dev server: the same API as the Lambdas, with files under backend/.data and jobs run in-process.
// npm run dev (from backend/), then point the app at it with VITE_API_URL=http://localhost:8787 (the default in dev).
import http from 'node:http';
import { handle } from './api';
import { config } from './config';
import { makeStore } from './store';

const cfg = config(), store = makeStore(cfg), port = Number(process.env.PORT ?? 8787);

http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const out = await handle(cfg, store, {
    method: req.method ?? 'GET', path: new URL(req.url ?? '/', 'http://x').pathname,
    body: chunks.length ? Buffer.concat(chunks).toString('utf8') : null,
    acceptGzip: /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')),
  });
  res.writeHead(out.status, out.headers);
  res.end(out.body);
}).listen(port, () => {
  console.log(`HYDRA API on http://localhost:${port} (storage: ${cfg.storage === 'local' ? cfg.dataDir : 'aws'})`);
});
