import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { DetailedRegionsCatalog } from './detailedRegions.ts'

test('published detailed-region catalogue covers the requested Mars regions', async () => {
  const catalog = JSON.parse(await readFile(new URL('../public/data/mars-global/detailed_regions.json', import.meta.url), 'utf8')) as DetailedRegionsCatalog
  assert.equal(catalog.schema_version, 2)
  assert.equal(catalog.regions.length, 11)
  assert.deepEqual(new Set(catalog.regions.map(region => region.id)), new Set([
    'jezero-west-delta','hecates-tholus','olympus-mons','arsia-mons','alba-patera','gale-crater',
    'utopia-planitia','elysium-planitia','cerberus-fossae','oxia-planum','syrtis-major',
  ]))
  assert.equal(catalog.regions.filter(region => region.detail_status === 'local_map').length, 1)
  for (const region of catalog.regions) {
    assert.ok(region.latitude_deg >= -90 && region.latitude_deg <= 90)
    assert.ok(region.longitude_east_deg >= 0 && region.longitude_east_deg < 360)
    assert.ok(region.sources.length > 0)
    assert.ok(region.summary_ru && region.science_ru && region.data_note_ru)
  }
})
