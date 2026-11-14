"""Independent graph-theoretic verification of the Jezero A* planner.

Dijkstra is deliberately implemented without calling the production A* search
or its neighbor-cost implementation. Synthetic grids do not establish EVA safety.
"""
from __future__ import annotations

import heapq
import math
import unittest

import numpy as np
from affine import Affine
from detour_planner import NoDetourError, plan_detour


def cell_xy(transform: Affine, row: int, col: int) -> tuple[float, float]:
    return transform * (col + 0.5, row + 0.5)


def dijkstra_cost(
    elevations: np.ndarray,
    transform: Affine,
    start: tuple[int, int],
    goal: tuple[int, int],
    *,
    penalty: float,
    ref_slope: float,
    max_grade: float | None = None,
    valid_mask: np.ndarray | None = None,
    units: float = 1.0,
) -> float | None:
    """Independent uniform-cost search on the same 8-neighbor grid model."""
    heights = np.asarray(elevations, dtype=float)
    good = np.isfinite(heights)
    if valid_mask is not None:
        good &= valid_mask
    moves = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]

    def edge_length(dr: int, dc: int) -> float:
        x1, y1 = cell_xy(transform, 0, 0)
        x2, y2 = cell_xy(transform, dr, dc)
        return math.hypot(x2-x1, y2-y1) * units

    def grade(a: tuple[int, int], b: tuple[int, int]) -> float:
        dist = edge_length(b[0]-a[0], b[1]-a[1])
        return math.degrees(math.atan2(abs(float(heights[b])-float(heights[a])), dist))

    queue = [(0.0, start)]
    best = {start: 0.0}
    while queue:
        dist, u = heapq.heappop(queue)
        if dist > best[u] + 1e-9:
            continue
        if u == goal:
            return dist
        for dr, dc in moves:
            v = (u[0]+dr, u[1]+dc)
            if not (0 <= v[0] < heights.shape[0] and 0 <= v[1] < heights.shape[1]):
                continue
            if not good[v]:
                continue
            if dr and dc and (not good[u[0]+dr, u[1]] or not good[u[0], u[1]+dc]):
                continue
            g = grade(u, v)
            if max_grade is not None and g > max_grade + 1e-10:
                continue
            if max_grade is not None and dr and dc:
                if (grade(u, (u[0]+dr, u[1])) > max_grade + 1e-10 or
                    grade(u, (u[0], u[1]+dc)) > max_grade + 1e-10):
                    continue
            step = edge_length(dr, dc)
            total = dist + step * (1 + penalty * (g/ref_slope)**2)
            if total + 1e-9 < best.get(v, math.inf):
                best[v] = total
                heapq.heappush(queue, (total, v))
    return None


