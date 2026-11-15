"""Prepare calibrated THEMIS observations and the Gale CRISM map for regional windows."""
import argparse
from collections import deque
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject

from preprocess_regional_maps import MARS, ROOT, center


def add_temperature(manifest, directory, source, url):
    with source.open("rb") as stream:
        header = stream.read(8192).decode("ascii", errors="ignore")

    def field(name):
        match = re.search(rf"^\s*{name}\s*=\s*([^\r\n]+)", header, re.M)
        if not match:
            raise ValueError(f"Missing PDS label field: {name}")
        return match[1].strip().strip('"')

    if field("ODY:SAMPLE_UNIT") != "KELVIN":
        raise ValueError("Expected calibrated brightness temperatures in Kelvin")
    size = 384
    kelvin = np.full((size, size), np.nan, dtype=np.float32)
    with rasterio.open(source) as dataset:
        pixels = dataset.read(1)
        valid = (pixels != float(field("NULL_CONSTANT"))) & (pixels != dataset.nodata)
        calibrated = np.where(valid, pixels * float(field("SCALING_FACTOR")) + float(field("OFFSET")), np.nan)
        reproject(calibrated, kelvin, src_transform=dataset.transform, src_crs=dataset.crs,
                  src_nodata=np.nan, dst_transform=from_bounds(*manifest["bounds"], size, size),
                  dst_crs=MARS, dst_nodata=np.nan, resampling=Resampling.nearest)
    valid = np.isfinite(kelvin) & (kelvin > 0) & (kelvin <= 400)
    if not valid.any():
        raise ValueError("The observation has no calibrated samples in the regional window")
    tenths = np.zeros(kelvin.shape, dtype="<u2")
    tenths[valid] = np.rint(kelvin[valid] * 10).astype("<u2")
    low, high = int(tenths[valid].min()), int(tenths[valid].max())
    if low >= high:
        raise ValueError("The observation has no temperature variation in this window")
    rgba = np.zeros((*kelvin.shape, 4), dtype=np.uint8)
    colors = ((49, 40, 142), (175, 55, 124), (255, 217, 99))
    for index, channel in enumerate(zip(*colors)):
        rgba[valid, index] = np.interp(tenths[valid], [low, (low + high) / 2, high], channel)
    rgba[valid, 3] = 255
    Image.fromarray(rgba).save(directory / "temperature.webp", lossless=True)
    tenths.tofile(directory / "temperature.u16")
    manifest["temperature"] = {
        "product": field("PRODUCT_ID"), "date": field("START_TIME") + "Z", "band": int(field("BAND_NUMBER")),
        "url": url, "min": low / 10, "max": high / 10, "coverage": round(float(valid.mean()) * 100, 2),
        "size": size, "center": center(valid),
    }


def mask_white_border(rgba):
    """Remove pure white padding connected to the outer NoData boundary."""
    valid = rgba[3] > 0
    white = valid & np.all(rgba[:3] == 255, axis=0)
    outside = np.pad(~valid, 1, constant_values=True)
    adjacent = outside[:-2, 1:-1] | outside[2:, 1:-1] | outside[1:-1, :-2] | outside[1:-1, 2:]
    boundary = white & adjacent
    pending = deque(zip(*np.nonzero(boundary)))
    height, width = valid.shape
    while pending:
        y, x = pending.popleft()
        for row, col in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= row < height and 0 <= col < width and white[row, col] and not boundary[row, col]:
                boundary[row, col] = True
                pending.append((row, col))
    rgba[3, boundary] = 0


def add_gale_crism(manifest, directory, source):
    rgba = np.zeros((4, 768, 768), dtype=np.uint8)
    with rasterio.open(source) as dataset:
        pixels = dataset.read()
        mask_white_border(pixels)
        reproject(pixels, rgba, src_transform=dataset.transform, src_crs=dataset.crs,
                  dst_transform=from_bounds(*manifest["bounds"], 768, 768), dst_crs=MARS,
                  resampling=Resampling.nearest)
    valid = rgba[3] > 0
    if not valid.any():
        raise ValueError("The Gale CRISM map does not intersect this window")
    Image.fromarray(np.moveaxis(rgba, 0, -1)).save(directory / "crism.webp", lossless=True)
    manifest["layers"]["crism"] = round(float(valid.mean()) * 100, 2)
    manifest["crism_center"] = center(valid)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gale-crism", type=Path, required=True)
    parser.add_argument("--temperature", nargs=3, action="append", metavar=("REGION", "PDS_FILE", "SOURCE_URL"), required=True)
    args = parser.parse_args()
    path = ROOT / "regional_maps.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    add_gale_crism(data["gale-crater"], ROOT / "regions/gale-crater", args.gale_crism)
    for region, source, url in args.temperature:
        add_temperature(data[region], ROOT / "regions" / region, Path(source), url)
    for region in ("gale-crater", "oxia-planum"):
        alpha = np.asarray(Image.open(ROOT / "regions" / region / "crism.webp").convert("RGBA"))[..., 3]
        data[region]["crism_center"] = center(alpha > 0)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
