// Response helpers shared by the routes in api.ts and calc.ts.
import { gzipSync } from 'node:zlib';
import type { Config } from './config';

export interface Req { method: string; path: string; body: string | null; acceptGzip?: boolean }
export interface Res { status: number; headers: Record<string, string>; body: string | Buffer }

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export const cors = (cfg: Config) => ({
  'access-control-allow-origin': cfg.allowOrigin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400',
});

export function json(cfg: Config, status: number, body: unknown, extra: Record<string, string> = {}): Res {
  return { status, headers: { ...cors(cfg), 'content-type': 'application/json', 'cache-control': 'no-store', ...extra }, body: JSON.stringify(body) };
}

/** A 200 response, gzipped when the client accepts it (API Gateway does not compress for us). */
export function send(cfg: Config, body: string | Uint8Array, type: string, gzip: boolean, extra: Record<string, string> = {}): Res {
  const headers = { ...cors(cfg), 'content-type': type, 'cache-control': 'no-store', ...extra };
  const raw = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  return gzip ? { status: 200, headers: { ...headers, 'content-encoding': 'gzip' }, body: gzipSync(raw) } : { status: 200, headers, body: raw };
}
