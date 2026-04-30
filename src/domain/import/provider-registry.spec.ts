import { test } from 'bun:test'

import type { ImportProvider } from '@/contracts/import/provider'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { createScopedImportProviderRegistryForTest } from '@/domain/extensions/test-registry-composition'

test('src/domain/import/provider-registry.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const pngProvider: ImportProvider<{ name: string }, { planeKey: string | null }> = {
    id: 'png-import',
    label: 'PNG Import',
    acceptedFileTypes: [{ extension: 'png', mediaType: 'image/png' }],
    accepts(source) {
      return source.mediaType === 'image/png'
    },
    async review(input) {
      return {
        providerReview: { name: input.source.name },
        diagnostics: [],
        proposedActionKinds: ['commitSketch'],
      }
    },
    createDefaultSelections() {
      return { planeKey: null }
    },
    getReviewFormSchema() {
      return { sections: [] }
    },
    applySelectionPatch(_review, selections) {
      return selections
    },
    async prepare() {
      return { diagnostics: [] }
    },
  }
  const duplicatePngProvider = { ...pngProvider, label: 'Duplicate PNG Import' }
  const stepProvider: ImportProvider<{ name: string }, { planeKey: string | null }> = {
    ...pngProvider,
    id: 'step-import',
    label: 'STEP Import',
    acceptedFileTypes: [{ extension: 'step', mediaType: 'model/step' }],
    accepts(source) {
      return source.mediaType === 'model/step'
    },
  }

  const registry = createScopedImportProviderRegistryForTest([
    pngProvider,
    duplicatePngProvider,
    stepProvider,
  ])

  assert(registry.getAll().length === 2, 'Import registry should dedupe providers by id.')
  assert(registry.getById('png-import') === pngProvider, 'Import registry should resolve providers by id.')
  assert(
    registry.getAcceptedFileTypes().some((entry) => entry.extension === 'png' && entry.mediaType === 'image/png'),
    'Import registry should expose accepted file types from its explicit composition.',
  )
  assert(
    registry.matchProviders({
      name: 'fixture.png',
      origin: { kind: 'localFile', fileName: 'fixture.png' },
      mediaType: 'image/png',
      bytes: new Uint8Array([0]),
      fingerprint: `sha256:${'a'.repeat(64)}` as const,
    }).length === 1,
    'Import provider matching should be determined by the scoped registry composition.',
  )

  const isolatedA = createScopedImportProviderRegistryForTest([pngProvider])
  const isolatedB = createScopedImportProviderRegistryForTest([stepProvider])

  assert(isolatedA.getById('step-import') === null, 'Scoped import registries should not leak between tests.')
  assert(isolatedB.getById('png-import') === null, 'Scoped import registries should remain isolated.')

  const review = await pngProvider.review({
    source: {
      name: 'fixture.png',
      origin: { kind: 'localFile', fileName: 'fixture.png' },
      mediaType: 'image/png',
      bytes: new Uint8Array([1]),
      fingerprint: `sha256:${'b'.repeat(64)}` as const,
    },
    capabilities: {
      context: {
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_import_fixture',
        baseRevisionId: 'rev_import_fixture',
      },
      modeling: {
        async bakeGeometry() {
          throw new Error('Not used in provider-registry coverage.')
        },
        async reconstructMeshToBrep() {
          throw new Error('Not used in provider-registry coverage.')
        },
      },
      sketch: {
        async convertVectorToSketch() {
          return {
            plane: createStandardPlaneDefinition('xy'),
            planeTarget: { kind: 'construction', constructionId: 'construction_plane-xy' },
            planeKey: 'xy',
            sketches: [],
          }
        },
      },
      assets: {
        async registerGeometryAsset() {
          throw new Error('Not used in provider-registry coverage.')
        },
        async storeEmbeddedBinary() {
          return 'asset_embedded_fixture'
        },
      },
    },
  })

  assert(review.providerReview.name === 'fixture.png', 'Provider behavior should remain unchanged after registry composition refactor.')
})
