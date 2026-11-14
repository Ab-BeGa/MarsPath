import type { JezeroPhoto } from './photoCatalog.ts'

export type PhotoScreenPoint = { photo: JezeroPhoto; x: number; y: number }
export type PhotoCluster = { id: string; x: number; y: number; points: PhotoScreenPoint[] }

export function filterPhotos(photos: JezeroPhoto[], camera: string, solMin: number | null, solMax: number | null): JezeroPhoto[] {
  return photos.filter(photo => {
    if (camera && photo.camera !== camera) return false
    return photo.acquisition.sols.some(sol => (solMin === null || sol >= solMin) && (solMax === null || sol <= solMax))
  })
}

export function clusterPhotoPoints(points: PhotoScreenPoint[], radiusPx: number): PhotoCluster[] {
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) throw new Error('Cluster radius must be positive')
  const clusters: PhotoCluster[] = []
  for (const point of points) {
    const match = clusters.find(cluster => Math.hypot(point.x - cluster.x, point.y - cluster.y) <= radiusPx)
    if (!match) {
      clusters.push({ id: point.photo.id, x: point.x, y: point.y, points: [point] })
      continue
    }
    match.points.push(point)
    match.x = match.points.reduce((sum, item) => sum + item.x, 0) / match.points.length
    match.y = match.points.reduce((sum, item) => sum + item.y, 0) / match.points.length
    match.id = match.points.map(item => item.photo.id).sort().join('+')
  }
  return clusters
}
