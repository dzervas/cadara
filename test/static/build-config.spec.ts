import { test } from 'bun:test'
import type { UserConfig } from 'vite'

import viteConfig, { getOpenCascadeAssetHeaders } from '../../vite.config'

test('test/static/build-config.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const config = typeof viteConfig === 'function'
    ? await viteConfig({
        command: 'build',
        mode: 'production',
        isSsrBuild: false,
        isPreview: false,
      })
    : viteConfig

  assert((config as UserConfig).build?.sourcemap === true, 'Production build should emit JavaScript source maps.')

  assert(
    getOpenCascadeAssetHeaders('/cadara-occ.wasm')['Content-Type'] === 'application/wasm',
    'The custom app-served OpenCascade wasm response should preserve a streaming-compatible MIME type.',
  )
  assert(
    getOpenCascadeAssetHeaders('/cadara-occ.wasm')['Cache-Control']?.includes('immutable'),
    'The custom OpenCascade wasm asset should be eligible for immutable repeat-load caching.',
  )
  assert(
    getOpenCascadeAssetHeaders('/cadara-occ.js')['Cache-Control']?.includes('immutable'),
    'The custom OpenCascade bootstrap module should be eligible for immutable repeat-load caching.',
  )
})
