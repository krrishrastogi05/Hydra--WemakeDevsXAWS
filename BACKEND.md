# HYDRA backend: design

This page covers HYDRA's calculation backend: what it computes, how each intervention's numbers are worked out, the API, and how to deploy it. For the project overview see `README.md`; for status and priorities see `DIRECTION.md`.

**Status: planned.** Nothing on this page is built yet. Section 10 gives the build order.

---

## 1. Why a backend

Today the whole engine (`src/sim/**`) runs inside the browser, in Web Workers. That works for a demo, but it leaves three gaps:

| Gap today | What the backend changes |
|---|---|
| The calculations happen out of sight on the user's machine, and there is no server of record. | An AWS Lambda API does every calculation. The browser only draws the results. |
| Only four preset storms. You cannot say "120 mm fell in 90 minutes". | The user enters any rainfall (total mm, duration, storm shape). The server checks it, classifies it by IMD category, and uses exactly that rain. |
| Results show totals only, such as "pits took 31 m³". You cannot see what *this* pit did. | Every intervention gets its own worked calculation: what reached it, what it held, what soaked away, what overflowed, and how much flooding it prevented. |

**What does not change:** the physics. The server runs the same tested engine code as the browser. A result from AWS is identical, number for number, to a result from the browser fallback.

---

## 2. Architecture

```
 Browser (AWS Amplify Hosting)
   │  1. POST JSON: site, plan, rainfall, soil state
   ▼
 Amazon API Gateway (HTTP API, CORS for the Amplify domain)
   │
   ▼
 AWS Lambda  (Node.js 22, arm64, 2048 MB, 29 s timeout)
   │  • validates the request (storm limits, intervention placement, recomputes costs)
   │  • loads the neighbourhood grid (bundled site JSON, cached while the Lambda is warm)
   │  • runs src/sim/** : simulate / attribute / optimize / showdown
   │
   ├──► Amazon S3 (frames bucket, objects expire after 1 day)
   │       animation frames (water depth per cell per 2 minutes), gzipped
   │
   ▼
 2. JSON response: metrics, water budget, rainfall calc, per-intervention calcs,
    hotspots, plus a presigned S3 URL for the animation frames (valid 15 minutes)

 If the API cannot be reached (network error, timeout, 5xx): the browser runs the
 same engine in a Web Worker and labels the result "Calculated in browser (offline)".
```

**Why Lambda + TypeScript:** the engine is already pure TypeScript with no browser APIs, so the Lambda imports it directly (bundled with esbuild). There is one codebase and no port to re-validate. Requests are short and bursty (a storm takes about 0.5–1 s, a recommendation 4–7 s), which suits Lambda's pay-per-request model.

**Why frames go to S3:** one storm's animation is roughly 2–6 MB of depth values. A synchronous Lambda response is capped at 6 MB, so the frames are gzipped (usually to under 1 MB, since most cells are dry) and served from S3. Everything else is small JSON and comes back inline.

---

## 3. API reference

Base URL: `https://<api-id>.execute-api.<region>.amazonaws.com` (set in the frontend as `VITE_API_URL`). Every endpoint is `POST` with a JSON body and returns JSON.

### Common request fields

```jsonc
{
  "siteId": "gurugram",                 // gurugram | chennai | ranchi
  "plan": [                             // interventions; same shape as src/sim/flood/types.ts Intervention
    { "id": "p1", "type": "pit", "cells": [7321] },
    { "id": "r1", "type": "rwh", "building": 212 }
  ],
  "storm": { "presetId": "veryheavy" }  // or a custom storm:
        // { "totalMm": 120, "durationMin": 90, "profile": "peaked" }
  "antecedent": "normal"                // soil before the storm: dry | normal | wet
}
```

### Endpoints

