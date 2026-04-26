import { test } from 'bun:test'

import { geometryAssetRecordSchema } from '@/contracts/modeling/geometry-assets.runtime-schema'
import { IMPORT_CONTRACT_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { createDeterministicGeometryAsset } from '@/domain/modeling/geometry-asset-test-helpers'

test('src/contracts/modeling/geometry-assets-import-binding.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const { asset } = await createDeterministicGeometryAsset()
  const importedAssetResult = geometryAssetRecordSchema.safeParse({
    ...asset,
    provenance: {
      ...asset.provenance,
      importBinding: {
        schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
        kind: 'url',
        url: 'https://example.com/bracket.step',
        fingerprint: `sha256:${'d'.repeat(64)}`,
        refreshPolicy: 'manual',
      },
    },
  })

  assert(importedAssetResult.success, 'Geometry asset runtime validation should accept persisted import binding metadata.')
})
