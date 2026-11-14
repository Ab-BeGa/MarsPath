/**
 * Minimal read-only server for the prebuilt Jezero Traverse web app.
 * No npm runtime dependencies, API endpoints, proxying or data downloads.
 * Usage: node scripts/serve_static.mjs (HOST=0.0.0.0 PORT=8080).
 */
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.f32': 'application/octet-stream',
  '.u8': 'application/octet-stream',
  '.sha256': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
})

function send(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  })
  response.end(response.req?.method === 'HEAD' ? undefined : body)
}

function safeFilePath(requestUrl, root) {
  let url
  try { url = new URL(requestUrl || '/', 'http://localhost') }
  catch { return null }
  let path
  try { path = decodeURIComponent(url.pathname) }
  catch { return null }
  if (!path.startsWith('/') || path.includes('\0') || path.includes('\\')) return null
  // Never serve private dot files or directory traversal, including encoded segments.
  if (path.split('/').some(part => part === '..' || part.startsWith('.'))) return null
  if (path === '/') path = '/index.html'
  const full = resolve(root, '.' + path)
  return full.startsWith(root + sep) ? full : null
}

export function createStaticServer(rootDirectory = DEFAULT_ROOT) {
  const root = resolve(rootDirectory)
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD')
      send(response, 405, 'Method not allowed\n')
      return
    }

    const url = request.url || '/'
    if (url.split('?')[0] === '/_health') {
      send(response, 200, '{"status":"ok"}\n', 'application/json; charset=utf-8')
      return
    }

    const filePath = safeFilePath(url, root)
    if (!filePath) {
      send(response, 400, 'Invalid path\n')
      return
    }

    try {
      const info = await stat(filePath)
      if (!info.isFile()) { send(response, 404, 'Not found\n'); return }
      const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
      response.writeHead(200, {
        'Content-Type': type,
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      })
      if (request.method === 'HEAD') { response.end(); return }
      const stream = createReadStream(filePath)
      stream.on('error', () => response.destroy())
      stream.pipe(response)
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
        send(response, 404, 'Not found\n')
      } else {
        // Never disclose the container's internal filesystem paths.
        send(response, 500, 'Internal error\n')
      }
    }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080)
  const host = process.env.HOST || '0.0.0.0'
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  const server = createStaticServer()
  server.listen(port, host, () => console.log('Jezero Traverse serving at http://' + host + ':' + port))
  process.on('SIGTERM', () => server.close(() => process.exit(0)))
  process.on('SIGINT', () => server.close(() => process.exit(0)))
}
