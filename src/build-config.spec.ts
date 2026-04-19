import { test } from 'bun:test'
import type { UserConfig } from 'vite'

import viteConfig from '../vite.config'

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
})
