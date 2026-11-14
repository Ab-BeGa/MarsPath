"""Prepare a *real* georeferenced USGS CTX orthomosaic for the Jezero web map.

The CTX GeoTIFF is a separately published USGS optical observation. The
output is a 5 m/pixel PNG reprojected into the exact Mars DEM study ROI.
Never attempt to georegister a browse JPG by eyeballing positions.
"""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request

import numpy as np
from PIL import Image
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT

ROOT = Path(__file__).resolve().parents[1]
CTX_SOURCE_URL = (
    "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/"
    "ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.tif"
)
MIRROR_SOURCE_URL = (
    "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/CTX/"
    "ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.tif"
)
SOURCE_FILENAME = "M20_JezeroCrater_CTXortho_mosaic_5m.tif"
DEFAULT_SOURCE = ROOT / "data" / SOURCE_FILENAME
DEFAULT_METADATA = ROOT / "public" / "data" / "jezero" / "metadata.json"
DEFAULT_OUTPUT = ROOT / "public" / "data" / "jezero"


def sha256(path: Path) -> str:
    hash_ = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            hash_.update(chunk)
    return hash_.hexdigest()


def download_geo_tiff(target: Path) -> None:
    """Download into a partial file and atomically rename only on success."""
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    try:
        last_error = None
        for url in (CTX_SOURCE_URL, MIRROR_SOURCE_URL):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "JezeroTraverse-CTX/1.0"})
                with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as stream:
                    if getattr(response, "status", 200) != 200:
                        raise RuntimeError(f"Unexpected USGS response {response.status}")
                    shutil.copyfileobj(response, stream, length=1024 * 1024)
                if partial.stat().st_size < 4096:
                    raise RuntimeError("Downloaded data is not a valid-size GeoTIFF")
                partial.replace(target)
                return
            except Exception as exc:
                last_error = exc
                partial.unlink(missing_ok=True)
        raise RuntimeError(f"Unable to download the official USGS CTX GeoTIFF: {last_error}")
    finally:
        partial.unlink(missing_ok=True)


def _mars_crs(crs: CRS | None, *, label: str) -> CRS:
    if crs is None or not crs.is_projected:
        raise ValueError(f"{label}: projected Mars CRS is required")
    params = crs.to_dict()
    wkt = crs.to_wkt()
    if params.get("proj") != "eqc" or "Mars" not in wkt:
        raise ValueError(f"{label}: expected the Mars 2000 spherical equirectangular CRS")
    radius = float(params.get("R", 0))
    if radius < 3_000_000 or radius > 4_000_000:
        raise ValueError(f"{label}: Mars spherical radius is missing/invalid")
    return crs


