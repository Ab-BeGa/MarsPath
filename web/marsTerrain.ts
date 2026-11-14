/** Parse USGS Mars DEM preprocessed by scripts/preprocess_dem.py.
 * All map coordinates are in the source Mars projected CRS; NEVER Earth WGS84.
 */
export type MarsPoint = {
  id: string
  name: string
  role: string
  latitude_deg: number
  longitude_deg: number
  projected_x_m: number
  projected_y_m: number
  elevation_m: number
}

export type MarsMetadata = {
  region_id: string
  source: { product: string; instrument: string; publisher: string; url: string; source_sha256: string }
  grid: {
    width: number
    height: number
    pixel_size_m: [number, number]
    transform: [number, number, number, number, number, number]
    bounds_projected_m: [number, number, number, number]
    heights_file: string
    mask_file: string
    elevation_min_m: number
    elevation_max_m: number
  }
  coordinate_convention: { source_crs_sphere_radius_m: number }
  crs_wkt: string
  checked_points: MarsPoint[]
}

export type TerrainCell = {
  col: number
  row: number
  x: number
  y: number
  elevation: number | null
  longitude: number
  latitude: number
}
export type MarsTerrain = {
  metadata: MarsMetadata
  heights: Float32Array
  mask: Uint8Array
  min: number
  max: number
  validCount: number
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Неверные метаданные DEM: ${label}`)
  return value as Record<string, unknown>
}
function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Неверное число DEM: ${label}`)
  return value
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Отсутствует поле DEM: ${label}`)
  return value
}
function tuple(input: unknown, count: number, label: string): number[] {
  if (!Array.isArray(input) || input.length !== count) throw new Error(`Неверный формат DEM: ${label}`)
  return input.map((v, i) => number(v, `${label}[${i}]`))
}
function secureBasename(value: unknown, label: string): string {
  const name = string(value, label)
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.startsWith('.')) throw new Error(`Недопустимое имя файла DEM: ${label}`)
  return name
}

export function parseMarsMetadata(raw: unknown): MarsMetadata {
  const root = record(raw, 'root')
  const source = record(root.source, 'source')
  const grid = record(root.grid, 'grid')
  const coordinate = record(root.coordinate_convention, 'coordinate_convention')
  const wkt = string(root.crs_wkt, 'crs_wkt')
  if (!/Jezero_Crater_Projection/i.test(wkt) || !/GCS_Mars_2000_Sphere/.test(wkt) || /WGS[_ ]?84/i.test(wkt)) {
    throw new Error('Для карты требуется исходная марсианская проекция Jezero, не WGS84')
  }
  const width = number(grid.width, 'width')
  const height = number(grid.height, 'height')
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width * height > 100_000_000) {
    throw new Error('Недопустимые размеры карты DEM')
  }
  const transform = tuple(grid.transform, 6, 'transform') as MarsMetadata['grid']['transform']
  const bounds = tuple(grid.bounds_projected_m, 4, 'bounds') as MarsMetadata['grid']['bounds_projected_m']
  const resolution = tuple(grid.pixel_size_m, 2, 'pixel_size_m') as [number, number]
  if (transform[0] <= 0 || transform[4] >= 0 || Math.abs(transform[1]) > 1e-8 ||
    Math.abs(transform[3]) > 1e-8 || resolution[0] <= 0 || resolution[1] <= 0 ||
    Math.abs(transform[0] - resolution[0]) > 1e-5 || Math.abs(transform[4] + resolution[1]) > 1e-5 ||
    Math.abs(bounds[0] - transform[2]) > 1e-4 || Math.abs(bounds[3] - transform[5]) > 1e-4 ||
    Math.abs(bounds[2] - (transform[2] + width * transform[0])) > 1e-4 ||
    Math.abs(bounds[1] - (transform[5] + height * transform[4])) > 1e-4) {
    throw new Error('Неподдерживаемая привязка DEM: требуется северо-ориентированная сетка')
  }
  const radius = number(coordinate.source_crs_sphere_radius_m, 'Mars radius')
  if (radius < 3_000_000 || radius > 4_000_000) throw new Error('Некорректный радиус Марса')
  const checked = root.checked_points
  if (!Array.isArray(checked)) throw new Error('Не указаны контрольные точки Jezero')
  const points = checked.map(value => {
    const p = record(value, 'checked_point')
    return {
      id: string(p.id, 'point id'),
      name: string(p.name, 'point name'),
      role: string(p.role, 'point role'),
      latitude_deg: number(p.latitude_deg, 'point latitude'),
      longitude_deg: number(p.longitude_deg, 'point longitude'),
      projected_x_m: number(p.projected_x_m, 'point x'),
      projected_y_m: number(p.projected_y_m, 'point y'),
      elevation_m: number(p.elevation_m, 'point elevation'),
    }
  })
  if (!points.some(p => p.id === 'base') || !points.some(p => p.id === 'science_target')) {
    throw new Error('На карте отсутствует база или научная точка')
  }
  return {
    region_id: string(root.region_id, 'region_id'),
    source: {
      product: string(source.product, 'source product'),
      instrument: string(source.instrument, 'source instrument'),
      publisher: string(source.publisher, 'source publisher'),
      url: string(source.url, 'source url'),
      source_sha256: string(source.source_sha256, 'source_sha256'),
    },
    grid: {
      width, height, transform, bounds_projected_m: bounds, pixel_size_m: resolution,
      heights_file: secureBasename(grid.heights_file, 'heights_file'),
      mask_file: secureBasename(grid.mask_file, 'mask_file'),
      elevation_min_m: number(grid.elevation_min_m, 'elevation_min_m'),
      elevation_max_m: number(grid.elevation_max_m, 'elevation_max_m'),
    },
    coordinate_convention: { source_crs_sphere_radius_m: radius },
    crs_wkt: wkt, checked_points: points,
  }
}

export function decodeMarsTerrain(metadata: MarsMetadata, heightsBuffer: ArrayBuffer, maskBuffer: ArrayBuffer): MarsTerrain {
  const count = metadata.grid.width * metadata.grid.height
  if (heightsBuffer.byteLength !== count * 4 || maskBuffer.byteLength !== count) {
    throw new Error('Размеры двоичных DEM не соответствуют metadata.json')
  }
  const view = new DataView(heightsBuffer)
  const heights = new Float32Array(count)
  const mask = new Uint8Array(maskBuffer)
  let min = Infinity
  let max = -Infinity
  let validCount = 0
  for (let i = 0; i < count; i++) {
    if (mask[i] !== 0 && mask[i] !== 1) throw new Error('Некорректное значение маски DEM')
    const h = view.getFloat32(i * 4, true)
    heights[i] = h
    if (mask[i] === 1) {
      if (!Number.isFinite(h) || h < -100_000 || h > 100_000) throw new Error('Некорректная высота действительного пикселя DEM')
      min = Math.min(min, h)
      max = Math.max(max, h)
      validCount++
    }
  }
  if (!validCount) throw new Error('Нет действительных высот DEM')
  return { metadata, heights, mask, min, max, validCount }
}

const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180

export function projectedToMarsDegrees(metadata: MarsMetadata, x: number, y: number): { longitude: number; latitude: number } {
  const radius = metadata.coordinate_convention.source_crs_sphere_radius_m
  // Mars sphere + equirectangular, central meridian 0°, lat_ts 18.4663°.
  // This is the published projection of the bundled Jezero CTX DEM.
  const lon = x / (radius * Math.cos(18.4663 * DEG_TO_RAD)) * RAD_TO_DEG
  const lat = y / radius * RAD_TO_DEG
  return { longitude: lon, latitude: lat }
}

export function marsDegreesToProjected(metadata: MarsMetadata, longitude: number, latitude: number): { x: number; y: number } {
  const r = metadata.coordinate_convention.source_crs_sphere_radius_m
  return {
    x: longitude * DEG_TO_RAD * r * Math.cos(18.4663 * DEG_TO_RAD),
    y: latitude * DEG_TO_RAD * r,
  }
}

export function cellAtProjected(terrain: MarsTerrain, x: number, y: number): TerrainCell | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const [sx, , tx, , sy, ty] = terrain.metadata.grid.transform
  const col = Math.floor((x - tx) / sx)
  const row = Math.floor((y - ty) / sy)
  if (col < 0 || row < 0 || col >= terrain.metadata.grid.width || row >= terrain.metadata.grid.height) return null
  const i = row * terrain.metadata.grid.width + col
  const pos = projectedToMarsDegrees(terrain.metadata, x, y)
  return { col, row, x, y, elevation: terrain.mask[i] === 1 ? terrain.heights[i] : null,
    longitude: pos.longitude, latitude: pos.latitude }
}

export function cellAtGrid(terrain: MarsTerrain, col: number, row: number): TerrainCell | null {
  const [sx, , tx, , sy, ty] = terrain.metadata.grid.transform
  return cellAtProjected(terrain, tx + (col + 0.5) * sx, ty + (row + 0.5) * sy)
}

export async function loadMarsTerrain(base = './data/jezero/'): Promise<MarsTerrain> {
  const metaResponse = await fetch(base + 'metadata.json')
  if (!metaResponse.ok) throw new Error(`Не удалось загрузить metadata.json (HTTP ${metaResponse.status})`)
  const metadata = parseMarsMetadata(await metaResponse.json())
  const [hResponse, mResponse] = await Promise.all([
    fetch(base + metadata.grid.heights_file), fetch(base + metadata.grid.mask_file),
  ])
  if (!hResponse.ok || !mResponse.ok) throw new Error('Не удалось загрузить бинарные высоты или маску DEM')
  const [h, m] = await Promise.all([hResponse.arrayBuffer(), mResponse.arrayBuffer()])
  return decodeMarsTerrain(metadata, h, m)
}
