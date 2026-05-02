import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  createScopedExportProviderRegistryForTest,
  createScopedRuntimeExtensionRegistryCompositionForTest,
} from '@/domain/extensions/test-registry-composition'
import { stepExportProvider } from '@/domain/export/providers/step-export-provider'
import { stlExportProvider } from '@/domain/export/providers/stl-export-provider'
import { threeMfExportProvider } from '@/domain/export/providers/threemf-export-provider'

test('src/domain/export/provider-registry.spec.ts', () => {  const registry = createScopedExportProviderRegistryForTest([
    stlExportProvider,
    stepExportProvider,
    threeMfExportProvider,
    stlExportProvider,
  ])

  const providers = registry.getAll()
  expectTrue(providers.length === 3, 'Registry should dedupe providers by id.')
  expectTrue(registry.getByFormat('stl') === stlExportProvider, 'Lookup by STL format should return STL provider.')
  expectTrue(registry.getByFormat('step') === stepExportProvider, 'Lookup by STEP format should return STEP provider.')
  expectTrue(registry.getByFormat('3mf') === threeMfExportProvider, 'Lookup by 3MF format should return 3MF provider.')
  expectTrue(registry.getByFormat('unknown') === undefined, 'Unknown formats should not resolve.')

  const isolatedA = createScopedRuntimeExtensionRegistryCompositionForTest({
    exportProviders: [stlExportProvider],
  }).exportProviders
  const isolatedB = createScopedRuntimeExtensionRegistryCompositionForTest({
    exportProviders: [stepExportProvider],
  }).exportProviders

  expectTrue(isolatedA.getAll().length === 1, 'Scoped export registries should preserve local membership.')
  expectTrue(isolatedB.getAll().length === 1, 'Separate scoped export registries should not inherit other tests.')
  expectTrue(isolatedA.getByFormat('step') === undefined, 'Scoped export registries should not leak providers across compositions.')
})
