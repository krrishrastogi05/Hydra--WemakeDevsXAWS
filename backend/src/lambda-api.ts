// Lambda entry for the HTTP API (API Gateway HTTP API, payload format 2.0).
import { handle } from './api';
import { config } from './config';
import { makeStore } from './store';

interface HttpEvent {
  rawPath: string; body?: string; isBase64Encoded?: boolean; headers?: Record<string, string | undefined>;
  requestContext: { http: { method: string } };
}

const cfg = config(), store = makeStore(cfg);

export async function handler(event: HttpEvent) {
  const body = event.body == null ? null : event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const res = await handle(cfg, store, {
    method: event.requestContext.http.method, path: event.rawPath, body,
    acceptGzip: /\bgzip\b/.test(event.headers?.['accept-encoding'] ?? ''),
  });
  const binary = Buffer.isBuffer(res.body);
  return { statusCode: res.status, headers: res.headers, body: binary ? (res.body as Buffer).toString('base64') : res.body, isBase64Encoded: binary };
}
