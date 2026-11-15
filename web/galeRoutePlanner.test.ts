import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  parseMarsMetadata, decodeMarsTerrain, projectedToMarsDegrees,
} from './marsTerrain.ts'
import { planBrowserRoutes } from './routePlanner.ts'

function galeData() {
  const base=new URL('../public/data/gale/',import.meta.url)
  const raw=JSON.parse(readFileSync(new URL('metadata.json',base),'utf8'))
  const heights=readFileSync(new URL(raw.grid.heights_file,base))
  const mask=readFileSync(new URL(raw.grid.mask_file,base))
  const digest=createHash('sha256').update(heights).update(mask).digest('hex')
  const h=new ArrayBuffer(heights.byteLength)
  const m=new ArrayBuffer(mask.byteLength)
  new Uint8Array(h).set(heights)
  new Uint8Array(m).set(mask)
  return {raw,digest,terrain:decodeMarsTerrain(parseMarsMetadata(raw),h,m)}
}

test('committed Gale raster is genuine numeric Mars DEM with audited identity and full coverage',()=>{
  const {raw,digest,terrain}=galeData()
  assert.equal(raw.source.hash_scope,'compact_heights_f32_plus_mask_u8_not_original_geotiff')
  assert.equal(digest,raw.source.source_sha256)
  assert.equal(terrain.metadata.region_id,'gale_crater_curiosity_demo')
  assert.equal(terrain.metadata.grid.width,251)
  assert.equal(terrain.metadata.grid.height,251)
  assert.deepEqual(terrain.metadata.grid.pixel_size_m,[20,20])
  assert.equal(terrain.validCount,251*251)
  assert.ok(terrain.min < -4500 && terrain.max > -4500)
  assert.equal(terrain.metadata.coordinate_convention.projection_standard_parallel_deg,0)
  const centre=terrain.metadata.checked_points.find(point=>point.id==='site_center')!
  const deg=projectedToMarsDegrees(terrain.metadata,centre.projected_x_m,centre.projected_y_m)
  assert.ok(Math.abs(deg.latitude+4.59)<.001)
  assert.ok(Math.abs(deg.longitude-137.44)<.001)
})

test('real USGS Gale DEM builds 2 A* routes from published output affine',()=>{
  const {terrain}=galeData()
  const base=terrain.metadata.checked_points.find(point=>point.id==='base')!
  const science=terrain.metadata.checked_points.find(point=>point.id==='science_target')!
  const a={x:base.projected_x_m,y:base.projected_y_m}
  const b={x:science.projected_x_m,y:science.projected_y_m}
  const plan=planBrowserRoutes(terrain,a,b)
  assert.ok(plan.direct.cells.length>2)
  assert.ok(plan.detour.cells.length>2)
  assert.equal(plan.comparison.demVerified,true)
  assert.deepEqual(plan.comparison.routes.direct[0],a)
  assert.deepEqual(plan.comparison.routes.detour.at(-1),b)
  assert.ok(plan.comparison.rows.every(row=>row.direct===null||Number.isFinite(row.direct)))
  assert.ok(plan.comparison.rows.every(row=>row.detour===null||Number.isFinite(row.detour)))
  assert.ok(plan.direct.cells.every(id=>terrain.mask[id]===1))
  assert.ok(plan.detour.cells.every(id=>terrain.mask[id]===1))
  assert.equal(plan.comparison.source.crs,terrain.metadata.crs_wkt)
})
