import type { GeometryAssetBlobInput } from '@/contracts/modeling/geometry-assets'
import type { MeshReconstructionEvaluation } from '@/domain/modeling/baked-mesh-geometry'
import type { MeshImportSourceFormat } from '@/contracts/modeling/mesh-import'
import type { RequestId } from '@/contracts/shared/ids'

export type MeshImportReviewWorkerPhase =
  | 'reading'
  | 'parsing'
  | 'reconstructing'
  | 'baking'

export interface MeshImportReviewWorkerRequest {
  kind: 'reviewMeshImport'
  requestId: RequestId
  fileName: string
  bytes: Uint8Array
}

export type MeshImportReviewWorkerResponse =
  | {
      kind: 'progress'
      requestId: RequestId
      phase: MeshImportReviewWorkerPhase
      message: string
      progress: number
    }
  | {
      kind: 'completed'
      requestId: RequestId
      result: {
        sourceFormat: MeshImportSourceFormat
        reconstruction: MeshReconstructionEvaluation
        assetInput: GeometryAssetBlobInput | null
      }
    }
  | {
      kind: 'failure'
      requestId: RequestId
      message: string
    }
