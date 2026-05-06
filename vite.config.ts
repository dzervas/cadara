import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

import { createBuildMetadataPlugin, readSentryBuildMetadata } from './build-metadata'

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

const sentryBuildMetadata = readSentryBuildMetadata(__dirname)
const shouldUploadSentrySourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN && sentryBuildMetadata.release)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    createBuildMetadataPlugin(__dirname),
    createOpenCascadeAssetHeadersPlugin(),
    react(),
    tailwindcss(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !shouldUploadSentrySourceMaps,
      sourcemaps: {
        filesToDeleteAfterUpload: ['dist/**/*.map'],
      },
      release: {
        name: sentryBuildMetadata.release ?? undefined,
        dist: sentryBuildMetadata.dist ?? undefined,
        inject: true,
        create: true,
        finalize: true,
        setCommits: {
          auto: true,
          ignoreMissing: true,
        },
        deploy: {
          env: sentryBuildMetadata.environment,
          url: process.env.CF_PAGES_URL,
        },
      },
    }),
  ],
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
    // Pre-scan worker entrypoints up front so Vite does not discover their
    // package dependencies after the browser session has already started.
    entries: [
      'index.html',
      'src/infrastructure/workers/document-sync.worker.ts',
      'src/domain/modeling/occ/worker.ts',
    ],
    // The browser OCC runtime is served from /public as a versioned custom
    // asset pair and should not be pulled into dependency optimization.
    exclude: [
      'opencascade.js',
      'opencascade.js/dist/node.js',
      'opencascade.js/dist/opencascade.full',
    ],
  },
  build: {
    sourcemap: 'hidden',
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
    allowedHosts: ['frontend'],
    watch: {
      ignored: ['/e2e/**', '/tmp-*', '/.tmp*', '**/Dockerfile*', '**/.*', '/openspec/**', '**/*.spec.ts', '**/*.cadara']
    }
  },
})
