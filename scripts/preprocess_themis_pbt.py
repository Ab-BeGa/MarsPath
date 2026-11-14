"""Build the Jezero brightness-temperature layer from the PDS IRPBT raster."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject

SOURCE = "https://static.mars.asu.edu/pds/ODTGEO_v2/data/odtip2_0064/i702xxpbt/I70247006PBT.IMG"
PRODUCT = "I70247006PBT"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pds_image", type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/data/jezero"))
    args = parser.parse_args()
    metadata = json.loads((args.output / "themis_day.json").read_text(encoding="utf-8"))
    width, height = metadata["width"], metadata["height"]
    kelvin = np.zeros((height, width), dtype="float32")
    with rasterio.open(args.pds_image) as source:
        label = args.pds_image.open("rb").read(4096).split(b"END_OBJECT = IMAGE\r\n")[0]
        for field in (b'PRODUCT_ID = "' + PRODUCT.encode() + b'"', b'ODY:SAMPLE_UNIT = "KELVIN"',
                      b"NULL_CONSTANT = 0", b"OFFSET = 0.0", b"SCALING_FACTOR = 1.0"):
            if field not in label:
                raise ValueError(f"Unexpected PDS label: missing {field!r}")
        reproject(source.read(1), kelvin, src_transform=source.transform, src_crs=source.crs,
                  src_nodata=0, dst_transform=from_bounds(*metadata["bounds_projected_m"], width, height),
                  dst_crs=metadata["crs_wkt"], dst_nodata=0, resampling=Resampling.nearest)
    if not np.all(np.isfinite(kelvin) & (kelvin > 0)):
        raise ValueError("The observation must cover the whole Jezero study area")
    # Round the displayed product to 0.1 K, and use its same limits for the color ramp.
    temperature = np.rint(kelvin * 10).astype(int)
    low, high = int(temperature.min()), int(temperature.max())
    colors = np.array([[49, 40, 142], [175, 55, 124], [255, 217, 99]])
    channels = [np.interp(temperature, [low, (low + high) / 2, high], colors[:, i]) for i in range(3)]
    Image.fromarray(np.stack(channels, axis=-1).astype("uint8")).save(args.output / "themis_pbt.png")
    metadata.update(source_url=SOURCE, product=PRODUCT, observed_utc="2017-10-15T06:33:41Z",
                    kelvin_tenths=temperature.ravel().tolist(), min_kelvin=low / 10, max_kelvin=high / 10)
    (args.output / "themis_pbt.json").write_text(json.dumps(metadata, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
