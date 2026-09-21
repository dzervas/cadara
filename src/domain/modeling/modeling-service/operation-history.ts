import type { ModelingKernelAdapter } from "@/contracts/modeling/adapter";
import type { DocumentId, RevisionId, SketchId } from "@/core/editor/schema";
import type {
  CommitSketchResponse,
  ModelingOperationResult,
} from "@/contracts/modeling/schema";
import type { RequestId } from "@/contracts/shared/ids";
import type { ModelingOperationHistoryEntry } from "@/contracts/modeling/operation-history";
import type { ModelingCommitSketchCorrelation } from "./types";
import { CONTRACT_VERSION, isAcceptedMutation } from "./helpers";
import { validateSnapshotResponse, buildDocumentRequest } from "./snapshot";

export interface HistoryReplayCursor {
  revisionId: RevisionId;
  sketchIds: Set<SketchId>;
}

export async function getAdapterReplayCursor(
  adapter: ModelingKernelAdapter,
  documentId: DocumentId,
): Promise<HistoryReplayCursor> {
  const response = await adapter.getDocumentSnapshot(
    buildDocumentRequest(documentId),
  );
  const snapshot = validateSnapshotResponse(response, documentId);

  return {
    revisionId: snapshot.document.revisionId,
    sketchIds: new Set(
      snapshot.document.sketches.map((entry) => entry.sketchId),
    ),
  };
}

export function createHistoryReplayCorrelation(
  index: number,
): ModelingCommitSketchCorrelation {
  const requestId = `request_history_replay_${index + 1}` as RequestId;
  return {
    requestId,
    projectionRequestId: `${requestId}:project` as RequestId,
    validationRequestId: `${requestId}:validate` as RequestId,
    solveRequestId: `${requestId}:solve` as RequestId,
    regionRequestId: `${requestId}:regions` as RequestId,
  };
}

export function advanceHistoryReplayCursor(
  cursor: HistoryReplayCursor,
  entry: ModelingOperationHistoryEntry,
  response: ModelingOperationResult,
): HistoryReplayCursor {
  if (!isAcceptedMutation(response)) {
    return cursor;
  }

  if (entry.kind === "deleteTarget" && entry.payload.target.kind === "sketch") {
    const deletedSketchId = entry.payload.target.sketchId;
    if (!cursor.sketchIds.has(deletedSketchId)) {
      return {
        ...cursor,
        revisionId: response.revisionId,
      };
    }

    const nextSketchIds = new Set(cursor.sketchIds);
    nextSketchIds.delete(deletedSketchId);

    return {
      ...cursor,
      revisionId: response.revisionId,
      sketchIds: nextSketchIds,
    };
  }

  if (entry.kind !== "commitSketch") {
    return {
      ...cursor,
      revisionId: response.revisionId,
    };
  }

  const sketchId = (response as CommitSketchResponse).sketchId;
  if (cursor.sketchIds.has(sketchId)) {
    return {
      ...cursor,
      revisionId: response.revisionId,
    };
  }

  const nextSketchIds = new Set(cursor.sketchIds);
  nextSketchIds.add(sketchId);

  return {
    revisionId: response.revisionId,
    sketchIds: nextSketchIds,
  };
}

export async function replayHistoryEntry(input: {
  adapter: ModelingKernelAdapter;
  documentId: DocumentId;
  entry: ModelingOperationHistoryEntry;
  entryIndex: number;
  cursor: HistoryReplayCursor;
}): Promise<{
  response: ModelingOperationResult;
  cursor: HistoryReplayCursor;
}> {
  const baseRevisionId = input.cursor.revisionId;
  const entry = input.entry;

  switch (entry.kind) {
    case "commitSketch": {
      const restoreRecordedSketchId =
        entry.payload.sketchId !== null &&
        !input.cursor.sketchIds.has(entry.payload.sketchId);
      const response = await input.adapter.commitSketch({
        ...entry.payload,
        restoreRecordedSketchId,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
        solverCorrelation: createHistoryReplayCorrelation(input.entryIndex),
      });

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    case "createFeature": {
      const response = await input.adapter.createFeature({
        ...entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      });

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    case "updateFeature": {
      const response = await input.adapter.updateFeature({
        ...entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      });

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    case "setFeatureSuppression": {
      const response = await input.adapter.setFeatureSuppression({
        ...entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      });

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    case "deleteFeature": {
      const response = await input.adapter.deleteFeature({
        ...entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      });

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    case "deleteTarget": {
      const response = await input.adapter.deleteTarget({
        ...entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      });

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    case "renameBody": {
      const response = await input.adapter.renameBody({
        ...entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      });

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    case "reorderFeature": {
      const response = await input.adapter.reorderFeature({
        ...entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      });

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    case "reorderDocumentHistory": {
      const response = await input.adapter.reorderDocumentHistory({
        ...entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      });

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    case "setFeatureCursor": {
      const response = await input.adapter.setFeatureCursor({
        ...entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      });
      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    case "addDocumentVariable": {
      const response = await input.adapter.addDocumentVariable({
        ...entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      });

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    case "updateDocumentVariable": {
      const response = await input.adapter.updateDocumentVariable({
        ...entry.payload,
        contractVersion: CONTRACT_VERSION,
        documentId: input.documentId,
        baseRevisionId,
      });

      return {
        response,
        cursor: advanceHistoryReplayCursor(input.cursor, input.entry, response),
      };
    }
    default:
      entry satisfies never;
      throw new Error("Unsupported operation history entry.");
  }
}
