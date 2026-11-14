import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCtxOpticalManifest } from './ctxOptical.ts'
import type { MarsTerrain } from './marsTerrain.ts'

const demHash = 'a'.repeat(64)
const imageHash = 'b'.repeat(64)
const sourceHash = 'c'.repeat(64)
const wkt = 'PROJCS["Jezero_Crater_Projection",GEOGCS["GCS_Mars_2000_Sphere"]]'
const bounds = [4_351_000, 1_093_000, 4_352_500, 1_094_500]
const terrain = {
  metadata: {
    region_id: 'jezero_west_delta_demo',
    crs_wkt: wkt,
    source: { source_sha256: demHash },
    grid: { bounds_projected_m: bounds },
  },
} as unknown as MarsTerrain
const officialUrl = 'https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.tif'
const raw = {
  schema_version: 1,
  kind: 'real_ctx_orthomosaic',
  region_id: 'jezero_west_delta_demo',
  source: { product: 'Official USGS CTX orthomosaic', publisher: 'USGS', url: officialUrl, source_sha256: sourceHash },
  alignment: {
    target_dem_sha256: demHash, target_dem_crs_wkt: wkt,
    bounds_projected_m: bounds,
    transform: [5, 0, bounds[0], 0, -5, bounds[3]],
    width: 300, height: 300, resolution_m: 5,
    coverage_valid_fraction: .99,
  },
  display: {
    image_file: 'ctx_ortho.png', image_sha256: imageHash, nodata_transparency: true,
  },
}

test('accepts a properly CRS-aligned genuine CTX manifest', () => {
  const parsed = validateCtxOpticalManifest(raw, terrain)
  assert.equal(parsed.alignment.width, 300)
  assert.equal(parsed.alignment.height, 300)
  assert.equal(parsed.alignment.target_dem_sha256, demHash)
})

test('rejects optical overlays created for another DEM, ROI or Mars CRS', () => {
  const wrongHash = structuredClone(raw)
  wrongHash.alignment.target_dem_sha256 = 'd'.repeat(64)
  assert.throws(() => validateCtxOpticalManifest(wrongHash, terrain), /другой модели/)
  const wrongROI = structuredClone(raw)
  wrongROI.alignment.bounds_projected_m[2] += 10
  assert.throws(() => validateCtxOpticalManifest(wrongROI, terrain), /границам/)
  const wrongCRS = structuredClone(raw)
  wrongCRS.alignment.target_dem_crs_wkt = 'WGS84'
  assert.throws(() => validateCtxOpticalManifest(wrongCRS, terrain), /проекции/)
})

test('rejects unregistered visual assets, invalid image size and missing source SHA', () => {
  const fake = structuredClone(raw)
  fake.display.image_file = 'browse_not_georeferenced.jpg'
  assert.throws(() => validateCtxOpticalManifest(fake, terrain), /оптического слоя/)
  const fakeURL = structuredClone(raw)
  fakeURL.source.url = 'https://example.com/mars.jpg'
  assert.throws(() => validateCtxOpticalManifest(fakeURL, terrain), /официальным/)
  const invalidDims = structuredClone(raw)
  invalidDims.alignment.width = 200
  assert.throws(() => validateCtxOpticalManifest(invalidDims, terrain), /ширине/)
  const badSource = structuredClone(raw)
  badSource.source.source_sha256 = 'not-a-hash'
  assert.throws(() => validateCtxOpticalManifest(badSource, terrain), /SHA-256/)
})

test('rejects fake 100% cover on a mostly NoData CTX tile', () => {
  const wrong = structuredClone(raw)
  wrong.alignment.coverage_valid_fraction = .12
  assert.throws(() => validateCtxOpticalManifest(wrong, terrain), /пикселей/)
})
