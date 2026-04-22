import {
  createBakedMeshGeometryAsset,
  createMeshSizeLimitEvaluation,
  evaluateMeshReconstructionFallbacks,
} from '@/domain/modeling/baked-mesh-geometry'
import { hashGeometryAssetBytes } from '@/domain/modeling/geometry-asset-store'
import { getMeshSourcePreflight, MeshParseError, parseMeshSourceFile } from '@/domain/modeling/mesh-parser'
import type {
  MeshImportReviewWorkerRequest,
  MeshImportReviewWorkerResponse,
  MeshImportReviewWorkerPhase,
} from '@/domain/modeling/mesh-import-review-worker-protocol'
import type { FeatureId } from '@/contracts/shared/ids'

const workerScope = self as unknown as {
  postMessage(message: MeshImportReviewWorkerResponse, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<MeshImportReviewWorkerRequest>) => void): void
}
const PREPARED_MESH_OWNER_FEATURE_ID = 'feature_meshImport-prepared' as FeatureId

function postResponse(message: MeshImportReviewWorkerResponse, transfer?: Transferable[]) {
  workerScope.postMessage(message, transfer ?? [])
}

function postProgress(
  requestId: MeshImportReviewWorkerRequest['requestId'],
  phase: MeshImportReviewWorkerPhase,
  message: string,
  progress: number,
) {
  postResponse({
    kind: 'progress',
    requestId,
    phase,
    message,
    progress,
  })
}

workerScope.addEventListener('message', (event: MessageEvent<MeshImportReviewWorkerRequest>) => {
  const request = event.data
  if (request.kind !== 'reviewMeshImport') {
    return
  }

  void reviewMeshImport(request).catch((error: unknown) => {
    postResponse({
      kind: 'failure',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'Mesh import review failed.',
    })
  })
})

async function reviewMeshImport(request: MeshImportReviewWorkerRequest) {
  postProgress(request.requestId, 'parsing', 'Parsing mesh file', 22)
  const preflight = getMeshSourcePreflight({ fileName: request.fileName, bytes: request.bytes })
  const sourceFormat = preflight?.sourceFormat ?? (/\.3mf$/i.test(request.fileName) ? '3mf' : 'stl')
  const sourceHash = await hashGeometryAssetBytes(request.bytes)
  const sizeLimitEvaluation = preflight?.triangleCount === null || preflight === null
    ? null
    : createMeshSizeLimitEvaluation({ triangleCount: preflight.triangleCount })

  if (sizeLimitEvaluation) {
    postResponse({
      kind: 'completed',
      requestId: request.requestId,
      result: {
        sourceFormat,
        reconstruction: sizeLimitEvaluation,
        assetInput: null,
      },
    })
    return
  }

  let parsed
  try {
    parsed = parseMeshSourceFile({ fileName: request.fileName, bytes: request.bytes })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mesh source could not be parsed.'
    throw error instanceof MeshParseError
      ? new Error(message)
      : error
  }

  postProgress(request.requestId, 'reconstructing', 'Evaluating mesh reconstruction', 55)
  const reconstruction = evaluateMeshReconstructionFallbacks(parsed.triangles)

  postProgress(request.requestId, 'baking', 'Preparing baked mesh asset', 78)
  const baked = await createBakedMeshGeometryAsset({
    triangles: parsed.triangles,
    sourceFileName: request.fileName,
    sourceFormat: parsed.sourceFormat,
    sourceHash,
    ownerFeatureId: PREPARED_MESH_OWNER_FEATURE_ID,
    acceptFacetedFallback: true,
  })

  const assetInput = baked.ok ? baked.assetInput : null
  postResponse({
    kind: 'completed',
    requestId: request.requestId,
    result: {
      sourceFormat: parsed.sourceFormat,
      reconstruction,
      assetInput,
    },
  })
}
