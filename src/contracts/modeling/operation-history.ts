import type {
  CommitSketchRequest,
  AddDocumentVariableRequest,
  CreateFeatureRequest,
  DeleteDocumentTargetRequest,
  DeleteFeatureRequest,
  RenameBodyRequest,
  ReorderDocumentHistoryRequest,
  ReorderFeatureRequest,
  SetFeatureCursorRequest,
  SetFeatureSuppressionRequest,
  UpdateDocumentVariableRequest,
  UpdateFeatureRequest,
} from "@/contracts/modeling/schema";
import type { DocumentId, SketchId } from "@/contracts/shared/ids";
import {
  CONTRACT_VERSION,
  OPERATION_HISTORY_SCHEMA_VERSION,
  type ContractVersion,
  type OperationHistorySchemaVersion,
} from "@/contracts/shared/versioning";
import { normalizeFeatureDefinitionAuthoredValues } from "@/contracts/modeling/feature-authored-values";

export type PersistedCommitSketchPayload = Omit<
  CommitSketchRequest,
  | "contractVersion"
  | "documentId"
  | "baseRevisionId"
  | "solverCorrelation"
  | "restoreRecordedSketchId"
>;
export type PersistedCreateFeaturePayload = Omit<
  CreateFeatureRequest,
  "contractVersion" | "documentId" | "baseRevisionId"
>;
export type PersistedUpdateFeaturePayload = Omit<
  UpdateFeatureRequest,
  "contractVersion" | "documentId" | "baseRevisionId"
>;
export type PersistedDeleteFeaturePayload = Omit<
  DeleteFeatureRequest,
  "contractVersion" | "documentId" | "baseRevisionId"
>;
export type PersistedSetFeatureSuppressionPayload = Omit<
  SetFeatureSuppressionRequest,
  "contractVersion" | "documentId" | "baseRevisionId"
>;
export type PersistedDeleteTargetPayload = Omit<
  DeleteDocumentTargetRequest,
  "contractVersion" | "documentId" | "baseRevisionId"
>;
export type PersistedRenameBodyPayload = Omit<
  RenameBodyRequest,
  "contractVersion" | "documentId" | "baseRevisionId"
>;
export type PersistedReorderFeaturePayload = Omit<
  ReorderFeatureRequest,
  "contractVersion" | "documentId" | "baseRevisionId"
>;
export type PersistedReorderDocumentHistoryPayload = Omit<
  ReorderDocumentHistoryRequest,
  "contractVersion" | "documentId" | "baseRevisionId"
>;
export type PersistedSetFeatureCursorPayload = Omit<
  SetFeatureCursorRequest,
  "contractVersion" | "documentId" | "baseRevisionId"
>;
export type PersistedAddDocumentVariablePayload = Omit<
  AddDocumentVariableRequest,
  "contractVersion" | "documentId" | "baseRevisionId"
>;
export type PersistedUpdateDocumentVariablePayload = Omit<
  UpdateDocumentVariableRequest,
  "contractVersion" | "documentId" | "baseRevisionId"
>;

export type ModelingOperationHistoryEntry =
  | { kind: "commitSketch"; payload: PersistedCommitSketchPayload }
  | { kind: "createFeature"; payload: PersistedCreateFeaturePayload }
  | { kind: "updateFeature"; payload: PersistedUpdateFeaturePayload }
  | {
      kind: "setFeatureSuppression";
      payload: PersistedSetFeatureSuppressionPayload;
    }
  | { kind: "deleteFeature"; payload: PersistedDeleteFeaturePayload }
  | { kind: "deleteTarget"; payload: PersistedDeleteTargetPayload }
  | { kind: "renameBody"; payload: PersistedRenameBodyPayload }
  | { kind: "reorderFeature"; payload: PersistedReorderFeaturePayload }
  | {
      kind: "reorderDocumentHistory";
      payload: PersistedReorderDocumentHistoryPayload;
    }
  | { kind: "setFeatureCursor"; payload: PersistedSetFeatureCursorPayload }
  | {
      kind: "addDocumentVariable";
      payload: PersistedAddDocumentVariablePayload;
    }
  | {
      kind: "updateDocumentVariable";
      payload: PersistedUpdateDocumentVariablePayload;
    };

