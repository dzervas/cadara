import { z } from 'zod'

import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { CadaraBrepGeometryAssetData } from '@/contracts/modeling/geometry-assets'
import type { GeometryAssetBlobInput } from '@/contracts/modeling/geometry-assets'
import type { ModelingDiagnostic, WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { StepImportReviewFileInput, StepImportReviewResult } from '@/contracts/modeling/step-import'
import type { RequestId } from '@/contracts/shared/ids'
import type { PackedWorkspaceSnapshot } from '@/domain/modeling/occ/mesh-transport'
import type { OccTessellationTierId } from '@/domain/modeling/occ/tessellation'

const requestIdSchema = z.string().min(1)

export const occWorkerAssetConfigSchema = z.object({
  mainWasm: z.string().min(1).optional(),
  worker: z.string().min(1).optional(),
})

export type OccWorkerAssetConfig = z.infer<typeof occWorkerAssetConfigSchema>

export type OccWorkerRequest =
  | {
      kind: 'preload'
      requestId: RequestId
      assets?: OccWorkerAssetConfig
    }
  | {
      kind: 'rebuildDocument'
      requestId: RequestId
      document: AuthoredModelDocument
      assets?: readonly GeometryAssetBlobInput[]
    }
  | {
      kind: 'buildWorkspaceSnapshot'
      requestId: RequestId
      document: AuthoredModelDocument
      lodTierId?: OccTessellationTierId
      assets?: readonly GeometryAssetBlobInput[]
    }
  | {
      kind: 'prepareStepImportReview'
      requestId: RequestId
      files: readonly StepImportReviewFileInput[]
    }
  | {
      kind: 'bakeStepImportGeometry'
      requestId: RequestId
      files: readonly StepImportReviewFileInput[]
      review?: StepImportReviewResult
      selectedSolidKeys?: readonly string[]
    }
  | {
      kind: 'cancel'
      requestId: RequestId
      cancelsRequestId: RequestId
    }

export type OccWorkerResponse =
  | {
      kind: 'preloaded'
      requestId: RequestId
    }
  | {
      kind: 'documentRebuilt'
      requestId: RequestId
    }
  | {
      kind: 'workspaceSnapshotBuilt'
      requestId: RequestId
      snapshot: WorkspaceSnapshot | PackedWorkspaceSnapshot
    }
  | {
      kind: 'stepImportReviewPrepared'
      requestId: RequestId
      review: StepImportReviewResult
    }
  | {
      kind: 'stepImportGeometryBaked'
      requestId: RequestId
      result:
        | { ok: true; data: CadaraBrepGeometryAssetData }
        | { ok: false; diagnostics: readonly ModelingDiagnostic[] }
    }
  | OccWorkerFailureMessage

export interface OccWorkerFailureMessage {
  kind: 'failure'
  requestId: RequestId
  error: {
    message: string
    code: 'occ-worker-initialization-failed' | 'occ-worker-request-failed' | 'occ-worker-request-cancelled'
  }
}

export const occWorkerRequestEnvelopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('preload'),
    requestId: requestIdSchema,
    assets: occWorkerAssetConfigSchema.optional(),
  }),
  z.object({
    kind: z.literal('rebuildDocument'),
    requestId: requestIdSchema,
    document: z.unknown(),
    assets: z.array(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('buildWorkspaceSnapshot'),
    requestId: requestIdSchema,
    document: z.unknown(),
    lodTierId: z.enum(['startup', 'normal', 'fine']).optional(),
    assets: z.array(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('prepareStepImportReview'),
    requestId: requestIdSchema,
    files: z.array(z.unknown()),
  }),
  z.object({
    kind: z.literal('bakeStepImportGeometry'),
    requestId: requestIdSchema,
    files: z.array(z.unknown()),
    review: z.unknown().optional(),
    selectedSolidKeys: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal('cancel'),
    requestId: requestIdSchema,
    cancelsRequestId: requestIdSchema,
  }),
])

export function normalizeOccWorkerFailure(
  requestId: RequestId,
  error: unknown,
  code: OccWorkerFailureMessage['error']['code'] = 'occ-worker-request-failed',
): OccWorkerFailureMessage {
  return {
    kind: 'failure',
    requestId,
    error: {
      code,
      message: error instanceof Error && error.message.trim()
        ? error.message
        : 'OCC worker request failed.',
    },
  }
}
