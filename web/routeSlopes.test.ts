import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifySlope, measureRouteSlope, validateSlopeThresholds } from './routeSlopes.ts'
import type { MarsTerrain } from './marsTerrain.ts'

/* North-up synthetic 20 m Mars DEM. No interpolation across masked cells. */
function terrain(heights: number[], mask?: number[], width = heights.length): MarsTerrain {
  return {
    metadata: {
      coordinate_convention: { source_crs_sphere_radius_m: 3396190 },
      grid: {
        width,
        height: heights.length / width,
        transform: [20, 0, 100, 0, -20, 200],
      },
    },
    heights: Float32Array.from(heights),
    mask: Uint8Array.from(mask || heights.map(() => 1)),
  } as unknown as MarsTerrain
}
const xy = (col: number, row = 0) => ({ x: 100 + col * 20 + 10, y: 200 - row * 20 - 10 })

test('uses exact Python band boundaries, including flat and strict >15 degrees', () => {
  const t = { gentle_max_deg: 5, moderate_max_deg: 10, steep_max_deg: 15 }
  assert.equal(classifySlope(0, t), 'gentle')
  assert.equal(classifySlope(5, t), 'gentle')
  assert.equal(classifySlope(5.001, t), 'moderate')
  assert.equal(classifySlope(10, t), 'moderate')
  assert.equal(classifySlope(10.001, t), 'steep')
  assert.equal(classifySlope(15, t), 'steep')
  assert.equal(classifySlope(15.001, t), 'very_steep')
  assert.equal(classifySlope(null, t), 'unknown')
  assert.throws(() => classifySlope(Number.NaN, t), /Недопустимое/)
})

test('samples 20 m cells and computes atan(abs(dz)/horizontal distance)', () => {
  const t = terrain([-2500, -2500, -2496, -2485, -2485])
  const report = measureRouteSlope(t, [xy(0), xy(4)])
  assert.deepEqual(report.samples.map(s => s.distance_m), [0, 20, 40, 60, 80])
  assert.deepEqual(report.intervals.map(i => i.band), ['gentle', 'steep', 'very_steep', 'gentle'])
  assert.equal(report.distances_m.gentle, 40)
  assert.equal(report.distances_m.steep, 20)
  assert.equal(report.distances_m.very_steep, 20)
  assert.equal(report.difficult_m, 40)
  assert.equal(report.unknown_m, 0)
  assert.ok(Math.abs(report.intervals[1].grade_deg! - Math.atan(4/20)*180/Math.PI) < 1e-8)
})

test('unknown intervals next to NoData remain unknown, never false gentle', () => {
  const t = terrain([-2500, -2400, -2450, -2500], [1, 0, 1, 1])
  const result = measureRouteSlope(t, [xy(0), xy(3)])
  assert.deepEqual(result.intervals.map(i => i.band), ['unknown', 'unknown', 'very_steep'])
  assert.equal(result.unknown_m, 40)
  assert.equal(result.distances_m.gentle, 0)
  assert.equal(result.samples[1].status, 'nodata')
  assert.equal(result.samples[1].elevation_m, null)
})

test('points outside study area stay unknown instead of inventing DEM elevations', () => {
  const t = terrain([-2500, -2500, -2500])
  const r = measureRouteSlope(t, [xy(0), xy(4)])
  assert.equal(r.samples[4].status, 'outside_roi')
  assert.equal(r.intervals[3].band, 'unknown')
  assert.equal(r.unknown_m, 40)
})

test('routes with turns preserve projected distance and do not duplicate turning nodes', () => {
  const t = terrain(new Array(9).fill(-2500), undefined, 3)
  const r = measureRouteSlope(t, [xy(0, 0), xy(2, 0), xy(2, 2)])
  assert.equal(r.total_m, 80)
  assert.deepEqual(r.samples.map(s => s.distance_m), [0, 20, 40, 60, 80])
  assert.deepEqual(r.samples[2] && {x: r.samples[2].x, y: r.samples[2].y}, xy(2,0))
  assert.equal(r.difficult_m, 0)
})

test('changing thresholds only reclassifies the measured grades', () => {
  const t = terrain([-2500, -2498, -2496, -2494])
  const path = [xy(0), xy(3)]
  const normal = measureRouteSlope(t, path)
  const strict = measureRouteSlope(t, path, { gentle_max_deg: 3, moderate_max_deg: 4, steep_max_deg: 7 })
  assert.deepEqual(normal.intervals.map(i => i.band), ['moderate', 'moderate', 'moderate'])
  assert.deepEqual(strict.intervals.map(i => i.band), ['steep', 'steep', 'steep'])
  assert.equal(strict.total_m, normal.total_m)
  assert.deepEqual(strict.samples, normal.samples)
})

test('rejects bad thresholds, invalid coordinates and duplicate waypoints', () => {
  assert.throws(() => validateSlopeThresholds({ gentle_max_deg: 10, moderate_max_deg: 5, steep_max_deg: 15 }), /Пороги/)
  assert.throws(() => validateSlopeThresholds({ gentle_max_deg: 0, moderate_max_deg: 10, steep_max_deg: 15 }), /Пороги/)
  assert.throws(() => validateSlopeThresholds({ gentle_max_deg: 5, moderate_max_deg: 10, steep_max_deg: 90 }), /Пороги/)
  const t = terrain([-2500, -2500])
  assert.throws(() => measureRouteSlope(t, [xy(0), xy(1)], undefined, 25), /Шаг/)
  assert.throws(() => measureRouteSlope(t, [xy(0), xy(0)]), /должны отличаться/)
  assert.throws(() => measureRouteSlope(t, [xy(0), {x: NaN, y: 0}]), /корректные/)
})

test('a small configurable sampling step creates intermediate readings', () => {
  const t = terrain([-2500, -2490, -2480])
  const r = measureRouteSlope(t, [xy(0), xy(2)], undefined, 10)
  assert.equal(r.samples.length, 5)
  assert.ok(r.intervals.every(i => i.distance_m <= 10 + 1e-10))
  assert.equal(Math.round(Object.values(r.distances_m).reduce((a,b)=>a+b,0)), 40)
})
