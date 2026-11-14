import { useState } from 'react'
import { buildRouteMapGeometry, type MapPoint, type ScreenPoint } from './routeOverviewGeometry.ts'

type RouteId = 'direct' | 'detour'

function line(points: ScreenPoint[]): string {
  return points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
}

export function RouteOverview({ direct, detour }: { direct: MapPoint[]; detour: MapPoint[] }) {
  const [active, setActive] = useState<RouteId>('direct')
  const geometry = buildRouteMapGeometry(direct, detour)
  const routes = [
    { id: 'direct' as const, points: geometry.direct, name: 'Прямой маршрут' },
    { id: 'detour' as const, points: geometry.detour, name: 'Обходной маршрут' },
  ]
  // Put the active line on top, but always render both.
  const ordered = routes.slice().sort((a, b) => Number(a.id === active) - Number(b.id === active))

  return (
    <section className="route-overview-section" aria-labelledby="route-overview-heading">
      <h2 id="route-overview-heading">Маршруты на карте участка</h2>
      <p className="map-note">Схематичное отображение контрольных точек в метрической проекции DEM Марса. Не является снимком местности или оценкой безопасности.</p>
      <div className="route-controls" role="group" aria-label="Активный маршрут">
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
          role="img" aria-label="Два маршрута от базы A до научной точки B; активный маршрут выделен">
          <title>Прямой и обходной маршруты в районе Езеро</title>
          <desc>Бирюзовый путь — прямой; оранжевый — обходной. Общие точки A и B отмечены кругами.</desc>
          {ordered.map(route => (
            <polyline key={route.id}
              className={`route-path route-path--${route.id} ${route.id === active ? 'route-path--active' : 'route-path--inactive'}`}
              points={line(route.points)} />
          ))}
          <circle className="route-endpoint route-endpoint--base" cx={geometry.base.x} cy={geometry.base.y} r="10" />
          <circle className="route-endpoint route-endpoint--science" cx={geometry.science.x} cy={geometry.science.y} r="10" />
          <text className="route-point-label" x={geometry.base.x + 14} y={geometry.base.y - 15}>A · База</text>
          <text className="route-point-label" x={geometry.science.x + 14} y={geometry.science.y - 15}>B · Научная точка</text>
        </svg>
      </div>
      <p className="route-map-status" role="status">
        Активен: <strong>{active === 'direct' ? 'прямой' : 'обходной'}</strong>. Оба маршрута остаются видимыми.
      </p>
      <div className="route-map-legend">
        <span><i className="legend-line legend-line--direct" />Прямой</span>
        <span><i className="legend-line legend-line--detour" />Обходной</span>
        <span><i className="legend-dot legend-dot--base" />База A</span>
        <span><i className="legend-dot legend-dot--science" />Научная точка B</span>
      </div>
    </section>
  )
}
