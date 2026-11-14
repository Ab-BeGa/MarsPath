"""Task #10: measured local slopes from the Jezero DEM grid.

Slope values are maximum absolute angles to valid 8-connected neighboring
pixel centers. This is an edge-based DEM measure, NOT a subpixel terrain
slope, a safety assessment, or a NASA traversability standard.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).resolve().parent / "public" / "data" / "jezero"
OUT_DIR = Path(__file__).resolve().parent / "results" / "jezero_slopes"
# Each undirected neighbor edge is visited once; together these cover 8 neighbors.
DIRECTIONS = ((0, 1), (1, 0), (1, 1), (1, -1))


@dataclass(frozen=True)
class SlopeResult:
    local_max_slope_deg: np.ndarray
    max_slope_deg: float | None
    steepest_edge: tuple[tuple[int, int], tuple[int, int]] | None
    valid_edges: int


def load_dem(data_dir: Path) -> tuple[np.ndarray, np.ndarray, float, float, dict]:
    """Read the published Float32 LE elevation grid and Uint8 validity mask."""
    meta = json.loads((data_dir / "metadata.json").read_text(encoding="utf-8"))
    grid = meta["grid"]
    height, width = int(grid["height"]), int(grid["width"])
    if height <= 0 or width <= 0:
        raise ValueError("DEM dimensions must be positive")
    dx, dy = map(float, grid["pixel_size_m"])
    transform = grid["transform"]
    if len(transform) != 6 or abs(float(transform[1])) > 1e-9 or abs(float(transform[3])) > 1e-9:
        raise ValueError("Rotated/sheared DEM requires a different distance model")
    if not np.isclose(abs(float(transform[0])), dx) or not np.isclose(abs(float(transform[4])), dy):
        raise ValueError("DEM transform and pixel_size_m disagree")
    if grid.get("heights_encoding") != "IEEE-754 float32 little-endian, row-major":
        raise ValueError("Unexpected elevation encoding")

    heights = np.fromfile(data_dir / grid["heights_file"], dtype="<f4")
    mask = np.fromfile(data_dir / grid["mask_file"], dtype="u1")
    if heights.size != height * width or mask.size != height * width:
        raise ValueError("DEM/mask binary sizes do not match metadata")
    if not np.isin(mask, (0, 1)).all():
        raise ValueError("Mask must contain only 0 (NoData) and 1 (valid)")
    return heights.reshape(height, width), mask.reshape(height, width).astype(bool), dx, dy, meta


def slope_between_cells(
    heights: np.ndarray,
    valid: np.ndarray,
    a: tuple[int, int],
    b: tuple[int, int],
    dx_m: float,
    dy_m: float,
) -> float | None:
    """Angle in degrees for one neighboring edge; None if NoData is involved."""
    rows, cols = heights.shape
    r1, c1 = a
    r2, c2 = b
    if not (0 <= r1 < rows and 0 <= r2 < rows and 0 <= c1 < cols and 0 <= c2 < cols):
        raise ValueError("Cell index outside DEM")
    dr, dc = abs(r2 - r1), abs(c2 - c1)
    if (dr == 0 and dc == 0) or dr > 1 or dc > 1:
        raise ValueError("Cells must be distinct 8-connected neighbors")
    if not np.isfinite([dx_m, dy_m]).all() or dx_m <= 0 or dy_m <= 0:
        raise ValueError("Pixel sizes must be finite positive meters")
    if not (valid[a] and valid[b]):
        return None
    if not np.isfinite(heights[a]) or not np.isfinite(heights[b]):
        raise ValueError("Nonfinite height marked as valid")
    horizontal_m = float(np.hypot(dc * dx_m, dr * dy_m))
    return float(np.degrees(np.arctan2(abs(float(heights[b]) - float(heights[a])), horizontal_m)))


def calculate_local_slopes(
    heights: np.ndarray, valid: np.ndarray, dx_m: float, dy_m: float
) -> SlopeResult:
    """Per-cell maximum measured angle to neighboring valid DEM pixels.

    Invalid/isolated cells have NaN, not zero. Valid zero-slope edges have 0.
    This is NOT a central-difference surface-gradient estimate.
    """
    heights = np.asarray(heights, dtype=np.float64)
    valid = np.asarray(valid)
    if heights.ndim != 2 or min(heights.shape) < 1 or valid.shape != heights.shape:
        raise ValueError("Heights and valid mask must be matching nonempty 2D arrays")
    if not np.isin(valid, (0, 1, False, True)).all():
        raise ValueError("Validity mask must contain only 0/1")
    valid = valid.astype(bool)
    if not np.isfinite(heights[valid]).all():
        raise ValueError("Nonfinite elevation marked as valid")
    if not np.isfinite([dx_m, dy_m]).all() or dx_m <= 0 or dy_m <= 0:
        raise ValueError("Pixel sizes must be finite positive meters")

    rows, cols = heights.shape
    local = np.full((rows, cols), np.nan, dtype=np.float64)
    max_slope = None
    steepest = None
    valid_edges = 0

    for dr, dc in DIRECTIONS:
        if abs(dr) >= rows or abs(dc) >= cols:
            continue
        r0, r1 = (slice(0, rows - dr), slice(dr, rows))
        c0, c1 = ((slice(0, cols - dc), slice(dc, cols)) if dc >= 0
                  else (slice(-dc, cols), slice(0, cols + dc)))
        pair_valid = valid[r0, c0] & valid[r1, c1]
        count = int(pair_valid.sum())
        if count == 0:
            continue
        valid_edges += count
        delta_z = heights[r1, c1] - heights[r0, c0]
        distance_m = float(np.hypot(dc * dx_m, dr * dy_m))
        angle = np.full(delta_z.shape, np.nan, dtype=np.float64)
        angle[pair_valid] = np.degrees(np.arctan2(np.abs(delta_z[pair_valid]), distance_m))

        local[r0, c0] = np.fmax(local[r0, c0], angle)
        local[r1, c1] = np.fmax(local[r1, c1], angle)

        peak = float(np.nanmax(angle))
        if max_slope is None or peak > max_slope:
            i, j = np.unravel_index(np.nanargmax(angle), angle.shape)
            start = (int(i), int(j if dc >= 0 else j - dc))
            max_slope = peak
            steepest = (start, (start[0] + dr, start[1] + dc))
    return SlopeResult(local, max_slope, steepest, valid_edges)


def save_results(result: SlopeResult, meta: dict, dx_m: float, dy_m: float, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "local_max_slope_deg.f32").write_bytes(
        result.local_max_slope_deg.astype("<f4").tobytes(order="C")
    )
    summary = {
        "source": meta["source"]["product"],
        "grid_shape_rows_cols": list(result.local_max_slope_deg.shape),
        "pixel_size_m_xy": [dx_m, dy_m],
        "method": "Max absolute 8-neighbor edge slope, degrees; atan2(|dz|, horizontal_distance)",
        "nodata_policy": "NaN if no neighboring valid measurement; no interpolation",
        "valid_neighbor_edges": result.valid_edges,
        "cells_with_measured_slope": int(np.isfinite(result.local_max_slope_deg).sum()),
        "max_measured_slope_deg": result.max_slope_deg,
        "steepest_edge_row_col": result.steepest_edge,
        "limitations": "20 m DEM scale; cannot establish actual EVA safety or small-obstacle presence",
    }
    (out_dir / "slope_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    # Scientific visualization from measured DEM elevations (not generated art).
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(7, 6))
    image = ax.imshow(np.ma.masked_invalid(result.local_max_slope_deg),
                      origin="upper", cmap="viridis", interpolation="nearest")
    if result.steepest_edge is not None:
        (r0, c0), (r1, c1) = result.steepest_edge
        ax.plot([c0, c1], [r0, r1], color="red", linewidth=2.5,
                marker="o", markersize=3)
    ax.set(title="Jezero: max neighboring-pixel slope", xlabel="DEM column", ylabel="DEM row")
    fig.colorbar(image, ax=ax, label="Measured slope (degrees)")
    fig.tight_layout()
    fig.savefig(out_dir / "local_slopes.png", dpi=170)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="Task 10: Jezero local DEM slopes")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    args = parser.parse_args()
    heights, valid, dx_m, dy_m, meta = load_dem(args.data_dir)
    result = calculate_local_slopes(heights, valid, dx_m, dy_m)
    save_results(result, meta, dx_m, dy_m, args.out_dir)
    print(f"DEM: {heights.shape[0]}x{heights.shape[1]} | valid edges: {result.valid_edges}")
    print(f"Max measured local slope: {result.max_slope_deg} deg")
    print(f"Steepest neighbor edge (row,col): {result.steepest_edge}")
    print(f"Outputs: {args.out_dir.resolve()}")


if __name__ == "__main__":
    main()
