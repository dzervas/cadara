import { test } from 'bun:test'
import type { UserConfig } from 'vite'

import viteConfig, { shouldUseCloudflareOpenCascadeCdn } from '../vite.config'

test('src/build-config.spec.ts', async () => {
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
    shouldUseCloudflareOpenCascadeCdn({ CF_PAGES: '1' }) === true,
    'Cloudflare Pages builds should use the CDN-backed OpenCascade wasm entry.',
  )
  assert(
    shouldUseCloudflareOpenCascadeCdn({ WORKERS_CI: '1' }) === true,
    'Cloudflare Workers Builds should use the CDN-backed OpenCascade wasm entry.',
  )
  assert(
    shouldUseCloudflareOpenCascadeCdn({ CADARA_USE_OCC_CDN: '1' }) === true,
    'Manual deploy builds should be able to opt into the CDN-backed OpenCascade wasm entry.',
  )
  assert(
    shouldUseCloudflareOpenCascadeCdn({}) === false,
    'Regular local builds should keep the package-provided OpenCascade wasm asset.',
  )
})
