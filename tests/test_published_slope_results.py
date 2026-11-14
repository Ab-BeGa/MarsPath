"""Validate committed Jezero local-slope artifacts against the bundled real DEM.

Unlike the synthetic slope-algorithm unit tests, this test checks that the
actual published Float32 grid, JSON summary and viewable PNG are consistent
with the checked-in USGS CTX DEM 75x75 crop.
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from terrain_slopes import DATA_DIR, calculate_local_slopes, load_dem


ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = ROOT / "results" / "jezero_slopes"


class PublishedLocalSlopesTests(unittest.TestCase):
    def test_committed_results_match_recomputed_mars_dem(self):
        heights, valid, dx, dy, metadata = load_dem(DATA_DIR)
        calculated = calculate_local_slopes(heights, valid, dx, dy)
        rows, cols = heights.shape

        binary_path = OUTPUTS / "local_max_slope_deg.f32"
        self.assertTrue(binary_path.is_file())
        self.assertEqual(binary_path.stat().st_size, rows * cols * 4)
        published = np.fromfile(binary_path, dtype="<f4").reshape(rows, cols)

        np.testing.assert_allclose(
            published, calculated.local_max_slope_deg.astype("<f4"),
            rtol=0, atol=1e-5, equal_nan=True,
            err_msg="Published slopes differ from recomputation on the real DEM",
        )
        self.assertTrue(np.array_equal(
            np.isfinite(published), np.isfinite(calculated.local_max_slope_deg)
        ))

        summary_path = OUTPUTS / "slope_summary.json"
        self.assertTrue(summary_path.is_file())
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        self.assertEqual(summary["grid_shape_rows_cols"], [rows, cols])
        self.assertEqual(summary["pixel_size_m_xy"], [dx, dy])
        self.assertEqual(summary["source"], metadata["source"]["product"])
        self.assertEqual(summary["valid_neighbor_edges"], calculated.valid_edges)
        self.assertEqual(
            summary["cells_with_measured_slope"],
            int(np.isfinite(calculated.local_max_slope_deg).sum()),
        )
        self.assertAlmostEqual(
            summary["max_measured_slope_deg"],
            calculated.max_slope_deg, places=5,
        )
        self.assertEqual(
            summary["steepest_edge_row_col"],
            [list(point) for point in calculated.steepest_edge]
            if calculated.steepest_edge else None,
        )
        self.assertIn("no interpolation", summary["nodata_policy"])

    def test_published_png_is_readable_and_is_not_the_large_source_geotiff(self):
        image_path = OUTPUTS / "local_slopes.png"
        self.assertTrue(image_path.is_file())
        with Image.open(image_path) as image:
            self.assertEqual(image.format, "PNG")
            self.assertGreaterEqual(image.width, 500)
            self.assertGreaterEqual(image.height, 500)
            image.verify()
        for extension in ("*.tif", "*.tiff"):
            self.assertFalse(list(OUTPUTS.glob(extension)))


if __name__ == "__main__":
    unittest.main()
