// Storage: small records (plans, area status) by key, and large files (built areas, ~0.5 MB of JSON each).
// AWS: records in DynamoDB, files in S3. Local: both as files under DATA_DIR.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from './config';

export interface Store {
  get<T>(key: string): Promise<T | null>;
  /** Writes a record. With `ifAbsent`, returns false instead of overwriting an existing one. */
  put(key: string, item: object, opts?: { ifAbsent?: boolean }): Promise<boolean>;
  getFile(key: string): Promise<string | null>;
  putFile(key: string, body: string): Promise<void>;
}

const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export function localStore(dir: string): Store {
  const rec = (key: string) => path.join(dir, 'records', `${safe(key)}.json`);
  const file = (key: string) => path.join(dir, 'files', ...key.split('/').map(safe));
  const read = async (f: string) => { try { return await fs.readFile(f, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } };
  const write = async (f: string, body: string, flag = 'w') => { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, body, { flag }); };
  return {
    get: async key => { const s = await read(rec(key)); return s == null ? null : JSON.parse(s); },
    put: async (key, item, opts) => {
      try { await write(rec(key), JSON.stringify(item), opts?.ifAbsent ? 'wx' : 'w'); return true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; }
    },
    getFile: key => read(file(key)),
    putFile: (key, body) => write(file(key), body),
  };
}

export function awsStore(cfg: Config): Store {
  if (!cfg.table || !cfg.bucket) throw new Error('STORAGE=aws needs TABLE_NAME and BUCKET_NAME');
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const s3 = new S3Client({});
  return {
    get: async key => ((await db.send(new GetCommand({ TableName: cfg.table, Key: { pk: key } }))).Item?.data as never) ?? null,
    put: async (key, item, opts) => {
      try {
        await db.send(new PutCommand({
          TableName: cfg.table, Item: { pk: key, data: item },
          ...(opts?.ifAbsent ? { ConditionExpression: 'attribute_not_exists(pk)' } : {}),
        }));
        return true;
      } catch (e) { if ((e as Error).name === 'ConditionalCheckFailedException') return false; throw e; }
    },
    getFile: async key => {
      try { return (await (await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }))).Body?.transformToString('utf-8')) ?? null; }
      catch (e) { if (e instanceof NoSuchKey) return null; throw e; }
    },
    putFile: async (key, body) => { await s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: 'application/json' })); },
  };
}

export const makeStore = (cfg: Config) => (cfg.storage === 'aws' ? awsStore(cfg) : localStore(cfg.dataDir));
