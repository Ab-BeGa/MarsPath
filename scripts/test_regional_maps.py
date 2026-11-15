"""Regression tests for regional raster artifacts and manifest regeneration."""
import json
from pathlib import Path
import unittest

import numpy as np
from PIL import Image

from preprocess_regional_maps import (
    ROOT, center, merge_base_layers, validate_existing_window, window_bounds,
)
from preprocess_regional_observations import mask_white_border


class RegionalMapsTest(unittest.TestCase):
    def test_gale_padding_mask_preserves_interior_white_pixel(self):
        image = np.full((4, 5, 5), 255, dtype=np.uint8)
        image[:3, 1:4, 1:4] = 80
        image[:3, 2, 2] = 255
        mask_white_border(image)
        self.assertEqual(np.count_nonzero(image[3]), 9)
        self.assertEqual(image[3, 2, 2], 255)

    def test_base_refresh_preserves_science_layers(self):
        bounds = (1, 2, 3, 4)
        existing = {
            "bounds": list(bounds), "layers": {"mola": True, "crism": 0.04},
            "crism_center": [0.3, 0.8], "crism_hyd": {"product": "test"},
            "temperature": {"product": "test"},
        }
        validate_existing_window(existing, bounds)
        generated = {"bounds": bounds, "layers": {"mola": True, "themis": 95.0}}
        merged = merge_base_layers(existing, generated)
        self.assertEqual(merged["temperature"], existing["temperature"])
        self.assertEqual(merged["crism_center"], existing["crism_center"])
        self.assertEqual(merged["crism_hyd"], existing["crism_hyd"])
        self.assertEqual(merged["layers"], {"mola": True, "crism": 0.04, "themis": 95.0})
        with self.assertRaises(ValueError):
            validate_existing_window(existing, (2, 3, 4, 5))

    def test_sparse_coverage_marker_lands_on_a_pixel(self):
        mask = np.eye(4, dtype=bool)[:, ::-1]
        x, y = center(mask)
        self.assertTrue(mask[int(y * 4), int(x * 4)])

    def test_all_regional_assets_match_manifest(self):
        catalog = json.loads((ROOT / "detailed_regions.json").read_text(encoding="utf-8"))
        regions = {r["id"]: r for r in catalog["regions"] if r["detail_status"] == "report"}
        maps = json.loads((ROOT / "regional_maps.json").read_text(encoding="utf-8"))
        self.assertEqual(len(maps), 10)
        self.assertEqual(set(maps), set(regions))
        for name, entry in maps.items():
            with self.subTest(region=name):
                self.assertEqual(tuple(entry["bounds"]), window_bounds(regions[name]))
                directory = ROOT / "regions" / name
                self.assertEqual(set(entry["layers"]), {"mola", "ctx", "themis", "crism"})
                for layer in entry["layers"]:
                    with Image.open(directory / f"{layer}.webp") as image:
                        self.assertEqual(image.size, (768, 768))
                        if layer != "crism":
                            continue
                        mask = np.asarray(image.convert("RGBA"))[..., 3] > 0
                        x, y = entry["crism_center"]
                        self.assertTrue(0 <= x < 1 and 0 <= y < 1)
                        self.assertTrue(mask[int(y * 768), int(x * 768)])
                        self.assertAlmostEqual(mask.mean() * 100, entry["layers"]["crism"], delta=0.01)
                metadata = entry["temperature"]
                size = metadata["size"]
                values = np.fromfile(directory / "temperature.u16", dtype="<u2").reshape(size, size)
                valid = values > 0
                x, y = metadata["center"]
                self.assertTrue(0 <= x < 1 and 0 <= y < 1)
                self.assertTrue(valid[int(y * size), int(x * size)])
                self.assertAlmostEqual(valid.mean() * 100, metadata["coverage"], delta=0.01)
                self.assertEqual(values[valid].min() / 10, metadata["min"])
                self.assertEqual(values[valid].max() / 10, metadata["max"])
                with Image.open(directory / "temperature.webp") as image:
                    self.assertEqual(image.size, (size, size))
                    np.testing.assert_array_equal(np.asarray(image.convert("RGBA"))[..., 3] > 0, valid)


if __name__ == "__main__":
    unittest.main()
