import json
import math
import unittest
import numpy as np
from affine import Affine
from detour_planner import NoDetourError, plan_detour

T = Affine(20, 0, 0, 0, -20, 240)
def center(r,c): return T * (c+.5,r+.5)

class DetourTests(unittest.TestCase):
    def test_detours_around_nodata_wall(self):
        z = np.zeros((12, 12))
        z[2:10, 5] = np.nan
        a = center(6,1); b = center(6,10)
        p = plan_detour(z, T, a, b)
        self.assertTrue(np.array_equal(p.waypoints_xy[0], a))
        self.assertTrue(np.array_equal(p.waypoints_xy[-1], b))
        self.assertGreater(p.grid_length_m, 180)
        self.assertTrue(all(np.isfinite(z[tuple(rc)]) for rc in p.cells_rc))
        self.assertFalse(any(rc[1] == 5 and 2 <= rc[0] < 10 for rc in p.cells_rc))
        self.assertGreater(p.nodes_expanded, 1)
        json.dumps(p.as_dict(), allow_nan=False)

    def test_soft_cost_avoids_ridge_when_cheap_flat_detour_exists(self):
        z = np.zeros((15,15)); z[5:10, 7] = 50
        a = center(7, 1); b = center(7, 13)
        p = plan_detour(z, T, a, b, penalty_weight=15)
        self.assertGreater(len(p.cells_rc), 12)
        self.assertEqual(p.grid_max_slope_deg, 0.0)
        self.assertGreater(p.grid_length_m, 240)

    def test_optional_grade_cap_rejects_unavoidable_ridge(self):
        z = np.zeros((5,5)); z[:,2:] = 100
        a=center(2,0);b=center(2,4)
        with self.assertRaises(NoDetourError):
            plan_detour(z, T, a,b, max_slope_deg=10)
        self.assertGreater(plan_detour(z,T,a,b).grid_max_slope_deg,10)

    def test_no_diagonal_corner_cut(self):
        z=np.full((3,3),np.nan);z[0,0]=z[1,1]=0
        with self.assertRaises(NoDetourError):
            plan_detour(z,T,center(0,0),center(1,1))

    def test_cap_checks_diagonal_side_edges(self):
        z=np.zeros((3,3));z[0,1]=z[1,0]=100
        # No diagonal may cut across the two steep cardinal side edges.
        with self.assertRaises(NoDetourError):
            plan_detour(z,T,center(0,0),center(1,1),max_slope_deg=20)

    def test_roi_bounds_respected(self):
        z=np.zeros((12,12))
        # ROI restricts route to central 2 rows: an obstacle then becomes impassable.
        z[5:7,5]=np.nan
        with self.assertRaises(NoDetourError):
            plan_detour(z,T,center(5,1),center(5,10),roi_bounds=(0,240,100,140))

    def test_invalids_and_no_data_start(self):
        z=np.zeros((5,5));z[1,1]=np.nan
        with self.assertRaises(NoDetourError): plan_detour(z,T,center(1,1),center(4,4))
        with self.assertRaises(ValueError): plan_detour(z,T,center(0,0),center(4,4),penalty_weight=-2)
        with self.assertRaises(ValueError): plan_detour(z,T,center(0,0),center(4,4),max_slope_deg=90)
        with self.assertRaises(ValueError): plan_detour(z,T,center(0,0),center(4,4),valid_mask=np.ones((4,5),bool))
        with self.assertRaises(ValueError): plan_detour(z,T,(np.nan,0),center(4,4))

    def test_pixel_units_rotated_affine(self):
        transform=Affine(10,2,0,3,-8,100)
        z=np.zeros((5,5))
        start=transform*(.5,.5);goal=transform*(4.5,4.5)
        result=plan_detour(z,transform,start,goal, meters_per_unit=2)
        self.assertGreater(result.grid_length_m,0)
        self.assertEqual(result.grid_max_slope_deg,0)
        np.testing.assert_array_equal(result.waypoints_xy[0],start)
        np.testing.assert_array_equal(result.waypoints_xy[-1],goal)

if __name__=='__main__':unittest.main()
