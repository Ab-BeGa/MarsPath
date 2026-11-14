import type { MarsTerrain } from './marsTerrain.ts'

async function loadThemisRaster(terrain: MarsTerrain, name: 'themis_day' | 'themis_pbt') {
  const base = './data/jezero/'
  const response = await fetch(base + name + '.json')
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
  image.src = base + name + '.png'
  await image.decode()
  if (image.naturalWidth !== data.width || image.naturalHeight !== data.height) {
    throw new Error('THEMIS image dimensions do not match its metadata')
  }
  return { image, data }
}

export async function loadThemisLayer(terrain: MarsTerrain): Promise<HTMLImageElement> {
  return (await loadThemisRaster(terrain, 'themis_day')).image
}

export async function loadThemisTemperature(terrain: MarsTerrain) {
  const { image, data } = await loadThemisRaster(terrain, 'themis_pbt')
  const values: unknown = data.kelvin_tenths
  if (!Array.isArray(values) || values.length !== image.width * image.height ||
      !values.every(value => Number.isInteger(value) && value > 0 && value <= 4000)) {
    throw new Error('Invalid THEMIS brightness temperatures')
  }
  const minimum = Math.min(...values) / 10
  const maximum = Math.max(...values) / 10
  const kelvinAt = (col: number, row: number) => {
    const grid = terrain.metadata.grid
    const x = Math.floor((col + 0.5) * image.width / grid.width)
    const y = Math.floor((row + 0.5) * image.height / grid.height)
    return values[y * image.width + x] / 10
  }
  return { image, minimum, maximum, kelvinAt }
}
