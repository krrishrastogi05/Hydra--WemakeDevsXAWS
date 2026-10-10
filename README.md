# HYDRA: climate-resilient Indian city simulator

**Every monsoon the same streets go under, and every summer the same bus stops bake. HYDRA shows why, and where a limited budget does the most good.**

![HYDRA: peak flood in Jacobpura, Old Gurugram](docs/screenshot.png)

HYDRA is an interactive 3D simulator of a real Indian neighbourhood (Gurugram, Chennai or Ranchi), built for the WeMakeDevs × AWS hackathon. It has two modes on the same neighbourhood, switched with the **Flood | Heat** toggle in the top bar (or `H`):

- **Flood:** run a heavy monsoon storm and watch it flood the streets; place stormwater drains, rain gardens, rooftop rainwater harvesting, recharge pits and drain desilting within a fixed rupee budget.
- **Heat:** trace the sun through a hot day and see which bus stops, markets, gates and streets have no shade; plant street trees, add shade canopies and shaded walkways, or coat cool roofs within a separate budget.

In both modes you re-run the *same* conditions to compare before and after, let HYDRA's optimizer spend the budget for you, and pit it against spending the same money without a plan. The two modes share the neighbourhood, the camera and the layout; their models, plans, budgets and results are completely separate.

> Project direction, status and next steps: [DIRECTION.md](DIRECTION.md).

> **Thesis, shown on screen:** the right infrastructure in the right places reduces monsoon flood damage far more than the same budget spent evenly.

| Neighbourhood, storm, budget | Flood-impact cut: HYDRA plan | Flood-impact cut: even spread (avg of 3) | Homes kept dry (HYDRA vs even spread) |
|---|---|---|---|
| Gurugram (Jacobpura), heavy, ₹25 L | **15 %** | 1 % | 11 vs 4 |
| Gurugram (Jacobpura), heavy, ₹75 L | **21 %** | 3 % | 24 vs 10 |
| Chennai (Velachery), very heavy, ₹75 L | **15 %** | 1 % | 17 vs 2 |
| Ranchi (Lalpur), heavy, ₹75 L | **19 %** | 2 % | 34 vs 6 |

These figures come from the simulation engine (see `src/sim/flood/optimizer.test.ts`), not from the UI. The best plan differs by city:
- **Chennai** (flat ground, clay soil): mostly drain desilting and relief drains.
- **Ranchi and Gurugram** (lateritic and sandy soils): rooftop harvesting and recharge pits as well.

**Heat mode, pre-monsoon heatwave afternoon (44 °C, 12:00–16:00), ₹25 L** (from `src/sim/heat/optimizer.test.ts`):

| Neighbourhood | High-exposure places: no action → even spread → HYDRA | Shade where people wait: no action → even spread → HYDRA |
|---|---|---|
| Gurugram (Jacobpura) | 10 → 9.7 → **5** | 15 % → 16 % → **38 %** |
| Chennai (Velachery) | 5 → 5.0 → **1** | 27 % → 27 % → **61 %** |
| Ranchi (Lalpur) | 7 → 7.0 → **1** | 26 % → 27 % → **67 %** |

## Demo links

- `/#gurugram`, `/#chennai`, `/#ranchi` open a neighbourhood.
- `/?demo=showdown#gurugram` runs the budget showdown on load.
- `/?demo=plan#ranchi` applies HYDRA's recommended plan and plays the storm.
- `/#chennai/heat` opens a neighbourhood in heat mode; `?demo=plan` and `?demo=showdown` work there too, for example `/?demo=plan#chennai/heat`.
- Add `noguide` to skip the welcome card, for example `/?noguide&demo=showdown#chennai`.

## What you can do

1. **Explore:** orbit the real neighbourhood in 3D. Buildings, roads and land use come from OpenStreetMap; terrain comes from AWS Open Data. Rooftop water tanks and open roadside drains are shown. Hover any street, drain or building for its numbers.
2. **See the risk:** HYDRA runs the baseline storm on load.
   - Waterlogging hotspots are ranked and named by road.
   - Homes are coloured by risk: red means water is above the plinth, amber means water is at the door.
   - Drains glow blue when flowing, amber when full and red when overflowing.