def generate_ctx_tile(
    source: Path,
    dem_metadata: Path,
    output_dir: Path,
    *,
    resolution_m: float = 5.0,
) -> dict:
    """Warp the USGS CTX optical image to the DEM's exact projected bounds.

    The original 20 m DEM is not resampled or modified. CTX is sampled at
    5 m per pixel in the DEM CRS, with the same outer study region bounds.
    """
    if not np.isfinite(resolution_m) or resolution_m <= 0:
        raise ValueError("Resolution must be a positive finite number of metres")
    meta = json.loads(dem_metadata.read_text(encoding="utf-8"))
    grid = meta["grid"]
    bounds = np.asarray(grid["bounds_projected_m"], dtype=np.float64)
    if bounds.shape != (4,) or not np.isfinite(bounds).all():
        raise ValueError("DEM bounds missing or invalid")
    left, bottom, right, top = bounds
    if not (left < right and bottom < top):
        raise ValueError("Invalid DEM study area")
    dem_crs = _mars_crs(CRS.from_wkt(meta["crs_wkt"]), label="DEM")
    transform = np.asarray(grid["transform"], dtype=float)
    if transform.shape != (6,) or not np.isfinite(transform).all():
        raise ValueError("Invalid DEM transform")
    if abs(transform[2] - left) > 0.001 or abs(transform[5] - top) > 0.001:
        raise ValueError("DEM projected bounds do not match its affine transform")
    width_f = (right - left) / resolution_m
    height_f = (top - bottom) / resolution_m
    width, height = int(round(width_f)), int(round(height_f))
    if (abs(width_f - width) > 1e-5 or abs(height_f - height) > 1e-5
            or width < 2 or height < 2 or width * height > 12_000_000):
        raise ValueError("CTX resolution must exactly divide the DEM ROI; tile too large")
    target_transform = from_origin(left, top, resolution_m, resolution_m)
    with rasterio.open(source) as ds:
        _mars_crs(ds.crs, label="CTX")
        if ds.count < 1:
            raise ValueError("USGS CTX image has no bands")
        # Reject implausibly mismatched Mars models rather than warping an Earth raster.
        dem_r = float(dem_crs.to_dict()["R"])
        ctx_r = float(ds.crs.to_dict()["R"])
        if abs(dem_r - ctx_r) > 100:
            raise ValueError("DEM and CTX use incompatible Mars spherical radii")
        with WarpedVRT(
            ds, crs=dem_crs, transform=target_transform, width=width, height=height,
            dtype="float32", nodata=np.nan, resampling=Resampling.bilinear,
        ) as vrt:
            tile = vrt.read(1, masked=True)
        pixels = np.asarray(np.ma.filled(tile, np.nan), dtype=np.float32)
        valid = (~np.ma.getmaskarray(tile)) & np.isfinite(pixels)
        coverage = float(np.mean(valid))
        if coverage < 0.9:
            raise ValueError(
                f"Official CTX orthomosaic does not sufficiently cover the study site: "
                f"{coverage:.1%} valid. Verify GeoTIFF source and CRS."
            )
        values = pixels[valid]
        low, high = [float(v) for v in np.percentile(values, [2, 98])]
        if not low < high:
            raise ValueError("CTX orthomosaic ROI has no usable optical contrast")
        intensity = np.zeros((height, width), dtype=np.uint8)
        intensity[valid] = np.uint8(
            np.clip((pixels[valid] - low) / (high - low) * 230 + 15, 0, 255)
        )
        rgba = np.zeros((height, width, 4), dtype=np.uint8)
        rgba[:, :, :3] = intensity[:, :, None]
        rgba[:, :, 3] = np.where(valid, 255, 0).astype(np.uint8)
        src_crs_wkt = ds.crs.to_wkt()
        src_transform = list(ds.transform)[:6]
        src_resolution = list(ds.res)
    output_dir.mkdir(parents=True, exist_ok=True)
    image_path = output_dir / "ctx_ortho.png"
    Image.fromarray(rgba, mode="RGBA").save(image_path, optimize=True)
    result = {
        "schema_version": 1,
        "kind": "real_ctx_orthomosaic",
        "region_id": meta["region_id"],
        "source": {
            "product": "Mars 2020 Science Investigation CTX Orthomosaic (5 m/pixel)",
            "publisher": "USGS Astrogeology Science Center",
            "mission": "Mars Reconnaissance Orbiter",
            "instrument": "Context Camera (CTX)",
            "url": CTX_SOURCE_URL,
            "source_file": source.name,
            "source_sha256": sha256(source),
            "source_crs_wkt": src_crs_wkt,
            "source_transform": src_transform,
            "source_resolution_m": src_resolution,
        },
        "alignment": {
            "target_dem_sha256": meta["source"]["source_sha256"],
            "target_dem_crs_wkt": meta["crs_wkt"],
            "bounds_projected_m": bounds.tolist(),
            "transform": list(target_transform)[:6],
            "width": width,
            "height": height,
            "resolution_m": resolution_m,
            "warp_method": "rasterio.WarpedVRT bilinear resampling into DEM Mars CRS",
            "coverage_valid_fraction": coverage,
        },
        "display": {
            "image_file": image_path.name,
            "image_sha256": sha256(image_path),
            "stretch_percentiles": [2, 98],
            "stretch_input_range": [low, high],
            "nodata_transparency": True,
            "rendering": "grayscale optical intensities, not measured height or color imagery",
        },
        "created_on": date.today().isoformat(),
    }
    (output_dir / "ctx_ortho.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE,
                        help="Official CTX orthomosaic GeoTIFF path")
    parser.add_argument("--metadata", type=Path, default=DEFAULT_METADATA,
                        help="Existing real Mars CTX DEM metadata.json")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help="Destination public/data/jezero")
    parser.add_argument("--resolution", type=float, default=5.0,
                        help="Optical output resolution in metres per pixel (default: 5)")
    parser.add_argument("--download", action="store_true",
                        help="Download the official USGS CTX source if missing (large file)")
    args = parser.parse_args()
    if not args.source.is_file():
        if not args.download:
            parser.error(f"CTX GeoTIFF not found at {args.source}. Supply --source or use --download.")
        print("Downloading official USGS CTX optical GeoTIFF. This may be a large transfer.")
        download_geo_tiff(args.source)
    result = generate_ctx_tile(args.source, args.metadata, args.output, resolution_m=args.resolution)
    print(json.dumps({
        "image": str(args.output / "ctx_ortho.png"),
        "metadata": str(args.output / "ctx_ortho.json"),
        "coverage": result["alignment"]["coverage_valid_fraction"],
        "source_sha256": result["source"]["source_sha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
