"""Gale DEM ETL is independently verified on a small *synthetic test fixture*.
Never commit the fixture's heights as actual Gale data.
"""
import json
import math
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin

from scripts.preprocess_gale_dem import MARS_RADIUS, ROI_LAT, ROI_LON, preprocess, to_xy


class TestGaleETL(unittest.TestCase):
    def _source(self, folder: Path, *, gaps: bool = False) -> Path:
        # Official source convention, but fabricated elevations FOR UNIT TESTS.
        # Use a real Mars eqc WKT rather than Earth EPSG:4326.
        crs = CRS.from_proj4(
            "+proj=eqc +lat_ts=0 +lon_0=0 +R=3396190 +units=m +no_defs"
        )
        x, y = to_xy({"R": MARS_RADIUS, "lat_ts": 0}, ROI_LON, ROI_LAT)
        path = folder / "synthetic_mars_gale_unit_test.tif"
        h = 900
        w = 900
        arr = np.full((h, w), -4600.0, dtype="float32")
        arr += np.linspace(0, 3, w, dtype="float32")[None, :]
        if gaps:
            arr[420:480, 420:480] = -32767.0
        with rasterio.open(
            path, "w", driver="GTiff", width=w, height=h, count=1,
            dtype="float32", crs=crs,
            transform=from_origin(x-450, y+450, 1.0, 1.0),
            nodata=-32767.0,
        ) as dst:
            dst.write(arr, 1)
        return path

    def test_compact_mars_projection_and_real_sampling_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            d = Path(temp)
            source = self._source(d)
            metadata = preprocess(source, d / "out", size=21, output_cell_m=20)
            self.assertEqual(metadata["grid"]["width"], 21)
            self.assertEqual(metadata["grid"]["pixel_size_m"], [20, 20])
            self.assertEqual(metadata["grid"]["valid_cells"], 441)
            self.assertEqual(metadata["source"]["native_source_resolution_m"], 1)
            self.assertEqual(metadata["source"]["hash_scope"],
                             "compact_heights_f32_plus_mask_u8_not_original_geotiff")
            self.assertAlmostEqual(metadata["coordinate_convention"]["projection_standard_parallel_deg"], 0)
            self.assertEqual(metadata["coordinate_convention"]["source_crs_sphere_radius_m"], 3396190)
            out = d / "out"
            heights = np.fromfile(out / "heights.f32", dtype="<f4").reshape((21, 21))
            self.assertLess(float(heights.min()), -4596)
            self.assertTrue(np.isfinite(heights).all())
            self.assertEqual((out / "mask.u8").stat().st_size, 21 * 21)
            self.assertEqual(len(metadata["checked_points"]), 3)
            self.assertTrue(all(-5 < p["latitude_deg"] < -4 for p in metadata["checked_points"]))
            self.assertTrue(all(137 < p["longitude_deg"] < 138 for p in metadata["checked_points"]))

    def test_out_of_bounds_and_invalid_spacing_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            d = Path(temp)
            source = self._source(d)
            with self.assertRaisesRegex(ValueError, "outside actual DEM"):
                preprocess(source, d / "out", size=101)
            with self.assertRaisesRegex(ValueError, "size must be odd"):
                preprocess(source, d / "out", size=20)
            with self.assertRaisesRegex(ValueError, "pixel spacing"):
                preprocess(source, d / "out", size=21, output_cell_m=0)

    def test_nodata_mask_is_not_invented_as_zero_elevation(self):
        with tempfile.TemporaryDirectory() as temp:
            d = Path(temp)
            source = self._source(d, gaps=True)
            with self.assertRaisesRegex(ValueError, "NoData|Demo point"):
                preprocess(source, d / "out", size=21)


if __name__ == "__main__":
    unittest.main()
