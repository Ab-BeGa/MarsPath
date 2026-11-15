"""Prepare static regional raster cutouts in planetocentric Mars coordinates."""
import argparse
from zipfile import ZipFile
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
import math
from pathlib import Path
from urllib.request import urlopen

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject

ROOT = Path(__file__).resolve().parents[1] / "public/data/mars-global"
MOLA = "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm"
CTX = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer/tile"
THEMIS = "https://astrogeo-ard.s3.us-west-2.amazonaws.com/mars/mo/themis/controlled_mosaics"
MARS = "+proj=longlat +R=3396190 +no_defs"
# Longitude span; controlled THEMIS quadrangles intersecting the study window.
WINDOWS = {
    "hecates-tholus": (2, ("mc07_cebrenia", "mc15_elysium")),
    "olympus-mons": (6, ("mc08_amazonis", "mc09_tharsis")),
    "arsia-mons": (5, ("mc17_phoenicis_lacus",)),
    "alba-patera": (8, ("mc03_arcadia", "mc02_diacria")),
    "gale-crater": (4, ("mc23_aeolis", "mc22_mare_tyrrhenum")),
    "utopia-planitia": (5, ("mc06_casius", "mc07_cebrenia")),
    "elysium-planitia": (2, ("mc15_elysium", "mc14_amenthes")),
    "cerberus-fossae": (5, ("mc15_elysium",)),
    "oxia-planum": (4, ("mc11_oxia_palus",)),
    "syrtis-major": (5, ("mc13_syrtis_major",)),
}


def tile_crop(bounds, base, level, columns, tile_size, suffix):
    west, south, east, north = bounds
    ppd = columns * tile_size / 360
    left, right = (west + 180) * ppd, (east + 180) * ppd
    top, bottom = (90 - north) * ppd, (90 - south) * ppd
    x0, y0 = math.floor(left / tile_size), math.floor(top / tile_size)
    x1, y1 = math.ceil(right / tile_size), math.ceil(bottom / tile_size)
    result = Image.new("RGB", ((x1-x0)*tile_size, (y1-y0)*tile_size))
    for row in range(y0, y1):
        for col in range(x0, x1):
            with urlopen(f"{base}/{level}/{row}/{col % columns}{suffix}", timeout=18) as response:
                tile = Image.open(BytesIO(response.read()))
                if tile.size != (tile_size, tile_size):
                    raise ValueError("Invalid tile dimensions")
                result.paste(tile, ((col-x0)*tile_size, (row-y0)*tile_size))
    return result.transform((768, 768), Image.Transform.EXTENT,
                            (left-x0*tile_size, top-y0*tile_size, right-x0*tile_size, bottom-y0*tile_size),
                            Image.Resampling.BILINEAR)


def window_bounds(region):
    name = region["id"]
    span, quadrangles = WINDOWS[name]
    lon = (region["longitude_east_deg"] + 180) % 360 - 180
    lat = region["latitude_deg"]
    half_lat = span / 2 * math.cos(math.radians(lat))
    return (lon-span/2, lat-half_lat, lon+span/2, lat+half_lat)


