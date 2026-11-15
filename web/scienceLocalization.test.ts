import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { regionCopy, regionText, type RegionField } from './scienceRegionTranslations.ts'
import { siteCopy, siteText, methodCopy, methodText, type SiteField } from './scienceSiteTranslations.ts'
import { photoCopy, photoText, type PhotoField } from './sciencePhotoTranslations.ts'
import type { DetailedRegion } from './detailedRegions.ts'
import type { MarsSite } from './marsSites.ts'
import type { JezeroPhoto } from './photoCatalog.ts'
import type { Locale } from './i18nCatalog.ts'

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const regions = read('public/data/mars-global/detailed_regions.json').regions as DetailedRegion[]
const sites = read('public/data/mars-global/sites.json').sites as MarsSite[]
const photos = [
  ...read('public/data/jezero/photos.json').records,
  ...read('public/data/mars-global/panoramas.json').records,
] as JezeroPhoto[]
const cyrillic = /[\u0400-\u052F]/
const languages: Locale[] = ['ru', 'en', 'kk']

test('all 11 detailed regions have readable localized content in all languages', () => {
  assert.equal(regions.length, 11)
  assert.equal(Object.keys(regionCopy).length, regions.length)
  const fields: RegionField[] = ['name', 'type', 'summary', 'science', 'note']
  for (const region of regions) {
    for (const locale of languages) for (const field of fields) {
      const value = regionText(region, locale, field)
      assert.ok(value.trim().length > 8 || field === 'name' || field === 'type', `${region.id} ${locale} ${field}`)
      assert.notEqual(value, '—', `${region.id} ${locale} ${field}`)
      if (locale === 'en') assert.equal(cyrillic.test(value), false, `${region.id} EN ${field}`)
    }
  }
  assert.equal(regionText(regions.find(x => x.id === 'olympus-mons')!, 'en', 'name'), 'Olympus Mons')
})

test('all catalogued landing sites and science events have localized descriptions, notes, and images', () => {
  assert.equal(sites.length, 11)
  assert.equal(Object.keys(siteCopy).length, sites.length)
  for (const site of sites) {
    const fields: SiteField[] = site.image ?
      ['name', 'description', 'notes', 'imageAlt', 'imageCaption'] : ['name', 'description', 'notes']
    for (const locale of languages) for (const field of fields) {
      const value = siteText(site, locale, field)
      assert.ok(value.trim().length > 0 && value !== '—', `${site.id} ${locale} ${field}`)
      if (locale === 'en') assert.equal(cyrillic.test(value), false, `${site.id} EN ${field}`)
    }
  }
  assert.match(siteText(sites.find(s => s.id === 'insight-first-likely-marsquake')!, 'en', 'notes'), /NOT/)
})

test('all published photos and global panoramas have localized title/caption and accurate location caveats', () => {
  assert.equal(photos.length, 15)
  assert.equal(Object.keys(photoCopy).length, photos.length)
  const fields: PhotoField[] = ['title','caption','note']
  for (const photo of photos) for (const locale of languages) for (const field of fields) {
    const value = photoText(photo, locale, field)
    if (field === 'note' && !photo.coordinates) { assert.equal(value, ''); continue }
    assert.ok(value.trim().length > 0, `${photo.id} ${locale} ${field}`)
    if (locale === 'en') assert.equal(cyrillic.test(value), false, `${photo.id} EN ${field}`)
  }
  assert.match(photoText(photos.find(p => p.id.includes('viking-2-utopia'))!, 'ru', 'caption'), /330/)
})

test('science UI has no visible hardcoded Cyrillic JSX and no unlocalized metadata fields', () => {
  const components = ['web/DetailedRegionReport.tsx', 'web/RegionSummary.tsx',
    'web/RegionalMap.tsx', 'web/MarsGlobe.tsx', 'web/MarsGlobalMap.tsx',
    'web/MarsSiteInfoCard.tsx', 'web/MarsMap.tsx', 'web/PanoramaDialog.tsx']
  for (const path of components) {
    const contents = readFileSync(path, 'utf8')
    assert.deepEqual(contents.match(/>[^<>{]*[А-Яа-яЁё][^<>{]*</g) || [], [], path)
    assert.deepEqual(contents.match(/(?:aria-label|title)="[^"]*[А-Яа-яЁё][^"]*"/g) || [], [], path)
    assert.doesNotMatch(contents, /\{(?:region|selected)\.(?:name_ru|feature_type_ru|summary_ru|science_ru|data_note_ru|description_ru|caption_ru|alt_ru|notes_ru)\}/, path)
  }
})

test('georeferencing methods shown in site cards are localized without altering source labels', () => {
  const methods = new Set(sites.flatMap(site => [
    site.georeferencing.method,
    ...(site.alternative_positions ?? []).map(position => position.method),
  ]))
  assert.equal(methods.size, 7)
  for (const method of methods) {
    assert.ok(method in methodCopy, `Missing method translation: ${method}`)
    assert.equal(methodText(method, 'en'), method, `Source method changed: ${method}`)
    assert.match(methodText(method, 'ru'), /[\u0400-\u052F]/, method)
    assert.match(methodText(method, 'kk'), /[\u0400-\u052F]/, method)
    assert.notEqual(methodText(method, 'ru'), method, method)
    assert.notEqual(methodText(method, 'kk'), method, method)
  }
})

test('regional scale, alternate coordinates and panorama sol labels use locale-aware copy', () => {
  const regionMap = readFileSync('web/RegionalMap.tsx', 'utf8')
  const siteCard = readFileSync('web/MarsSiteInfoCard.tsx', 'utf8')
  const reports = ['web/DetailedRegionReport.tsx', 'web/PanoramaDialog.tsx']
  assert.equal((regionMap.match(/t\('region.map.scaleKm'/g) || []).length, 3)
  assert.match(siteCard, /methodText\(selected\.georeferencing\.method,locale\)/)
  assert.match(siteCard, /methodText\(alt\.method,locale\)/)
  for (const file of reports) {
    const text = readFileSync(file, 'utf8')
    assert.match(text, /t\('map.photos.sols'\)/, file)
  }
})
