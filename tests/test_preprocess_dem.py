import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from scripts.preprocess_dem import mars_lonlat_to_projected, preprocess, projected_distance_m


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "M20_JezeroCrater_CTXDEM_20m.tif"
POINTS = ROOT / "points" / "jezero_points.csv"


class ProjectionTests(unittest.TestCase):
    def test_mars_projection_matches_equirectangular_formula(self):
        crs = rasterio.crs.CRS.from_wkt(
            'PROJCS["Jezero_Crater_Projection",GEOGCS["GCS_Mars_2000_Sphere",'
            'DATUM["Mars_2000_(Sphere)",SPHEROID["Mars_2000_Sphere",3396190,0]],'
            'PRIMEM["Reference_Meridian",0],UNIT["degree",0.0174532925199433]],'
            'PROJECTION["Equirectangular"],PARAMETER["standard_parallel_1",18.4663],'
            'PARAMETER["central_meridian",0],PARAMETER["false_easting",0],'
            'PARAMETER["false_northing",0],UNIT["metre",1]]'
        )
        x, y = mars_lonlat_to_projected(crs, 77.40974302, 18.45616697)
        self.assertAlmostEqual(x, 4_352_180.933841924, places=5)
        self.assertAlmostEqual(y, 1_093_983.7145863853, places=5)

    def test_east_positive_longitude_and_projected_distance_in_metres(self):
        crs = rasterio.crs.CRS.from_wkt(
            'PROJCS["Jezero_Crater_Projection",GEOGCS["GCS_Mars_2000_Sphere",'
            'DATUM["Mars_2000_(Sphere)",SPHEROID["Mars_2000_Sphere",3396190,0]],'
            'PRIMEM["Reference_Meridian",0],UNIT["degree",0.0174532925199433]],'
            'PROJECTION["Equirectangular"],PARAMETER["standard_parallel_1",18.4663],'
            'PARAMETER["central_meridian",0],PARAMETER["false_easting",0],'
            'PARAMETER["false_northing",0],UNIT["metre",1]]'
        )
        east_x, _ = mars_lonlat_to_projected(crs, 77.40974302, 18.45616697)
        west_x, _ = mars_lonlat_to_projected(crs, -77.40974302, 18.45616697)
        self.assertGreater(east_x, 0)
        self.assertLess(west_x, 0)
        distance = projected_distance_m(crs, (4_352_397.644048612, 1_093_837.300156033),
                                        (4_351_964.22307301, 1_094_130.1290167375))
        self.assertAlmostEqual(distance, 523.0702474, places=5)

    def test_rejects_earth_crs_for_mars_coordinates(self):
        with self.assertRaisesRegex(ValueError, "projected"):
            mars_lonlat_to_projected(rasterio.crs.CRS.from_epsg(4326), 77.4, 18.45)


class RealDemTests(unittest.TestCase):
    @unittest.skipUnless(SOURCE.exists(), "Download the USGS source GeoTIFF to run integration checks")
    def test_source_metadata_and_exported_points(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = preprocess(SOURCE, POINTS, Path(tmp), size=75)
            self.assertEqual(result["grid"]["width"], 75)
            self.assertEqual(result["grid"]["height"], 75)
            self.assertEqual(result["grid"]["pixel_size_m"], [20.0, 20.0])
            self.assertTrue(all(point["has_elevation"] for point in result["checked_points"]))
            heights = np.fromfile(Path(tmp) / "heights.f32", dtype="<f4").reshape(75, 75)
            mask = np.fromfile(Path(tmp) / "mask.u8", dtype="u1").reshape(75, 75)
            self.assertEqual(heights.size, 5625)
            self.assertGreater(mask.sum(), 0)
            self.assertTrue(np.isfinite(heights[mask == 1]).all())
            self.assertEqual(len(result["checked_points"]), 3)
            by_id = {point["id"]: point for point in result["checked_points"]}
            self.assertEqual((by_id["base"]["source_row"], by_id["base"]["source_col"]), (2479, 1169))
            self.assertEqual((by_id["science_target"]["source_row"], by_id["science_target"]["source_col"]), (2464, 1148))
            self.assertAlmostEqual(
                projected_distance_m(
                    rasterio.crs.CRS.from_wkt(result["source_grid"]["crs_wkt"]),
                    (by_id["base"]["projected_x_m"], by_id["base"]["projected_y_m"]),
                    (by_id["science_target"]["projected_x_m"], by_id["science_target"]["projected_y_m"]),
                ),
                523.0702474,
                places=5,
            )
            self.assertTrue((Path(tmp) / "checksums.sha256").is_file())

    def test_subset_rejects_even_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "odd integer"):
                preprocess(SOURCE, POINTS, Path(tmp), size=10)


if __name__ == "__main__":
    unittest.main()
