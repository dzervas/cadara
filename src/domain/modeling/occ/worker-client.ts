import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { GeometryAssetBlobInput } from '@/contracts/modeling/geometry-assets'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { StepImportBakeGeometryResult } from '@/contracts/modeling/adapter'
import type { StepImportReviewFileInput, StepImportReviewResult } from '@/contracts/modeling/step-import'
import type { RequestId } from '@/contracts/shared/ids'
import type {
  OccWorkerAssetConfig,
  OccWorkerRequest,
  OccWorkerResponse,
} from '@/domain/modeling/occ/worker-protocol'
import { unpackWorkspaceSnapshotRenderMeshes } from '@/domain/modeling/occ/mesh-transport'
import type { OccTessellationTierId } from '@/domain/modeling/occ/tessellation'

export interface OccWorkerLike {
  postMessage(message: OccWorkerRequest, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<OccWorkerResponse>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<OccWorkerResponse>) => void): void
  terminate?(): void
}

type PendingRequest =
  {
    kind: 'preload' | 'rebuildDocument' | 'buildWorkspaceSnapshot' | 'prepareStepImportReview' | 'bakeStepImportGeometry'
    resolve: (value?: WorkspaceSnapshot | StepImportReviewResult | StepImportBakeGeometryResult) => void
    reject: (error: Error) => void
  }

export interface OccWorkerClientOptions {
  worker: OccWorkerLike
}

export interface OccWorkerSnapshotClient {
  preload(assets?: OccWorkerAssetConfig): Promise<void>
  rebuildDocument(document: AuthoredModelDocument, assets?: readonly GeometryAssetBlobInput[]): Promise<void>
  buildWorkspaceSnapshot(
    document: AuthoredModelDocument,
    lodTierId?: OccTessellationTierId,
    assets?: readonly GeometryAssetBlobInput[],
  ): Promise<WorkspaceSnapshot>
  prepareStepImportReview(files: readonly StepImportReviewFileInput[]): Promise<StepImportReviewResult>
  bakeStepImportGeometry(input: {
    files: readonly StepImportReviewFileInput[]
    review?: StepImportReviewResult
    selectedSolidKeys?: readonly string[]
  }): Promise<StepImportBakeGeometryResult>
  dispose?(): void
}

export class OccWorkerClient implements OccWorkerSnapshotClient {
  private readonly worker: OccWorkerLike
  private readonly pending = new Map<RequestId, PendingRequest>()
  private requestSequence = 0

  constructor(options: OccWorkerClientOptions) {
    this.worker = options.worker
    this.worker.addEventListener('message', this.handleMessage)
  }

  preload(assets?: OccWorkerAssetConfig) {
    const requestId = this.createRequestId('occ_preload')

    return this.sendRequest<void>({ kind: 'preload', requestId, assets }, {
      kind: 'preload',
      resolve: () => undefined,
      reject: () => undefined,
    })
  }

  rebuildDocument(document: AuthoredModelDocument, assets: readonly GeometryAssetBlobInput[] = []) {
    const requestId = this.createRequestId('occ_rebuild')

    return this.sendRequest<void>({ kind: 'rebuildDocument', requestId, document, assets }, {
      kind: 'rebuildDocument',
      resolve: () => undefined,
      reject: () => undefined,
    })
  }

  buildWorkspaceSnapshot(
    document: AuthoredModelDocument,
    lodTierId?: OccTessellationTierId,
    assets: readonly GeometryAssetBlobInput[] = [],
  ) {
    const requestId = this.createRequestId('occ_snapshot')

    return this.sendRequest<WorkspaceSnapshot>({ kind: 'buildWorkspaceSnapshot', requestId, document, lodTierId, assets }, {
      kind: 'buildWorkspaceSnapshot',
      resolve: () => undefined,
      reject: () => undefined,
    })
  }

  prepareStepImportReview(files: readonly StepImportReviewFileInput[]) {
    const requestId = this.createRequestId('occ_step_review')

    return this.sendRequest<StepImportReviewResult>({ kind: 'prepareStepImportReview', requestId, files }, {
      kind: 'prepareStepImportReview',
      resolve: () => undefined,
      reject: () => undefined,
    })
  }

  bakeStepImportGeometry(input: {
    files: readonly StepImportReviewFileInput[]
    review?: StepImportReviewResult
    selectedSolidKeys?: readonly string[]
  }) {
    const requestId = this.createRequestId('occ_step_bake')

    return this.sendRequest<StepImportBakeGeometryResult>({
      kind: 'bakeStepImportGeometry',
      requestId,
      files: input.files,
      review: input.review,
      selectedSolidKeys: input.selectedSolidKeys,
    }, {
      kind: 'bakeStepImportGeometry',
      resolve: () => undefined,
      reject: () => undefined,
    })
  }

  dispose() {
    this.worker.removeEventListener('message', this.handleMessage)
    for (const requestId of this.pending.keys()) {
      this.rejectPending(requestId, new Error('OCC worker client disposed.'))
    }
    this.worker.terminate?.()
  }

  private sendRequest<T>(
    request: OccWorkerRequest,
      pending: PendingRequest,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(request.requestId, {
        ...pending,
        resolve: (value) => resolve(value as T),
        reject,
      })
      this.worker.postMessage(request)
    })
  }

  private readonly handleMessage = (event: MessageEvent<OccWorkerResponse>) => {
    const message = event.data
    const pending = this.pending.get(message.requestId)

    if (!pending) {
      return
    }

    this.pending.delete(message.requestId)

    if (message.kind === 'failure') {
      pending.reject(new Error(message.error.message))
      return
    }

    if (pending.kind === 'buildWorkspaceSnapshot') {
      if (message.kind !== 'workspaceSnapshotBuilt') {
        pending.reject(new Error(`Unexpected OCC worker response ${message.kind}.`))
        return
      }

      pending.resolve(unpackWorkspaceSnapshotRenderMeshes(message.snapshot))
      return
    }

    if (pending.kind === 'prepareStepImportReview') {
      if (message.kind !== 'stepImportReviewPrepared') {
        pending.reject(new Error(`Unexpected OCC worker response ${message.kind}.`))
        return
      }

      pending.resolve(message.review)
      return
    }

    if (pending.kind === 'bakeStepImportGeometry') {
      if (message.kind !== 'stepImportGeometryBaked') {
        pending.reject(new Error(`Unexpected OCC worker response ${message.kind}.`))
        return
      }

      pending.resolve(message.result)
      return
    }

    if (
      (pending.kind === 'preload' && message.kind === 'preloaded')
      || (pending.kind === 'rebuildDocument' && message.kind === 'documentRebuilt')
    ) {
      pending.resolve()
      return
    }

    pending.reject(new Error(`Unexpected OCC worker response ${message.kind}.`))
  }

  private rejectPending(requestId: RequestId, error: Error) {
    const pending = this.pending.get(requestId)
    if (!pending) {
      return
    }

    this.pending.delete(requestId)
    pending.reject(error)
  }

  private createRequestId(prefix: string) {
    this.requestSequence += 1
    return `${prefix}_${this.requestSequence}` as RequestId
  }
}
