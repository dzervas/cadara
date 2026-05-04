import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { ExportCapabilities } from '@/contracts/export/capabilities'
import type { ExportProvider } from '@/contracts/export/provider'
import type { DurableRef } from '@/contracts/shared/references'
import type { ExportProviderRegistry } from '@/domain/export/provider-registry'
import { orchestrateGeometryExport } from '@/domain/export/export-orchestrator'

test('orchestrateGeometryExport returns an unsupported-format diagnostic when no provider is registered', async () => {
  const target = makeTarget()
  const result = await orchestrateGeometryExport(
    {
      format: 'step',
      options: { schema: 'AP242' },
      target,
      targetLabel: 'Main Body',
    },
    makeCapabilities(),
    makeRegistry(),
  )

  expectTrue(result.ok === false, 'Missing providers should return a failure result.')
  expectTrue(result.format === 'step', 'Failure results should preserve the requested format.')
  expectTrue(
    result.diagnostics[0]?.code === 'export-unsupported-format'
      && result.diagnostics[0].target === target,
    'Unsupported-format failures should point back to the requested target.',
  )
})

test('orchestrateGeometryExport preserves provider failures without rewriting diagnostics', async () => {
  const diagnostic = {
    code: 'provider-failed',
    severity: 'error' as const,
    message: 'Kernel export failed.',
    target: makeTarget(),
  }
  const provider = makeProvider({
    export() {
      return { ok: false as const, diagnostics: [diagnostic] }
    },
  })

  const result = await orchestrateGeometryExport(
    {
      format: 'step',
      options: { schema: 'AP242' },
      target: diagnostic.target,
      targetLabel: 'Part A',
    },
    makeCapabilities(),
    makeRegistry(provider),
  )

  expectTrue(result.ok === false, 'Provider export failures should remain failures at the orchestrator seam.')
  expectTrue(
    result.diagnostics[0] === diagnostic,
    'Provider diagnostics should pass through untouched so callers see the original export failure.',
  )
})

test('orchestrateGeometryExport rejects incompatible provider targets before invoking providers', async () => {
  let invoked = false
  const provider = makeProvider({
    targetKinds: ['body'],
    export() {
      invoked = true
      return { ok: true as const, payload: 'unexpected', diagnostics: [] }
    },
  })

  const result = await orchestrateGeometryExport(
    {
      format: 'step',
      options: { schema: 'AP242' },
      target: { kind: 'sketch', sketchId: 'sketch_export' },
      targetLabel: 'Sketch Export',
    },
    makeCapabilities(),
    makeRegistry(provider),
  )

  expectTrue(result.ok === false, 'Incompatible provider targets should fail at the orchestrator seam.')
  expectTrue(result.diagnostics[0]?.code === 'export-incompatible-target', 'Incompatible target failures should use the dedicated diagnostic code.')
  expectTrue(invoked === false, 'The orchestrator should not invoke an incompatible provider.')
})


test('orchestrateGeometryExport slugs filenames and maps provider success metadata', async () => {
  const provider = makeProvider({
    formatId: 'mesh',
    fileExtension: 'stl',
    mimeType: 'model/stl',
    export() {
      return {
        ok: true as const,
        payload: new Uint8Array([1, 2, 3]),
        diagnostics: [],
      }
    },
  })

  const result = await orchestrateGeometryExport(
    {
      format: 'mesh',
      options: { tolerance: 0.1 },
      target: makeTarget(),
      targetLabel: '  Rotor Housing / Rev B  ',
    },
    makeCapabilities(),
    makeRegistry(provider),
  )

  expectTrue(result.ok === true, 'Successful provider exports should produce a success result.')
  expectTrue(
    result.filename === 'rotor-housing-rev-b.stl',
    'Success results should expose a slugged download filename derived from the target label.',
  )
  expectTrue(
    result.extension === 'stl'
      && result.mimeType === 'model/stl'
      && result.payload instanceof Uint8Array,
    'Success results should map provider extension, mime type, and payload through the seam.',
  )
})

test('orchestrateGeometryExport falls back to cadara-export when the target label cannot produce a slug', async () => {
  const provider = makeProvider({
    export() {
      return {
        ok: true as const,
        payload: 'payload',
        diagnostics: [],
      }
    },
  })

  const result = await orchestrateGeometryExport(
    {
      format: 'step',
      options: { schema: 'AP242' },
      target: makeTarget(),
      targetLabel: '!!!',
    },
    makeCapabilities(),
    makeRegistry(provider),
  )

  expectTrue(result.ok === true, 'Labels that slug to empty should still export successfully.')
  expectTrue(result.filename === 'cadara-export.step', 'Empty slugs should fall back to the default export filename.')
})

function makeTarget(): DurableRef {
  return {
    kind: 'feature',
    featureId: 'feature_export_target' as DurableRef extends { kind: 'feature'; featureId: infer T } ? T : never,
  }
}

function makeCapabilities(): ExportCapabilities {
  return {
    mesh: {
      tessellate() {
        return []
      },
    },
    brep: {
      writeStep() {
        return { payload: '' }
      },
    },
    sketchVector: {
      resolveSketchVectorModel() {
        return {
          diagnostic: {
            code: 'test-sketch-vector-unavailable',
            severity: 'error',
            message: 'No sketch vector model in this test.',
            target: null,
          },
        }
      },
    },
  }
}

function makeProvider(
  overrides: Partial<ExportProvider<{ schema: string }>>,
): ExportProvider<{ schema: string }> {
  return {
    id: 'provider_step',
    label: 'STEP',
    formatId: 'step',
    fileExtension: 'step',
    mimeType: 'model/step',
    targetKinds: ['feature'],
    getDefaultOptions() {
      return { schema: 'AP242' }
    },
    getOptionFormSchema() {
      return { kind: 'group', fields: [] }
    },
    applyOptionPatch(options) {
      return options
    },
    export() {
      return {
        ok: true as const,
        payload: 'ok',
        diagnostics: [],
      }
    },
    ...overrides,
  }
}

function makeRegistry(
  ...providers: ExportProvider<{ schema: string }>[]
): ExportProviderRegistry {
  return {
    getAll() {
      return providers
    },
    getByFormat(formatId) {
      return providers.find((provider) => provider.formatId === formatId)
    },
    getCompatibleProviders(target) {
      return providers.filter((provider) => provider.targetKinds.includes(target.kind))
    },
    getCompatibleFormats(target) {
      return this.getCompatibleProviders(target).map((provider) => provider.formatId)
    },
  }
}
