import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useI18n } from './i18n.tsx'
import { loadMarsSites, type MarsSite, type MarsSitesCatalog } from './marsSites.ts'
import {
  normalizeMarsLongitude, visibleMarsSiteClusters,
  type SiteCategoryFilter,
} from './marsSiteMapGeometry.ts'
import { MarsSiteInfoCard } from './MarsSiteInfoCard.tsx'
import { MapPin, SiteMarkerIcon } from './MapPin.tsx'
import { MolaElevationLegend } from './MolaElevationLegend.tsx'
import { loadPhotoCatalog, type JezeroPhoto } from './photoCatalog.ts'
import { PanoramaDialog } from './PanoramaDialog.tsx'
import { clusterPanoramas } from './panoramaClusters.ts'
import { preloadPanoramaImage } from './PanoramaViewer.tsx'
import { loadDetailedRegions, type DetailedRegion } from './detailedRegions.ts'
import { regionText } from './scienceRegionTranslations.ts'
import { siteText } from './scienceSiteTranslations.ts'
import { photoText } from './sciencePhotoTranslations.ts'

type Size = { width: number; height: number }
type Camera = { zoom: number; panX: number; panY: number }
type Drag = { x: number; y: number; panX: number; panY: number; moved: boolean } | null
export type GlobalLayer = 'relief' | 'satellite' | 'color'

