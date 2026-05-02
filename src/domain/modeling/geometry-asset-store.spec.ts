import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  createIndexedDbGeometryAssetStore,
  createMemoryGeometryAssetStore,
} from '@/domain/modeling/geometry-asset-store'
import { createDeterministicGeometryAsset } from '@/domain/modeling/geometry-asset-test-helpers'

test('src/domain/modeling/geometry-asset-store.spec.ts', async () => {  const asset = await createDeterministicGeometryAsset({ byteLength: 96 * 1024 })
  const store = createMemoryGeometryAssetStore()
  const firstPut = await store.put(asset)
  const secondPut = await store.put(asset)

  expectTrue(firstPut.ok && !firstPut.deduped, 'First geometry asset write should store the blob.')
  expectTrue(secondPut.ok && secondPut.deduped, 'Repeated geometry asset writes should dedupe by content hash.')

  const loaded = await store.get(asset.asset)
  expectTrue(loaded.ok, 'Stored geometry asset blobs should be readable by manifest record.')
  expectTrue(loaded.ok && loaded.bytes.byteLength === asset.bytes.byteLength, 'Loaded geometry asset bytes should preserve byte length.')

  const missing = await store.get({
    ...asset.asset,
    data: undefined,
    assetId: 'asset_missing_geometry',
    hash: `sha256:${'1'.repeat(64)}`,
  })
  expectTrue(!missing.ok && missing.diagnostic.code === 'geometry-asset-missing', 'Missing asset lookup should return a structured diagnostic.')

  const corruptBytes = asset.bytes.slice()
  corruptBytes[0] = (corruptBytes[0]! + 1) % 255
  const corrupt = await store.put({ asset: asset.asset, bytes: corruptBytes })
  expectTrue(!corrupt.ok && corrupt.diagnostic.code === 'geometry-asset-corrupt', 'Corrupt asset bytes should be rejected before storage.')

  const repairStore = createMemoryGeometryAssetStore()
  await repairStore.put(asset)
  const internalBlobs = (repairStore as unknown as { blobs: Map<string, Uint8Array> }).blobs
  internalBlobs.set(asset.asset.hash, corruptBytes)
  const repaired = await repairStore.put(asset)
  const repairedLoaded = await repairStore.get(asset.asset)
  expectTrue(repaired.ok && !repaired.deduped, 'Putting valid bytes over a corrupt stored blob should repair the content-addressed entry.')
  expectTrue(repairedLoaded.ok, 'Repaired geometry asset entries should load after integrity verification.')

  const unavailableStore = createIndexedDbGeometryAssetStore({ indexedDB: undefined })
  const storageFailure = await unavailableStore.put(asset)
  expectTrue(
    !storageFailure.ok && storageFailure.diagnostic.code === 'geometry-asset-storage-failed',
    'IndexedDB storage failures should be reported as geometry asset diagnostics.',
  )
})
