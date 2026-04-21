import { test } from 'bun:test'

import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import { OpenCascadeKernelAdapter } from '@/domain/modeling/opencascade-kernel-adapter'
import type { OccWorkerSnapshotClient } from '@/domain/modeling/occ/worker-client'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
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
  let workerSnapshots = 0
  let workerDocument: AuthoredModelDocument | null = null
  const workerClient: OccWorkerSnapshotClient = {
    async preload() {
      workerPreloads += 1
    },
    async rebuildDocument() {},
    async buildWorkspaceSnapshot(document) {
      workerSnapshots += 1
      workerDocument = document
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
})
