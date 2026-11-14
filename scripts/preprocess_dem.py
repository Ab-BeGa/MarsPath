"""Validate the USGS Jezero CTX DEM and export a compact, native-grid subset."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from affine import Affine
from rasterio.windows import Window


SOURCE_URL = (
    "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/"
    "ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif"
)
DEFAULT_SOURCE = Path(__file__).resolve().parents[1] / "data" / "M20_JezeroCrater_CTXDEM_20m.tif"
DEFAULT_POINTS = Path(__file__).resolve().parents[1] / "points" / "jezero_points.csv"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "public" / "data" / "jezero"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_source(destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "MarsPath-DEM-ETL/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as output:
        if response.status != 200:
            raise RuntimeError(f"USGS download returned HTTP {response.status}")
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def read_points(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    if not rows:
        raise ValueError(f"No points found in {path}")
    points: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        identifier = row["id"].strip()
        if not identifier or identifier in seen:
            raise ValueError(f"Point ids must be nonempty and unique: {identifier!r}")
        seen.add(identifier)
        lat, lon = float(row["latitude_deg"]), float(row["longitude_deg"])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError(f"Coordinates out of range for {identifier}")
        points.append({
            "id": identifier,
            "name": row.get("name", "").strip(),
            "role": row.get("role", "").strip(),
            "latitude_deg": lat,
            "longitude_deg": lon,
        })
    return points


def mars_lonlat_to_projected(crs: rasterio.crs.CRS, longitude_deg: float, latitude_deg: float) -> tuple[float, float]:
    """Project east-positive, planetocentric Mars coordinates using the raster CRS."""
    if not crs.is_projected:
        raise ValueError("Input raster CRS must be projected")
    params = crs.to_dict()
    wkt = crs.to_wkt()
    if params.get("proj") != "eqc" or "Mars_2000" not in wkt:
        raise ValueError("Expected the Mars 2000 spherical equirectangular CRS in the GeoTIFF")
    radius = float(params.get("R", 0))
    if radius <= 0:
        raise ValueError("Mars sphere radius is missing from the CRS")
    lat_ts = math.radians(float(params.get("lat_ts", 0)))
    lon_0 = float(params.get("lon_0", 0))
    x_0, y_0 = float(params.get("x_0", 0)), float(params.get("y_0", 0))
    lon_delta = math.radians(longitude_deg - lon_0)
    lat = math.radians(latitude_deg)
    return x_0 + radius * math.cos(lat_ts) * lon_delta, y_0 + radius * lat


def projected_distance_m(crs: rasterio.crs.CRS, start_xy: tuple[float, float], end_xy: tuple[float, float]) -> float:
    """Return planar distance in metres for coordinates in the Mars DEM CRS."""
    if not crs.is_projected:
        raise ValueError("Distance requires projected Mars coordinates")
    params = crs.to_dict()
    if params.get("proj") != "eqc" or "Mars_2000" not in crs.to_wkt():
        raise ValueError("Distance requires the Mars 2000 equirectangular CRS")
    _, meters_per_unit = crs.linear_units_factor
    dx = (end_xy[0] - start_xy[0]) * meters_per_unit
    dy = (end_xy[1] - start_xy[1]) * meters_per_unit
    return math.hypot(dx, dy)


def _validate_source(ds: rasterio.io.DatasetReader) -> dict[str, Any]:
    if ds.count != 1 or ds.dtypes[0] != "float32":
        raise ValueError(f"Expected a one-band Float32 DEM, got count={ds.count}, dtype={ds.dtypes}")
    if ds.crs is None or not ds.crs.is_projected:
        raise ValueError("DEM has no projected CRS")
    params = ds.crs.to_dict()
    if params.get("proj") != "eqc" or "Mars_2000" not in ds.crs.to_wkt():
        raise ValueError("DEM CRS is not the expected Mars 2000 equirectangular CRS")
    unit_name, unit_factor = ds.crs.linear_units_factor
    if unit_name.lower() != "metre" or not math.isclose(unit_factor, 1.0):
        raise ValueError(f"Projected coordinates must be metres, got {unit_name} ({unit_factor})")
    if ds.nodata is None:
        raise ValueError("GeoTIFF does not declare NoData; refusing to infer it")
    if not np.allclose(ds.res, (20.0, 20.0), rtol=0, atol=1e-6):
        raise ValueError(f"Expected native 20 m cells, got {ds.res}")
    if ds.transform.b != 0 or ds.transform.d != 0:
        raise ValueError("Rotated rasters are not supported by this compact-grid contract")
    return {
        "crs_wkt": ds.crs.to_wkt(),
        "crs_proj_params": params,
        "horizontal_units": unit_name,
        "pixel_size_m": [float(v) for v in ds.res],
        "width": ds.width,
        "height": ds.height,
        "bounds_projected_m": [ds.bounds.left, ds.bounds.bottom, ds.bounds.right, ds.bounds.top],
        "transform": list(ds.transform)[:6],
        "dtype": ds.dtypes[0],
        "nodata": float(ds.nodata),
    }


def _point_result(ds: rasterio.io.DatasetReader, point: dict[str, Any]) -> dict[str, Any]:
    x, y = mars_lonlat_to_projected(ds.crs, point["longitude_deg"], point["latitude_deg"])
    col_f, row_f = (~ds.transform) @ (x, y)
    col, row = math.floor(col_f), math.floor(row_f)
    inside = 0 <= row < ds.height and 0 <= col < ds.width
    result = {**point, "projected_x_m": x, "projected_y_m": y, "source_row": row, "source_col": col,
              "inside_source_bounds": inside, "has_elevation": False, "elevation_m": None}
    if inside:
        sample = next(ds.sample([(x, y)], indexes=1, masked=True))[0]
        if not np.ma.is_masked(sample) and np.isfinite(float(sample)):
            result["has_elevation"] = True
            result["elevation_m"] = float(sample)
    if not result["has_elevation"]:
        raise ValueError(f"Point {point['id']} is outside raster coverage or has NoData")
    return result


def preprocess(source: Path, points_path: Path, output_dir: Path, size: int = 75) -> dict[str, Any]:
    if size < 3 or size % 2 == 0:
        raise ValueError("Subset size must be an odd integer of at least 3 cells")
    points = read_points(points_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    with rasterio.open(source) as ds:
        source_meta = _validate_source(ds)
        point_results = [_point_result(ds, point) for point in points]
        centers = [point for point in point_results if point["role"] == "roi_center"]
        if len(centers) != 1:
            raise ValueError("Points file must contain exactly one roi_center point")
        center = centers[0]
        offset = size // 2
        col0, row0 = center["source_col"] - offset, center["source_row"] - offset
        if col0 < 0 or row0 < 0 or col0 + size > ds.width or row0 + size > ds.height:
            raise ValueError("Requested subset falls outside source raster")
        window = Window(col0, row0, size, size)
        heights = ds.read(1, window=window, masked=False).astype("<f4", copy=False)
        mask = (ds.read_masks(1, window=window) != 0).astype("uint8")
        if not mask.any():
            raise ValueError("Subset contains no valid elevation cells")
        for point in point_results:
            if not (row0 <= point["source_row"] < row0 + size and col0 <= point["source_col"] < col0 + size):
                raise ValueError(f"Point {point['id']} is covered by source but outside exported subset")
        heights_name, mask_name = "heights.f32", "mask.u8"
        heights_path, mask_path = output_dir / heights_name, output_dir / mask_name
        heights.tofile(heights_path)
        mask.tofile(mask_path)
        subset_transform = ds.window_transform(window)
        valid_values = heights[mask != 0]
        subset_bounds = rasterio.windows.bounds(window, ds.transform)
        metadata = {
            "schema_version": 1,
            "region_id": "jezero_west_delta_demo",
            "generated_on": date.today().isoformat(),
            "source": {
                "url": SOURCE_URL,
                "product": "Mars 2020 Science Investigation CTX DEM Mosaic",
                "mission": "Mars Reconnaissance Orbiter",
                "instrument": "Context Camera (CTX)",
                "publisher": "USGS Astrogeology Science Center",
                "source_file": source.name,
                "source_sha256": sha256(source),
                "source_bytes": source.stat().st_size,
                "accessed_on": date.today().isoformat(),
            },
            "grid": {
                "width": size,
                "height": size,
                "pixel_size_m": [float(v) for v in ds.res],
                "bounds_projected_m": [float(v) for v in subset_bounds],
                "transform": list(subset_transform)[:6],
                "source_window_col_row": [col0, row0],
                "dtype": ds.dtypes[0],
                "nodata": float(ds.nodata),
                "heights_file": heights_name,
                "heights_encoding": "IEEE-754 float32 little-endian, row-major",
                "heights_units": "m",
                "mask_file": mask_name,
                "mask_encoding": "uint8 row-major; 1=valid, 0=NoData",
                "valid_cells": int(mask.sum()),
                "total_cells": int(mask.size),
                "valid_fraction": float(mask.mean()),
                "elevation_min_m": float(valid_values.min()),
                "elevation_max_m": float(valid_values.max()),
                "elevation_reference": "MOLA control net (USGS product metadata)",
                "resampling": "none; native source cells copied",
            },
            "source_grid": source_meta,
            "crs_wkt": source_meta["crs_wkt"],
            "coordinate_convention": {
                "latitude": "planetocentric degrees north",
                "longitude": "degrees east-positive",
                "source_crs_projection": "equirectangular (spherical)",
                "source_crs_sphere_radius_m": float(source_meta["crs_proj_params"].get("R", 0)),
                "coordinate_conversion": "direct Mars spherical projection from the GeoTIFF CRS; no Earth/WGS84 transform",
            },
            "checked_points": point_results,
            "limitations": [
                "20 m/pixel terrain grid does not resolve small individual rocks or other sub-cell hazards.",
                "A 20 m posting is not a claim of 20 m absolute positional or vertical accuracy.",
                "Route suitability and human EVA safety are not validated by this data preparation step.",
            ],
            "checksums": {
                heights_name: sha256(heights_path),
                mask_name: sha256(mask_path),
            },
        }
    metadata_path = output_dir / "metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    checksum_lines = [f"{sha256(path)}  {path.name}" for path in (output_dir / "heights.f32", output_dir / "mask.u8", metadata_path)]
    (output_dir / "checksums.sha256").write_text("\n".join(checksum_lines) + "\n", encoding="ascii")
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="USGS GeoTIFF path")
    parser.add_argument("--points", type=Path, default=DEFAULT_POINTS, help="CSV with Mars coordinates")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Compact output directory")
    parser.add_argument("--size", type=int, default=75, help="Odd square subset size in native cells")
    parser.add_argument("--download", action="store_true", help="Download source GeoTIFF if it is absent")
    args = parser.parse_args()
    if not args.source.exists():
        if not args.download:
            parser.error(f"Source file not found: {args.source}; pass --download to fetch it from USGS")
        print(f"Downloading {SOURCE_URL}")
        download_source(args.source)
    metadata = preprocess(args.source, args.points, args.output, args.size)
    print(json.dumps({"output": str(args.output), "grid": metadata["grid"], "checked_points": metadata["checked_points"]},
                     indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