| Endpoint | Body (in addition to the common fields) | Returns | Typical time |
|---|---|---|---|
| `POST /rainfall` | `storm` only | `RainfallCalc` (section 4) | < 50 ms |
| `POST /flood/simulate` | — | metrics, water budget, `rainfall`, `calcs[]`, hotspots, `framesUrl` | 0.5–1 s |
| `POST /flood/attribute` | — | per-intervention effect on flooding (section 6) | ~0.5 s × (interventions + 1) |
| `POST /flood/optimize` | `budget` (₹), `base` (plan to keep) | recommended plan with a reason for each pick, metrics, cost | 4–7 s |
| `POST /flood/showdown` | `budget` | no action vs 3 even-spread plans vs HYDRA | 10–15 s |
| `POST /heat/simulate` | `scenarioId`, `windowId` instead of `storm` | heat metrics, receptors, `calcs[]`, `framesUrl` | ~1 s |
| `POST /heat/attribute` | same as above | per-intervention effect on exposure | ~1 s × (interventions + 1) |
| `POST /heat/optimize` | `budget`, `base` | recommended shade plan | a few s |
| `POST /heat/showdown` | `budget` | no action vs even spread vs HYDRA | a few s |

### Responses and errors

Every response includes `"source": "server"` and `"engineVersion"`, so the UI can show where the numbers came from.

