"""End-to-end DEM-to-CSV test using a small synthetic Mars-projected raster.

The fixture is deliberately not a claim to be the actual NASA DEM; it tests
NoData handling and CSV correctness while the user's USGS file remains local.
"""
from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin

from profile_mars import RouteEditor, Terrain

ROOT = Path(__file__).resolve().parents[1]
MARS_WKT = (
    'PROJCS["Jezero_Crater_Projection",GEOGCS["GCS_Mars_2000_Sphere",'
    'DATUM["Mars_2000_(Sphere)",SPHEROID["Mars_2000_Sphere",3396190,0]],'
    'PRIMEM["Reference_Meridian",0],UNIT["degree",0.0174532925199433]],'
    'PROJECTION["Equirectangular"],PARAMETER["standard_parallel_1",18.4663],'
    'PARAMETER["central_meridian",0],PARAMETER["false_easting",0],'
    'PARAMETER["false_northing",0],UNIT["metre",1]]'
)


class ExportIntegrationTests(unittest.TestCase):
    def test_missing_dem_pixel_is_visible_and_exported_without_fake_elevation(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            dem_path = tmp / "synthetic_mars_dem.tif"
            profile = -2600 + np.arange(200, dtype=np.float32)[:, None] * 0.2 + np.arange(200, dtype=np.float32)[None, :] * 0.2
            with rasterio.open(dem_path, "w", driver="GTiff", height=200, width=200,
                               count=1, dtype="float32", crs=CRS.from_wkt(MARS_WKT),
                               transform=from_origin(4_350_000, 1_096_000, 20, 20),
                               nodata=-9999) as ds:
                ds.write(profile, 1)
            terrain = Terrain(dem_path, ROOT / "jezero_site_selection/site_config.json")
            try:
                p = RouteEditor(terrain, output=tmp).calculate()
                middle_xy = p.xy[len(p.xy) // 2]
                row, col = terrain.dem.index(float(middle_xy[0]), float(middle_xy[1]))
            finally:
                terrain.close()
                plt.close("all")
            with rasterio.open(dem_path, "r+") as ds:
                arr = ds.read(1)
                arr[row, col] = -9999
                ds.write(arr, 1)
            terrain = Terrain(dem_path, ROOT / "jezero_site_selection/site_config.json")
            try:
                editor = RouteEditor(terrain, output=tmp)
                p = editor.calculate()
                self.assertGreater(p.missing_count, 0)
                self.assertIn("nodata", p.sample_status.tolist())
                self.assertLess(p.coverage_pct, 100)
                editor.export()
                with (tmp / "route_profile.csv").open(newline="", encoding="utf-8") as f:
                    rows = list(csv.DictReader(f))
                missing = [r for r in rows if r["dem_status"] != "valid"]
                self.assertTrue(missing)
                self.assertTrue(all(r["dem_status"] == "nodata" and r["elevation_m"] == "" for r in missing))
                self.assertEqual(len(rows), len(p.distance_m))
                self.assertLessEqual(p.max_sample_spacing_m, 20 + 1e-10)
                self.assertEqual(len(set(r["distance_m"] for r in rows)), len(rows))
                data = json.loads((tmp / "route_waypoints.json").read_text(encoding="utf-8"))
                self.assertEqual(data["samples_missing"], len(missing))
                self.assertEqual(data["dem_status_counts"], p.status_counts)
                self.assertTrue((tmp / "route_profile.png").exists())
            finally:
                terrain.close()
                plt.close("all")


if __name__ == "__main__":
    unittest.main()
