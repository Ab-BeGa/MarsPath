import { useEffect, useState } from 'react'
import type { DetailedRegion } from './detailedRegions.ts'
import { loadPhotoCatalog, type JezeroPhoto } from './photoCatalog.ts'
import { PanoramaDialog } from './PanoramaDialog.tsx'
import { preloadPanoramaImage } from './PanoramaViewer.tsx'

export function DetailedRegionReport({ region }: { region: DetailedRegion }) {
  const [panoramas, setPanoramas] = useState<JezeroPhoto[]>([])
  const [selected, setSelected] = useState<JezeroPhoto | null>(null)
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const lat = `${Math.abs(region.latitude_deg).toFixed(3)}° ${region.latitude_deg >= 0 ? 'N' : 'S'}`
  const lon = `${region.longitude_east_deg.toFixed(3)}° E`
  useEffect(() => {
    let active = true
    setSelected(null)
    setCatalogLoaded(false)
    loadPhotoCatalog('/data/mars-global/panoramas.json').then(catalog => {
      if (!active) return
      const matches = catalog.records.filter(photo => photo.region_id === region.id)
      setPanoramas(matches)
      setCatalogLoaded(true)
    }).catch(() => { if (active) { setPanoramas([]); setCatalogLoaded(true) } })
    return () => { active = false }
  }, [region.id])
  return <section id="map" className="region-report-section" aria-labelledby="region-report-title">
    <div className="section-heading">
      <div>
        <span className="section-kicker">ПОДРОБНЫЙ ОТЧЁТ / ПРОРАБОТАННЫЙ УЧАСТОК</span>
        <h2 id="region-report-title">{region.name_ru}</h2>
        <p>{region.name} · {region.feature_type_ru}</p>
      </div>
      <span className="data-pill">{lat} · {lon}</span>
    </div>
    <div className="region-report-grid">
      <article className="region-report-main">
        <span className="region-report-index">MARS REGION · {region.id.toUpperCase()}</span>
        <h3>{region.summary_ru}</h3>
        <div className="region-report-planet" aria-hidden="true"><span>◎</span></div>
        <h4>Научное значение</h4>
        <p>{region.science_ru}</p>
        <div className="region-report-warning"><b>Доступность данных</b><p>{region.data_note_ru}</p></div>
        <section className="region-panorama-section" aria-labelledby="region-panorama-title">
          <div className="region-panorama-heading">
            <div><span className="section-kicker">ПОВЕРХНОСТЬ / NASA</span><h4 id="region-panorama-title">Панорамы участка</h4></div>
            {panoramas.length > 0 && <span className="data-pill">{panoramas.length} проверено</span>}
          </div>
          {!catalogLoaded && <p className="region-panorama-status">Проверяем каталог панорам…</p>}
          {catalogLoaded && panoramas.length === 0 && <div className="region-panorama-empty">
            <span aria-hidden="true">◌</span><div><b>Наземная панорама недоступна</b>
              <p>В этом районе не работала посадочная миссия с панорамной камерой. Орбитальные снимки намеренно не выдаются за вид с поверхности.</p></div>
          </div>}
          {panoramas.length > 0 && <div className="region-panorama-grid">
            {panoramas.map(panorama => <button key={panorama.id} type="button"
              onMouseEnter={() => { void preloadPanoramaImage(panorama.image_url).catch(() => undefined) }}
              onFocus={() => { void preloadPanoramaImage(panorama.image_url).catch(() => undefined) }}
              onClick={() => setSelected(panorama)}>
              <img src={panorama.thumbnail_url} alt="" loading="lazy" decoding="async"/>
              <span><small>{panorama.camera}</small><b>{panorama.title}</b><em>{panorama.mission} · Sol {panorama.acquisition.sols.join('–')}</em></span>
            </button>)}
          </div>}
        </section>
      </article>
      <aside className="region-report-sidebar">
        <span className="section-kicker">ТЕЛЕМЕТРИЯ УЧАСТКА</span>
        <dl>
          <div><dt>Тип объекта</dt><dd>{region.feature_type_ru}</dd></div>
          <div><dt>Широта</dt><dd>{lat}</dd></div>
          <div><dt>Долгота</dt><dd>{lon}</dd></div>
          <div><dt>Тип привязки</dt><dd>{region.coordinate_status === 'feature_center' ? 'центр объекта' : 'репрезентативная точка'}</dd></div>
          <div><dt>Детализация</dt><dd>глобальные MOLA / MOC / Viking</dd></div>
        </dl>
        <div className="region-report-sources"><h4>Проверенные источники</h4>
          {region.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}
        </div>
      </aside>
    </div>
    {selected && <PanoramaDialog panoramas={panoramas} selected={selected} onSelect={setSelected} onClose={() => setSelected(null)}/>}
  </section>
}
