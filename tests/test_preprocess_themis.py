import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from scripts import preprocess_themis


class ThemisExportTests(unittest.TestCase):
    def test_unusable_grid_is_rejected_before_export(self):
        for right, pixels, message in [
            (210, [[1, 2], [3, 4]], "100 m"),
            (200, [[0, 2], [3, 4]], "complete coverage"),
        ]:
            with self.subTest(right=right), tempfile.TemporaryDirectory() as tmp:
                data = Path(tmp)
                (data / "metadata.json").write_text(json.dumps({
                    "grid": {"bounds_projected_m": [0, 0, right, 200]},
                    "crs_wkt": "test",
                }), encoding="utf-8")
                with patch.object(preprocess_themis, "DATA", data), \
                     patch.object(preprocess_themis.rasterio, "open"), \
                     patch.object(preprocess_themis.rasterio, "band"), \
                     patch.object(preprocess_themis, "reproject",
                                  side_effect=lambda _, dst, **kw: np.copyto(dst, np.array(pixels, dtype=np.uint8))):
                    with self.assertRaisesRegex(ValueError, message):
                        preprocess_themis.main()
                self.assertFalse((data / "themis_day.png").exists())
                self.assertFalse((data / "themis_day.json").exists())
