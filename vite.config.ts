import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function injectServiceWorkerPrecache(): Plugin {
  return {
    name: 'localkit-precache-manifest',
    apply: 'build',
    async generateBundle(_, bundle) {
      const assets = Object.keys(bundle).filter((file) => /\.(?:js|css)$/.test(file)).map((file) => `./${file}`)
      const source = await readFile(resolve(process.cwd(), 'public/sw.js'), 'utf8')
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: source.replace('__LOCALKIT_PRECACHE_ASSETS__', JSON.stringify(assets)) })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), injectServiceWorkerPrecache()],
  build: { sourcemap: false, chunkSizeWarningLimit: 3500 },
})
