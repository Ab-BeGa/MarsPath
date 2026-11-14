import { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { MarsMap } from './MarsMap.tsx'
import { RouteOverview } from './RouteOverview.tsx'
import { loadMarsTerrain, type MarsTerrain } from './marsTerrain.ts'
import { compareRoutes, type RouteComparison } from './compareRoutes.ts'
import './styles.css'

const normal = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 })
const signed = new Intl.NumberFormat('ru', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

function format(value: number | null, delta = false) {
  return value === null ? '—' : (delta ? signed : normal).format(value)
}
async function readExport(file: File): Promise<unknown> {
  try { return JSON.parse(await file.text()) }
  catch { throw new Error(`Не удалось прочитать JSON из файла «${file.name}».`) }
}

function RouteComparisonPanel({ onComparison }: { onComparison: (value: RouteComparison | null) => void }) {
  const [result, setResult] = useState<RouteComparison | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  function clearResult() { setResult(null); setError(''); onComparison(null) }
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
      setResult(comparison)
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
          <span className="section-kicker">ROUTE INTELLIGENCE / 02</span>
          <h2 id="comparison-title">Сравнение маршрутов</h2>
          <p>Инструмент команды для анализа прямой и альтернативной траектории по одной модели высот.</p>
        </div>
        <span className="data-pill">CSV / JSON ANALYSIS</span>
      </div>
      <div className="comparison-card">
        <form onSubmit={submit} className="route-form">
          <fieldset disabled={pending}>
            <legend>Загрузите результаты Python-планировщика</legend>
            <label>Прямой маршрут <input type="file" name="direct" accept=".json,application/json"
              onChange={clearResult} required /></label>
            <label>Обходной маршрут <input type="file" name="detour" accept=".json,application/json"
              onChange={clearResult} required /></label>
            <button className="primary-action" type="submit">{pending ? 'Сравниваем…' : 'Сравнить маршруты'}</button>
          </fieldset>
        </form>
        {error && <p role="alert" className="alert error-alert">{error}</p>}
        <div aria-live="polite">
          {result && <>
            {!result.demVerified && <p className="alert">Источник DEM не подтверждён: в экспортах отсутствует SHA-256. Для надёжного сравнения повторите экспорт с одним GeoTIFF.</p>}
            {result.coverage.partial && <p className="alert">Часть DEM отсутствует: покрытие прямого маршрута {format(result.coverage.direct)}%, обходного {format(result.coverage.detour)}%. Высотные метрики относятся только к измеренным участкам.</p>}
            {!result.coverage.partial && lengthDelta != null && steepDelta != null &&
              <p className="comparison-summary">Обход меняет длину на <strong>{format(lengthDelta, true)} м</strong>, а длину измеренных крутых интервалов — на <strong>{format(steepDelta, true)} м</strong>.</p>}
            <RouteOverview direct={result.routes.direct} detour={result.routes.detour}/>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Результаты сравнения">
              <table>
                <caption>Разница: обходной минус прямой</caption>
                <thead><tr><th scope="col">Показатель</th><th scope="col">Прямой</th><th scope="col">Обходной</th><th scope="col">Разница</th></tr></thead>
                <tbody>{result.rows.map(row => <tr key={row.label}>
                  <th scope="row">{row.label}{row.unit && `, ${row.unit}`}</th>
                  <td>{format(row.direct)}</td><td>{format(row.detour)}</td><td>{format(row.delta, true)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <p className="table-note">Уклон и набор высоты рассчитаны по измеренным интервалам. «—» означает отсутствие измерений. Крутизна определяется по порогам из экспорта.</p>
          </>}
        </div>
      </div>
    </section>
  )
}

function App() {
  const [comparison, setComparison] = useState<RouteComparison | null>(null)
  const [terrain, setTerrain] = useState<MarsTerrain | null>(null)
  const [mapError, setMapError] = useState('')
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

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#map" aria-label="Jezero Traverse — к карте">
          <span className="brand-mark" aria-hidden="true"><span>◈</span></span>
          <span className="brand-title">JEZERO <em>TRAVERSE</em><small>MISSION PLANNING SYSTEM</small></span>
        </a>
        <nav className="topnav" aria-label="Разделы">
          <a href="#map">Карта поверхности</a>
          <a href="#compare">Сравнение маршрутов</a>
        </nav>
        <span className="header-mode"><span className="online-indicator"/> MARS / SIMULATION</span>
      </header>
      <main className="main-content">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">NASA SPACE APPS CHALLENGE · 2026</span>
            <h1>Навигация по <span>красной планете.</span></h1>
            <p>Исследуйте западную дельту кратера Езеро с картой реального рельефа, научными ориентирами и координатами каждого участка.</p>
          </div>
          <div className="hero-stats">
            <div><small>ПЛАНЕТА</small><strong>MARS</strong></div>
            <div><small>ИССЛЕДУЕМЫЙ УЧАСТОК</small><strong>JEZERO DELTA</strong></div>
            <div><small>ИСТОЧНИК</small><strong>NASA / USGS</strong></div>
          </div>
        </section>
        {mapError && <section className="load-state" role="alert">
          <h2>Не удалось загрузить поверхность</h2>
          <p>{mapError}</p>
          <p>Для запуска откройте приложение через <code>npm.cmd run dev</code>, не через <code>file://</code>. Проверьте наличие <code>public/data/jezero/</code>.</p>
        </section>}
        {!terrain && !mapError && <section className="load-state" role="status" aria-live="polite">
          <div className="loading-ring" aria-hidden="true"/><p>Загрузка геопривязанной DEM Езеро…</p>
        </section>}
        {terrain && <MarsMap terrain={terrain} routes={mapSourceMatches ? comparison?.routes : undefined}
          routeStepM={mapSourceMatches ? comparison?.source.step : undefined}/>}
        {comparison && terrain && !mapSourceMatches && <p className="alert" role="status">Маршруты не показаны на карте: не подтверждено совпадение исходной DEM и марсианской проекции. Сравнение чисел ниже остаётся доступным.</p>}
        <RouteComparisonPanel onComparison={setComparison}/>
        <footer className="page-footer"><span>JEZERO TRAVERSE © 2026</span>
          <span>DEMONSTRATION ONLY · NOT AN EVA SAFETY SYSTEM</span>
          <a href="https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif" target="_blank" rel="noopener noreferrer">Источник USGS ↗</a>
        </footer>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App/>)
