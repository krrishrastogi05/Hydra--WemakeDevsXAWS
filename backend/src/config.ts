// Settings from the environment. Locally everything defaults to files on disk; template.yaml sets the AWS values
// for the deployed Lambdas.
import path from 'node:path';

export function config() {
  const env = process.env;
  return {
    storage: env.STORAGE === 'aws' ? 'aws' as const : 'local' as const,
    dataDir: path.resolve(env.DATA_DIR ?? '.data'),          // local storage
    table: env.TABLE_NAME ?? '',                               // aws storage: DynamoDB table
    bucket: env.BUCKET_NAME ?? '',                             // aws storage: S3 bucket for built areas
    workerFunction: env.WORKER_FUNCTION ?? '',                 // aws: Lambda that builds new areas
    allowOrigin: env.ALLOW_ORIGIN || '*',
  };
}
export type Config = ReturnType<typeof config>;
