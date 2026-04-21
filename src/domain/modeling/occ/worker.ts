import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { OpenCascadeKernelAdapter } from '@/domain/modeling/opencascade-kernel-adapter'
import {
  loadDefaultOpenCascadeFactory,
  type OpenCascadeInstance,
} from '@/domain/modeling/occ/runtime'
import {
  normalizeOccWorkerFailure,
  occWorkerRequestEnvelopeSchema,
  type OccWorkerAssetConfig,
  type OccWorkerRequest,
  type OccWorkerResponse,
} from '@/domain/modeling/occ/worker-protocol'
import { packWorkspaceSnapshotRenderMeshes } from '@/domain/modeling/occ/mesh-transport'
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
} from '@/domain/modeling/opencascade-kernel-seed'
import { SketchConstraintSolverAdapter } from '@/domain/solver/sketch-constraint-solver-adapter'

let openCascadePromise: Promise<OpenCascadeInstance> | null = null
let lastAssets: OccWorkerAssetConfig | undefined
let adapter: OpenCascadeKernelAdapter | null = null
let requestQueue: Promise<void> = Promise.resolve()

interface OccWorkerGlobalScope {
  postMessage(message: OccWorkerResponse, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<OccWorkerRequest>) => void): void
}

const workerScope = self as unknown as OccWorkerGlobalScope

function postOccWorkerMessage(message: OccWorkerResponse, transfer?: Transferable[]) {
  workerScope.postMessage(message, transfer ?? [])
}

function getWorkerOpenCascadeInstance(assets?: OccWorkerAssetConfig) {
  lastAssets = assets ?? lastAssets

  if (!openCascadePromise) {
    openCascadePromise = loadDefaultOpenCascadeFactory({ isNodeRuntime: false })
      .then((initializeOpenCascade) => initializeOpenCascade(lastAssets))
      .catch((error: unknown) => {
        openCascadePromise = null
        throw error
      })
  }

  return openCascadePromise
}

function getWorkerAdapter() {
  if (!adapter) {
    adapter = new OpenCascadeKernelAdapter({
      solverAdapter: new SketchConstraintSolverAdapter({
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      }),
      solverAdapterFactory: (revisionId) =>
        new SketchConstraintSolverAdapter({
          documentId: OCC_KERNEL_DOCUMENT_ID,
          revisionId,
        }),
      getOpenCascadeInstance: () => getWorkerOpenCascadeInstance(),
      initialSnapshotRequiresRuntime: true,
    })
  }

  return adapter
}

async function handleOccWorkerRequest(request: OccWorkerRequest) {
  switch (request.kind) {
    case 'preload':
      await getWorkerOpenCascadeInstance(request.assets)
      postOccWorkerMessage({ kind: 'preloaded', requestId: request.requestId })
      return
    case 'rebuildDocument':
      await getWorkerAdapter().restoreAuthoredModelDocument?.(request.document)
      postOccWorkerMessage({ kind: 'documentRebuilt', requestId: request.requestId })
      return
    case 'buildWorkspaceSnapshot': {
      const workerAdapter = getWorkerAdapter()
      await workerAdapter.restoreAuthoredModelDocument?.(request.document)
      workerAdapter.setSnapshotLodTier(request.lodTierId ?? 'startup')
      const response = await workerAdapter.getDocumentSnapshot({
        contractVersion: CONTRACT_VERSION,
        documentId: request.document.documentId,
      })
      const packed = packWorkspaceSnapshotRenderMeshes(response.snapshot)
      postOccWorkerMessage({
        kind: 'workspaceSnapshotBuilt',
        requestId: request.requestId,
        snapshot: packed.snapshot,
      }, packed.transferList)
      return
    }
    case 'cancel':
      postOccWorkerMessage(normalizeOccWorkerFailure(
        request.cancelsRequestId,
        new Error('OCC worker request was cancelled.'),
        'occ-worker-request-cancelled',
      ))
      return
  }
}

function enqueueOccWorkerRequest(request: OccWorkerRequest) {
  requestQueue = requestQueue
    .then(() => handleOccWorkerRequest(request))
    .catch((error: unknown) => {
      postOccWorkerMessage(normalizeOccWorkerFailure(
        request.requestId,
        error,
        request.kind === 'preload'
          ? 'occ-worker-initialization-failed'
          : 'occ-worker-request-failed',
      ))
    })
}

workerScope.addEventListener('message', (event: MessageEvent<OccWorkerRequest>) => {
  const parsed = occWorkerRequestEnvelopeSchema.safeParse(event.data)
  const requestId = typeof event.data?.requestId === 'string'
    ? event.data.requestId
    : ('request_occ_worker_unknown' as const)

  if (!parsed.success) {
    postOccWorkerMessage(normalizeOccWorkerFailure(
      requestId,
      parsed.error,
      'occ-worker-request-failed',
    ))
    return
  }

  enqueueOccWorkerRequest(parsed.data as OccWorkerRequest)
})
