import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { useI18n } from './i18n.tsx'
import { clampGlobeView, marsToGlobeScreen, screenUnitToMars, texturePixel, type GlobeView } from './marsGlobe.ts'

const TEXTURE_URL = '/data/mars-global/mola_global_overview.jpg'
const METADATA_URL = '/data/mars-global/mola_global_463m.json'
const JEZERO = { longitude: 77.40974302, latitude: 18.45616697 }
const INITIAL_VIEW: GlobeView = { longitude: 58, latitude: 18, zoom: 1 }

type Metadata = {
  title: string
  mission: string
  instrument: string
  source_product_native_resolution_m_per_pixel: number
  display_projection: string
  display_mosaic: { file: string; width: number; height: number; sha256: string }
}

function validateMetadata(value: unknown): Metadata {
  const data = value as Partial<Metadata>
  if (data.mission !== 'Mars Global Surveyor' || !data.instrument?.includes('MOLA') ||
      data.display_mosaic?.file !== 'mola_global_overview.jpg' ||
      data.display_mosaic.width !== 512 || data.display_mosaic.height !== 256 ||
      !data.display_projection?.includes('Equirectangular')) {
    throw new Error('Invalid MOLA globe metadata')
  }
  return data as Metadata
}

export function MarsGlobe({ onOpenDetail }: { onOpenDetail: () => void }) {
  const { t, format } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textureRef = useRef<ImageData | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const dragRef = useRef<{ x: number; y: number; view: GlobeView } | null>(null)
  const pinchRef = useRef<number | null>(null)
  const [view, setView] = useState(INITIAL_VIEW)
  const [metadata, setMetadata] = useState<Metadata | null>(null)
  const [error, setError] = useState('')
  const [size, setSize] = useState(520)

  useEffect(() => {
    let active = true
    Promise.all([
      fetch(METADATA_URL).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() }),
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('MOLA texture could not be loaded'))
        image.src = TEXTURE_URL
      }),
    ]).then(([rawMetadata, image]) => {
      if (!active) return
      const checked = validateMetadata(rawMetadata)
      if (image.naturalWidth !== checked.display_mosaic.width || image.naturalHeight !== checked.display_mosaic.height) {
        throw new Error('MOLA texture dimensions do not match metadata')
      }
      const source = document.createElement('canvas')
      source.width = image.naturalWidth
      source.height = image.naturalHeight
      const context = source.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Canvas is not available')
      context.drawImage(image, 0, 0)
      textureRef.current = context.getImageData(0, 0, source.width, source.height)
      setMetadata(checked)
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width) setSize(Math.max(260, Math.min(560, Math.round(width))))
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    if (!canvas || !texture || !metadata) return
    const pixelSize = Math.min(size, 520)
    canvas.width = pixelSize
    canvas.height = pixelSize
    const context = canvas.getContext('2d')
    if (!context) return
    const output = context.createImageData(pixelSize, pixelSize)
    const radius = pixelSize * .43 * view.zoom
    const center = pixelSize / 2
    for (let py = 0; py < pixelSize; py++) {
      for (let px = 0; px < pixelSize; px++) {
        const unitX = (px + .5 - center) / radius
        const unitY = (center - py - .5) / radius
        const target = (py * pixelSize + px) * 4
        const mars = screenUnitToMars(unitX, unitY, view)
        if (!mars) {
          output.data[target + 3] = 0
          continue
        }
        const source = texturePixel(mars.longitude, mars.latitude, texture.width, texture.height)
        const sourceIndex = (source.y * texture.width + source.x) * 4
        const limb = .62 + .38 * Math.sqrt(Math.max(0, 1 - unitX * unitX - unitY * unitY))
        output.data[target] = texture.data[sourceIndex] * limb
        output.data[target + 1] = texture.data[sourceIndex + 1] * limb
        output.data[target + 2] = texture.data[sourceIndex + 2] * limb
        output.data[target + 3] = 255
      }
    }
    context.putImageData(output, 0, 0)
  }, [metadata, size, view])

  const updateZoom = useCallback((factor: number) => setView(current => clampGlobeView({ ...current, zoom: current.zoom * factor })), [])
  const pointerPosition = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointerPosition(event)
    pointersRef.current.set(event.pointerId, point)
    if (pointersRef.current.size === 1) dragRef.current = { ...point, view }
    if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()]
      pinchRef.current = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
    }
  }
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return
    const point = pointerPosition(event)
    pointersRef.current.set(event.pointerId, point)
    if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()]
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      if (pinchRef.current) updateZoom(distance / pinchRef.current)
      pinchRef.current = distance
      return
    }
    const drag = dragRef.current
    if (!drag) return
    const degreesPerPixel = 115 / (Math.max(260, size) * drag.view.zoom)
    setView(clampGlobeView({
      ...drag.view,
      longitude: drag.view.longitude - (point.x - drag.x) * degreesPerPixel,
      latitude: drag.view.latitude + (point.y - drag.y) * degreesPerPixel,
    }))
  }
  const endPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId)
    dragRef.current = null
    pinchRef.current = null
  }
  const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    updateZoom(event.deltaY < 0 ? 1.1 : 1 / 1.1)
  }
  const marker = marsToGlobeScreen(JEZERO.longitude, JEZERO.latitude, view)
  const markerLeft = 50 + marker.x * 43 * view.zoom
  const markerTop = 50 - marker.y * 43 * view.zoom

  return <section id="globe" className="mars-globe-section" aria-labelledby="globe-title">
    <div className="section-heading">
      <div><span className="section-kicker">{t('globe.kicker')}</span><h2 id="globe-title">{t('globe.title')}</h2><p>{t('globe.description')}</p></div>
      <span className="data-pill">MOLA · 463 m/px</span>
    </div>
    <div className="mars-globe-layout">
      <div className="mars-globe-stage">
        <canvas ref={canvasRef} className="mars-globe-canvas" aria-label={t('globe.accessibility')}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer}
          onPointerCancel={endPointer} onWheel={onWheel}/>
        {!metadata && !error && <span className="globe-loading">{t('globe.loading')}</span>}
        {marker.visible && <button className="globe-jezero-marker" style={{ left: `${markerLeft}%`, top: `${markerTop}%` }}
          onClick={onOpenDetail} aria-label={t('globe.detail')}><i/>JEZERO</button>}
        <div className="globe-controls" aria-label={t('globe.controls')}>
          <button onClick={() => updateZoom(1.15)} aria-label="+">+</button>
          <button onClick={() => updateZoom(1 / 1.15)} aria-label="−">−</button>
          <button onClick={() => setView(INITIAL_VIEW)}>{t('globe.reset')}</button>
        </div>
      </div>
      <aside className="globe-panel">
        {error ? <p role="alert" className="alert error-alert">{t('globe.error')}: {error}</p> : <>
          <span className="section-kicker">{t('globe.shape')}</span>
          <strong>{t('globe.sphere')}</strong>
          <dl className="globe-readout">
            <div><dt>{t('globe.center')}</dt><dd>{format(view.latitude, { maximumFractionDigits: 1 })}°, {format(view.longitude, { maximumFractionDigits: 1 })}°</dd></div>
            <div><dt>{t('globe.texture')}</dt><dd>{metadata?.instrument ?? 'MOLA'}</dd></div>
            <div><dt>{t('globe.resolution')}</dt><dd>{metadata ? `${metadata.source_product_native_resolution_m_per_pixel} m/px` : '—'}</dd></div>
          </dl>
          <p>{t('globe.limit')}</p>
          <p className="globe-help">{t('globe.help')}</p>
          <button className="globe-detail-button" onClick={onOpenDetail}>{t('globe.detail')}</button>
        </>}
      </aside>
    </div>
  </section>
}
