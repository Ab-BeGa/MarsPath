import type { MarsSite } from './marsSites.ts'

export type GlobalMapCamera = { zoom: number; panX: number; panY: number }
export type GlobalMapSize = { width: number; height: number }
export type SiteCategoryFilter = 'all' | 'landing_site' | 'science_event'
export type SiteCluster = { id: string; x: number; y: number; sites: MarsSite[] }

/** Normalizes a published 0–360° east longitude to the map's [-180, 180) domain.
 * This is only a change of angular representation on Mars; it is NOT WGS84.
 */
export function normalizeMarsLongitude(longitudeEast: number): number {
  if (!Number.isFinite(longitudeEast) || longitudeEast < 0 || longitudeEast >= 360) {
    throw new Error('Expected Mars east-positive longitude in [0,360)')
  }
  return longitudeEast >= 180 ? longitudeEast - 360 : longitudeEast
}

/** Matches the existing MOLA/MOC/Viking equirectangular canvas viewport. */
export function projectGlobalSite(
  latitudeDeg: number, longitudeEastDeg: number,
  camera: GlobalMapCamera, size: GlobalMapSize,
): { x: number; y: number } {
  if (!Number.isFinite(latitudeDeg) || latitudeDeg < -90 || latitudeDeg > 90 ||
      !Number.isFinite(size.width) || !Number.isFinite(size.height) ||
      size.width <= 0 || size.height <= 0 || !Number.isFinite(camera.zoom) || camera.zoom <= 0) {
    throw new Error('Invalid Mars site coordinate or map viewport')
  }
  const fit = Math.min(size.width / 512, size.height / 256)
  const worldWidth = 512 * fit * camera.zoom
  const worldHeight = worldWidth / 2
  const left = size.width / 2 + camera.panX - worldWidth / 2
  const top = size.height / 2 + camera.panY - worldHeight / 2
  return {
    x: left + ((normalizeMarsLongitude(longitudeEastDeg) + 180) / 360) * worldWidth,
    y: top + ((90 - latitudeDeg) / 180) * worldHeight,
  }
}

/** Nearby markers are grouped in screen pixels; collocated observations remain
 * distinct selectable entries (e.g. Phoenix lander and its ice observation).
 */
export function visibleMarsSiteClusters(
  sites: MarsSite[], filter: SiteCategoryFilter,
  camera: GlobalMapCamera, size: GlobalMapSize,
  minSeparationPx = 32,
): SiteCluster[] {
  if (minSeparationPx <= 0 || !Number.isFinite(minSeparationPx)) {
    throw new Error('Invalid visual marker spacing')
  }
  const clusters: SiteCluster[] = []
  for (const site of sites) {
    if (filter !== 'all' && site.category !== filter) continue
    const point = projectGlobalSite(site.latitude_deg, site.longitude_east_deg, camera, size)
    const margin = 12
    if (point.x < margin || point.x > size.width - margin ||
        point.y < margin || point.y > size.height - margin) continue
    const candidate = clusters.find(cluster =>
      Math.hypot(cluster.x - point.x, cluster.y - point.y) < minSeparationPx)
    if (candidate) {
      const count = candidate.sites.length
      candidate.x = (candidate.x * count + point.x) / (count + 1)
      candidate.y = (candidate.y * count + point.y) / (count + 1)
      candidate.sites.push(site)
    } else {
      clusters.push({ id: site.id, x: point.x, y: point.y, sites: [site] })
    }
  }
  return clusters
}
