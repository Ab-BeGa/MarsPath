import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeToGrid } from './routeMap.ts'

const transform = [20, 0, 4351400, 0, -20, 1094800] as [number, number, number, number, number, number]

test('projects route points to DEM pixel-space without resampling heights', () => {
  const grid = routeToGrid([
    { x: 4351410, y: 1094790 }, { x: 4351450, y: 1094750 },
  ], transform)
  assert.deepEqual(grid, [{ col: 0.5, row: 0.5 }, { col: 2.5, row: 2.5 }])
})

test('northing increases upward and projected x increases east', () => {
  const grid = routeToGrid([
    { x: 4351420, y: 1094760 }, { x: 4351440, y: 1094780 },
  ], transform)
  assert.ok(grid[1].row < grid[0].row)
  assert.ok(grid[1].col > grid[0].col)
})

test('keeps points outside ROI for canvas clipping, not silent relocation', () => {
  const grid = routeToGrid([
    { x: 4351380, y: 1094820 }, { x: 4351420, y: 1094760 },
  ], transform)
  assert.equal(grid[0].col, -1)
  assert.equal(grid[0].row, -1)
})

test('rejects corrupt route points and unsupported rotated raster', () => {
  assert.throws(() => routeToGrid([{ x: 1, y: 2 }], transform), /минимум две/)
  assert.throws(() => routeToGrid([{ x: 1, y: 2 }, { x: NaN, y: 3 }], transform), /действительные/)
  assert.throws(() => routeToGrid([{ x: 1, y: 2 }, { x: 2, y: 3 }], [20, 1, 0, 0, -20, 0]), /привязка/)
})
