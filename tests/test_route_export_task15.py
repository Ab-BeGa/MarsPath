"""Task 15: CSV and PNG route-profile export, using synthetic Mars DEM readings."""
from __future__ import annotations

import csv
import tempfile
import unittest
from pathlib import Path

import numpy as np

from route_geometry import RouteProfile
from traversability import analyze_traversability
from route_export import HEADERS, write_profile_csv, save_elevation_png


def make_profile(heights, statuses=None):
    z = np.asarray(heights, dtype=float)
    n = len(z)
    if statuses is None:
        statuses = np.where(np.isfinite(z), "valid", "nodata")
    return RouteProfile(
        xy=np.column_stack((np.arange(n, dtype=float) * 20, np.zeros(n))),
        distance_m=np.arange(n, dtype=float) * 20,
        elevation_m=z,
        waypoint_distance_m=np.array([0.0, (n-1) * 20.0]),
        sample_status=np.asarray(statuses),
    )


class ExportTask15Tests(unittest.TestCase):
    def export_csv(self, folder, profile):
        grades = analyze_traversability(profile).interval_slope_deg
        path = write_profile_csv(
            folder / "route_profile.csv", profile,
            latitude_n=np.linspace(18.4, 18.5, len(profile.distance_m)),
            longitude_e=np.linspace(77.4, 77.5, len(profile.distance_m)),
            interval_slope_deg=grades,
        )
        with path.open(encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))
        return rows, grades

    def test_csv_contains_slope_and_coordinates(self):
        with tempfile.TemporaryDirectory() as td:
            rows, _ = self.export_csv(Path(td), make_profile([0, 10, 10]))
            self.assertEqual(tuple(rows[0]), HEADERS)
            self.assertEqual(len(rows), 3)
            self.assertEqual(rows[0]["measured_slope_deg"], "")
            self.assertAlmostEqual(float(rows[1]["measured_slope_deg"]),
                                   float(np.degrees(np.arctan(10 / 20))), places=3)
            self.assertEqual(rows[2]["measured_slope_deg"], "0.000")
            self.assertEqual(rows[1]["latitude_n"], "18.45000000")
            self.assertEqual(rows[1]["longitude_e"], "77.45000000")
            self.assertEqual(rows[2]["distance_m"], "40.000")

    def test_downhill_slope_is_absolute_not_negative(self):
        with tempfile.TemporaryDirectory() as td:
            rows, _ = self.export_csv(Path(td), make_profile([20, 10]))
            self.assertEqual(rows[1]["measured_slope_deg"], "26.565")

    def test_nodata_never_appears_as_flat_slope(self):
        with tempfile.TemporaryDirectory() as td:
            rows, _ = self.export_csv(Path(td), make_profile([1, 2, np.nan, 4, 4]))
            self.assertEqual([r["measured_slope_deg"] for r in rows],
                             ["", "2.862", "", "", "0.000"])
            self.assertEqual(rows[2]["elevation_m"], "")
            self.assertEqual(rows[2]["dem_status"], "nodata")

    def test_bad_slopes_cannot_be_assigned_to_nodata_edge(self):
        p = make_profile([0, np.nan, 2])
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ValueError):
                write_profile_csv(Path(td) / "a.csv", p,
                                  latitude_n=[18, 18, 18], longitude_e=[77, 77, 77],
                                  interval_slope_deg=[1, np.nan])

    def test_png_is_a_real_image_and_no_height_gaps_are_joined(self):
        p = make_profile([10, 12, np.nan, 11, 12])
        grades = analyze_traversability(p).interval_slope_deg
        with tempfile.TemporaryDirectory() as td:
            path = save_elevation_png(Path(td) / "elevation_profile.png", p, grades)
            self.assertTrue(path.is_file())
            self.assertGreater(path.stat().st_size, 1000)
            self.assertEqual(path.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")

    def test_two_profiles_in_separate_folders_are_preserved(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            first, _ = self.export_csv(root / "direct", make_profile([0, 5]))
            second, _ = self.export_csv(root / "detour", make_profile([0, 0, 0]))
            self.assertEqual(len(first), 2)
            self.assertEqual(len(second), 3)
            self.assertTrue((root / "direct" / "route_profile.csv").exists())
            self.assertTrue((root / "detour" / "route_profile.csv").exists())

    def test_csv_rejects_incorrect_coordinate_lengths(self):
        p = make_profile([0, 5])
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(ValueError, "Geographic coordinates"):
                write_profile_csv(Path(td) / "a.csv", p,
                                  latitude_n=[18], longitude_e=[77, 77],
                                  interval_slope_deg=[10])


if __name__ == "__main__":
    unittest.main()
