import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseMarsMetadata, decodeMarsTerrain, cellAtProjected, cellAtGrid,
  marsDegreesToProjected, projectedToMarsDegrees,
} from './marsTerrain.ts'

const raw = {
  region_id: 'test_jezero',
  source: {
    product: 'Mars 2020 CTX DEM', instrument: 'CTX', publisher: 'USGS',
    url: 'https://example.test/dem.tif', source_sha256: 'a'.repeat(64),
  },
  grid: {
    width: 3, height: 2, pixel_size_m: [20, 20],
    transform: [20, 0, 4_351_000, 0, -20, 1_094_000],
    bounds_projected_m: [4_351_000, 1_093_960, 4_351_060, 1_094_000],
    heights_file: 'heights.f32', mask_file: 'mask.u8',
    elevation_min_m: -2550, elevation_max_m: -2500,
  },
  coordinate_convention: { source_crs_sphere_radius_m: 3396190 },
  crs_wkt: 'PROJCS["Jezero_Crater_Projection",GEOGCS["GCS_Mars_2000_Sphere"]]',
  checked_points: [
    { id: 'base', name: 'Three Forks', role: 'base', latitude_deg: 18.45,
      longitude_deg: 77.4, projected_x_m: 4_351_010, projected_y_m: 1_093_990, elevation_m: -2550 },
    { id: 'science_target', name: 'Wildcat Ridge', role: 'science_target',
      latitude_deg: 18.46, longitude_deg: 77.39,
      projected_x_m: 4_351_050, projected_y_m: 1_093_970, elevation_m: -2500 },
  ],
}

function terrain(values = [-2550, -2540, -2530, -2520, -2510, -2500], mask = [1, 1, 1, 1, 0, 1]) {
  const h = new ArrayBuffer(values.length * 4)
  const d = new DataView(h)
  values.forEach((v, i) => d.setFloat32(i * 4, v, true))
  const m = Uint8Array.from(mask)
  return decodeMarsTerrain(parseMarsMetadata(raw), h, m.buffer)
}

test('decoder respects little-endian float32, original DEM mask and min/max', () => {
  const t = terrain()
  assert.equal(t.validCount, 5)
  assert.equal(t.min, -2550)
  assert.equal(t.max, -2500)
  assert.equal(t.heights.length, 6)
  assert.equal(t.heights[1], -2540)
  assert.equal(cellAtGrid(t, 1, 1)?.elevation, null)
  assert.equal(cellAtGrid(t, 2, 1)?.elevation, -2500)
})

test('projected point lookup uses original Mars affine and rejects map exterior', () => {
  const t = terrain()
  assert.equal(cellAtProjected(t, 4_351_010, 1_093_990)?.col, 0)
  assert.equal(cellAtProjected(t, 4_351_010, 1_093_990)?.row, 0)
  assert.equal(cellAtProjected(t, 4_351_059.9, 1_093_960.1)?.col, 2)
  assert.equal(cellAtProjected(t, 4_351_059.9, 1_093_960.1)?.row, 1)
  assert.equal(cellAtProjected(t, 4_351_060, 1_093_980), null)
  assert.equal(cellAtProjected(t, 4_351_000, 1_093_960), null)
  assert.equal(cellAtProjected(t, Number.NaN, 1_093_970), null)
})

test('Mars 2000 equirectangular projection recovers published base position', () => {
  const t = terrain()
  const x = 4_352_397.644048612
  const y = 1_093_837.300156033
  const p = projectedToMarsDegrees(t.metadata, x, y)
  assert.ok(Math.abs(p.longitude - 77.41359752) < 1e-7)
  assert.ok(Math.abs(p.latitude - 18.45369687) < 1e-7)
  const xy = marsDegreesToProjected(t.metadata, p.longitude, p.latitude)
  assert.ok(Math.abs(xy.x - x) < 1e-6)
  assert.ok(Math.abs(xy.y - y) < 1e-6)
})

test('rejects invalid binary sizes and corrupt mask', () => {
  const m = parseMarsMetadata(raw)
  assert.throws(() => decodeMarsTerrain(m, new ArrayBuffer(23), new ArrayBuffer(6)), /Размеры/)
  assert.throws(() => decodeMarsTerrain(m, new ArrayBuffer(24), new ArrayBuffer(5)), /Размеры/)
  assert.throws(() => terrain([-2550, -2540, -2530, -2520, -2510, -2500], [1, 1, 7, 1, 1, 1]), /маски/)
})

test('invalid numeric DEM cells cannot be labeled valid', () => {
  assert.throws(() => terrain([-2550, NaN, -2530, -2520, -2510, -2500]), /высота/)
  const t = terrain([-2550, NaN, -2530, -2520, -2510, -2500], [1, 0, 1, 1, 1, 1])
  assert.equal(cellAtGrid(t, 1, 0)?.elevation, null)
})

test('rejects Earth projection, non north-up transforms, missing checkpoints and path traversal', () => {
  const broken = structuredClone(raw)
  broken.crs_wkt = 'GEOGCS["WGS84"]'
  assert.throws(() => parseMarsMetadata(broken), /марсианская/)
  const wrong = structuredClone(raw)
  wrong.grid.transform[1] = 3
  assert.throws(() => parseMarsMetadata(wrong), /северо-ориентированная/)
  const points = structuredClone(raw)
  points.checked_points = points.checked_points.slice(0, 1)
  assert.throws(() => parseMarsMetadata(points), /научная/)
  const path = structuredClone(raw)
  path.grid.heights_file = '../bad.f32'
  assert.throws(() => parseMarsMetadata(path), /имя файла/)
})