3. **Simulate:** press **Run storm** to watch the rain, the runoff, the drains filling and surcharging, and the low spots growing. Scrub through time, or switch to the **Peak** flood.
4. **Intervene within budget** (keys 1–5):

   | Intervention | How you place it | What it does | Indicative cost |
   |---|---|---|---|
   | Stormwater drain | Drag on the map | 0.4 m³/s; must connect to an outfall | ₹6,000/m |
   | Rain garden | Click | 10 × 10 m, 25 cm deep, 60 mm/h | ₹1.2 L |
   | Rooftop rainwater harvesting | Click a roof | Tank holds 40 mm of roof rain | ₹12k + ₹2.8k/m³ |
   | Recharge pit | Click | 2.5 m³ plus ~1 L/s into the aquifer | ₹40k |
   | Drain desilting | Click a drain | Restores 50 % → 90 % capacity | ₹600/m |

   Every intervention changes the physics. A drain that isn't connected to an outfall does nothing, which is exactly the lesson.
5. **Compare:** see before/after KPIs (homes flooded, residents, km of road cut, waterlogged hectares, road-km·hours, flood impact index), standing water over time, where the rain went, and an A/B toggle on the map.
6. **Recommend:** the optimizer spends the budget and explains every pick, for example *"Desilting the 160 m drain along Dhandeeswaram Nagar stops ~389 m³ of the 1,769 m³ it overflowed onto the street."* Apply it with one click.
7. **Budget showdown:** compares no action, an even spread (the average of 3 random plans) and HYDRA, all for the same budget.

### Heat mode

1. **Pick the day and hours:** pre-monsoon heatwave (44 °C, 20 % RH), humid hot day, ordinary summer day or monsoon break; morning commute, afternoon, evening or the whole day. Each neighbourhood has its own heat budget.
2. **See the exposure:** the ground is coloured by a relative pedestrian heat-exposure index (0–100), and bus stops, markets, school and hospital gates and parks carry a pin with their score. **Play the day** to watch the shadows move hour by hour.
3. **Intervene within budget** (keys 1–4):

   | Intervention | How you place it | What it does | Illustrative cost |
   |---|---|---|---|
   | Street tree | Click open ground, paving or a park | Mature crown 8 m tall, 3.5 m radius, lets 25 % of the sun through | ₹12,000 |
   | Shade canopy | Click a stop, market or street cell | 5 × 5 m roof at 2.6–3.4 m, blocks 95 % of the sun | ₹1.5 L |
   | Shaded walkway | Drag along a footpath | Continuous canopy | ₹7,500/m |
   | Cool roof | Click a roof | Roof albedo 0.2 → 0.7; cuts roof heat, not street sun | ₹350/m² |

4. **Compare, Recommend, Showdown:** the same tabs as flood mode. The heat optimizer tries trees and canopies around the busiest hot spots and scores each by footfall-weighted exposure removed per rupee, re-tracing the shade against what is already there so overlapping shade is not double counted.
5. **Inspect:** hover any spot to see its index and why it is high: hours of direct sun, surface type, air heat index and how many people use it.

## How it works

```
scripts/fetch-site.mjs   flood data: Overpass (OSM) + Terrain Tiles on AWS -> public/data/<site>.json (5 m grid)
scripts/fetch-heat.mjs   heat data: trees, bus stops, markets (OSM + labelled synthetic) -> public/data/<site>.heat.json
src/sim/                 pure TypeScript engines; run in Web Workers and in Vitest
  grid.ts, types.ts      the shared neighbourhood grid (both modes)
  flood/                 model (catalogue, costs, IMD storms), engine (fill-and-spill + drains), optimizer, worker
  heat/                  solar (NOAA sun position), shadow (ray tracing), engine (exposure index), model, optimizer, worker
src/store.ts             shared state + flood state;  src/heatStore.ts  heat state (separate plan, budget, results)
src/three/               shared scene (terrain, buildings, camera); flood/ (water, rain, drains); heat/ (sun, shade map, trees)
src/ui/                  shared shell (top bar, tools, tabs); flood panels; heat/ panels, timeline, inspector
```

Rule: `src/sim/heat` never imports from `src/sim/flood` and vice versa; both use only the shared grid.

