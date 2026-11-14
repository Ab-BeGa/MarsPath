import type { MarsTerrain } from './marsTerrain.ts'

export async function loadThemisLayer(terrain: MarsTerrain): Promise<HTMLImageElement> {
  const base = './data/jezero/'
  const response = await fetch(base + 'themis_day.json')
  if (!response.ok) throw new Error('THEMIS metadata unavailable')
  const data = await response.json()
  const bounds = terrain.metadata.grid.bounds_projected_m
  if (data.crs_wkt !== terrain.metadata.crs_wkt ||
      !Array.isArray(data.bounds_projected_m) || data.bounds_projected_m.length !== 4 ||
      bounds.some((value, i) => value !== data.bounds_projected_m[i]) ||
      !Number.isInteger(data.width) || !Number.isInteger(data.height) ||
      data.width < 1 || data.height < 1 ||
      data.source_resolution_m !== 100 ||
      Math.abs((bounds[2] - bounds[0]) - 100 * data.width) > 0.01 ||
      Math.abs((bounds[3] - bounds[1]) - 100 * data.height) > 0.01 ||
      data.coverage_valid_fraction !== 1) {
    throw new Error('THEMIS does not match the current Jezero map')
  }
  const image = new Image()
  image.src = base + 'themis_day.png'
  await image.decode()
  if (image.naturalWidth !== data.width || image.naturalHeight !== data.height) {
    throw new Error('THEMIS image dimensions do not match its metadata')
  }
  return image
}
