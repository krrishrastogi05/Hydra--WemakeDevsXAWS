// Lambda entry for background jobs, invoked asynchronously by the API Lambda with { kind: 'area', id }.
import { config } from './config';
import { runJob, type Job } from './jobs';
import { makeStore } from './store';

const store = makeStore(config());

export async function handler(job: Job) {
  if (job?.kind !== 'area' || typeof job.id !== 'string') throw new Error('Unknown job');
  await runJob(store, job);
}
