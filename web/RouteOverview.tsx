import { useState } from 'react'
import { useI18n } from './i18n.tsx'
import { buildRouteMapGeometry, type MapPoint, type ScreenPoint } from './routeOverviewGeometry.ts'

type RouteId = 'direct' | 'detour'

function line(points: ScreenPoint[]): string {
  return points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
}

export function RouteOverview({ direct, detour, browserMode = false }: { direct: MapPoint[]; detour: MapPoint[]; browserMode?: boolean }) {
  const {t} = useI18n()
  const [active, setActive] = useState<RouteId>('direct')
  const geometry = buildRouteMapGeometry(direct, detour)
  const routes = [
    { id: 'direct' as const, points: geometry.direct, name: t(browserMode ? 'planner.shortest' : 'route.direct.full') },
    { id: 'detour' as const, points: geometry.detour, name: t(browserMode ? 'planner.slopeCost' : 'route.detour.full') },
  ]
  // Put the active line on top, but always render both.
  const ordered = routes.slice().sort((a, b) => Number(a.id === active) - Number(b.id === active))

  return (
    <section className="route-overview-section" aria-labelledby="route-overview-heading">
      <h2 id="route-overview-heading">{t('overview.title')}</h2>
      <p className="map-note">{t('overview.description')}</p>
      <div className="route-controls" role="group" aria-label={t('overview.activeAria')}>
        {routes.map(route => (
          <button key={route.id} type="button"
            className={`route-selector route-selector--${route.id}`}
            aria-pressed={active === route.id}
            onClick={() => setActive(route.id)}>
            {route.name}
          </button>
        ))}
      </div>
      <div className="route-map-scroll">
        <svg className="route-map" viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          role="img" aria-label={t('overview.imageAria')}>
          <title>{t('overview.imageTitle')}</title>
          <desc>{t('overview.imageDesc')}</desc>
          {ordered.map(route => (
            <polyline key={route.id}
              className={`route-path route-path--${route.id} ${route.id === active ? 'route-path--active' : 'route-path--inactive'}`}
              points={line(route.points)} />
          ))}
          <circle className="route-endpoint route-endpoint--base" cx={geometry.base.x} cy={geometry.base.y} r="10" />
          <circle className="route-endpoint route-endpoint--science" cx={geometry.science.x} cy={geometry.science.y} r="10" />
          <text className="route-point-label" x={geometry.base.x + 14} y={geometry.base.y - 15}>{t('overview.base')}</text>
          <text className="route-point-label" x={geometry.science.x + 14} y={geometry.science.y - 15}>{t('overview.science')}</text>
        </svg>
      </div>
      <p className="route-map-status" role="status">
        {t('overview.active')} <strong>{active === 'direct' ? t(browserMode ? 'planner.shortest' : 'route.direct.lower') : t(browserMode ? 'planner.slopeCost' : 'route.detour.lower')}</strong>. {t('overview.bothVisible')}
      </p>
      <div className="route-map-legend">
        <span><i className="legend-line legend-line--direct" />{t(browserMode ? 'planner.shortest' : 'route.direct')}</span>
        <span><i className="legend-line legend-line--detour" />{t(browserMode ? 'planner.slopeCost' : 'route.detour')}</span>
        <span><i className="legend-dot legend-dot--base" />{t('overview.baseSmall')}</span>
        <span><i className="legend-dot legend-dot--science" />{t('overview.scienceSmall')}</span>
      </div>
    </section>
  )
}
