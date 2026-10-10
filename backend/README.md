# HYDRA backend

An optional API for the HYDRA app. When it is up, it runs every calculation; the app falls back to the same engine in the browser when it is not. It also adds the two things a browser cannot do alone: share links and new areas.

| Feature | Route | Runs on AWS as |
|---|---|---|
| Run a storm or a hot day; recommend a plan for a budget; budget showdown | `POST /calc/flood/simulate`, `/calc/flood/optimize`, `/calc/flood/showdown`, and the same under `/calc/heat/` | ApiFunction (the engine in `src/sim`, one full vCPU) |
| Save and share a plan | `POST /plans`, `GET /plans/{id}` | DynamoDB |
| Add your own area anywhere in India | `POST /areas`, `GET /areas/{id}`, `GET /areas/{id}/data`, `GET /areas/{id}/heat` | Worker Lambda (OpenStreetMap + AWS Terrain Tiles), files in S3 |
| Health | `GET /health` | |

```
browser ── API Gateway (HTTP API) ── ApiFunction ──┬── engine     storms, sun traces, recommendations (src/sim)
                                         │         ├── DynamoDB   plans, area build status
                                         │         └── S3         built areas (served through the API)
                                         └─ async invoke ── WorkerFunction ──┬── Overpass API (OpenStreetMap)
                                                                             └── Terrain Tiles on AWS Open Data
```

### Calculations

The browser sends ids and a plan, for example `{ "siteId": "gurugram", "stormId": "heavy", "antecedent": "normal", "plan": [...] }` (heat: `scenarioId` and `windowId`; optimize and showdown add `budget`). The server loads the neighbourhood itself (the demo cities ship with the Lambda in `dist/api/data`; added areas come from S3), builds the storm or day with the same settings as the browser (`src/shared/calc.ts`), checks each intervention against the ones before it with the map's placement rules, and recomputes every cost. A bad request gets a 400 such as `Intervention 1 (pit): Recharge pits go on ground, paving or a road edge`.

`simulate` returns the whole result, including the map's animation, in a small binary format (`src/shared/wire.ts`: a JSON header plus the raw typed arrays), gzipped: 0.3–0.6 MB. Measured locally, a storm takes 0.1–0.6 s of engine time and the slowest showdown (₹2 Cr, extreme storm) under 3 s, so `optimize` and `showdown` simply return JSON, well inside API Gateway's 29 s limit; the function gets 1769 MB, one full vCPU, because the engine is single-threaded. `test/calc.test.ts` checks that every number from the API equals a direct run of the engine.

### New areas

An area build takes about a minute, longer than an API Gateway request may last. So the API stores a job, invokes the worker asynchronously and returns at once, and the app polls until the area is ready. The same spot, soil and name always give the same area, so a repeat request reuses the finished build.

The area builder is the same code as `npm run data` (`scripts/lib/site-builder.mjs` and `heat-builder.mjs`), so a new area gets the same grid, synthetic drains, trees and provenance labels as the demo cities.

## Run locally

Install the root dependencies first (the area builder uses them), then:

```bash
npm install
npm run dev        # http://localhost:8787, restarts on change (npm start runs it once)
npm test           # API tests: local storage, no AWS or network
npm run typecheck
```

Locally, records and built areas go to `backend/.data/` and area builds run inside the server process. The app's dev server looks for the API on `http://localhost:8787` unless `VITE_API_URL` says otherwise.

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `STORAGE` | `local` | `aws` for DynamoDB + S3 (set by the template) |
| `DATA_DIR` | `.data` | Local storage folder |
| `TABLE_NAME`, `BUCKET_NAME`, `WORKER_FUNCTION` | | AWS resources (set by the template) |
| `ALLOW_ORIGIN` | `*` | CORS origin |
| `PORT` | `8787` | Local server port |

## Deploy to AWS

Needs the AWS CLI and the AWS SAM CLI, with credentials for the target account.

```bash
npm install
npm run build              # bundles the two Lambdas into dist/
sam deploy                 # updates the live stack, settings in samconfig.toml
```

`samconfig.toml` holds the live stack's settings: `hydra-api` in `ap-south-1`, with `AllowOrigin` set to the demo's URL (the only parameter; `*` allows any site). For a stack of your own, run `sam deploy --guided` instead and save the answers under a new name. The app finds the API through `VITE_API_URL` at build time; for the live demo that is set in `.github/workflows/deploy.yml`, so a new stack's `ApiUrl` output goes there.

The stack creates an HTTP API (throttled to 10 requests per second), two Lambdas (Node.js 22, arm64), one DynamoDB table (on-demand) and one private S3 bucket. Remove it all with `sam delete`.

### Costs and limits to know

- Everything is pay-per-use with no fixed monthly charge. At demo scale it stays within the AWS free tier or costs a few cents.
- New areas query the public Overpass API, which asks for light use. Keep building on demand rather than in bulk.
- The API has no sign-in: anyone with the URL can save plans and build areas. That is fine for a hackathon demo; add authentication (for example Amazon Cognito) before wider use.
