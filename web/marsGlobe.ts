export type GlobeView = { longitude: number; latitude: number; zoom: number }
export type GlobePoint = { x: number; y: number; visible: boolean }

export function normalizeLongitude(value: number) {
  return ((value + 180) % 360 + 360) % 360 - 180
}

export function clampGlobeView(view: GlobeView): GlobeView {
  return {
    longitude: normalizeLongitude(view.longitude),
    latitude: Math.max(-85, Math.min(85, view.latitude)),
    zoom: Math.max(0.72, Math.min(1.7, view.zoom)),
  }
}

function radians(value: number) { return value * Math.PI / 180 }

export function marsToGlobeScreen(
  longitude: number, latitude: number, view: GlobeView,
): GlobePoint {
  const lon = radians(longitude - view.longitude)
  const lat = radians(latitude)
  const centerLat = radians(view.latitude)
  const cosLat = Math.cos(lat)
  const depth = Math.sin(centerLat) * Math.sin(lat) + Math.cos(centerLat) * cosLat * Math.cos(lon)
  return {
    x: cosLat * Math.sin(lon),
    y: Math.cos(centerLat) * Math.sin(lat) - Math.sin(centerLat) * cosLat * Math.cos(lon),
    visible: depth >= 0,
  }
}

export function screenUnitToMars(x: number, y: number, view: GlobeView) {
  const rho = Math.hypot(x, y)
  if (rho > 1) return null
  const c = Math.asin(Math.min(1, rho))
  const sinC = Math.sin(c)
  const cosC = Math.cos(c)
  const centerLat = radians(view.latitude)
  const latitude = rho === 0 ? centerLat : Math.asin(
    cosC * Math.sin(centerLat) + y * sinC * Math.cos(centerLat) / rho,
  )
  const longitude = radians(view.longitude) + (rho === 0 ? 0 : Math.atan2(
    x * sinC,
    rho * Math.cos(centerLat) * cosC - y * Math.sin(centerLat) * sinC,
  ))
  return { longitude: normalizeLongitude(longitude * 180 / Math.PI), latitude: latitude * 180 / Math.PI }
}

export function texturePixel(longitude: number, latitude: number, width: number, height: number) {
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor((normalizeLongitude(longitude) + 180) / 360 * width))),
    y: Math.max(0, Math.min(height - 1, Math.floor((90 - latitude) / 180 * height))),
  }
}