const OVERVIEW_URL = '/data/mars-global/mola_global_overview.jpg'
const LAYERS: Record<GlobalLayer, { id: string; extension: 'jpg' | 'png'; maxLevel: number }> = {
  relief: { id: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', extension: 'jpg', maxLevel: 7 },
  satellite: { id: 'msss_atlas_simp_clon', extension: 'png', maxLevel: 6 },
  color: { id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', extension: 'jpg', maxLevel: 7 },
}
const TILE_URL_PREFIX = 'https://trek.nasa.gov/tiles/Mars/EQ'
const MAX_CACHED_TILES = 120
const JEZERO = { longitude: 77.40974302, latitude: 18.45616697 }
const EMPTY_SITES: MarsSite[] = []
const LAYER_SHORT_NAMES: Record<GlobalLayer, string> = { relief: 'MOLA', satellite: 'MOC', color: 'Viking' }

function fitScale(size: Size) { return Math.min(size.width / 512, size.height / 256) }
function tileLevel(zoom: number, maxLevel: number) { return Math.max(0, Math.min(maxLevel, Math.round(Math.log2(zoom)))) }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function constrainPan(camera: Camera, size: Size): Camera {
  const worldWidth = 512 * fitScale(size) * camera.zoom
  const worldHeight = worldWidth / 2
  const limitX = Math.max(0, (worldWidth - size.width) / 2)
  const limitY = Math.max(0, (worldHeight - size.height) / 2)
  return { ...camera, panX: clamp(camera.panX, -limitX, limitX), panY: clamp(camera.panY, -limitY, limitY) }
}

export function MarsGlobalMap({ onOpenRegion, onReturnGlobe, initialLayer = 'relief', onLayerChange }: {
  onOpenRegion: (region: DetailedRegion) => void; onReturnGlobe?: () => void
  initialLayer?: GlobalLayer; onLayerChange?: (layer: GlobalLayer) => void
}) {
  const { t, locale } = useI18n()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overviewRef = useRef<HTMLImageElement | null>(null)
  const tileCache = useRef(new Map<string, HTMLImageElement>())
  const pending = useRef(new Set<string>())
  const failed = useRef(new Set<string>())
  const drag = useRef<Drag>(null)
  const cameraRef = useRef<Camera>({ zoom: 1, panX: 0, panY: 0 })
  const [camera, setCamera] = useState<Camera>({ zoom: 1, panX: 0, panY: 0 })
  const [size, setSize] = useState<Size>({ width: 920, height: 460 })
  const sizeRef = useRef(size)
  const [tileVersion, setTileVersion] = useState(0)
  const [tileError, setTileError] = useState(false)
  const [activeLayer, setActiveLayer] = useState<GlobalLayer>(initialLayer)
  const [expanded, setExpanded] = useState(false)
  const [cursorCoordinates, setCursorCoordinates] = useState<{ longitude: number; latitude: number } | null>(null)
  const [siteCatalog, setSiteCatalog] = useState<MarsSitesCatalog | null>(null)
  const [siteError, setSiteError] = useState('')
  const [siteFilter, setSiteFilter] = useState<SiteCategoryFilter>('all')
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [panoramas, setPanoramas] = useState<JezeroPhoto[]>([])
  const [showPanoramas, setShowPanoramas] = useState(true)
  const [selectedPanorama, setSelectedPanorama] = useState<JezeroPhoto | null>(null)
  const [panoramaGroup, setPanoramaGroup] = useState<JezeroPhoto[]>([])
  const [detailedRegions, setDetailedRegions] = useState<DetailedRegion[]>([])

  const sites = siteCatalog?.sites ?? EMPTY_SITES
  const clusters = useMemo(() =>
    visibleMarsSiteClusters(sites, siteFilter, camera, size),
    [sites, siteFilter, camera, size])
  const selectedGroup = selectedSiteIds
    .map(id => sites.find(site => site.id === id))
    .filter((site): site is MarsSite => site !== undefined)

  const closeSiteDetails = () => {
    setSelectedSiteId(null)
    setSelectedSiteIds([])
  }
  const openSiteGroup = (group: MarsSite[]) => {
    setSelectedSiteIds(group.map(site => site.id))
    setSelectedSiteId(group[0]?.id ?? null)
  }
  const focusSite = (site: MarsSite) => {
    setSiteFilter('all')
    setSelectedSiteIds([site.id])
    setSelectedSiteId(site.id)
    setCamera(current => {
      const zoom = Math.max(4, current.zoom)
      const worldWidth = 512 * fitScale(size) * zoom
      const xFraction = (normalizeMarsLongitude(site.longitude_east_deg) + 180) / 360
      const yFraction = (90 - site.latitude_deg) / 180
      return constrainPan({
        zoom,
        panX: (0.5 - xFraction) * worldWidth,
        panY: (0.5 - yFraction) * (worldWidth / 2),
      }, size)
    })
  }

  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  useEffect(() => {
    let active = true
    void loadMarsSites('/data/mars-global/sites.json')
      .then(catalogue => { if (active) setSiteCatalog(catalogue) })
      .catch(cause => {
        if (active) setSiteError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    void loadDetailedRegions().then(catalog => { if (active) setDetailedRegions(catalog.regions) })
      .catch(cause => { if (active) setSiteError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      loadPhotoCatalog('/data/jezero/photos.json'),
      loadPhotoCatalog('/data/mars-global/panoramas.json'),
    ]).then(([jezeroCatalogue, globalCatalogue]) => {
      if (active) setPanoramas([...jezeroCatalogue.records, ...globalCatalogue.records]
        .filter(photo => photo.coordinates && /panorama|degree|градус/i.test(`${photo.title} ${photo.caption}`)))
    }).catch(cause => { if (active) setSiteError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const image = new Image()
    image.onload = () => { overviewRef.current = image; setTileVersion(value => value + 1) }
    image.src = OVERVIEW_URL
    return () => { image.onload = null }
  }, [])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (selectedSiteId) closeSiteDetails()
      else setExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [expanded, selectedSiteId])

  useEffect(() => {
    if (expanded || !selectedSiteId) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeSiteDetails()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded, selectedSiteId])

  useEffect(() => {
    const element = wrapperRef.current
    if (!element) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) {
        const next = { width: rect.width, height: rect.height }
        const previous = sizeRef.current
        const scaleRatio = fitScale(next) / fitScale(previous)
        sizeRef.current = next
        if (Number.isFinite(scaleRatio) && Math.abs(scaleRatio - 1) > 1e-4) {
          setCamera(current => constrainPan({ ...current, panX: current.panX * scaleRatio, panY: current.panY * scaleRatio }, next))
        }
        setSize(next)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const image = overviewRef.current
    if (!canvas || !image) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    ctx.fillStyle = '#151016'
    ctx.fillRect(0, 0, size.width, size.height)

    const layer = LAYERS[activeLayer]
    const level = tileLevel(camera.zoom, layer.maxLevel)
    const worldWidth = 512 * fitScale(size) * camera.zoom
    const worldHeight = worldWidth / 2
    const left = size.width / 2 + camera.panX - worldWidth / 2
    const top = size.height / 2 + camera.panY - worldHeight / 2
    const sourceWorldWidth = 512 * (2 ** level)
    const sourceWorldHeight = 256 * (2 ** level)
    const tileScale = worldWidth / sourceWorldWidth

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // Use the cached MOLA view only for the relief mode; optical/color modes
    // keep unobserved pixels visibly empty instead of blending another layer.
    if (activeLayer === 'relief') ctx.drawImage(image, left, top, worldWidth, worldHeight)

    if (level > 0 || activeLayer !== 'relief') {
      const tileSize = 256 * tileScale
      const cols = 2 ** (level + 1)
      const rows = 2 ** level
      const minCol = clamp(Math.floor((0 - left) / tileSize), 0, cols - 1)
      const maxCol = clamp(Math.floor((size.width - left) / tileSize), 0, cols - 1)
      const minRow = clamp(Math.floor((0 - top) / tileSize), 0, rows - 1)
      const maxRow = clamp(Math.floor((size.height - top) / tileSize), 0, rows - 1)

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const key = `${layer.id}:${level}/${row}/${col}`
          let tile = tileCache.current.get(key)
          if (!tile && !pending.current.has(key) && !failed.current.has(key)) {
            tile = new Image()
            pending.current.add(key)
            tile.onload = () => {
              pending.current.delete(key)
              tileCache.current.delete(key)
              tileCache.current.set(key, tile!)
              while (tileCache.current.size > MAX_CACHED_TILES) {
                const oldest = tileCache.current.keys().next().value
                if (oldest === undefined) break
                tileCache.current.delete(oldest)
              }
              setTileVersion(value => value + 1)
            }
            tile.onerror = () => {
              pending.current.delete(key)
              failed.current.add(key)
              setTileError(true)
            }
            tile.src = `${TILE_URL_PREFIX}/${layer.id}/1.0.0/default/default028mm/${level}/${row}/${col}.${layer.extension}`
          }
          if (tile?.complete && tile.naturalWidth > 0) {
            ctx.drawImage(tile, left + col * tileSize, top + row * tileSize, tileSize, tileSize)
          }
        }
      }
    }

    // Equirectangular graticule: longitude is positive east, latitude is planetocentric.
    ctx.save()
    ctx.strokeStyle = 'rgba(233,245,250,.23)'
    ctx.lineWidth = 1
    for (let lon = -150; lon <= 180; lon += 30) {
      const x = left + ((lon + 180) / 360) * worldWidth
      ctx.beginPath(); ctx.moveTo(x, Math.max(0, top)); ctx.lineTo(x, Math.min(size.height, top + worldHeight)); ctx.stroke()
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = top + ((90 - lat) / 180) * worldHeight
      ctx.beginPath(); ctx.moveTo(Math.max(0, left), y); ctx.lineTo(Math.min(size.width, left + worldWidth), y); ctx.stroke()
    }

    ctx.restore()
  }, [activeLayer, camera, size, tileVersion])

  useEffect(() => { draw() }, [draw])

  const layerMaxZoom = 2 ** LAYERS[activeLayer].maxLevel
  const zoomAt = useCallback((factor: number, x: number, y: number) => {
    setCamera(current => {
      const zoom = clamp(current.zoom * factor, 1, layerMaxZoom)
      const ratio = zoom / current.zoom
      return constrainPan({
        zoom,
        panX: x - size.width / 2 - (x - size.width / 2 - current.panX) * ratio,
        panY: y - size.height / 2 - (y - size.height / 2 - current.panY) * ratio,
      }, size)
    })
  }, [layerMaxZoom, size.width, size.height])

  const zoomToJezero = useCallback(() => {
    const zoom = 16
    const worldWidth = 512 * fitScale(size) * zoom
    const worldHeight = worldWidth / 2
    const xFraction = (JEZERO.longitude + 180) / 360
    const yFraction = (90 - JEZERO.latitude) / 180
    setCamera(constrainPan({
      zoom,
      panX: (0.5 - xFraction) * worldWidth,
      panY: (0.5 - yFraction) * worldHeight,
    }, size))
  }, [size])

  const worldPosition = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    const worldWidth = 512 * fitScale(size) * cameraRef.current.zoom
    const worldHeight = worldWidth / 2
    const left = size.width / 2 + cameraRef.current.panX - worldWidth / 2
    const top = size.height / 2 + cameraRef.current.panY - worldHeight / 2
    const x = (clientX - rect.left - left) / worldWidth
    const y = (clientY - rect.top - top) / worldHeight
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { longitude: x * 360 - 180, latitude: 90 - y * 180 }
  }, [size])

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, panX: camera.panX, panY: camera.panY, moved: false }
  }

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const active = drag.current
    if (active) {
      const dx = event.clientX - active.x
      const dy = event.clientY - active.y
      if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true
      if (active.moved) setCamera(current => constrainPan({ ...current, panX: active.panX + dx, panY: active.panY + dy }, size))
    }
    const position = worldPosition(event.clientX, event.clientY)
    setCursorCoordinates(position)
  }

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const active = drag.current
    if (active && !active.moved) {
      const point = worldPosition(event.clientX, event.clientY)
      if (point && Math.abs(point.longitude - JEZERO.longitude) < 5 && Math.abs(point.latitude - JEZERO.latitude) < 5) zoomToJezero()
    }
    drag.current = null
  }

  const handleKeys = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault(); zoomAt(2, size.width / 2, size.height / 2)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault(); zoomAt(.5, size.width / 2, size.height / 2)
    } else if (event.key === '0') {
      event.preventDefault(); setCamera({ zoom: 1, panX: 0, panY: 0 })
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      const distance = 48
      const dx = event.key === 'ArrowLeft' ? distance : event.key === 'ArrowRight' ? -distance : 0
      const dy = event.key === 'ArrowUp' ? distance : event.key === 'ArrowDown' ? -distance : 0
      setCamera(current => constrainPan({ ...current, panX: current.panX + dx, panY: current.panY + dy }, size))
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoomAt(event.deltaY < 0 ? 1.5 : 1 / 1.5, event.clientX - rect.left, event.clientY - rect.top)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const level = tileLevel(camera.zoom, LAYERS[activeLayer].maxLevel)
  const markerWorldWidth = 512 * fitScale(size) * camera.zoom
  const markerWorldHeight = markerWorldWidth / 2
  const markerLeft = size.width / 2 + camera.panX - markerWorldWidth / 2
  const markerTop = size.height / 2 + camera.panY - markerWorldHeight / 2
  const detailedRegionMarkers = detailedRegions.map(region => ({region,
    x: markerLeft + ((normalizeMarsLongitude(region.longitude_east_deg) + 180) / 360) * markerWorldWidth,
    y: markerTop + ((90 - region.latitude_deg) / 180) * markerWorldHeight,
  })).filter(marker => marker.x >= 0 && marker.x <= size.width && marker.y >= 0 && marker.y <= size.height)
  const panoramaMarkers = panoramas.map(panorama => {
    const coordinates = panorama.coordinates!
    return {
      panorama,
      x: markerLeft + ((normalizeMarsLongitude(coordinates.longitude_deg) + 180) / 360) * markerWorldWidth,
      y: markerTop + ((90 - coordinates.latitude_deg) / 180) * markerWorldHeight,
    }
  }).filter(marker => marker.x >= 0 && marker.x <= size.width && marker.y >= 0 && marker.y <= size.height)
  const panoramaClusters = clusterPanoramas(panoramaMarkers.map(marker => ({item:marker.panorama,x:marker.x,y:marker.y})), 36)
  return (
    <section ref={cardRef} className={`global-map-card${expanded ? ' is-expanded' : ''}`} aria-labelledby="global-map-title">
      <div className="global-map-heading">
        <div>
          <span className="section-kicker">{t('map.global.kicker')}</span>
          <h3 id="global-map-title">{t('map.global.title')}</h3>
          <p>{t('map.global.description')}</p>
        </div>
        <div className="global-map-actions">
          {onReturnGlobe && <button type="button" className="global-map-detail" onClick={onReturnGlobe}>{t('globe.return3d')}</button>}
          <button type="button" className="global-map-jump" onClick={zoomToJezero}>{t('map.global.zoomJezero')}</button>
        </div>
      </div>
      <div className="global-map-frame">
        <div className="global-map-layers" role="group" aria-label={t('map.global.layerSelect')}>
          {(['relief', 'satellite', 'color'] as GlobalLayer[]).map(layer => (
            <button key={layer} type="button" className={activeLayer === layer ? 'selected' : ''}
              aria-pressed={activeLayer === layer} onClick={() => {
                setActiveLayer(layer)
                onLayerChange?.(layer)
                setTileError(false)
                setCamera(current => constrainPan({ ...current, zoom: Math.min(current.zoom, 2 ** LAYERS[layer].maxLevel) }, size))
              }}>{t(`map.global.layer.${layer}`)}</button>
          ))}
        </div>
        <div className="global-site-controls" aria-label={t('map.sites.title')}>
          <div className="global-site-filters" role="group" aria-label={t('map.sites.title')}>
            {([
              ['all','map.sites.all'],
              ['landing_site','map.sites.landing'],
              ['science_event','map.sites.science'],
            ] as const).map(([category,label]) => (
              <button type="button" key={category}
                aria-pressed={siteFilter === category}
                onClick={() => {setSiteFilter(category); closeSiteDetails()}}>
                {t(label)}{siteCatalog && <span> ({category === 'all' ? sites.length :
                  sites.filter(site => site.category === category).length})</span>}
              </button>
            ))}
            <button type="button" className="global-panorama-filter" aria-pressed={showPanoramas}
              onClick={() => { setShowPanoramas(value => !value); setSelectedPanorama(null) }}>
              360° {t('globe.panoramas')} ({panoramas.length})
            </button>
          </div>
          <label className="global-site-picker">
            <span>{t('map.sites.pick')}</span>
            <select value={selectedSiteId ?? ''} disabled={sites.length === 0}
              onChange={event => {
                const site = sites.find(item => item.id === event.currentTarget.value)
                if (site) focusSite(site)
                else closeSiteDetails()
              }}>
              <option value="">{t('map.sites.pickPlaceholder')}</option>
              {sites.map(site => <option key={site.id} value={site.id}>{siteText(site,locale,'name')}</option>)}
            </select>
          </label>
          {!siteCatalog && !siteError && <span role="status" className="global-site-loading">{t('map.sites.loading')}</span>}
          {siteError && <span role="alert" className="global-site-error">{t('map.sites.loadError')} {siteError}</span>}
        </div>
        <div className="global-map-toolbar" aria-label={t('map.global.controls')}>
          <span>{t('map.global.level', { level, max: LAYERS[activeLayer].maxLevel })}</span>
          <button type="button" aria-label={t('map.zoom.in')} disabled={camera.zoom >= layerMaxZoom}
            onClick={() => zoomAt(2, size.width / 2, size.height / 2)}>+</button>
          <button type="button" aria-label={t('map.zoom.out')} disabled={camera.zoom <= 1}
            onClick={() => zoomAt(.5, size.width / 2, size.height / 2)}>−</button>
          <button type="button" onClick={() => { setCamera({ zoom: 1, panX: 0, panY: 0 }); setTileError(false) }}>
            {t('map.global.fullPlanet')}
          </button>
          <button type="button" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>
            {expanded ? t('map.global.collapse') : t('map.global.expand')}
          </button>
        </div>
        <div className="global-map-image-wrap" ref={wrapperRef}>
          <canvas ref={canvasRef} className="global-map-canvas" tabIndex={0} role="application"
            aria-label={t('map.global.accessibility')}
            onKeyDown={handleKeys}
            onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp} onPointerCancel={() => { drag.current = null }}
            onPointerLeave={() => setCursorCoordinates(null)} />
          <div className="global-region-markers" aria-label={t('globe.detailedRegions')}>
            {detailedRegionMarkers.map(({region,x,y}) => <button key={region.id} type="button"
              className={`global-detailed-region-pin${region.detail_status === 'local_map' ? ' is-local' : ''}`}
              style={{left:x,top:y}} aria-label={t('region.report.open',{name:regionText(region,locale,'name')})}
              title={regionText(region,locale,'name')} onClick={() => {
                onOpenRegion(region)
              }}>
              <MapPin kind={region.detail_status === 'local_map' ? 'local' : 'region'}/>
              <b className="marker-label" aria-hidden="true">{regionText(region,locale,'name')}</b>
            </button>)}
          </div>
          {showPanoramas && <div className="global-panorama-markers" aria-label={t('globe.panoramas')}>
            {panoramaClusters.map(cluster => <button key={cluster.id} type="button"
              className="global-panorama-pin" style={{left:cluster.x,top:cluster.y}}
              aria-label={cluster.items.length > 1 ? t('globe.panorama.cluster',{count:cluster.items.length}) : t('globe.panorama.open',{title:photoText(cluster.items[0],locale,'title')})}
              title={cluster.items.map(item => item.title).join(' / ')}
              onMouseEnter={() => { void preloadPanoramaImage(cluster.items[0].image_url).catch(() => undefined) }}
              onFocus={() => { void preloadPanoramaImage(cluster.items[0].image_url).catch(() => undefined) }}
              onClick={() => { setPanoramaGroup(cluster.items); setSelectedPanorama(cluster.items[0]) }}>
              <MapPin kind={cluster.items.length > 1 ? 'panorama-cluster' : 'panorama'}
                count={cluster.items.length > 1 ? cluster.items.length : undefined}/>
            </button>)}
          </div>}
          <div className="global-site-markers" aria-label={t('map.sites.title')}>
            {clusters.map(cluster => {
              const grouped = cluster.sites.length > 1
              const event = cluster.sites[0].category === 'science_event'
              const mixed = cluster.sites.some(site => site.category !== cluster.sites[0].category)
              const markerClass = mixed ? 'mixed' : event ? 'event' : 'landing'
              return <button key={cluster.id} type="button"
                className={`global-site-pin global-site-pin--${markerClass}`}
                style={{left:cluster.x,top:cluster.y}}
                aria-label={grouped ? t('map.sites.pinGroup',{count:cluster.sites.length}) :
                  t('map.sites.pin',{name:siteText(cluster.sites[0],locale,'name')})}
                aria-pressed={cluster.sites.some(site => site.id === selectedSiteId)}
                title={cluster.sites.map(site => siteText(site,locale,'name')).join(' / ')}
                onClick={() => openSiteGroup(cluster.sites)}>
                <SiteMarkerIcon sites={cluster.sites}/>
              </button>
            })}
          </div>
          {selectedSiteId && selectedGroup.length > 0 &&
            <MarsSiteInfoCard sites={selectedGroup} selectedId={selectedSiteId}
              onSelect={setSelectedSiteId} onClose={closeSiteDetails}/>}
          <div className="global-map-coordinate-note">
            <span>180°W <i>0°</i> 180°E</span>
            <span>{cursorCoordinates ? `${cursorCoordinates.latitude.toFixed(2)}° · ${cursorCoordinates.longitude.toFixed(2)}°E` : LAYER_SHORT_NAMES[activeLayer]}</span>
          </div>
          {activeLayer === 'relief' && <MolaElevationLegend compact/>}
        </div>
        <div className="global-map-help">{t('map.global.help')}</div>
        <div className="global-site-legend">{t('map.sites.legend')}</div>
        <div className="global-site-caption">{t('map.sites.catalogueNote')}</div>
      </div>
      <div className="global-map-caption" role="status">
        {tileError ? t('map.global.tileError') : t(`map.global.caption.${activeLayer}`)}
      </div>
      {selectedPanorama && <PanoramaDialog panoramas={panoramaGroup.length ? panoramaGroup : panoramas} selected={selectedPanorama}
        onSelect={setSelectedPanorama} onClose={() => setSelectedPanorama(null)}/>}
    </section>
  )
}
