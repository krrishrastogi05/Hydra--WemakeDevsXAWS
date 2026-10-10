# HYDRA: project direction

This is the single page for where HYDRA stands and where it goes next. Keep it updated as work lands. For the original build plan see `PLAN.md`; for setup and usage see `README.md`.

## 1. The idea in one paragraph

Every monsoon the same Indian streets flood. Cities do spend money on drains and rainwater harvesting, but usually spread it evenly or by guesswork. HYDRA is a 3D simulator of a real neighbourhood that shows **why** a street floods (terrain, silted drains, low spots, paved roofs) and **where** a fixed rupee budget removes the most harm. Users can place interventions themselves, or let HYDRA's optimizer place them, then re-run the same storm and compare.

**The thesis we prove on screen:** the right infrastructure in the right place beats the same budget spent without a plan.

## 2. Who it is for

| User | What they get |
|---|---|
| Ward officers and municipal engineers | A quick, explainable way to rank where to spend a drainage budget |
| Resident welfare associations | Evidence to ask for the right fix on their street |
| Students and the public | An intuitive picture of urban flooding and climate adaptation |
| Hackathon judges | A working demo of real data, real physics and a clear before/after result |

## 3. What exists today (October 2026)

**Status: feature-complete for the hackathon demo.** Repo: https://github.com/krrishrastogi05/Hydra--WemakeDevsXAWS

### Neighbourhoods (600 m × 600 m each, 5 m grid)

| City | Area | Character | Data |
|---|---|---|---|
| Gurugram | Jacobpura, Old Gurugram | Dense old core on a slope, 9.1 m relief | 769 OSM buildings + 88 synthetic |
| Chennai | Velachery | Very flat former wetland, clay soil | 406 OSM + 170 synthetic |
| Ranchi | Lalpur | Undulating plateau, lateritic soil | 16 OSM + 1,102 synthetic (OSM is sparse here) |

### Features

- **3D scene:** terrain diorama, extruded buildings, rooftop tanks, roadside drains, animated water and rain, hotspot beacons, road and place labels.
- **Storms:** four IMD-based design storms (heavy, very heavy, cloudburst, extreme day), plus dry/normal/wet soil before the storm.
- **Interventions (keys 1–5):** stormwater drain (drag), rain garden, rooftop rainwater harvesting, recharge pit, drain desilting. Budget meter, validation with green/red previews, undo, remove.
- **Results tab:** homes flooded, residents affected, km of road cut, waterlogged hectares, road disruption, flood impact index, standing-water chart, where the rain went, ranked hotspots.
- **Recommend tab:** optimizer plans the budget and explains each pick in plain English; one click applies it.
- **Budget showdown:** no action vs an even spread (average of 3 random plans) vs HYDRA, same budget.
- **About tab:** every assumption, parameter and data source, with synthetic data labelled.
- **Demo links:** `?demo=showdown`, `?demo=plan`, `?noguide`, `#gurugram|#chennai|#ranchi`, and `/heat` after the city for heat mode.
- **Heat mode (Flood | Heat toggle, key `H`):** a separate engine, plan and budget on the same neighbourhood. Sun path for the chosen day and hours, ray-traced shadows from buildings and trees, a relative pedestrian exposure index, scored bus stops, markets, gates and parks. Tools (keys 1–4): street tree, shade canopy, shaded walkway, cool roof. Same Results / Plan / Recommend / Showdown / About tabs. Heat data comes from `scripts/fetch-heat.mjs` (`public/data/<city>.heat.json`); trees and some places are synthetic and labelled.

### Headline results (from the engine tests)

| Neighbourhood, storm, budget | Flood-impact cut: HYDRA | Even spread | Homes kept dry (HYDRA vs even spread) |
|---|---|---|---|
| Gurugram, heavy, ₹25 L | **15 %** | 1 % | 11 vs 4 |
| Gurugram, heavy, ₹75 L | **21 %** | 3 % | 24 vs 10 |
| Chennai, very heavy, ₹75 L | **15 %** | 1 % | 17 vs 2 |
| Ranchi, heavy, ₹75 L | **19 %** | 2 % | 34 vs 6 |

The best plan differs by city: Chennai's is mostly desilting and relief drains; Ranchi and Gurugram also use rooftop harvesting and recharge pits.

### Quality checks

- 18 automated tests pass (`npm test`):
  - flood: water balance closes exactly in all three cities, and HYDRA beats the even spread in all three
  - heat: sun position against NOAA values, building and tree shadows, trees never raise exposure, cool roofs leave the street unchanged, and HYDRA beats the even spread in all three cities (₹25 L: high-exposure places 10 → 5 in Gurugram, 5 → 1 in Chennai, 7 → 1 in Ranchi; an even spread barely moves them)
- Typecheck and production build are clean.
- One storm simulates in about 0.5–1 s in the browser (Web Worker); a recommendation takes about 4–7 s.

## 4. How it works (short version)

