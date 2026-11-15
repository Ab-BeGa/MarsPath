import { regionCoordinates } from './RegionSummary.tsx'
import { useEffect, useState, type ReactNode } from 'react'
import { useI18n } from './i18n.tsx'
import type { DetailedRegion } from './detailedRegions.ts'
import { MolaElevationLegend } from './MolaElevationLegend.tsx'
import { regionText } from './scienceRegionTranslations.ts'

const MAPS = '/data/mars-global'
const RASTERS = {
  mola: { title: 'DEM · MOLA', source: 'NASA Mars Trek · MOLA', url: 'https://astrogeology.usgs.gov/search/map/mars_mgs_mola_global_color_shaded_relief_463m' },
  ctx: { title: 'CTX', source: 'Murray Lab · CTX V01', url: 'https://murray-lab.caltech.edu/CTX/' },
} as const
type Raster = keyof typeof RASTERS
const INITIAL_VIEW = { zoom: 1, x: 0, y: 0 }
const LAYERS = ['mola', 'ctx', 'photos'] as const
type Layer = typeof LAYERS[number]
type Coverage = { bounds: [number, number, number, number]; layers: Partial<Record<Raster, boolean>> }

function clampOffset(offset: number, zoom: number) {
  const limit = (zoom - 1) * 50
  return Math.max(-limit, Math.min(limit, offset))
}

