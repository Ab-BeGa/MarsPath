import { useState, type FormEvent } from 'react'
import {
  SLOPE_COLORS, validateSlopeThresholds,
  type SlopeBand, type SlopeReport, type SlopeThresholds,
} from './routeSlopes.ts'

const W = 1080
const H = 246
const L = 80
const R = 28
const T = 23
const B = 62
const format = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 })
const categories: { band: SlopeBand; name: string }[] = [
  { band: 'gentle', name: 'Пологий' },
  { band: 'moderate', name: 'Умеренный' },
  { band: 'steep', name: 'Крутой' },
  { band: 'very_steep', name: 'Очень крутой' },
  { band: 'unknown', name: 'Нет данных' },
]

export function RouteSlopePanel({
  report, routeName, thresholds, onThresholdsChange, highlightEnabled, onToggle,
}: {
  report: SlopeReport
  routeName: 'direct' | 'detour'
  thresholds: SlopeThresholds
  onThresholdsChange: (next: SlopeThresholds) => void
  highlightEnabled: boolean
  onToggle: (next: boolean) => void
}) {
  const [draft, setDraft] = useState<[string, string, string]>([
    String(thresholds.gentle_max_deg),
    String(thresholds.moderate_max_deg),
    String(thresholds.steep_max_deg),
  ])
  const [error, setError] = useState('')
  const known = report.samples.filter(s => s.elevation_m !== null)
  const minZ = known.reduce((v, s) => Math.min(v, s.elevation_m!), Infinity)
  const maxZ = known.reduce((v, s) => Math.max(v, s.elevation_m!), -Infinity)
  const pad = known.length ? Math.max(2, (maxZ - minZ) * 0.10) : 2
  const low = known.length ? minZ - pad : -2
  const high = known.length ? maxZ + pad : 2
  const chartW = W - L - R
  const chartH = H - T - B
  const x = (distance: number) => L + distance / report.total_m * chartW
  const y = (value: number) => T + (high - value) / (high - low) * chartH

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const vals = draft.map(s => s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')))
      const next = validateSlopeThresholds({
        gentle_max_deg: vals[0],
        moderate_max_deg: vals[1],
        steep_max_deg: vals[2],
      })
      onThresholdsChange(next)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Некорректные пороги')
    }
  }

  return (
    <section className="slope-panel" aria-labelledby="slope-panel-title">
      <div className="slope-panel-heading">
        <div>
          <span className="section-kicker">ROUTE SLOPE ANALYSIS / EXPERIMENTAL</span>
          <h3 id="slope-panel-title">Крутизна маршрута · {routeName === 'direct' ? 'прямой путь' : 'обход A*'}</h3>
          <p>Высотный профиль по реальным ячейкам DEM. Цвет каждого измеренного интервала отражает продольный уклон, а не безопасность прохождения.</p>
        </div>
        <label className="slope-toggle">
          <input type="checkbox" checked={highlightEnabled} onChange={e => onToggle(e.currentTarget.checked)}/>
          <span>Подсветка на карте</span>
        </label>
      </div>

      <div className="slope-statistics">
        <div><span>Длина маршрута</span><strong>{format.format(report.total_m)} м</strong></div>
        <div><span>Крутые (более {thresholds.moderate_max_deg}°)</span>
          <strong className="slope-orange">{format.format(report.difficult_m)} м</strong></div>
        <div><span>Без данных</span><strong>{format.format(report.unknown_m)} м</strong></div>
        <div><span>Интервалы</span><strong>{report.intervals.length}</strong></div>
      </div>

      <svg viewBox={'0 0 ' + W + ' ' + H} className="slope-profile-chart" role="img"
        aria-label="Высотный профиль выбранного маршрута. Цветные сегменты показывают измеренный продольный уклон; серые метки означают отсутствие данных.">
        <rect x={L} y={T} width={chartW} height={chartH} fill="#0a1c29"/>
        {[0, .5, 1].map(f => {
          const z = low + f * (high - low)
          return <g key={f}>
            <line x1={L} x2={W-R} y1={y(z)} y2={y(z)}
              stroke="#3d5563" strokeDasharray="5 7" opacity=".7"/>
            <text x={L-12} y={y(z)+4} textAnchor="end" fill="#b5cad4" fontSize="12">
              {format.format(z)}
            </text>
          </g>
        })}
        {[0, .25, .5, .75, 1].map(f => <g key={f}>
          <line x1={x(report.total_m*f)} x2={x(report.total_m*f)}
            y1={T} y2={H-B} stroke="#3e5360" strokeWidth="1" opacity=".4"/>
          <text x={x(report.total_m*f)} y={H-28} textAnchor="middle"
            fill="#b5cad4" fontSize="12">{format.format(report.total_m*f)} м</text>
        </g>)}
        <text x={10} y={15} fill="#b5cad4" fontSize="12">Высота DEM, м</text>
        {report.intervals.map((segment, i) =>
          segment.band === 'unknown'
            ? <rect key={i} x={x(segment.from.distance_m)}
                y={H-B-6} width={Math.max(1, x(segment.to.distance_m)-x(segment.from.distance_m))}
                height={6} fill={SLOPE_COLORS.unknown}>
                <title>Нет высотных данных · {format.format(segment.distance_m)} м</title>
              </rect>
            : <line key={i} x1={x(segment.from.distance_m)} y1={y(segment.from.elevation_m!)}
                x2={x(segment.to.distance_m)} y2={y(segment.to.elevation_m!)}
                stroke={SLOPE_COLORS[segment.band]} strokeWidth="4" strokeLinecap="round">
                <title>{format.format(segment.grade_deg!)}° · {format.format(segment.distance_m)} м</title>
              </line>
        )}
      </svg>

      <div className="slope-legend" aria-label="Легенда продольных уклонов">
        {categories.map(({band, name}) => <div key={band} className="slope-legend-entry">
          <i aria-hidden="true" style={{ backgroundColor: SLOPE_COLORS[band] }}/>
          <span>{name}</span><strong>{format.format(report.distances_m[band])} м</strong>
        </div>)}
      </div>

      <form className="slope-settings" onSubmit={apply}>
        <fieldset>
          <legend>Настраиваемые границы категорий, градусы</legend>
          {(['Пологий ≤', 'Умеренный ≤', 'Крутой ≤'] as const).map((name, i) =>
            <label key={name}>{name}
              <input type="number" inputMode="decimal" step="0.1" min="0.1" max="89.9"
                aria-label={name} value={draft[i]}
                onChange={e => setDraft(prev => {
                  const updated = [...prev] as [string,string,string]
                  updated[i] = e.currentTarget.value
                  return updated
                })}/>
            </label>
          )}
          <button type="submit">Применить пороги</button>
          <button type="button" className="slope-preset"
            onClick={() => {
              const defaults = {gentle_max_deg: 5, moderate_max_deg: 10, steep_max_deg: 15}
              setDraft(['5','10','15'])
              setError('')
              onThresholdsChange(defaults)
            }}>5° / 10° / 15°</button>
        </fieldset>
        {error && <p role="alert" className="slope-validation-error">{error}</p>}
      </form>
      <p className="slope-science-note">Пороги — экспериментальные, не спецификация NASA. Оценён только продольный уклон между отсчётами по DEM 20 м/пиксель. Боковой уклон, мелкие камни и пригодность маршрута для EVA не определяются. Неизвестные участки не считаются пологими.</p>
    </section>
  )
}