class AStarOptimalityTests(unittest.TestCase):
    def test_matches_independent_dijkstra_on_seeded_terrain(self):
        transform = Affine(20, 0, 100, 0, -20, 800)
        for seed in range(8):
            rng = np.random.default_rng(seed)
            heights = rng.normal(loc=-2500, scale=5, size=(7, 7))
            missing = rng.random((7, 7)) < 0.13
            missing[0, 0] = missing[6, 6] = False
            heights[missing] = np.nan
            start, finish = (0, 0), (6, 6)
            for penalty in (0.0, 2.0, 12.0):
                reference = dijkstra_cost(heights, transform, start, finish,
                                          penalty=penalty, ref_slope=10.0)
                if reference is None:
                    with self.assertRaises(NoDetourError):
                        plan_detour(heights, transform, cell_xy(transform, *start),
                                    cell_xy(transform, *finish), penalty_weight=penalty)
                else:
                    actual = plan_detour(heights, transform, cell_xy(transform, *start),
                                         cell_xy(transform, *finish), penalty_weight=penalty)
                    self.assertAlmostEqual(reference, actual.total_cost, places=7,
                                           msg=f"seed={seed}, penalty={penalty}")
                    np.testing.assert_allclose(actual.waypoints_xy[0], cell_xy(transform, *start))
                    np.testing.assert_allclose(actual.waypoints_xy[-1], cell_xy(transform, *finish))

    def test_matches_dijkstra_with_hard_grade_cap(self):
        transform = Affine(15, 0, 0, 0, -25, 200)
        heights = np.zeros((8, 8))
        heights[2:6, 3] = 6.0
        start, end = (3, 0), (3, 7)
        for cap in (5.0, 15.0, 30.0):
            oracle = dijkstra_cost(heights, transform, start, end,
                                  penalty=4.0, ref_slope=10.0, max_grade=cap)
            if oracle is None:
                with self.assertRaises(NoDetourError):
                    plan_detour(heights, transform, cell_xy(transform, *start),
                                cell_xy(transform, *end),
                                penalty_weight=4, max_slope_deg=cap)
            else:
                route = plan_detour(heights, transform, cell_xy(transform, *start),
                                    cell_xy(transform, *end),
                                    penalty_weight=4, max_slope_deg=cap)
                self.assertAlmostEqual(oracle, route.total_cost, places=7)
                self.assertLessEqual(route.grid_max_slope_deg, cap + 1e-9)

    def test_cost_reconstruction_and_valid_cell_adjacency(self):
        transform = Affine(17, 2, 100, -1, -18, 280)
        rng = np.random.default_rng(109)
        heights = rng.normal(-2520, 4, size=(9, 9))
        heights[3:7, 4] = np.nan
        route = plan_detour(heights, transform, cell_xy(transform, 4, 1),
                            cell_xy(transform, 4, 7),
                            penalty_weight=3.0, reference_slope_deg=9.0,
                            meters_per_unit=1.5)
        cost = distance_total = maximum = 0.0
        for a, b in zip(route.cells_rc[:-1], route.cells_rc[1:]):
            a, b = tuple(a), tuple(b)
            self.assertTrue(np.isfinite(heights[a]) and np.isfinite(heights[b]))
            dr, dc = b[0]-a[0], b[1]-a[1]
            self.assertLessEqual(max(abs(dr), abs(dc)), 1)
            if dr and dc:
                self.assertTrue(np.isfinite(heights[a[0]+dr, a[1]]))
                self.assertTrue(np.isfinite(heights[a[0], a[1]+dc]))
            p1, p2 = cell_xy(transform, *a), cell_xy(transform, *b)
            d = math.dist(p1, p2) * 1.5
            angle = math.degrees(math.atan2(abs(heights[b]-heights[a]), d))
            distance_total += d
            cost += d * (1 + 3 * (angle/9)**2)
            maximum = max(maximum, angle)
        self.assertAlmostEqual(route.total_cost, cost, places=7)
        self.assertAlmostEqual(route.grid_length_m, distance_total, places=7)
        self.assertAlmostEqual(route.grid_max_slope_deg, maximum, places=7)

    def test_elevation_penalty_changes_selected_route(self):
        transform = Affine(20, 0, 0, 0, -20, 240)
        heights = np.zeros((12, 12))
        heights[4:9, 5] = 30.0
        start, end = cell_xy(transform, 6, 1), cell_xy(transform, 6, 10)
        shortest = plan_detour(heights, transform, start, end, penalty_weight=0)
        slope_aware = plan_detour(heights, transform, start, end, penalty_weight=12)
        self.assertLess(shortest.grid_length_m, slope_aware.grid_length_m)
        self.assertLess(slope_aware.grid_max_slope_deg, shortest.grid_max_slope_deg)

    def test_output_is_repeatable(self):
        transform = Affine(20, 0, 0, 0, -20, 180)
        heights = np.zeros((9, 9))
        heights[4, 4] = np.nan
        outputs = [
            plan_detour(heights, transform, cell_xy(transform, 4, 1),
                        cell_xy(transform, 4, 7))
            for _ in range(3)
        ]
        for later in outputs[1:]:
            np.testing.assert_array_equal(outputs[0].cells_rc, later.cells_rc)
            np.testing.assert_array_equal(outputs[0].waypoints_xy, later.waypoints_xy)
            self.assertEqual(outputs[0].total_cost, later.total_cost)


if __name__ == "__main__":
    unittest.main()
