import { test } from 'bun:test'

import {
  getExportProviderByFormat,
  getRegisteredExportProviders,
  registerExportProvider,
  registerExportProviderForTest,
  resetExportProvidersForTest,
} from '@/domain/export/provider-registry'
import { stlExportProvider } from '@/domain/export/providers/stl-export-provider'
import { stepExportProvider } from '@/domain/export/providers/step-export-provider'
import { threeMfExportProvider } from '@/domain/export/providers/threemf-export-provider'

test('src/domain/export/provider-registry.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function testRegistrationAndLookup() {
    resetExportProvidersForTest()
    registerExportProvider(stlExportProvider)
    registerExportProvider(stepExportProvider)
    registerExportProvider(threeMfExportProvider)

    const providers = getRegisteredExportProviders()
    assert(providers.length === 3, 'Registry should contain all three registered providers.')
    assert(providers.some((p) => p.formatId === 'stl'), 'Registry should contain the STL provider.')
    assert(providers.some((p) => p.formatId === 'step'), 'Registry should contain the STEP provider.')
    assert(providers.some((p) => p.formatId === '3mf'), 'Registry should contain the 3MF provider.')
  }

  function testLookupByFormat() {
    resetExportProvidersForTest()
    registerExportProvider(stlExportProvider)
    registerExportProvider(stepExportProvider)

    assert(getExportProviderByFormat('stl') === stlExportProvider, 'Lookup by STL format should return STL provider.')
    assert(getExportProviderByFormat('step') === stepExportProvider, 'Lookup by STEP format should return STEP provider.')
    assert(getExportProviderByFormat('unknown') === undefined, 'Lookup for unknown format should return undefined.')
  }

  function testNoDuplicateRegistration() {
    resetExportProvidersForTest()
    registerExportProvider(stlExportProvider)
    registerExportProvider(stlExportProvider)

    const providers = getRegisteredExportProviders()
    assert(providers.filter((p) => p.id === 'stl').length === 1, 'Registering the same provider twice should not create duplicates.')
  }

  function testTestHelpers() {
    resetExportProvidersForTest()
    registerExportProvider(stlExportProvider)

    const countBefore = getRegisteredExportProviders().length

    registerExportProviderForTest(stepExportProvider)
    assert(
      getRegisteredExportProviders().length === countBefore + 1,
      'registerExportProviderForTest should add a provider.',
    )

    resetExportProvidersForTest()
    assert(
      getRegisteredExportProviders().length === countBefore,
      'resetExportProvidersForTest should restore the registry to before test registration.',
    )
  }

  testRegistrationAndLookup()
  testLookupByFormat()
  testNoDuplicateRegistration()
  testTestHelpers()
})
