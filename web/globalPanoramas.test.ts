import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { validatePhotoCatalog } from './photoCatalog.ts'

const catalogPath = new URL('../public/data/mars-global/panoramas.json', import.meta.url)

test('global surface panorama catalogue contains only sourced, region-linked records', async () => {
  const catalog = validatePhotoCatalog(JSON.parse(await readFile(catalogPath, 'utf8')))
  assert.equal(catalog.catalog_id, 'mars_regions_verified_surface_panoramas')
  assert.ok(catalog.records.length >= 4)
  assert.deepEqual(new Set(catalog.records.map(item => item.region_id)), new Set([
    'gale-crater', 'elysium-planitia', 'utopia-planitia',
  ]))
  for (const panorama of catalog.records) {
    assert.ok(panorama.coordinates)
    assert.ok(panorama.region_id)
    assert.match(`${panorama.title} ${panorama.caption}`, /panorama|degree/i)
    assert.ok(panorama.page_url.includes('nasa.gov'))
    assert.match(panorama.image_url, /^\/data\/mars-global\/panoramas\/.+\.jpg$/)
    const asset = await readFile(new URL(`../public${panorama.image_url}`, import.meta.url))
    assert.deepEqual([...asset.subarray(0, 3)], [0xff, 0xd8, 0xff])
  }
})

test('Viking 2 sweep is honestly labelled as 330 degrees', async () => {
  const catalog = validatePhotoCatalog(JSON.parse(await readFile(catalogPath, 'utf8')))
  const viking = catalog.records.find(item => item.id === 'pia00399-viking-2-utopia-330')
  assert.ok(viking)
  assert.match(viking.caption, /330-degree/)
  assert.doesNotMatch(viking.caption, /360-degree/)
})
