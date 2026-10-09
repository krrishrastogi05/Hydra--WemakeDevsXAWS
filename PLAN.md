# HYDRA — build plan

Climate-resilient Indian city simulator for the WeMakeDevs × AWS hackathon.
Thesis to prove on screen: **the right infrastructure in the right place beats the same budget spent without a plan.**

## 1. What the user does (demo script, 3 minutes)

1. Open HYDRA → a real Gurugram neighbourhood (Jacobpura, Old Gurugram) loads in 3D: OSM buildings and roads on AWS Open Data terrain, open roadside drains, rooftop water tanks.
2. The baseline storm runs automatically. A risk heat-map and a "waterlogging hotspots" list show where water collects, which roads go under, which homes take water above their plinth.
3. Press **Run storm** → rain falls, water visibly flows downhill, drains fill and surcharge, puddles grow into waterlogging.
4. Place interventions on the map with a fixed budget (₹25 lakh): stormwater drains, rain gardens, rooftop rainwater harvesting, recharge pits, drain desilting. Each one changes the physics.
5. Re-run the *same* storm → before/after metrics, charts and an A/B water toggle.
6. **Recommend plan** → the optimizer spends the budget where it removes the most harmful water per rupee, with a reason for every pick.
7. **Budget showdown** → same budget, three strategies: no action, an even spread with no data (average of 5 random plans), and HYDRA's plan. The chart makes the thesis obvious.
8. Switch the city (Chennai, Velachery, which is flat with clay soil; Ranchi, Lalpur, which is undulating with laterite soil) to show that the best plan depends on terrain.

## 2. Architecture

```
scripts/fetch-site.mjs   Node data pipeline: Overpass (OSM) + AWS Terrain Tiles -> public/data/<site>.json
src/sim/                 pure TypeScript engine (runs in a Web Worker and in Vitest)
  model.ts               site JSON -> typed-array grid, intervention catalogue, costs
  engine.ts              time-stepped rain-on-grid simulation
  optimizer.ts           hydrology-aware greedy recommendations + "even spread" baseline
  worker.ts              worker entry (simulate / recommend / showdown)
src/three/               React Three Fiber scene: terrain, buildings, water, rain, drains, interventions, picking
src/ui/                  panels: toolbar, budget, inspector, results, compare charts, recommendations, timeline
src/store.ts             zustand app state
```

All numbers on screen come from the engine. The UI never computes hydrology.

## 3. Simulation engine (transparent and simplified)

Grid of 5 m cells (120 × 120 = 600 m × 600 m). Time step 15 s; storm plus 60 min of recession.

| Process | Model |
|---|---|
| Rain | Design hyetograph in 5-minute blocks (IMD categories: heavy 64.5–115.5 mm/day, very heavy 115.6–204.4, extremely heavy ≥ 204.5; cloudburst ≥ 100 mm/h) |
| Infiltration | Land-cover rate × site soil factor, limited by soil storage, then a residual rate. Antecedent dry/normal/wet scales storage |
| Roofs | Roof rain goes to downpipes on adjacent ground cells; RWH tanks capture first |
| Overland flow | 4-neighbour Manning flux on water-surface slope, with a mass-conserving limiter (virtual-pipe style). Buildings block flow |
| Drains | Weir-equation inlets, a capacity-limited network routed downhill to outfalls with Dijkstra, a storage per segment and surcharge back to the street. Existing drains are silted to 50 % |
| Water bodies | Ponds store water and spill; rivers/nalas are sinks |
| Edges | Free outflow where the terrain slopes out of the area |

Outputs: depth frames for animation, maximum depth, time above thresholds, drain utilisation, a full water budget with a mass-balance check, and metrics (runoff, peak ponded volume, flooded area, road-km affected, road-km·hours impassable, buildings at risk and flooded above plinth, residents affected, critical facilities).

## 4. Interventions (they all change the physics)

| Type | Physics | Indicative cost |
|---|---|---|
| Stormwater drain (per 5 m) | New conveyance 0.4 m³/s with inlets, joined to the network; warns if it has no outfall | ₹6,000/m |
| Rain garden (10 × 10 m) | 0.25 m depression, 60 mm/h engineered infiltration, media storage | ₹1,200/m² |
| Rooftop RWH | Tank of 40 mm × roof area (3–30 m³) captures roof runoff first | ₹12,000 + ₹2,800/m³ |
| Recharge pit (with bore) | 2.5 m³ storage plus ~1 L/s recharge × soil factor, small inlet sump | ₹40,000 |
| Drain desilting (per road) | Restores a silted drain from 50 % to 90 % capacity | ₹600/m |

Costs are indicative and should be replaced with the local CPWD/PWD schedule of rates.

## 5. Recommendation engine

Three rounds of: simulate → find hotspot clusters (harmful excess volume, weighted by residents, critical buildings and road class) → D8 flow routing and runoff accumulation → score every candidate (RWH roof, rain-garden cell, pit cell, drain connector path found with Dijkstra, desilting unit) by *harmful volume removed per rupee*, with diminishing returns per cluster → lazy-greedy pick within budget → re-simulate. Every pick carries a plain-language reason.

The "even spread" strategy splits the budget equally across types at random valid spots (5 seeds, averaged), which is what spending without data looks like.

## 6. Data (real where possible, labelled synthetic otherwise)

- OpenStreetMap via Overpass: buildings (levels, use), roads (class, name), waterways, water bodies, parks, schools and hospitals.
- Elevation: Terrain Tiles on the AWS Registry of Open Data (`elevation-tiles-prod`, terrarium encoding, SRTM-derived), smoothed to remove 1 m quantisation steps.
- Synthetic, and labelled in the UI: building infill where OSM has gaps (Ranchi), missing building levels, plinth heights, roadside drain layout and size, silt state, soil parameters.

## 7. AWS

- Terrain data from AWS Open Data.
- Static hosting on AWS Amplify (`amplify.yml`).
- Optional: an Amazon Bedrock "plan brief" Lambda (English and Hindi summary for a ward officer), added only after the core works, with a local fallback.

## 8. Milestones

1. Data pipeline produces 3 site JSONs. ✔ when the files load.
2. Engine + Vitest: mass balance < 1 %, each intervention reduces harm, optimizer beats even spread.
3. 3D scene: terrain, buildings, water animation, rain, drains.
4. Editor: tools, budget, validation, undo, inspector.
5. Results, before/after, recommendations, showdown, charts.
6. Polish: onboarding, legends, assumptions, provenance, performance, light/dark.
7. AWS deploy config, README, Bedrock brief (optional).
