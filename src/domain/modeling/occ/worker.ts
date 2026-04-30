import type { GeometryAssetResolver } from '@/contracts/modeling/adapter'
import type { GeometryAssetBlobInput } from '@/contracts/modeling/geometry-assets'
import { OpenCascadeKernelAdapter } from '@/domain/modeling/opencascade-kernel-adapter'
import { packWorkspaceSnapshotRenderMeshes } from '@/domain/modeling/occ/mesh-transport'
import {
  loadDefaultOpenCascadeFactory,
  type OpenCascadeInstance,
} from '@/domain/modeling/occ/runtime'
import {
  normalizeOccWorkerFailure,
  occWorkerRequestEnvelopeSchema,
  type OccWorkerAssetConfig,
  type OccWorkerOperation,
  type OccWorkerRequest,
  type OccWorkerResponse,
} from '@/domain/modeling/occ/worker-protocol'
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

interface PackedSnapshotOperationResult {
  contractVersion: 'modeling-contract/v1alpha1'
  snapshot: ReturnType<typeof packWorkspaceSnapshotRenderMeshes>['snapshot']
  transferList: Transferable[]
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

async function handleWorkerOperation(operation: OccWorkerOperation) {
  const workerAdapter = getWorkerAdapter()

  switch (operation.kind) {
    case 'warmup':
      await getWorkerOpenCascadeInstance(operation.assets)
      await workerAdapter.preloadRuntime()
      return undefined
    case 'restoreAuthoredModelDocument':
      await workerAdapter.restoreAuthoredModelDocument?.(
        operation.document,
        operation.diagnostics ?? [],
        createWorkerAssetResolver(operation.assets),
      )
      return undefined
    case 'validateAuthoredModelDocument':
      await workerAdapter.validateAuthoredModelDocument?.(
        operation.document,
        operation.diagnostics ?? [],
        createWorkerAssetResolver(operation.assets),
      )
      return undefined
    case 'exportAuthoredModelDocument':
      return workerAdapter.exportAuthoredModelDocument?.(operation.documentId)
    case 'getDocumentSnapshot': {
      workerAdapter.setSnapshotLodTier(operation.lodTierId ?? 'startup')
      const response = await workerAdapter.getDocumentSnapshot(operation.request)
      const packed = packWorkspaceSnapshotRenderMeshes(response.snapshot)
      return {
        contractVersion: response.contractVersion,
        snapshot: packed.snapshot,
        transferList: packed.transferList,
      } satisfies PackedSnapshotOperationResult
    }
    case 'projectSketchExternalReferences':
      return workerAdapter.projectSketchExternalReferences(operation.request)
    case 'commitSketch':
      return workerAdapter.commitSketch(operation.request)
    case 'createFeature':
      return workerAdapter.createFeature(operation.request)
    case 'updateFeature':
      return workerAdapter.updateFeature(operation.request)
    case 'deleteFeature':
      return workerAdapter.deleteFeature(operation.request)
    case 'deleteTarget':
      return workerAdapter.deleteTarget(operation.request)
    case 'renameBody':
      return workerAdapter.renameBody(operation.request)
    case 'reorderFeature':
      return workerAdapter.reorderFeature(operation.request)
    case 'reorderDocumentHistory':
      return workerAdapter.reorderDocumentHistory(operation.request)
    case 'setFeatureCursor':
      return workerAdapter.setFeatureCursor(operation.request)
    case 'addDocumentVariable':
      return workerAdapter.addDocumentVariable(operation.request)
    case 'updateDocumentVariable':
      return workerAdapter.updateDocumentVariable(operation.request)
    case 'evaluatePreview':
      return workerAdapter.evaluatePreview(operation.request)
    case 'resolveReference':
      return workerAdapter.resolveReference(operation.request)
    case 'getExportCapabilities':
      return workerAdapter.getExportCapabilities(operation.baseRevisionId)
  }
}

async function handleOccWorkerRequest(request: OccWorkerRequest) {
  switch (request.kind) {
    case 'invoke': {
      const result = await handleWorkerOperation(request.operation)
      if (
        request.operation.kind === 'getDocumentSnapshot'
        && result
        && typeof result === 'object'
        && 'snapshot' in result
        && 'transferList' in result
      ) {
        const snapshotResult = result as PackedSnapshotOperationResult
        postOccWorkerMessage({
          kind: 'invoked',
          requestId: request.requestId,
          operation: request.operation.kind,
          payload: {
            contractVersion: snapshotResult.contractVersion,
            snapshot: snapshotResult.snapshot,
          },
        }, snapshotResult.transferList)
        return
      }

      postOccWorkerMessage({
        kind: 'invoked',
        requestId: request.requestId,
        operation: request.operation.kind,
        payload: result,
      })
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

function createWorkerAssetResolver(
  assets: readonly GeometryAssetBlobInput[] | undefined,
): GeometryAssetResolver | undefined {
  if (!assets || assets.length === 0) {
    return undefined
  }

  const blobs = new Map(assets.map((asset) => [asset.asset.hash, asset.bytes.slice()] as const))
  return {
    async getGeometryAssetBytes(hash) {
      return blobs.get(hash)?.slice() ?? null
    },
  }
}

function enqueueOccWorkerRequest(request: OccWorkerRequest) {
  requestQueue = requestQueue
    .then(() => handleOccWorkerRequest(request))
    .catch((error: unknown) => {
      postOccWorkerMessage(normalizeOccWorkerFailure(
        request.requestId,
        error,
        request.kind === 'invoke' && request.operation.kind === 'warmup'
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
