import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { validatePhotoCatalog } from './photoCatalog.ts'

const catalogPath = new URL('../public/data/jezero/photos.json', import.meta.url)

test('published Jezero photo catalog is valid and React-loadable', async () => {
  const parsed = validatePhotoCatalog(JSON.parse(await readFile(catalogPath, 'utf8')))
  assert.equal(parsed.catalog_id, 'perseverance_jezero_verified')
  assert.ok(parsed.records.length >= 5)
  assert.equal(new Set(parsed.records.map(record => record.id)).size, parsed.records.length)
  assert.ok(parsed.records.some(record => record.location_type === 'none' && record.coordinates === null))
  assert.ok(parsed.records.some(record => record.location_type === 'approximate_area' && record.coordinates !== null))
})

test('unknown coordinates stay null and sourced coordinates are explicit', async () => {
  const parsed = validatePhotoCatalog(JSON.parse(await readFile(catalogPath, 'utf8')))
  for (const record of parsed.records) {
    if (record.location_type === 'none') {
      assert.equal(record.coordinates, null)
      assert.equal(record.sources.coordinates, null)
    } else {
      assert.ok(record.coordinates)
      assert.ok(record.sources.coordinates)
      assert.match(record.coordinates.note, /not|approximate/i)
    }
  }
})

test('rejects duplicate ids, invented coordinates and unapproved sources', async () => {
  const raw = JSON.parse(await readFile(catalogPath, 'utf8'))
  raw.records[1].id = raw.records[0].id
  assert.throws(() => validatePhotoCatalog(raw), /duplicate/)

  const invented = JSON.parse(await readFile(catalogPath, 'utf8'))
  const unlocated = invented.records.find((record: { location_type: string }) => record.location_type === 'none')
  unlocated.coordinates = { latitude_deg: 0, longitude_deg: 0, localization_sol: 0, note: 'made up' }
  assert.throws(() => validatePhotoCatalog(invented), /must not contain/)

  const external = JSON.parse(await readFile(catalogPath, 'utf8'))
  external.records[0].page_url = 'https://example.com/photo'
  assert.throws(() => validatePhotoCatalog(external), /approved NASA/)

  const traversal = JSON.parse(await readFile(catalogPath, 'utf8'))
  traversal.records[0].image_url = '/data/../secret.jpg'
  assert.throws(() => validatePhotoCatalog(traversal), /HTTPS|URL/)
})
