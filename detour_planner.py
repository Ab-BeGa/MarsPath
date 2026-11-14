"""DEM-aware *experimental* detour planning using A* on the local Mars raster.

A* minimizes a configurable cost composed of horizontal distance and sampled
cell-to-cell slope. It is NOT proof of EVA safety: a 20 m DEM cannot resolve
individual rocks, cross-slope footing, regolith or spacesuit constraints.
"""
from __future__ import annotations

from dataclasses import dataclass
import heapq
import math
from typing import Sequence

import numpy as np
from affine import Affine


def _project(transform: Affine, col, row):
    """Apply a Mars DEM affine transform to scalars or arrays.

    Uses coefficients directly to avoid the deprecated Affine * tuple API
    while remaining compatible with Affine 2.x and 3.x.
    """
    return (transform.a * col + transform.b * row + transform.c,
            transform.d * col + transform.e * row + transform.f)


class NoDetourError(ValueError):
    """The selected ROI has no path satisfying the DEM and slope constraints."""


@dataclass(frozen=True)
class DetourPlan:
    waypoints_xy: np.ndarray
    cells_rc: np.ndarray
    grid_length_m: float
    total_cost: float
    grid_max_slope_deg: float
    nodes_expanded: int
    penalty_weight: float
    reference_slope_deg: float
    max_slope_deg: float | None

    def as_dict(self) -> dict:
        return {
            "algorithm": "A* on valid DEM cells with 8-neighbor transitions",
            "grid_length_m": self.grid_length_m,
            "path_cost": self.total_cost,
            "max_grid_edge_slope_deg": self.grid_max_slope_deg,
            "nodes_expanded": self.nodes_expanded,
            "grid_cells_on_path": int(len(self.cells_rc)),
            "waypoints_count": int(len(self.waypoints_xy)),
            "penalty_weight": self.penalty_weight,
            "reference_slope_deg": self.reference_slope_deg,
            "max_slope_deg": self.max_slope_deg,
            "limitations": "Planning on a 20 m DEM is experimental; a lower slope cost is not a verified safe traverse.",
        }


