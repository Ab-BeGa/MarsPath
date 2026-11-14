import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cellAtGrid, cellAtProjected, type MarsTerrain, type TerrainCell } from './marsTerrain.ts'
import { routeToGrid, type RoutePair } from './routeMap.ts'
import { loadCtxOpticalLayer, type CtxOpticalLayer } from './ctxOptical.ts'

type Camera = { zoom: number; panX: number; panY: number }
type Size = { width: number; height: number }
type Drag = { x: number; y: number; moved: boolean } | null

const number = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 })
const coordinate = new Intl.NumberFormat('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 })
const elevation = (v: number | null) => v === null ? 'NoData' : `${number.format(v)} м`

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

export function MarsMap({ terrain, routes }: { terrain: MarsTerrain; routes?: RoutePair }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scienceButtonRef = useRef<HTMLButtonElement>(null)
  const [size, setSize] = useState<Size>({ width: 920, height: 570 })
  const [camera, setCamera] = useState<Camera>({ zoom: 1, panX: 0, panY: 0 })
  const [activeRoute, setActiveRoute] = useState<'direct' | 'detour'>('direct')
  const cameraRef = useRef(camera)
  const [hovered, setHovered] = useState<TerrainCell | null>(null)
  const [optical, setOptical] = useState<CtxOpticalLayer | null>(null)
  const [opticalError, setOpticalError] = useState('')
  const [activeLayer, setActiveLayer] = useState<'relief' | 'ctx'>('relief')
  const [pinned, setPinned] = useState<TerrainCell | null>(null)
  const [scienceOpen, setScienceOpen] = useState(false)
  const dragRef = useRef<Drag>(null)
  const relief = useMemo(() => createRelief(terrain), [terrain])
  const checkpoints = terrain.metadata.checked_points.filter(p => ['base', 'science_target'].includes(p.id))
  const science = checkpoints.find(point => point.id === 'science_target')
  const { grid } = terrain.metadata
  const state = pinned ?? hovered ?? cellAtGrid(terrain, Math.floor(grid.width / 2), Math.floor(grid.height / 2))
  const validPercent = (100 * terrain.validCount / terrain.heights.length).toFixed(1)

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
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
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
    const showCtx = activeLayer === 'ctx' && optical !== null
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(showCtx ? optical.image : relief, p.ox, p.oy, iw, ih)
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
  }, [camera, terrain, relief, size, state?.row, state?.col, pinned, checkpoints.length, grid, routes, activeRoute, activeLayer, optical])

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

  const focusPoint = (pointId: string) => {
    const point = checkpoints.find(p => p.id === pointId)
    if (!point) return
    setScienceOpen(point.id === 'science_target')
    const [sx, , tx, , sy, ty] = grid.transform
    const col = (point.projected_x_m - tx) / sx
    const row = (point.projected_y_m - ty) / sy
    setCamera(old => {
      const zoom = Math.max(2.3, old.zoom)
      const a = measure(size, terrain, { zoom, panX: 0, panY: 0 })
      return { zoom, panX: size.width / 2 - (a.ox + col * a.scale),
        panY: size.height / 2 - (a.oy + row * a.scale) }
    })
    setPinned(cellAtProjected(terrain, point.projected_x_m, point.projected_y_m))
  }

  return (
    <section className="map-section" id="map" aria-labelledby="map-title">
      <div className="section-heading">
        <div>
          <span className="section-kicker"><span className="live-dot"/> LIVE TERRAIN VIEW / MARS</span>
          <h2 id="map-title">Западная дельта Езеро</h2>
          <p>Рельеф кратера из настоящей цифровой модели высот NASA / USGS CTX. Область 1,5 × 1,5 км.</p>
        </div>
        <div className="layer-select" role="group" aria-label="Переключение базового слоя карты">
          <button type="button" aria-pressed={activeLayer === 'relief'}
            className={activeLayer === 'relief' ? 'selected' : ''}
            onClick={() => setActiveLayer('relief')}>Рельеф DEM</button>
          <button type="button" aria-pressed={activeLayer === 'ctx'}
            className={activeLayer === 'ctx' ? 'selected' : ''}
            disabled={!optical}
            title={!optical ? 'Не загружен геопривязанный CTX-ортофотоплан' : 'Оптический CTX · 5 м/пиксель'}
            onClick={() => { if (optical) setActiveLayer('ctx') }}>CTX · 5 м</button>
        </div>
      </div>
      <div className="map-layout">
        <div className="map-frame">
          <div className="map-canvas-wrap" ref={wrapperRef}>
            <canvas ref={canvasRef} className="mars-map-canvas" tabIndex={0} role="application"
              aria-label="Интерактивная карта рельефа Езеро. Стрелки для перемещения, плюс и минус для масштаба, ноль для сброса."
              onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp} onPointerCancel={() => { dragRef.current = null }}
              onPointerLeave={() => { if (!pinned) setHovered(null) }} onKeyDown={handleKeys}/>
            <div className="map-overlay-head"><span className="map-head-indicator"/> JEZERO / WEST DELTA <small>18.46° N · 77.41° E</small></div>
            <div className="map-controls" aria-label="Масштабирование карты">
              <button type="button" aria-label="Приблизить карту" onClick={() => zoomAt(1.35, size.width / 2, size.height / 2)}>+</button>
              <span>{Math.round(camera.zoom * 100)}%</span>
              <button type="button" aria-label="Отдалить карту" onClick={() => zoomAt(1 / 1.35, size.width / 2, size.height / 2)}>−</button>
              <button type="button" className="reset-map" onClick={() => { setCamera({ zoom: 1, panX: 0, panY: 0 }); setPinned(null) }}>Сброс</button>
            </div>
            <div className="map-compass" aria-hidden="true"><b>↑</b>N</div>
            <div className="map-scale"><span style={{ width: barWidth }} className="scale-stroke"/><span>{barMeters} м</span></div>
            <div className="map-bottom-note">DRAG TO PAN · SCROLL TO ZOOM · CLICK TO INSPECT</div>
          </div>
        </div>
        <aside className="telemetry" aria-label="Информация о рельефе">
          <div className="telemetry-title"><span className="pulse-circle"/> TELEMETRY <span>01 / SURFACE</span></div>
          <div className="telemetry-block">
            <span className="telemetry-label">{pinned ? 'ЗАКРЕПЛЁННЫЙ ПИКСЕЛЬ' : hovered ? 'ПОД КУРСОРОМ' : 'ЦЕНТР УЧАСТКА'}</span>
            <strong className="altitude">{state ? elevation(state.elevation) : '—'}</strong>
            <span className="telemetry-muted">Высота по исходной DEM, м</span>
          </div>
          <div className="telemetry-block">
            <span className="telemetry-label">МАРСИАНСКИЕ КООРДИНАТЫ</span>
            <div className="coord-pair"><span>Широта, N</span><strong>{state ? coordinate.format(state.latitude) + '°' : '—'}</strong></div>
            <div className="coord-pair"><span>Долгота, E</span><strong>{state ? coordinate.format(state.longitude) + '°' : '—'}</strong></div>
            <div className="coord-pair"><span>Пиксель DEM</span><strong>{state ? `${state.col}, ${state.row}` : '—'}</strong></div>
            {pinned && <button type="button" className="text-action" onClick={() => setPinned(null)}>Снять фиксацию точки ×</button>}
          </div>
          <div className="telemetry-block">
            <span className="telemetry-label">НАУЧНЫЕ ОРИЕНТИРЫ</span>
            {checkpoints.map(point => <button key={point.id} type="button" className="checkpoint"
              ref={point.id === 'science_target' ? scienceButtonRef : undefined}
              aria-expanded={point.id === 'science_target' ? scienceOpen : undefined}
              aria-controls={point.id === 'science_target' ? 'science-stop-card' : undefined}
              onClick={() => focusPoint(point.id)}>
              <span className={point.id === 'base' ? 'point-glyph base' : 'point-glyph science'}>{point.id === 'base' ? 'A' : 'B'}</span>
              <span className="checkpoint-text"><strong>{point.id === 'base' ? 'Three Forks' : 'Wildcat Ridge'}</strong>
                <small>{point.id === 'base' ? 'Условная база' : 'Научная остановка'}</small></span>
              <span className="checkpoint-arrow">↗</span>
            </button>)}
          </div>
          {routes && <div className="telemetry-block route-switcher">
            <span className="telemetry-label">АКТИВНЫЙ МАРШРУТ</span>
            <div className="route-switcher-buttons" role="group" aria-label="Выбор активного маршрута">
              <button type="button" className="route-switcher-direct"
                aria-pressed={activeRoute === 'direct'} onClick={() => setActiveRoute('direct')}>
                Прямой
              </button>
              <button type="button" className="route-switcher-detour"
                aria-pressed={activeRoute === 'detour'} onClick={() => setActiveRoute('detour')}>
                Обходной
              </button>
            </div>
            <span className="telemetry-muted">На карте показаны оба пути. Выбранный выделен толщиной.</span>
          </div>}
          <div className="telemetry-block bottom">
            <div className="coord-pair"><span>Область</span><strong>1,5 × 1,5 км</strong></div>
            <div className="coord-pair"><span>Ячейки</span><strong>{grid.width} × {grid.height}</strong></div>
            <div className="coord-pair"><span>Действительных</span><strong className="green-text">{validPercent}%</strong></div>
            <div className="coord-pair"><span>Высоты</span><strong>{number.format(terrain.min)}…{number.format(terrain.max)} м</strong></div>
          </div>
        </aside>
      </div>
      {science && (
        <section className="map-info-card" id="science-stop-card" aria-labelledby="science-stop-title" hidden={!scienceOpen}>
          <h3 id="science-stop-title">Wildcat Ridge / Hazeltop</h3>
          <p>Демонстрационная точка B в районе Wildcat Ridge · {coordinate.format(science.latitude_deg)}° N · {coordinate.format(science.longitude_deg)}° E</p>
          <p>Мелкозернистые осадочные породы с сульфатами помогают изучать условия древнего озера Езеро. Отложения могли сформироваться при испарении солёной воды. В обнажении Wildcat Ridge Perseverance отобрал керны Hazeltop и Bearwallow.</p>
          <p><strong>Задача астронавта в демо.</strong> Сфотографировать обнажение с масштабом, описать видимые слои и обосновать выбор точки для отбора образца.</p>
          <a href="https://science.nasa.gov/resource/sample-collection-and-rock-analysis-at-wildcat-ridge/">NASA · Отбор и анализ образцов Wildcat Ridge</a>
          <button type="button" className="text-action" onClick={() => {
            setScienceOpen(false)
            scienceButtonRef.current?.focus()
          }}>Закрыть научную карточку</button>
        </section>
      )}
      <div className="layer-status" role="status">
        {opticalError
          ? 'CTX: ошибка загрузки — ' + opticalError
          : optical
            ? activeLayer === 'ctx'
              ? 'CTX: настоящий ортофотоплан USGS, геопривязка подтверждена метаданными · 5 м/пиксель'
              : 'CTX-ортофотоплан доступен: переключитесь на спутниковый снимок'
            : 'CTX ещё не загружен на сайт: необходимы официальный оптический PNG и метаданные геопривязки'}
      </div>
      <div className="map-footer">
        <div className="legend-title">RELIEF ELEVATION <span>LOW</span></div>
        <div className="relief-gradient" aria-hidden="true" />
        <span>HIGH</span>
        <div className="map-source">USGS Astrogeology · CTX 20 м/пиксель · марсианская проекция, не WGS84</div>
      </div>
      <p className="scientific-disclaimer">
        {activeLayer === 'ctx' && optical
          ? 'Оптический CTX показывает отражённый свет в оттенках серого; координаты и высоты берутся из DEM. Подложка не подтверждает безопасность выхода астронавтов.'
          : 'Цветной рельеф построен из высот DEM, это не орбитальная фотография. Разрешение 20 м/пиксель не показывает мелкие препятствия и не подтверждает безопасность EVA.'}
      </p>
    </section>
  )
}
