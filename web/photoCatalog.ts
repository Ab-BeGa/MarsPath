export type PhotoLocationType = 'exact_rover' | 'approximate_area' | 'none'

export type PhotoCoordinates = {
  latitude_deg: number
  longitude_deg: number
  localization_sol: number
  note: string
}

export type JezeroPhoto = {
  id: string
  title: string
  caption: string
  mission: string
  camera: string
  acquisition: { sols: number[]; earth_dates: string[] }
  credit: string
  page_url: string
  image_url: string
  thumbnail_url: string
  location_type: PhotoLocationType
  coordinates: PhotoCoordinates | null
  sources: { metadata: string; image: string; coordinates: string | null }
}

export type PhotoCatalog = {
  schema_version: 1
  catalog_id: string
  title: string
  last_verified: string
  coordinate_reference: string
  location_type_definitions: Record<PhotoLocationType, string>
  records: JezeroPhoto[]
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid photo catalog field: ${field}`)
  return value as Record<string, unknown>
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing photo catalog field: ${field}`)
  return value
}
function url(value: unknown, field: string): string {
  const parsed = new URL(text(value, field))
  if (parsed.protocol !== 'https:') throw new Error(`Photo catalog URL must use HTTPS: ${field}`)
  const official = parsed.hostname.endsWith('.nasa.gov') || parsed.hostname === 'nasa.gov' ||
    parsed.hostname.endsWith('.jpl.nasa.gov') || parsed.hostname === 'jpl.nasa.gov' ||
    parsed.hostname === 'd2pn8kiwq2w21t.cloudfront.net' || parsed.hostname === 'pds-geosciences.wustl.edu'
  if (!official) throw new Error(`Photo catalog URL is not an approved NASA/JPL/PDS source: ${field}`)
  return parsed.toString()
}
function integer(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`Invalid non-negative integer: ${field}`)
  return value as number
}
function dates(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Invalid photo catalog array: ${field}`)
  return value.map((item, index) => {
    const date = text(item, `${field}[${index}]`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new Error(`Invalid ISO date: ${field}[${index}]`)
    }
    return date
  })
}

export function validatePhotoCatalog(raw: unknown): PhotoCatalog {
  const root = object(raw, 'root')
  if (root.schema_version !== 1) throw new Error('Unsupported photo catalog schema')
  const definitions = object(root.location_type_definitions, 'location_type_definitions')
  for (const kind of ['exact_rover', 'approximate_area', 'none'] as const) text(definitions[kind], `location_type_definitions.${kind}`)
  if (!Array.isArray(root.records) || root.records.length === 0) throw new Error('Photo catalog has no records')
  const ids = new Set<string>()
  const records = root.records.map((item, index): JezeroPhoto => {
    const record = object(item, `records[${index}]`)
    const id = text(record.id, `records[${index}].id`)
    if (!/^[a-z0-9][a-z0-9-]+$/.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate photo id: ${id}`)
    ids.add(id)
    const acquisition = object(record.acquisition, `${id}.acquisition`)
    if (!Array.isArray(acquisition.sols) || acquisition.sols.length === 0) throw new Error(`Missing acquisition sols: ${id}`)
    const sols = acquisition.sols.map((sol, solIndex) => integer(sol, `${id}.sols[${solIndex}]`))
    const earthDates = dates(acquisition.earth_dates, `${id}.earth_dates`)
    const kind = record.location_type
    if (kind !== 'exact_rover' && kind !== 'approximate_area' && kind !== 'none') throw new Error(`Invalid location type: ${id}`)
    const sources = object(record.sources, `${id}.sources`)
    const coordinateSource = sources.coordinates === null ? null : url(sources.coordinates, `${id}.sources.coordinates`)
    let coordinates: PhotoCoordinates | null = null
    if (record.coordinates !== null) {
      const c = object(record.coordinates, `${id}.coordinates`)
      const latitude = c.latitude_deg
      const longitude = c.longitude_deg
      if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error(`Invalid latitude: ${id}`)
      if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < 0 || longitude >= 360) throw new Error(`Invalid east longitude: ${id}`)
      coordinates = {
        latitude_deg: latitude,
        longitude_deg: longitude,
        localization_sol: integer(c.localization_sol, `${id}.localization_sol`),
        note: text(c.note, `${id}.coordinates.note`),
      }
    }
    if (kind === 'none' && (coordinates !== null || coordinateSource !== null)) throw new Error(`Unlocated photo must not contain coordinates: ${id}`)
    if (kind !== 'none' && (coordinates === null || coordinateSource === null)) throw new Error(`Located photo requires coordinates and a source: ${id}`)
    return {
      id,
      title: text(record.title, `${id}.title`),
      caption: text(record.caption, `${id}.caption`),
      mission: text(record.mission, `${id}.mission`),
      camera: text(record.camera, `${id}.camera`),
      acquisition: { sols, earth_dates: earthDates },
      credit: text(record.credit, `${id}.credit`),
      page_url: url(record.page_url, `${id}.page_url`),
      image_url: url(record.image_url, `${id}.image_url`),
      thumbnail_url: url(record.thumbnail_url, `${id}.thumbnail_url`),
      location_type: kind,
      coordinates,
      sources: {
        metadata: url(sources.metadata, `${id}.sources.metadata`),
        image: url(sources.image, `${id}.sources.image`),
        coordinates: coordinateSource,
      },
    }
  })
  return {
    schema_version: 1,
    catalog_id: text(root.catalog_id, 'catalog_id'),
    title: text(root.title, 'title'),
    last_verified: dates([root.last_verified], 'last_verified')[0],
    coordinate_reference: text(root.coordinate_reference, 'coordinate_reference'),
    location_type_definitions: {
      exact_rover: definitions.exact_rover as string,
      approximate_area: definitions.approximate_area as string,
      none: definitions.none as string,
    },
    records,
  }
}

export async function loadPhotoCatalog(url = './data/jezero/photos.json'): Promise<PhotoCatalog> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load photo catalog (HTTP ${response.status})`)
  return validatePhotoCatalog(await response.json())
}