```
scripts/fetch-site.mjs   OpenStreetMap (Overpass) + AWS Terrain Tiles  ->  public/data/<city>.json
src/sim/flood/engine.ts     rain -> roofs/tanks -> downhill runoff + soaking -> drains -> low spots fill and spill
src/sim/flood/optimizer.ts  find harmful low spots -> trace where runoff ends up -> best harm removed per rupee -> re-simulate
src/sim/heat/engine.ts      sun path -> ray-traced shade -> sun dose + surface + air heat -> footfall-weighted exposure
src/sim/heat/optimizer.ts   hottest busy cells -> nearby trees / canopies -> exposure removed per rupee, re-traced after each pick
src/three/               React Three Fiber 3D scene
src/ui/                  panels, charts, timeline, inspector
```

The whole engine runs in the browser, so hosting is a static site. An optional backend (`backend/`, see section 5) adds share links and new areas; the officer brief is written in the browser.

## 5. AWS story (for the WeMakeDevs × AWS hackathon)

| AWS piece | Status | Role |
|---|---|---|
| Terrain Tiles on the AWS Registry of Open Data (`elevation-tiles-prod`) | **Done** | Elevation for every city |
| AWS Amplify Hosting | **Ready** (`amplify.yml` in repo), not yet deployed | Public demo URL |
| AWS Lambda + API Gateway (HTTP API) | **Built** (`backend/template.yaml`, SAM), not yet deployed | API, plus a worker Lambda for area builds |
| Amazon DynamoDB | **Built**, not yet deployed | Saved and shared plans (`?plan=<id>` links), area build status |
| Amazon S3 | **Built**, not yet deployed | Neighbourhoods built on demand ("+ Area": any spot in India from OSM + AWS terrain) |
| Amazon S3 + CloudFront | Alternative to Amplify | Same static hosting |

## 6. Next steps, in priority order

1. **Deploy on AWS Amplify** and put the live URL in the README. Needs an AWS account; connect this repo and Amplify uses `amplify.yml`. *(Small; must-have for judging.)*
2. **Test the interactions by hand in a real browser:** drawing drains, placing each tool, the showdown's final chart, Recommend → Apply. These have not been exercised by an automated test. *(Small; must-have.)*
3. **Record the demo video** following the script in section 7. *(Small; must-have.)*
4. **Deploy the backend** (`backend/README.md`): `npm run build && sam deploy --guided`, then set `VITE_API_URL` in Amplify. Share links and "+ Area" are built and tested locally (Koramangala, Bengaluru built end to end). The officer brief (English + Hindi) runs in the browser and needs no backend. Amazon Bedrock was left out on purpose to keep the running cost at zero. *(Small once an account is ready.)*
5. **Heat mode follow-ups:** done as a separate mode. Next: calibrate the surface term against Landsat land-surface temperature; replace synthetic trees with a tree census where one exists; test placing walkways and cool roofs by hand in a real browser. *(Small–medium.)*
6. **More demo cities:** users can now add any area through "+ Area" (backend). To ship another built-in city, add an entry to `SITES` in `scripts/lib/demo-sites.mjs` and run `npm run data`. *(Small per city.)*

## 7. Three-minute demo script

1. Open Gurugram. "This is a real neighbourhood: OpenStreetMap buildings on AWS open terrain data."
2. **Run storm.** Water collects in low spots, silted drains overflow (red), homes turn red when water passes the plinth. Point to the hotspot list.
3. Place two or three interventions by hand, re-run the same storm, and show the before/after numbers and the **No action / Your plan** toggle.
4. **Recommend.** Read one or two of the reasons aloud; apply the plan and run it.
5. **Budget showdown.** Same money: HYDRA keeps far more homes dry than an even spread.
6. Switch to Chennai: "flat clay ground, so the best plan is completely different: desilting and relief drains."
7. Flip the toggle to **Heat**: "same neighbourhood, a different problem." Play the day to show the shadows move, point at the red bus stops, press **Recommend** and apply: the trees cluster at the stops and markets, not spread evenly.
8. Close on the thesis and the AWS pieces.

## 8. Known limitations (say these honestly if asked)

- **Screening model, not a design tool.** Routing is quasi-steady (no travel time within a minute); drains are one gravity network; outfalls are assumed to have capacity.
- **Synthetic data is labelled:** drain layout and sizes, silt state, plinth heights, missing building heights, resident estimates, soil factors, and most of Ranchi's buildings.
- **Elevation is SRTM (~30 m), smoothed.** Depressions deeper than 40 cm are treated as data artefacts.
- **Gurugram:** about 8 % of the area under mapped houses is still treated as road, where OSM lane lines run through mapped houses.
- **Heat mode is a relative index**, not UTCI/WBGT or a health prediction. It ignores reflected sunlight from walls, night-time heat release and air movement; cells at the box edge see open sky; trees are modelled at maturity.
- **Costs are indicative** 2024 Indian rates; real budgets should use the local CPWD or PWD schedule of rates.
- **Laptop limits:** the development machine runs low on disk and memory; close other apps before demoing.

## 9. Team working agreement

- `main` must always build and pass `npm test`.
- Work on a branch, open a pull request, merge when tests pass.
- Engine changes: rerun `npm test` and update the results table in this file and the README if numbers move.
- Data changes: rerun `npm run data`, commit the new `public/data/*.json`.
