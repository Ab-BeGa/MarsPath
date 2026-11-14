"""Export measured Mars-route elevation profiles as CSV and standalone PNG.

This module works with RouteProfile produced by route_geometry.route_samples.
Longitudinal slopes are supplied by traversability.analyze_traversability,
so CSV and the existing traversability report use exactly the same values.
Missing DEM measurements are *never* interpolated or treated as flat ground.
"""
from __future__ import annotations

import csv
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

if TYPE_CHECKING:
    from route_geometry import RouteProfile


HEADERS = (
    "distance_m", "elevation_m", "x_projected", "y_projected",
    "latitude_n", "longitude_e", "dem_status", "measured_slope_deg",
)


def _profile_arrays(profile: RouteProfile, interval_slope_deg):
    d = np.asarray(profile.distance_m, dtype=float)
    z = np.asarray(profile.elevation_m, dtype=float)
    xy = np.asarray(profile.xy, dtype=float)
    status = np.asarray(profile.sample_status)
    slopes = np.asarray(interval_slope_deg, dtype=float)
    n = len(d)
    if (d.ndim != 1 or n < 2 or z.shape != (n,) or xy.shape != (n, 2)
            or status.shape != (n,) or slopes.shape != (n - 1,)):
        raise ValueError("Route profile and interval slope array have incompatible shapes")
    if not np.all(np.isfinite(d)) or np.any(np.diff(d) <= 0):
        raise ValueError("Route distances must be finite and strictly increasing")
    if not np.all(np.isfinite(xy)):
        raise ValueError("Route coordinates must be finite")
    if np.any((status == "valid") != np.isfinite(z)):
        raise ValueError("DEM status and elevations disagree")
    valid_edges = ((status[:-1] == "valid") & (status[1:] == "valid"))
    if np.any(np.isfinite(slopes) & ~valid_edges):
        raise ValueError("Slope supplied for an interval with missing DEM data")
    if np.any(np.isfinite(slopes) & ((slopes < 0) | (slopes >= 90))):
        raise ValueError("Measured absolute slope must be in [0, 90) degrees")
    return d, z, xy, status, slopes


def write_profile_csv(
    path: str | Path,
    profile: RouteProfile,
    *,
    latitude_n,
    longitude_e,
    interval_slope_deg,
) -> Path:
    """Write one row per DEM reading; slope on row i covers interval i-1 -> i.

    The first row always has a blank slope, because no preceding interval
    exists. Unknown intervals also have blank slopes. A valid *flat* interval
    is correctly written as 0.000, not blank.
    """
    d, z, xy, status, slopes = _profile_arrays(profile, interval_slope_deg)
    lat = np.asarray(latitude_n, dtype=float)
    lon = np.asarray(longitude_e, dtype=float)
    if lat.shape != d.shape or lon.shape != d.shape:
        raise ValueError("Geographic coordinates must match profile length")
    if not np.isfinite(lat).all() or not np.isfinite(lon).all():
        raise ValueError("Geographic coordinates must be finite")

    dest = Path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(HEADERS)
        for i, (dist, height, point, la, lo, state) in enumerate(
            zip(d, z, xy, lat, lon, status, strict=True)
        ):
            slope = slopes[i - 1] if i else float("nan")
            writer.writerow([
                f"{dist:.3f}", f"{height:.3f}" if state == "valid" else "",
                f"{point[0]:.3f}", f"{point[1]:.3f}",
                f"{la:.8f}", f"{lo:.8f}", str(state),
                f"{slope:.3f}" if np.isfinite(slope) else "",
            ])
    return dest


def save_elevation_png(
    path: str | Path,
    profile: RouteProfile,
    interval_slope_deg,
) -> Path:
    """Save an elevation-only graph without modifying the interactive figure."""
    d, z, _xy, status, slopes = _profile_arrays(profile, interval_slope_deg)
    valid = (status == "valid") & np.isfinite(z)
    shown = np.ma.array(z, mask=~valid)

    figure = Figure(figsize=(11, 4.8), dpi=160, facecolor="white")
    FigureCanvasAgg(figure)
    ax = figure.add_subplot(111)
    ax.plot(d, shown, color="#207e75", linewidth=2, label="Measured DEM elevation")

    if valid[0]:
        ax.scatter([d[0]], [z[0]], color="#207e75", marker="o", zorder=4)
    if valid[-1]:
        ax.scatter([d[-1]], [z[-1]], color="#c47735", marker="o", zorder=4)
    finite_grades = np.isfinite(slopes)
    if finite_grades.any():
        idx = int(np.nanargmax(slopes))
        ax.axvspan(d[idx], d[idx + 1], color="#efb657", alpha=0.27,
                   label=f"Steepest measured interval: {slopes[idx]:.1f} deg")
    if not valid.all():
        ax.text(0.02, 0.03, "Gaps: missing DEM samples (not interpolated)",
                transform=ax.transAxes, fontsize=9, color="#9e3434")
    if not valid.any():
        ax.text(0.5, 0.5, "No valid elevation samples", ha="center",
                va="center", transform=ax.transAxes)

    ax.set_title("Jezero Traverse — elevation profile (USGS CTX DEM)")
    ax.set_xlabel("Horizontal distance along route (m)")
    ax.set_ylabel("DEM elevation (m)")
    ax.grid(alpha=0.25)
    ax.set_xlim(float(d[0]), float(d[-1]))
    if finite_grades.any() or valid.any():
        ax.legend(loc="best", fontsize=9)
    figure.text(0.5, 0.015,
                "Sample-scale longitudinal slopes; 20-m source DEM. Not an EVA safety assessment.",
                ha="center", fontsize=8, color="#505050")
    figure.subplots_adjust(left=0.10, right=0.98, bottom=0.19, top=0.88)
    dest = Path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(dest, dpi=160)
    return dest
