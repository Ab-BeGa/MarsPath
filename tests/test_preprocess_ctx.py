"""Offline tests for georeferencing the official CTX orthoimage to the real Jezero DEM ROI."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin

from scripts.preprocess_ctx import generate_ctx_tile

ROOT = Path(__file__).resolve().parents[1]
DEM_METADATA = ROOT / "public" / "data" / "jezero" / "metadata.json"


class CtxPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.meta = json.loads(DEM_METADATA.read_text(encoding="utf-8"))
        self.bounds = self.meta["grid"]["bounds_projected_m"]
        self.crs = CRS.from_wkt(self.meta["crs_wkt"])

    def tearDown(self):
        self.temp.cleanup()

    def make_source(self, *, crs=None, covered=True, nodata=False):
        left, bottom, right, top = self.bounds
        if covered:
            t = from_origin(left - 50, top + 50, 5, 5)
            # The current optical region is 7.5 km at 5 m/pixel, plus 50 m
            # of synthetic coverage around all four edges.
            rows, cols = 1520, 1520
        else:
            t = from_origin(left, top, 5, 5)
            rows, cols = 20, 20
        yy, xx = np.mgrid[:rows, :cols]
        data = (xx + yy * 3 + 10).astype(np.uint16)
        if nodata:
            data[80:100, 80:100] = 65535  # transparent patch in CTX image
        source = self.path / "optical_source.tif"
        with rasterio.open(
            source, "w", driver="GTiff", count=1, width=cols, height=rows,
            dtype="uint16", crs=crs or self.crs, transform=t, nodata=65535,
        ) as dst:
            dst.write(data, 1)
        return source

    def test_warps_optical_image_into_dem_bounds_with_real_mars_crs(self):
        source = self.make_source(nodata=True)
        output = self.path / "out"
        result = generate_ctx_tile(source, DEM_METADATA, output)
        self.assertEqual(result["alignment"]["resolution_m"], 5)
        self.assertEqual(result["alignment"]["width"], 1500)
        self.assertEqual(result["alignment"]["height"], 1500)
        self.assertEqual(result["alignment"]["target_dem_sha256"], self.meta["source"]["source_sha256"])
        self.assertEqual(result["alignment"]["target_dem_crs_wkt"], self.meta["crs_wkt"])
        self.assertGreater(result["alignment"]["coverage_valid_fraction"], .9)
        self.assertLess(result["alignment"]["coverage_valid_fraction"], 1.0)
        self.assertEqual(result["alignment"]["bounds_projected_m"], self.bounds)
        self.assertEqual(result["display"]["image_file"], "ctx_ortho.png")
        with Image.open(output / "ctx_ortho.png") as image:
            self.assertEqual(image.size, (1500, 1500))
            self.assertEqual(image.mode, "RGBA")
            rgba = np.asarray(image)
            self.assertEqual(int(rgba[80, 80, 3]), 0)
            self.assertEqual(int(rgba[200, 200, 3]), 255)
            self.assertNotEqual(int(rgba[40, 40, 0]), int(rgba[160, 160, 0]))
        self.assertTrue((output / "ctx_ortho.json").exists())
        self.assertEqual(json.loads((output / "ctx_ortho.json").read_text())["kind"], "real_ctx_orthomosaic")

    def test_accepts_mars_sphere_when_crs_has_generic_unknown_name(self):
        # The official CTX GeoTIFF may use a valid Mars-radius spherical CRS
        # without literally naming the planet 'Mars' in the embedded WKT.
        unnamed_crs = CRS.from_string(
            "+proj=eqc +lat_ts=18.4663 +lat_0=0 +lon_0=0 "
            "+R=3396190 +units=m +no_defs"
        )
        self.assertNotIn("Mars", unnamed_crs.to_wkt())
        source = self.make_source(crs=unnamed_crs)
        output = self.path / "unknown_crs_out"
        result = generate_ctx_tile(source, DEM_METADATA, output)
        self.assertEqual(result["alignment"]["width"], 1500)
        self.assertEqual(result["alignment"]["height"], 1500)
        self.assertTrue((output / "ctx_ortho.png").exists())

    def test_rejects_projected_earth_crs_even_if_crs_name_is_generic(self):
        source = self.make_source(crs=CRS.from_epsg(3857))
        with self.assertRaisesRegex(ValueError, "Mars-sized ellipsoid"):
            generate_ctx_tile(source, DEM_METADATA, self.path / "earth_out")

    def test_rejects_earth_projection(self):
        source = self.make_source(crs=CRS.from_epsg(4326))
        with self.assertRaisesRegex(ValueError, "projected Mars CRS"):
            generate_ctx_tile(source, DEM_METADATA, self.path / "out")

    def test_rejects_incomplete_optical_coverage(self):
        source = self.make_source(covered=False)
        with self.assertRaisesRegex(ValueError, "does not sufficiently cover"):
            generate_ctx_tile(source, DEM_METADATA, self.path / "out")

    def test_rejects_grid_resolution_that_does_not_divide_study_area(self):
        source = self.make_source()
        with self.assertRaisesRegex(ValueError, "exactly divide"):
            generate_ctx_tile(source, DEM_METADATA, self.path / "out", resolution_m=7)

    def test_rejects_malformed_dem_bounds(self):
        source = self.make_source()
        broken = self.path / "bad_metadata.json"
        metadata = json.loads(json.dumps(self.meta))
        metadata["grid"]["bounds_projected_m"][0] += 100
        broken.write_text(json.dumps(metadata), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "do not match"):
            generate_ctx_tile(source, broken, self.path / "out")


if __name__ == "__main__":
    unittest.main()
