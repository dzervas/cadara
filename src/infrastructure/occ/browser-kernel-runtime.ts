import { OpenCascadeKernelAdapter } from '@/domain/modeling/opencascade-kernel-adapter'
import { createOccPreloadController, type OccPreloadController } from '@/domain/modeling/occ/preload'
import { createBrowserOccWorkerClient } from '@/domain/modeling/occ/worker-runtime'
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
} from '@/domain/modeling/opencascade-kernel-seed'
import { SketchConstraintSolverAdapter } from '@/domain/solver/sketch-constraint-solver-adapter'
import type { DocumentId, RevisionId } from '@/contracts/shared/ids'

const browserOccWorkerClient = typeof window === 'undefined' ? null : createBrowserOccWorkerClient()
let browserOccKernelAdapter: OpenCascadeKernelAdapter | null = null
let browserOccWarmupController: OccPreloadController | null = null
let browserOccWarmupPromise: Promise<void> | null = null

function createKernelSketchSolver(documentId: DocumentId, revisionId: RevisionId | null) {
  return new SketchConstraintSolverAdapter({
    documentId,
    revisionId,
  })
}

function updateBrowserOccPerf(
  patch: Partial<NonNullable<Window['__cadOccPerf']>>,
) {
  if (typeof window === 'undefined') {
    return
  }

  window.__cadOccPerf = {
    warmupStatus: 'idle',
    ...window.__cadOccPerf,
    ...patch,
  }
}

export function getBrowserOccWorkerClient() {
  return browserOccWorkerClient
}

export function createBrowserOccKernelAdapter(documentId: DocumentId = OCC_KERNEL_DOCUMENT_ID) {
  return new OpenCascadeKernelAdapter({
    solverAdapter: createKernelSketchSolver(documentId, OCC_KERNEL_INITIAL_REVISION_ID),
    solverAdapterFactory: (revisionId) => createKernelSketchSolver(documentId, revisionId),
    initialSnapshotRequiresRuntime: typeof window !== 'undefined',
    workerSnapshotClient: browserOccWorkerClient,
    documentId,
  })
}

export function getBrowserOccKernelAdapter() {
  if (!browserOccKernelAdapter) {
    browserOccKernelAdapter = createBrowserOccKernelAdapter()
  }

  return browserOccKernelAdapter
}

export function getBrowserOccWarmupController() {
  if (!browserOccWarmupController) {
    browserOccWarmupController = createOccPreloadController({
      preload: () => getBrowserOccKernelAdapter().preloadRuntime(),
    })
  }

  return browserOccWarmupController
}

export function startBrowserOccWarmup() {
  if (typeof window === 'undefined') {
    return null
  }

  if (!browserOccWarmupPromise) {
    updateBrowserOccPerf({
      warmupStartedAt: performance.now(),
      warmupSettledAt: null,
      warmupStatus: 'pending',
    })
    browserOccWarmupPromise = getBrowserOccWarmupController().preload()
      .then(() => {
        updateBrowserOccPerf({
          warmupSettledAt: performance.now(),
          warmupStatus: 'fulfilled',
        })
      })
      .catch((error: unknown) => {
        updateBrowserOccPerf({
          warmupSettledAt: performance.now(),
          warmupStatus: 'rejected',
          warmupError: error instanceof Error ? error.message : 'OpenCascade warmup failed.',
        })
        throw error
      })
    void browserOccWarmupPromise.catch(() => undefined)
  }

  return browserOccWarmupPromise
}