export function RegionalMap({ region, photos }: { region: DetailedRegion; photos: ReactNode }) {
  const { t, format, locale } = useI18n()
  const { lat, lon } = regionCoordinates(region)
  const [layer, setLayer] = useState<Layer>('mola')
  const [coverage, setCoverage] = useState<Coverage>()
  const [loading, setLoading] = useState(true)
  const [failedLayer, setFailedLayer] = useState<Raster>()
  const [view, setView] = useState(INITIAL_VIEW)

  useEffect(() => {
    const controller = new AbortController()
    fetch(MAPS + '/regional_maps.json', { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Regional maps unavailable')
        return response.json() as Promise<Record<string, Coverage>>
      })
      .then(regions => setCoverage(regions[region.id]))
      .catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [region.id])

  const raster = layer === 'photos' ? (coverage?.layers.ctx ? 'ctx' : 'mola') : layer
  const definition = RASTERS[raster]
  const covered = coverage?.layers[raster]
  const showRaster = covered && failedLayer !== raster
  const zoom = (factor: number) => {
    setView(previous => {
      const next = Math.max(1, Math.min(6, previous.zoom * factor))
      return { zoom: next, x: clampOffset(previous.x, next), y: clampOffset(previous.y, next) }
    })
  }
  const resetView = () => {
    setView(INITIAL_VIEW)
  }
  const longitudeSpan = coverage ? coverage.bounds[2] - coverage.bounds[0] : 0
  const widthKm = longitudeSpan * Math.PI / 180 * 3396.19 * Math.cos(region.latitude_deg * Math.PI / 180)
  const renderedResolution = widthKm * 1000 / 768
  const maxScale = widthKm / view.zoom / 4
  const order = maxScale > 0 ? 10 ** Math.floor(Math.log10(maxScale)) : 1
  const scaleKm = Math.floor(maxScale / order) * order
  return <div className="regional-map">
    <div className="map-layout">
      <div className="map-frame">
        <div className="layer-select" role="group" aria-label={t('map.layer.aria')}>
          {LAYERS.map(mode => <button key={mode} type="button"
            aria-pressed={layer === mode}
            className={layer === mode ? 'selected' : ''}
            onClick={() => { setLayer(mode); setFailedLayer(undefined); resetView() }}>
            {mode === 'photos' ? t('map.layer.photos') : RASTERS[mode].title}
          </button>)}
        </div>
        {showRaster ? <div className="regional-stage map-canvas-wrap"><div className="regional-viewport" tabIndex={0} aria-label={t('region.map.controls')}
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return
            if (event.key === '+' || event.key === '=') zoom(1.4)
            else if (event.key === '-') zoom(1 / 1.4)
            else if (event.key === '0') resetView()
            else return
            event.preventDefault()
          }}
          onPointerDown={event => {
            if (event.button !== 0 || event.target !== event.currentTarget) return
            event.preventDefault()
            event.currentTarget.focus({ preventScroll: true })
            if (view.zoom > 1) event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            const rect = event.currentTarget.getBoundingClientRect()
            const extent = rect.width
            setView(previous => {
              return { ...previous, x: clampOffset(previous.x + event.movementX / extent * 100, previous.zoom),
                y: clampOffset(previous.y + event.movementY / extent * 100, previous.zoom) }
            })
          }}>
          <div className="regional-image" style={{ transform: `translate(${view.x}%, ${view.y}%) scale(${view.zoom})` }}>
            <img draggable={false} src={`${MAPS}/regions/${region.id}/${raster}.webp`} alt=""
              onError={() => setFailedLayer(raster)} />
          </div>
          {scaleKm > 0 && <div className="map-scale" style={{ width: `${scaleKm / widthKm * view.zoom * 100}%` }}>
            <span className="scale-stroke" style={{ width: '100%' }}/><span>{t('region.map.scaleKm', {size:format(scaleKm)})}</span></div>}
          <div className="map-controls" aria-label={t('map.zoom.aria')}>
            <button type="button" aria-label={t('map.zoom.in')} disabled={view.zoom === 6} onClick={() => zoom(1.4)}>+</button>
            <span>{format(view.zoom * 100, { maximumFractionDigits: 0 })}%</span>
            <button type="button" aria-label={t('map.zoom.out')} disabled={view.zoom === 1} onClick={() => zoom(1 / 1.4)}>−</button>
            <button type="button" className="reset-map" onClick={resetView}>{t('map.zoom.reset')}</button>
          </div>
          <div className="map-overlay-head"><span className="map-head-indicator"/> {regionText(region,locale,'name')} <small>{lat} · {lon}</small></div>
          <div className="map-compass" aria-hidden="true"><b>↑</b>N</div>
        </div></div> : <p className="regional-layer-note" role="status">
          {loading ? t('region.map.loading') : t('region.map.unavailable')}
        </p>}
      </div>
      <aside className="telemetry" aria-label={t('map.telemetry.aria')}>
        <div className="telemetry-title"><span className="pulse-circle"/> {t('map.telemetry.title')} <span>{t('map.telemetry.subtitle')}</span></div>
        <div className="telemetry-block">
          <span className="telemetry-label">{t('map.telemetry.center')}</span>
          <strong>{regionText(region,locale,'name')}</strong>
          <span className="telemetry-muted">{regionText(region,locale,'type')}</span>
        </div>
        <div className="telemetry-block">
          <span className="telemetry-label">{t('map.telemetry.coordinates')}</span>
          <div className="coord-pair"><span>{t('map.telemetry.lat')}</span><strong>{lat}</strong></div>
          <div className="coord-pair"><span>{t('map.telemetry.lon')}</span><strong>{lon}</strong></div>
        </div>
        {coverage && <div className="telemetry-block bottom">
          <div className="coord-pair"><span>{t('map.telemetry.area')}</span><strong>{t('region.map.scaleKm', {size:format(widthKm, { maximumFractionDigits: 0 })})} × {t('region.map.scaleKm', {size:format((coverage.bounds[3] - coverage.bounds[1]) * Math.PI / 180 * 3396.19, { maximumFractionDigits: 0 })})}</strong></div>
          {showRaster && <div className="coord-pair"><span>{t('map.source.resolution')}</span><strong>{t('region.map.preview', { size: format(renderedResolution, { maximumFractionDigits: 0 }) })}</strong></div>}
        </div>}
      </aside>
    </div>
    {showRaster && <div className="regional-layer-note">
      <a href={definition.url}>{definition.source}</a>
      {' · '}{t('region.map.preview', { size: format(renderedResolution, { maximumFractionDigits: 0 }) })}
      {raster === 'mola' && <p>{t('region.map.reliefNote')}</p>}
      {raster === 'mola' && layer === 'mola' && <MolaElevationLegend compact />}
    </div>}
    {layer === 'photos' && photos}
  </div>
}
