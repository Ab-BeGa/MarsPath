import { useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { compareRoutes, type RouteComparison } from './compareRoutes.ts'
import './styles.css'

const normal = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 })
const signed = new Intl.NumberFormat('ru', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

function format(value: number | null, delta = false) {
  return value === null ? '—' : (delta ? signed : normal).format(value)
}

async function readExport(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text())
  } catch {
    throw new Error(`Не удалось прочитать JSON из файла «${file.name}».`)
  }
}

function App() {
  const [result, setResult] = useState<RouteComparison | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  function clearResult() {
    setResult(null)
    setError('')
  }

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
      setResult(compareRoutes(...inputs))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сравнить маршруты.')
    } finally {
      setPending(false)
    }
  }

  const lengthDelta = result?.rows[0].delta
  const steepDelta = result?.rows[4].delta
  return (
    <main>
      <header>
        <p className="project">Jezero Traverse</p>
        <h1>Сравнение маршрутов</h1>
        <p>Загрузите два файла <code>route_waypoints.json</code> из планировщика.</p>
      </header>
      <form onSubmit={submit}>
        <fieldset disabled={pending}>
          <legend>Файлы маршрутов</legend>
          <label>Прямой<input type="file" name="direct" accept=".json,application/json" onChange={clearResult} required /></label>
          <label>Обходной<input type="file" name="detour" accept=".json,application/json" onChange={clearResult} required /></label>
          <button>{pending ? 'Сравниваем…' : 'Сравнить'}</button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      <section aria-live="polite">
        {result && <>
          {!result.demVerified && (
            <p><strong>Источник DEM не подтверждён.</strong> В одном или обоих экспортах отсутствует SHA-256. Для проверки повторите экспорт с одним исходным GeoTIFF.</p>
          )}
          {result.coverage.partial && (
            <p><strong>Сравнение рельефа частичное.</strong> Измерено {format(result.coverage.direct)}% длины прямого маршрута и {format(result.coverage.detour)}% длины обходного. Разница по высоте и уклонам относится к измеренным участкам каждого маршрута.</p>
          )}
          {!result.coverage.partial && lengthDelta != null && steepDelta != null && (
            <p>Обход меняет длину маршрута на <strong>{format(lengthDelta, true)} м</strong>,
              а длину измеренных крутых интервалов на <strong>{format(steepDelta, true)} м</strong>.</p>
          )}
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Результаты сравнения">
            <table>
              <caption>Разница рассчитана как обходной минус прямой</caption>
              <thead><tr><th scope="col">Показатель</th><th scope="col">Прямой</th><th scope="col">Обходной</th><th scope="col">Разница</th></tr></thead>
              <tbody>
                {result.rows.map(row => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}{row.unit && `, ${row.unit}`}</th>
                    <td>{format(row.direct)}</td>
                    <td>{format(row.detour)}</td>
                    <td>{format(row.delta, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>Уклон и набор высоты рассчитаны по измеренным интервалам. «—» означает отсутствие измерений. Крутизна определяется по порогам из экспорта.</p>
        </>}
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
