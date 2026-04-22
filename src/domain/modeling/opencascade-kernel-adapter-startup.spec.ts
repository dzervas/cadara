import { test } from 'bun:test'

import { CONTRACT_VERSION, MESH_IMPORT_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredModelDocument,
} from '@/contracts/modeling/authored-document'
import type { GeometryAssetResolver } from '@/contracts/modeling/adapter'
import type { GeometryAssetBlobInput } from '@/contracts/modeling/geometry-assets'
import { DEFAULT_MESH_RECONSTRUCTION_SETTINGS } from '@/contracts/modeling/mesh-reconstruction'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { FeatureId } from '@/contracts/shared/ids'
import { OpenCascadeKernelAdapter } from '@/domain/modeling/opencascade-kernel-adapter'
import type { OccWorkerSnapshotClient } from '@/domain/modeling/occ/worker-client'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import { createDeterministicGeometryAsset } from '@/domain/modeling/geometry-asset-test-helpers'
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
} from '@/domain/modeling/opencascade-kernel-seed'
import { MockSketchSolverAdapter } from '@/domain/solver/mock-sketch-solver-adapter'

test('src/domain/modeling/opencascade-kernel-adapter-startup.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  let openCascadeLoadCount = 0
  const adapter = new OpenCascadeKernelAdapter({
    solverAdapter: new MockSketchSolverAdapter(),
    getOpenCascadeInstance: async () => {
      openCascadeLoadCount += 1
      throw new Error('Initial empty snapshot should not initialize OpenCascade.')
    },
  })

  const response = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: OCC_KERNEL_DOCUMENT_ID,
  })

  assert(openCascadeLoadCount === 0, 'Initial empty snapshots should not load the OpenCascade runtime.')
  assert(response.snapshot.revisionId === OCC_KERNEL_INITIAL_REVISION_ID, 'Initial snapshot should use the OCC initial revision.')
  assert(response.snapshot.constructions.length === 3, 'Initial snapshot should include the three standard construction planes.')
  assert(response.snapshot.render.records.length > 0, 'Initial snapshot should include construction plane render records.')

  let preloadRuntimeLoadCount = 0
  const preloadedAdapter = new OpenCascadeKernelAdapter({
    solverAdapter: new MockSketchSolverAdapter(),
    initialSnapshotRequiresRuntime: true,
    getOpenCascadeInstance: async () => {
      preloadRuntimeLoadCount += 1
      return {} as OpenCascadeInstance
    },
  })

  await preloadedAdapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: OCC_KERNEL_DOCUMENT_ID,
  })
  await Promise.all([preloadedAdapter.preloadRuntime(), preloadedAdapter.preloadRuntime()])

  assert(
    preloadRuntimeLoadCount === 1,
    'Browser initial snapshots and eager preload should share one OCC runtime initialization.',
  )

  const directInitialSnapshot = response.snapshot
  let workerPreloads = 0
  let workerRebuilds = 0
  let workerSnapshots = 0
  let workerDocument: AuthoredModelDocument | null = null
  let workerSnapshotAssets: readonly GeometryAssetBlobInput[] = []
  const workerClient: OccWorkerSnapshotClient = {
    async preload() {
      workerPreloads += 1
    },
    async rebuildDocument() {
      workerRebuilds += 1
    },
    async buildWorkspaceSnapshot(document, _lodTierId, assets = []) {
      workerSnapshots += 1
      workerDocument = document
      workerSnapshotAssets = assets
      return directInitialSnapshot as WorkspaceSnapshot
    },
  }
  const workerBackedAdapter = new OpenCascadeKernelAdapter({
    solverAdapter: new MockSketchSolverAdapter(),
    initialSnapshotRequiresRuntime: true,
    workerSnapshotClient: workerClient,
    getOpenCascadeInstance: async () => {
      throw new Error('Worker-backed initial snapshots should not initialize OCC on the main thread.')
    },
  })

  await workerBackedAdapter.preloadRuntime()
  const workerSnapshot = await workerBackedAdapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: OCC_KERNEL_DOCUMENT_ID,
  })

  assert(workerPreloads === 1, 'Worker-backed adapters should route eager preload through the OCC worker client.')
  assert(workerSnapshots === 1, 'Worker-backed adapters should build initial snapshots through the OCC worker client.')
  assert(
    workerDocument?.documentId === OCC_KERNEL_DOCUMENT_ID,
    'Worker snapshot requests should transfer the authored document to the worker client.',
  )
  assert(
    workerSnapshot.snapshot === directInitialSnapshot,
    'Worker-backed snapshot routing should preserve the public snapshot response shape.',
  )

  const restoredDocument = createAuthoredModelDocumentFromSnapshot(directInitialSnapshot)
  const asset = await createDeterministicGeometryAsset()
  restoredDocument.assets = {
    schemaVersion: 'geometry-asset-manifest/v1alpha1',
    records: [asset.asset],
  }
  const assetResolver: GeometryAssetResolver = {
    async getGeometryAssetBytes(hash) {
      return hash === asset.asset.hash ? asset.bytes : null
    },
  }

  await workerBackedAdapter.restoreAuthoredModelDocument(restoredDocument, [], assetResolver)
  await workerBackedAdapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: OCC_KERNEL_DOCUMENT_ID,
  })

  assert(workerSnapshotAssets[0]?.bytes.byteLength === asset.bytes.byteLength, 'Worker-backed snapshots should keep restored asset bytes available.')

  const facetedFeatureId = 'feature_meshImport_worker_fallback' as FeatureId
  const facetedDocument = structuredClone(restoredDocument)
  const facetedReconstruction = {
    algorithmId: 'test',
    algorithmVersion: '1',
    settings: DEFAULT_MESH_RECONSTRUCTION_SETTINGS,
    sourceHash: asset.asset.hash,
    resultClassification: 'facetedFallback' as const,
    qualityMetrics: {
      triangleCount: 6_224,
      vertexCount: 3_114,
      openEdgeCount: 0,
      degenerateTriangleCount: 0,
      planarRegionCount: 209,
      cylindricalRegionCount: 0,
      analyticConfidence: 0.1,
      maxPlanarDeviation: 0,
      maxCylindricalDeviation: null,
    },
    surfaceSummary: {
      planarRegions: 209,
      cylindricalRegions: 0,
    },
  }
  facetedDocument.features.push({
    featureId: facetedFeatureId,
    label: 'Imported faceted mesh',
    definition: {
      kind: 'meshImport',
      featureTypeVersion: MESH_IMPORT_FEATURE_SCHEMA_VERSION,
      parameters: {
        assetId: asset.asset.assetId,
        source: {
          originalFileName: 'keyboard.stl',
          sourceFormat: 'stl',
          sourceHash: asset.asset.hash,
          sourceStored: false,
        },
        resolvedSettings: {
          unit: {
            source: 'user',
            resolvedUnit: 'millimeter',
            scaleToDocument: 1,
          },
          orientation: {
            upAxis: 'z',
            handedness: 'rightHanded',
          },
          placement: {
            translation: [0, 0, 0] as const,
            rotationEulerRadians: [0, 0, 0] as const,
            scale: 1,
          },
        },
        reconstruction: facetedReconstruction,
        label: 'Imported faceted mesh',
      },
    },
  })
  facetedDocument.featureOrder.push(facetedFeatureId)

  const rebuildsBeforeFacetedValidation = workerRebuilds
  await workerBackedAdapter.validateAuthoredModelDocument(facetedDocument, [], assetResolver)

  assert(
    workerRebuilds === rebuildsBeforeFacetedValidation,
    'Worker-backed faceted fallback validation should not synchronously rebuild the raw triangle mesh.',
  )
})
