import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

import { createBuildMetadataPlugin } from './build-metadata'

export function shouldUseCloudflareOpenCascadeCdn(env: NodeJS.ProcessEnv = process.env) {
  return env.CF_PAGES === '1'
    || env.WORKERS_CI === '1'
    || env.CADARA_USE_OCC_CDN === '1'
}

function createOpenCascadeAlias() {
  return shouldUseCloudflareOpenCascadeCdn()
    ? [{
        find: /^opencascade\.js$/,
        replacement: path.resolve(__dirname, './src/domain/modeling/occ/opencascade-cdn-entry.ts'),
      }]
    : []
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [createBuildMetadataPlugin(__dirname), react(), tailwindcss()],
  assetsInclude: ['**/*.wasm'],
  resolve: {
    alias: [
      ...createOpenCascadeAlias(),
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
      ignored: ['/e2e', '/tmp-*', '/.tmp*', '**/Dockerfile*', '**/.*', '/openspec']
    }
  },
})
