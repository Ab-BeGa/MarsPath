import type { DetailedRegion } from './detailedRegions.ts'
import { useI18n } from './i18n.tsx'
import { regionText } from './scienceRegionTranslations.ts'

export function regionCoordinates(region: DetailedRegion) {
  return {
    lat: `${Math.abs(region.latitude_deg).toFixed(3)}° ${region.latitude_deg >= 0 ? 'N' : 'S'}`,
    lon: `${region.longitude_east_deg.toFixed(3)}° E`,
  }
}

export function RegionSummary({ region }: { region: DetailedRegion }) {
  const { t, locale } = useI18n()
  const { lat, lon } = regionCoordinates(region)
  return <div className="region-report-grid">
    <article className="region-report-main">
      <span className="region-report-index">{t('region.summary.kicker')} · {region.id.toUpperCase()}</span>
      <h3>{regionText(region,locale,'summary')}</h3>
      <h4>{t('region.summary.science')}</h4>
      <p>{regionText(region,locale,'science')}</p>
      <div className="region-report-warning"><b>{t('region.summary.location')}</b><p>{regionText(region,locale,'note')}</p></div>
    </article>
    <aside className="region-report-sidebar">
      <span className="section-kicker">{t('region.summary.telemetry')}</span>
      <dl>
        <div><dt>{t('region.summary.type')}</dt><dd>{regionText(region,locale,'type')}</dd></div>
        <div><dt>{t('region.summary.latitude')}</dt><dd>{lat}</dd></div>
        <div><dt>{t('region.summary.longitude')}</dt><dd>{lon}</dd></div>
        <div><dt>{t('region.summary.coordinateType')}</dt><dd>{t(region.coordinate_status === 'feature_center' ? 'region.summary.featureCenter' : 'region.summary.representative')}</dd></div>
      </dl>
      <div className="region-report-sources"><h4>{t('region.summary.sources')}</h4>
        {region.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}
      </div>
    </aside>
  </div>
}