def prepare(region):
    name = region["id"]
    span, quadrangles = WINDOWS[name]
    bounds = window_bounds(region)
    output = ROOT / "regions" / name
    output.mkdir(parents=True, exist_ok=True)
    available = {}
    ctx_level = round(math.log2(768 * 360 / (1024 * span)))
    for layer, base, level, columns, tile_size, suffix in (
        ("mola", MOLA, 7, 256, 256, ".jpg"),
        ("ctx", CTX, ctx_level, 2 * 2**ctx_level, 512, ""),
    ):
        try:
            tile_crop(bounds, base, level, columns, tile_size, suffix).save(output / f"{layer}.webp", quality=85)
            available[layer] = True
        except (OSError, ValueError) as error:
            print(name, layer, error, flush=True)
    pixels = np.full((768, 768), np.nan, dtype=np.float32)
    for quadrant in quadrangles:
        product = f"{quadrant}_dir"
        url = f"{THEMIS}/{product}/{product}.tif"
        try:
            with rasterio.open("/vsicurl/" + url) as source:
                tile = np.full_like(pixels, np.nan)
                reproject(rasterio.band(source, 1), tile, dst_transform=from_bounds(*bounds, 768, 768),
                          dst_crs=MARS, dst_nodata=np.nan, resampling=Resampling.bilinear)
                np.copyto(pixels, tile, where=np.isfinite(tile) & ~np.isfinite(pixels))
        except (OSError, ValueError) as error:
            print(name, quadrant, error, flush=True)
    valid = np.isfinite(pixels)
    if valid.any():
        rgba = np.zeros((*pixels.shape, 4), dtype=np.uint8)
        rgba[valid, :3] = np.clip(pixels[valid], 0, 255).astype(np.uint8)[:, None]
        rgba[valid, 3] = 255
        Image.fromarray(rgba).save(output / "themis.webp", quality=85)
        available["themis"] = round(float(valid.mean()) * 100, 1)
    print(name, available, flush=True)
    return name, {"bounds": bounds, "layers": available}


def validate_existing_window(existing, bounds):
    if ("temperature" in existing or "crism" in existing.get("layers", {})) and tuple(existing["bounds"]) != bounds:
        raise ValueError("Regional bounds changed. Regenerate the base and science products together in a clean output directory.")


def merge_base_layers(existing, generated):
    return {**existing, **generated, "layers": {**existing.get("layers", {}), **generated["layers"]}}


def center(mask):
    rows, cols = np.nonzero(mask)
    if rows.size == 0:
        raise ValueError("The observation has no covered pixels")
    row_mid = (rows.min() + rows.max()) / 2
    col_mid = (cols.min() + cols.max()) / 2
    nearest = np.argmin((rows - row_mid) ** 2 + (cols - col_mid) ** 2)
    return [(int(cols[nearest]) + 0.5) / mask.shape[1], (int(rows[nearest]) + 0.5) / mask.shape[0]]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--oxia-crism", type=Path, required=True,
                        help="Dataset_TorresAure_Clays-OP-MV.zip from Zenodo 17422985")
    args = parser.parse_args()
    catalog = json.loads((ROOT / "detailed_regions.json").read_text(encoding="utf-8"))
    regions = [region for region in catalog["regions"] if region["id"] in WINDOWS]
    path = ROOT / "regional_maps.json"
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for region in regions:
        validate_existing_window(existing.get(region["id"], {}), window_bounds(region))
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="15"):
        with ThreadPoolExecutor(max_workers=8) as pool:
            manifests = dict(pool.map(prepare, regions))
    manifests = {name: merge_base_layers(existing.get(name, {}), data) for name, data in manifests.items()}
    add_oxia_crism(args.oxia_crism, manifests["oxia-planum"])
    pending = path.with_suffix(".json.tmp")
    pending.write_text(json.dumps(manifests, indent=2) + "\n", encoding="utf-8")
    pending.replace(path)


def add_oxia_crism(archive, manifest):
    entry = "Dataset_TorresAure_Clays-OP-MV/maps/CRISM/FRT00008438_type1-type2_map.tif"
    raster = np.zeros((4, 768, 768), dtype=np.uint8)
    with ZipFile(archive) as bundle, rasterio.MemoryFile(bundle.read(entry)) as file, file.open() as source:
        reproject(source.read(), raster, src_transform=source.transform, src_crs=source.crs,
                  dst_transform=from_bounds(*manifest["bounds"], 768, 768), dst_crs=MARS,
                  resampling=Resampling.nearest)
    if not raster[3].any():
        raise ValueError("The Oxia CRISM observation does not intersect the regional window")
    Image.fromarray(np.moveaxis(raster, 0, -1)).save(ROOT / "regions/oxia-planum/crism.webp", lossless=True)
    manifest["layers"]["crism"] = round(float((raster[3] > 0).mean()) * 100, 2)
    manifest["crism_center"] = center(raster[3] > 0)


if __name__ == "__main__":
    main()