**Engine** (transparent and simplified, documented in the app's *About* tab). Each minute:
1. **Rain** falls as an IMD-category design storm.
2. **Roofs** drain through downpipes, unless a rooftop harvesting tank catches the water first.
3. **Runoff** flows downhill along D8 paths on a depression-filled surface (priority-flood, Barnes et al. 2014), soaking into permeable ground until the soil saturates.
4. **Open drains** take water in through inlets and route it by gravity to outfalls (Dijkstra). They are 50 % silted and surcharge back onto the street when full.
5. **Low spots** fill like reservoirs (hypsometric level) and spill downstream when full.
6. **Moving water** gets a Manning normal depth.

Mass balance closes to < 0.01 m³ on 40,000 m³ storms, and a storm runs in about 0.5 s.

**Optimizer:**
1. Simulate the storm.
2. Find the harmful low spots: water above 10 cm, weighted by road class, residents at the door and critical buildings.
3. Trace where each cell's runoff ends up, through chains of low spots spilling into each other.
4. Score every candidate (roof harvesting, rain garden, recharge pit, a relief drain found with Dijkstra to a drain with spare capacity or the trunk outfall, desilting) by harmful water removed per rupee.
5. Pick lazily and greedily within the round budget, then re-simulate and refine for up to 6 rounds.

**Heat engine** (also documented in the app's *About* tab):
1. **Sun path** every half hour for the chosen day and the site's latitude and longitude (NOAA solar position equations), with clear-sky direct sunlight reduced by cloud.
2. **Shadows:** from every 5 m cell, a ray 1.1 m above the ground is traced toward the sun through the grid. Buildings (3.2 m per storey + plinth) and hills block it; tree crowns let 25 % through, canopies 5 %.
3. **Exposure index (0–100)** = 50 × sun dose + 20 × surface heating (asphalt > paving > bare soil > grass) + 30 × air heat (NOAA heat index of temperature and humidity), with wind trimming the sun and surface terms.
4. **Footfall weights** by road class; bus stops, markets, gates and parks count more.

It is a transparent *relative* index for comparing places and plans under the same weather, not UTCI, WBGT or a health prediction. A full day traces in about 50 ms, a ₹25 L recommendation in about 0.2 s.

## Data and honesty

- **OpenStreetMap** via the Overpass API (© OpenStreetMap contributors, ODbL): buildings and their levels, roads by class and name, land use, schools and hospitals.
- **Terrain Tiles on the AWS Registry of Open Data** (`s3://elevation-tiles-prod`, terrarium, SRTM-derived). The elevation is smoothed to remove 1 m steps in the source data, and hydrologically conditioned: closed depressions deeper than 40 cm are treated as artefacts.
- **Synthetic, and labelled in the app** (toggle *Data sources*):
  - building infill where OSM has gaps (most of Ranchi)
  - missing building levels, plinth heights and resident estimates
  - the roadside drain layout, sizes and silt state
  - micro-relief
  - soil infiltration factors
  - heat mode: street and park trees (OSM maps almost none here), bus stops where OSM has fewer than three, market streets, tree heights and crowns, footfall weights

  These assumptions are listed in the *About* tab.

This is a screening and decision-support tool, not a hydraulic design tool. Unit costs are indicative; use the local CPWD or PWD schedule of rates for real budgets.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # flood + heat engine and optimizer tests (mass balance, sun position, shadows, HYDRA beats even spread)
npm run build        # static site in dist/
npm run data         # optional: re-fetch OSM + terrain for all sites (cached in data/raw)
npm run data:heat    # optional: rebuild the heat-mode trees and places (cached in data/raw)
```

## Deploy on AWS

HYDRA is a static site; the engine runs in the browser. A planned AWS Lambda calculation backend (custom rainfall, a worked calculation for every intervention) is designed in [BACKEND.md](BACKEND.md).
- **AWS Amplify Hosting:** connect the repo; `amplify.yml` builds `dist/`.
- **S3 + CloudFront:** `npm run build`, upload `dist/` to a bucket, and serve it through CloudFront with the default root object `index.html`.

## Roadmap

- Calculation backend on AWS Lambda + API Gateway with custom rainfall and per-intervention calculations: see [BACKEND.md](BACKEND.md).
- Heat mode: satellite land-surface temperature to calibrate the surface term; a tree census where one exists.
- An Amazon Bedrock "ward officer brief" that summarises the chosen plan in English and Hindi.
- Upload your own ward boundary.
