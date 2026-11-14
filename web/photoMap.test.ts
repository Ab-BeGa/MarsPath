import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { clusterPhotoPoints, filterPhotos } from './photoMap.ts'
import { validatePhotoCatalog, type JezeroPhoto } from './photoCatalog.ts'
import { marsDegreesToProjected, parseMarsMetadata } from './marsTerrain.ts'

function photo(id: string, camera: string, sols: number[]): JezeroPhoto {
  return { id, camera, acquisition: { sols, earth_dates: [] }, coordinates: null } as JezeroPhoto
}

test('filters catalog records by exact camera and inclusive sol range', () => {
  const photos = [photo('a', 'Mastcam-Z', [4]), photo('b', 'Left Mastcam-Z', [377]), photo('c', 'Mastcam-Z', [466, 474])]
  assert.deepEqual(filterPhotos(photos, 'Mastcam-Z', 400, 470).map(item => item.id), ['c'])
  assert.deepEqual(filterPhotos(photos, '', 377, 377).map(item => item.id), ['b'])
  assert.deepEqual(filterPhotos(photos, '', null, null).map(item => item.id), ['a', 'b', 'c'])
})

test('clusters nearby screen markers and keeps distant markers separate', () => {
  const a = photo('a', 'Mastcam-Z', [4])
  const b = photo('b', 'Mastcam-Z', [5])
  const c = photo('c', 'Mastcam-Z', [6])
  const clusters = clusterPhotoPoints([
    { photo: a, x: 10, y: 10 }, { photo: b, x: 18, y: 14 }, { photo: c, x: 100, y: 100 },
  ], 20)
  assert.equal(clusters.length, 2)
  assert.deepEqual(clusters[0].points.map(point => point.photo.id), ['a', 'b'])
  assert.deepEqual(clusters[1].points.map(point => point.photo.id), ['c'])
})

test('smaller cluster radius reveals more individual points when zoomed in', () => {
  const points = [
    { photo: photo('a', 'Mastcam-Z', [1]), x: 20, y: 20 },
    { photo: photo('b', 'Mastcam-Z', [2]), x: 45, y: 20 },
  ]
  assert.equal(clusterPhotoPoints(points, 30).length, 1)
  assert.equal(clusterPhotoPoints(points, 15).length, 2)
  assert.throws(() => clusterPhotoPoints(points, 0), /positive/)
})

test('published photo coordinates are classified against the real 7.5 km Mars DEM bounds', async () => {
  const catalog = validatePhotoCatalog(JSON.parse(await readFile(new URL('../public/data/jezero/photos.json', import.meta.url), 'utf8')))
  const metadata = parseMarsMetadata(JSON.parse(await readFile(new URL('../public/data/jezero/metadata.json', import.meta.url), 'utf8')))
  const [left, bottom, right, top] = metadata.grid.bounds_projected_m
  const classified = catalog.records.filter(photo => photo.coordinates).map(photo => {
    const coordinates = photo.coordinates!
    const projected = marsDegreesToProjected(metadata, coordinates.longitude_deg, coordinates.latitude_deg)
    return { id: photo.id, inside: projected.x >= left && projected.x < right && projected.y >= bottom && projected.y < top }
  })
  assert.equal(classified.filter(item => item.inside).length, 5)
  assert.deepEqual(classified.filter(item => !item.inside).map(item => item.id), ['sol-1039-bright-rocks-jezero-rim'])
})
