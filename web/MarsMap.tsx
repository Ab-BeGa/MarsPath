import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cellAtGrid, cellAtProjected, marsDegreesToProjected, type MarsTerrain, type TerrainCell } from './marsTerrain.ts'
import { routeToGrid, type RoutePair } from './routeMap.ts'
import { sampleRouteElevation, selectedProfileInterval } from './routeProfile.ts'
import { ElevationProfileChart } from './ElevationProfileChart.tsx'
import { loadCtxOpticalLayer, type CtxOpticalLayer } from './ctxOptical.ts'
import { loadThemisLayer, loadThemisTemperature } from './themisLayer.ts'
import { loadCrismModels, CRISM_MODELS, type CrismModel } from './crismModels.ts'
import { RouteSlopePanel } from './RouteSlopePanel.tsx'
import { useI18n } from './i18n.tsx'
import { loadPhotoCatalog, type JezeroPhoto, type PhotoCatalog } from './photoCatalog.ts'
import { clusterPhotoPoints, filterPhotos } from './photoMap.ts'
import {
  DEFAULT_SLOPE_THRESHOLDS, SLOPE_COLORS, measureRouteSlope,
  type SlopeThresholds,
} from './routeSlopes.ts'

type Camera = { zoom: number; panX: number; panY: number }
type Size = { width: number; height: number }
type Drag = { x: number; y: number; moved: boolean } | null

const coordinate = new Intl.NumberFormat('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 })

const COLOR_STOPS: [number, [number, number, number]][] = [
  [0.00, [45, 27, 32]], [0.22, [94, 53, 51]],
  [0.45, [153, 87, 65]], [0.7, [203, 144, 99]],
  [1.00, [235, 203, 160]],
]
function lerp(a: number, b: number, f: number) { return a + (b - a) * f }
function terrainColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t))
  for (let k = 1; k < COLOR_STOPS.length; k++) {
    const [max, to] = COLOR_STOPS[k]
    if (x <= max) {
      const [min, from] = COLOR_STOPS[k - 1]
      const f = (x - min) / (max - min)
      return [lerp(from[0], to[0], f), lerp(from[1], to[1], f), lerp(from[2], to[2], f)]
    }
  }
  return [235, 203, 160]
}

function createRelief(terrain: MarsTerrain): HTMLCanvasElement {
  const { width, height, pixel_size_m: [cellX, cellY] } = terrain.metadata.grid
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const context = out.getContext('2d')
  if (!context) throw new Error('Браузер не поддерживает Canvas 2D')
  const data = context.createImageData(width, height)
  const { heights, mask, min, max } = terrain
  const at = (row: number, col: number, fallback: number) => {
    if (row < 0 || col < 0 || row >= height || col >= width) return fallback
    const i = row * width + col
    return mask[i] === 1 ? heights[i] : fallback
  }
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const o = i * 4
      if (mask[i] !== 1) {
        data.data.set([13, 27, 39, 255], o)
        continue
      }
      const h = heights[i]
      const [r, g, b] = terrainColor((h - min) / Math.max(0.0001, max - min))
      const dx = (at(row, col + 1, h) - at(row, col - 1, h)) / (2 * cellX)
      const dy = (at(row + 1, col, h) - at(row - 1, col, h)) / (2 * cellY)
      // Illumination is purely visual, not an independently measured data layer.
      const sunlight = Math.max(0.35, Math.min(1.25, 0.89 - dx * 1.8 - dy * 2.1))
      data.data[o] = r * sunlight
      data.data[o + 1] = g * sunlight
      data.data[o + 2] = b * sunlight
      data.data[o + 3] = 255
    }
  }
  context.putImageData(data, 0, 0)
  return out
}

function measure(size: Size, terrain: MarsTerrain, camera: Camera) {
  const { width, height } = terrain.metadata.grid
  const fit = Math.min(size.width / (width + 12), size.height / (height + 12))
  const scale = fit * camera.zoom
  return {
    scale,
    ox: (size.width - width * scale) / 2 + camera.panX,
    oy: (size.height - height * scale) / 2 + camera.panY,
  }
}

function toGridPosition(screenX: number, screenY: number, m: ReturnType<typeof measure>): { col: number; row: number } {
  return { col: (screenX - m.ox) / m.scale, row: (screenY - m.oy) / m.scale }
}

