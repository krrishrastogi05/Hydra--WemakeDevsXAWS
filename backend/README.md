# HYDRA backend

An optional API for the HYDRA app. The simulator and the officer brief run entirely in the browser; this adds the two things a browser cannot do alone:

| Feature | Route | Runs on AWS as |
|---|---|---|
| Save and share a plan | `POST /plans`, `GET /plans/{id}` | DynamoDB |
| Add your own area anywhere in India | `POST /areas`, `GET /areas/{id}`, `GET /areas/{id}/data`, `GET /areas/{id}/heat` | Worker Lambda (OpenStreetMap + AWS Terrain Tiles), files in S3 |
| Health | `GET /health` | |

```
browser ── API Gateway (HTTP API) ── ApiFunction ──┬── DynamoDB   plans, area build status
                                         │         └── S3         built areas (served through the API)
                                         └─ async invoke ── WorkerFunction ──┬── Overpass API (OpenStreetMap)
                                                                             └── Terrain Tiles on AWS Open Data
```

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
sam deploy --guided        # first time; later just: sam deploy
```

The only parameter is `AllowOrigin`: `*` while testing, then your Amplify URL. Copy the `ApiUrl` output into Amplify as the environment variable `VITE_API_URL` and redeploy the app.

The stack creates an HTTP API (throttled to 10 requests per second), two Lambdas (Node.js 22, arm64), one DynamoDB table (on-demand) and one private S3 bucket. Remove it all with `sam delete`.

### Costs and limits to know

- Everything is pay-per-use with no fixed monthly charge. At demo scale it stays within the AWS free tier or costs a few cents.
- New areas query the public Overpass API, which asks for light use. Keep building on demand rather than in bulk.
- The API has no sign-in: anyone with the URL can save plans and build areas. That is fine for a hackathon demo; add authentication (for example Amazon Cognito) before wider use.
