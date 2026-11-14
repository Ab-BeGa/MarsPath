"""Route elevation statistics derived strictly from consecutive valid DEM samples.

All distances are horizontal along the projected Mars route (meters) and
heights come from the source USGS DEM (meters). An edge with either endpoint
missing is excluded from ascent, descent, and slope analysis: gaps are never
bridged, guessed, or interpolated. These are sample-scale metrics, NOT human
EVA safety thresholds or an assessment of traversability.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from route_geometry import RouteProfile


@dataclass(frozen=True)
class RouteMetrics:
    distance_m: float
    ascent_m: float | None
    descent_m: float | None
    net_change_m: float | None
    max_slope_deg: float | None
    max_slope_start_m: float | None
    max_slope_end_m: float | None
    analyzed_distance_m: float
    analyzed_pct: float
    valid_edges: int
    total_edges: int
    has_gaps: bool

    def to_dict(self) -> dict:
        return {
            "distance_m": self.distance_m,
            "total_ascent_m": self.ascent_m,
            "total_descent_m": self.descent_m,
            "net_elevation_change_m": self.net_change_m,
            "max_measured_abs_slope_deg": self.max_slope_deg,
            "max_slope_interval_start_m": self.max_slope_start_m,
            "max_slope_interval_end_m": self.max_slope_end_m,
            "analyzed_distance_m": self.analyzed_distance_m,
            "analyzed_distance_percent": self.analyzed_pct,
            "valid_intervals": self.valid_edges,
            "total_intervals": self.total_edges,
            "partial_due_to_missing_dem": self.has_gaps,
            "method": "Consecutive original-DEM samples; missing intervals omitted; slope = atan(abs(dz)/horizontal_distance)",
            "limitations": "Measured at roughly 20 m DEM scale. Not a certified safe route or mobility limit.",
        }


def calculate_route_metrics(profile: RouteProfile) -> RouteMetrics:
    """Compute gain, loss and steepest observed sampled interval.

    Ascent and descent are nonnegative; 'net' is only reported when both
    endpoints are measured. If no consecutive valid pair exists, dependent
    statistics are None (not a misleading 0).
    """
    d = np.asarray(profile.distance_m, dtype=float)
    z = np.asarray(profile.elevation_m, dtype=float)
    s = np.asarray(profile.sample_status)
    if d.ndim != 1 or len(d) < 2 or z.shape != d.shape or s.shape != d.shape:
        raise ValueError("Profile requires aligned distance, elevation and status arrays of length >= 2")
    gaps = np.diff(d)
    if not np.isfinite(d).all() or not np.all(gaps > 0):
        raise ValueError("Route distances must be finite and strictly increasing")
    valid = (s == "valid") & np.isfinite(z)
    edge_valid = valid[:-1] & valid[1:]
    total = float(d[-1] - d[0])
    analyzed = float(np.sum(gaps[edge_valid]))
    pct = float(100.0 * analyzed / total)
    net = float(z[-1] - z[0]) if valid[0] and valid[-1] else None
    count = int(np.count_nonzero(edge_valid))
    if not count:
        return RouteMetrics(total, None, None, net, None, None, None,
                            0.0, 0.0, 0, len(gaps), True)
    dz = np.diff(z)[edge_valid]
    dd = gaps[edge_valid]
    ascent = float(np.maximum(dz, 0).sum())
    descent = float(np.maximum(-dz, 0).sum())
    slopes = np.rad2deg(np.arctan(np.abs(dz) / dd))
    winner = int(np.argmax(slopes))
    source_idx = int(np.flatnonzero(edge_valid)[winner])
    return RouteMetrics(total, ascent, descent, net, float(slopes[winner]),
                        float(d[source_idx]), float(d[source_idx+1]),
                        analyzed, pct, count, len(gaps), count != len(gaps))
