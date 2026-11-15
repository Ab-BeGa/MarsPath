"""Extract a real, compact Gale crater DEM from the official USGS MSL mosaic.

No synthetic elevations or color-derived heights are permitted. The source must
be a valid Martian, one-band float DEM in metres. Downsampling uses area-average
of valid source cells; NoData remains explicitly masked. Never relabel output
resolution as native HiRISE 1 m resolution.

Run locally (after downloading the real USGS source):
  python scripts/preprocess_gale_dem.py --source data/MSL_Gale_DEM_Mosaic_1m_v3.tif
Or with GDAL HTTP-range access:
  python scripts/preprocess_gale_dem.py --source /vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.enums import Resampling
from rasterio.windows import Window, bounds

USGS_GALE_DEM = "https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif"
OUTPUT = Path(__file__).resolve().parents[1] / "public" / "data" / "gale"
# The existing NASA PDS landing-site catalogue reports this rounded Curiosity
# landing location (4.59° S, 137.44° E). It is an ROI selection, not a claim
# about the actual landing point at 1 m precision.
ROI_LAT = -4.59
ROI_LON = 137.44
MARS_RADIUS = 3_396_190.0


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(data)
    return h.hexdigest()


def to_xy(params: dict, longitude: float, latitude: float) -> tuple[float, float]:
    lat_ts = math.radians(float(params.get("lat_ts", 0)))
    x0 = float(params.get("x_0", 0))
    y0 = float(params.get("y_0", 0))
    lon0 = float(params.get("lon_0", 0))
    radius = float(params.get("R", 0))
    return (
        x0 + radius * math.cos(lat_ts) * math.radians(longitude - lon0),
        y0 + radius * math.radians(latitude),
    )


def to_degrees(params: dict, x: float, y: float) -> tuple[float, float]:
    radius = float(params["R"])
    lon0 = float(params.get("lon_0", 0))
    lat_ts = math.radians(float(params.get("lat_ts", 0)))
    return (
        lon0 + math.degrees((x - float(params.get("x_0", 0))) / (radius * math.cos(lat_ts))),
        math.degrees((y - float(params.get("y_0", 0))) / radius),
    )


def preprocess(
    source: str | Path,
    output: Path = OUTPUT,
    size: int = 251,
    output_cell_m: float = 20.0,
) -> dict:
    if not isinstance(size, int) or size < 21 or size > 601 or size % 2 == 0:
        raise ValueError("Output size must be odd between 21 and 601 pixels")
    if not math.isfinite(output_cell_m) or not 5 <= output_cell_m <= 100:
        raise ValueError("Output DEM pixel spacing must be 5–100 m")
    with rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
        GDAL_HTTP_MAX_RETRY="2",
        GDAL_HTTP_RETRY_DELAY="2",
    ), rasterio.open(str(source)) as src:
        if src.count != 1 or src.dtypes[0] != "float32":
            raise ValueError(f"USGS Gale DEM must be one-band Float32, not {src.count}/{src.dtypes}")
        if src.crs is None or not src.crs.is_projected:
            raise ValueError("Gale DEM missing a projected Mars CRS")
        proj = src.crs.to_dict()
        radius = float(proj.get("R", 0))
        if proj.get("proj") != "eqc" or not math.isclose(radius, MARS_RADIUS, abs_tol=1):
            raise ValueError("Unexpected CRS: require Mars sphere R=3396190 m and equirectangular projection")
        if not src.crs.is_projected or src.crs.linear_units_factor[1] != 1.0:
            raise ValueError("Gale DEM coordinates must be metres")
        if not math.isclose(src.res[0], src.res[1], abs_tol=1e-5) or src.res[0] <= 0:
            raise ValueError("Unexpected native source pixel size")
        if abs(src.transform.b) > 1e-8 or abs(src.transform.d) > 1e-8:
            raise ValueError("Rotated Gale DEM is unsupported")
        native = src.res[0]
        factor = round(output_cell_m / native)
        if factor < 1 or abs(native * factor - output_cell_m) > 1e-4:
            raise ValueError(f"Native {native} m DEM cannot be integer-averaged to {output_cell_m} m")
        x, y = to_xy(proj, ROI_LON, ROI_LAT)
        col, row = (~src.transform) * (x, y)
        center_c, center_r = math.floor(col), math.floor(row)
        extent = size * factor
        col0 = center_c - extent // 2
        row0 = center_r - extent // 2
        if col0 < 0 or row0 < 0 or col0 + extent > src.width or row0 + extent > src.height:
            raise ValueError("Requested Gale ROI is outside actual DEM coverage")
        window = Window(col0, row0, extent, extent)
        sampled = src.read(1, window=window, out_shape=(size, size),
                           resampling=Resampling.average, masked=True)
        mask = (~np.ma.getmaskarray(sampled)).astype("uint8")
        data = np.ma.filled(sampled, 0).astype("<f4", copy=False)
        mask[~np.isfinite(data)] = 0
        if mask.sum() < size * size * 0.75:
            raise ValueError("Too many NoData cells in Gale ROI (<75% valid); choose a different centre")
        data[mask == 0] = 0.0  # masked values are never interpreted as heights
        out_transform = src.window_transform(window) * Affine.scale(factor, factor)
        bb = bounds(window, src.transform)
        def chosen_point(identifier: str, label: str, dc: int, dr: int, role: str) -> dict:
            cc, rr = size // 2 + dc, size // 2 + dr
            if cc < 0 or rr < 0 or cc >= size or rr >= size or mask[rr, cc] == 0:
                raise ValueError(f"Demo point {identifier} does not fall on valid DEM")
            xx, yy = out_transform * (cc + 0.5, rr + 0.5)
            lon, lat = to_degrees(proj, xx, yy)
            return {
                "id": identifier, "name": label, "role": role,
                "latitude_deg": lat, "longitude_deg": lon,
                "projected_x_m": xx, "projected_y_m": yy,
                "elevation_m": float(data[rr, cc]),
                "source": "synthetic_demo_waypoint_on_real_DEM_not_NASA_landmark",
            }
        # Default A/B are *clearly labelled demo cells*; coordinates derive
        # from the actual source affine and are not claimed to be rover stations.
        check = [
            chosen_point("site_center", "Gale Curiosity landing-area ROI", 0, 0, "roi_center"),
            chosen_point("base", "Gale demo A (model waypoint)", -size // 6, 0, "base"),
            chosen_point("science_target", "Gale demo B (model waypoint)", size // 6, 0, "science_target"),
        ]
        output.mkdir(parents=True, exist_ok=True)
        heights_file, mask_file = output / "heights.f32", output / "mask.u8"
        data.tofile(heights_file)
        mask.tofile(mask_file)
        # Identity of *committed compact data*, NOT a fictional checksum of the
        # multi-gigabyte source GeoTIFF read via HTTP range.
        digest = hashlib.sha256()
        digest.update(heights_file.read_bytes())
        digest.update(mask_file.read_bytes())
        compact_digest = digest.hexdigest()
        values = data[mask == 1]
        meta = {
            "schema_version": 1,
            "region_id": "gale_crater_curiosity_demo",
            "generated_on": date.today().isoformat(),
            "source": {
                "url": USGS_GALE_DEM,
                "product": "Mars MSL Gale Merged DEM Mosaic 1m v3 (downsampled for this app)",
                "mission": "MRO / Mars Express / MGS control net",
                "instrument": "HiRISE, CTX, HRSC, MOLA",
                "publisher": "NASA/JPL-Caltech/USGS Astrogeology",
                "source_file": "MSL_Gale_DEM_Mosaic_1m_v3.tif",
                "source_sha256": compact_digest,
                "hash_scope": "compact_heights_f32_plus_mask_u8_not_original_geotiff",
                "native_source_resolution_m": native,
            },
            "grid": {
                "width": size, "height": size,
                "pixel_size_m": [output_cell_m, output_cell_m],
                "bounds_projected_m": [float(v) for v in bb],
                "transform": list(out_transform)[:6],
                "heights_file": "heights.f32", "mask_file": "mask.u8",
                "elevation_min_m": float(values.min()),
                "elevation_max_m": float(values.max()),
                "valid_cells": int(mask.sum()), "valid_fraction": float(mask.mean()),
                "resampling": "average of valid original 1 m DEM pixels into 20 m cells",
            },
            "coordinate_convention": {
                "latitude": "planetocentric degrees north",
                "longitude": "east-positive degrees",
                "source_crs_sphere_radius_m": radius,
                "projection_standard_parallel_deg": float(proj.get("lat_ts", 0)),
                "projection_central_meridian_deg": float(proj.get("lon_0", 0)),
                "projection_false_easting_m": float(proj.get("x_0", 0)),
                "projection_false_northing_m": float(proj.get("y_0", 0)),
            },
            "crs_wkt": src.crs.to_wkt(),
            "source_grid": {
                "crs_wkt": src.crs.to_wkt(),
                "width": src.width, "height": src.height,
                "pixel_size_m": [float(v) for v in src.res],
                "source_window_col_row": [col0, row0],
                "source_window_size_pixels": extent,
            },
            "checked_points": check,
            "limitations": [
                "This is a 20 m area-averaged subset of original 1 m DEM, NOT a native 20 m CTX scene.",
                "The numeric hash identifies the committed compact DEM, not the full source GeoTIFF.",
                "HiRISE/CTX/HRSC source quality varies by location; absolute positioning is limited by MOLA control net.",
                "Model waypoints A and B are not historical Curiosity traverse locations.",
                "20 m cells cannot detect small rocks or certify EVA safety.",
            ],
        }
        (output / "metadata.json").write_text(
            json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        with (output / "checksums.sha256").open("w", encoding="ascii") as out:
            for p in (heights_file, mask_file, output / "metadata.json"):
                out.write(f"{file_sha256(p)}  {p.name}\n")
        return meta


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", default=f"/vsicurl/{USGS_GALE_DEM}",
                   help="Real USGS Gale GeoTIFF local path or /vsicurl/URL")
    p.add_argument("--output", type=Path, default=OUTPUT)
    p.add_argument("--size", type=int, default=251)
    p.add_argument("--spacing", type=float, default=20.0)
    args = p.parse_args()
    result = preprocess(args.source, args.output, args.size, args.spacing)
    print(json.dumps({
        "source": result["source"]["url"],
        "grid": result["grid"],
        "checked_points": result["checked_points"],
        "output": str(args.output),
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
