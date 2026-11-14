/** Verified CTX optical overlay for the original Mars-projected Jezero DEM.
 *
 * A missing overlay is NOT treated as imagery: we keep the honest DEM relief
 * and require a real, orthorectified, provenance-backed PNG + JSON manifest.
 */
import type { MarsTerrain } from './marsTerrain.ts'

export type CtxOpticalManifest = {
  schema_version: number
  kind: string
  region_id: string
  source: {
    product: string
    publisher: string
    url: string
    source_sha256: string
  }
  alignment: {
    target_dem_sha256: string
    target_dem_crs_wkt: string
    bounds_projected_m: [number, number, number, number]
    transform: [number, number, number, number, number, number]
    width: number
    height: number
    resolution_m: number
    coverage_valid_fraction: number
  }
  display: {
    image_file: string
    image_sha256: string
    nodata_transparency: boolean
  }
}
export type CtxOpticalLayer = { image: HTMLImageElement; metadata: CtxOpticalManifest }

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректные метаданные CTX: ' + name)
  return value as Record<string, unknown>
}
function number(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Некорректное число CTX: ' + name)
  return value
}
function str(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.length) throw new Error('Отсутствует поле CTX: ' + name)
  return value
}
function tuple(value: unknown, count: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== count) throw new Error('Некорректная геопривязка CTX: ' + label)
  return value.map((x,i) => number(x, label + '[' + i + ']'))
}
function near(actual: number, expected: number, label: string, tol = 0.002) {
  if (Math.abs(actual - expected) > tol) throw new Error('CTX и DEM не совпадают по ' + label)
}
const hex64 = /^[a-f0-9]{64}$/i

export function validateCtxOpticalManifest(raw: unknown, terrain: MarsTerrain): CtxOpticalManifest {
  const root = object(raw, 'root')
  const source = object(root.source, 'source')
  const a = object(root.alignment, 'alignment')
  const display = object(root.display, 'display')
  const expectedGrid = terrain.metadata.grid
  const expectedHash = terrain.metadata.source.source_sha256
  const demBounds = expectedGrid.bounds_projected_m
  const bounds = tuple(a.bounds_projected_m, 4, 'bounds_projected_m') as CtxOpticalManifest['alignment']['bounds_projected_m']
  const transform = tuple(a.transform, 6, 'transform') as CtxOpticalManifest['alignment']['transform']
  const resolution = number(a.resolution_m, 'resolution_m')
  const width = number(a.width, 'width')
  const height = number(a.height, 'height')
  const coverage = number(a.coverage_valid_fraction, 'coverage_valid_fraction')
  const filename = str(display.image_file, 'image_file')
  const hash = str(display.image_sha256, 'image_sha256')
  const sourceHash = str(source.source_sha256, 'source_sha256')
  const imgUrl = str(source.url, 'source.url')
  if (root.schema_version !== 1 || root.kind !== 'real_ctx_orthomosaic') throw new Error('Неподдерживаемый оптический слой CTX')
  if (root.region_id !== terrain.metadata.region_id) throw new Error('Оптический слой относится к другому участку Марса')
  if (a.target_dem_sha256 !== expectedHash || a.target_dem_crs_wkt !== terrain.metadata.crs_wkt) {
    throw new Error('Оптический слой построен для другой модели высот или другой проекции Марса')
  }
  if (!hex64.test(expectedHash) || !hex64.test(hash) || !hex64.test(sourceHash)) {
    throw new Error('Отсутствует действительный SHA-256 источника/изображения CTX')
  }
  if (!/^https:\/\/(planetarymaps\.usgs\.gov|asc-pds-services\.s3\.us-west-2\.amazonaws\.com)\//.test(imgUrl) ||
      !/M20_JezeroCrater_CTXortho_mosaic_5m\.tif$/.test(imgUrl)) {
    throw new Error('Источник CTX не является официальным ортофотопланом USGS')
  }
  if (filename !== 'ctx_ortho.png' || display.nodata_transparency !== true) {
    throw new Error('Неожиданный файл оптического слоя или отсутствует NoData-маска')
  }
  if (!(resolution > 0 && resolution <= 20) || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 2 || height < 2 || width * height > 12_000_000) throw new Error('Недопустимый размер CTX')
  if (coverage < 0.9 || coverage > 1) throw new Error('Слишком много недействительных пикселей CTX')
  for (let i = 0; i < 4; i++) near(bounds[i], demBounds[i], 'границам участка')
  near(transform[0], resolution, 'шагу X', 1e-6)
  near(transform[1], 0, 'наклону X', 1e-6)
  near(transform[2], bounds[0], 'положению X')
  near(transform[3], 0, 'наклону Y', 1e-6)
  near(transform[4], -resolution, 'шагу Y', 1e-6)
  near(transform[5], bounds[3], 'положению Y')
  near(bounds[2]-bounds[0], width*resolution, 'ширине DEM')
  near(bounds[3]-bounds[1], height*resolution, 'высоте DEM')

  return {
    schema_version: 1,
    kind: 'real_ctx_orthomosaic',
    region_id: str(root.region_id, 'region_id'),
    source: {
      product: str(source.product, 'product'),
      publisher: str(source.publisher, 'publisher'),
      url: imgUrl,
      source_sha256: sourceHash,
    },
    alignment: {
      target_dem_sha256: str(a.target_dem_sha256, 'target_dem_sha256'),
      target_dem_crs_wkt: str(a.target_dem_crs_wkt, 'target_dem_crs_wkt'),
      bounds_projected_m: bounds,
      transform,
      width,
      height,
      resolution_m: resolution,
      coverage_valid_fraction: coverage,
    },
    display: { image_file: filename, image_sha256: hash, nodata_transparency: true },
  }
}

export async function loadCtxOpticalLayer(terrain: MarsTerrain, base = './data/jezero/'): Promise<CtxOpticalLayer | null> {
  const response = await fetch(base + 'ctx_ortho.json')
  if (response.status === 404) return null // Optional only until genuine CTX GeoTIFF is prepared
  if (!response.ok) throw new Error('Не удалось получить метаданные CTX (HTTP ' + response.status + ')')
  const metadata = validateCtxOpticalManifest(await response.json(), terrain)
  const image = new Image()
  image.src = base + metadata.display.image_file
  try { await image.decode() }
  catch { throw new Error('Оптический PNG CTX отсутствует или повреждён') }
  if (image.naturalWidth !== metadata.alignment.width || image.naturalHeight !== metadata.alignment.height) {
    throw new Error('Размер оптического PNG не совпадает с марсианской геопривязкой')
  }
  return { image, metadata }
}
