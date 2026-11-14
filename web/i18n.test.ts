import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalog, normalizeLocale, translate } from './i18nCatalog.ts'
import { localizeErrorMessage } from './localizedErrors.ts'

test('every visible message contains complete Russian, English and Kazakh translations', () => {
  assert.ok(Object.keys(catalog).length >= 180)
  for (const [key, entries] of Object.entries(catalog)) {
    assert.equal(entries.length, 3, key)
    assert.ok(entries.every(text => text.trim().length > 0), key)
    const sourcePlaceholders = (entries[0].match(/\{[a-zA-Z]+\}/g) || []).sort()
    for (const language of [1, 2]) {
      assert.deepEqual((entries[language].match(/\{[a-zA-Z]+\}/g) || []).sort(),
        sourcePlaceholders, key + ' has inconsistent placeholders')
    }
  }
})

test('language tags normalize accurately; unsupported input has safe Russian fallback', () => {
  assert.equal(normalizeLocale('ru-RU'), 'ru')
  assert.equal(normalizeLocale('en-US'), 'en')
  assert.equal(normalizeLocale('kk-KZ'), 'kk')
  assert.equal(normalizeLocale('kz'), 'kk')
  assert.equal(normalizeLocale('fr-FR'), 'ru')
  assert.equal(normalizeLocale(null), 'ru')
})

test('scientific names and dynamic values are untouched while display copy translates', () => {
  assert.equal(translate('nav.map', 'en'), 'Surface map')
  assert.equal(translate('nav.map', 'kk'), 'Жер бедері картасы')
  assert.equal(translate('map.source.active', 'ru'), 'активный слой')
  assert.equal(translate('compare.partial', 'en', {direct:100,detour:80.5}).includes('80.5%'), true)
  assert.ok(translate('map.science.geology', 'en').includes('Perseverance'))
  assert.ok(translate('map.science.geology', 'kk').includes('Hazeltop'))
  assert.equal(translate('unknown:key', 'en'), 'unknown:key')
})

test('scientific parser errors are translated only at UI boundary', () => {
  assert.equal(localizeErrorMessage('Пороги уклонов различаются', 'en'), 'Route grade thresholds do not match')
  assert.equal(localizeErrorMessage('Пороги уклонов различаются', 'kk'), 'Бағыттардың еңіс шектері сәйкес емес')
  assert.equal(localizeErrorMessage('Пороги уклонов различаются', 'ru'), 'Пороги уклонов различаются')
  assert.ok(localizeErrorMessage('CTX и DEM не совпадают по границам', 'en').startsWith('CTX and DEM differ'))
  assert.ok(localizeErrorMessage('Неверные метаданные DEM: root', 'kk').startsWith('DEM метадеректері'))
  assert.equal(localizeErrorMessage('Не удалось прочитать JSON из файла «myfile.json».', 'en'),
    'Could not read JSON from “myfile.json”.')
  assert.equal(localizeErrorMessage('Unexpected network condition', 'en'),
    'Operation failed. Check the data and try again.')
})

test('all static t(...) keys used by React views exist in the catalog', () => {
  const files = [
    'web/main.tsx', 'web/MarsMap.tsx', 'web/ElevationProfileChart.tsx',
    'web/RouteSlopePanel.tsx', 'web/RouteOverview.tsx', 'web/i18n.tsx',
  ]
  let found = 0
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\bt\('([^']+)'/g)) {
      if (match[1].endsWith('.')) continue // dynamic key, independently tested
      assert.ok(match[1] in catalog, file + ' uses untranslated key: ' + match[1])
      found++
    }
    // Visible JSX content must not silently remain in hardcoded Russian.
    const exposed = file === 'web/i18n.tsx' ? [] : text.match(/>[^<>{]*[А-Яа-яЁё][^<>{]*</g) || []
    assert.deepEqual(exposed, [], file + ' contains untranslated JSX text')
    const accessibility = text.match(/(?:aria-label|title)="[^"]*[А-Яа-яЁё][^"]*"/g) || []
    assert.deepEqual(accessibility, [], file + ' contains untranslated accessibility text')
  }
  assert.ok(found >= 100, 'Expected complete UI localization across components')
})
