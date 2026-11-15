import { useEffect } from 'react'
import { useI18n } from './i18n.tsx'
import { photoText } from './sciencePhotoTranslations.ts'
import type { JezeroPhoto } from './photoCatalog.ts'
import { PanoramaViewer, preloadPanoramaImage } from './PanoramaViewer.tsx'

export function PanoramaDialog({ panoramas, selected, onSelect, onClose }: {
  panoramas: JezeroPhoto[]; selected: JezeroPhoto
  onSelect: (photo: JezeroPhoto) => void; onClose: () => void
}) {
  const { t, locale } = useI18n()
  const index = Math.max(0, panoramas.findIndex(item => item.id === selected.id))
  const isPortraitMosaic = selected.id === 'pia25736-sol-693-three-forks-sample-depot'
  const adjacent = (direction: -1 | 1) => onSelect(panoramas[(index + direction + panoramas.length) % panoramas.length])
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', close) }
  }, [onClose])
  useEffect(() => {
    const neighbours = [selected, panoramas[(index + 1) % panoramas.length], panoramas[(index - 1 + panoramas.length) % panoramas.length]]
    for (const panorama of neighbours) if (panorama) void preloadPanoramaImage(panorama.image_url).catch(() => undefined)
  }, [index, panoramas, selected])

  return <aside className="globe-panorama-card" role="dialog" aria-modal="true" aria-label={photoText(selected,locale,'title')}>
    <button className="global-site-popup-close" onClick={onClose} aria-label={t('map.photos.close')}>×</button>
    <PanoramaViewer key={selected.id} imageUrl={selected.image_url} previewUrl={selected.thumbnail_url} title={photoText(selected,locale,'title')}
      initialZoom={isPortraitMosaic ? 1 : 2.2} minimumZoom={1}
      initialYaw={isPortraitMosaic ? 180 : 0} fit={isPortraitMosaic ? 'height' : 'width'}/>
    <div className="panorama-dialog-copy"><span className="section-kicker">{/330-degree/i.test(selected.caption) ? '330°' : '360°'} · {selected.camera}</span>
      <h4>{photoText(selected,locale,'title')}</h4><p>{photoText(selected,locale,'caption')}</p>
      <p className="globe-panorama-warning">{t('globe.panorama.locationNote')}</p>
      {isPortraitMosaic && <p className="panorama-crop-note">{t('globe.panorama.mosaicNote')}</p>}
      <div className="panorama-sequence">
        <button onClick={() => adjacent(-1)}>← {t('globe.panorama.previous')}</button>
        <span>{index + 1} / {panoramas.length}</span>
        <button onClick={() => adjacent(1)}>{t('globe.panorama.next')} →</button>
      </div>
      <a href={selected.page_url} target="_blank" rel="noopener noreferrer">{t('map.photos.nasaSource')} ↗</a>
    </div>
    <div className="panorama-list" aria-label={t('globe.panorama.list')}>
      {panoramas.map((panorama, itemIndex) => <button key={panorama.id} aria-pressed={panorama.id === selected.id}
        onMouseEnter={() => { void preloadPanoramaImage(panorama.image_url).catch(() => undefined) }}
        onFocus={() => { void preloadPanoramaImage(panorama.image_url).catch(() => undefined) }}
        onClick={() => onSelect(panorama)}>
        <img src={panorama.thumbnail_url} alt="" loading={itemIndex < 3 ? 'eager' : 'lazy'} decoding="async"/>
        <span><b>{photoText(panorama,locale,'title')}</b><small>{panorama.mission} · {t('map.photos.sols')} {panorama.acquisition.sols.join('–')}</small></span>
      </button>)}
    </div>
  </aside>
}
