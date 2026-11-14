import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseMarsSites } from './marsSites.ts'
import {
  normalizeMarsLongitude, projectGlobalSite, visibleMarsSiteClusters,
} from './marsSiteMapGeometry.ts'

const catalog = parseMarsSites(JSON.parse(
  readFileSync(new URL('../public/data/mars-global/sites.json', import.meta.url), 'utf8'),
))
const camera = { zoom: 1, panX: 0, panY: 0 }
const size = { width: 1024, height: 512 }

test('0–360 east longitude is wrapped only for visualization, not WGS84', () => {
  assert.equal(normalizeMarsLongitude(312.049), -47.95100000000002)
  assert.equal(normalizeMarsLongitude(135.623), 135.623)
  assert.equal(normalizeMarsLongitude(0), 0)
  assert.equal(normalizeMarsLongitude(180), -180)
  assert.throws(() => normalizeMarsLongitude(-1), /longitude/)
  assert.throws(() => normalizeMarsLongitude(360), /longitude/)
})

test('projected site pins match MOLA global canvas pixels and Mars latitude orientation', () => {
  const equator = projectGlobalSite(0, 0, camera, size)
  assert.deepEqual(equator, { x: 512, y: 256 })
  const north = projectGlobalSite(45, 0, camera, size)
  assert.ok(north.y < equator.y)
  const west = projectGlobalSite(0, 312.049, camera, size)
  assert.ok(west.x < equator.x)
  assert.ok(Math.abs(west.x - 375.605) < 0.01)
})

test('marker projection follows pan and zoom without changing stored coordinates', () => {
  const zoomed = projectGlobalSite(4.502, 135.623, {zoom:2,panX:50,panY:-30}, size)
  const defaultPin = projectGlobalSite(4.502, 135.623, camera, size)
  assert.equal(zoomed.x, 512 + 50 + (defaultPin.x - 512) * 2)
  assert.equal(zoomed.y, 256 - 30 + (defaultPin.y - 256) * 2)
})

test('co-located lander science events are selectable in same visual cluster', () => {
  const clusters = visibleMarsSiteClusters(catalog.sites, 'all', camera, size)
  const phoenix = clusters.find(c => c.sites.some(site => site.id === 'phoenix'))
  assert.ok(phoenix)
  assert.ok(phoenix.sites.some(site => site.id === 'phoenix-water-ice'))
  const insight = clusters.find(c => c.sites.some(site => site.id === 'insight'))
  assert.ok(insight?.sites.some(site => site.id === 'insight-first-likely-marsquake'))
  assert.equal(clusters.flatMap(c => c.sites).length, 11)
})

test('filter preserves explicit category and does not discard sources', () => {
  const landers = visibleMarsSiteClusters(catalog.sites, 'landing_site', camera, size)
  const events = visibleMarsSiteClusters(catalog.sites, 'science_event', camera, size)
  assert.equal(landers.flatMap(c=>c.sites).length, 9)
  assert.equal(events.flatMap(c=>c.sites).length, 2)
  assert.ok(events.flatMap(c=>c.sites).every(site => site.anchor_site_id && site.sources.length))
})

test('offscreen markers are removed from visible buttons, not from catalogue', () => {
  const hidden = visibleMarsSiteClusters(catalog.sites, 'all',
    { zoom:8, panX:-20000, panY:0 }, size)
  assert.equal(hidden.length, 0)
  assert.equal(catalog.sites.length, 11)
  assert.throws(() => projectGlobalSite(91, 12, camera, size), /Invalid/)
})
