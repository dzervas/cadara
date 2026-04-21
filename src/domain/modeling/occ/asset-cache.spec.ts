import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

import {
  OCC_ASSET_CACHE_NAME,
  OCC_SERVICE_WORKER_PATH,
  getOpenCascadeServiceWorkerRegistrationOptions,
  isOpenCascadeAssetUrl,
} from '@/domain/modeling/occ/asset-cache'

test('src/domain/modeling/occ/asset-cache.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  assert(
    isOpenCascadeAssetUrl('/assets/opencascade.full.wasm'),
    'OCC wasm URL audit should recognize local app-served wasm assets.',
  )
  assert(
    isOpenCascadeAssetUrl('https://cdn.jsdelivr.net/npm/opencascade.js@2.0.0-beta.b5ff984/dist/opencascade.full.wasm'),
    'OCC wasm URL audit should recognize the CDN-backed OpenCascade entry path.',
  )
  assert(
    isOpenCascadeAssetUrl('/assets/opencascade.full.worker.js'),
    'OCC worker URL audit should recognize OpenCascade worker assets.',
  )
  assert(
    getOpenCascadeServiceWorkerRegistrationOptions().scope === '/',
    'OCC asset service worker registration scope should cover app and CDN-routed OCC requests from the shell.',
  )

  const serviceWorkerSource = readFileSync(join(process.cwd(), 'public/occ-asset-cache-sw.js'), 'utf8')
  assert(
    OCC_SERVICE_WORKER_PATH === '/occ-asset-cache-sw.js' &&
      serviceWorkerSource.includes(OCC_ASSET_CACHE_NAME),
    'The OCC service worker cache should be versioned with the OpenCascade package version.',
  )
})
