"""Extract the official THEMIS day-IR COG on the Jezero DEM bounds."""
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject

DATA = Path(__file__).resolve().parents[1] / "public/data/jezero"
SOURCE = ("https://astrogeo-ard.s3.us-west-2.amazonaws.com/mars/mo/themis/"
          "controlled_mosaics/mc13_syrtis_major_dir/mc13_syrtis_major_dir.tif")


def main():
    dem = json.loads((DATA / "metadata.json").read_text(encoding="utf-8"))
    left, bottom, right, top = bounds = dem["grid"]["bounds_projected_m"]
    width, height = round((right - left) / 100), round((top - bottom) / 100)
    if (width < 1 or height < 1
            or not math.isclose(right - left, 100 * width, rel_tol=0, abs_tol=0.01)
            or not math.isclose(top - bottom, 100 * height, rel_tol=0, abs_tol=0.01)):
        raise ValueError("Jezero DEM bounds must fit a 100 m THEMIS grid")
    transform = from_bounds(*bounds, width, height)
    pixels = np.zeros((height, width), dtype=np.uint8)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open("/vsicurl/" + SOURCE) as source:
            reproject(rasterio.band(source, 1), pixels, dst_transform=transform,
                      dst_crs=dem["crs_wkt"], dst_nodata=0,
                      resampling=Resampling.nearest)
    valid = pixels != 0
    if not valid.all():
        raise ValueError("THEMIS requires complete coverage over the Jezero DEM")
    if np.ptp(pixels) == 0:
        raise ValueError("THEMIS has no usable signal over Jezero")
    Image.fromarray(pixels).save(DATA / "themis_day.png")
    manifest = {
        "source_url": SOURCE, "source_resolution_m": 100,
        "bounds_projected_m": bounds, "crs_wkt": dem["crs_wkt"],
        "width": width, "height": height,
        "coverage_valid_fraction": float(valid.mean()),
    }
    (DATA / "themis_day.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
