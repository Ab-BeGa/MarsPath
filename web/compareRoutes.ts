import type { RoutePair } from './routeMap.ts'

type Point = { x: number; y: number }
type Metric = number | null

export type ComparisonRow = {
  label: string
  unit: string
  direct: Metric
  detour: Metric
  delta: Metric
}

export type RouteComparison = {
  rows: ComparisonRow[]
  coverage: { direct: number; detour: number; partial: boolean }
  demVerified: boolean
  origin?: 'browser' | 'import'
  routes: RoutePair
  source: { crs: string; demHash?: string; step: number }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Некорректный формат экспорта маршрута')
  }
  return value as Record<string, unknown>
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Некорректный формат числа в экспорте маршрута')
  }
  return value
}

function nonnegative(value: unknown): number {
  const result = number(value)
  if (result < 0) throw new Error('Некорректный формат метрики маршрута')
  return result
}

function metric(value: unknown): Metric {
  return value === null ? null : nonnegative(value)
}

function readRoute(input: unknown) {
  const route = object(input)
  const demHash = route.dem_sha256
  if (demHash !== undefined && (typeof demHash !== 'string' || !/^[a-f0-9]{64}$/i.test(demHash))) {
    throw new Error('Некорректный SHA-256 источника DEM')
  }
  const stats = object(route.route_metrics)
  const terrain = object(route.experimental_traversability)
  const thresholds = object(terrain.thresholds_deg)
  if (
    typeof route.crs_wkt !== 'string' || !route.crs_wkt.trim() ||
    !Array.isArray(route.waypoints) || route.waypoints.length < 2 ||
    !Array.isArray(terrain.intervals) || terrain.intervals.length === 0
  ) throw new Error('Некорректный формат экспорта маршрута')

  const points: Point[] = route.waypoints.map(value => {
    const point = object(value)
    return { x: number(point.x), y: number(point.y) }
  })
  const length = nonnegative(stats.distance_m)
  const step = number(route.dem_sample_step_max_m)
  const limits = [
    number(thresholds.gentle_max_deg),
    number(thresholds.moderate_max_deg),
    number(thresholds.steep_max_deg),
  ]
  if (step <= 0 || length <= 0 || !(0 < limits[0] && limits[0] < limits[1] &&
    limits[1] < limits[2] && limits[2] < 90)) {
    throw new Error('Некорректный формат параметров маршрута')
  }

  let steepCount = 0
  let steepLength = 0
  let unknownLength = 0
  let measuredLength = 0
  for (const value of terrain.intervals) {
    const { band, distance_m } = object(value)
    const distance = number(distance_m)
    if (distance <= 0 || distance > step + 1e-6 ||
      !['gentle', 'moderate', 'steep', 'very_steep', 'unknown'].some(item => item === band)) {
      throw new Error('Некорректный формат интервала маршрута')
    }
    if (band === 'unknown') unknownLength += distance
    else measuredLength += distance
    if (band === 'steep' || band === 'very_steep') {
      steepCount++
      steepLength += distance
    }
  }
  const intervalLength = measuredLength + unknownLength
  if (Math.abs(intervalLength - length) > 1e-6 * Math.max(1, length)) {
    throw new Error('Длины интервалов не совпадают с длиной маршрута')
  }

  const measured = measuredLength > 0
  return {
    points, crs: route.crs_wkt, step, limits,
    demHash: demHash?.toLowerCase(),
    coverage: 100 * measuredLength / intervalLength,
    partial: unknownLength > 0,
    values: [
      length, metric(stats.total_ascent_m), metric(stats.max_measured_abs_slope_deg),
      measured ? steepCount : null, measured ? steepLength : null, unknownLength,
    ],
  }
}

const metrics = [
  { label: 'Длина маршрута', unit: 'м' },
  { label: 'Набор высоты', unit: 'м' },
  { label: 'Максимальный измеренный уклон', unit: '°' },
  { label: 'Крутые интервалы', unit: '' },
  { label: 'Длина крутых интервалов', unit: 'м' },
  { label: 'Участки без данных', unit: 'м' },
]

export function compareRoutes(directInput: unknown, detourInput: unknown): RouteComparison {
  const direct = readRoute(directInput)
  const detour = readRoute(detourInput)
  if (direct.points.length !== 2) {
    throw new Error('Прямой маршрут должен содержать две контрольные точки')
  }
  if (direct.crs !== detour.crs) throw new Error('Проекции маршрутов различаются')
  const demVerified = direct.demHash !== undefined && detour.demHash !== undefined
  if (demVerified && direct.demHash !== detour.demHash) {
    throw new Error('Маршруты рассчитаны по разным DEM. Повторите экспорт с одним исходным GeoTIFF.')
  }
  const detourEnds = [detour.points[0], detour.points[detour.points.length - 1]]
  if (direct.points.some((p, i) => Math.hypot(p.x - detourEnds[i].x, p.y - detourEnds[i].y) > 0.001)) {
    throw new Error('Начальная и конечная точки маршрутов должны совпадать')
  }
  if (direct.step !== detour.step) throw new Error('Значения шага выборки различаются')
  if (direct.limits.some((limit, i) => limit !== detour.limits[i])) {
    throw new Error('Пороги уклонов различаются')
  }

  const rows = metrics.map((row, i) => {
    const baseline = direct.values[i]
    const alternative = detour.values[i]
    return {
      ...row, direct: baseline, detour: alternative,
      delta: baseline === null || alternative === null ? null : alternative - baseline,
    }
  })
  return {
    rows,
    coverage: { direct: direct.coverage, detour: detour.coverage, partial: direct.partial || detour.partial },
    demVerified,
    routes: { direct: direct.points, detour: detour.points },
    source: { crs: direct.crs, demHash: direct.demHash, step: direct.step },
  }
}
