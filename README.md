# Jezero Traverse — Mars Mission Planning System

[![Web CI](https://github.com/Ab-BeGa/jezero-traverse/actions/workflows/web-tests.yml/badge.svg)](https://github.com/Ab-BeGa/jezero-traverse/actions/workflows/web-tests.yml)
[![Python CI](https://github.com/Ab-BeGa/jezero-traverse/actions/workflows/python-tests.yml/badge.svg)](https://github.com/Ab-BeGa/jezero-traverse/actions/workflows/python-tests.yml)
[![Docker CI](https://github.com/Ab-BeGa/jezero-traverse/actions/workflows/docker.yml/badge.svg)](https://github.com/Ab-BeGa/jezero-traverse/actions/workflows/docker.yml)

**NASA Space Apps Challenge 2026 · Jezero crater, Mars · Research demonstration**

Jezero Traverse explores a **7.5 × 7.5 km** area in Jezero crater's western delta using genuine NASA/USGS terrain data. The web app has an interactive **20 m CTX DEM** map, georeferenced **5 m CTX optical** layer, demo base/science landmarks, direct and experimental A* detour routes, elevation profiles, longitudinal slope bands, route comparison, and **Russian / English / Kazakh** interface localization. Language selection persists after a page reload. A separate scalable flat map covers the whole planet with NASA MOLA relief, MOC imagery, and a processed-color Viking mosaic.

> **Not an EVA safety system.** A 20 m DEM grid cannot resolve individual rocks, material strength, cross-slope or astronaut constraints. No experimental slope class or A* result proves traversability. Three Forks and Wildcat Ridge/Hazeltop are demonstration reference areas; their route coordinates are not certified landing or fieldwork positions.

## Quick start: see the map in minutes

The **large original GeoTIFF is not needed** to run the website: compact DEM, metadata and CTX optical files are committed to Git.

### Node.js (Windows, macOS and Linux)

Install **Git and Node.js 22**. Python is not required just to browse.

~~~bash
git clone https://github.com/Ab-BeGa/jezero-traverse.git
cd jezero-traverse
npm ci
npm test
npm run build
npm run dev
~~~

Open the **local URL shown in the terminal** (usually http://127.0.0.1:8000/). Do not open the HTML via file://. Press Ctrl+C to stop.

**Windows PowerShell:** if script execution policy blocks npm, replace npm with npm.cmd: npm.cmd ci, npm.cmd test, npm.cmd run build, npm.cmd run dev.

### Docker: no local Node.js or Python needed

Install **Docker Desktop / Docker Engine and Compose V2**; from the repository root:

~~~bash
docker compose up --build -d
docker compose ps
~~~

Open **http://localhost:8080/**. Health endpoint: **http://localhost:8080/_health**.

~~~bash
docker compose logs --tail=100
docker compose down
~~~

Rebuild after updates with git pull --ff-only origin main and docker compose up --build -d. Port already occupied? Edit the **host port** in compose.yaml to 8081:8080, then open http://localhost:8081/.

**Docker runs only the built static React/TypeScript application**, including existing DEM and CTX assets. It is not a Python backend; to create custom route JSON, run the Python editor separately. See [Docker operations](docs/DOCKER.md).

## 5-minute demo for a teammate or jury

1. Open the site and choose **Русский / English / Қазақша** in the header. Refresh and verify the choice is remembered.
2. Open **Surface map**. Explore and expand the global Mars map, switch between relief, MOC imagery, and Viking color; then pan and zoom the local Jezero map. Inspect coordinates/elevation in its 375 × 375 original CTX DEM cells (20 m posting), and focus reference markers A (Three Forks) and B (vicinity of Wildcat Ridge).
3. Switch the **DEM relief** and **CTX 5 m optical** layers. The optical image shows finer *visual* surface detail; **elevation measurements are still based on the 20 m DEM**. Open the science stop and source/limitations panels.
4. Scroll to **Route comparison**. Upload one direct and one detour **route_waypoints.json** from the Python steps below. Both exports must have identical original DEM SHA-256, Mars CRS, start/end points, grade limits and sample step.
5. Compare measured distances, ascents, maximum measured grade, difficult intervals and missing DEM coverage; switch the active route on the map.
6. Click a sample in the elevation profile to highlight that location on the map; review color-coded steepness and the threshold settings. Experiment with 4°/9°/14° and restore defaults.
7. Explain the scientific caveat: a detour might reduce the steep measured segments but the grid alone cannot certify human or rover safety.

Without route exports, **the terrain map, optical CTX and science cards still work**; the website does not invent missing routes.

## Generate compatible route exports with Python

Install **Python 3.11**, an Internet connection for the **initial** NASA/USGS download, and dependencies from requirements.txt. Always run commands from the repository root.

### Windows PowerShell

~~~powershell
py -3.11 -m venv .venv
$py = ".\.venv\Scripts\python.exe"
& $py -m pip install -r requirements.txt

# Download/check original 20 m Mars GeoTIFF once (large transfer).
& $py scripts/preprocess_dem.py --download

# Verify terrain algorithms and stored compact assets.
& $py -m unittest discover -s tests -v

# Create both comparison inputs with matching limits and step.
& $py profile_mars.py --export-only --output results/direct
& $py profile_mars.py --auto-detour --export-only --output results/detour
~~~

Upload **results/direct/route_waypoints.json** and **results/detour/route_waypoints.json** through the website form. The route-profile CSV/PNG files are optional browser inputs.

### Linux / macOS

~~~bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/preprocess_dem.py --download
.venv/bin/python -m unittest discover -s tests -v
MPLBACKEND=Agg .venv/bin/python profile_mars.py --export-only --output results/direct
MPLBACKEND=Agg .venv/bin/python profile_mars.py --auto-detour --export-only --output results/detour
~~~

For the **interactive desktop waypoint editor**, run Python profile_mars.py from the virtual environment (without --export-only): left click to add a waypoint, drag to move, right click to delete, Ctrl+Z undo, R reset, E export. Choose an alternate output directory with --output PATH, an explicit original DEM with --dem PATH, or slope limits with --slope-bands 4 9 14. Apply the **same** settings to both route exports; otherwise browser comparison deliberately rejects them. The --auto-detour mode invokes the experimental A* planner.

**DEM source:** [USGS Mars 2020 CTX DEM 20 m GeoTIFF](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif). The original file is approximately **90 MB** and stays in the locally ignored **data/M20_JezeroCrater_CTXDEM_20m.tif**. Do not add it to Git.

**Optional optical CTX reproduction:** the repository **already contains** the processed optical PNG and metadata. To re-create them from the separate (potentially much larger) [USGS 5 m CTX orthomosaic GeoTIFF](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.tif), run the Python command below. This step is **not needed for Docker or the browser**.

~~~bash
python scripts/preprocess_ctx.py --download
~~~

## Architecture

| Layer | Source | Responsibility |
|---|---|---|
| Entry/UI | web/main.tsx, web/MarsMap.tsx, web/styles.css | React/TypeScript, map, controls and telemetry |
| Localization | web/i18n.tsx, web/i18nCatalog.ts, web/localizedErrors.ts | Russian, English, Kazakh; language storage and UI error copy |
| Mars data | web/marsTerrain.ts, web/ctxOptical.ts | DEM/CTX asset loading and Mars georeferencing validation |
| Route views | web/routeMap.ts, web/RouteOverview.tsx, web/ElevationProfileChart.tsx | Projected-Mars overlays and linked profile |
| Slope display | web/routeSlopes.ts, web/RouteSlopePanel.tsx | Experimental grades and unknown-data intervals |
| Route comparison | web/compareRoutes.ts | Validate direct/detour JSON against matching source DEM |
| Python planner | profile_mars.py, detour_planner.py, route_geometry.py | Manual waypoints, experimental A*, export |
| Scientific analysis | terrain_slopes.py, route_metrics.py, traversability.py | DEM-derived slopes, ascent and interval statistics |
| Preprocessing | scripts/preprocess_dem.py, scripts/preprocess_ctx.py | Validate official Mars GeoTIFF and prepare compact browser assets |
| Builds/deployment | scripts/build_web.mjs, scripts/serve_static.mjs, Dockerfile, compose.yaml | Static site build and self-contained web runtime |
| Verification | web/*.test.ts, tests/, .github/workflows/ | Frontend/algorithm tests, Docker smoke checks |

The **web application is fully static**: there is **no database, backend API or secret key**. Preprocessing and route calculation are performed separately with Python. Docker needs no mounts, credentials or external NASA services at runtime.

~~~text
Official Mars CTX DEM GeoTIFF [local only] ─┐
                                           ├─ Python preprocessing → public/data/jezero/
USGS CTX optical GeoTIFF [optional, local] ─┘                         ├─ heights.f32
                                                                    ├─ mask.u8
                                                                    ├─ metadata.json + checksums.sha256
                                                                    └─ ctx_ortho.png + ctx_ortho.json

Python profile_mars.py → direct/route_waypoints.json ──┐
                       detour/route_waypoints.json ────┼─ Browser upload
Browser reads public/data/jezero/ ──────────────────────┴─ React map + analytics
~~~

After **npm run build**, the served **dist/** directory contains index.html, assets/main.js, assets/main.css and data/jezero/. Docker uses this exact production build.

### Scientific data shipped in Git

- **public/data/jezero/heights.f32** — 375×375 Float32 LE heights in metres, **20 m source cell posting**.
- **public/data/mars-global/** — global MOLA overview fallback and metadata for NASA MOLA, MOC, and Viking map layers. Detailed WMTS tiles need an internet connection.
- **public/data/jezero/mask.u8** — separate valid/NoData mask. Missing elevations are *never* interpolated as valid terrain.
- **public/data/jezero/metadata.json** and **checksums.sha256** — original USGS source, grid shape, WKT projection, reference points, SHA-256 provenance.
- **public/data/jezero/ctx_ortho.png** and **ctx_ortho.json** — **5 m optical** imagery aligned to DEM ROI, not a new elevation product.
- **results/jezero_slopes/** — local 8-neighbor grade raster/visualization, **not** route longitudinal grades.
- **points/jezero_points.csv** — project demonstration coordinates of A/B.

**Coordinates:** planetocentric latitude north and east-positive longitude in the actual product **Mars 2000 spherical equirectangular CRS**, with WKT radius **3,396,190 m**. Do **not** use Earth's EPSG:4326/WGS84 for the projected Mars XY routes.

Further material: [Official source references](docs/DATA_SOURCES.md) · [Selection and scientific context](docs/SITE_SELECTION.md) · [Coordinate validation](docs/COORDINATE_VALIDATION.md) · [DEM preparation details](docs/DEM_HANDOFF.md) · [A* assumptions](docs/ASTAR_ALGORITHM.md). The [historical development diary](docs/IMPLEMENTATION_HISTORY.md) retains the previous detailed README.

## Testing and troubleshooting

Run in the repository root:

~~~bash
npm ci
npm test
npm run build
python -m unittest discover -s tests -v
docker compose build
docker compose up -d
~~~

GitHub Actions runs **Web CI**, **Python CI** and **Docker build/smoke CI** for pull requests and pushes to main.

| Symptom | Solution |
|---|---|
| PowerShell blocks npm | Use npm.cmd instead of npm |
| Blank map / 404 for heights.f32 | Use the dev server URL, **not file://**; verify public/data/jezero/ and dist/data/jezero/ |
| Optical CTX toggle disabled | Verify the **already committed** ctx_ortho.png and ctx_ortho.json files are available |
| Routes do not appear | Both exports must match DEM SHA-256, Mars CRS, endpoints, sample step and slope thresholds |
| Python cannot find GeoTIFF | Run Python scripts/preprocess_dem.py --download or pass --dem PATH |
| No possible A* path | Grid or optional grade constraints may exclude all routes; do not invent a path |
| Old language/labels | Refresh (Ctrl+F5), update main and check the saved locale in browser |
| Docker can't bind port 8080 | Change host port in compose.yaml (for example 8081:8080) |
| Docker cannot access NASA site | The image does **not** download USGS data; published compact rasters are packaged during build |

**Handoff acceptance:** a new teammate should clone the repository, start Node or Docker without a GeoTIFF, inspect a real DEM+CTX map and A/B science stop, select three languages, optionally generate the two Python routes and compare them. No personal paths, access tokens, credentials or additional undocumented manual files are required.

## Attribution

This is a student/research **prototype for NASA Space Apps Challenge**, not an official NASA mission-control product. The included DEM and optical data are attributed to **NASA / USGS Astrogeology, MRO Context Camera (CTX)**. Full scientific data limitations, instrument descriptions and links are in [DATA_SOURCES.md](docs/DATA_SOURCES.md).
