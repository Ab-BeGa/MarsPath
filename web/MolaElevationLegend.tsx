import { useI18n } from './i18n.tsx'

export function MolaElevationLegend({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  return <aside className={`mola-elevation-legend${compact ? ' is-compact' : ''}`} aria-label={t('mola.legend.title')}>
    <div className="mola-legend-heading"><strong>{t('mola.legend.title')}</strong><span>{t('mola.legend.unit')}</span></div>
    <div className="mola-legend-scale" aria-hidden="true"/>
    <div className="mola-legend-ticks"><span>−8</span><span>−4</span><span>0</span><span>4</span><span>8</span><span>12</span></div>
    {!compact && <p>{t('mola.legend.note')}</p>}
  </aside>
}
