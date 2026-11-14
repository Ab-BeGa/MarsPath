from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.plot import plotting_extent
from scripts.preprocess_dem import projected_distance_m


folder = Path(__file__).resolve().parent
dem_path = folder / "data" / "M20_JezeroCrater_CTXDEM_20m.tif"

with rasterio.open(dem_path) as dem:
    if dem.crs is None or not dem.crs.is_projected:
        raise SystemExit("Для расчёта нужна модель высот в проекции.")

    # Уменьшаем изображение для предпросмотра. Высоты берём из оригинала.
    scale = min(1, 1200 / max(dem.height, dem.width))
    preview = dem.read(
        1,
        out_shape=(max(1, round(dem.height * scale)),
                   max(1, round(dem.width * scale))),
        masked=True,
    )

    map_figure, map_axis = plt.subplots()
    map_axis.imshow(preview, extent=plotting_extent(dem), cmap="terrain")
    map_axis.set_title("Click two points inside the colored area")

    points = plt.ginput(2, timeout=0)
    plt.close(map_figure)

    if len(points) != 2:
        raise SystemExit("Запусти скрипт ещё раз и выбери две точки.")

    start, end = np.asarray(points)
    length_m = projected_distance_m(dem.crs, tuple(start), tuple(end))

    if length_m == 0:
        raise SystemExit("Выбери две разные точки.")

    # Берём отсчёты с шагом не более 20 метров, включая обе конечные точки.
    sample_count = int(np.ceil(length_m / 20)) + 1
    coordinates = np.linspace(start, end, sample_count)
    distances = np.linspace(0, length_m, sample_count)
    elevations = np.array([
        float(value[0]) if not np.ma.is_masked(value[0]) else np.nan
        for value in dem.sample(coordinates, indexes=1, masked=True)
    ])

if not np.isfinite(elevations).any():
    raise SystemExit("На линии нет высот. Выбери точки внутри цветного участка.")

np.savetxt(
    folder / "route_profile.csv",
    np.column_stack((distances, elevations)),
    delimiter=",",
    header="distance_m,elevation_m",
    comments="",
    fmt="%.2f",
)

figure, axis = plt.subplots()
axis.plot(distances, elevations)
axis.set_title("Jezero crater — elevation profile")
axis.set_xlabel("Distance from start (m)")
axis.set_ylabel("Elevation (m)")
axis.grid(alpha=0.3)
figure.tight_layout()
figure.savefig(folder / "route_profile.png", dpi=150)

print(f"Длина линии: {length_m:.0f} м")
print("Сохранены route_profile.csv и route_profile.png")
plt.show()
