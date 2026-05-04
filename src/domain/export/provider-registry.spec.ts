import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  createScopedExportProviderRegistryForTest,
  createScopedRuntimeExtensionRegistryCompositionForTest,
} from '@/domain/extensions/test-registry-composition'
import { dxfSketchExportProvider } from '@/domain/export/providers/dxf-sketch-export-provider'
import { svgSketchExportProvider } from '@/domain/export/providers/svg-sketch-export-provider'
import { stepExportProvider } from '@/domain/export/providers/step-export-provider'
import { stlExportProvider } from '@/domain/export/providers/stl-export-provider'
import { threeMfExportProvider } from '@/domain/export/providers/threemf-export-provider'

test('src/domain/export/provider-registry.spec.ts', () => {  const registry = createScopedExportProviderRegistryForTest([
    stlExportProvider,
    stepExportProvider,
    threeMfExportProvider,
    svgSketchExportProvider,
    dxfSketchExportProvider,
    stlExportProvider,
  ])

  const providers = registry.getAll()
  expectTrue(providers.length === 5, 'Registry should dedupe providers by id.')
  expectTrue(registry.getByFormat('stl') === stlExportProvider, 'Lookup by STL format should return STL provider.')
  expectTrue(registry.getByFormat('step') === stepExportProvider, 'Lookup by STEP format should return STEP provider.')
  expectTrue(registry.getByFormat('3mf') === threeMfExportProvider, 'Lookup by 3MF format should return 3MF provider.')
  expectTrue(registry.getByFormat('svg') === svgSketchExportProvider, 'Lookup by SVG format should return SVG sketch provider.')
  expectTrue(registry.getByFormat('dxf') === dxfSketchExportProvider, 'Lookup by DXF format should return DXF sketch provider.')
  expectTrue(registry.getByFormat('unknown') === undefined, 'Unknown formats should not resolve.')
  expectTrue(
    registry.getCompatibleFormats({ kind: 'body', bodyId: 'body_1' }).join('|') === 'stl|step|3mf',
    'Body targets should only resolve body-compatible formats.',
  )
  expectTrue(
    registry.getCompatibleFormats({ kind: 'sketch', sketchId: 'sketch_1' }).join('|') === 'svg|dxf',
    'Committed sketch targets should only resolve sketch vector formats.',
  )

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
