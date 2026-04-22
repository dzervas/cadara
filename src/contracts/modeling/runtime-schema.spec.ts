import { test } from 'bun:test'

import {
  deleteDocumentTargetRequestSchema,
  deleteDocumentTargetResponseSchema,
} from '@/contracts/modeling/runtime-schema'

test('src/contracts/modeling/runtime-schema.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const request = deleteDocumentTargetRequestSchema.parse({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_0001',
    target: { kind: 'feature', featureId: 'feature_extrude-1' },
  })
  assert(request.target.kind === 'feature', 'Generic delete requests should accept feature history targets.')

  const unsupportedRequest = deleteDocumentTargetRequestSchema.parse({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_0001',
    target: { kind: 'face', bodyId: 'body_part-1', faceId: 'face_top' },
  })
  assert(unsupportedRequest.target.kind === 'face', 'Generic delete requests should preserve unsupported durable targets for adapter rejection.')

  const malformedRequest = deleteDocumentTargetRequestSchema.safeParse({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_0001',
    target: { kind: 'feature' },
  })
  assert(!malformedRequest.success, 'Malformed generic delete targets should fail runtime request validation.')

  const conflictResponse = deleteDocumentTargetResponseSchema.parse({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
    revisionId: 'rev_0002',
    deletedTarget: { kind: 'body', bodyId: 'body_part-1' },
    revisionState: {
      kind: 'conflict',
      expectedRevisionId: 'rev_0001',
      actualRevisionId: 'rev_0002',
    },
    rebuildResult: {
      kind: 'skipped',
      reasonCode: 'revisionConflict',
      invalidatedTargets: [],
      diagnostics: [],
    },
    changedTargets: [],
    diagnostics: [],
  })
  assert(conflictResponse.revisionState.kind === 'conflict', 'Generic delete responses should validate stale revision conflicts.')
})
