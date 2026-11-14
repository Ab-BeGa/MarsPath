"""Task 11 terrain band calculations and scientific guardrail tests."""
from __future__ import annotations

import json
import unittest

import numpy as np

from route_geometry import route_samples
from traversability import BANDS, SlopeThresholds, analyze_traversability


class TraversabilityTests(unittest.TestCase):
    def test_threshold_boundaries_and_distances(self):
        heights = [0.0, 0.0, 20 * np.tan(np.deg2rad(7)),
                   20 * np.tan(np.deg2rad(7)) + 20 * np.tan(np.deg2rad(12)),
                   20 * np.tan(np.deg2rad(7)) + 20 * np.tan(np.deg2rad(12)) + 20 * np.tan(np.deg2rad(20))]
        p = route_samples([[0, 0], [80, 0]], lambda xy: np.array(heights), step_m=20)
        r = analyze_traversability(p)
        self.assertEqual(r.interval_bands.tolist(), list(BANDS[:4]))
        self.assertEqual(r.difficult_m, 40)
        self.assertEqual(r.measured_pct, 100)
        self.assertEqual(r.unknown_m, 0)
        self.assertAlmostEqual(sum(r.band_distances_m.values()), r.total_m)

    def test_custom_thresholds_reclassify_without_resampling(self):
        p = route_samples([[0, 0], [40, 0]], lambda xy: np.array([0, 4, 8]), step_m=20)
        r = analyze_traversability(p)
        self.assertEqual(r.interval_bands.tolist(), ["steep", "steep"])
        lowered = analyze_traversability(p, SlopeThresholds(10, 20, 30))
        self.assertEqual(lowered.interval_bands.tolist(), ["moderate", "moderate"])
        self.assertEqual(lowered.difficult_m, 0)

    def test_unknown_when_neighbor_is_nodata(self):
        p = route_samples([[0, 0], [80, 0]],
                          lambda xy: (np.array([0, 1, np.nan, 8, 9]),
                                      np.array(["valid", "valid", "nodata", "valid", "valid"])),
                          step_m=20)
        r = analyze_traversability(p)
        self.assertEqual(r.interval_bands.tolist(), ["gentle", "unknown", "unknown", "gentle"])
        self.assertEqual(r.unknown_m, 40)
        self.assertEqual(r.measured_pct, 50)
        self.assertIsNone(r.to_dict()["intervals"][1]["grade_deg"])
        self.assertNotIn("safe", r.interval_bands.tolist())
        json.dumps(r.to_dict(), allow_nan=False)

    def test_all_missing_is_unknown_not_falsely_gentle(self):
        p = route_samples([[0, 0], [40, 0]],
                          lambda xy: (np.full(3, np.nan), ["nodata"] * 3), step_m=20)
        r = analyze_traversability(p)
        self.assertEqual(r.band_distances_m["gentle"], 0)
        self.assertEqual(r.unknown_m, 40)
        self.assertEqual(r.measured_pct, 0)

    def test_threshold_validation(self):
        for values in [(0, 10, 15), (5, 5, 15), (10, 5, 20), (5, 10, 90), (5, 10, float("nan"))]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                SlopeThresholds(*values)

    def test_nonuniform_route_spacing(self):
        p = route_samples([[0, 0], [11, 0], [11, 7]],
                          lambda xy: np.array([0, 2, 3]), step_m=20)
        r = analyze_traversability(p)
        self.assertEqual(r.interval_lengths_m.tolist(), [11, 7])
        self.assertEqual(r.interval_bands.tolist(), ["steep", "moderate"])
        self.assertAlmostEqual(r.total_m, 18)

    def test_reject_non_increasing_distances(self):
        from route_geometry import RouteProfile
        p = RouteProfile(xy=np.zeros((3, 2)), distance_m=np.array([0, 20, 20]),
                         elevation_m=np.array([0, 1, 2]), waypoint_distance_m=np.array([0, 20]),
                         sample_status=np.array(["valid"] * 3))
        with self.assertRaisesRegex(ValueError, "increase strictly"):
            analyze_traversability(p)


if __name__ == '__main__':
    unittest.main()