| Status | When | Body |
|---|---|---|
| 200 | Success | the result |
| 400 | Invalid input: unknown site, storm outside the limits, an intervention placed where it is not allowed (same rules as the map's red preview, from `validate()` / `validateHeat()`), budget ≤ 0 | `{ "error": "Recharge pits go on ground, paving or a road edge", "field": "plan[0]" }` |
| 413 | Plan too large (more than 400 interventions) | `{ "error": "..." }` |
| 500 | Engine failure | `{ "error": "...", "requestId": "..." }` |

**The server never trusts numbers from the client.** It rebuilds the storm itself, re-validates every intervention and recomputes every cost (`planCost()`, `heatPlanCost()`).

---

## 4. Rainfall: what the user enters and how it is used

### Input

| Option | Fields | Limits |
|---|---|---|
| Preset | `presetId`: `heavy` (65 mm / 2 h), `veryheavy` (120 mm / 3 h), `cloudburst` (100 mm / 1 h), `extreme` (220 mm / 6 h) | — |
| Custom | `totalMm`, `durationMin`, `profile` (`peaked` or `uniform`) | 5–400 mm; 15 min–24 h; average intensity ≤ 250 mm/h |

### Calculation (`RainfallCalc`)

1. **Split into 5-minute blocks** (`hyetograph()` in `src/sim/flood/model.ts`):
   - `uniform`: every block gets the same depth.
   - `peaked`: block weight = `exp(−((t − 0.4) / 0.18)²) + 0.12`, where `t` is the block's position in the storm (0–1). This puts a burst at 40 % of the storm on top of a 12 % background drizzle. Weights are scaled so the blocks add up to exactly `totalMm`.
2. **Intensity** in each block = block depth ÷ 5 min × 60, in mm/h. The engine steps every 60 s and applies the current block's intensity to every open cell.
3. **Volume on the neighbourhood** = `totalMm / 1000 × area`. The area is 120 × 120 cells × 25 m² = **360,000 m² (36 ha)**. Example: 120 mm → **43,200 m³**.
4. **IMD category** (from IMD's daily thresholds, applied to the event total):

| Total | Category |
|---|---|
| < 64.5 mm | Below "heavy" |
| 64.5–115.5 mm | Heavy |
| 115.6–204.4 mm | Very heavy |
| ≥ 204.5 mm | Extremely heavy |
| peak 60-minute total ≥ 100 mm (any total) | also flagged **cloudburst** |

The response returns the blocks (for the bar chart), peak intensity, total volume, category, and a plain-English note such as "120 mm in 90 min: IMD very heavy; peak 155 mm/h".

---

## 5. Per-intervention calculations

Every simulate response carries `calcs[]`, one entry per intervention:

```jsonc
{
  "id": "p1", "type": "pit", "name": "Recharge pit near Sohna Road", "cost": 40000,
  "inputs":  { "capacity_m3": 2.5, "rechargeRate_Ls": 1.25, "soilFactor": 1.25 },
  "steps": [
    { "label": "Storage", "formula": "fixed pit store", "value": 2.5, "unit": "m³" },
    { "label": "Recharge rate", "formula": "1.0 L/s × soil factor 1.25", "value": 1.25, "unit": "L/s" },
    { "label": "Water that reached the pit", "formula": "runoff routed to this cell", "value": 14.8, "unit": "m³" },
    { "label": "Captured", "formula": "recharged 9.6 + stored at end 0.9", "value": 10.5, "unit": "m³" },
    { "label": "Passed by when full", "formula": "reached − captured", "value": 4.3, "unit": "m³" }
  ],
  "timeline": { "firstFullMin": 38, "minutesFull": 41, "peakFillPct": 100 },
  "summary": "Caught 10.5 m³ of 14.8 m³ that reached it; full from minute 38 for 41 min."
}
```

The numbers above are illustrative. The real ones come from the run. The engine records these values as it runs, alongside its existing totals. The physics is unchanged, and the per-device values always add up to the water budget's totals (`pits`, `gardens`, `harvested`); a test enforces this.

All parameters live in `PARAMS` (`src/sim/flood/model.ts`) and `HEAT_PARAMS` (`src/sim/heat/model.ts`). Soil factor by city: Gurugram 1.25 (sandy loam), Ranchi 0.85 (lateritic), Chennai 0.45 (clayey marsh).

### 5.1 Recharge pit (₹40,000 each)

| Quantity | How it is calculated |
|---|---|
| Storage | `pitStore` = 2.5 m³ |
| Recharge rate | `pitRate` 1.0 L/s × soil factor. Gurugram: 1.25 L/s = 4.5 m³/h. |
| Water reaching it | All runoff routed through its cell each minute (downhill flow, plus water from a low spot it sits in) |
| Captured | Each minute it takes `min(arriving water, free storage)`. Every minute the store first drains by the recharge rate. |
| Recharged into the ground | Sum of the per-minute drain-down |
| Passed by | Arriving water − captured; it carries on downhill |
| Timeline | First minute the pit was full, minutes spent full, peak fill % |

**Worked example (Gurugram, 2 h storm + 1 h after):** the most a pit can ever take is 2.5 m³ + 4.5 m³/h × 3 h = **16 m³**. A pit at a busy low spot that receives 40 m³ catches at most 16 m³ and passes on at least 24 m³. That is why the optimizer prefers several pits along a flow path over one at the very bottom.

### 5.2 Rain garden (₹1,200 per m²; one 2 × 2-cell garden = 100 m² = ₹1.2 L)

| Quantity | How it is calculated |
|---|---|
| Storage | (`gardenDepth` 0.25 m bowl + `gardenMedia` 0.25 m held in media voids) × area. For 100 m²: **50 m³**. |
| Soaking into native soil | `gardenExfil` 15 mm/h × soil factor × area. Gurugram, 100 m²: 18.75 mm/h → **1.9 m³/h**. |
| Surface infiltration | The garden cells keep their soil's own infiltration; this is counted as garden water too. |
| Captured, passed by, timeline | Same as the pit |

**Fix to make while building this:** `PARAMS.gardenRate` (60 mm/h intake through the media) is shown in the UI, but the engine never applies it, so a garden can currently take in water as fast as it arrives. The ledger will apply that intake limit (60 mm/h × area per minute), so the calculation matches what the UI says.

### 5.3 Rooftop rainwater harvesting (₹12,000 + ₹2,800 per m³ of tank)

| Quantity | How it is calculated |
|---|---|
| Roof area | Building cells × 25 m² |
| Tank size | `tankSize()` = roof area × 0.04 m (40 L per m²), kept between 3 and 30 m³ |
| Rain on the roof | Roof (and courtyard) area × rain depth, minute by minute |
| Captured | Fills the tank until it is full. The tank is not used during the storm, so nothing is drawn off. |
| Overflow to the street | Rain on the roof − captured. Leaves through the downpipes onto the building's frontage cells. |
| Timeline | Minute the tank filled |

**Worked example:** a 200 m² roof under 120 mm. Tank = 200 × 0.04 = **8 m³** (cost ₹12,000 + ₹22,400 = ₹34,400). Rain on the roof = 200 × 0.12 = **24 m³**. Captured **8 m³** (one third), overflow **16 m³**. The tank fills once 40 mm has fallen. In a peaked storm that is usually before the burst, so RWH helps most in moderate storms and on large roofs.

### 5.4 New stormwater drain (₹6,000 per metre)

| Quantity | How it is calculated |
|---|---|
| Length | Cells × 5 m |
| Design capacity | `newDrainCap` 0.4 m³/s (0.6 × 0.6 m RCC at about 0.5 % slope), added to any existing drain in the same cell |
| Slope adjustment | Capacity × √(local slope ÷ 0.4 %), kept between 0.4× and 1.3× (Manning: flow grows with √slope) |
| Inlet limit | Each 5 m cell can take in at most 0.12 m³/s from the street |
| Connected? | Whether it reaches an outfall (box edge at low level, river or nala, pond) through the network. **If not connected, it carries nothing**, and the calculation says so. |
| Outputs | Volume carried to the outfall, peak utilisation (%), volume surcharged back onto the street, minutes at capacity |

### 5.5 Drain desilting (₹600 per metre)

| Quantity | How it is calculated |
|---|---|
| Capacity before | Design capacity × (1 − silt fraction). A typical Gurugram drain: 0.18 × (1 − 0.5) = **0.09 m³/s** |
| Capacity after | Design capacity × (1 − `desiltTo` 0.1) = 0.18 × 0.9 = **0.162 m³/s** (+80 %) |
| Outputs | Volume carried, peak utilisation, surcharge before vs after (the "after" comes from this run; the "before" from the attribution run in section 6) |

### 5.6 Heat mode

The heat index for a cell is: `100 × ((0.5 × sun dose + 0.2 × surface heat) × wind factor + 0.3 × air heat)`.
- Sun dose: direct sun over the chosen hours ÷ (950 W/m² × hours).
- Surface heat: asphalt 1.0, paving 0.8, bare ground 0.6, grass 0.25.
- Air heat: the NOAA heat index, scaled from 27 °C to 52 °C.
- Wind factor: 4 % less radiant heat per m/s of wind, up to 5 m/s.

| Intervention | Inputs | What is calculated |
|---|---|---|
| Street tree (₹12,000) | Mature 8 m tall, 3.5 m crown, lets 25 % of direct sun through | Cells it shades at each half hour, sun-hours removed on footpaths and roads, drop in the exposure index on those cells (footfall-weighted), bus stops and markets helped, ₹ per sun-hour removed. Modelled at maturity, which takes years; the card says so. |
| Shade canopy (₹1.5 L, 5 × 5 m) | 2.6–3.4 m high, 5 % of sun through | Same outputs, from day one |
| Shaded walkway (₹7,500 per m) | Continuous canopy along a footpath | Same outputs, per metre |
| Cool roof (₹350 per m²) | Roof albedo 0.2 → 0.7 | Solar heat absorbed by the roof = roof area × (1 − albedo) × sun on the roof (Wh/m²). Saving = area × 0.5 × sun on the roof, in kWh. **Street exposure unchanged**, stated explicitly. |

---

## 6. Effect on flooding: with vs without

The ledger in section 5 tells you what a device *did with water*. The question that matters is what that *prevented*. `/flood/attribute` answers it by running the same storm once with the full plan and once without each intervention (n + 1 runs, no animation). For each intervention it reports the difference:

| Output | Meaning |
|---|---|
| Homes kept dry | Buildings flooded without it − with it |
| Waterlogged area avoided | ha of street above 10 cm without it − with it |
| Road cut avoided | km of road above 15 cm |
| Impact removed | Flood impact index without it − with it (weighted by road class, residents, critical buildings) |
| Value for money | ₹ per home kept dry, ₹ per m³ of harmful water removed |

**Why the individual effects do not add up to the plan's total:** interventions interact. Two pits feeding the same low spot can each look small on their own, because the other one covers for it, yet together they keep a street dry. A drain can matter only because a garden upstream keeps it below capacity. The UI shows each effect and the plan total side by side and says this plainly. It never presents the individual effects as a breakdown of the total.

It runs on demand (a "Calculate effect of each" button), because it costs n + 1 storms.

---

## 7. Run and deploy

### Prerequisites

- Node.js 22, an AWS account, the AWS CLI configured (`aws configure`), and the AWS SAM CLI.
- `sam local` needs Docker.

### Commands

```bash
npm run api:build                 # esbuild bundles backend/src + src/sim + site JSON into backend/dist
npm run api:local                 # sam local start-api on http://127.0.0.1:3000
VITE_API_URL=http://127.0.0.1:3000 npm run dev    # frontend against the local API
npm run api:deploy                # sam build && sam deploy (first time: sam deploy --guided)
```

`sam deploy` prints the API URL. In the Amplify console, set the environment variable `VITE_API_URL` to that URL and redeploy the frontend; `amplify.yml` passes it into the build. If `VITE_API_URL` is empty, the app runs fully in the browser exactly as it does today.

### AWS resources (`backend/template.yaml`)

| Resource | Settings |
|---|---|
| `HttpApi` | API Gateway HTTP API; CORS allows the Amplify domain and `localhost:5173` |
| `FloodFn`, `HeatFn`, `RainFn` | Node.js 22, arm64, 2048 MB (more memory = more CPU), 29 s timeout |
| `FramesBucket` | Private S3 bucket; objects expire after 1 day; read only through presigned URLs |
| IAM | Each function may only `s3:PutObject` / `s3:GetObject` on the frames bucket |

### Cost

At hackathon scale this stays within the AWS free tier. Lambda bills about 1–15 s of compute per request at 2 GB, API Gateway HTTP API about $1 per million requests, and S3 objects are deleted after a day.

---

## 8. Frontend changes

| File | Change |
|---|---|
| `src/simClient.ts` | A remote engine with the same methods as the worker engine; downloads and gunzips frames; falls back to the worker on error and tags each result `server` or `browser` |
| `src/store.ts`, `src/heatStore.ts` | Use the remote engine; new custom-storm state |
| `src/ui/Chrome.tsx` | Storm menu gains "Custom…": total mm, duration, shape, with the IMD category and m³ shown live |
| `src/ui/Panel.tsx`, `src/ui/heat/HeatPanel.tsx` | Rainfall card with a bar chart; a **Calculations** list with one expandable card per intervention (inputs, step-by-step working, timeline, effect on flooding); clicking an intervention on the map opens its card; badge "Calculated on AWS" or "Calculated in browser (offline)" |
| `amplify.yml` | Passes `VITE_API_URL` into the build |

---

## 9. Testing

| Test | Checks |
|---|---|
| Existing engine tests (18) | All still pass: water balance in all three cities, sun position, shadows, optimizer beats even spread |
| Ledger adds up | Per-device sums equal `budget.pits`, `budget.gardens`, `budget.harvested` |
| Device balance | Each pit/garden: captured = soaked away + stored at end. Each tank: captured ≤ tank size; rain on roof = area × mm |
| More rain, more bypass | Doubling the rain on a plan with one pit increases its bypass volume, and captured never exceeds storage + recharge |
| Rainfall | `makeStorm`, `validateStorm`, `imdCategory` at the boundaries: 64.5, 115.6, 204.5 mm and 100 mm/h |
| Attribution | Removing an intervention never improves the result beyond numerical noise |
| Handlers (`backend/test/`) | Sample API Gateway events with S3 mocked. A server result equals a direct `simulate()` for the same input; bad input returns 400; costs are recomputed |
| End to end | Local API + dev server in a real browser: run a storm, place a pit, set 150 mm / 2 h, open the pit's card, see "Calculated on AWS". Stop the API, re-run, see "browser" with identical numbers |

---

## 10. Build order

1. Engine ledger and rainfall functions (`src/sim/flood/*`, `src/sim/heat/*`) with tests.
2. Backend handlers, SAM template, local run (`backend/`).
3. Frontend: remote client with fallback, custom storm, calculation cards.
4. Deploy to AWS; set `VITE_API_URL` on Amplify; update the README and DIRECTION.

---

## 11. Limits and assumptions

These carry over from the engine and are shown in each mode's About tab.

- **Screening model, not a design tool.** Water moves within the same minute (no travel time across the area), drains form one gravity network, and outfalls are assumed to have spare capacity.
- **Rainfall is uniform in space.** The whole 36 ha gets the same rain at the same time, which is reasonable at this scale.
- **Devices are idealised.** No clogging, and pits and gardens work at their rated capacity. Roof tanks are not drawn on during the storm.
- **Costs are indicative 2024 rates.** For real budgets, use the local CPWD / state PWD schedule of rates.
- **Heat is a relative index**, not UTCI, WBGT or a health prediction. Trees are modelled at maturity.
- **Synthetic data is labelled.** Some buildings (most of Ranchi's), drain silt levels, trees and places are generated where OpenStreetMap has gaps.
