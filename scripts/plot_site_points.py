"""Draw the selected Jezero demo base and science point over the checked DEM."""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data" / "jezero"
METADATA = DATA / "metadata.json"
OUTPUT = ROOT / "docs" / "jezero_site_points.png"


def main() -> None:
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    grid = metadata["grid"]
    width, height = int(grid["width"]), int(grid["height"])
    dx, dy = map(float, grid["pixel_size_m"])
    left, bottom, right, top = map(float, grid["bounds_projected_m"])

    heights = np.fromfile(DATA / grid["heights_file"], dtype="<f4").reshape(height, width)
    mask = np.fromfile(DATA / grid["mask_file"], dtype="u1").reshape(height, width) != 0
    if not mask.all():
        heights = np.ma.array(heights, mask=~mask)

    # Plot coordinates as local east/north offsets from the lower-left corner.
    extent = (0.0, right - left, 0.0, top - bottom)
    x_centers = np.linspace(dx / 2, (width - 0.5) * dx, width)
    y_centers = np.linspace((height - 0.5) * dy, dy / 2, height)
    xx, yy = np.meshgrid(x_centers, y_centers)

    points = {p["id"]: p for p in metadata["checked_points"]}
    base = points["base"]
    target = points["science_target"]
    bx, by = base["projected_x_m"] - left, base["projected_y_m"] - bottom
    tx, ty = target["projected_x_m"] - left, target["projected_y_m"] - bottom
    direct_distance = float(np.hypot(tx - bx, ty - by))

    fig, ax = plt.subplots(figsize=(10, 8))
    image = ax.imshow(
        heights,
        origin="upper",
        extent=extent,
        cmap="terrain",
        interpolation="nearest",
        aspect="equal",
    )
    valid_heights = heights.compressed() if np.ma.isMaskedArray(heights) else heights.ravel()
    levels = np.linspace(float(valid_heights.min()), float(valid_heights.max()), 8)
    ax.contour(xx, yy, heights, levels=levels, colors="#22313a", linewidths=0.45, alpha=0.45)

    ax.plot([bx, tx], [by, ty], linestyle=(0, (4, 3)), color="#252525", linewidth=1.3, zorder=4)
    ax.scatter([bx], [by], marker="s", s=92, color="#1768ac", edgecolor="white", linewidth=1.2, zorder=5)
    ax.scatter([tx], [ty], marker="*", s=190, color="#e87500", edgecolor="white", linewidth=0.9, zorder=5)

    ax.annotate(
        f"Условная база (точка проекта) — район Three Forks\n{base['latitude_deg']:.6f}°N, {base['longitude_deg']:.6f}°E",
        xy=(bx, by), xytext=(-20, -38), textcoords="offset points", ha="right", va="top",
        fontsize=9, color="#102a43",
        bbox={"boxstyle": "round,pad=0.25", "fc": "white", "ec": "none", "alpha": 0.88},
        arrowprops={"arrowstyle": "-", "color": "#1768ac", "lw": 0.8},
    )
    ax.annotate(
        f"Научная остановка (точка проекта)\nрайон Wildcat Ridge / Hazeltop\n{target['latitude_deg']:.6f}°N, {target['longitude_deg']:.6f}°E",
        xy=(tx, ty), xytext=(18, 28), textcoords="offset points", ha="left", va="bottom",
        fontsize=9, color="#6a3500",
        bbox={"boxstyle": "round,pad=0.25", "fc": "white", "ec": "none", "alpha": 0.88},
        arrowprops={"arrowstyle": "-", "color": "#e87500", "lw": 0.8},
    )
    ax.text(
        (bx + tx) / 2 + 20,
        (by + ty) / 2 - 35,
        f"{direct_distance:.0f} м по прямой",
        fontsize=8,
        color="#222",
        bbox={"boxstyle": "round,pad=0.2", "fc": "white", "ec": "none", "alpha": 0.85},
        zorder=6,
    )

    # 500 m scale bar and north arrow, both in the local projected grid.
    ax.plot([70, 570], [70, 70], color="black", linewidth=3, solid_capstyle="butt", zorder=6)
    ax.plot([70, 70], [58, 82], color="black", linewidth=1, zorder=6)
    ax.plot([570, 570], [58, 82], color="black", linewidth=1, zorder=6)
    ax.text(320, 92, "500 м", ha="center", va="bottom", fontsize=9, color="black")
    ax.annotate("Север", xy=(0.91, 0.94), xytext=(0.91, 0.81), xycoords="axes fraction",
                textcoords="axes fraction", ha="center", va="center",
                arrowprops={"arrowstyle": "-|>", "lw": 1.4, "color": "#172b4d"},
                fontsize=9, color="#172b4d")

    ax.set_xlim(0, right - left)
    ax.set_ylim(0, top - bottom)
    ax.set_xlabel("Восток от юго-западной границы DEM, м")
    ax.set_ylabel("Север от юго-западной границы DEM, м")
    ax.set_title("Участок Езеро: условная база и научная точка")
    ax.set_xticks(np.arange(0, right - left + 1, 250))
    ax.set_yticks(np.arange(0, top - bottom + 1, 250))
    ax.grid(color="white", alpha=0.42, linewidth=0.55)
    colorbar = fig.colorbar(image, ax=ax, shrink=0.82, pad=0.03)
    colorbar.set_label("Высота по USGS CTX DEM, м")
    ax.text(
        0.01,
        -0.13,
        "Точки по таблице проекта; точное совпадение с объектами NASA не проверено. "
        "Пунктир — расстояние по прямой, не маршрут.",
        transform=ax.transAxes,
        fontsize=8,
        color="#333",
        va="top",
    )
    fig.subplots_adjust(left=0.12, right=0.87, bottom=0.16, top=0.91)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUTPUT, dpi=180, facecolor="white")
    plt.close(fig)
    print(OUTPUT)


if __name__ == "__main__":
    main()
