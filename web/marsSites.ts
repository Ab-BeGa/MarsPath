/** Small, auditable site-catalogue contract. Not an Earth/WGS84 geocoder. */
export type MarsSiteSource = {
  title: string
  url: string
  role: string
}
export type MarsCoordinateText = { latitude: string; longitude: string }
export type MarsPositionPrecision = {
  method: string
  reported_decimal_places: { latitude: number; longitude: number }
  estimated_horizontal_error_m: number | null
  latitude_definition: string
  notes_ru: string
}
export type MarsSiteImage = {
  url: string
  page_url: string
  alt_ru: string
  caption_ru: string
  credit: string
}
export type MarsSite = {
  id: string
  category: 'landing_site' | 'science_event'
  name: string
  type: string
  mission: string
  region: string
  date_utc: string
  latitude_deg: number
  longitude_east_deg: number
  as_published: MarsCoordinateText
  description_ru: string
  image?: MarsSiteImage
  georeferencing: MarsPositionPrecision
  sources: MarsSiteSource[]
  anchor_site_id?: string
  alternative_positions?: Array<{
    method: string; latitude_deg: number; longitude_east_deg: number; as_published: MarsCoordinateText
  }>
}
export type MarsSitesCatalog = {
  schema_version: number
  reviewed_on: string
  catalog_scope: string
  spatial_reference: Record<string, string>
  sites: MarsSite[]
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}: expected object`)
  return value as Record<string, unknown>
}
function nonempty(v: unknown, label: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Invalid ${label}: expected nonempty string`)
  return v
}
function number(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Invalid ${label}: expected finite number`)
  return v
}
function position(lat: unknown, lon: unknown, label: string) {
  const a = number(lat, label + '.latitude_deg')
  const b = number(lon, label + '.longitude_east_deg')
  if (a < -90 || a > 90 || b < 0 || b >= 360) {
    throw new Error(`Invalid ${label}: Mars latitude/positive-east longitude out of bounds`)
  }
}
function published(v: unknown, lat: number, lon: number, precision: Record<string, number>, label: string) {
  const p = record(v, label + '.as_published')
  const latText = nonempty(p.latitude, label + '.published.latitude')
  const lonText = nonempty(p.longitude, label + '.published.longitude')
  const latMatch = /^(\d+(?:\.\d+)?)° ([NS])$/.exec(latText)
  const lonMatch = /^(\d+(?:\.\d+)?)° E$/.exec(lonText)
  if (!latMatch || !lonMatch) throw new Error(`Invalid ${label}: coordinate text must show hemisphere`)
  const latValue = Number(latMatch[1]) * (latMatch[2] === 'S' ? -1 : 1)
  if (Math.abs(latValue - lat) > 1e-8 || Math.abs(Number(lonMatch[1]) - lon) > 1e-8) {
    throw new Error(`Invalid ${label}: numeric and published coordinates disagree`)
  }
  if ((latMatch[1].split('.')[1]?.length ?? 0) !== precision.latitude ||
      (lonMatch[1].split('.')[1]?.length ?? 0) !== precision.longitude) {
    throw new Error(`Invalid ${label}: published decimal places disagree`)
  }
}
export function parseMarsSites(raw: unknown): MarsSitesCatalog {
  const root = record(raw, 'catalogue')
  if (root.schema_version !== 1) throw new Error('Unsupported Mars site catalogue schema')
  nonempty(root.reviewed_on, 'reviewed_on')
  nonempty(root.catalog_scope, 'catalog_scope')
  record(root.spatial_reference, 'spatial_reference')
  if (!Array.isArray(root.sites) || root.sites.length === 0) throw new Error('Missing Mars sites')
  const ids = new Set<string>()
  const items = new Map<string, MarsSite>()
  for (const item of root.sites) {
    const s = record(item, 'site')
    const id = nonempty(s.id, 'id')
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id)) throw new Error(`Duplicate or invalid site id: ${id}`)
    ids.add(id)
    if (s.category !== 'landing_site' && s.category !== 'science_event') throw new Error('Invalid site category')
    for (const key of ['name', 'type', 'mission', 'region', 'description_ru', 'date_utc']) nonempty(s[key], id + '.' + key)
    if (s.category === 'landing_site') {
      const image = record(s.image, id + '.image')
      for (const key of ['url', 'page_url', 'alt_ru', 'caption_ru', 'credit']) nonempty(image[key], id + '.image.' + key)
      for (const key of ['url', 'page_url']) {
        const url = image[key] as string
        if (!/^https:\/\//.test(url) || !new URL(url).hostname.endsWith('nasa.gov')) throw new Error(`Invalid NASA image ${key} for ${id}`)
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date_utc as string) ||
        !Number.isFinite(Date.parse(s.date_utc as string))) throw new Error(`Invalid date for ${id}`)
    position(s.latitude_deg, s.longitude_east_deg, id)
    const gr = record(s.georeferencing, id + '.georeferencing')
    const digits = record(gr.reported_decimal_places, id + '.reported_decimal_places')
    const latDigits = number(digits.latitude, 'latitude digits')
    const lonDigits = number(digits.longitude, 'longitude digits')
    if (!Number.isInteger(latDigits) || !Number.isInteger(lonDigits) ||
        latDigits < 0 || lonDigits < 0 || latDigits > 10 || lonDigits > 10) throw new Error(`Invalid digit count for ${id}`)
    if (gr.estimated_horizontal_error_m !== null &&
        (typeof gr.estimated_horizontal_error_m !== 'number' || !Number.isFinite(gr.estimated_horizontal_error_m) ||
         gr.estimated_horizontal_error_m < 0)) throw new Error(`Invalid positional uncertainty for ${id}`)
    nonempty(gr.method, id + '.method')
    nonempty(gr.latitude_definition, id + '.latitude_definition')
    nonempty(gr.notes_ru, id + '.notes_ru')
    published(s.as_published, s.latitude_deg as number, s.longitude_east_deg as number,
      {latitude:latDigits, longitude:lonDigits}, id)
    if (!Array.isArray(s.sources) || !s.sources.length) throw new Error(`Missing primary sources for ${id}`)
    for (const source of s.sources) {
      const ref = record(source, id + '.source')
      nonempty(ref.title, 'source title')
      const url = nonempty(ref.url, 'source URL')
      if (!/^https:\/\//.test(url) || !new URL(url).hostname) throw new Error(`Invalid source URL for ${id}`)
      nonempty(ref.role, 'source role')
    }
    if (s.category === 'science_event' && typeof s.anchor_site_id !== 'string') {
      throw new Error(`Science event ${id} must reference the stationary instrument site`)
    }
    if (s.alternative_positions !== undefined) {
      if (!Array.isArray(s.alternative_positions)) throw new Error(`Invalid alternative positions for ${id}`)
      for (const alt of s.alternative_positions) {
        const p = record(alt, 'alternative position')
        nonempty(p.method, 'alternative method')
        position(p.latitude_deg, p.longitude_east_deg, id + '.alternative')
      }
    }
    items.set(id, s as unknown as MarsSite)
  }
  for (const site of items.values()) {
    if (site.category === 'science_event') {
      const anchor = items.get(site.anchor_site_id!)
      if (!anchor || anchor.category !== 'landing_site' ||
          anchor.latitude_deg !== site.latitude_deg ||
          anchor.longitude_east_deg !== site.longitude_east_deg) {
        throw new Error(`Science event ${site.id} has missing or mismatched instrument anchor`)
      }
      if (site.georeferencing.estimated_horizontal_error_m !== null) {
        throw new Error(`Do not invent spatial accuracy for instrument-anchored event ${site.id}`)
      }
    }
  }
  return root as MarsSitesCatalog
}

/** Data ready for a future, explicitly designed global Mars pin layer. */
export async function loadMarsSites(base = './data/mars-global/sites.json'): Promise<MarsSitesCatalog> {
  const response = await fetch(base)
  if (!response.ok) throw new Error(`Mars sites catalogue unavailable (HTTP ${response.status})`)
  return parseMarsSites(await response.json())
}
