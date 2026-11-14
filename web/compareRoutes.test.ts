import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareRoutes } from './compareRoutes.ts'

function route(bands = ['steep', 'gentle']) {
  return {
    crs_wkt: 'Mars',
    dem_sample_step_max_m: 20,
    waypoints: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
    route_metrics: {
      distance_m: 20, total_ascent_m: 3, max_measured_abs_slope_deg: 17,
    },
    experimental_traversability: {
      thresholds_deg: { gentle_max_deg: 5, moderate_max_deg: 10, steep_max_deg: 15 },
      intervals: bands.map(band => ({ band, distance_m: 10 })),
    },
  }
}

test('reports measured steep intervals, unknown distance and signed changes', () => {
  const { rows, coverage, demVerified } = compareRoutes(route(), route(['unknown', 'gentle']))
  assert.deepEqual(rows.map(row => row.delta), [0, 0, 0, -1, -10, 10])
  assert.deepEqual(coverage, { direct: 100, detour: 50, partial: true })
  assert.equal(demVerified, false)
})

test('rejects mismatched endpoints, settings and invalid exports', () => {
  assert.throws(() => compareRoutes(route(), { ...route(), dem_sample_step_max_m: 10 }), /шага/)
  assert.throws(() => compareRoutes(route(), { ...route(), waypoints: [{ x: 1, y: 0 }, { x: 20, y: 0 }] }), /точки/)
  assert.throws(() => compareRoutes(route(), {}), /формат/)
})

test('keeps unmeasured steepness unknown', () => {
  const unmeasured = route(['unknown', 'unknown'])
  const { rows } = compareRoutes(route(), {
    ...unmeasured,
    route_metrics: { distance_m: 20, total_ascent_m: null, max_measured_abs_slope_deg: null },
  })
  assert.equal(rows[1].delta, null)
  assert.equal(rows[3].detour, null)
  assert.equal(rows[4].detour, null)
})

test('verifies matching DEM hashes and rejects different source rasters', () => {
  const direct = { ...route(), dem_sha256: 'a'.repeat(64) }
  assert.equal(compareRoutes(direct, direct).demVerified, true)
  assert.deepEqual(compareRoutes(direct, direct).coverage, { direct: 100, detour: 100, partial: false })
  assert.equal(compareRoutes(direct, route()).demVerified, false)
  assert.throws(() => compareRoutes(direct, { ...route(), dem_sha256: 'b'.repeat(64) }), /разным DEM/)
  assert.throws(() => compareRoutes(direct, { ...route(), dem_sha256: '' }), /SHA-256/)
})
