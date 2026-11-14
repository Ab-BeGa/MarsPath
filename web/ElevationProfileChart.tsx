import { type MouseEvent } from 'react'
import {
  nearestProfileSample, selectedProfileInterval, type RouteElevationProfile,
} from './routeProfile.ts'

const W = 960
const H = 260
const L = 77
const R = 24
const T = 22
const B = 49

const fmt = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 })
const fmt2 = new Intl.NumberFormat('ru', { maximumFractionDigits: 2 })

export function ElevationProfileChart({
  profile, activeRoute, selectedIndex, onSelect,
}: {
  profile: RouteElevationProfile
  activeRoute: 'direct' | 'detour'
  selectedIndex: number | null
  onSelect: (index: number | null) => void
}) {
  const samples = profile.samples
  const valid = samples.filter(s => s.elevation_m !== null)
  const low = valid.length ? Math.min(...valid.map(s => s.elevation_m!)) : -1
  const high = valid.length ? Math.max(...valid.map(s => s.elevation_m!)) : 1
  const margin = Math.max(1, (high - low) * 0.10)
  const minHeight = low - margin
  const maxHeight = high + margin
  const chartW = W - L - R
  const chartH = H - T - B
  const x = (distance: number) => L + (distance / profile.total_m) * chartW
  const y = (height: number) => T + (maxHeight - height) / (maxHeight - minHeight) * chartH
  const active = selectedIndex === null ? null : samples[selectedIndex]
  const interval = selectedIndex === null ? null : selectedProfileInterval(profile, selectedIndex)
  const visibleIntervals = samples.slice(1).map((next, i) => ({ prev: samples[i], next, i }))
    .filter(({ prev, next }) => prev.elevation_m !== null && next.elevation_m !== null)
  const tickDistances = [0, profile.total_m / 2, profile.total_m]

  const selectByMouse = (event: MouseEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, ((event.clientX - box.left) / box.width * W - L) / chartW))
    onSelect(nearestProfileSample(profile, ratio * profile.total_m))
  }

  const slope = interval && interval.from.elevation_m !== null && interval.to.elevation_m !== null
    ? Math.atan(Math.abs(interval.to.elevation_m - interval.from.elevation_m) /
      (interval.to.distance_m - interval.from.distance_m)) * 180 / Math.PI
    : null

  return (
    <section className="elevation-profile-panel" aria-labelledby="elevation-profile-heading">
      <div className="elevation-profile-head">
        <div>
          <h3 id="elevation-profile-heading">Профиль высот · {activeRoute === 'direct' ? 'прямой маршрут' : 'обходной маршрут'}</h3>
          <p>Измерения по компактной USGS CTX DEM 20 м/пиксель. Нажми точку графика или используй ползунок.</p>
        </div>
        <span>{samples.length} отсчётов · {fmt.format(profile.total_m)} м</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="elevation-profile-svg"
        role="img" aria-label="Высота по расстоянию вдоль маршрута. Нажмите на график для выбора точки.">
        <rect x={L} y={T} width={chartW} height={chartH} fill="#0b1f2c" />
        {[0, 0.5, 1].map(f => {
          const z = minHeight + f * (maxHeight - minHeight)
          return <g key={f}>
            <line x1={L} x2={W-R} y1={y(z)} y2={y(z)} stroke="#405766" strokeDasharray="4 7" opacity=".7" />
            <text x={L-11} y={y(z)+4} textAnchor="end" fill="#a8c1cd" fontSize="12">{fmt.format(z)}</text>
          </g>
        })}
        {tickDistances.map((distance, i) => <g key={i}>
          <line x1={x(distance)} x2={x(distance)} y1={T} y2={H-B} stroke="#38515e" opacity=".5" />
          <text x={x(distance)} y={H-24} textAnchor="middle" fill="#acc4cf" fontSize="12">{fmt.format(distance)} м</text>
        </g>)}
        <text x={15} y={14} fill="#acc4cf" fontSize="12">Высота, м</text>
        {visibleIntervals.map(({ prev, next, i }) => (
          <line key={i} x1={x(prev.distance_m)} y1={y(prev.elevation_m!)}
            x2={x(next.distance_m)} y2={y(next.elevation_m!)}
            stroke="#55efc4" strokeWidth="2.5" strokeLinecap="round" />
        ))}
        {interval && <rect x={x(interval.from.distance_m)}
          y={T} width={Math.max(1, x(interval.to.distance_m) - x(interval.from.distance_m))}
          height={chartH} fill="#ffd27d" opacity=".15" />}
        {active && <>
          <line x1={x(active.distance_m)} x2={x(active.distance_m)} y1={T} y2={H-B}
            stroke="#ffffff" strokeWidth="1.5" strokeDasharray="5 4" />
          {active.elevation_m !== null &&
            <circle cx={x(active.distance_m)} cy={y(active.elevation_m)}
              r="6" stroke="#07121e" strokeWidth="2" fill="#ffd27d" />}
        </>}
        <rect x={L} y={T} width={chartW} height={chartH}
          fill="transparent" className="elevation-profile-hit" onClick={selectByMouse} />
      </svg>
      <div className="elevation-profile-controls">
        <label htmlFor="profile-sample-slider">Выбрать отсчёт маршрута</label>
        <input id="profile-sample-slider" type="range" min={0} max={samples.length-1}
          step={1} value={selectedIndex ?? 0}
          onChange={event => onSelect(Number(event.currentTarget.value))} />
        <button type="button" onClick={() => onSelect(null)} disabled={selectedIndex === null}>
          Снять выделение
        </button>
      </div>
      <p className="elevation-profile-reading" role="status">
        {active
          ? <>{fmt.format(active.distance_m)} м от базы · Высота: <strong>{active.elevation_m === null ? 'нет данных' : `${fmt2.format(active.elevation_m)} м`}</strong>
              {' · '}Измеренный уклон интервала: <strong>{slope === null ? 'неизвестен' : `${fmt2.format(slope)}°`}</strong>
              {' · '}Статус: {active.status}</>
          : 'Выбери точку на профиле: соответствующий интервал и отсчёт будут подсвечены на карте выше.'}
      </p>
      <p className="elevation-profile-note">Высоты считываются из ячеек DEM без интерполяции; разрывы означают неизвестные данные. Это не оценка безопасности EVA.</p>
    </section>
  )
}
