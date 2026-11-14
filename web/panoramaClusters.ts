export type PositionedPanorama<T> = { item: T; x: number; y: number }
export type PanoramaCluster<T> = { id: string; x: number; y: number; items: T[] }

export function clusterPanoramas<T>(points: PositionedPanorama<T>[], radius = 34): PanoramaCluster<T>[] {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Panorama cluster radius must be positive')
  const clusters: Array<PanoramaCluster<T> & { count: number }> = []
  for (const point of points) {
    const cluster = clusters.find(candidate => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= radius)
    if (!cluster) {
      clusters.push({ id:`panorama-${clusters.length}`, x:point.x, y:point.y, items:[point.item], count:1 })
      continue
    }
    cluster.x = (cluster.x * cluster.count + point.x) / (cluster.count + 1)
    cluster.y = (cluster.y * cluster.count + point.y) / (cluster.count + 1)
    cluster.count += 1
    cluster.items.push(point.item)
  }
  return clusters.map(({count:_,...cluster}) => cluster)
}
