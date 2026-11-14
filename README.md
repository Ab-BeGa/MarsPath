# Jezero Traverse

NASA Space Apps Challenge prototype for studying terrain and planning manual waypoint routes in the western delta of Jezero crater, Mars.

## Interactive mission control

This branch provides a dark-themed interactive route editor in `profile_mars.py` and tested sampling functions in `route_geometry.py`.

### Set up in Windows / VS Code

1. Obtain `M20_JezeroCrater_CTXDEM_20m.tif` from [USGS Jezero CTX DEM](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif).
2. Put it in `jezero_site_selection/` (excluded from Git).
3. In the repo root, run:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe profile_mars.py
```

Or specify a custom DEM path:

```powershell
.\.venv\Scripts\python.exe profile_mars.py --dem "C:\path\to\M20_JezeroCrater_CTXDEM_20m.tif"
```

### Controls

- Left click empty valid terrain — insert a waypoint in the closest route segment.
- Drag an intermediate waypoint — move the turn; endpoints are fixed.
- Right click an intermediate waypoint — remove it.
- `Ctrl+Z` / **UNDO** — restore the previous route.
- `R` / **RESET** — restore the direct line.
- `E` / **EXPORT ROUTE** — save `route_profile.csv`, `route_waypoints.json`, `route_profile.png`.
- Restore a saved route with `--load route_waypoints.json`.
- Use `--export-only` to export without an interactive window.

The app shows the real 20m CTX DEM cropped to a 1.5×1.5km study region, loads A (hypothetical Three Forks base) and B (Wildcat Ridge/Hazeltop science site), samples elevation at ≤20m along each polyline segment, and updates the route length, waypoint count, DEM sample validity, and elevation graph after each edit.

### Tests

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## Scientific limitations

This is a research demonstration, **not** a certified route planner. Neither a straight nor a manually entered route can be declared safe from a 20m/pixel DEM. Hazard detection, measured local slopes and automated routing belong to later project tasks. Unknown DEM values are marked as missing rather than invented.

## Supporting files

- `jezero_site_selection/` — site configuration, documented coordinates, and earlier DEM validator.
- `route_geometry.py` — deterministic route sampling.
- `profile_mars.py` — interactive mission dashboard.
