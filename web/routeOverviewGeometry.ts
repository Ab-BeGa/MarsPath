/** Local projected-Mars route visualization. Coordinates stay in the DEM CRS (metres). */
export type MapPoint = { x: number; y: number }
export type ScreenPoint = { x: number; y: number }
export type RouteMapGeometry = {
  direct: ScreenPoint[]
  detour: ScreenPoint[]
  base: ScreenPoint
  science: ScreenPoint
  width: number
  height: number
}

const WIDTH = 900
const HEIGHT = 510
const PADDING = 54

/** Fit both polylines into one viewport without changing route geometry or distances. */
export function buildRouteMapGeometry(direct: MapPoint[], detour: MapPoint[]): RouteMapGeometry {
  if (direct.length < 2 || detour.length < 2) {
    throw new Error('Для отображения нужны два маршрута с началом и концом')
  }
  const all = [...direct, ...detour]
  if (!all.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    throw new Error('Некорректные координаты маршрутов')
  }
  const samePoint = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y) <= 0.001
  if (!samePoint(direct[0], detour[0]) || !samePoint(direct.at(-1)!, detour.at(-1)!)) {
    throw new Error('Начало и конец маршрутов должны совпадать')
  }

  const xs = all.map(p => p.x)
  const ys = all.map(p => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const extentX = maxX - minX
  const extentY = maxY - minY
  const scale = Math.min(
    (WIDTH - 2 * PADDING) / Math.max(extentX, 1),
    (HEIGHT - 2 * PADDING) / Math.max(extentY, 1),
  )
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  // SVG Y grows downward, projected northing grows upward.
  const screen = (p: MapPoint): ScreenPoint => ({
    x: WIDTH / 2 + (p.x - midX) * scale,
    y: HEIGHT / 2 - (p.y - midY) * scale,
  })
  const projectedDirect = direct.map(screen)
  return {
    direct: projectedDirect,
    detour: detour.map(screen),
    base: projectedDirect[0],
    science: projectedDirect[projectedDirect.length - 1],
    width: WIDTH,
    height: HEIGHT,
  }
}
