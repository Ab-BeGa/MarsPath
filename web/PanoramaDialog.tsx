import { useEffect } from 'react'
import { useI18n } from './i18n.tsx'
import type { JezeroPhoto } from './photoCatalog.ts'
import { PanoramaViewer } from './PanoramaViewer.tsx'

export function PanoramaDialog({ panoramas, selected, onSelect, onClose }: {
  panoramas: JezeroPhoto[]; selected: JezeroPhoto
  onSelect: (photo: JezeroPhoto) => void; onClose: () => void
}) {
  const { t } = useI18n()
  const index = Math.max(0, panoramas.findIndex(item => item.id === selected.id))
  const adjacent = (direction: -1 | 1) => onSelect(panoramas[(index + direction + panoramas.length) % panoramas.length])
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', close) }
  }, [onClose])

  return <aside className="globe-panorama-card" role="dialog" aria-modal="true" aria-label={selected.title}>
    <button className="global-site-popup-close" onClick={onClose} aria-label={t('map.photos.close')}>×</button>
    <PanoramaViewer key={selected.id} imageUrl={selected.image_url} title={selected.title}/>
    <div className="panorama-dialog-copy"><span className="section-kicker">360° · {selected.camera}</span>
      <h4>{selected.title}</h4><p>{selected.caption}</p>
      <p className="globe-panorama-warning">{t('globe.panorama.locationNote')}</p>
      <div className="panorama-sequence">
        <button onClick={() => adjacent(-1)}>← {t('globe.panorama.previous')}</button>
        <span>{index + 1} / {panoramas.length}</span>
        <button onClick={() => adjacent(1)}>{t('globe.panorama.next')} →</button>
      </div>
      <a href={selected.page_url} target="_blank" rel="noopener noreferrer">{t('map.photos.nasaSource')} ↗</a>
    </div>
  </aside>
}
