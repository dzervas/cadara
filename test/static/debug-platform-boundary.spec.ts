import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'

const ROOT = process.cwd()

test('test/static/debug-platform-boundary.spec.ts legacy debug globals stay removed', () => {
  const sourceFiles = [
    'src/app/workbench/cad-workbench.tsx',
    'src/app/debug/cadara-debug-bridge.ts',
    'src/app/debug/use-cadara-debug-platform.ts',
    'src/vite-env.d.ts',
    'e2e/helpers/feature-workbench.ts',
    'e2e/helpers/sketch-workbench.ts',
  ]
  const offenders: string[] = []

  for (const relativePath of sourceFiles) {
    const source = readFileSync(join(ROOT, relativePath), 'utf8')
    if (source.includes('__cadTestState') || source.includes('__cadSelectTarget')) {
      offenders.push(relativePath)
    }
  }

  expectTrue(
    offenders.length === 0,
    `Legacy debug globals must stay removed from the formal debug platform.\n${offenders.join('\n')}`,
  )
})
