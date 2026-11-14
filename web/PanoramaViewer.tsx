import { useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { useI18n } from './i18n.tsx'

export function PanoramaViewer({ imageUrl, title }: { imageUrl: string; title: string }) {
  const { t } = useI18n()
  const drag = useRef<{ x: number; yaw: number } | null>(null)
  const [yaw, setYaw] = useState(0)
  const [zoom, setZoom] = useState(2.2)
  const clampYaw = (value: number) => Math.max(0, Math.min(360, value))
  const adjustZoom = (factor: number) => setZoom(value => Math.max(1, Math.min(5, value * factor)))
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, yaw }
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const width = event.currentTarget.getBoundingClientRect().width || 1
    setYaw(clampYaw(drag.current.yaw - (event.clientX - drag.current.x) / width * 300 / zoom))
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
      style={{ backgroundImage:`url("${imageUrl.replaceAll('"','%22')}")`, backgroundSize:`${100 * zoom}% auto`, backgroundPosition:`${yaw / 360 * 100}% center` }}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={stop} onPointerCancel={stop} onWheel={wheel}/>
    <div className="panorama-viewer-toolbar" aria-label={t('globe.panorama.controls')}>
      <span>{Math.round(yaw)}° · {Math.round(zoom * 100)}%</span>
      <button onClick={() => adjustZoom(1.2)} aria-label={t('map.zoom.in')}>+</button>
      <button onClick={() => adjustZoom(1 / 1.2)} aria-label={t('map.zoom.out')}>−</button>
      <button onClick={reset}>{t('globe.reset')}</button>
    </div>
    <p>{t('globe.panorama.help')}</p>
  </div>
}
