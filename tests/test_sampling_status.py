"""Regression tests for Task 7: sampling actual DEM pixels along a route."""
from __future__ import annotations

import unittest

import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from route_geometry import route_samples
from terrain_sampling import sample_dem_points


class RealRasterSamplingTests(unittest.TestCase):
    def setUp(self):
        # Mars-like projected raster. Cell size 20 metres and -9999 is NoData.
        self.mem = MemoryFile()
        self.dem = self.mem.open(driver="GTiff", width=4, height=4, count=1,
                                 dtype="float32", nodata=-9999, transform=from_origin(0, 80, 20, 20))
        self.grid = -2500 + np.arange(16, dtype=np.float32).reshape(4, 4)
        self.grid[0, 1] = -9999
        self.dem.write(self.grid, 1)

    def tearDown(self):
        self.dem.close()
        self.mem.close()

    def test_dem_reports_valid_nodata_roi_and_file_bounds_individually(self):
        xy = [[10, 70], [30, 70], [10, 30], [90, 70], [float("nan"), 70]]
        heights, states = sample_dem_points(self.dem, xy, (0, 60, 40, 80))
        self.assertEqual(states.tolist(), ["valid", "nodata", "outside_roi", "outside_dem", "invalid_xy"])
        self.assertEqual(heights[0], -2500)
        self.assertTrue(np.isnan(heights[1:]).all())

    def test_empty_inputs_and_invalid_shapes(self):
        h, s = sample_dem_points(self.dem, np.empty((0, 2)), (0, 60, 40, 80))
        self.assertEqual(len(h), 0)
        self.assertEqual(len(s), 0)
        with self.assertRaises(ValueError):
            sample_dem_points(self.dem, [10, 70])
        with self.assertRaises(ValueError):
            sample_dem_points(self.dem, [[10, 70]], (10, 0, 0, 80))

    def test_polyline_sampling_preserves_order_status_and_spacing(self):
        route = [[10, 70], [70, 70], [70, 50]]
        def sample(xy):
            return sample_dem_points(self.dem, xy, (0, 60, 0, 80))
        profile = route_samples(route, sample, step_m=20)
        self.assertAlmostEqual(profile.total_m, 80)
        np.testing.assert_allclose(profile.distance_m, [0, 20, 40, 60, 80])
        np.testing.assert_allclose(profile.waypoint_distance_m, [0, 60, 80])
        self.assertLessEqual(profile.max_sample_spacing_m, 20)
        self.assertEqual(profile.sample_status.tolist(),
                         ["valid", "nodata", "valid", "outside_roi", "outside_roi"])
        self.assertEqual(profile.missing_count, 3)
        self.assertAlmostEqual(profile.coverage_pct, 40)
        self.assertTrue(np.isnan(profile.elevation_m[[1, 3, 4]]).all())
        self.assertEqual(profile.status_counts, {"valid": 2, "nodata": 1, "outside_roi": 2})

    def test_step_never_exceeds_requested_bound_on_diagonal_or_turns(self):
        p = route_samples([[0, 0], [41, 41], [60, 52]], lambda xy: np.zeros(len(xy)), step_m=20)
        self.assertLessEqual(p.max_sample_spacing_m, 20 + 1e-10)
        self.assertEqual(int(np.sum(np.all(np.isclose(p.xy, [41, 41]), axis=1))), 1)
        np.testing.assert_allclose(p.xy[-1], [60, 52])

    def test_result_contract_rejects_invalid_statuses_and_lengths(self):
        with self.assertRaisesRegex(ValueError, "Status sampler"):
            route_samples([[0, 0], [20, 0]], lambda xy: (np.zeros(len(xy)), ["valid"]))
        with self.assertRaisesRegex(ValueError, "mismatch"):
            route_samples([[0, 0], [20, 0]], lambda xy: (np.full(len(xy), np.nan), ["valid"] * len(xy)))
        with self.assertRaisesRegex(ValueError, "Unexpected DEM sample status"):
            route_samples([[0, 0], [20, 0]], lambda xy: (np.full(len(xy), np.nan), ["safe"] * len(xy)))

    def test_numpy_sampler_backwards_compatibility(self):
        p = route_samples([[0, 0], [40, 0]], lambda xy: np.array([-1, np.nan, -3]))
        self.assertEqual(p.sample_status.tolist(), ["valid", "nodata", "valid"])
        self.assertEqual(p.missing_count, 1)


if __name__ == "__main__":
    unittest.main()
