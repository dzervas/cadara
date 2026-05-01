import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

import { createBuildMetadataPlugin } from './build-metadata'

export function getOpenCascadeAssetHeaders(pathname: string): Record<string, string> {
  if (!/cadara-occ\.(?:js|wasm)$/.test(pathname)) {
    return {}
  }

  const headers: Record<string, string> = {
    'Cache-Control': 'public, max-age=31536000, immutable',
  }

  if (pathname.endsWith('.wasm')) {
    headers['Content-Type'] = 'application/wasm'
  }

  return headers
}

function createOpenCascadeAssetHeadersPlugin() {
  return {
    name: 'cadara-opencascade-asset-headers',
    configureServer(server: { middlewares: { use: (middleware: (request: { url?: string }, response: { setHeader: (name: string, value: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((request, response, next) => {
        for (const [name, value] of Object.entries(getOpenCascadeAssetHeaders(request.url ?? ''))) {
          response.setHeader(name, value)
        }
        next()
      })
    },
    configurePreviewServer(server: { middlewares: { use: (middleware: (request: { url?: string }, response: { setHeader: (name: string, value: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((request, response, next) => {
        for (const [name, value] of Object.entries(getOpenCascadeAssetHeaders(request.url ?? ''))) {
          response.setHeader(name, value)
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [createBuildMetadataPlugin(__dirname), createOpenCascadeAssetHeadersPlugin(), react(), tailwindcss()],
  assetsInclude: ['**/*.wasm'],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
      {
        find: /^@automerge\/automerge$/,
        replacement: path.resolve(__dirname, './node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js'),
      },
    ],
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('/three/')) {
            return 'three'
          }

          if (id.includes('/@radix-ui/')) {
            return 'radix'
          }

          if (id.includes('/react/') || id.includes('/react-dom/')) {
            return 'react-vendor'
          }

          return 'vendor'
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    watch: {
      ignored: ['/e2e', '/tmp-*', '/.tmp*', '**/Dockerfile*', '**/.*', '/openspec', '**/*.spec.ts', '**/*.cadara']
    }
  },
})
