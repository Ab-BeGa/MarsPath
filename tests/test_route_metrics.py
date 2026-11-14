"""Scientific guardrails for Jezero Traverse Task #9 route statistics."""
import unittest
import numpy as np
from route_geometry import route_samples
from route_metrics import calculate_route_metrics


def metric_from_elevations(heights, *, distance=20, statuses=None):
    height_array = np.asarray(heights, dtype=float)
    waypoints = [[0, 0], [(len(height_array) - 1) * distance, 0]]
    def sampler(xy):
        if statuses is None:
            return height_array
        return height_array, np.asarray(statuses)
    return calculate_route_metrics(route_samples(waypoints, sampler, step_m=distance))


class RouteMetricsTests(unittest.TestCase):
    def test_ascent_descent_and_steepest_measured_interval(self):
        m = metric_from_elevations([-2540, -2530, -2535, -2515])
        self.assertEqual(m.distance_m, 60)
        self.assertEqual(m.ascent_m, 30)
        self.assertEqual(m.descent_m, 5)
        self.assertEqual(m.net_change_m, 25)
        self.assertAlmostEqual(m.max_slope_deg, 45)
        self.assertEqual((m.max_slope_start_m, m.max_slope_end_m), (40, 60))
        self.assertEqual(m.analyzed_pct, 100)
        self.assertFalse(m.has_gaps)

    def test_downhill_and_constant_paths(self):
        down = metric_from_elevations([-200, -220, -250])
        self.assertEqual(down.ascent_m, 0)
        self.assertEqual(down.descent_m, 50)
        self.assertEqual(down.net_change_m, -50)
        self.assertAlmostEqual(down.max_slope_deg, np.degrees(np.arctan(30/20)))
        flat = metric_from_elevations([-100] * 4)
        self.assertEqual(flat.max_slope_deg, 0)
        self.assertEqual(flat.descent_m, 0)
        self.assertEqual(flat.ascent_m, 0)

    def test_nodata_gaps_are_not_bridged_or_falsely_counted(self):
        m = metric_from_elevations([0, 10, np.nan, 50, 60], statuses=["valid", "valid", "nodata", "valid", "valid"])
        self.assertEqual(m.ascent_m, 20)
        self.assertEqual(m.descent_m, 0)
        self.assertEqual(m.net_change_m, 60)
        self.assertEqual(m.valid_edges, 2)
        self.assertEqual(m.total_edges, 4)
        self.assertEqual(m.analyzed_pct, 50)
        self.assertTrue(m.has_gaps)
        self.assertTrue(m.to_dict()["partial_due_to_missing_dem"])

    def test_no_valid_adjacent_pair_displays_unavailable(self):
        m = metric_from_elevations([0, np.nan, 40])
        self.assertIsNone(m.ascent_m)
        self.assertIsNone(m.descent_m)
        self.assertIsNone(m.max_slope_deg)
        self.assertEqual(m.analyzed_distance_m, 0)
        self.assertEqual(m.analyzed_pct, 0)
        self.assertEqual(m.net_change_m, 40)

    def test_analyzed_distance_counts_short_uneven_turn_segments(self):
        profile = route_samples([[0, 0], [11, 0], [11, 7]], lambda xy: [1, 2, 3], step_m=20)
        m = calculate_route_metrics(profile)
        self.assertEqual(m.distance_m, 18)
        self.assertEqual(m.analyzed_distance_m, 18)
        self.assertEqual(m.ascent_m, 2)
        self.assertAlmostEqual(m.max_slope_deg, np.degrees(np.arctan(1/7)))

    def test_json_contract_is_serializable(self):
        import json
        result = metric_from_elevations([0, 5, 0]).to_dict()
        self.assertEqual(json.loads(json.dumps(result))["total_ascent_m"], 5)

    def test_reject_malformed_profile(self):
        from route_geometry import RouteProfile
        p = RouteProfile(xy=np.zeros((3, 2)), distance_m=np.array([0, 20, 20]),
                         elevation_m=np.array([0, 1, 2]), waypoint_distance_m=np.array([0, 20]),
                         sample_status=np.array(["valid"]*3))
        with self.assertRaisesRegex(ValueError, "strictly increasing"):
            calculate_route_metrics(p)


if __name__ == "__main__":
    unittest.main()
