import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { useI18n } from './i18n.tsx'

const preloadCache = new Map<string, Promise<void>>()
export function preloadPanoramaImage(url: string) {
  const cached = preloadCache.get(url)
  if (cached) return cached
  const pending = new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(`Panorama image unavailable: ${url}`))
    image.decoding = 'async'
    image.src = url
  })
  preloadCache.set(url, pending)
  return pending
}

export function PanoramaViewer({ imageUrl, previewUrl, title }: { imageUrl: string; previewUrl: string; title: string }) {
  const { t } = useI18n()
  const drag = useRef<{ x: number; yaw: number } | null>(null)
  const frame = useRef<number | null>(null)
  const pendingYaw = useRef(0)
  const [yaw, setYaw] = useState(0)
  const [zoom, setZoom] = useState(2.2)
  const [displayUrl, setDisplayUrl] = useState(previewUrl)
  const [loading, setLoading] = useState(true)
  const clampYaw = (value: number) => Math.max(0, Math.min(360, value))
  const scheduleYaw = (value: number) => {
    pendingYaw.current = clampYaw(value)
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => { frame.current = null; setYaw(pendingYaw.current) })
  }
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  useEffect(() => {
    let active = true
    setDisplayUrl(previewUrl)
    setLoading(true)
    void preloadPanoramaImage(imageUrl).then(() => {
      if (active) { setDisplayUrl(imageUrl); setLoading(false) }
    }).catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [imageUrl, previewUrl])
  const adjustZoom = (factor: number) => setZoom(value => Math.max(1, Math.min(5, value * factor)))
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, yaw }
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const width = event.currentTarget.getBoundingClientRect().width || 1
    scheduleYaw(drag.current.yaw - (event.clientX - drag.current.x) / width * 300 / zoom)
  }
  const stop = () => { drag.current = null }
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    adjustZoom(event.deltaY < 0 ? 1.12 : 1 / 1.12)
  }
  const reset = () => { setYaw(0); setZoom(2.2) }

  return <div className="panorama-viewer">
    <div className="panorama-viewport" role="application" tabIndex={0}
      aria-label={t('globe.panorama.viewer', {title})}
      style={{ backgroundImage:`url("${displayUrl.replaceAll('"','%22')}")`, backgroundSize:`${100 * zoom}% auto`, backgroundPosition:`${yaw / 360 * 100}% center` }}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={stop} onPointerCancel={stop} onWheel={wheel}/>
    {loading && <span className="panorama-loading" role="status">{t('globe.panorama.loading')}</span>}
    <div className="panorama-viewer-toolbar" aria-label={t('globe.panorama.controls')}>
      <span>{Math.round(yaw)}° · {Math.round(zoom * 100)}%</span>
      <button onClick={() => adjustZoom(1.2)} aria-label={t('map.zoom.in')}>+</button>
      <button onClick={() => adjustZoom(1 / 1.2)} aria-label={t('map.zoom.out')}>−</button>
      <button onClick={reset}>{t('globe.reset')}</button>
    </div>
    <p>{t('globe.panorama.help')}</p>
  </div>
}
