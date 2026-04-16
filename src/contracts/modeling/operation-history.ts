import type {
  CommitSketchRequest,
  CreateFeatureRequest,
  DeleteFeatureRequest,
  RenameBodyRequest,
  ReorderFeatureRequest,
  SetFeatureCursorRequest,
  UpdateFeatureRequest,
} from '@/contracts/modeling/schema'
import type { DocumentId, SketchId } from '@/contracts/shared/ids'
import {
  CONTRACT_VERSION,
  OPERATION_HISTORY_SCHEMA_VERSION,
  type ContractVersion,
  type OperationHistorySchemaVersion,
} from '@/contracts/shared/versioning'
import { parseOperationHistoryPayload } from '@/contracts/modeling/operation-history.runtime-schema'

export type PersistedCommitSketchPayload = Omit<
  CommitSketchRequest,
  'contractVersion' | 'documentId' | 'baseRevisionId' | 'solverCorrelation'
>
export type PersistedCreateFeaturePayload = Omit<
  CreateFeatureRequest,
  'contractVersion' | 'documentId' | 'baseRevisionId'
>
export type PersistedUpdateFeaturePayload = Omit<
  UpdateFeatureRequest,
  'contractVersion' | 'documentId' | 'baseRevisionId'
>
export type PersistedDeleteFeaturePayload = Omit<
  DeleteFeatureRequest,
  'contractVersion' | 'documentId' | 'baseRevisionId'
>
export type PersistedRenameBodyPayload = Omit<
  RenameBodyRequest,
  'contractVersion' | 'documentId' | 'baseRevisionId'
>
export type PersistedReorderFeaturePayload = Omit<
  ReorderFeatureRequest,
  'contractVersion' | 'documentId' | 'baseRevisionId'
>
export type PersistedSetFeatureCursorPayload = Omit<
  SetFeatureCursorRequest,
  'contractVersion' | 'documentId' | 'baseRevisionId'
>

export type ModelingOperationHistoryEntry =
  | { kind: 'commitSketch'; payload: PersistedCommitSketchPayload }
  | { kind: 'createFeature'; payload: PersistedCreateFeaturePayload }
  | { kind: 'updateFeature'; payload: PersistedUpdateFeaturePayload }
  | { kind: 'deleteFeature'; payload: PersistedDeleteFeaturePayload }
  | { kind: 'renameBody'; payload: PersistedRenameBodyPayload }
  | { kind: 'reorderFeature'; payload: PersistedReorderFeaturePayload }
  | { kind: 'setFeatureCursor'; payload: PersistedSetFeatureCursorPayload }

export interface ModelingOperationHistoryPayload {
  contractVersion: ContractVersion
  schemaVersion: OperationHistorySchemaVersion
  documentId: DocumentId
  entries: ModelingOperationHistoryEntry[]
}

export type OperationHistoryValidationResult =
  | { ok: true; payload: ModelingOperationHistoryPayload }
  | { ok: false; reasonCode: string; message: string }

export function createEmptyOperationHistory(documentId: DocumentId): ModelingOperationHistoryPayload {
  return {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: OPERATION_HISTORY_SCHEMA_VERSION,
    documentId,
    entries: [],
  }
}

function normalizeCommitSketchDefinitionForSketchId(
  definition: CommitSketchRequest['definition'],
  sketchId: SketchId,
): CommitSketchRequest['definition'] {
  return {
    ...definition,
    points: definition.points.map((point) => ({
      ...point,
      target: {
        ...point.target,
        sketchId,
      },
    })),
    entities: definition.entities.map((entity) => ({
      ...entity,
      target: {
        ...entity.target,
        sketchId,
      },
    })),
  }
}

export function createCommitSketchHistoryEntry(
  payload: CommitSketchRequest,
  committedSketchId: SketchId,
): ModelingOperationHistoryEntry {
  return {
    kind: 'commitSketch',
    payload: {
      sketchId: committedSketchId,
      sketchLabel: payload.sketchLabel,
      plane: payload.plane,
      planeTarget: payload.planeTarget,
      planeKey: payload.planeKey,
      definition: normalizeCommitSketchDefinitionForSketchId(payload.definition, committedSketchId),
    },
  }
}

export function createCreateFeatureHistoryEntry(
  payload: CreateFeatureRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: 'createFeature',
    payload: {
      featureLabel: payload.featureLabel,
      definition: payload.definition,
    },
  }
}

export function createUpdateFeatureHistoryEntry(
  payload: UpdateFeatureRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: 'updateFeature',
    payload: {
      featureId: payload.featureId,
      featureLabel: payload.featureLabel,
      definition: payload.definition,
    },
  }
}

export function createDeleteFeatureHistoryEntry(
  payload: DeleteFeatureRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: 'deleteFeature',
    payload: {
      featureId: payload.featureId,
    },
  }
}

export function createRenameBodyHistoryEntry(
  payload: RenameBodyRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: 'renameBody',
    payload: {
      bodyId: payload.bodyId,
      bodyLabel: payload.bodyLabel,
    },
  }
}

export function createReorderFeatureHistoryEntry(
  payload: ReorderFeatureRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: 'reorderFeature',
    payload: {
      featureId: payload.featureId,
      beforeFeatureId: payload.beforeFeatureId,
    },
  }
}

export function createSetFeatureCursorHistoryEntry(
  payload: SetFeatureCursorRequest,
): ModelingOperationHistoryEntry {
  return {
    kind: 'setFeatureCursor',
    payload: {
      cursor: payload.cursor,
    },
  }
}

export function validateOperationHistoryPayload(value: unknown): OperationHistoryValidationResult {
  return parseOperationHistoryPayload(value)
}
