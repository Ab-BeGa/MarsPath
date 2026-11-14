import type { MarsTerrain } from './marsTerrain.ts'

export const CRISM_MODELS = ['magnesite', 'smectite'] as const
export type CrismModel = typeof CRISM_MODELS[number]

export async function loadCrismModels(terrain: MarsTerrain) {
  const base = './data/jezero/crism_model'
  const response = await fetch(base + '.json')
  if (!response.ok) throw new Error('CRISM model metadata unavailable')
  const data = await response.json()
  const { grid, crs_wkt } = terrain.metadata
  if (data.crs_wkt !== crs_wkt || data.width !== grid.width || data.height !== grid.height ||
      !Array.isArray(data.bounds_projected_m) || data.bounds_projected_m.length !== 4 ||
      grid.bounds_projected_m.some((value, axis) => value !== data.bounds_projected_m[axis])) {
    throw new Error('CRISM model does not match the Jezero map')
  }
  const entries = await Promise.all(CRISM_MODELS.map(async model => {
    const maximum: unknown = data.maximum_percent?.[model]
    if (typeof maximum !== 'number' || !Number.isFinite(maximum) || maximum <= 0 || maximum > 100) {
      throw new Error('Invalid CRISM model range')
    }
    const image = new Image()
    image.src = `${base}_${model}.png`
    await image.decode()
    if (image.naturalWidth !== grid.width || image.naturalHeight !== grid.height) {
      throw new Error('CRISM model image dimensions do not match its metadata')
    }
    return [model, { image, maximum }] as const
  }))
  return Object.fromEntries(entries) as Record<CrismModel, { image: HTMLImageElement; maximum: number }>
}