export interface ModelingOperationHistoryPayload {
  contractVersion: ContractVersion;
  schemaVersion: OperationHistorySchemaVersion;
  documentId: DocumentId;
  baseRepositoryHeads?: readonly string[];
  entries: ModelingOperationHistoryEntry[];
}

export type OperationHistoryValidationResult =
  | { ok: true; payload: ModelingOperationHistoryPayload }
  | { ok: false; reasonCode: string; message: string };

export function createEmptyOperationHistory(
  documentId: DocumentId,
  baseRepositoryHeads?: readonly string[],
): ModelingOperationHistoryPayload {
  const payload: ModelingOperationHistoryPayload = {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: OPERATION_HISTORY_SCHEMA_VERSION,
    documentId,
    entries: [],
  };

  return baseRepositoryHeads
    ? { ...payload, baseRepositoryHeads: [...baseRepositoryHeads] }
    : payload;
}

function normalizeCommitSketchDefinitionForSketchId(
  definition: CommitSketchRequest["definition"],
  sketchId: SketchId,
): CommitSketchRequest["definition"] {
  return {
    ...definition,
    points: definition.points.map((point) => ({
      ...point,
      target: { ...point.target, sketchId },
    })),
    entities: definition.entities.map((entity) => ({
      ...entity,
      target: { ...entity.target, sketchId },
    })),
  };
}

export function createCommitSketchHistoryEntry(
  payload: CommitSketchRequest,
  committedSketchId: SketchId,
): ModelingOperationHistoryEntry {
  return {
    kind: "commitSketch",
    payload: {
      sketchId: committedSketchId,
      sketchLabel: payload.sketchLabel,
      plane: payload.plane,
      definition: normalizeCommitSketchDefinitionForSketchId(
        payload.definition,
        committedSketchId,
      ),
    },
  };
}

export function createCreateFeatureHistoryEntry(
  payload: CreateFeatureRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: "createFeature",
    payload: {
      featureLabel: payload.featureLabel,
      definition: normalizeFeatureDefinitionAuthoredValues(payload.definition),
    },
  };
}

export function createUpdateFeatureHistoryEntry(
  payload: UpdateFeatureRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: "updateFeature",
    payload: {
      featureId: payload.featureId,
      featureLabel: payload.featureLabel,
      definition: normalizeFeatureDefinitionAuthoredValues(payload.definition),
    },
  };
}

export function createDeleteFeatureHistoryEntry(
  payload: DeleteFeatureRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: "deleteFeature",
    payload: {
      featureId: payload.featureId,
    },
  };
}

export function createSetFeatureSuppressionHistoryEntry(
  payload: SetFeatureSuppressionRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: "setFeatureSuppression",
    payload: {
      featureId: payload.featureId,
      suppressed: payload.suppressed,
    },
  };
}

export function createDeleteTargetHistoryEntry(
  payload: DeleteDocumentTargetRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: "deleteTarget",
    payload: {
      target: payload.target,
    },
  };
}

export function createRenameBodyHistoryEntry(
  payload: RenameBodyRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: "renameBody",
    payload: {
      bodyId: payload.bodyId,
      bodyLabel: payload.bodyLabel,
    },
  };
}

export function createReorderFeatureHistoryEntry(
  payload: ReorderFeatureRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: "reorderFeature",
    payload: {
      featureId: payload.featureId,
      beforeFeatureId: payload.beforeFeatureId,
    },
  };
}

export function createReorderDocumentHistoryEntry(
  payload: ReorderDocumentHistoryRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: "reorderDocumentHistory",
    payload: {
      item: payload.item,
      beforeItem: payload.beforeItem,
    },
  };
}

export function createSetFeatureCursorHistoryEntry(
  payload: SetFeatureCursorRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: "setFeatureCursor",
    payload: {
      cursor: payload.cursor,
    },
  };
}

export function createAddDocumentVariableHistoryEntry(
  payload: AddDocumentVariableRequest,
  variableId: NonNullable<AddDocumentVariableRequest["variableId"]>,
): ModelingOperationHistoryEntry {
  return {
    kind: "addDocumentVariable",
    payload: {
      variableId,
      name: payload.name,
      valueText: payload.valueText,
    },
  };
}

export function createUpdateDocumentVariableHistoryEntry(
  payload: UpdateDocumentVariableRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: "updateDocumentVariable",
    payload: {
      variableId: payload.variableId,
      name: payload.name,
      valueText: payload.valueText,
    },
  };
}
