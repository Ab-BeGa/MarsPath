/** Route elevation sampling in the projected Mars DEM coordinate system (metres).
 * Heights are read from existing DEM cells; positions along a route are
 * evenly spaced but elevations are never interpolated between cells.
 */
export type ProjectedPoint = { x: number; y: number }
export type SampleStatus = 'valid' | 'nodata' | 'outside_roi'
export type ElevationReading = { elevation_m: number | null; status: SampleStatus }
export type ProfileSample = ProjectedPoint & ElevationReading & { distance_m: number }
export type RouteElevationProfile = {
  samples: ProfileSample[]
  total_m: number
  valid_count: number
}

const MAX_SAMPLES = 20_000

export function sampleRouteElevation(
  waypoints: ProjectedPoint[],
  step_m: number,
  readElevation: (point: ProjectedPoint) => ElevationReading,
): RouteElevationProfile {
  if (!Array.isArray(waypoints) || waypoints.length < 2 ||
      !waypoints.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) {
    throw new Error('Для профиля нужны минимум две точки в метрической проекции Марса')
  }
  if (!Number.isFinite(step_m) || step_m <= 0) {
    throw new Error('Шаг измерений профиля должен быть положительным')
  }
  const samples: ProfileSample[] = []
  let total_m = 0
  let valid_count = 0
  const append = (point: ProjectedPoint, distance_m: number) => {
    const reading = readElevation(point)
    if (!reading || !['valid', 'nodata', 'outside_roi'].includes(reading.status) ||
        (reading.status === 'valid'
          ? reading.elevation_m === null || !Number.isFinite(reading.elevation_m)
          : reading.elevation_m !== null)) {
      throw new Error('Несогласованные высота и статус DEM')
    }
    if (reading.status === 'valid') valid_count++
    samples.push({ x: point.x, y: point.y, distance_m, ...reading })
  }
  append(waypoints[0], 0)
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1]
    const to = waypoints[i]
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (!Number.isFinite(length) || length <= 1e-8) {
      throw new Error('Соседние контрольные точки должны различаться')
    }
    const count = Math.max(1, Math.ceil(length / step_m))
    if (samples.length + count > MAX_SAMPLES) {
      throw new Error('Слишком много измерений для интерактивного профиля')
    }
    for (let k = 1; k <= count; k++) {
      const t = k / count
      append({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      }, total_m + length * t)
    }
    total_m += length
  }
  return { samples, total_m, valid_count }
}

export function nearestProfileSample(profile: RouteElevationProfile, distance_m: number): number {
  const samples = profile.samples
  if (!samples.length || !Number.isFinite(distance_m)) {
    throw new Error('Не удалось выбрать точку профиля')
  }
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (samples[mid].distance_m < distance_m) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return 0
  const left = samples[lo - 1]
  const right = samples[lo]
  return Math.abs(distance_m - left.distance_m) <= Math.abs(right.distance_m - distance_m)
    ? lo - 1 : lo
}

export function selectedProfileInterval(profile: RouteElevationProfile, selectedIndex: number) {
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= profile.samples.length) {
    throw new Error('Выбранная точка отсутствует в профиле')
  }
  const from = selectedIndex === 0 ? 0 : selectedIndex - 1
  const to = selectedIndex === 0 ? 1 : selectedIndex
  return { from: profile.samples[from], to: profile.samples[to] }
}
