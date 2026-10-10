// Background job: building a new area (Overpass + AWS terrain, 20 s to a few minutes). That outlasts an API Gateway
// request, so the API records the job, hands it to the worker Lambda (or runs it in-process locally) and the app
// polls for the result.
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { buildSite } from '../../scripts/lib/site-builder.mjs';
import { buildHeat } from '../../scripts/lib/heat-builder.mjs';
import { areaSettings, type AreaMeta } from '../../src/shared/area';
import type { Config } from './config';
import type { Store } from './store';

export type Job = { kind: 'area'; id: string };

export const areaKey = (id: string) => `area#${id}`;
export const areaFile = (id: string, kind: 'data' | 'heat') => `areas/${id}${kind === 'heat' ? '.heat' : ''}.json`;
const now = () => new Date().toISOString();

/** Starts a job: async Lambda invoke on AWS, in-process locally. Returns once the job is handed over. */
export async function dispatch(cfg: Config, store: Store, job: Job) {
  if (cfg.storage === 'aws') {
    if (!cfg.workerFunction) throw new Error('WORKER_FUNCTION is not set');
    await new LambdaClient({}).send(new InvokeCommand({ FunctionName: cfg.workerFunction, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(job)) }));
  } else {
    setImmediate(() => { runJob(store, job).catch(e => console.error('job failed', job, e)); });
  }
}

export async function runJob(store: Store, job: Job) {
  const id = job.id, meta = await store.get<AreaMeta>(areaKey(id));
  if (!meta || meta.status === 'ready') return;
  let saving = Promise.resolve(true);
  const save = (patch: Partial<AreaMeta>) => (saving = saving.then(() => store.put(areaKey(id), Object.assign(meta, patch, { updatedAt: now() }))));
  const stage = (msg: string) => { save({ status: 'building', stage: msg }); };
  try {
    stage('Starting');
    const site = await buildSite(id, areaSettings(meta.request), { stage });
    if (site.roads.length < 3) throw new Error('OpenStreetMap has almost no roads mapped here. Pick a built-up neighbourhood.');
    const heat = await buildHeat(site, { stage });
    stage('Saving the area');
    await store.putFile(areaFile(id, 'data'), JSON.stringify(site));
    await store.putFile(areaFile(id, 'heat'), JSON.stringify(heat));
    const { osmBuildings, syntheticBuildings, roads, relief } = site.stats;
    save({ status: 'ready', stage: 'Ready', summary: { id, name: site.name, city: site.city, state: site.state, blurb: site.blurb }, stats: { osmBuildings, syntheticBuildings, roads, relief } });
  } catch (e) {
    save({ status: 'failed', stage: 'Failed', error: (e as Error).message });
  }
  await saving;
}
