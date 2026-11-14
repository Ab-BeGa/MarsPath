/** Task 21: experimental measured *longitudinal* grade along Mars routes.
 *
 * Heights are copied from the same original 20 m USGS CTX DEM cells shown by
 * Mission Control. Sample positions are interpolated in projected metres;
 * measured DEM elevations are NEVER interpolated across cells or missing data.
 * The resulting bands are explanatory, NOT EVA/passability certifications.
 */
import { cellAtProjected, type MarsTerrain } from './marsTerrain.ts'
import type { MapPoint } from './routeMap.ts'

export type SlopeBand = 'gentle' | 'moderate' | 'steep' | 'very_steep' | 'unknown'
export type SlopeThresholds = { gentle_max_deg: number; moderate_max_deg: number; steep_max_deg: number }
export type SlopeSample = MapPoint & {
  distance_m: number
  elevation_m: number | null
  status: 'valid' | 'nodata' | 'outside_roi'
}
export type SlopeInterval = {
  from: SlopeSample
  to: SlopeSample
  distance_m: number
  grade_deg: number | null
  band: SlopeBand
}
export type SlopeReport = {
  samples: SlopeSample[]
  intervals: SlopeInterval[]
  total_m: number
  distances_m: Record<SlopeBand, number>
  difficult_m: number
  unknown_m: number
  thresholds: SlopeThresholds
}

export const DEFAULT_SLOPE_THRESHOLDS: Readonly<SlopeThresholds> = Object.freeze({
  gentle_max_deg: 5, moderate_max_deg: 10, steep_max_deg: 15,
})
export const SLOPE_COLORS: Readonly<Record<SlopeBand, string>> = Object.freeze({
  gentle: '#55efc4',
  moderate: '#ffd27d',
  steep: '#fb924d',
  very_steep: '#f56698',
  unknown: '#a7b3c0',
})

const MAX_SAMPLES = 20_000
const BANDS: SlopeBand[] = ['gentle', 'moderate', 'steep', 'very_steep', 'unknown']

export function validateSlopeThresholds(value: SlopeThresholds): SlopeThresholds {
  const { gentle_max_deg: a, moderate_max_deg: b, steep_max_deg: c } = value
  if (![a, b, c].every(Number.isFinite) || !(0 < a && a < b && b < c && c < 90)) {
    throw new Error('Пороги должны удовлетворять: 0 < пологий < умеренный < крутой < 90°')
  }
  return { gentle_max_deg: a, moderate_max_deg: b, steep_max_deg: c }
}

export function classifySlope(grade_deg: number | null, thresholds: SlopeThresholds): SlopeBand {
  if (grade_deg === null) return 'unknown'
  if (!Number.isFinite(grade_deg) || grade_deg < 0 || grade_deg >= 90) {
    throw new Error('Недопустимое значение измеренного продольного уклона')
  }
  const { gentle_max_deg: a, moderate_max_deg: b, steep_max_deg: c } = thresholds
  return grade_deg <= a ? 'gentle' : grade_deg <= b ? 'moderate'
    : grade_deg <= c ? 'steep' : 'very_steep'
}

/** Sample at a maximum 20 m horizontal spacing, matching the Python methodology. */
export function measureRouteSlope(
  terrain: MarsTerrain, waypoints: MapPoint[],
  thresholds: SlopeThresholds = DEFAULT_SLOPE_THRESHOLDS, step_m = 20,
): SlopeReport {
  const limits = validateSlopeThresholds(thresholds)
  if (!Array.isArray(waypoints) || waypoints.length < 2 ||
      !waypoints.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) {
    throw new Error('Необходимо минимум две корректные точки в марсианской проекции')
  }
  if (!Number.isFinite(step_m) || step_m <= 0 || step_m > 20) {
    throw new Error('Шаг измерений должен быть от 0 до 20 м (включительно)')
  }
  const samples: SlopeSample[] = []
  let distance = 0
  const append = (x: number, y: number, at: number) => {
    const cell = cellAtProjected(terrain, x, y)
    const status = cell === null ? 'outside_roi' : cell.elevation === null ? 'nodata' : 'valid'
    samples.push({ x, y, distance_m: at, elevation_m: cell?.elevation ?? null, status })
  }
  append(waypoints[0].x, waypoints[0].y, 0)
  for (let index = 1; index < waypoints.length; index++) {
    const from = waypoints[index - 1]
    const to = waypoints[index]
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y)
    if (!(segmentLength > 1e-8) || !Number.isFinite(segmentLength)) {
      throw new Error('Соседние точки маршрута должны отличаться')
    }
    const count = Math.ceil(segmentLength / step_m)
    if (samples.length + count > MAX_SAMPLES) {
      throw new Error('Слишком много отсчётов вдоль маршрута')
    }
    for (let k = 1; k <= count; k++) {
      const t = k / count
      append(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t,
        distance + segmentLength * t)
    }
    distance += segmentLength
  }

  const distances_m = Object.fromEntries(BANDS.map(band => [band, 0])) as Record<SlopeBand, number>
  const intervals: SlopeInterval[] = []
  for (let index = 1; index < samples.length; index++) {
    const from = samples[index - 1]
    const to = samples[index]
    const length = to.distance_m - from.distance_m
    if (length <= 0 || !Number.isFinite(length)) throw new Error('Расстояния DEM-отсчётов должны возрастать')
    const known = from.status === 'valid' && to.status === 'valid'
    const grade = known
      ? Math.atan(Math.abs(to.elevation_m! - from.elevation_m!) / length) * 180 / Math.PI
      : null
    const band = classifySlope(grade, limits)
    distances_m[band] += length
    intervals.push({ from, to, distance_m: length, grade_deg: grade, band })
  }
  return {
    samples, intervals, total_m: distance,
    distances_m,
    difficult_m: distances_m.steep + distances_m.very_steep,
    unknown_m: distances_m.unknown,
    thresholds: limits,
  }
}
