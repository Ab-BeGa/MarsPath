# A* route planning — algorithm verification (Task #16)

This task **verifies and hardens** the existing production implementation in
[`detour_planner.py`](../detour_planner.py). It does not create a second pathfinding
implementation. The existing user-facing entry point remains `profile_mars.py`
and the **AUTO DETOUR (A*)** button.

## Graph and cost model

- Nodes: valid cell centers from the original, Mars-projected 20 m USGS CTX DEM,
  cropped to the study region.
- Moves: up to eight adjacent cells, with real affine-projected horizontal
  distances (not latitude/longitude degrees).
- Forbidden: NoData pixels, cells outside the ROI, and diagonal corner cuts
  across masked pixels.
- Optional grid-edge upper slope cutoff: `--detour-max-grade`. A strict
  cutoff may leave **no** feasible path.
- Cost of every permitted edge from cell `u` to `v`:

```text
s = horizontal distance between cell centers (m)
angle = atan(abs(elevation[v] - elevation[u]) / s) in degrees
cost(u,v) = s * (1 + penalty * (angle / reference_slope_deg)^2)
```

The baseline values are `penalty=12` and `reference_slope_deg=10°`.
The admissible heuristic is horizontal Euclidean distance to the goal.
Because `penalty >= 0`, each edge cost is at least its horizontal length;
the Euclidean heuristic never exceeds the remaining route cost. As a result
A* finds the **minimum of this mathematical grid cost** within the allowed
cells, not necessarily the shortest path and not necessarily the physically
safest traversable route.

## Verification against a separate algorithm

`tests/test_astar_optimality.py` runs an independent Dijkstra uniform-cost
search on synthetic DEMs, then compares optimal costs with the production A*.

Checks include:

1. Eight deterministically seeded 7×7 terrain grids, each tested with three
   penalty weights (including distance-only zero penalty), with NoData barriers.
2. Comparison against Dijkstra for multiple strict grade caps.
3. Independent reconstruction of every chosen edge cost and total length,
   including non-square, rotated affine grids and Mars linear-unit conversion.
4. A ridge where the distance-minimum crosses steeper terrain but the
   slope-penalized solution takes a longer detour.
5. Determinism: identical inputs produce the same grid path and cost.

Run locally:

```powershell
$py = "..\jezero_site_selection\.venv\Scripts\python.exe"
& $py -m unittest discover -s tests -p test_astar_optimality.py -v
& $py -m unittest discover -s tests -v
```

The GitHub pull request also runs Python tests with a standalone synthetic
DEM fixture through `.github/workflows/python-tests.yml`. The real large
source GeoTIFF is **not** stored in Git and is not required for unit tests.

## Real DEM evidence

On 14 November 2026, the team verified the same base and science endpoints
and the same DEM SHA-256 using real source data:

| Quantity | Direct | A* |
|---|---:|---:|
| Horizontal route length | 523.07 m | 760.61 m |
| Maximum measured longitudinal grade | 14.5137° | 12.2812° |
| NoData samples on A* route | — | 0 |

The A* alternative was 237.54 m longer and had a 2.23° lower **maximum
measured longitudinal** grade. These are case-specific observations, not proof
that A* will always reduce maximum slope.

## Important limitations

- Optimality applies **only to the sampled DEM grid objective**, not the
  final exact-endpoint polyline length. The A* graph optimizes steps between
  grid cell centers; the exported polyline also includes connectors to the
  precisely specified start and end coordinates.
- If enabled, `max_slope_deg` constrains A* **grid-center transitions**.
  It does not certify the exported profile or subpixel slopes. Review the
  `final_sampled_max_slope_deg` metric separately.
- A 20 m/pixel DEM can miss smaller rocks, soil variability, microtopography
  and many hazards relevant to a Marswalk. No category or route is an
  NASA-approved EVA safety assessment.
- `terrain_slopes.py` (Task #10) and the route-comparison web app (Task #14)
  are independent team modules; they were not replaced or rewritten.

## Pull request workflow

All further code is committed first in a `feature/*` branch. Open a pull
request into `main`, run tests and review the diff, and only then merge.
