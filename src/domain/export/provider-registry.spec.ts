import { test } from 'bun:test'

import {
  createScopedExportProviderRegistryForTest,
  createScopedRuntimeExtensionRegistryCompositionForTest,
} from '@/domain/extensions/test-registry-composition'
import { stepExportProvider } from '@/domain/export/providers/step-export-provider'
import { stlExportProvider } from '@/domain/export/providers/stl-export-provider'
import { threeMfExportProvider } from '@/domain/export/providers/threemf-export-provider'

test('src/domain/export/provider-registry.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const registry = createScopedExportProviderRegistryForTest([
    stlExportProvider,
    stepExportProvider,
    threeMfExportProvider,
    stlExportProvider,
  ])

  const providers = registry.getAll()
  assert(providers.length === 3, 'Registry should dedupe providers by id.')
  assert(registry.getByFormat('stl') === stlExportProvider, 'Lookup by STL format should return STL provider.')
  assert(registry.getByFormat('step') === stepExportProvider, 'Lookup by STEP format should return STEP provider.')
  assert(registry.getByFormat('3mf') === threeMfExportProvider, 'Lookup by 3MF format should return 3MF provider.')
  assert(registry.getByFormat('unknown') === undefined, 'Unknown formats should not resolve.')

  const isolatedA = createScopedRuntimeExtensionRegistryCompositionForTest({
    exportProviders: [stlExportProvider],
  }).exportProviders
  const isolatedB = createScopedRuntimeExtensionRegistryCompositionForTest({
    exportProviders: [stepExportProvider],
  }).exportProviders

  assert(isolatedA.getAll().length === 1, 'Scoped export registries should preserve local membership.')
  assert(isolatedB.getAll().length === 1, 'Separate scoped export registries should not inherit other tests.')
  assert(isolatedA.getByFormat('step') === undefined, 'Scoped export registries should not leak providers across compositions.')
})
