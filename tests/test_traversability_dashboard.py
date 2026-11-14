"""UI state, adjustable thresholds and exports for Task 11."""
from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

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

class TraversabilityUITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "mars_fixture.tif"
        rows, cols = np.mgrid[:200, :200]
        heights = (-2540 + 1.5 * np.sin(cols * .65) + .17 * rows + .2 * cols).astype("float32")
        with rasterio.open(self.path, "w", driver="GTiff", width=200, height=200,
                           count=1, dtype="float32", nodata=-9999,
                           transform=from_origin(4_350_000, 1_096_000, 20, 20),
                           crs=CRS.from_wkt(MARS_WKT)) as dst:
            dst.write(heights, 1)
        self.terrain = Terrain(self.path, ROOT / "jezero_site_selection/site_config.json")
        self.editor = RouteEditor(self.terrain, output=Path(self.tmp.name))
        self.editor.fig.canvas.draw()

    def tearDown(self):
        plt.close(self.editor.fig)
        self.terrain.close()
        self.tmp.cleanup()

    def test_thresholds_can_change_live_and_invalid_values_are_rejected(self):
        e = self.editor
        before = e.traversability
        self.assertEqual(e.thresholds.as_dict()["gentle_max_deg"], 5)
        e.threshold_fields[0].set_val("2")
        self.assertEqual(e.thresholds.gentle_max_deg, 2)
        after = e.traversability
        self.assertEqual(before.total_m, after.total_m)
        self.assertEqual(after.thresholds.gentle_max_deg, 2)
        e.threshold_fields[0].set_val("12")
        self.assertEqual(e.thresholds.gentle_max_deg, 2)
        self.assertIn("INVALID LIMITS", e.status_text.get_text())
        e.threshold_fields[0].set_val("4")
        self.assertEqual(e.thresholds.gentle_max_deg, 4)

    def test_route_change_recomputes_bands_and_exports(self):
        e = self.editor
        before = e.traversability.total_m
        mid = (e.waypoints[0] + e.waypoints[-1]) / 2 + np.array([100, 130])
        e.on_press(SimpleNamespace(inaxes=e.map_ax, xdata=float(mid[0]),
                                   ydata=float(mid[1]), button=1))
        self.assertEqual(len(e.waypoints), 3)
        self.assertGreater(e.traversability.total_m, before)
        e.export()
        data = json.loads((Path(self.tmp.name) / "route_waypoints.json").read_text())
        report = data["experimental_traversability"]
        self.assertEqual(report["thresholds_deg"]["gentle_max_deg"], 5)
        self.assertAlmostEqual(sum(report["distance_by_band_m"].values()), data["route_metrics"]["distance_m"])
        with (Path(self.tmp.name) / "route_traversability.csv").open(newline="") as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(len(rows), len(e.profile.distance_m) - 1)
        self.assertIn("slope_band", rows[0])
        self.assertTrue((Path(self.tmp.name) / "route_profile.png").exists())

    def test_unknown_intervals_not_misclassified(self):
        e = self.editor
        k = len(e.profile.xy) // 2
        pt = e.profile.xy[k]
        row, col = self.terrain.dem.index(float(pt[0]), float(pt[1]))
        self.terrain.close()
        plt.close(e.fig)
        with rasterio.open(self.path, "r+") as ds:
            pixels = ds.read(1)
            pixels[row, col] = -9999
            ds.write(pixels, 1)
        self.terrain = Terrain(self.path, ROOT / "jezero_site_selection/site_config.json")
        self.editor = RouteEditor(self.terrain, output=Path(self.tmp.name))
        report = self.editor.traversability
        self.assertGreater(report.unknown_m, 0)
        self.assertLess(report.measured_pct, 100)
        self.assertEqual(report.band_distances_m["unknown"], report.unknown_m)
        self.assertIn("UNKNOWN", self.editor.status_text.get_text())

if __name__ == '__main__':
    unittest.main()
