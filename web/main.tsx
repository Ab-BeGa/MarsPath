import { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { MarsMap } from './MarsMap.tsx'
import { MarsGlobe } from './MarsGlobe.tsx'
import { RouteOverview } from './RouteOverview.tsx'
import { loadMarsTerrain, type MarsTerrain } from './marsTerrain.ts'
import { compareRoutes, type RouteComparison } from './compareRoutes.ts'
import { I18nProvider, LanguageSwitcher, useI18n } from './i18n.tsx'
import { DetailedRegionReport } from './DetailedRegionReport.tsx'
import type { DetailedRegion } from './detailedRegions.ts'
import { RegionSummary } from './RegionSummary.tsx'
import './styles.css'

const metricKeys: Record<string, string> = {
  'Длина маршрута': 'compare.distance',
  'Набор высоты': 'compare.ascent',
  'Максимальный измеренный уклон': 'compare.maxSlope',
  'Крутые интервалы': 'compare.steepCount',
  'Длина крутых интервалов': 'compare.steepLength',
  'Участки без данных': 'compare.unknownLength',
}
async function readExport(file: File): Promise<unknown> {
  try { return JSON.parse(await file.text()) }
  catch { throw new Error(`Не удалось прочитать JSON из файла «${file.name}».`) }
}

function RouteComparisonPanel({ comparison, onComparison }: {
  comparison: RouteComparison | null
  onComparison: (value: RouteComparison | null) => void
}) {
  const {t, locale, format: localizedNumber, error: localizeError} = useI18n()
  const format = (value: number | null, delta = false) =>
    value === null ? '—' : localizedNumber(value, {signDisplay: delta ? 'exceptZero' : 'auto'})
  const result = comparison
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  function clearResult() { setError(''); onComparison(null) }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const direct = data.get('direct')
    const detour = data.get('detour')
    if (!(direct instanceof File) || !(detour instanceof File)) return
    clearResult()
    setPending(true)
    try {
      const inputs = await Promise.all([readExport(direct), readExport(detour)])
      const comparison = compareRoutes(...inputs)
      onComparison(comparison)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сравнить маршруты.')
    } finally { setPending(false) }
  }

  const lengthDelta = result?.rows[0].delta
  const steepDelta = result?.rows[4].delta
  return (
    <section id="compare" className="comparison-section" aria-labelledby="comparison-title">
      <div className="section-heading">
        <div>
          <span className="section-kicker">{t('compare.kicker')}</span>
          <h2 id="comparison-title">{t('compare.title')}</h2>
          <p>{t('compare.description')}</p>
        </div>
        <span className="data-pill">{t('compare.analysis')}</span>
      </div>
      <div className="comparison-card">
        <form onSubmit={submit} className="route-form">
          <fieldset disabled={pending}>
            <legend>{t('compare.upload')}</legend>
            <label>{t('route.direct.full')} <input type="file" name="direct" accept=".json,application/json"
              onChange={clearResult} required /></label>
            <label>{t('route.detour.full')} <input type="file" name="detour" accept=".json,application/json"
              onChange={clearResult} required /></label>
            <button className="primary-action" type="submit">{pending ? t('compare.processing') : t('compare.button')}</button>
          </fieldset>
        </form>
        {error && <p role="alert" className="alert error-alert">{localizeError(error)}</p>}
        <div aria-live="polite">
          {result && <>
            {result.origin === 'browser' && <p className="comparison-summary">
              {t('planner.comparisonSource')}
            </p>}
            {!result.demVerified && <p className="alert">{t('compare.demMissing')}</p>}
            {result.coverage.partial && <p className="alert">{t('compare.partial', {direct:format(result.coverage.direct),detour:format(result.coverage.detour)})}</p>}
            {!result.coverage.partial && lengthDelta != null && steepDelta != null &&
              <p className="comparison-summary">{t('compare.summary', {length:format(lengthDelta,true),steep:format(steepDelta,true)})}</p>}
            <RouteOverview direct={result.routes.direct} detour={result.routes.detour}
              browserMode={result.origin === 'browser'}/>
            <div className="table-scroll" tabIndex={0} role="region" aria-label={t('compare.resultsAria')}>
              <table>
                <caption>{t('compare.caption')}</caption>
                <thead><tr><th scope="col">{t('compare.metric')}</th><th scope="col">{t(result.origin === 'browser' ? 'planner.shortest' : 'route.direct')}</th><th scope="col">{t(result.origin === 'browser' ? 'planner.slopeCost' : 'route.detour')}</th><th scope="col">{t('compare.delta')}</th></tr></thead>
                <tbody>{result.rows.map(row => <tr key={row.label}>
                  <th scope="row">{t(metricKeys[row.label] || row.label)}{row.unit && ', ' + (locale === 'en' && row.unit === 'м' ? 'm' : row.unit)}</th>
                  <td>{format(row.direct)}</td><td>{format(row.detour)}</td><td>{format(row.delta, true)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <p className="table-note">{t('compare.note')}</p>
          </>}
        </div>
      </div>
    </section>
  )
}

function App() {
  const {t, error: localizeError} = useI18n()
  const [comparison, setComparison] = useState<RouteComparison | null>(null)
  const [terrain, setTerrain] = useState<MarsTerrain | null>(null)
  const [mapError, setMapError] = useState('')
  const [selectedRegion, setSelectedRegion] = useState<DetailedRegion | null>(null)
  const scrollToRegion = () => document.getElementById('map')?.scrollIntoView({behavior:'smooth'})
  useEffect(() => {
    if (selectedRegion) scrollToRegion()
  }, [selectedRegion])
  useEffect(() => {
    let active = true
    void loadMarsTerrain().then(data => { if (active) setTerrain(data) }).catch(reason => {
      if (active) setMapError(reason instanceof Error ? reason.message : 'Не удалось загрузить DEM')
    })
    return () => { active = false }
  }, [])

  const mapSourceMatches = Boolean(terrain && comparison?.demVerified &&
    comparison.source.demHash === terrain.metadata.source.source_sha256 &&
    comparison.source.crs === terrain.metadata.crs_wkt)

  const openRegion = (region: DetailedRegion) => {
    if (region === selectedRegion) scrollToRegion()
    else setSelectedRegion(region)
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#globe" aria-label={t('nav.home')}>
          <span className="brand-mark" aria-hidden="true"><span>◈</span></span>
          <span className="brand-title">JEZERO <em>TRAVERSE</em><small>{t('brand.subtitle')}</small></span>
        </a>
        <nav className="topnav" aria-label={t('nav.label')}>
          <a href="#globe">{t('nav.globe')}</a>
          {selectedRegion && <a href="#map">{t('nav.map')}</a>}
          <a href="#compare">{t('nav.compare')}</a>
        </nav>
        <LanguageSwitcher/>
        <span className="header-mode"><span className="online-indicator"/> {t('mode')}</span>
      </header>
      <main className="main-content">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">NASA SPACE APPS CHALLENGE · 2026</span>
            <h1>{t('hero.title.start')} <span>{t('hero.title.end')}</span></h1>
            <p>{t('hero.description')}</p>
          </div>
          <div className="hero-stats">
            <div><small>{t('hero.planet')}</small><strong>MARS</strong></div>
            <div><small>{t('hero.region')}</small><strong>JEZERO DELTA</strong></div>
            <div><small>{t('hero.source')}</small><strong>NASA / USGS</strong></div>
          </div>
        </section>
        <MarsGlobe onOpenDetail={openRegion}/>
        {selectedRegion && <div id="map">
          {selectedRegion.detail_status === 'report' ? <DetailedRegionReport key={selectedRegion.id} region={selectedRegion}/> :
            <>
              {mapError && <section className="load-state" role="alert">
                <h2>{t('app.loadFailed')}</h2>
                <p>{localizeError(mapError)}</p>
                <p>{t('app.loadHelp', {command:'npm.cmd run dev',protocol:'file://',path:'public/data/jezero/'})}</p>
              </section>}
              {!terrain && !mapError && <section className="load-state" role="status" aria-live="polite">
                <div className="loading-ring" aria-hidden="true"/><p>{t('app.loadingDEM')}</p>
              </section>}
              {terrain && <>
                <MarsMap terrain={terrain} routes={mapSourceMatches ? comparison?.routes : undefined}
                  routeStepM={mapSourceMatches ? comparison?.source.step : undefined}
                  routeOrigin={mapSourceMatches ? comparison?.origin : undefined} onPlan={setComparison}/>
                <RegionSummary region={selectedRegion} />
              </>}
            </>}
        </div>}
        {comparison && terrain && !mapSourceMatches && <p className="alert" role="status">{t('compare.mapNotMatched')}</p>}
        {mapSourceMatches && selectedRegion?.detail_status !== 'local_map' && <p className="alert" role="status">
          {t('compare.selectJezero')}{' '}<a href="#globe">{t('nav.globe')}</a>
        </p>}
        <RouteComparisonPanel comparison={comparison} onComparison={setComparison}/>
        <footer className="page-footer"><span>JEZERO TRAVERSE © 2026</span>
          <span>{t('app.footer.demo')}</span>
          <a href="https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif" target="_blank" rel="noopener noreferrer">{t('app.footer.usgs')}</a>
        </footer>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<I18nProvider><App/></I18nProvider>)
