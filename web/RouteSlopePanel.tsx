import { useState, type FormEvent } from 'react'
import { useI18n } from './i18n.tsx'
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
const categories: { band: SlopeBand; key: string }[] = [
  { band: 'gentle', key: 'slope.gentle' },
  { band: 'moderate', key: 'slope.moderate' },
  { band: 'steep', key: 'slope.steep' },
  { band: 'very_steep', key: 'slope.verySteep' },
  { band: 'unknown', key: 'slope.unknownBand' },
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
  const {t, format, meters, error: localizeError} = useI18n()
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
          <span className="section-kicker">{t('slope.kicker')}</span>
          <h3 id="slope-panel-title">{t('slope.title')} · {routeName === 'direct' ? t('route.direct.path') : t('route.detour.path')}</h3>
          <p>{t('slope.description')}</p>
        </div>
        <label className="slope-toggle">
          <input type="checkbox" checked={highlightEnabled} onChange={e => onToggle(e.currentTarget.checked)}/>
          <span>{t('slope.toggle')}</span>
        </label>
      </div>

      <div className="slope-statistics">
        <div><span>{t('slope.length')}</span><strong>{meters(report.total_m)}</strong></div>
        <div><span>{t('slope.steepLonger', {threshold:thresholds.moderate_max_deg})}</span>
          <strong className="slope-orange">{meters(report.difficult_m)}</strong></div>
        <div><span>{t('slope.unknown')}</span><strong>{meters(report.unknown_m)}</strong></div>
        <div><span>{t('slope.intervals')}</span><strong>{report.intervals.length}</strong></div>
      </div>

      <svg viewBox={'0 0 ' + W + ' ' + H} className="slope-profile-chart" role="img"
        aria-label={t('slope.aria')}>
        <rect x={L} y={T} width={chartW} height={chartH} fill="#0a1c29"/>
        {[0, .5, 1].map(f => {
          const z = low + f * (high - low)
          return <g key={f}>
            <line x1={L} x2={W-R} y1={y(z)} y2={y(z)}
              stroke="#3d5563" strokeDasharray="5 7" opacity=".7"/>
            <text x={L-12} y={y(z)+4} textAnchor="end" fill="#b5cad4" fontSize="12">
              {format(z)}
            </text>
          </g>
        })}
        {[0, .25, .5, .75, 1].map(f => <g key={f}>
          <line x1={x(report.total_m*f)} x2={x(report.total_m*f)}
            y1={T} y2={H-B} stroke="#3e5360" strokeWidth="1" opacity=".4"/>
          <text x={x(report.total_m*f)} y={H-28} textAnchor="middle"
            fill="#b5cad4" fontSize="12">{meters(report.total_m*f)}</text>
        </g>)}
        <text x={10} y={15} fill="#b5cad4" fontSize="12">{t('slope.height')}</text>
        {report.intervals.map((segment, i) =>
          segment.band === 'unknown'
            ? <rect key={i} x={x(segment.from.distance_m)}
                y={H-B-6} width={Math.max(1, x(segment.to.distance_m)-x(segment.from.distance_m))}
                height={6} fill={SLOPE_COLORS.unknown}>
                <title>{t('slope.noHeights')} · {meters(segment.distance_m)}</title>
              </rect>
            : <line key={i} x1={x(segment.from.distance_m)} y1={y(segment.from.elevation_m!)}
                x2={x(segment.to.distance_m)} y2={y(segment.to.elevation_m!)}
                stroke={SLOPE_COLORS[segment.band]} strokeWidth="4" strokeLinecap="round">
                <title>{format(segment.grade_deg!)}° · {meters(segment.distance_m)}</title>
              </line>
        )}
      </svg>

      <div className="slope-legend" aria-label={t('slope.legend')}>
        {categories.map(({band, key}) => <div key={band} className="slope-legend-entry">
          <i aria-hidden="true" style={{ backgroundColor: SLOPE_COLORS[band] }}/>
          <span>{t(key)}</span><strong>{meters(report.distances_m[band])}</strong>
        </div>)}
      </div>

      <form className="slope-settings" onSubmit={apply}>
        <fieldset>
          <legend>{t('slope.settings')}</legend>
          {(['slope.gentleLimit', 'slope.moderateLimit', 'slope.steepLimit'] as const).map((name, i) =>
            <label key={name}>{t(name)}
              <input type="number" inputMode="decimal" step="0.1" min="0.1" max="89.9"
                aria-label={t(name)} value={draft[i]}
                onChange={e => setDraft(prev => {
                  const updated = [...prev] as [string,string,string]
                  updated[i] = e.currentTarget.value
                  return updated
                })}/>
            </label>
          )}
          <button type="submit">{t('slope.apply')}</button>
          <button type="button" className="slope-preset"
            onClick={() => {
              const defaults = {gentle_max_deg: 5, moderate_max_deg: 10, steep_max_deg: 15}
              setDraft(['5','10','15'])
              setError('')
              onThresholdsChange(defaults)
            }}>5° / 10° / 15°</button>
        </fieldset>
        {error && <p role="alert" className="slope-validation-error">{localizeError(error)}</p>}
      </form>
      <p className="slope-science-note">{t('slope.note')}</p>
    </section>
  )
}
