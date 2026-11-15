export type DetailedRegionSource = { title: string; url: string }

export type DetailedRegion = {
  id: string
  name: string
  name_ru: string
  feature_type_ru: string
  latitude_deg: number
  longitude_east_deg: number
  coordinate_status: 'feature_center' | 'representative'
  summary_ru: string
  science_ru: string
  data_note_ru: string
  detail_status: 'local_map' | 'report'
  detail_target?: string
  coverage_km?: [number, number]
  dem_resolution_m?: number
  optical_resolution_m?: number
  metadata?: string
  sources: DetailedRegionSource[]
}

export type DetailedRegionsCatalog = {
  schema_version: number
  coordinate_reference: string
  regions: DetailedRegion[]
}

export async function loadDetailedRegions(url = '/data/mars-global/detailed_regions.json'): Promise<DetailedRegionsCatalog> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Detailed regions unavailable (HTTP ${response.status})`)
  const catalog = await response.json() as DetailedRegionsCatalog
  if (catalog.schema_version !== 2 || !Array.isArray(catalog.regions) || catalog.regions.length === 0) {
    throw new Error('Invalid detailed regions catalog')
  }
  for (const region of catalog.regions) {
    if (!region.id || !region.name || !region.name_ru || !Number.isFinite(region.latitude_deg) ||
        !Number.isFinite(region.longitude_east_deg) || !Array.isArray(region.sources) || region.sources.length === 0) {
      throw new Error(`Invalid detailed region: ${region.id || 'unknown'}`)
    }
  }
  return catalog
}