def plan_detour(
    elevations: np.ndarray,
    transform: Affine,
    start_xy: Sequence[float],
    goal_xy: Sequence[float],
    *,
    valid_mask: np.ndarray | None = None,
    roi_bounds: tuple[float, float, float, float] | None = None,
    meters_per_unit: float = 1.0,
    penalty_weight: float = 12.0,
    reference_slope_deg: float = 10.0,
    max_slope_deg: float | None = None,
) -> DetourPlan:
    """Plan a slope-aware alternative without crossing missing DEM cells.

    All positions/affine coefficients use the original *Mars projected* CRS;
    meters_per_unit converts its linear units. Grid centers are used for
    traversal, while the returned first/last coordinates remain exact.

    A hard slope cap is optional and applies to every grid transition.
    An admissible Euclidean heuristic is used because path cost >= distance.
    NoData is excluded, and diagonals cannot cut the corners of masked cells.
    """
    arr = np.ma.asarray(elevations, dtype=float)
    if arr.ndim != 2 or min(arr.shape) < 2:
        raise ValueError("A 2-D DEM containing at least two rows and columns is required")
    z = np.ma.filled(arr, np.nan)
    good = np.isfinite(z) & (~np.ma.getmaskarray(arr))
    if valid_mask is not None:
        mask = np.asarray(valid_mask, dtype=bool)
        if mask.shape != z.shape:
            raise ValueError("valid_mask must have exactly the shape of the DEM")
        good &= mask
    values = (meters_per_unit, penalty_weight, reference_slope_deg)
    if not all(np.isfinite(values)) or meters_per_unit <= 0 or penalty_weight < 0 or not (0 < reference_slope_deg < 90):
        raise ValueError("Invalid unit conversion or slope cost parameters")
    if max_slope_deg is not None and (not np.isfinite(max_slope_deg) or not (0 < max_slope_deg < 90)):
        raise ValueError("max_slope_deg must be strictly between 0 and 90")
    pts = np.asarray([start_xy, goal_xy], dtype=float)
    if pts.shape != (2, 2) or not np.isfinite(pts).all():
        raise ValueError("Start and goal must be finite projected XY points")
    if roi_bounds is not None:
        left, right, bottom, top = roi_bounds
        if not np.isfinite(roi_bounds).all() or left >= right or bottom >= top:
            raise ValueError("Invalid geographic ROI")
        rr, cc = np.indices(z.shape)
        xcent, ycent = _project(transform, cc + 0.5, rr + 0.5)
        good &= (xcent >= left) & (xcent <= right) & (ycent >= bottom) & (ycent <= top)
        if np.any((pts[:, 0] < left) | (pts[:, 0] > right) | (pts[:, 1] < bottom) | (pts[:, 1] > top)):
            raise NoDetourError("The fixed start or goal lies outside the study region")
    inverse = ~transform
    def to_cell(p):
        col, row = _project(inverse, float(p[0]), float(p[1]))
        return int(math.floor(row)), int(math.floor(col))
    start, goal = to_cell(pts[0]), to_cell(pts[1])
    height, width = z.shape
    for name, (r, c) in (("start", start), ("goal", goal)):
        if not (0 <= r < height and 0 <= c < width) or not good[r, c]:
            raise NoDetourError(f"{name} is on NoData or outside valid DEM cells")

    def xy(rc):
        r, c = rc
        return np.asarray(_project(transform, c + 0.5, r + 0.5), dtype=float)
    # Physical neighbor steps include affine rotation/skew and Mars map units.
    directions = ((-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1))
    step_dist = {
        (dr, dc): math.hypot(transform.a * dc + transform.b * dr, transform.d * dc + transform.e * dr) * meters_per_unit
        for dr, dc in directions
    }
    if min(step_dist.values()) <= 0:
        raise ValueError("Invalid DEM affine pixel spacing")

    def edge_grade(a, b, step):
        return math.degrees(math.atan(abs(float(z[b]) - float(z[a])) / step))

    g_cost = {start: 0.0}
    parent: dict[tuple[int, int], tuple[int, int]] = {}
    start_h = float(np.linalg.norm(xy(start) - xy(goal))) * meters_per_unit
    heap = [(start_h, 0.0, start)]
    expanded = 0
    while heap:
        _, actual, curr = heapq.heappop(heap)
        if actual > g_cost.get(curr, math.inf) + 1e-9:
            continue
        expanded += 1
        if curr == goal:
            break
        r, c = curr
        for dr, dc in directions:
            nbr = (r + dr, c + dc)
            nr, nc = nbr
            if nr < 0 or nc < 0 or nr >= height or nc >= width or not good[nr, nc]:
                continue
            # Never sneak across the corner of two masked/forbidden cells.
            if dr and dc and (not good[r + dr, c] or not good[r, c + dc]):
                continue
            step = step_dist[(dr, dc)]
            angle = edge_grade(curr, nbr, step)
            if max_slope_deg is not None and angle > max_slope_deg + 1e-10:
                continue
            if max_slope_deg is not None and dr and dc:
                # Prevent diagonals from jumping over two steep cardinal exits.
                side_a = (r + dr, c)
                side_b = (r, c + dc)
                if (edge_grade(curr, side_a, step_dist[(dr, 0)]) > max_slope_deg + 1e-10
                    or edge_grade(curr, side_b, step_dist[(0, dc)]) > max_slope_deg + 1e-10):
                    continue
            candidate = actual + step * (1.0 + penalty_weight * (angle / reference_slope_deg) ** 2)
            if candidate + 1e-9 < g_cost.get(nbr, math.inf):
                g_cost[nbr] = candidate
                parent[nbr] = curr
                heuristic = float(np.linalg.norm(xy(nbr) - xy(goal))) * meters_per_unit
                heapq.heappush(heap, (candidate + heuristic, candidate, nbr))
    if goal not in g_cost:
        raise NoDetourError("No route exists for the selected ROI and constraints; relax the cap or choose new endpoints")

    path = [goal]
    while path[-1] != start:
        path.append(parent[path[-1]])
    path.reverse()
    cells = np.asarray(path, dtype=int)
    distance = 0.0
    maximum = 0.0
    for a, b in zip(path[:-1], path[1:]):
        step = step_dist[(b[0] - a[0], b[1] - a[1])]
        distance += step
        maximum = max(maximum, edge_grade(a, b, step))
    # Preserve only turning points: simplify *collinear grid steps only*.
    # This cannot cut over an unverified cell or change the original grid path.
    kept = [0]
    last_dir = None
    for k in range(1, len(path)):
        cur_dir = (path[k][0] - path[k-1][0], path[k][1] - path[k-1][1])
        if last_dir is not None and cur_dir != last_dir:
            kept.append(k-1)
        last_dir = cur_dir
    if len(path) > 1:
        kept.append(len(path)-1)
    kept = list(dict.fromkeys(kept))
    centers = np.asarray([xy(path[k]) for k in kept])
    route = [pts[0]]
    for center in centers:
        if np.linalg.norm(center - route[-1]) * meters_per_unit > 0.1:
            route.append(center)
    if np.linalg.norm(pts[-1] - route[-1]) * meters_per_unit > 0.1:
        route.append(pts[-1])
    else:
        route[-1] = pts[-1]
    route[0] = pts[0]
    route[-1] = pts[-1]
    if len(route) < 2 or np.any(np.linalg.norm(np.diff(route, axis=0), axis=1) < 1e-7):
        raise NoDetourError("No nondegenerate detour path can be constructed")
    return DetourPlan(
        waypoints_xy=np.asarray(route), cells_rc=cells, grid_length_m=distance,
        total_cost=float(g_cost[goal]), grid_max_slope_deg=maximum,
        nodes_expanded=expanded, penalty_weight=penalty_weight,
        reference_slope_deg=reference_slope_deg, max_slope_deg=max_slope_deg,
    )
