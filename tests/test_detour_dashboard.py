"""Task 13: reproducible GUI + JSON checks on a synthetic Mars 20 m DEM."""
import json
import tempfile
import unittest
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin

from profile_mars import RouteEditor, Terrain
from detour_planner import NoDetourError

ROOT = Path(__file__).resolve().parents[1]
MARS_WKT = ('PROJCS["Jezero_Crater_Projection",GEOGCS["GCS_Mars_2000_Sphere",'
            'DATUM["Mars_2000_(Sphere)",SPHEROID["Mars_2000_Sphere",3396190,0]],'
            'PRIMEM["Reference_Meridian",0],UNIT["degree",0.0174532925199433]],'
            'PROJECTION["Equirectangular"],PARAMETER["standard_parallel_1",18.4663],'
            'PARAMETER["central_meridian",0],UNIT["metre",1]]')

class DetourDashboardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.output = Path(self.temp.name)
        path=self.output/'mars_dem.tif'
        rows, cols = np.mgrid[0:200,0:200]
        heights=(-2540+0.13*rows+0.16*cols+4*np.sin(cols/7.0)).astype('float32')
        with rasterio.open(path,'w',driver='GTiff',width=200,height=200,count=1,dtype='float32',nodata=-9999,
                           transform=from_origin(4_350_000,1_096_000,20,20),crs=CRS.from_wkt(MARS_WKT)) as ds:
            ds.write(heights,1)
        self.terrain = Terrain(path,ROOT/'jezero_site_selection/site_config.json')
        self.editor=RouteEditor(self.terrain,output=self.output)

    def tearDown(self):
        plt.close('all')
        self.terrain.close()
        self.temp.cleanup()

    def test_one_click_builds_different_waypoints_with_same_endpoints(self):
        e=self.editor
        straight=e.route_metrics.distance_m
        self.assertTrue(e.auto_detour())
        np.testing.assert_allclose(e.waypoints[[0,-1]],e.terrain.fixed_points)
        self.assertGreater(len(e.waypoints),2)
        self.assertGreater(e.route_metrics.distance_m,straight)
        self.assertAlmostEqual(e.traversability.unknown_m,0)
        self.assertIsNotNone(e.detour_plan)
        self.assertIsNotNone(e.detour_reference)
        e.export()
        data=json.loads((self.output/'route_waypoints.json').read_text())
        self.assertIsNotNone(data['detour_planning'])
        self.assertAlmostEqual(data['detour_planning']['reference_direct_route_length_m'],straight)
        self.assertEqual(len(data['waypoints']),len(e.waypoints))
        self.assertAlmostEqual(data['route_metrics']['distance_m'],e.route_metrics.distance_m)
        self.assertTrue((self.output/'route_traversability.csv').exists())

    def test_undo_and_reset_restore_original_route_without_stale_plan(self):
        e=self.editor
        self.assertTrue(e.auto_detour())
        e.undo()
        self.assertEqual(len(e.waypoints),2)
        self.assertIsNone(e.detour_plan)
        self.assertTrue(e.auto_detour())
        e.reset()
        self.assertIsNone(e.detour_plan)
        np.testing.assert_allclose(e.waypoints,e.terrain.fixed_points)

    def test_unreachable_grade_cap_leaves_user_route_unchanged(self):
        e=self.editor
        original=e.waypoints.copy()
        e.detour_max_grade=0.01
        self.assertFalse(e.auto_detour())
        self.assertIsNone(e.detour_plan)
        np.testing.assert_allclose(original,e.waypoints)
        self.assertIn('FAILED',e.status_text.get_text())

    def test_load_previously_exported_route(self):
        e=self.editor
        self.assertTrue(e.auto_detour())
        exported=e.waypoints.copy()
        e.export()
        e.reset()
        e.load(self.output/'route_waypoints.json')
        np.testing.assert_allclose(exported,e.waypoints)
        self.assertIsNone(e.detour_plan)  # loaded path is editable; planning provenance not reasserted

if __name__=='__main__': unittest.main()
