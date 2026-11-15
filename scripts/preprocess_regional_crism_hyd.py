"""Align official CRISM HYD browse products to regional CTX map windows."""
import argparse
import json
from pathlib import Path
import re

import numpy as np
from PIL import Image
from rasterio.transform import from_bounds, from_origin
from rasterio.warp import reproject, Resampling

from preprocess_regional_maps import MARS, ROOT, center

SIZE = 768


def project_rgba(path, crs, transform, bounds):
    image = np.asarray(Image.open(path).convert("RGBA"))
    output = np.zeros((4, SIZE, SIZE), dtype=np.uint8)
    reproject(np.moveaxis(image, -1, 0), output, src_transform=transform, src_crs=crs,
              dst_transform=from_bounds(*bounds, SIZE, SIZE), dst_crs=MARS, resampling=Resampling.nearest)
    return np.moveaxis(output, 0, -1)


def targeted(path, bounds):
    header = path.with_suffix(".hdr").read_text()
    crs = re.search(r"coordinate system string\s*=\s*\{([^}]+)\}", header, re.I)[1]
    info = re.search(r"map info\s*=\s*\{([^}]+)\}", header, re.I)[1].split(",")
    px, py, x, y, dx, dy = map(float, info[1:7])
    transform = from_origin(x - (px - 1) * dx, y + (py - 1) * dy, dx, dy)
    return project_rgba(path, crs, transform, bounds), max(dx, dy)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path)
    args = parser.parse_args()
    path = ROOT / "regional_maps.json"
    maps = json.loads(path.read_text())
    for region, info in maps.items():
        if region in ("gale-crater", "oxia-planum"):
            continue
        candidates = []
        for file in args.sources.glob(f"{region}-*_brhydj_*.png"):
            if not file.with_suffix(".hdr").exists():
                continue
            rgba, resolution = targeted(file, info["bounds"])
            pixels = int(np.count_nonzero(rgba[..., 3]))
            if pixels:
                product = file.stem.removeprefix(region + "-")
                candidates.append((pixels, product, resolution, rgba))
        if region == "elysium-planitia":
            mosaic = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
            step = 360 / 128
            for x in (111, 112):
                tile = args.sources / f"elysium-mrdr-{x}.png"
                if not tile.exists():
                    continue
                layer = project_rgba(tile, MARS, from_bounds(-180+x*step, 90-31*step,
                                     -180+(x+1)*step, 90-30*step, 512, 512), info["bounds"])
                valid = layer[..., 3] != 0
                mosaic[valid] = layer[valid]
            pixels = int(np.count_nonzero(mosaic[..., 3]))
            if pixels:
                candidates.append((pixels, "MRDR HYD · Mars QuickMap", None, mosaic))
        if not candidates:
            print(region, "no pixels")
            continue
        pixels, product, resolution, rgba = max(candidates, key=lambda item: item[0])
        Image.fromarray(rgba).save(ROOT / "regions" / region / "crism.webp", lossless=True)
        info["layers"]["crism"] = round(pixels * 100 / SIZE**2, 3)
        info["crism_center"] = center(rgba[..., 3] > 0)
        if resolution is None:
            url = "https://mars.quickmap.io/"
        else:
            query = args.sources.parent / f"{region}-crism-query.json"
            products = json.loads(query.read_text(encoding="utf-8"))["ODEResults"]["Products"]["Product"]
            url = next(asset["URL"] for record in products for asset in record["Product_files"]["Product_file"]
                       if asset["FileName"].lower() == product + ".png")
        info["crism_hyd"] = {"product": product, "resolution": resolution, "url": url}
        print(region, product, info["layers"]["crism"], resolution)
    path.write_text(json.dumps(maps, indent=2) + "\n")


if __name__ == "__main__":
    main()
