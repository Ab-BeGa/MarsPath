"""Verify NASA/USGS Jezero CTX DEM coverage at two documented Mars coordinates.

Run: python verify_site_dem.py --dem M20_JezeroCrater_CTXDEM_20m.tif
This program does NOT claim astronaut safety or calculate a traversable route.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.windows import from_bounds, transform as window_transform
from rasterio.windows import bounds as window_bounds

HERE = Path(__file__).resolve().parent


def verify(dem_path: Path, config_path: Path) -> None:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    points = config["points"]
    bbox = config["extent_planetocentric"]
    corners = [
        (bbox["west_longitude_e"], bbox["south_latitude_n"]),
        (bbox["west_longitude_e"], bbox["north_latitude_n"]),
        (bbox["east_longitude_e"], bbox["south_latitude_n"]),
        (bbox["east_longitude_e"], bbox["north_latitude_n"]),
    ]

    if not dem_path.exists():
        raise SystemExit(
            f"DEM отсутствует: {dem_path}\n"
            f"Скачать: {config['source_dem']['download_url']}"
        )

    with rasterio.open(dem_path) as dem:
        if dem.count < 1 or dem.crs is None or not dem.crs.is_projected:
            raise SystemExit("Ожидается геопривязанный, проецированный GeoTIFF с моделью высот.")

        projected = CRS.from_wkt(dem.crs.to_wkt())
        source = projected.geodetic_crs
        if source is None:
            raise SystemExit("В проекции DEM не определена марсианская географическая CRS.")

        # Use the Mars DEM datum, never terrestrial EPSG:4326.
        transformer = Transformer.from_crs(source, projected, always_xy=True)
        xcorners, ycorners = zip(
            *(transformer.transform(lon, lat) for lon, lat in corners)
        )
        left, right = min(xcorners), max(xcorners)
        bottom, top = min(ycorners), max(ycorners)

        window_float = from_bounds(left, bottom, right, top, dem.transform)
        window = window_float.round_offsets().round_lengths()
        if (
            window.col_off < 0
            or window.row_off < 0
            or window.col_off + window.width > dem.width
            or window.row_off + window.height > dem.height
        ):
            raise SystemExit("Участок 1.5×1.5 км частично выходит за прямоугольные границы DEM.")

        area = dem.read(1, window=window, masked=True)
        if area.size == 0:
            raise SystemExit("Не удалось получить окно DEM.")
        valid = np.isfinite(area.filled(np.nan))

        print(f"Модель высот: {dem_path.name}")
        print(f"Размер окна DEM: {area.shape[1]} × {area.shape[0]} пикселей")
        print(f"Покрытие действительными высотами: {100 * valid.mean():.1f}%")
        print(f"CRS: {dem.crs}")
        print(f"Единицы CRS: {dem.crs.linear_units}")
        print("Проверка двух координат:")

        projected_pts = []
        for point in points:
            x, y = transformer.transform(point["longitude_e"], point["latitude_n"])
            projected_pts.append((x, y))
            if not (
                dem.bounds.left <= x <= dem.bounds.right
                and dem.bounds.bottom <= y <= dem.bounds.top
            ):
                print(f" - {point['id']}: ВНЕ ПОЛНОГО ОХВАТА DEM")
                continue
            value = next(dem.sample([(x, y)], indexes=1, masked=True))[0]
            if np.ma.is_masked(value) or not np.isfinite(float(value)):
                print(f" - {point['id']}: нет действительных высот в данной точке")
            else:
                print(f" - {point['id']}: высота DEM = {float(value):.2f} м")

        if valid.any():
            print(
                f"Высоты в области: "
                f"{np.nanmin(area.filled(np.nan)):.2f} ... "
                f"{np.nanmax(area.filled(np.nan)):.2f} м"
            )

        # Plot genuine raster values only, not synthetic elevation terrain.
        wleft, wbottom, wright, wtop = window_bounds(window, dem.transform)
        fig, ax = plt.subplots(figsize=(9, 8))
        im = ax.imshow(
            area,
            extent=(wleft, wright, wbottom, wtop),
            origin="upper",
            cmap="terrain",
        )
        fig.colorbar(im, ax=ax, label="Elevation (m)", shrink=0.8)
        labels = {"base": "A — Three Forks", "science": "B — Wildcat Ridge"}
        for point, (x, y) in zip(points, projected_pts):
            ax.scatter(x, y, s=100, edgecolors="white", linewidths=1.5, zorder=4)
            ax.annotate(
                labels.get(point["id"], point["id"]),
                (x, y),
                xytext=(8, 7),
                textcoords="offset points",
                fontsize=10,
                color="black",
                bbox={"facecolor": "white", "alpha": 0.8, "edgecolor": "none"},
            )

        ax.plot(
            [p[0] for p in projected_pts],
            [p[1] for p in projected_pts],
            color="white",
            linestyle="--",
            linewidth=1.8,
            alpha=0.9,
        )
        ax.set_title("Jezero Traverse | selected region in actual CTX DEM")
        ax.set_xlabel(f"Mars projected X ({dem.crs.linear_units})")
        ax.set_ylabel(f"Mars projected Y ({dem.crs.linear_units})")
        ax.set_aspect("equal")
        fig.tight_layout()
        dest = HERE / "site_dem_preview.png"
        fig.savefig(dest, dpi=180)
        plt.close(fig)
        print(f"Сохранена карта на реальной DEM: {dest}")
        if valid.mean() < 0.99:
            print("ВНИМАНИЕ: DEM содержит пропуски в выбранной области.")
        else:
            print("ROI покрыта действительными пикселями DEM. Далее нужен расчёт склонов и точек маршрута.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dem", type=Path, default=HERE / "M20_JezeroCrater_CTXDEM_20m.tif"
    )
    parser.add_argument("--config", type=Path, default=HERE / "site_config.json")
    args = parser.parse_args()
    verify(args.dem, args.config)
