"""Task 9 UI / JSON smoke checks on a synthetic Mars-projected GeoTIFF."""
from __future__ import annotations

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

MARS_WKT = (
    'PROJCS["Jezero_Crater_Projection",GEOGCS["GCS_Mars_2000_Sphere",'
    'DATUM["Mars_2000_(Sphere)",SPHEROID["Mars_2000_Sphere",3396190,0]],'
    'PRIMEM["Reference_Meridian",0],UNIT["degree",0.0174532925199433]],'
    'PROJECTION["Equirectangular"],PARAMETER["standard_parallel_1",18.4663],'
    'PARAMETER["central_meridian",0],PARAMETER["false_easting",0],'
    'PARAMETER["false_northing",0],UNIT["metre",1]]'
)
ROOT = Path(__file__).resolve().parents[1]


class RouteDashboardTests(unittest.TestCase):
    def test_metrics_update_when_waypoint_is_added_and_json_matches_panel(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "terrain.tif"
            # Non-planar terrain ensures a detour changes ascent and slope.
            row, col = np.mgrid[0:200, 0:200]
            heights = (-2540 + .1 * row + .2 * col + 6 * np.sin(col / 9)).astype("float32")
            with rasterio.open(path, "w", driver="GTiff", width=200, height=200,
                               count=1, dtype="float32", nodata=-9999,
                               transform=from_origin(4_350_000, 1_096_000, 20, 20),
                               crs=CRS.from_wkt(MARS_WKT)) as dst:
                dst.write(heights, 1)
            terrain = Terrain(path, ROOT / "jezero_site_selection/site_config.json")
            try:
                editor = RouteEditor(terrain, output=Path(td))
                before = editor.route_metrics
                self.assertAlmostEqual(before.distance_m, 523.0702474, places=3)
                midpoint = (editor.waypoints[0] + editor.waypoints[-1]) / 2 + np.array([120, 120])
                event = SimpleNamespace(inaxes=editor.map_ax, xdata=float(midpoint[0]),
                                        ydata=float(midpoint[1]), button=1)
                editor.on_press(event)
                after = editor.route_metrics
                self.assertEqual(len(editor.waypoints), 3)
                self.assertGreater(after.distance_m, before.distance_m)
                self.assertTrue(editor.metric_ascent.get_text().startswith("+"))
                self.assertIn("°", editor.metric_slope.get_text())
                self.assertGreater(after.valid_edges, 0)
                editor.export()
                payload = json.loads((Path(td) / "route_waypoints.json").read_text("utf-8"))
                metrics = payload["route_metrics"]
                self.assertAlmostEqual(metrics["distance_m"], after.distance_m)
                self.assertAlmostEqual(metrics["total_ascent_m"], after.ascent_m)
                self.assertEqual(metrics["valid_intervals"], after.valid_edges)
                self.assertFalse(metrics["partial_due_to_missing_dem"])
                self.assertTrue((Path(td) / "route_profile.png").exists())
            finally:
                plt.close("all")
                terrain.close()


if __name__ == "__main__":
    unittest.main()