export function MarsMap({ terrain, routes, routeStepM }: { terrain: MarsTerrain; routes?: RoutePair; routeStepM?: number }) {
  const { t, format, meters, error: localizeError } = useI18n()
  const elevation = (v: number | null) => v === null ? t('status.nodata') : meters(v)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scienceButtonRef = useRef<HTMLButtonElement>(null)
  const [size, setSize] = useState<Size>({ width: 920, height: 570 })
  const [camera, setCamera] = useState<Camera>({ zoom: 1, panX: 0, panY: 0 })
  const [activeRoute, setActiveRoute] = useState<'direct' | 'detour'>('direct')
  const [selectedSample, setSelectedSample] = useState<number | null>(null)
  const [slopeThresholds, setSlopeThresholds] = useState<SlopeThresholds>({ ...DEFAULT_SLOPE_THRESHOLDS })
  const [showSlopeHighlights, setShowSlopeHighlights] = useState(true)
  const cameraRef = useRef(camera)
  const [hovered, setHovered] = useState<TerrainCell | null>(null)
  const [optical, setOptical] = useState<CtxOpticalLayer | null>(null)
  const [opticalError, setOpticalError] = useState('')
  const [activeLayer, setActiveLayer] = useState<'relief' | 'ctx' | 'themis' | 'temperature' | 'crism' | 'photos'>('relief')
  const [crism, setCrism] = useState<{ image: HTMLImageElement; labelCell: [number, number] } | null>(null)
  const showPhotos = activeLayer === 'photos'
  const showCtx = activeLayer === 'ctx' && optical !== null
  const showCrism = activeLayer === 'crism' && crism !== null
  const [crismModels, setCrismModels] = useState<Awaited<ReturnType<typeof loadCrismModels>> | null>(null)
  const [crismSelection, setCrismSelection] = useState<CrismModel | 'silica'>('silica')
  const selectedCrismModel = crismSelection === 'silica' ? null : crismModels?.[crismSelection]
  useEffect(() => {
    let current = true
    setCrismModels(null)
    void loadCrismModels(terrain).then(models => {
      if (current) setCrismModels(models)
    }).catch(() => { if (current) setCrismSelection('silica') })
    return () => { current = false }
  }, [terrain])
  useEffect(() => {
    let current = true
    setCrism(null)
    void (async () => {
      const base = './data/jezero/crism_minerals'
      const response = await fetch(base + '.json')
      if (!response.ok) return
      const data = await response.json()
      const { grid, crs_wkt } = terrain.metadata
      if (data.crs_wkt !== crs_wkt || data.width !== grid.width || data.height !== grid.height ||
          !Array.isArray(data.bounds_projected_m) || data.bounds_projected_m.length !== 4 ||
          grid.bounds_projected_m.some((value, index) => value !== data.bounds_projected_m[index])) return
      const labelCell: [number, number] = data.label_cell
      if (!Array.isArray(labelCell) || labelCell.length !== 2 ||
          !labelCell.every((value, axis) => Number.isFinite(value) && value >= 0 && value < [grid.width, grid.height][axis])) return
      const image = new Image()
      image.src = base + '.png'
      await image.decode()
      if (current && image.naturalWidth === grid.width && image.naturalHeight === grid.height) setCrism({ image, labelCell })
    })().catch(() => { if (current) setCrism(null) })
    return () => { current = false }
  }, [terrain])
  const [themis, setThemis] = useState<HTMLImageElement | null>(null)
  const showThemis = activeLayer === 'themis' && themis !== null
  const [temperature, setTemperature] = useState<Awaited<ReturnType<typeof loadThemisTemperature>> | null>(null)
  const showTemperature = activeLayer === 'temperature' && temperature !== null
  const showThemisModes = showThemis || showTemperature
  useEffect(() => {
    let current = true
    setTemperature(null)
    void loadThemisTemperature(terrain).then(layer => {
      if (current) setTemperature(layer)
    }).catch(() => { if (current) setTemperature(null) })
    return () => { current = false }
  }, [terrain])
  const [themisUnavailable, setThemisUnavailable] = useState(false)
  const [photoCatalog, setPhotoCatalog] = useState<PhotoCatalog | null>(null)
  const [photoError, setPhotoError] = useState('')
  const [photoCamera, setPhotoCamera] = useState('')
  const [photoSolMin, setPhotoSolMin] = useState('')
  const [photoSolMax, setPhotoSolMax] = useState('')
  const [selectedPhoto, setSelectedPhoto] = useState<JezeroPhoto | null>(null)
  useEffect(() => {
    let current = true
    setThemis(null)
    setThemisUnavailable(false)
    void loadThemisLayer(terrain).then(image => {
      if (current) setThemis(image)
    }).catch(() => {
      if (current) setThemisUnavailable(true)
    })
    return () => { current = false }
  }, [terrain])
  const [pinned, setPinned] = useState<TerrainCell | null>(null)
  const [scienceOpen, setScienceOpen] = useState(false)
  const dragRef = useRef<Drag>(null)
  const relief = useMemo(() => createRelief(terrain), [terrain])
  const checkpoints = terrain.metadata.checked_points.filter(p => ['base', 'science_target'].includes(p.id))
  const science = checkpoints.find(point => point.id === 'science_target')
  const { grid } = terrain.metadata
  useEffect(() => {
    let current = true
    setPhotoCatalog(null)
    setPhotoError('')
    void loadPhotoCatalog().then(catalog => {
      if (current) setPhotoCatalog(catalog)
    }).catch(error => {
      if (current) setPhotoError(error instanceof Error ? error.message : 'Photo catalog unavailable')
    })
    return () => { current = false }
  }, [])
  const cameraOptions = useMemo(() => Array.from(new Set(photoCatalog?.records.map(photo => photo.camera) ?? [])).sort(), [photoCatalog])
  const filteredPhotos = useMemo(() => filterPhotos(
    photoCatalog?.records ?? [], photoCamera,
    photoSolMin === '' ? null : Number(photoSolMin), photoSolMax === '' ? null : Number(photoSolMax),
  ), [photoCatalog, photoCamera, photoSolMin, photoSolMax])
  const photoPoints = useMemo(() => {
    const measured = measure(size, terrain, camera)
    const [stepX, , left, , stepY, top] = grid.transform
    return filteredPhotos.flatMap(photo => {
      if (!photo.coordinates) return []
      const projected = marsDegreesToProjected(terrain.metadata, photo.coordinates.longitude_deg, photo.coordinates.latitude_deg)
      const col = (projected.x - left) / stepX
      const row = (projected.y - top) / stepY
      if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return []
      return [{ photo, x: measured.ox + col * measured.scale, y: measured.oy + row * measured.scale }]
    })
  }, [filteredPhotos, terrain, grid, size, camera])
  const photoClusters = useMemo(() => clusterPhotoPoints(photoPoints, Math.max(18, 68 / camera.zoom)), [photoPoints, camera.zoom])
  const mappedPhotoIds = new Set(photoPoints.map(point => point.photo.id))
  const unlocatedPhotos = filteredPhotos.filter(photo => photo.coordinates === null)
  const outsideMapPhotos = filteredPhotos.filter(photo => photo.coordinates !== null && !mappedPhotoIds.has(photo.id))
  const photosWithoutMarkers = [...unlocatedPhotos, ...outsideMapPhotos]
  const activeProfile = useMemo(() => {
    if (!routes || routeStepM === undefined) return null
    return sampleRouteElevation(routes[activeRoute], routeStepM, point => {
      const cell = cellAtProjected(terrain, point.x, point.y)
      if (!cell) return { elevation_m: null, status: 'outside_roi' }
      return cell.elevation === null
        ? { elevation_m: null, status: 'nodata' }
        : { elevation_m: cell.elevation, status: 'valid' }
    })
  }, [terrain, routes, routeStepM, activeRoute])
  const safeSelectedIndex = activeProfile && selectedSample !== null &&
    selectedSample >= 0 && selectedSample < activeProfile.samples.length ? selectedSample : null
  useEffect(() => { setSelectedSample(null) }, [routes])
  const state = pinned ?? hovered ?? cellAtGrid(terrain, Math.floor(grid.width / 2), Math.floor(grid.height / 2))
  const kelvin = showTemperature && state ? temperature.kelvinAt(state.col, state.row) : null
  const temperatureText = (value: number) => `${format(value, { maximumFractionDigits: 1 })} K / ${format(value - 273.15, { maximumFractionDigits: 1 })} °C`
  const validPercent = (100 * terrain.validCount / terrain.heights.length).toFixed(1)
  const slopeState = useMemo(() => {
    if (!routes) return { report: null, error: '' }
    try {
      return { report: measureRouteSlope(terrain, routes[activeRoute], slopeThresholds), error: '' }
    } catch (cause) {
      return { report: null, error: cause instanceof Error ? cause.message : 'Не удалось рассчитать уклоны' }
    }
  }, [terrain, routes, activeRoute, slopeThresholds])

  useEffect(() => { cameraRef.current = camera }, [camera])

  useEffect(() => {
    let current = true
    setOptical(null)
    setOpticalError('')
    setActiveLayer('relief')
    void loadCtxOpticalLayer(terrain).then(layer => {
      if (current) setOptical(layer)
    }).catch(error => {
      if (current) setOpticalError(error instanceof Error ? error.message : 'CTX не доступен')
    })
    return () => { current = false }
  }, [terrain])

  useEffect(() => {
    const element = wrapperRef.current
    if (!element) return
    const resize = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect
      if (r && r.width > 0 && r.height > 0) setSize({ width: r.width, height: r.height })
    })
    resize.observe(element)
    return () => resize.disconnect()
  }, [])

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    setCamera(current => {
      const zoom = Math.min(16, Math.max(0.75, current.zoom * factor))
      const ratio = zoom / current.zoom
      return {
        zoom,
        panX: sx - size.width / 2 - (sx - size.width / 2 - current.panX) * ratio,
        panY: sy - size.height / 2 - (sy - size.height / 2 - current.panY) * ratio,
      }
    })
  }, [size.width, size.height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoomAt(event.deltaY < 0 ? 1.17 : 1 / 1.17, event.clientX - rect.left, event.clientY - rect.top)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const getCell = (sx: number, sy: number): TerrainCell | null => {
    const p = toGridPosition(sx, sy, measure(size, terrain, cameraRef.current))
    const [stepX, , left, , stepY, top] = grid.transform
    return cellAtProjected(terrain, left + p.col * stepX, top + p.row * stepY)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    const { width, height } = size
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#07121e'
    ctx.fillRect(0, 0, width, height)

    // Subtle reference grid outside the cropped DEM.
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(117,155,169,.075)'
    for (let x = 0; x < width; x += 46) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke()
    }
    for (let y = 0; y < height; y += 46) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
    }

    const p = measure(size, terrain, camera)
    const iw = grid.width * p.scale
    const ih = grid.height * p.scale
    ctx.save()
    ctx.shadowColor = '#000'
    ctx.shadowBlur = 42
    ctx.fillStyle = '#21171d'
    ctx.fillRect(p.ox, p.oy, iw, ih)
    ctx.restore()
    // Visual smoothing only: the source DEM still contains 20 m cells.
    // CTX is a genuine 5 m orthomosaic aligned to the exact projected DEM
    // bounds; route overlays below stay in the same Mars CRS/camera.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (showCrism) {
      ctx.drawImage(optical?.image ?? relief, p.ox, p.oy, iw, ih)
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(selectedCrismModel?.image ?? crism.image, p.ox, p.oy, iw, ih)
      ctx.restore()
    } else if (showTemperature) {
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(temperature.image, p.ox, p.oy, iw, ih)
      ctx.restore()
    } else if (showThemis) {
      ctx.drawImage(themis, p.ox, p.oy, iw, ih)
    } else if (showCtx) {
      ctx.drawImage(optical.image, p.ox, p.oy, iw, ih)
    } else if (optical) {
      // CTX luminance adds real surface texture to DEM color while preserving
      // elevations, Mars CRS, overlay geometry, and scientific measurements.
      ctx.drawImage(optical.image, p.ox, p.oy, iw, ih)
      ctx.save()
      ctx.globalCompositeOperation = 'color'
      ctx.globalAlpha = 0.86
      ctx.drawImage(relief, p.ox, p.oy, iw, ih)
      ctx.globalCompositeOperation = 'soft-light'
      ctx.globalAlpha = 0.28
      ctx.drawImage(relief, p.ox, p.oy, iw, ih)
      ctx.restore()
    } else {
      ctx.drawImage(relief, p.ox, p.oy, iw, ih)
    }
    ctx.strokeStyle = 'rgba(241,214,165,.8)'
    ctx.lineWidth = 1.2
    ctx.strokeRect(p.ox + .5, p.oy + .5, iw - 1, ih - 1)
    if (camera.zoom >= 2.5) {
      ctx.strokeStyle = 'rgba(234,235,221,.09)'
      for (let col = 0; col <= grid.width; col += 5) {
        ctx.beginPath(); ctx.moveTo(p.ox + col * p.scale, p.oy); ctx.lineTo(p.ox + col * p.scale, p.oy + ih); ctx.stroke()
      }
      for (let row = 0; row <= grid.height; row += 5) {
        ctx.beginPath(); ctx.moveTo(p.ox, p.oy + row * p.scale); ctx.lineTo(p.ox + iw, p.oy + row * p.scale); ctx.stroke()
      }
    }


    // Overlay both exported routes on the *same* DEM affine and camera as the relief.
    // Never substitute Earth WGS84 coordinates or interpolate elevations here.
    if (routes) {
      const ordered = activeRoute === 'direct'
        ? (['detour', 'direct'] as const)
        : (['direct', 'detour'] as const)
      ctx.save()
      ctx.beginPath()
      ctx.rect(p.ox, p.oy, iw, ih)
      ctx.clip()
      for (const routeId of ordered) {
        const vertices = routeToGrid(routes[routeId], grid.transform)
        ctx.beginPath()
        for (let i = 0; i < vertices.length; i++) {
          const px = p.ox + vertices[i].col * p.scale
          const py = p.oy + vertices[i].row * p.scale
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.strokeStyle = routeId === 'direct' ? '#55efc4' : '#ffad5a'
        ctx.lineWidth = routeId === activeRoute ? 5.5 : 3
        ctx.globalAlpha = routeId === activeRoute ? 1 : 0.65
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.shadowColor = '#07121e'
        ctx.shadowBlur = 5
        ctx.stroke()
      }
      ctx.restore()
    }

    // Draw the route grade overlay AFTER both path strokes, BEFORE location
    // markers. Every segment uses real DEM sample heights (not drawn pixels).
    if (routes && slopeState.report && showSlopeHighlights) {
      const [stepX, , left, , stepY, top] = grid.transform
      ctx.save()
      ctx.beginPath()
      ctx.rect(p.ox, p.oy, iw, ih)
      ctx.clip()
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.lineWidth = 6.5
      for (const interval of slopeState.report.intervals) {
        ctx.strokeStyle = SLOPE_COLORS[interval.band]
        ctx.setLineDash(interval.band === 'unknown' ? [6, 6] : [])
        ctx.beginPath()
        ctx.moveTo(p.ox + (interval.from.x - left) / stepX * p.scale,
                   p.oy + (interval.from.y - top) / stepY * p.scale)
        ctx.lineTo(p.ox + (interval.to.x - left) / stepX * p.scale,
                   p.oy + (interval.to.y - top) / stepY * p.scale)
        ctx.stroke()
      }
      ctx.restore()
    }


    // Profile selection is drawn above the experimental slope bands but uses
    // the same Mars DEM projection and map camera.
    if (activeProfile && safeSelectedIndex !== null) {
      const { from, to } = selectedProfileInterval(activeProfile, safeSelectedIndex)
      const segment = routeToGrid([from, to], grid.transform)
      const selected = safeSelectedIndex === 0 ? segment[0] : segment[1]
      const x0 = p.ox + segment[0].col * p.scale
      const y0 = p.oy + segment[0].row * p.scale
      const x1 = p.ox + segment[1].col * p.scale
      const y1 = p.oy + segment[1].row * p.scale
      const sx = p.ox + selected.col * p.scale
      const sy = p.oy + selected.row * p.scale
      ctx.save()
      ctx.beginPath()
      ctx.rect(p.ox, p.oy, iw, ih)
      ctx.clip()
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.strokeStyle = '#ffe2a5'
      ctx.lineWidth = 9
      ctx.lineCap = 'round'
      if (from.elevation_m === null || to.elevation_m === null) ctx.setLineDash([7, 7])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(sx, sy, 13, 0, Math.PI * 2)
      ctx.strokeStyle = '#07121e'
      ctx.lineWidth = 4
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(sx, sy, 11, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.restore()
    }

    const marker = (x: number, y: number, name: string, color: string, id: string) => {
      const px = p.ox + x * p.scale
      const py = p.oy + y * p.scale
      ctx.beginPath()
      ctx.fillStyle = 'rgba(6,16,26,.85)'
      ctx.arc(px, py, 15, 0, 2 * Math.PI); ctx.fill()
      ctx.beginPath()
      ctx.fillStyle = color
      ctx.arc(px, py, 7.5, 0, 2 * Math.PI); ctx.fill()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#fff7e2'
      ctx.stroke()
      ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.fillText(id, px, py - 23)
      ctx.font = '600 12px system-ui, sans-serif'
      const measured = ctx.measureText(name).width
      const bx = Math.max(6, Math.min(width - measured - 22, px + 18))
      const by = Math.max(10, Math.min(height - 30, py - 15))
      ctx.fillStyle = '#06131de8'
      ctx.fillRect(bx, by, measured + 18, 30)
      ctx.fillStyle = '#f1f5f9'
      ctx.textAlign = 'left'
      ctx.fillText(name, bx + 9, by + 19)
    }

    if (showCrism && !selectedCrismModel) {
      const [col, row] = crism.labelCell
      marker(col, row, t('map.crism.silica'), '#cb83ff', 'CRISM')
    }

    // Fixed points originate in the original USGS Mars-projected CRS.
    for (const point of checkpoints) {
      const [sx, , tx, , sy, ty] = grid.transform
      const col = (point.projected_x_m - tx) / sx
      const row = (point.projected_y_m - ty) / sy
      marker(col, row, point.id === 'base' ? 'THREE FORKS' : 'WILDCAT RIDGE',
        point.id === 'base' ? '#55efc4' : '#ffd27d', point.id === 'base' ? 'A' : 'B')
    }
    if (state) {
      const cx = p.ox + (state.col + .5) * p.scale
      const cy = p.oy + (state.row + .5) * p.scale
      ctx.strokeStyle = pinned ? '#ffd27d' : '#ffffff'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(cx, cy, Math.min(24, Math.max(8, p.scale * .7)), 0, 2 * Math.PI); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - 16, cy); ctx.lineTo(cx - 6, cy)
      ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 16, cy)
      ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy - 6)
      ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + 16)
      ctx.stroke()
    }
  }, [camera, terrain, relief, size, state?.row, state?.col, pinned, checkpoints.length, grid, routes, activeRoute, activeLayer, showCtx, optical, themis, temperature, crism, selectedCrismModel, slopeState, showSlopeHighlights, activeProfile, safeSelectedIndex, t])

  function selectProfileSample(index: number | null) {
    setSelectedSample(index)
    if (index === null || !activeProfile) return
    const selected = activeProfile.samples[index]
    setPinned(cellAtProjected(terrain, selected.x, selected.y))
    const [stepX, , left, , stepY, top] = grid.transform
    const col = (selected.x - left) / stepX
    const row = (selected.y - top) / stepY
    setCamera(current => {
      const original = measure(size, terrain, { ...current, panX: 0, panY: 0 })
      return { ...current,
        panX: size.width / 2 - (original.ox + col * original.scale),
        panY: size.height / 2 - (original.oy + row * original.scale) }
    })
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false }
  }
  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (drag) {
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (Math.abs(dx) + Math.abs(dy) > 1.5) drag.moved = true
      drag.x = event.clientX
      drag.y = event.clientY
      if (drag.moved) {
        setCamera(prev => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }))
        return
      }
    }
    const rect = event.currentTarget.getBoundingClientRect()
    setHovered(getCell(event.clientX - rect.left, event.clientY - rect.top))
  }
  function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    dragRef.current = null
    if (drag && !drag.moved) {
      const rect = event.currentTarget.getBoundingClientRect()
      setPinned(getCell(event.clientX - rect.left, event.clientY - rect.top))
    }
  }
  function handleKeys(event: KeyboardEvent<HTMLCanvasElement>) {
    const amount = event.shiftKey ? 110 : 40
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [0, amount], ArrowDown: [0, -amount], ArrowLeft: [amount, 0], ArrowRight: [-amount, 0],
    }
    if (arrows[event.key]) {
      event.preventDefault()
      const [x, y] = arrows[event.key]
      setCamera(current => ({ ...current, panX: current.panX + x, panY: current.panY + y }))
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault(); zoomAt(1.25, size.width / 2, size.height / 2)
    } else if (event.key === '-') {
      event.preventDefault(); zoomAt(1 / 1.25, size.width / 2, size.height / 2)
    } else if (event.key === '0') {
      event.preventDefault(); setCamera({ zoom: 1, panX: 0, panY: 0 })
    } else if (event.key === 'Escape') {
      setPinned(null)
    }
  }

  const scale = measure(size, terrain, camera).scale
  const metersPerScreenPx = grid.pixel_size_m[0] / scale
  const scaleOptions = [20, 50, 100, 200, 500, 1000, 2000]
  const barMeters = scaleOptions.reduce((prev, cur) =>
    Math.abs(cur / metersPerScreenPx - 110) < Math.abs(prev / metersPerScreenPx - 110) ? cur : prev, 100)
  const barWidth = Math.max(25, Math.min(240, barMeters / metersPerScreenPx))

  function centerMapOnCell(col: number, row: number) {
    setCamera(old => {
      const zoom = Math.max(2.3, old.zoom)
      const view = measure(size, terrain, { zoom, panX: 0, panY: 0 })
      return { zoom, panX: size.width / 2 - (view.ox + col * view.scale),
        panY: size.height / 2 - (view.oy + row * view.scale) }
    })
  }

  const focusPoint = (pointId: string) => {
    const point = checkpoints.find(p => p.id === pointId)
    if (!point) return
    setScienceOpen(point.id === 'science_target')
    const [sx, , tx, , sy, ty] = grid.transform
    const col = (point.projected_x_m - tx) / sx
    const row = (point.projected_y_m - ty) / sy
    centerMapOnCell(col, row)
    setPinned(cellAtProjected(terrain, point.projected_x_m, point.projected_y_m))
  }

  return (
    <section className="map-section" aria-labelledby="map-title">
      <div className="section-heading">
        <div>
          <span className="section-kicker"><span className="live-dot"/> {t('map.kicker')}</span>
          <h2 id="map-title">{t('map.title')}</h2>
          <p>{t('map.description')}</p>
        </div>
      </div>
      <div className="map-layout" id="jezero-map-detail">
        <div className="map-frame">
          <div className="layer-select" role="group" aria-label={t('map.layer.aria')}>
            <button type="button" aria-pressed={activeLayer === 'relief'}
              className={activeLayer === 'relief' ? 'selected' : ''}
              onClick={() => setActiveLayer('relief')}>{t('map.layer.dem')}</button>
            <button type="button" aria-pressed={activeLayer === 'ctx'}
              className={activeLayer === 'ctx' ? 'selected' : ''}
              disabled={!optical}
              title={!optical ? t('map.layer.ctxDisabled') : t('map.layer.ctxEnabled')}
              onClick={() => { if (optical) setActiveLayer('ctx') }}>{t('map.layer.ctx')}</button>
            <button type="button" aria-pressed={showThemisModes} className={showThemisModes ? 'selected' : ''}
              disabled={!themis && !temperature} onClick={() => {
                if (!showThemisModes) setActiveLayer(themis ? 'themis' : 'temperature')
              }}>THEMIS</button>
            <button type="button" aria-pressed={showCrism} className={showCrism ? 'selected' : ''}
              disabled={!crism} onClick={() => {
                if (!crism) return
                setActiveLayer('crism')
                if (crismSelection === 'silica') centerMapOnCell(...crism.labelCell)
              }}>{t('map.crism.local')}</button>
            <button type="button" aria-pressed={showPhotos} className={showPhotos ? 'selected' : ''}
              onClick={() => setActiveLayer('photos')}>{t('map.layer.photos')}</button>
          </div>
          {showPhotos && <section className="photo-map-toolbar" aria-labelledby="photo-map-title">
            <div>
              <span className="section-kicker">{t('map.photos.kicker')}</span>
              <h3 id="photo-map-title">{t('map.photos.title')}</h3>
              <p>{t('map.photos.description')}</p>
            </div>
            <div className="photo-filters">
              <label>{t('map.photos.camera')}
                <select value={photoCamera} onChange={event => setPhotoCamera(event.target.value)}>
                  <option value="">{t('map.photos.allCameras')}</option>
                  {cameraOptions.map(cameraName => <option key={cameraName} value={cameraName}>{cameraName}</option>)}
                </select>
              </label>
              <label>{t('map.photos.solFrom')}
                <input type="number" min="0" inputMode="numeric" value={photoSolMin}
                  onChange={event => setPhotoSolMin(event.target.value)} placeholder="0" />
              </label>
              <label>{t('map.photos.solTo')}
                <input type="number" min="0" inputMode="numeric" value={photoSolMax}
                  onChange={event => setPhotoSolMax(event.target.value)} placeholder="2031" />
              </label>
              <button type="button" onClick={() => { setPhotoCamera(''); setPhotoSolMin(''); setPhotoSolMax('') }}>{t('map.photos.reset')}</button>
            </div>
            <div className="photo-filter-summary" role="status">
              {photoError ? t('map.photos.error', {detail:photoError}) : t('map.photos.summary', {
                shown: filteredPhotos.length, located: photoPoints.length, unlocated: unlocatedPhotos.length, outside: outsideMapPhotos.length,
              })}
            </div>
          </section>}
          {showThemisModes && <div className="layer-select" role="group" aria-label="THEMIS">
            <button type="button" aria-pressed={showThemis} className={showThemis ? 'selected' : ''}
              disabled={!themis} onClick={() => setActiveLayer('themis')}>{t('map.layer.themis')}</button>
            <button type="button" aria-pressed={showTemperature} className={showTemperature ? 'selected' : ''}
              disabled={!temperature} onClick={() => setActiveLayer('temperature')}>{t('map.layer.temperature')}</button>
          </div>}
          {showCrism && <div className="layer-select" role="group" aria-label={t('map.crism.local')}>
            <button type="button" aria-pressed={crismSelection === 'silica'} className={crismSelection === 'silica' ? 'selected' : ''}
              onClick={() => { setCrismSelection('silica'); centerMapOnCell(...crism.labelCell) }}>{t('map.crism.silica')}</button>
            {CRISM_MODELS.map(model => <button type="button" key={model} disabled={!crismModels}
              aria-pressed={crismSelection === model} className={crismSelection === model ? 'selected' : ''}
              onClick={() => { setCrismSelection(model); setCamera({ zoom: 1, panX: 0, panY: 0 }) }}>{t(`map.crism.${model}`)}</button>)}
          </div>}
          <div className="map-canvas-wrap" ref={wrapperRef}>
            <canvas ref={canvasRef} className="mars-map-canvas" tabIndex={0} role="application"
              aria-label={t('map.accessibility')}
              onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp} onPointerCancel={() => { dragRef.current = null }}
              onPointerLeave={() => { if (!pinned) setHovered(null) }} onKeyDown={handleKeys}/>
            {showPhotos && <div className="photo-marker-layer" aria-label={t('map.photos.markers')}>
              {photoClusters.map(cluster => {
                const single = cluster.points.length === 1 ? cluster.points[0].photo : null
                return <button key={cluster.id} type="button"
                  className={single ? `photo-marker ${single.location_type}` : 'photo-marker cluster'}
                  style={{ left: cluster.x, top: cluster.y }}
                  aria-label={single ? t('map.photos.open', {title:single.title}) : t('map.photos.cluster', {count:cluster.points.length})}
                  title={single?.title ?? t('map.photos.cluster', {count:cluster.points.length})}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation()
                    if (single) setSelectedPhoto(single)
                    else if (camera.zoom < 6) zoomAt(1.7, cluster.x, cluster.y)
                    else setSelectedPhoto(cluster.points[0].photo)
                  }}>
                  <span aria-hidden="true">{single ? '▣' : cluster.points.length}</span>
                </button>
              })}
            </div>}
            <div className="map-overlay-head"><span className="map-head-indicator"/> {t('map.overlay')} <small>18.46° N · 77.41° E</small></div>
            <div className="map-controls" aria-label={t('map.zoom.aria')}>
              <button type="button" aria-label={t('map.zoom.in')} onClick={() => zoomAt(1.35, size.width / 2, size.height / 2)}>+</button>
              <span>{Math.round(camera.zoom * 100)}%</span>
              <button type="button" aria-label={t('map.zoom.out')} onClick={() => zoomAt(1 / 1.35, size.width / 2, size.height / 2)}>−</button>
              <button type="button" className="reset-map" onClick={() => { setCamera({ zoom: 1, panX: 0, panY: 0 }); setPinned(null) }}>{t('map.zoom.reset')}</button>
            </div>
            <div className="map-compass" aria-hidden="true"><b>↑</b>N</div>
            <div className="map-scale"><span style={{ width: barWidth }} className="scale-stroke"/><span>{meters(barMeters, {maximumFractionDigits:0})}</span></div>
            <div className="map-bottom-note">{t('map.help')}</div>
          </div>
        </div>
        <aside className="telemetry" aria-label={t('map.telemetry.aria')}>
          <div className="telemetry-title"><span className="pulse-circle"/> {t('map.telemetry.title')} <span>{t('map.telemetry.subtitle')}</span></div>
          <div className="telemetry-block">
            <span className="telemetry-label">{pinned ? t('map.telemetry.pinned') : hovered ? t('map.telemetry.hover') : t('map.telemetry.center')}</span>
            <strong className="altitude">{state ? elevation(state.elevation) : '—'}</strong>
            <span className="telemetry-muted">{t('map.telemetry.elevation')}</span>
          </div>
          {kelvin !== null && <div className="telemetry-block">
            <span className="telemetry-label">{t('map.temperature.label')}</span>
            <strong>{temperatureText(kelvin)}</strong>
          </div>}
          <div className="telemetry-block">
            <span className="telemetry-label">{t('map.telemetry.coordinates')}</span>
            <div className="coord-pair"><span>{t('map.telemetry.lat')}</span><strong>{state ? coordinate.format(state.latitude) + '°' : '—'}</strong></div>
            <div className="coord-pair"><span>{t('map.telemetry.lon')}</span><strong>{state ? coordinate.format(state.longitude) + '°' : '—'}</strong></div>
            <div className="coord-pair"><span>{t('map.telemetry.pixel')}</span><strong>{state ? `${state.col}, ${state.row}` : '—'}</strong></div>
            {pinned && <button type="button" className="text-action" onClick={() => setPinned(null)}>{t('map.telemetry.unpin')}</button>}
          </div>
          <div className="telemetry-block">
            <span className="telemetry-label">{t('map.telemetry.landmarks')}</span>
            {checkpoints.map(point => <button key={point.id} type="button" className="checkpoint"
              ref={point.id === 'science_target' ? scienceButtonRef : undefined}
              aria-expanded={point.id === 'science_target' ? scienceOpen : undefined}
              aria-controls={point.id === 'science_target' ? 'science-stop-card' : undefined}
              onClick={() => focusPoint(point.id)}>
              <span className={point.id === 'base' ? 'point-glyph base' : 'point-glyph science'}>{point.id === 'base' ? 'A' : 'B'}</span>
              <span className="checkpoint-text"><strong>{point.id === 'base' ? 'Three Forks' : 'Wildcat Ridge'}</strong>
                <small>{point.id === 'base' ? t('map.telemetry.base') : t('map.telemetry.science')}</small></span>
              <span className="checkpoint-arrow">↗</span>
            </button>)}
          </div>
          {routes && <div className="telemetry-block route-switcher">
            <span className="telemetry-label">{t('map.routes.title')}</span>
            <div className="route-switcher-buttons" role="group" aria-label={t('map.routes.aria')}>
              <button type="button" className="route-switcher-direct"
                aria-pressed={activeRoute === 'direct'} onClick={() => { setActiveRoute('direct'); setSelectedSample(null); setPinned(null) }}>
                {t('route.direct')}
              </button>
              <button type="button" className="route-switcher-detour"
                aria-pressed={activeRoute === 'detour'} onClick={() => { setActiveRoute('detour'); setSelectedSample(null); setPinned(null) }}>
                {t('route.detour')}
              </button>
            </div>
            <span className="telemetry-muted">{t('map.routes.help')}</span>
          </div>}
          <div className="telemetry-block bottom">
            <div className="coord-pair"><span>{t('map.telemetry.area')}</span><strong>{t('map.areaSize')}</strong></div>
            <div className="coord-pair"><span>{t('map.telemetry.cells')}</span><strong>{grid.width} × {grid.height}</strong></div>
            <div className="coord-pair"><span>{t('map.telemetry.valid')}</span><strong className="green-text">{validPercent}%</strong></div>
            <div className="coord-pair"><span>{t('map.telemetry.heights')}</span><strong>{meters(terrain.min)}…{meters(terrain.max)}</strong></div>
          </div>
        </aside>
      </div>
      {!showPhotos && <div className="layer-status" role="status">
        {showTemperature ? t('map.temperature.label') : showThemis ? t('map.status.themisActive') : opticalError
          ? t('map.status.ctxError', {detail:localizeError(opticalError)})
          : optical
            ? activeLayer === 'ctx'
              ? t('map.status.ctxActive')
              : t('map.status.ctxReady')
            : t('map.status.ctxMissing')}
      </div>}
      {!showPhotos && (showCrism ? <div className="map-info-card">
        <div className="map-footer">
          <span>{selectedCrismModel ? '0%' : t('map.crism.unmarked')}</span>
          <div className="relief-gradient" style={{ background: `linear-gradient(to right, transparent, ${
            selectedCrismModel ? (crismSelection === 'magnesite' ? '#ffbf46' : '#56dfac') : '#cb83ff'
          })` }} aria-hidden="true" />
          <span>{selectedCrismModel
            ? `${format(selectedCrismModel.maximum, { maximumFractionDigits: 1 })}%`
            : t('map.crism.detected')}</span>
        </div>
        {selectedCrismModel ? <>
          <p>{t('map.crism.modelDescription')}</p>
          <a href="https://zenodo.org/records/4699583">Zastrow &amp; Glotch · HRL000040FF</a>
        </> : <>
          <p>{t('map.crism.localDescription')}</p>
          <a href="https://doi.org/10.7910/DVN/LFXQQR">Tarnas et al. · HRL000040FF</a>
        </>}
      </div> : showTemperature ? <div className="map-info-card">
        <div className="map-footer">
          <span>{temperatureText(temperature.minimum)}</span>
          <div className="relief-gradient" style={{ background: 'linear-gradient(to right, #31288e, #af377c, #ffd963)' }} aria-hidden="true" />
          <span>{temperatureText(temperature.maximum)}</span>
        </div>
        <p>{t('map.temperature.note')}</p>
        <a href="https://static.mars.asu.edu/pds/ODTGEO_v2/data/odtip2_0064/i702xxpbt/I70247006PBT.IMG">NASA PDS · I70247006PBT</a>
      </div> : !showCtx && <div className="map-footer">
        <div className="legend-title">{t(showThemis ? 'map.footer.themis' : 'map.footer.relief')} <span>{t('map.footer.low')}</span></div>
        <div className="relief-gradient" style={showThemis ? {background: 'linear-gradient(to right, #161616, #ededed)'} : undefined} aria-hidden="true" />
        <span>{t('map.footer.high')}</span>
        <div className="map-source">{t(showThemis ? 'map.footer.themisSource' : 'map.footer.source')}</div>
      </div>)}
      {!showPhotos && !showCrism && !showTemperature && <p className="scientific-disclaimer">
        {activeLayer === 'themis' && themis ? t('map.source.themisNote') : activeLayer === 'ctx' && optical
          ? t('map.note.ctx')
          : t('map.note.dem', {size:format(grid.pixel_size_m[0])})}
      </p>}
      {showPhotos && selectedPhoto && <section className="photo-detail-card" aria-labelledby="selected-photo-title">
        <img src={selectedPhoto.thumbnail_url} alt="" loading="lazy" />
        <div>
          <div className="photo-card-heading">
            <span className={`photo-location-badge ${selectedPhoto.location_type}`}>
              {t(`map.photos.location.${selectedPhoto.location_type}`)}
            </span>
            <button type="button" className="text-action" onClick={() => setSelectedPhoto(null)}>{t('map.photos.close')}</button>
          </div>
          <h3 id="selected-photo-title">{selectedPhoto.title}</h3>
          <p>{selectedPhoto.caption}</p>
          <dl className="photo-metadata">
            <dt>{t('map.photos.camera')}</dt><dd>{selectedPhoto.camera}</dd>
            <dt>{t('map.photos.sols')}</dt><dd>{selectedPhoto.acquisition.sols.join(', ')}</dd>
            <dt>{t('map.photos.date')}</dt><dd>{selectedPhoto.acquisition.earth_dates.join(', ') || t('map.photos.unknown')}</dd>
            <dt>{t('map.photos.credit')}</dt><dd>{selectedPhoto.credit}</dd>
          </dl>
          {selectedPhoto.coordinates && <p className="photo-coordinate-note">
            {coordinate.format(selectedPhoto.coordinates.latitude_deg)}° N · {coordinate.format(selectedPhoto.coordinates.longitude_deg)}° E — {selectedPhoto.coordinates.note}
          </p>}
          <a href={selectedPhoto.page_url} target="_blank" rel="noreferrer">{t('map.photos.nasaSource')}</a>
          {' · '}<a href={selectedPhoto.image_url} target="_blank" rel="noreferrer">{t('map.photos.original')}</a>
        </div>
      </section>}
      {showPhotos && photosWithoutMarkers.length > 0 && <section className="unlocated-photos" aria-labelledby="unlocated-photos-title">
        <h3 id="unlocated-photos-title">{t('map.photos.unlocatedTitle')}</h3>
        <p>{t('map.photos.unlocatedDescription')}</p>
        <div>
          {photosWithoutMarkers.map(photo => <button type="button" key={photo.id} onClick={() => setSelectedPhoto(photo)}>
            <img src={photo.thumbnail_url} alt="" loading="lazy" />
            <span><strong>{photo.title}</strong><small>{t(photo.coordinates ? 'map.photos.outsideMap' : 'map.photos.noMarker')}</small></span>
          </button>)}
        </div>
      </section>}
      {science && (
        <section className="map-info-card" id="science-stop-card" aria-labelledby="science-stop-title" hidden={!scienceOpen}>
          <h3 id="science-stop-title">Wildcat Ridge / Hazeltop</h3>
          <p>{t('map.science.position')} · {coordinate.format(science.latitude_deg)}° N · {coordinate.format(science.longitude_deg)}° E</p>
          <p>{t('map.science.geology')}</p>
          <p><strong>{t('map.science.taskLabel')}</strong> {t('map.science.task')}</p>
          {scienceOpen && <div className="science-photos">
            {[
              ['outcrop.jpg', 'outcrop', 'sample-collection-and-rock-analysis-at-wildcat-ridge'],
              ['hazeltop.png', 'hazeltop', 'perseverance-rock-cores-from-wildcat-ridge'],
              ['bearwallow.png', 'bearwallow', 'perseverance-rock-cores-from-wildcat-ridge'],
            ].map(([file, caption, source]) => (
              <figure key={file}>
                <img src={`./data/jezero/wildcat-ridge/${file}`} alt={t(`map.science.photo.${caption}`)} loading="lazy" />
                <figcaption>
                  {t(`map.science.photo.${caption}`)}
                  <small>NASA/JPL-Caltech/ASU/MSSS</small>
                  <a href={`https://science.nasa.gov/resource/${source}/`}>{t('map.science.photo.source')}</a>
                </figcaption>
              </figure>
            ))}
          </div>}
          <button type="button" className="text-action" onClick={() => {
            setScienceOpen(false)
            scienceButtonRef.current?.focus()
          }}>{t('map.science.close')}</button>
        </section>
      )}
      {slopeState.report && (
        <RouteSlopePanel report={slopeState.report} routeName={activeRoute}
          thresholds={slopeThresholds} onThresholdsChange={setSlopeThresholds}
          highlightEnabled={showSlopeHighlights} onToggle={setShowSlopeHighlights}/>
      )}
      {slopeState.error && <p className="alert error-alert" role="alert">{t('map.status.slopeError', {detail:localizeError(slopeState.error)})}</p>}
      {activeProfile && <ElevationProfileChart profile={activeProfile} activeRoute={activeRoute}
        selectedIndex={safeSelectedIndex} onSelect={selectProfileSample} />}
      {themisUnavailable && <p className="layer-status">{t('map.layer.themisUnavailable')}</p>}
      <details className="map-info-card">
        <summary>{t('map.source.title')}</summary>
        <h3>{terrain.metadata.source.product}{(activeLayer === 'relief' || (activeLayer === 'ctx' && !optical) || (activeLayer === 'themis' && !themis)) && ' · ' + t('map.source.active')}</h3>
        <dl>
          <dt>{t('map.source.mission')}</dt><dd>Mars Reconnaissance Orbiter · {terrain.metadata.source.instrument}</dd>
          <dt>{t('map.source.source')}</dt><dd><a href={terrain.metadata.source.url}>{terrain.metadata.source.publisher} · {t('map.source.originalTif')}</a></dd>
          <dt>{t('map.source.year')}</dt><dd>{t('map.source.yearValue')}</dd>
          <dt>{t('map.source.resolution')}</dt><dd>{grid.pixel_size_m.map(value => format(value)).join(' × ')} {t('map.source.pixel')}</dd>
        </dl>
        <p><strong>{t('map.source.demTitle')}</strong> {t('map.source.demDescription')}</p>
        <p><strong>{t('map.source.routeTitle')}</strong> {t('map.source.routeDescription')}</p>
        <p><strong>{t('map.source.limitsTitle')}</strong> {t('map.source.limits')}</p>
        <a href="https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.xml">{t('map.source.pds')}</a>
        <h3>{optical?.metadata.source.product ?? t('map.source.opticalFallback')}{activeLayer === 'ctx' && optical && ' · ' + t('map.source.active')}</h3>
        <dl>
          <dt>{t('map.source.mission')}</dt><dd>Mars Reconnaissance Orbiter · Context Camera (CTX)</dd>
          <dt>{t('map.source.source')}</dt><dd><a href={optical?.metadata.source.url ?? 'https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.tif'}>{optical?.metadata.source.publisher ?? 'USGS Astrogeology Science Center'} · {t('map.source.originalOrtho')}</a></dd>
          <dt>{t('map.source.captureDate')}</dt><dd>{t('map.source.captureUnknown')}</dd>
          <dt>{t('map.source.resolution')}</dt><dd>{format(optical?.metadata.alignment.resolution_m ?? 5)} {t('map.source.pixel')}</dd>
        </dl>
        <p>{t('map.source.ctxDescription')}</p>
        <h3>THEMIS Day IR · Syrtis Major{activeLayer === 'themis' && themis && ' · ' + t('map.source.active')}</h3>
        <dl>
          <dt>{t('map.source.mission')}</dt><dd>Mars Odyssey · Thermal Emission Imaging System</dd>
          <dt>{t('map.source.source')}</dt><dd><a href="https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/">USGS Astrogeology</a></dd>
          <dt>{t('map.source.captureDate')}</dt><dd>{t('map.source.captureUnknown')}</dd>
          <dt>{t('map.source.resolution')}</dt><dd>100 {t('map.source.pixel')}</dd>
        </dl>
        <p>{t('map.source.themisNote')}</p>
        <a href="https://data.nasa.gov/dataset/odyssey-themis-ir-btr-v1-0-74ffb">NASA PDS · THEMIS IR-BTR (K)</a>
      </details>
    </section>
  )
}
