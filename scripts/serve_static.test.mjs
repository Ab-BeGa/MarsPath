import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createStaticServer } from './serve_static.mjs'

test('production static server serves real asset types, health and safe HTTP responses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jezero-static-'))
  const server = createStaticServer(root)
  try {
    await mkdir(join(root, 'assets'))
    await mkdir(join(root, 'data', 'jezero'), { recursive: true })
    await writeFile(join(root, 'index.html'), '<!doctype html><html lang="en"><title>Jezero</title></html>')
    await writeFile(join(root, 'assets', 'main.js'), 'console.log("Mars")')
    await writeFile(join(root, 'assets', 'main.css'), 'body{background:black}')
    await writeFile(join(root, 'data', 'jezero', 'metadata.json'), '{"region_id":"jezero"}')
    await writeFile(join(root, 'data', 'jezero', 'heights.f32'), Buffer.from([1, 2, 3, 4]))
    await writeFile(join(root, 'data', 'jezero', 'ctx_ortho.png'), Buffer.from([137, 80, 78, 71]))
    await writeFile(join(root, 'data', 'jezero', 'crism.webp'), 'RIFF\x00\x00\x00\x00WEBP')
    await writeFile(join(root, 'data', 'jezero', 'photo.jpg'), Buffer.from([255, 216, 255, 217]))
    await writeFile(join(root, '.env'), 'SECRETS=not-public')
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = 'http://127.0.0.1:' + server.address().port

    const index = await fetch(base + '/?language=en')
    assert.equal(index.status, 200)
    assert.match(index.headers.get('content-type'), /text\/html/)
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff')
    assert.match(await index.text(), /Jezero/)

    const assets = [
      ['/assets/main.js', /text\/javascript/],
      ['/assets/main.css', /text\/css/],
      ['/data/jezero/metadata.json?refresh=1', /application\/json/],
      ['/data/jezero/heights.f32', /application\/octet-stream/],
      ['/data/jezero/ctx_ortho.png', /image\/png/],
      ['/data/jezero/crism.webp', /image\/webp/],
      ['/data/jezero/photo.jpg', /image\/jpeg/],
    ]
    for (const [url, mime] of assets) {
      const response = await fetch(base + url)
      assert.equal(response.status, 200, url)
      assert.match(response.headers.get('content-type'), mime, url)
      assert.ok((await response.arrayBuffer()).byteLength > 0, url)
    }

    const health = await fetch(base + '/_health')
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok' })

    const head = await fetch(base + '/data/jezero/metadata.json', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength('{"region_id":"jezero"}')))

    const missing = await fetch(base + '/missing.html')
    assert.equal(missing.status, 404)
    const listing = await fetch(base + '/data/jezero/')
    assert.equal(listing.status, 404)
    const secret = await fetch(base + '/.env')
    assert.equal(secret.status, 400)
    const invalid = await fetch(base + '/%00')
    assert.equal(invalid.status, 400)
    const traversal = await fetch(base + '/%2e%2e/%2e%2e/.env')
    assert.ok([400, 404].includes(traversal.status))
    const post = await fetch(base + '/', { method: 'POST' })
    assert.equal(post.status, 405)
    assert.equal(post.headers.get('allow'), 'GET, HEAD')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})
