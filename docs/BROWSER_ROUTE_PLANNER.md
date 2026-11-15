# Browser route planner (feature/browser-route-planner)

## Scope

This feature adds route planning by clicking on the **existing local Jezero CTX DEM map**. The global Mars globe and its imagery do not change. Users no longer have to generate and upload Python route JSON to demonstrate route comparison.

### Workflow

1. Open the Jezero **local map** through the global view. The route planner panel appears above the DEM/CTX map.
2. Click **Start A**, then a valid DEM cell. Next click the **Goal B** cell. Pressing Enter while the canvas is focused also selects the viewport centre.
3. Click **Build 2 routes**. The browser runs A* twice on the actual 375×375 Mars-projected CTX DEM: weight 0 for minimum distance and weight 12 for DEM slope-penalized cost.
4. Inspect both overlays, click their profile samples and compare measured lengths, elevations and slope-band statistics in the existing comparison panel. If both objectives yield exactly the same grid path, the UI reports this rather than inventing a detour.
5. The **Demo A/B** button selects the prevalidated endpoints from the DEM metadata. **Clear selection** resets the points and comparison. After building routes, open **Compare routes** to see the results.

### Scientific contract

- Planner coordinates are original **Mars projected XY in metres**, not Earth WGS84; users select positions by clicking valid cells of the same DEM that appears on screen.
- At most 8 nearest-neighbour cells per expansion; diagonal steps are disallowed when a side is NoData (no corner cuts).
- `grade_deg = atan(abs(h2-h1)/distance_m) × 180/π`
- `cost = distance_m × (1 + weight × (grade_deg / 10)²)`; weight = 0 (shortest), 12 (slope-penalized); no hard maximum-grade restriction. This matches the objective and eligible-neighbor rules in `detour_planner.py`.
- Heuristic = true projected Euclidean distance to the goal, admissible for nonnegative slope penalties. Same-cell starts and goals and invalid or out-of-ROI points are rejected.
- A* simplifies **only collinear grid steps**; cannot skip unknown/forbidden tiles. The reported polyline includes exact selected endpoints, like the Python implementation.
- Route profiles, 20 m samples, measurable ascent, grade categories, coverage and NoData notes reuse the *existing* `measureRouteSlope` / `sampleRouteElevation` implementations; new metrics are not computed from visual texture.
- **Important:** weight 12 is experimental, not a NASA EVA safety rule. Grid 20 m misses small rocks, soil conditions and cross-slope hazards; no displayed route certifies human traversability.
- In the browser-planned mode, the route switches, overview and comparison table explicitly label the two objectives **shortest valid grid route** and **slope-penalized A***. Imported Python files retain their existing “direct / detour” labels.

### Files

| Path | Role |
|---|---|
| `web/routePlanner.ts` | Typed-array A*, heap, validation, grid-to-polyline geometry, browser comparison adapter |
| `web/routePlanner.test.ts` | Synthetic DEMs, Dijkstra cross-check, corner-cut/NoData tests, route source and endpoints |
| `web/MarsMap.tsx` | A/B map selection, route buttons, DEM-projected markers, result/error states |
| `web/main.tsx` | Comparison state and results for browser-calculated routes |
| `web/i18nCatalog.ts` | RU/EN/KK strings |
| `web/styles.css` | Narrow, responsive planner panel |

### Acceptance tests

~~~powershell
npm.cmd ci
node --test web/routePlanner.test.ts
npm.cmd test
npm.cmd run build
npm.cmd run dev
~~~

Manual checks: select endpoints on DEM and CTX modes, verify exact markers while panning and zooming, test NoData and same-cell rejection, compare profile and map highlights after switching active routes, open the comparison results, and check labels in Russian, English and Kazakh.

The planner runs synchronously after a zero-delay UI yield; on lower-end devices a large route may cause a short main-thread pause. If measured responsiveness is insufficient, move the same pure computation into a Web Worker, without introducing a server or altering scientific costs.
