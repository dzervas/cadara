import { test } from 'bun:test'

import type {
  CommitSketchResponse,
  GetDocumentSnapshotResponse,
} from '@/contracts/modeling/schema'
import { OpenCascadeKernelAdapter } from '@/domain/modeling/opencascade-kernel-adapter'
import type { OccWorkerSnapshotClient } from '@/domain/modeling/occ/worker-client'
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
} from '@/domain/modeling/opencascade-kernel-seed'
import { SketchConstraintSolverAdapter } from '@/domain/solver/sketch-constraint-solver-adapter'

test('src/domain/modeling/opencascade-kernel-adapter.worker-owner.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function testWorkerOwnedWarmupAndMutationsBypassLocalOcc() {
    let localOccLoads = 0
    let warmupCalls = 0
    let commitSketchCalls = 0
    let restoreCalls = 0
    let snapshotCalls = 0
    const workerClient: OccWorkerSnapshotClient = {
      async warmup() {
        warmupCalls += 1
      },
      async preload() {
        warmupCalls += 1
      },
      async restoreAuthoredModelDocument() {
        restoreCalls += 1
      },
      async validateAuthoredModelDocument() {},
      async exportAuthoredModelDocument(documentId) {
        return {
          contractVersion: 'modeling-contract/v1alpha1',
          schemaVersion: 'authored-model-document/v1alpha1',
          documentId,
          revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
          settings: {
            linearUnit: 'millimeter',
            modelingTolerance: 0.001,
            angularToleranceRadians: 0.01,
          },
          variables: [],
          sketches: [],
          features: [],
          featureOrder: [],
          historyOrder: [],
          cursor: { kind: 'empty' },
          bodyLabels: [],
          assets: { records: [] },
          embeddedBinaryAssets: [],
        }
      },
      async getDocumentSnapshot() {
        snapshotCalls += 1
        return {
          contractVersion: 'modeling-contract/v1alpha1',
          snapshot: {
            document: {
              documentId: OCC_KERNEL_DOCUMENT_ID,
              revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
              diagnostics: [],
              settings: {
                linearUnit: 'millimeter',
                modelingTolerance: 0.001,
                angularToleranceRadians: 0.01,
              },
              variables: [],
              features: [],
              sketches: [],
              bodies: [],
              constructions: [],
              references: [],
              objects: [],
              featureTree: [],
              documentHistory: [],
              cursor: { kind: 'empty' },
              render: { records: [] },
            },
            render: { schemaVersion: 'render-export/v1alpha1', records: [] },
          },
        } as GetDocumentSnapshotResponse
      },
      async projectSketchExternalReferences() {
        return {
          contractVersion: 'modeling-contract/v1alpha1',
          projectedReferences: [],
          diagnostics: [],
        }
      },
      async commitSketch() {
        commitSketchCalls += 1
        return {
          contractVersion: 'modeling-contract/v1alpha1',
          documentId: OCC_KERNEL_DOCUMENT_ID,
          revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
          sketchId: 'sketch_1',
          changedTargets: [],
          revisionState: {
            kind: 'accepted',
            baseRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
          },
          rebuildResult: {
            kind: 'rebuilt',
            revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
            invalidatedTargets: [],
            diagnostics: [],
          },
          diagnostics: [],
        } as CommitSketchResponse
      },
      async createFeature() {
        throw new Error('unused')
      },
      async updateFeature() {
        throw new Error('unused')
      },
      async deleteFeature() {
        throw new Error('unused')
      },
      async deleteTarget() {
        throw new Error('unused')
      },
      async renameBody() {
        throw new Error('unused')
      },
      async reorderFeature() {
        throw new Error('unused')
      },
      async reorderDocumentHistory() {
        throw new Error('unused')
      },
      async setFeatureCursor() {
        throw new Error('unused')
      },
      async addDocumentVariable() {
        throw new Error('unused')
      },
      async updateDocumentVariable() {
        throw new Error('unused')
      },
      async evaluatePreview() {
        throw new Error('unused')
      },
      async resolveReference() {
        throw new Error('unused')
      },
      async getExportCapabilities() {
        throw new Error('unused')
      },
    }

    const adapter = new OpenCascadeKernelAdapter({
      solverAdapter: new SketchConstraintSolverAdapter({
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      }),
      workerSnapshotClient: workerClient,
      getOpenCascadeInstance: async () => {
        localOccLoads += 1
        throw new Error('local OCC should not load')
      },
      initialSnapshotRequiresRuntime: true,
    })

    await adapter.preloadRuntime()
    await adapter.restoreAuthoredModelDocument({
      contractVersion: 'modeling-contract/v1alpha1',
      schemaVersion: 'authored-model-document/v1alpha1',
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      settings: {
        linearUnit: 'millimeter',
        modelingTolerance: 0.001,
        angularToleranceRadians: 0.01,
      },
      variables: [],
      sketches: [],
      features: [],
      featureOrder: [],
      historyOrder: [],
      cursor: { kind: 'empty' },
      bodyLabels: [],
      assets: { records: [] },
      embeddedBinaryAssets: [],
    })
    await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: OCC_KERNEL_DOCUMENT_ID,
    })
    await adapter.commitSketch({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: OCC_KERNEL_DOCUMENT_ID,
      requestId: 'request_commit_worker_owned',
      baseRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      sketchId: null,
      sketchLabel: 'Sketch 1',
      plane: {
        key: 'sketch-plane:xy',
        support: { kind: 'construction', constructionId: 'construction_xy' },
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
        },
      },
      planeTarget: { kind: 'construction', constructionId: 'construction_xy' },
      planeKey: 'sketch-plane:xy',
      definition: {
        schemaVersion: 'sketch/v1alpha1',
        points: [],
        entities: [],
        constraints: [],
        dimensions: [],
        referenceIds: [],
        references: [],
      },
      solverCorrelation: null,
    })

    assert(warmupCalls === 1, 'Worker-owned preload should warm the shared worker runtime.')
    assert(restoreCalls === 1, 'Worker-owned restores should delegate to the worker runtime.')
    assert(snapshotCalls === 1, 'Worker-owned snapshots after restore should delegate to the retained worker runtime.')
    assert(commitSketchCalls === 1, 'Worker-owned commitSketch should delegate to the worker runtime.')
    assert(localOccLoads === 0, 'Worker-owned browser mutations should not initialize a local OCC runtime.')
  }

  await testWorkerOwnedWarmupAndMutationsBypassLocalOcc()
})
