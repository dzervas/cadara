import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import type { UserConfig } from 'vite'

import viteConfig, { getOpenCascadeAssetHeaders } from '../../vite.config'

test('test/static/build-config.spec.ts', async () => {  const config = typeof viteConfig === 'function'
    ? await viteConfig({
        command: 'build',
        mode: 'production',
        isSsrBuild: false,
        isPreview: false,
      })
    : viteConfig

  expectTrue((config as UserConfig).build?.sourcemap === true, 'Production build should emit JavaScript source maps.')

  expectTrue(
    getOpenCascadeAssetHeaders('/cadara-occ.wasm')['Content-Type'] === 'application/wasm',
    'The custom app-served OpenCascade wasm response should preserve a streaming-compatible MIME type.',
  )
  expectTrue(
    getOpenCascadeAssetHeaders('/cadara-occ.wasm')['Cache-Control']?.includes('immutable'),
    'The custom OpenCascade wasm asset should be eligible for immutable repeat-load caching.',
  )
  expectTrue(
    getOpenCascadeAssetHeaders('/cadara-occ.js')['Cache-Control']?.includes('immutable'),
    'The custom OpenCascade bootstrap module should be eligible for immutable repeat-load caching.',
  )
})
