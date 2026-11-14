"""Geometry and elevation sampling for Jezero Traverse.

All XY coordinates use the projected DEM CRS. Distances are converted from
its linear units to meters; no Earth/WGS84 assumptions are made.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

import numpy as np


@dataclass(frozen=True)
class RouteProfile:
    xy: np.ndarray
    distance_m: np.ndarray
    elevation_m: np.ndarray
    waypoint_distance_m: np.ndarray
    sample_status: np.ndarray

    @property
    def missing_count(self) -> int:
        return int(np.count_nonzero(self.sample_status != "valid"))

    @property
    def status_counts(self) -> dict[str, int]:
        labels, counts = np.unique(self.sample_status, return_counts=True)
        return {str(label): int(count) for label, count in zip(labels, counts)}

    @property
    def max_sample_spacing_m(self) -> float:
        return float(np.max(np.diff(self.distance_m))) if len(self.distance_m) > 1 else 0.0

    @property
    def total_m(self) -> float:
        return float(self.distance_m[-1]) if len(self.distance_m) else 0.0

    @property
    def coverage_pct(self) -> float:
        return 100.0 * float(np.isfinite(self.elevation_m).mean()) if self.elevation_m.size else 0.0


def route_samples(
    waypoints_xy: Sequence[Sequence[float]],
    sample_elevations: Callable[[np.ndarray], np.ndarray | tuple[np.ndarray, np.ndarray]],
    *,
    meters_per_unit: float = 1.0,
    step_m: float = 20.0,
) -> RouteProfile:
    """Sample joined segments without duplicating interior vertices.

    The last point of every segment is sampled; intervals never exceed step_m.
    A repeated consecutive waypoint is invalid rather than silently accepted.
    """
    points = np.asarray(waypoints_xy, dtype=float)
    if points.ndim != 2 or points.shape[1] != 2 or len(points) < 2:
        raise ValueError("At least two XY waypoints are required")
    if not np.isfinite(points).all():
        raise ValueError("Waypoints must be finite")
    if not np.isfinite(meters_per_unit) or meters_per_unit <= 0:
        raise ValueError("Invalid linear CRS unit conversion")
    if not np.isfinite(step_m) or step_m <= 0:
        raise ValueError("Sample step must be positive")

    segment_lengths = np.linalg.norm(np.diff(points, axis=0), axis=1) * meters_per_unit
    if np.any(segment_lengths <= 1e-8):
        raise ValueError("Consecutive waypoints must differ")

    samples = [points[0][None, :]]
    distances = [np.array([0.0])]
    waypoint_distances = np.r_[0.0, np.cumsum(segment_lengths)]
    for index, length in enumerate(segment_lengths):
        count = max(1, int(np.ceil(length / step_m)))
        t = np.linspace(0, 1, count + 1)[1:]
        samples.append(points[index][None, :] + t[:, None] * (points[index + 1] - points[index])[None, :])
        distances.append(waypoint_distances[index] + t * length)

    xy = np.concatenate(samples, axis=0)
    distance = np.concatenate(distances)
    sampled = sample_elevations(xy)
    if isinstance(sampled, tuple):
        if len(sampled) != 2:
            raise ValueError("Sampler must return elevations or (elevations, statuses)")
        heights_raw, statuses_raw = sampled
        statuses = np.asarray(statuses_raw, dtype=str).reshape(-1)
    else:
        heights_raw = sampled
        statuses = None
    heights = np.asarray(heights_raw, dtype=float).reshape(-1)
    if len(heights) != len(xy):
        raise ValueError("Elevation sampler returned an unexpected number of values")
    if statuses is None:
        statuses = np.where(np.isfinite(heights), "valid", "nodata")
    if len(statuses) != len(xy):
        raise ValueError("Status sampler returned an unexpected number of values")
    allowed = {"valid", "nodata", "outside_roi", "outside_dem", "invalid_xy"}
    if not set(statuses).issubset(allowed):
        raise ValueError("Unexpected DEM sample status")
    if np.any((statuses == "valid") != np.isfinite(heights)):
        raise ValueError("Elevation finite/NoData status mismatch")
    return RouteProfile(xy=xy, distance_m=distance, elevation_m=heights,
                        waypoint_distance_m=waypoint_distances, sample_status=statuses)


def nearest_segment_index(point_xy: Sequence[float], waypoints_xy: Sequence[Sequence[float]]) -> int:
    """Find closest polyline segment to an added waypoint in projected XY units."""
    p = np.asarray(point_xy, dtype=float)
    pts = np.asarray(waypoints_xy, dtype=float)
    if p.shape != (2,) or pts.ndim != 2 or len(pts) < 2:
        raise ValueError("Expected a point and a route with >=2 vertices")
    a, b = pts[:-1], pts[1:]
    ab = b - a
    length_sq = (ab * ab).sum(axis=1)
    t = np.clip(np.divide(((p - a) * ab).sum(axis=1), length_sq,
                          out=np.zeros_like(length_sq), where=length_sq > 0), 0, 1)
    closest = a + t[:, None] * ab
    return int(np.argmin(((closest - p) ** 2).sum(axis=1)))
