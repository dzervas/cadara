import { test } from 'bun:test'

import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { createImageImportProvider } from '@/domain/import/providers/image-import-provider'
import { matchImportProviders } from '@/domain/import/provider-registry'
import type { ImportCapabilities } from '@/contracts/import/capabilities'

const PNG_1X1_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmWQAAAAASUVORK5CYII='), (value) => value.charCodeAt(0))

test('src/domain/import/providers/image-import-provider.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const provider = createImageImportProvider()
  const baseSource = {
    name: 'reference.png',
    origin: {
      kind: 'localFile' as const,
      fileName: 'reference.png',
      pathHint: '/tmp/reference.png',
    },
    mediaType: 'image/png',
    bytes: PNG_1X1_BYTES,
    fingerprint: `sha256:${'1'.repeat(64)}` as const,
  }

  assert(provider.accepts(baseSource), 'Provider should accept supported raster files by extension and media type.')
  assert(
    provider.accepts({ ...baseSource, name: 'reference.jpeg', mediaType: 'application/octet-stream' }),
    'Provider should accept supported raster files by extension alone.',
  )
  assert(
    !provider.accepts({ ...baseSource, name: 'reference.txt', mediaType: 'text/plain' }),
    'Provider should reject unsupported file types.',
  )

  const review = await provider.review({
    source: baseSource,
    capabilities: createCapabilities(),
  })
  assert(review.diagnostics.length === 0, 'Valid PNG review should not emit diagnostics.')
  assert(review.providerReview.pixelWidth === 1 && review.providerReview.pixelHeight === 1, 'Review should extract image dimensions from raster bytes.')

  const plane = createStandardPlaneDefinition('xy')
  const prepared = await provider.prepare({
    source: baseSource,
    review: {
      ...review,
      providerReview: {
        pixelWidth: 400,
        pixelHeight: 200,
        sourceName: 'reference.png',
      },
    },
    selections: {
      plane,
      planeTarget: plane.support,
      planeKey: plane.key,
    },
    capabilities: createCapabilities(),
  })

  assert(prepared.commitSketches?.length === 1, 'Prepare should return one sketch commit request.')
  const commit = prepared.commitSketches?.[0]
  assert(commit?.definition.points.length === 4, 'Prepared sketch should contain four image corner points.')
  assert(commit?.definition.constraints.length === 4, 'Prepared sketch should contain four fix-point constraints.')
  const entity = commit?.definition.entities[0]
  assert(entity?.kind === 'imageReference', 'Prepared sketch should contain an image reference entity.')
  assert(entity?.cornerPointIds.length === 4, 'Prepared image reference should preserve four corner point IDs.')
  assert(entity?.embeddedBinaryId === 'asset_embedded_image_reference', 'Prepare should persist the embedded binary and reuse its durable asset ID.')
  assert(commit?.sketchLabel === 'reference', 'Prepared sketch label should derive from the source name without the extension.')
  assert(prepared.binding?.kind === 'localFile', 'Prepare should preserve a local-file import binding for refresh.')

  const corners = commit?.definition.points.map((point) => point.position) ?? []
  assert(
    JSON.stringify(corners) === JSON.stringify([
      [-100, 50],
      [100, 50],
      [100, -50],
      [-100, -50],
    ]),
    'Prepared image corners should preserve the source aspect ratio and scale the longest side to the default extent.',
  )

  const matchedProviders = matchImportProviders(baseSource)
  assert(matchedProviders.some((entry) => entry.id === provider.id), 'Image import provider should be registered in the import provider registry.')
})

function createCapabilities(): ImportCapabilities {
  return {
    context: {
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_1',
    },
    modeling: {
      async bakeGeometry() {
        throw new Error('Not used in image import provider tests.')
      },
      async reconstructMeshToBrep() {
        throw new Error('Not used in image import provider tests.')
      },
    },
    sketch: {
      async convertVectorToSketch() {
        throw new Error('Not used in image import provider tests.')
      },
    },
    assets: {
      async registerGeometryAsset() {
        throw new Error('Not used in image import provider tests.')
      },
      async storeEmbeddedBinary() {
        return 'asset_embedded_image_reference'
      },
    },
  }
}
