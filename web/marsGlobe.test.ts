import test from 'node:test'
import assert from 'node:assert/strict'
import { clampGlobeView, marsToGlobeScreen, screenUnitToMars, texturePixel } from './marsGlobe.ts'

test('globe centre maps to the selected Martian coordinates', () => {
  const view = { longitude: 77.4, latitude: 18.45, zoom: 1 }
  assert.deepEqual(marsToGlobeScreen(77.4, 18.45, view), { x: 0, y: 0, visible: true })
  const centre = screenUnitToMars(0, 0, view)!
  assert.ok(Math.abs(centre.longitude - 77.4) < 1e-9)
  assert.ok(Math.abs(centre.latitude - 18.45) < 1e-9)
})

test('points on the far hemisphere are hidden', () => {
  assert.equal(marsToGlobeScreen(0, 0, { longitude: 0, latitude: 0, zoom: 1 }).visible, true)
  assert.equal(marsToGlobeScreen(180, 0, { longitude: 0, latitude: 0, zoom: 1 }).visible, false)
})

test('view and texture coordinates are bounded', () => {
  assert.deepEqual(clampGlobeView({ longitude: 540, latitude: 100, zoom: 8 }), { longitude: -180, latitude: 85, zoom: 1.7 })
  assert.deepEqual(texturePixel(180, -90, 512, 256), { x: 0, y: 255 })
})
