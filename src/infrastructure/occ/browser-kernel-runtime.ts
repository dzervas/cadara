import { OpenCascadeKernelAdapter } from '@/domain/modeling/opencascade-kernel-adapter'
import type { PerformanceTelemetry } from '@/contracts/performance/telemetry'
import {
  noopPerformanceTelemetry,
  recordPerformanceMark,
} from '@/contracts/performance/telemetry'
import { createInstrumentedOccWorkerClient } from '@/domain/modeling/occ/instrumented-worker-client'
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

export function createBrowserOccKernelAdapter(
  documentId: DocumentId = OCC_KERNEL_DOCUMENT_ID,
  performanceTelemetry: PerformanceTelemetry = noopPerformanceTelemetry,
) {
  return new OpenCascadeKernelAdapter({
    solverAdapter: createKernelSketchSolver(documentId, OCC_KERNEL_INITIAL_REVISION_ID),
    solverAdapterFactory: (revisionId) => createKernelSketchSolver(documentId, revisionId),
    initialSnapshotRequiresRuntime: typeof window !== 'undefined',
    workerSnapshotClient: createInstrumentedOccWorkerClient(browserOccWorkerClient, performanceTelemetry),
    documentId,
  })
}

export function getBrowserOccKernelAdapter(
  performanceTelemetry: PerformanceTelemetry = noopPerformanceTelemetry,
) {
  if (!browserOccKernelAdapter) {
    browserOccKernelAdapter = createBrowserOccKernelAdapter(OCC_KERNEL_DOCUMENT_ID, performanceTelemetry)
  }

  return browserOccKernelAdapter
}

export function getBrowserOccWarmupController(
  performanceTelemetry: PerformanceTelemetry = noopPerformanceTelemetry,
) {
  if (!browserOccWarmupController) {
    browserOccWarmupController = createOccPreloadController({
      preload: () => getBrowserOccKernelAdapter(performanceTelemetry).preloadRuntime(),
    })
  }

  return browserOccWarmupController
}

export function startBrowserOccWarmup(
  performanceTelemetry: PerformanceTelemetry = noopPerformanceTelemetry,
) {
  if (typeof window === 'undefined') {
    return null
  }

  if (!browserOccWarmupPromise) {
    updateBrowserOccPerf({
      warmupStartedAt: performance.now(),
      warmupSettledAt: null,
      warmupStatus: 'pending',
    })
    browserOccWarmupPromise = getBrowserOccWarmupController(performanceTelemetry).preload()
      .then(() => {
        updateBrowserOccPerf({
          warmupSettledAt: performance.now(),
          warmupStatus: 'fulfilled',
        })
        recordPerformanceMark(performanceTelemetry, {
          name: 'Startup OCC warmup settled',
          op: 'cad.startup',
          attributes: {
            'cadara.seam': 'startup',
            'cadara.operation': 'occWarmupSettled',
            'cadara.startup_phase': 'occ_warmup_settled',
          },
        })
      })
      .catch((error: unknown) => {
        updateBrowserOccPerf({
          warmupSettledAt: performance.now(),
          warmupStatus: 'rejected',
          warmupError: error instanceof Error ? error.message : 'OpenCascade warmup failed.',
        })
        recordPerformanceMark(performanceTelemetry, {
          name: 'Startup OCC warmup settled',
          op: 'cad.startup',
          attributes: {
            'cadara.seam': 'startup',
            'cadara.operation': 'occWarmupSettled',
            'cadara.startup_phase': 'occ_warmup_settled',
            'cadara.result': 'failure',
          },
        })
        throw error
      })
    void browserOccWarmupPromise.catch(() => undefined)
  }

  return browserOccWarmupPromise
}
