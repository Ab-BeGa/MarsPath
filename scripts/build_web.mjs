import { copyFile, cp, mkdir } from 'node:fs/promises'
import { build, context } from 'esbuild'

const serve = process.argv.includes('--serve')
const options = {
  entryPoints: ['web/main.tsx'],
  outdir: 'dist/assets',
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  minify: !serve,
  sourcemap: serve,
  define: { 'process.env.NODE_ENV': JSON.stringify(serve ? 'development' : 'production') },
}

await mkdir('dist', { recursive: true })
await cp('public', 'dist', { recursive: true })
await copyFile('index.html', 'dist/index.html')

if (serve) {
  const app = await context(options)
  try {
    await app.watch()
    const { port } = await app.serve({ servedir: 'dist', host: '127.0.0.1' })
    console.log(`http://127.0.0.1:${port}/`)
  } catch (error) {
    await app.dispose()
    throw error
  }
} else {
  await build(options)
}
