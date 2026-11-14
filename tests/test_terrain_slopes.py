"""Unit tests for DEM neighbor-edge slope computation (synthetic grids)."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from terrain_slopes import calculate_local_slopes, load_dem, slope_between_cells


class TerrainSlopeTests(unittest.TestCase):
    def test_flat_grid_has_zero_local_slope(self):
        heights = np.full((3, 3), -2500, dtype=np.float32)
        result = calculate_local_slopes(heights, np.ones((3, 3), bool), 20, 20)
        np.testing.assert_array_equal(result.local_max_slope_deg, 0)
        self.assertEqual(result.valid_edges, 20)
        self.assertEqual(result.max_slope_deg, 0)

    def test_horizontal_ascent_and_descent_same_absolute_angle(self):
        h = np.array([[0, 5]], dtype=float)
        mask = np.ones_like(h, bool)
        expected = np.degrees(np.arctan(5 / 20))
        self.assertAlmostEqual(slope_between_cells(h, mask, (0, 0), (0, 1), 20, 20), expected)
        self.assertAlmostEqual(slope_between_cells(h, mask, (0, 1), (0, 0), 20, 20), expected)
        result = calculate_local_slopes(h, mask, 20, 20)
        self.assertAlmostEqual(result.max_slope_deg, expected)
        self.assertEqual(result.steepest_edge, ((0, 0), (0, 1)))

    def test_diagonal_distance_is_sqrt_two_times_cell_size(self):
        h = np.array([[0.0, np.nan], [np.nan, 5.0]])
        valid = np.array([[1, 0], [0, 1]], dtype=np.uint8)
        expected = np.degrees(np.arctan(5 / np.hypot(20, 20)))
        result = calculate_local_slopes(h, valid, 20, 20)
        self.assertEqual(result.valid_edges, 1)
        self.assertAlmostEqual(result.max_slope_deg, expected)
        self.assertEqual(result.steepest_edge, ((0, 0), (1, 1)))
        self.assertTrue(np.isnan(result.local_max_slope_deg[0, 1]))

    def test_negative_column_diagonal_and_unequal_pixel_sizes(self):
        h = np.array([[np.nan, 0.0], [5.0, np.nan]])
        valid = np.isfinite(h)
        result = calculate_local_slopes(h, valid, 20, 10)
        expected = np.degrees(np.arctan(5 / np.hypot(20, 10)))
        self.assertAlmostEqual(result.max_slope_deg, expected)
        self.assertEqual(result.steepest_edge, ((0, 1), (1, 0)))

    def test_nodata_is_not_interpolated_or_bridged(self):
        h = np.array([[0.0, np.nan, 20.0]])
        valid = np.array([[1, 0, 1]], dtype=bool)
        result = calculate_local_slopes(h, valid, 20, 20)
        self.assertEqual(result.valid_edges, 0)
        self.assertIsNone(result.max_slope_deg)
        self.assertIsNone(result.steepest_edge)
        self.assertTrue(np.isnan(result.local_max_slope_deg).all())
        self.assertIsNone(slope_between_cells(h, valid, (0, 0), (0, 1), 20, 20))

    def test_invalid_inputs_are_rejected(self):
        h = np.array([[0, 1]], dtype=float)
        with self.assertRaises(ValueError):
            calculate_local_slopes(h, np.array([[1, 1, 1]]), 20, 20)
        with self.assertRaises(ValueError):
            calculate_local_slopes(h, np.ones_like(h), -20, 20)
        with self.assertRaises(ValueError):
            slope_between_cells(h, np.ones_like(h, bool), (0, 0), (0, 0), 20, 20)
        with self.assertRaises(ValueError):
            calculate_local_slopes(np.array([[np.nan, 0]]), np.ones((1, 2)), 20, 20)

    def test_loader_uses_metadata_and_rejects_wrong_binary_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            meta = {"grid": {"height": 2, "width": 2, "pixel_size_m": [20, 20],
                    "transform": [20, 0, 0, 0, -20, 0],
                    "heights_file": "heights.f32", "mask_file": "mask.u8",
                    "heights_encoding": "IEEE-754 float32 little-endian, row-major"}}
            (p / "metadata.json").write_text(json.dumps(meta), encoding="utf-8")
            np.array([1, 2, 3, 4], dtype="<f4").tofile(p / "heights.f32")
            np.array([1, 1, 1, 0], dtype="u1").tofile(p / "mask.u8")
            h, valid, dx, dy, _ = load_dem(p)
            self.assertEqual(h.shape, (2, 2))
            self.assertEqual((dx, dy), (20, 20))
            self.assertFalse(valid[1, 1])
            (p / "mask.u8").write_bytes(bytes([1, 1]))
            with self.assertRaises(ValueError):
                load_dem(p)


if __name__ == "__main__":
    unittest.main()
