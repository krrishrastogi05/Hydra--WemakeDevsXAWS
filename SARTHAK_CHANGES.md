# Changes by Sarthak

Everything Sarthak changed in HYDRA, grouped by area. Newest work is at the bottom of each list. Commit hashes refer to `main`.

| Commit | Summary |
|---|---|
| `1cac80a` | 3D navigation, rendering polish, results sub-tabs, storm/soil race-condition fix |
| `8d644e6` | Arrow-key panning alongside Space + mouse |
| `cccabb2` | Placement previews visible over water and at any zoom |
| `44eca35` | Recommend builds on the current plan; results follow every plan edit |
| `7040ac1` | Side panel restructured into Overview / Analytics / Plan & cost / Optimize |
| `3782738` | Optimizer: refinement stage after the greedy rounds |
| `16ec7c1` | Full analytics view; redesigned Showdown |
| `b736a3a` | Before/after split view; guided tour |
| `757f5a9` | Save and compare plans; one-click PDF report |
| `4a5e35a` | Tour shown only to first-time visitors |

---

## 1. Map navigation

- **Mouse and trackpad:**
  - Drag rotates.
  - **Shift-drag** or right-drag pans.
  - The scroll wheel zooms **towards the cursor**.
  - Hold **Space** and move the mouse to pan, with a hand cursor; **Space + arrow keys** pans as well.
  - Space no longer toggles play/pause.
- **No more seeing under the model:** a solid floor closes the terrain block from below, and the sky's ground colour matches the soil skirt.
- **Laptop note:** on GNOME, "Disable touchpad while typing" freezes the touchpad while Space is held. Turn it off in *Settings → Mouse & Touchpad*, or use Space + arrow keys.

Files: `src/three/Scene.tsx`, `src/three/Terrain.tsx`.

## 2. Rendering quality

- **Every graphics tier:** buildings get a soft contact shadow and edge outlines (previously High only), so they read as grounded and distinct.
- **Flood-risk colour** is now a tint into the wall colour rather than a flat red or amber fill.
- **Window detail** stays visible when zoomed out (fade distance 350–950 m).
- **High tier:**
  - Soft shadows.
  - A tight bloom on genuinely bright things.
  - A light colour grade.
  - Ambient occlusion, shadow-map size and pixel density trimmed so fewer laptops are pushed down to Low automatically.
- **Low tier** keeps a cheap vignette and colour grade instead of no post-processing at all.

Files: `src/three/Buildings.tsx`, `src/three/Effects.tsx`, `src/three/Scene.tsx`.

## 3. Placement previews

- Every tool's preview draws **over the flood water and the buildings**: green means allowed, red means not.
- A **fixed-size pin** marks the exact target spot at any zoom.
  - When the spot is allowed, the pin shows the item and its cost, e.g. "Rain garden · ₹1.2 L".
  - When it isn't, the pin shows the reason, e.g. "Recharge pits go on ground, paving or a road edge".
- While drawing a drain or walkway, the pin follows the tip and shows the running length and cost.
- Works the same in Flood and Heat mode.

Files: `src/three/Ghost.tsx` (new), `src/three/flood/Interventions.tsx`, `src/three/heat/HeatLayer.tsx`.

## 4. Simulation and optimizer behaviour

- **Fix:** changing the storm, soil or plan while a simulation was still running could show a stale result. Runs are now dropped if their conditions changed in flight.
- **Results follow the plan:** the storm re-runs automatically about 0.4 s after any edit to the plan.
- **Recommend builds on your plan.** "Improve my plan" keeps what you placed and spends what is left; "Start over" plans the whole budget. It refuses when less than ₹20,000 is left. A recommendation or showdown is marked out of date when the storm, soil, budget or plan changes.
- **Optimizer refinement:** after the greedy rounds, a refinement stage spends extra storm simulations improving the plan, within a time limit. It never retries a pick that was shown not to help.

Files: `src/store.ts`, `src/heatStore.ts`, `src/sim/flood/engine.ts`, `src/sim/flood/optimizer.ts`, `src/shared/calc.ts`.

## 5. Side panel and top bar

- **Four sections** instead of five tabs:
  - **Overview:** a plain-language verdict, impact tiles with the change against no action, and the live "Right now" card.
  - **Analytics:** standing water over time, where the rain went, waterlogging hotspots.
  - **Plan & cost:** budget committed / remaining, a ledger by intervention type, value for money (₹ per home kept dry, per resident protected…), the intervention list, and save-and-compare.
  - **Optimize:** Recommend and Showdown together.
  - **ⓘ** opens method, data and assumptions.
