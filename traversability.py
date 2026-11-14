"""Experimental, user-configurable *terrain steepness* screening for Jezero Traverse.

Bands describe sampled longitudinal grade along a proposed path, not terrain
clearance or EVA safety. Missing DEM readings remain unknown, never 'low risk'.

Task 11 is intentionally independent of Task 10 (local 2-D slope grids): it
accepts the route profile already exposed by route_geometry.py and can later
receive additional slope layers without modifying the algorithm owned by others.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from route_geometry import RouteProfile

BANDS = ("gentle", "moderate", "steep", "very_steep", "unknown")


@dataclass(frozen=True)
class SlopeThresholds:
    gentle_max_deg: float = 5.0
    moderate_max_deg: float = 10.0
    steep_max_deg: float = 15.0

    def __post_init__(self):
        values = (self.gentle_max_deg, self.moderate_max_deg, self.steep_max_deg)
        if not all(np.isfinite(v) for v in values) or not (0 < values[0] < values[1] < values[2] < 90):
            raise ValueError("Slope thresholds must satisfy 0 < gentle < moderate < steep < 90 degrees")

    def as_dict(self) -> dict[str, float]:
        return {
            "gentle_max_deg": float(self.gentle_max_deg),
            "moderate_max_deg": float(self.moderate_max_deg),
            "steep_max_deg": float(self.steep_max_deg),
        }


@dataclass(frozen=True)
class TraversabilityReport:
    thresholds: SlopeThresholds
    interval_slope_deg: np.ndarray
    interval_bands: np.ndarray
    interval_lengths_m: np.ndarray
    band_distances_m: dict[str, float]
    total_m: float

    @property
    def unknown_m(self) -> float:
        return self.band_distances_m["unknown"]

    @property
    def difficult_m(self) -> float:
        """Combined steep and very_steep experimental bands, NOT unsafe length."""
        return self.band_distances_m["steep"] + self.band_distances_m["very_steep"]

    @property
    def measured_pct(self) -> float:
        return 100.0 * (self.total_m - self.unknown_m) / self.total_m

    def to_dict(self) -> dict:
        def finite_or_null(v: float) -> float | None:
            return float(v) if np.isfinite(v) else None
        return {
            "method": "Sample-to-sample longitudinal grade, atan(abs(delta DEM elevation) / horizontal route segment length)",
            "thresholds_deg": self.thresholds.as_dict(),
            "distance_by_band_m": {k: float(v) for k, v in self.band_distances_m.items()},
            "difficult_band_distance_m": self.difficult_m,
            "unknown_distance_m": self.unknown_m,
            "measured_distance_percent": self.measured_pct,
            "intervals": [
                {"grade_deg": finite_or_null(g), "band": str(b), "distance_m": float(d)}
                for g, b, d in zip(self.interval_slope_deg, self.interval_bands, self.interval_lengths_m)
            ],
            "scientific_notice": (
                "Custom bands for visualizing DEM-derived slopes, not NASA EVA specifications. "
                "20-m pixels miss smaller obstacles; a low-angle band is NOT confirmed passable. "
                "Intervals adjacent to missing data are UNKNOWN rather than treated as safe."
            ),
        }


def analyze_traversability(profile: RouteProfile, thresholds: SlopeThresholds | None = None) -> TraversabilityReport:
    """Classify each measured route interval with configurable degree thresholds."""
    thresholds = thresholds or SlopeThresholds()
    d = np.asarray(profile.distance_m, dtype=float)
    z = np.asarray(profile.elevation_m, dtype=float)
    states = np.asarray(profile.sample_status)
    if d.ndim != 1 or len(d) < 2 or z.shape != d.shape or states.shape != d.shape:
        raise ValueError("Expected aligned route distance, height and validity arrays")
    lengths = np.diff(d)
    if not np.isfinite(lengths).all() or np.any(lengths <= 0):
        raise ValueError("Distances must increase strictly and be finite")
    known = ((states[:-1] == "valid") & (states[1:] == "valid") &
             np.isfinite(z[:-1]) & np.isfinite(z[1:]))
    slopes = np.full(len(lengths), np.nan)
    slopes[known] = np.rad2deg(np.arctan(np.abs(np.diff(z)[known]) / lengths[known]))
    levels = np.full(len(lengths), "unknown", dtype="<U12")
    levels[known & (slopes <= thresholds.gentle_max_deg)] = "gentle"
    levels[known & (slopes > thresholds.gentle_max_deg) & (slopes <= thresholds.moderate_max_deg)] = "moderate"
    levels[known & (slopes > thresholds.moderate_max_deg) & (slopes <= thresholds.steep_max_deg)] = "steep"
    levels[known & (slopes > thresholds.steep_max_deg)] = "very_steep"
    bands = {name: float(lengths[levels == name].sum()) for name in BANDS}
    assert np.isclose(sum(bands.values()), d[-1] - d[0], rtol=1e-8, atol=1e-6)
    return TraversabilityReport(
        thresholds=thresholds,
        interval_slope_deg=slopes,
        interval_bands=levels,
        interval_lengths_m=lengths,
        band_distances_m=bands,
        total_m=float(d[-1] - d[0]),
    )
