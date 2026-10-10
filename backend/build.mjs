// Bundles the two Lambdas into dist/api and dist/worker (one self-contained index.js each) for template.yaml.
// The API also gets the demo cities' data (public/data) in dist/api/data, for the /calc routes.
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

for (const [name, entry] of [['api', 'src/lambda-api.ts'], ['worker', 'src/lambda-worker.ts']]) {
  rmSync(`dist/${name}`, { recursive: true, force: true });
  await build({
    entryPoints: [entry], outfile: `dist/${name}/index.js`,
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true, sourcemap: 'linked', legalComments: 'none',
  });
  writeFileSync(`dist/${name}/package.json`, '{ "type": "commonjs" }\n');   // backend/ itself is an ES module package
  console.log(`built dist/${name}/index.js`);
}
cpSync('../public/data', 'dist/api/data', { recursive: true });
console.log('copied public/data to dist/api/data');
