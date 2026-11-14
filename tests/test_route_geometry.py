import unittest
import numpy as np
from route_geometry import route_samples, nearest_segment_index

class GeometryTests(unittest.TestCase):
    def test_l_shaped_route_exact_spacing(self):
        pts = np.array([[0.,0.],[40.,0.],[40.,30.]])
        p=route_samples(pts, lambda xy:xy[:,0]+xy[:,1], step_m=20)
        self.assertEqual(len(p.xy), 5)
        np.testing.assert_allclose(p.distance_m,[0,20,40,55,70])
        np.testing.assert_allclose(p.elevation_m,[0,20,40,55,70])
        np.testing.assert_allclose(p.waypoint_distance_m,[0,40,70])
        self.assertAlmostEqual(p.total_m,70)
    def test_no_duplicate_endpoint_at_join(self):
        p=route_samples([[0,0],[10,0],[20,0]],lambda xy:np.zeros(len(xy)),step_m=20)
        self.assertEqual(len(p.xy),3)
        np.testing.assert_allclose(p.xy,[[0,0],[10,0],[20,0]])
    def test_nearest_segment(self):
        self.assertEqual(nearest_segment_index([8,2],[[0,0],[10,0],[10,10]]),0)
        self.assertEqual(nearest_segment_index([12,9],[[0,0],[10,0],[10,10]]),1)
    def test_reject_duplicates(self):
        with self.assertRaises(ValueError):
            route_samples([[0,0],[0,0]],lambda xy:np.zeros(len(xy)))
    def test_missing_elevation(self):
        p=route_samples([[0,0],[40,0]],lambda xy:np.array([1,np.nan,3]),step_m=20)
        self.assertAlmostEqual(p.coverage_pct,200/3)

if __name__=='__main__':unittest.main()
