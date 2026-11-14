"""Render CRISM HRL000040FF abundance maps from Zastrow & Glotch (2021)."""
import argparse
import json
from math import cos, radians
from pathlib import Path

from netCDF4 import Dataset
import numpy as np
from PIL import Image
from rasterio.crs import CRS

MODELS = {
    "magnesite": (("Magnesite",), (255, 191, 70)),
    "smectite": (("Nontronite", "Saponite"), (86, 223, 172)),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path, help="040ff_2cuts_final_standard_tomurray.nc")
    parser.add_argument("--output", type=Path, default=Path("public/data/jezero"))
    args = parser.parse_args()
    metadata = json.loads((args.output / "crism_minerals.json").read_text(encoding="utf-8"))
    metadata.pop("label_cell")
    west, south, east, north = metadata["bounds_projected_m"]
    width, height = metadata["width"], metadata["height"]
    x = west + (np.arange(width) + 0.5) * (east - west) / width
    y = north - (np.arange(height) + 0.5) * (north - south) / height

    with Dataset(args.model) as data:
        # Both grids use east-positive longitude and planetocentric latitude.
        # Preserve the angles while converting between the published Mars spheres.
        source_crs = CRS.from_wkt(data.crs).to_dict()
        target_crs = CRS.from_wkt(metadata["crs_wkt"]).to_dict()
        radius_ratio = source_crs["R"] / target_crs["R"]
        x_ratio = radius_ratio * cos(radians(source_crs["lat_ts"])) / cos(radians(target_crs["lat_ts"]))
        left, dx, _, top, _, dy = data.transform
        cols = np.floor((x * x_ratio - left) / dx).astype(int)
        rows = np.floor((y * radius_ratio - top) / dy).astype(int)
        if cols.min() < 0 or rows.min() < 0 or cols.max() >= len(data["x"]) or rows.max() >= len(data["y"]):
            raise ValueError("Study grid is outside the published model bounds")
        minerals = list(data["Mineral"][:])
        metadata["maximum_percent"] = {}
        for name, (components, rgb) in MODELS.items():
            model = sum(data["mnc"][minerals.index(component)].filled(np.nan) for component in components)
            abundance = model[np.ix_(rows, cols)]
            maximum = float(np.nanmax(abundance))
            if not 0 < maximum <= 100:
                raise ValueError(f"Unexpected model abundance for {name}: {maximum}")
            rgba = np.empty((height, width, 4), dtype=np.uint8)
            rgba[..., :3] = rgb
            rgba[..., 3] = np.rint(np.nan_to_num(abundance, nan=0) / maximum * 235).astype(np.uint8)
            Image.fromarray(rgba).save(args.output / f"crism_model_{name}.png")
            metadata["maximum_percent"][name] = maximum
    (args.output / "crism_model.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
