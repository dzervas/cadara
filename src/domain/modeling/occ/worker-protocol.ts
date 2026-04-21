import { z } from 'zod'

import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
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
    }
  | {
      kind: 'buildWorkspaceSnapshot'
      requestId: RequestId
      document: AuthoredModelDocument
      lodTierId?: OccTessellationTierId
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
  }),
  z.object({
    kind: z.literal('buildWorkspaceSnapshot'),
    requestId: requestIdSchema,
    document: z.unknown(),
    lodTierId: z.enum(['startup', 'normal', 'fine']).optional(),
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
