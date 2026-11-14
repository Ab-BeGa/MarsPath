import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseMarsSites } from './marsSites.ts'

const original = JSON.parse(readFileSync(new URL('../public/data/mars-global/sites.json', import.meta.url), 'utf8'))
const clone = () => structuredClone(original)

test('catalogue contains 9 NASA landing places and 2 instrument science events', () => {
  const result = parseMarsSites(original)
  assert.equal(result.sites.length, 11)
  assert.equal(result.sites.filter(x => x.category === 'landing_site').length, 9)
  assert.equal(result.sites.filter(x => x.category === 'science_event').length, 2)
  assert.equal(result.spatial_reference.longitude_direction, 'positive east')
  assert.ok(result.sites.every(x => x.sources.length > 0))
})

test('published coordinate hemispheres and precision match numeric values', () => {
  const result = parseMarsSites(original)
  const spirit = result.sites.find(x => x.id === 'spirit')!
  assert.equal(spirit.latitude_deg, -14.571892)
  assert.equal(spirit.longitude_east_deg, 175.47848)
  assert.equal(spirit.georeferencing.reported_decimal_places.latitude, 6)
  assert.equal(spirit.georeferencing.estimated_horizontal_error_m, null)
  assert.ok((spirit.alternative_positions?.length ?? 0) > 0)
})

test('science-event pins are at instruments, not fabricated phenomenon locations', () => {
  const result = parseMarsSites(original)
  for (const event of result.sites.filter(x => x.category === 'science_event')) {
    const anchor = result.sites.find(x => x.id === event.anchor_site_id)!
    assert.equal(event.latitude_deg, anchor.latitude_deg)
    assert.equal(event.longitude_east_deg, anchor.longitude_east_deg)
    assert.match(event.georeferencing.notes_ru, /не|НЕ/)
  }
})

test('rejects duplicate ids and out-of-range Mars longitude', () => {
  const dup = clone()
  dup.sites[1].id = dup.sites[0].id
  assert.throws(() => parseMarsSites(dup), /Duplicate/)
  const lon = clone()
  lon.sites[1].longitude_east_deg = 370
  assert.throws(() => parseMarsSites(lon), /out of bounds/)
})

test('rejects false coordinate precision and wrong published hemispheres', () => {
  const badPrecision = clone()
  badPrecision.sites[0].georeferencing.reported_decimal_places.latitude = 8
  assert.throws(() => parseMarsSites(badPrecision), /decimal places/)
  const hemisphere = clone()
  hemisphere.sites[0].as_published.latitude = '22.269° S'
  assert.throws(() => parseMarsSites(hemisphere), /disagree/)
})

test('rejects fabricated event location and missing instrument anchor', () => {
  const wrong = clone()
  wrong.sites.find((x: { id: string }) => x.id === 'insight-first-likely-marsquake').longitude_east_deg += 1
  assert.throws(() => parseMarsSites(wrong), /mismatched instrument anchor|coordinates disagree/)
  const missing = clone()
  missing.sites.find((x: { id: string }) => x.id === 'phoenix-water-ice').anchor_site_id = 'unverified'
  assert.throws(() => parseMarsSites(missing), /instrument anchor/)
})

test('source URL is mandatory; scientific positioning error must stay unknown', () => {
  const noUrl = clone()
  noUrl.sites[0].sources[0].url = ''
  assert.throws(() => parseMarsSites(noUrl), /nonempty string/)
  const inventedAccuracy = clone()
  inventedAccuracy.sites.find((x: { id: string }) => x.id === 'phoenix-water-ice').georeferencing.estimated_horizontal_error_m = 1
  assert.throws(() => parseMarsSites(inventedAccuracy), /Do not invent/)
})
