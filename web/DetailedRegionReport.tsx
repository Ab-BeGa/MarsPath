import { RegionSummary, regionCoordinates } from './RegionSummary.tsx'
import { useEffect, useState } from 'react'
import type { DetailedRegion } from './detailedRegions.ts'
import { loadPhotoCatalog, type JezeroPhoto } from './photoCatalog.ts'
import { RegionalMap } from './RegionalMap.tsx'
import { GaleRoutePlanner } from './GaleRoutePlanner.tsx'
import { PanoramaViewer, preloadPanoramaImage } from './PanoramaViewer.tsx'
import { useI18n } from './i18n.tsx'

export function DetailedRegionReport({ region }: { region: DetailedRegion }) {
  const { t } = useI18n()
  const [panoramas, setPanoramas] = useState<JezeroPhoto[]>([])
  const [selected, setSelected] = useState<JezeroPhoto | null>(null)
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const { lat, lon } = regionCoordinates(region)
  useEffect(() => {
    let active = true
    setSelected(null)
    setCatalogLoaded(false)
    setCatalogError('')
    loadPhotoCatalog('/data/mars-global/panoramas.json').then(catalog => {
      if (!active) return
      const matches = catalog.records.filter(photo => photo.region_id === region.id)
      setPanoramas(matches)
      setCatalogLoaded(true)
    }).catch(error => {
      if (!active) return
      setCatalogError(error instanceof Error ? error.message : String(error))
      setCatalogLoaded(true)
    })
    return () => { active = false }
  }, [region.id])
  return <section className="region-report-section" aria-labelledby="region-report-title">
    <div className="section-heading">
      <div>
        <span className="section-kicker">ПОДРОБНЫЙ ОТЧЁТ / ПРОРАБОТАННЫЙ УЧАСТОК</span>
        <h2 id="region-report-title">{region.name_ru}</h2>
        <p>{region.name} · {region.feature_type_ru}</p>
      </div>
      <span className="data-pill">{lat} · {lon}</span>
    </div>
    <RegionalMap region={region} photos={<section className="region-panorama-section" aria-labelledby="region-panorama-title">
          {selected && <article className="photo-detail-card" aria-labelledby="regional-selected-photo">
            <PanoramaViewer key={selected.id} imageUrl={selected.image_url} previewUrl={selected.thumbnail_url}
              title={selected.title} initialZoom={1} minimumZoom={1} fit="width" />
            <div>
              <div className="photo-card-heading">
                <span>{selected.camera} · {selected.mission}</span>
                <button type="button" className="text-action" onClick={() => setSelected(null)}>{t('map.photos.close')}</button>
              </div>
              <h3 id="regional-selected-photo">{selected.title}</h3>
              <p>{selected.caption}</p>
              <a href={selected.page_url} target="_blank" rel="noreferrer">{t('map.photos.nasaSource')}</a>
            </div>
          </article>}
          <div className="region-panorama-heading">
            <div><span className="section-kicker">ПОВЕРХНОСТЬ / NASA</span><h4 id="region-panorama-title">Панорамы участка</h4></div>
            {panoramas.length > 0 && <span className="data-pill">{panoramas.length} проверено</span>}
          </div>
          {!catalogLoaded && <p className="region-panorama-status">Проверяем каталог панорам…</p>}
          {catalogError && <p className="region-panorama-status" role="alert">{t('map.photos.error', { detail: catalogError })}</p>}
          {catalogLoaded && !catalogError && panoramas.length === 0 && <div className="region-panorama-empty">
            <span aria-hidden="true">◌</span><div><b>Наземная панорама недоступна</b>
              <p>В каталоге пока нет проверенной наземной панорамы для этого участка.</p></div>
          </div>}
          {panoramas.length > 0 && <div className="region-panorama-grid">
            {panoramas.map(panorama => <button key={panorama.id} type="button" aria-pressed={selected?.id === panorama.id}
              onMouseEnter={() => { void preloadPanoramaImage(panorama.image_url).catch(() => undefined) }}
              onFocus={() => { void preloadPanoramaImage(panorama.image_url).catch(() => undefined) }}
              onClick={() => setSelected(panorama)}>
              <img src={panorama.thumbnail_url} alt="" loading="lazy" decoding="async"/>
              <span><small>{panorama.camera}</small><b>{panorama.title}</b><em>{panorama.mission} · Sol {panorama.acquisition.sols.join('–')}</em></span>
            </button>)}
          </div>}
          {region.id === 'oxia-planum' && <details className="regional-orbital-card map-info-card">
            <summary>Орбитальный снимок места посадки ExoMars</summary>
            <a href="https://hirise.lpl.arizona.edu/ESP_088157_1975" target="_blank" rel="noreferrer">
              <img src="/data/mars-global/regions/oxia-planum/hirise.jpg" alt="Орбитальный снимок Оксии, HiRISE" loading="lazy" />
              HiRISE · ESP_088157_1975
            </a>
            <p>NASA/JPL-Caltech/UArizona</p>
            <a href="https://www.esa.int/ESA_Multimedia/Videos/2019/09/Fly_over_the_ExoMars_rover_landing_site" target="_blank" rel="noreferrer">
              Облёт участка по трёхмерной модели ESA
            </a>
          </details>}
        </section>}/>
    {region.id === 'gale-crater' && <GaleRoutePlanner/>}
    <RegionSummary region={region} />
  </section>
}