- **Panel header:** the neighbourhood, the storm or day, a status pill (*No action / Plan · n / Plan changed / Simulating*) and an **Analytics** button.
- **Top bar:** grouped scenario controls, a budget meter that is always visible, and grouped actions. It fits at 1280 px wide.
- **Map legend** collapses to its title and remembers that.
- **Showdown, redesigned:** a verdict banner, three strategy cards (No action / Even spread / HYDRA) with a *Best* badge and cost per result, and outcome-by-metric bars with the range across the random plans.
- **Charts:** the "no action" baseline is always dashed or hollow, so it never relies on colour alone.

Files: `src/ui/Panel.tsx`, `src/ui/heat/HeatPanel.tsx`, `src/ui/Chrome.tsx`, `src/ui/heat/HeatChrome.tsx`, `src/ui/kit.tsx` (new), `src/ui/charts.tsx`, `src/styles.css`.

## 6. Full analytics view

Open it with the **Analytics** button, the *Open full analytics* card, the links in the panel, or **A**.

**Flood sections:**
- Summary: stat cards with trend lines, scenario, key moments.
- Storm timeline: rain, standing water, homes, residents, roads, drains and waterlogged area, minute by minute.
- Water balance, as a chart, a ledger and what your plan changed.
- Depth & duration histograms.
- Drainage load, including new drains that do not reach an outfall.
- Hotspots and critical facilities, as sortable tables you can click to fly to.
- Cost & value: a cost-against-benefit scatter, a spend donut and line items.
- Strategies: every random plan ranked, cost per result, spend mix.
- Compare plans.
- Data & method.

**Heat sections:**
- Summary.
- Sun through the day: sun height, direct sunlight, shade.
- Exposure and sun-hour distributions.
- Every place people wait.
- Cost & value.
- Strategies.
- Compare plans.
- Data & method.

**Export:** CSV export and section printing.

Files: `src/ui/analytics/` (new: `AnalyticsModal.tsx`, `common.tsx`, `flood.tsx`, `heat.tsx`, `strat.ts`), `src/ui/viz.tsx` (new responsive charts).

## 7. Before/after split view (flood)

- The **Split** button in the timeline shows no action on the left and your plan on the right, on one map.
- Drag the white handle to compare street by street.
- How it works: one canvas is drawn twice per frame with a scissor. Water, drains and interventions get a copy per side; building colours swap between two buffers.

Files: `src/three/split.tsx` (new), `src/ui/SplitBar.tsx` (new), `src/ui/Timeline.tsx`, plus side-aware `Water`, `Drains`, `RiskOverlay` and `Buildings`.

## 8. Guided tour

- A scripted walk through the app that **drives it for real**:
  - plays the storm,
  - lets HYDRA plan the budget and applies the plan,
  - splits the map,
  - runs the showdown,
  - opens the analytics view.
- There are separate scripts for Flood and Heat mode, and a spotlight marks the part of the screen each step is about.
- **Shown automatically only to first-time visitors.** Closing it any way (×, Skip, Esc, Finish) means it never opens by itself again.
- **Replay** any time with **T**, or open `/?tour`.
- **Inside the tour:** **Next**, **Enter** or **→** advances; **Esc** closes.
- It does not start by itself on demo, shared-plan or `?noguide` links.

Files: `src/ui/Tour.tsx` (new), `src/App.tsx`, `src/store.ts`.

## 9. Save and compare plans

- **Save a plan:** *Plan & cost → Save and compare* saves the plan on the map under a name, with the numbers from its latest run. Plans are kept in the browser, per neighbourhood.
- **Compare plans** (in the analytics view) has:
  - open, rename and delete for each saved plan,
  - a side-by-side table of up to 5 plans with the best value per metric highlighted,
  - impact-cut and cost-per-result bars,
  - a cost-against-benefit chart.
- **Fair comparison:** each saved plan keeps its own no-action baseline, so plans made for different storms or days are compared as improvements.

Files: `src/savedPlans.ts` (new), `src/ui/analytics/compare.tsx` (new).

## 10. One-click PDF report

- Open it from **Report (PDF)** in the analytics header, or **Full report** in *Share and report*.
- It builds a light, paginated A4 document and opens the print dialog; choose **Save as PDF**.
- **Contents:**
  - a cover page with contents,
  - every analytics section on its own page,
  - the saved-plan comparison,
  - the officer brief in English and Hindi.

Files: `src/ui/analytics/Report.tsx` (new), `src/ui/Share.tsx`, `src/styles.css`.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| Drag / Shift-drag / right-drag | Rotate / pan / pan |
| Scroll | Zoom towards the cursor |
| Space + mouse, Space + arrows | Pan |
| `1`–`5` (flood), `1`–`4` (heat), `V`, `X` | Tools, inspect, remove |
| `P` | Peak flood / summary view |
| `R` | Run the storm or day |
| `H` | Switch Flood / Heat |
| `A` | Open / close the analytics view |
| `T` | Replay the tour |
| `Ctrl+Z` | Undo |
| `Esc` | Close the tour, analytics view or report; stop the current tool |
