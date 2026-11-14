import { useEffect, useRef } from 'react'
import { useI18n } from './i18n.tsx'
import type { MarsSite } from './marsSites.ts'

export function MarsSiteInfoCard({
  sites, selectedId, onSelect, onClose,
}: {
  sites: MarsSite[]
  selectedId: string
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const {t, locale} = useI18n()
  const closeRef = useRef<HTMLButtonElement>(null)
  const selected = sites.find(site => site.id === selectedId) ?? sites[0]

  useEffect(() => { closeRef.current?.focus() }, [selected.id])

  if (!selected) return null

  const typeLabel = t('map.sites.type.' + selected.type)
  const error = selected.georeferencing.estimated_horizontal_error_m
  const digits = selected.georeferencing.reported_decimal_places

  return (
    <aside className="global-site-popup" role="dialog" aria-modal="false"
      aria-labelledby="global-site-popup-title"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      }}>
      <div className="global-site-popup-top">
        <span className={`global-site-category global-site-category--${selected.category}`}>
          {selected.category === 'landing_site' ? t('map.sites.landing') : t('map.sites.science')}
        </span>
        <button ref={closeRef} type="button" className="global-site-popup-close"
          aria-label={t('map.sites.close')} onClick={onClose}>×</button>
      </div>

      {sites.length > 1 && <div className="global-site-group">
        <p>{t('map.sites.nearby', {count:sites.length})}</p>
        <div className="global-site-group-options" role="group" aria-label={t('map.sites.nearbyGroup')}>
          {sites.map(site => (
            <button type="button" key={site.id} aria-pressed={site.id === selected.id}
              className={site.id === selected.id ? 'selected' : ''}
              onClick={() => onSelect(site.id)}>{site.name}</button>
          ))}
        </div>
      </div>}

      <h4 id="global-site-popup-title">{selected.name}</h4>
      <dl className="global-site-facts">
        <dt>{t('map.sites.type')}</dt><dd>{typeLabel}</dd>
        <dt>{t('map.sites.mission')}</dt><dd>{selected.mission}</dd>
        <dt>{t('map.sites.region')}</dt><dd>{selected.region}</dd>
        <dt>{t('map.sites.date')}</dt><dd>{selected.date_utc}</dd>
        <dt>{t('map.sites.coordinates')}</dt>
        <dd>{selected.as_published.latitude} · {selected.as_published.longitude}</dd>
      </dl>

      <p className="global-site-description">
        <strong>{t('map.sites.description')}{locale !== 'ru' ? ' (RU)' : ''}:</strong>{' '}
        {selected.description_ru}
      </p>
      {selected.category === 'science_event' && <p className="global-site-caution">
        {t('map.sites.observationAnchor')}
      </p>}

      <div className="global-site-precision">
        <h5>{t('map.sites.precision')}</h5>
        <p><strong>{t('map.sites.method')}:</strong> {selected.georeferencing.method}</p>
        <p>{t('map.sites.decimals', {latitude:digits.latitude, longitude:digits.longitude})}</p>
        <p>{error === null
          ? t('map.sites.unknownAccuracy')
          : t('map.sites.errorMeters', {meters:error})}</p>
        <p className="global-site-precision-note">
          {t('map.sites.accuracyNote')}
        </p>
        <p>{selected.georeferencing.notes_ru}</p>
      </div>

      {selected.alternative_positions && selected.alternative_positions.length > 0 && (
        <div className="global-site-alternative">
          <h5>{t('map.sites.alternative')}</h5>
          {selected.alternative_positions.map(alt =>
            <p key={alt.method}>{alt.method}: {alt.as_published.latitude} · {alt.as_published.longitude}</p>)}
        </div>
      )}

      <div className="global-site-sources">
        <h5>{t('map.sites.sources')}</h5>
        <ul>{selected.sources.map(source =>
          <li key={source.url + source.role}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
          </li>)}</ul>
      </div>
    </aside>
  )
}
