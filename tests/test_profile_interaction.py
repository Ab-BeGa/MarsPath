"""Task 8 regression tests: map and profile use the same measured DEM samples.

Uses a deterministic synthetic Mars-projected GeoTIFF; no NASA data is altered.
"""
from __future__ import annotations

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

from profile_mars import Terrain, RouteEditor
from route_geometry import profile_index_at_distance, route_index_near_xy, route_samples

MARS_WKT = (
    'PROJCS["Jezero_Crater_Projection",GEOGCS["GCS_Mars_2000_Sphere",'
    'DATUM["Mars_2000_(Sphere)",SPHEROID["Mars_2000_Sphere",3396190,0]],'
    'PRIMEM["Reference_Meridian",0],UNIT["degree",0.0174532925199433]],'
    'PROJECTION["Equirectangular"],PARAMETER["standard_parallel_1",18.4663],'
    'PARAMETER["central_meridian",0],PARAMETER["false_easting",0],'
    'PARAMETER["false_northing",0],UNIT["metre",1]]'
)
ROOT = Path(__file__).resolve().parents[1]


class ProfileLookupTests(unittest.TestCase):
    def setUp(self):
        self.profile = route_samples([[0, 0], [40, 0], [40, 30]],
                                     lambda xy: xy[:, 0] - xy[:, 1], step_m=20)

    def test_cursor_distance_clamps_uses_measured_sample(self):
        self.assertEqual(profile_index_at_distance(self.profile, -20), 0)
        self.assertEqual(profile_index_at_distance(self.profile, 1000), len(self.profile.distance_m) - 1)
        self.assertEqual(profile_index_at_distance(self.profile, 19.9), 1)
        self.assertIsNone(profile_index_at_distance(self.profile, float("nan")))

    def test_map_selects_only_nearby_route_samples(self):
        self.assertEqual(route_index_near_xy(self.profile, [40.1, 15], tolerance=2), 3)
        self.assertIsNone(route_index_near_xy(self.profile, [500, 500], tolerance=2))
        self.assertIsNone(route_index_near_xy(self.profile, [float("nan"), 0], tolerance=10))
        self.assertIsNone(route_index_near_xy(self.profile, [0, 0], tolerance=0))


class MissionControlInteractionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        path = Path(self.tmp.name) / "fixture_mars_dem.tif"
        heights = -2540 + .18 * np.arange(200, dtype=np.float32)[:, None] + .12 * np.arange(200, dtype=np.float32)[None, :]
        with rasterio.open(path, "w", driver="GTiff", width=200, height=200,
                           count=1, dtype="float32", nodata=-9999,
                           transform=from_origin(4_350_000, 1_096_000, 20, 20),
                           crs=CRS.from_wkt(MARS_WKT)) as dst:
            dst.write(heights, 1)
        self.terrain = Terrain(path, ROOT / "jezero_site_selection/site_config.json")
        self.editor = RouteEditor(self.terrain, output=Path(self.tmp.name))
        self.editor.fig.canvas.draw()

    def tearDown(self):
        self.terrain.close()
        plt.close(self.editor.fig)
        self.tmp.cleanup()

    @staticmethod
    def event(axis, x, y=0, button=1):
        return SimpleNamespace(inaxes=axis, xdata=x, ydata=y, button=button)

    def test_graph_hover_selects_map_point_and_shows_measured_height(self):
        e = self.editor
        k = 7
        e.on_move(self.event(e.chart_ax, float(e.profile.distance_m[k])))
        self.assertEqual(e.probe_index, k)
        self.assertTrue(e.profile_cursor_dot.get_visible())
        np.testing.assert_allclose(e.map_cursor_dot.get_offsets()[0], e.profile.xy[k])
        self.assertIn("m", e.probe_info.get_text())
        self.assertIn("VALID", e.probe_detail.get_text())
        e.on_axes_leave(None)
        self.assertIsNone(e.probe_index)
        self.assertFalse(e.map_cursor_dot.get_visible())

    def test_map_hover_click_to_pin_and_route_edit_rebuild(self):
        e = self.editor
        k = 9
        x, y = e.profile.xy[k]
        e.on_move(self.event(e.map_ax, float(x), float(y)))
        self.assertEqual(e.probe_index, k)
        d = float(e.profile.distance_m[k])
        e.on_press(self.event(e.chart_ax, d))
        self.assertTrue(e.probe_pinned)
        e.on_axes_leave(None)
        self.assertEqual(e.probe_index, k)
        e.on_press(self.event(e.chart_ax, d))
        self.assertFalse(e.probe_pinned)
        self.assertIsNone(e.probe_index)
        route = e.waypoints
        mid = (route[0] + route[-1]) / 2 + np.array([90., 50.])
        e.on_press(self.event(e.map_ax, *mid))
        self.assertEqual(len(e.waypoints), 3)
        self.assertEqual(len(e.profile.waypoint_distance_m), 3)
        self.assertIsNone(e.probe_index)
        self.assertFalse(e.profile_cursor_line.get_visible())
        labels = [x.get_text() for x in e.chart_ax.texts]
        self.assertIn("A", labels)
        self.assertIn("B", labels)

    def test_probe_displays_missing_dem_as_nodata(self):
        e = self.editor
        # Inject a missing reading in the synthetic profile for presentation test.
        idx = len(e.profile.elevation_m) // 2
        e.profile.elevation_m[idx] = np.nan
        e.profile.sample_status[idx] = "nodata"
        e._set_probe(idx)
        self.assertIn("NODATA", e.probe_info.get_text())
        self.assertEqual(len(e.profile_cursor_dot.get_offsets()), 0)
        self.assertTrue(e.map_cursor_dot.get_visible())


if __name__ == "__main__":
    unittest.main()
