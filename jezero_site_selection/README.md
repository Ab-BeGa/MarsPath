# Jezero Traverse — site selection

Confirmed study region: western Jezero delta, approximately 1.5 × 1.5 km.

- **A / hypothetical base:** Three Forks, 18.45369687°N, 77.41359752°E.
- **B / science stop:** Wildcat Ridge / Hazeltop, 18.45863707°N, 77.40588851°E.
- **Straight-line distance:** approximately 523 m on a spherical Mars model. This is **not** a traversable or safety-validated route.
- **Local CTX DEM verification (2026-11-14):** 75 × 75 DEM pixels, 100% valid coverage, A = −2547.25 m, B = −2520.48 m, terrain range −2560.27 to −2460.30 m. These figures are recorded from the team's local console output; the DEM itself is not bundled.

## Run on Windows (VS Code terminal)

From the repository root:

1. Download M20_JezeroCrater_CTXDEM_20m.tif from the USGS source listed below.
2. Save the GeoTIFF inside the jezero_site_selection directory (do **not** commit the .tif to GitHub).
3. Install the dependencies and run:

    py -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -r jezero_site_selection\requirements.txt
    .\.venv\Scripts\python.exe jezero_site_selection\verify_site_dem.py --dem jezero_site_selection\M20_JezeroCrater_CTXDEM_20m.tif

Generated file: jezero_site_selection/site_dem_preview.png (ignored by Git).

On macOS/Linux, use python3 and the .venv/bin/python interpreter.

## File guide

- verify_site_dem.py — reads a Mars-projected GeoTIFF and checks actual DEM pixels and elevations.
- site_config.json — the region, documented coordinates, data source links and local check results.
- requirements.txt — dependencies for this module.

## Data provenance

- Three Forks center: [LPSC 2023 abstract](https://www.hou.usra.edu/meetings/lpsc2023/pdf/2618.pdf).
- Wildcat Ridge / Hazeltop: [Mars 2020 Initial Reports, Volume 2](https://pds-geosciences.wustl.edu/missions/mars2020/Mars%202020%20Initial%20Reports%20Volume%202%20Release%202.pdf).
- DEM GeoTIFF: [USGS planetarymaps](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif); [USGS data catalog](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic).

**Scientific limitation:** this program only validates elevation coverage and renders a straight segment between two points. It does not yet analyze slope, obstacles, route safety or mission-specific mobility limits. The base location is hypothetical.
