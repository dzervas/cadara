import type { ModelingKernelAdapter } from '@/contracts/modeling/adapter'
import type {
  DocumentId,
  RevisionId,
  SketchId,
} from '@/core/editor/schema'
import type {
  CommitSketchResponse,
  ModelingOperationResult,
} from '@/contracts/modeling/schema'
import type { RequestId } from '@/contracts/shared/ids'
import type {
  ModelingOperationHistoryEntry,
  PersistedCommitSketchPayload,
} from '@/contracts/modeling/operation-history'
import type { ModelingCommitSketchCorrelation } from './types'
import {
  CONTRACT_VERSION,
  isAcceptedMutation,
} from './helpers'
import {
  validateSnapshotResponse,
  buildDocumentRequest,
} from './snapshot'

export interface HistoryReplayCursor {
  revisionId: RevisionId
  sketchIds: Set<SketchId>
}

export async function getAdapterReplayCursor(
  adapter: ModelingKernelAdapter,
  documentId: DocumentId,
): Promise<HistoryReplayCursor> {
  const response = await adapter.getDocumentSnapshot(buildDocumentRequest(documentId))
  const snapshot = validateSnapshotResponse(response, documentId)

  return {
    revisionId: snapshot.document.revisionId,
    sketchIds: new Set(snapshot.document.sketches.map((entry) => entry.sketchId)),
  }
}

export function createHistoryReplayCorrelation(index: number): ModelingCommitSketchCorrelation {
  const requestId = `request_history_replay_${index + 1}` as RequestId
  return {
    requestId,
    projectionRequestId: `${requestId}:project` as RequestId,
    validationRequestId: `${requestId}:validate` as RequestId,
    solveRequestId: `${requestId}:solve` as RequestId,
    regionRequestId: `${requestId}:regions` as RequestId,
  }
}

export function getExpectedAllocatedReplaySketchId(
  sketchIds: ReadonlySet<SketchId>,
): SketchId {
  if (!sketchIds.has('sketch_primary' as SketchId)) {
    return 'sketch_primary' as SketchId
  }

  let maxOrdinal = 1
  for (const sketchId of sketchIds) {
    const match = /^sketch_(\d+)$/.exec(sketchId)
    if (match) {
      maxOrdinal = Math.max(maxOrdinal, Number.parseInt(match[1]!, 10))
    }
  }

  return `sketch_${maxOrdinal + 1}` as SketchId
}

export function resolveReplayCommitSketchId(
  cursor: HistoryReplayCursor,
  sketchId: PersistedCommitSketchPayload['sketchId'],
): PersistedCommitSketchPayload['sketchId'] {
  if (sketchId === null) {
    return null
  }

  if (cursor.sketchIds.has(sketchId)) {
    return sketchId
  }

  return sketchId === getExpectedAllocatedReplaySketchId(cursor.sketchIds) ? null : sketchId
}

export function advanceHistoryReplayCursor(
  cursor: HistoryReplayCursor,
  entry: ModelingOperationHistoryEntry,
  response: ModelingOperationResult,
): HistoryReplayCursor {
  if (!isAcceptedMutation(response)) {
    return cursor
  }

  if (entry.kind === 'deleteTarget' && entry.payload.target.kind === 'sketch') {
    if (!cursor.sketchIds.has(entry.payload.target.sketchId)) {
      return {
        ...cursor,
        revisionId: response.revisionId,
      }
    }

    const nextSketchIds = new Set(cursor.sketchIds)
    nextSketchIds.delete(entry.payload.target.sketchId)

    return {
      revisionId: response.revisionId,
      sketchIds: nextSketchIds,
    }
  }

  if (entry.kind !== 'commitSketch') {
    return {
      ...cursor,
      revisionId: response.revisionId,
    }
  }

  const sketchId = (response as CommitSketchResponse).sketchId

  if (cursor.sketchIds.has(sketchId)) {
    return {
      ...cursor,
      revisionId: response.revisionId,
    }
  }

  const nextSketchIds = new Set(cursor.sketchIds)
  nextSketchIds.add(sketchId)

  return {
    revisionId: response.revisionId,
    sketchIds: nextSketchIds,
  }
}

export async function replayHistoryEntry(input: {
  adapter: ModelingKernelAdapter
  documentId: DocumentId
  entry: ModelingOperationHistoryEntry
  entryIndex: number
  cursor: HistoryReplayCursor
}): Promise<{ response: ModelingOperationResult; cursor: HistoryReplayCursor }> {
  const baseRevisionId = input.cursor.revisionId

  switch (input.entry.kind) {
    case 'commitSketch': {
      const response = await input.adapter.commitSketch({
        ...input.entry.payload,
        sketchId: resolveReplayCommitSketchId(input.cursor, input.entry.payload.sketchId),
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
        solverCorrelation: createHistoryReplayCorrelation(input.entryIndex),
      })

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      }
    }
    case 'createFeature': {
      const response = await input.adapter.createFeature({
        ...input.entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      })

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      }
    }
    case 'updateFeature': {
      const response = await input.adapter.updateFeature({
        ...input.entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      })

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      }
    }
    case 'deleteFeature': {
      const response = await input.adapter.deleteFeature({
        ...input.entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      })

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      }
    }
    case 'deleteTarget': {
      const response = await input.adapter.deleteTarget({
        ...input.entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      })

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      }
    }
    case 'renameBody': {
      const response = await input.adapter.renameBody({
        ...input.entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      })

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      }
    }
    case 'reorderFeature': {
      const response = await input.adapter.reorderFeature({
        ...input.entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      })

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      }
    }
    case 'reorderDocumentHistory': {
      const response = await input.adapter.reorderDocumentHistory({
        ...input.entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      })

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      }
    }
    case 'setFeatureCursor': {
      const response = await input.adapter.setFeatureCursor({
        ...input.entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      })
      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      }
    }
    case 'addDocumentVariable': {
      const response = await input.adapter.addDocumentVariable({
        ...input.entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      })

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      }
    }
    case 'updateDocumentVariable': {
      const response = await input.adapter.updateDocumentVariable({
        ...input.entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      })

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      }
    }
    default:
      input.entry satisfies never
      throw new Error('Unsupported operation history entry.')
  }
}

