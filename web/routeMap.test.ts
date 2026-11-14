import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRouteMapGeometry } from './routeMap.ts'

const direct = [{ x: 4350000, y: 1093000 }, { x: 4350400, y: 1093400 }]
const detour = [direct[0], { x: 4350100, y: 1093600 }, direct[1]]

test('fits both polylines with common base and science markers', () => {
  const map = buildRouteMapGeometry(direct, detour)
  assert.deepEqual(map.base, map.direct[0])
  assert.deepEqual(map.science, map.detour.at(-1))
  assert.equal(map.detour.length, 3)
  for (const point of [...map.direct, ...map.detour]) {
    assert.ok(point.x >= 0 && point.x <= map.width)
    assert.ok(point.y >= 0 && point.y <= map.height)
  }
})

test('higher northings appear higher on SVG; no Earth WGS84 conversion', () => {
  const map = buildRouteMapGeometry(direct, detour)
  assert.ok(map.detour[1].y < map.direct[0].y)
  assert.ok(map.direct[1].x > map.direct[0].x)
})

test('rejects missing vertices and mismatched endpoints', () => {
  assert.throws(() => buildRouteMapGeometry(direct, [direct[0]]), /два маршрута/)
  assert.throws(() => buildRouteMapGeometry(direct, [{ x: 0, y: 0 }, direct[1]]), /совпадать/)
  assert.throws(() => buildRouteMapGeometry(direct, [direct[0], { x: NaN, y: 0 }]), /координаты/)
})

test('handles vertical and horizontal lines without division by zero', () => {
  const base = { x: 10, y: 10 }
  const science = { x: 10, y: 110 }
  const map = buildRouteMapGeometry([base, science], [base, science])
  assert.ok(map.direct.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
  assert.equal(map.base.x, map.science.x)
})
