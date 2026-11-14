/** Map existing exported route XY into pixel coordinates of the native Mars DEM.
 * Values are in the same projected Mars CRS; no Earth/WGS84 conversion.
 */
export type MapPoint = { x: number; y: number }
export type PixelPoint = { col: number; row: number }
export type RoutePair = { direct: MapPoint[]; detour: MapPoint[] }
export type MarsAffine = [number, number, number, number, number, number]

export function routeToGrid(points: MapPoint[], affine: MarsAffine): PixelPoint[] {
  const [stepX, shearX, left, shearY, stepY, top] = affine
  if (!Number.isFinite(stepX) || !Number.isFinite(stepY) ||
      !Number.isFinite(left) || !Number.isFinite(top) ||
      stepX <= 0 || stepY >= 0 || Math.abs(shearX) > 1e-8 || Math.abs(shearY) > 1e-8) {
    throw new Error('Неподдерживаемая марсианская DEM-привязка маршрута')
  }
  if (points.length < 2 || !points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    throw new Error('Маршрут должен содержать минимум две действительные XY-точки')
  }
  return points.map(p => ({
    col: (p.x - left) / stepX,
    row: (p.y - top) / stepY,
  }))
}
