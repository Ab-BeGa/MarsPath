import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sampleRouteElevation, nearestProfileSample, selectedProfileInterval,
  type ProjectedPoint,
} from './routeProfile.ts'

const route: ProjectedPoint[] = [
  { x: 4000000, y: 1000000 },
  { x: 4000040, y: 1000000 },
  { x: 4000040, y: 1000030 },
]

test('samples all segments at <=20m, without duplicating the turning waypoint', () => {
  const profile = sampleRouteElevation(route, 20, p => ({ elevation_m: p.x - 4000000, status: 'valid' }))
  assert.deepEqual(profile.samples.map(s => s.distance_m), [0, 20, 40, 55, 70])
  assert.equal(profile.samples.length, 5)
  assert.equal(profile.samples[2].x, 4000040)
  assert.equal(profile.samples[2].y, 1000000)
  assert.equal(profile.samples[3].y, 1000015)
  assert.equal(profile.total_m, 70)
})

test('uses measured cell readings, not elevation interpolation between endpoints', () => {
  const profile = sampleRouteElevation([{ x: 0, y: 0 }, { x: 40, y: 0 }], 20, p => ({
    elevation_m: p.x === 20 ? -2500 : -2600, status: 'valid',
  }))
  assert.deepEqual(profile.samples.map(s => s.elevation_m), [-2600, -2500, -2600])
})

test('keeps NoData and outside-ROI samples unknown, never zero-height', () => {
  const profile = sampleRouteElevation([{ x: 0, y: 0 }, { x: 60, y: 0 }], 20, p => {
    if (p.x === 20) return { elevation_m: null, status: 'nodata' }
    if (p.x === 40) return { elevation_m: null, status: 'outside_roi' }
    return { elevation_m: -2530, status: 'valid' }
  })
  assert.equal(profile.valid_count, 2)
  assert.deepEqual(profile.samples.map(s => s.status), ['valid', 'nodata', 'outside_roi', 'valid'])
  assert.equal(profile.samples[1].elevation_m, null)
})

test('selects measured sample nearest to horizontal route distance', () => {
  const profile = sampleRouteElevation([{ x: 0, y: 0 }, { x: 60, y: 0 }], 20, () => ({
    elevation_m: -2500, status: 'valid',
  }))
  assert.equal(nearestProfileSample(profile, -30), 0)
  assert.equal(nearestProfileSample(profile, 11), 1)
  assert.equal(nearestProfileSample(profile, 50), 2) // tie -> earlier sample
  assert.equal(nearestProfileSample(profile, 200), 3)
  assert.deepEqual(selectedProfileInterval(profile, 0), {
    from: profile.samples[0], to: profile.samples[1],
  })
  assert.deepEqual(selectedProfileInterval(profile, 3), {
    from: profile.samples[2], to: profile.samples[3],
  })
})

test('rejects duplicated route vertices and invalid sampling parameters', () => {
  const read = () => ({ elevation_m: 0, status: 'valid' as const })
  assert.throws(() => sampleRouteElevation([{ x: 1, y: 2 }, { x: 1, y: 2 }], 20, read), /различаться/)
  assert.throws(() => sampleRouteElevation(route, 0, read), /положительным/)
  assert.throws(() => sampleRouteElevation([{ x: NaN, y: 0 }, { x: 1, y: 0 }], 20, read), /две точки/)
  assert.throws(() => sampleRouteElevation([{ x: 0, y: 0 }, { x: 2_000_000, y: 0 }], 20, read), /Слишком много/)
})

test('rejects fake valid elevations and made-up zero values for gaps', () => {
  const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }]
  assert.throws(() => sampleRouteElevation(points, 20, () => ({
    elevation_m: null, status: 'valid',
  })), /Несогласованные/)
  assert.throws(() => sampleRouteElevation(points, 20, () => ({
    elevation_m: 0, status: 'nodata',
  })), /Несогласованные/)
})
