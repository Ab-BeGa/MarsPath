import type { DetailedRegion } from './detailedRegions.ts'

export function regionCoordinates(region: DetailedRegion) {
  return {
    lat: `${Math.abs(region.latitude_deg).toFixed(3)}° ${region.latitude_deg >= 0 ? 'N' : 'S'}`,
    lon: `${region.longitude_east_deg.toFixed(3)}° E`,
  }
}

export function RegionSummary({ region }: { region: DetailedRegion }) {
  const { lat, lon } = regionCoordinates(region)
  return <div className="region-report-grid">
    <article className="region-report-main">
      <span className="region-report-index">MARS REGION · {region.id.toUpperCase()}</span>
      <h3>{region.summary_ru}</h3>
      <h4>Научное значение</h4>
      <p>{region.science_ru}</p>
      <div className="region-report-warning"><b>Привязка участка</b><p>{region.data_note_ru}</p></div>
    </article>
    <aside className="region-report-sidebar">
      <span className="section-kicker">ТЕЛЕМЕТРИЯ УЧАСТКА</span>
      <dl>
        <div><dt>Тип объекта</dt><dd>{region.feature_type_ru}</dd></div>
        <div><dt>Широта</dt><dd>{lat}</dd></div>
        <div><dt>Долгота</dt><dd>{lon}</dd></div>
        <div><dt>Тип привязки</dt><dd>{region.coordinate_status === 'feature_center' ? 'центр объекта' : 'репрезентативная точка'}</dd></div>
      </dl>
      <div className="region-report-sources"><h4>Проверенные источники</h4>
        {region.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}
      </div>
    </aside>
  </div>
}
