import { test } from 'bun:test'

import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { GeometryAssetBlobInput } from '@/contracts/modeling/geometry-assets'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { StepImportReviewResult } from '@/contracts/modeling/step-import'
import type { RequestId } from '@/contracts/shared/ids'
import { OccWorkerClient, type OccWorkerLike } from '@/domain/modeling/occ/worker-client'
import type { OccWorkerRequest, OccWorkerResponse } from '@/domain/modeling/occ/worker-protocol'

class FakeOccWorker implements OccWorkerLike {
  readonly posted: OccWorkerRequest[] = []
  private listener: ((event: MessageEvent<OccWorkerResponse>) => void) | null = null

  postMessage(message: OccWorkerRequest) {
    this.posted.push(message)
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<OccWorkerResponse>) => void) {
    this.listener = listener
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<OccWorkerResponse>) => void) {
    if (this.listener === listener) {
      this.listener = null
    }
  }

  emit(message: OccWorkerResponse) {
    this.listener?.({ data: message } as MessageEvent<OccWorkerResponse>)
  }
}

test('src/domain/modeling/occ/worker-client.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function testWorkerInitializationSuccess() {
    const worker = new FakeOccWorker()
    const client = new OccWorkerClient({ worker })
    const preload = client.preload({ mainWasm: '/assets/opencascade.full.wasm' })
    const request = worker.posted[0]

    assert(request?.kind === 'preload', 'Worker preload should post a typed preload request.')
    assert(
      request.assets?.mainWasm === '/assets/opencascade.full.wasm',
      'Worker preload should pass configured wasm asset URLs.',
    )

    worker.emit({ kind: 'preloaded', requestId: request.requestId })
    await preload
    client.dispose()
  }

  async function testWorkerInitializationFailure() {
    const worker = new FakeOccWorker()
    const client = new OccWorkerClient({ worker })
    const preload = client.preload()
    const request = worker.posted[0]

    assert(request?.kind === 'preload', 'Worker preload should post a preload request.')
    worker.emit({
      kind: 'failure',
      requestId: request.requestId,
      error: {
        code: 'occ-worker-initialization-failed',
        message: 'worker boot failed',
      },
    })

    let failed = false
    try {
      await preload
    } catch (error) {
      failed = error instanceof Error && error.message === 'worker boot failed'
    }

    assert(failed, 'Worker initialization failures should reject the preload call.')
    client.dispose()
  }

  async function testWorkerSnapshotOverlap() {
    const worker = new FakeOccWorker()
    const client = new OccWorkerClient({ worker })
    const document = { documentId: 'document_occ_kernel' } as AuthoredModelDocument
    const first = client.buildWorkspaceSnapshot(document)
    const second = client.buildWorkspaceSnapshot(document)
    const firstRequest = worker.posted[0]
    const secondRequest = worker.posted[1]

    assert(firstRequest?.kind === 'buildWorkspaceSnapshot', 'First snapshot should post a snapshot request.')
    assert(
      worker.posted.every((request) => request.kind !== 'cancel'),
      'Overlapping snapshot callers should not receive user-facing cancellation errors.',
    )
    assert(secondRequest?.kind === 'buildWorkspaceSnapshot', 'Second snapshot should post another snapshot request.')

    const firstSnapshot = {
      revisionId: 'rev_0001',
      document: { render: { records: [] } },
      render: { records: [] },
    } as WorkspaceSnapshot
    const secondSnapshot = {
      revisionId: 'rev_0002',
      document: { render: { records: [] } },
      render: { records: [] },
    } as WorkspaceSnapshot
    worker.emit({
      kind: 'workspaceSnapshotBuilt',
      requestId: firstRequest.requestId,
      snapshot: firstSnapshot,
    })
    worker.emit({
      kind: 'workspaceSnapshotBuilt',
      requestId: secondRequest.requestId,
      snapshot: secondSnapshot,
    })

    assert((await first).revisionId === firstSnapshot.revisionId, 'First snapshot request should resolve with its worker response.')
    assert((await second).revisionId === secondSnapshot.revisionId, 'Second snapshot request should resolve with its worker response.')
    client.dispose()
  }

  async function testWorkerSnapshotParityShape() {
    const worker = new FakeOccWorker()
    const client = new OccWorkerClient({ worker })
    const snapshot = { document: { render: { records: [] } } } as WorkspaceSnapshot
    const pending = client.buildWorkspaceSnapshot({ documentId: 'document_occ_kernel' } as AuthoredModelDocument)
    const request = worker.posted[0]

    assert(request?.kind === 'buildWorkspaceSnapshot', 'Worker snapshot builds should use the typed snapshot request.')
    worker.emit({
      kind: 'workspaceSnapshotBuilt',
      requestId: request.requestId as RequestId,
      snapshot,
    })

    assert(
      (await pending).document.render.records.length === snapshot.document.render.records.length,
      'Worker snapshot response should preserve the direct snapshot payload shape.',
    )
    client.dispose()
  }

  async function testWorkerSnapshotTransfersGeometryAssets() {
    const worker = new FakeOccWorker()
    const client = new OccWorkerClient({ worker })
    const document = { documentId: 'document_occ_kernel' } as AuthoredModelDocument
    const assets = [{
      asset: {
        assetId: 'asset_baked_mesh_test',
        hash: `sha256:${'a'.repeat(64)}`,
        byteLength: 3,
        format: 'baked-mesh',
        mediaType: 'application/vnd.cadara.baked-mesh+json',
        ownerFeatureIds: ['feature_meshImport-1'],
      },
      bytes: new Uint8Array([1, 2, 3]),
    }] as GeometryAssetBlobInput[]
    const pending = client.buildWorkspaceSnapshot(document, 'normal', assets)
    const request = worker.posted[0]

    assert(request?.kind === 'buildWorkspaceSnapshot', 'Worker snapshot builds should post a snapshot request.')
    assert(request.assets?.[0]?.bytes.byteLength === 3, 'Worker snapshot requests should include geometry asset bytes.')
    worker.emit({
      kind: 'workspaceSnapshotBuilt',
      requestId: request.requestId,
      snapshot: { document: { render: { records: [] } } } as WorkspaceSnapshot,
    })
    await pending
    client.dispose()
  }

  async function testWorkerStepImportReviewAndBake() {
    const worker = new FakeOccWorker()
    const client = new OccWorkerClient({ worker })
    const files = [{ fileName: 'part.step', bytes: new Uint8Array([1, 2, 3]) }]
    const reviewPending = client.prepareStepImportReview(files)
    const reviewRequest = worker.posted[0]

    assert(reviewRequest?.kind === 'prepareStepImportReview', 'STEP review should be routed through the OCC worker.')
    assert(reviewRequest.files[0]?.fileName === 'part.step', 'STEP review worker request should include selected files.')

    const review = {
      rootFileName: 'part.step',
      referencedDocumentNames: [],
      resolvedSources: [{ documentName: 'part.step', fileName: 'part.step', role: 'root' }],
      solids: [],
      diagnostics: [],
    } satisfies StepImportReviewResult
    worker.emit({
      kind: 'stepImportReviewPrepared',
      requestId: reviewRequest.requestId,
      review,
    })
    assert((await reviewPending).rootFileName === 'part.step', 'STEP review should resolve with worker review payload.')

    const bakePending = client.bakeStepImportGeometry({
      files,
      review,
      selectedSolidKeys: ['part.step#solid-1'],
    })
    const bakeRequest = worker.posted[1]
    assert(bakeRequest?.kind === 'bakeStepImportGeometry', 'STEP geometry bake should be routed through the OCC worker.')
    assert(bakeRequest.selectedSolidKeys?.[0] === 'part.step#solid-1', 'STEP bake request should include selected solid keys.')
    worker.emit({
      kind: 'stepImportGeometryBaked',
      requestId: bakeRequest.requestId,
      result: { ok: false, diagnostics: [] },
    })
    assert((await bakePending).ok === false, 'STEP bake should resolve with worker bake result.')
    client.dispose()
  }

  await testWorkerInitializationSuccess()
  await testWorkerInitializationFailure()
  await testWorkerSnapshotOverlap()
  await testWorkerSnapshotParityShape()
  await testWorkerSnapshotTransfersGeometryAssets()
  await testWorkerStepImportReviewAndBake()
})
