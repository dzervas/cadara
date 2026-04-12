import type {
  CommitSketchRequest,
  CreateFeatureRequest,
  DeleteFeatureRequest,
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
import { isAdvancedParticipantRole, isAdvancedSolidFeatureKind } from '@/contracts/modeling/advanced-solid'

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

type OperationHistoryEntryValidationResult =
  | { ok: true }
  | { ok: false; reasonCode: string; message: string }

export function createEmptyOperationHistory(documentId: DocumentId): ModelingOperationHistoryPayload {
  return {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: OPERATION_HISTORY_SCHEMA_VERSION,
    documentId,
    entries: [],
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
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

function hasForbiddenTransportFields(value: Record<string, unknown>) {
  return (
    'contractVersion' in value
    || 'documentId' in value
    || 'baseRevisionId' in value
    || 'requestId' in value
    || 'solverCorrelation' in value
  )
}

function validateProfileBasedFeatureDefinition(
  definition: Record<string, unknown>,
  index: number,
): OperationHistoryEntryValidationResult {
  if (definition.kind !== 'extrude' && definition.kind !== 'revolve') {
    return { ok: true }
  }

  if (!isRecord(definition.parameters)) {
    return {
      ok: false,
      reasonCode: 'invalid-profile-feature-parameters',
      message: `Operation history entry ${index} has invalid ${definition.kind} parameters.`,
    }
  }

  if ('profile' in definition.parameters) {
    return {
      ok: false,
      reasonCode: 'legacy-profile-parameter',
      message: `Operation history entry ${index} uses legacy ${definition.kind} parameters.profile instead of profiles.`,
    }
  }

  if (!Array.isArray(definition.parameters.profiles) || definition.parameters.profiles.length === 0) {
    return {
      ok: false,
      reasonCode: 'invalid-profile-collection',
      message: `Operation history entry ${index} must include a non-empty ${definition.kind} profiles collection.`,
    }
  }

  const profileKeys = new Set<string>()
  for (const profile of definition.parameters.profiles) {
    if (!isRecord(profile)) {
      return {
        ok: false,
        reasonCode: 'invalid-profile-reference',
        message: `Operation history entry ${index} contains an invalid ${definition.kind} profile reference.`,
      }
    }

    const key = JSON.stringify(profile)
    if (profileKeys.has(key)) {
      return {
        ok: false,
        reasonCode: 'duplicate-profile-reference',
        message: `Operation history entry ${index} contains duplicate ${definition.kind} profile references.`,
      }
    }
    profileKeys.add(key)
  }

  return { ok: true }
}

function validateCommitSketchDefinitionTargets(
  definition: Record<string, unknown>,
  sketchId: string | null,
  index: number,
): OperationHistoryEntryValidationResult {
  if (!Array.isArray(definition.points) || !Array.isArray(definition.entities)) {
    return {
      ok: false,
      reasonCode: 'invalid-commit-sketch-definition',
      message: `Operation history entry ${index} has an invalid commitSketch definition.`,
    }
  }

  let inferredSketchId: string | null = null

  const validateTargetSketchId = (target: unknown, targetLabel: 'point' | 'entity') => {
    if (
      !isRecord(target)
      || (targetLabel === 'point' && target.kind !== 'sketchPoint')
      || (targetLabel === 'entity' && target.kind !== 'sketchEntity')
      || !isString(target.sketchId)
    ) {
      return false
    }

    if (sketchId !== null && target.sketchId !== sketchId) {
      return false
    }

    if (inferredSketchId === null) {
      inferredSketchId = target.sketchId
      return true
    }

    return target.sketchId === inferredSketchId
  }

  for (const point of definition.points) {
    if (!isRecord(point) || !validateTargetSketchId(point.target, 'point')) {
      return {
        ok: false,
        reasonCode: 'inconsistent-commit-sketch-targets',
        message: `Operation history entry ${index} has a commitSketch definition with inconsistent point sketch IDs.`,
      }
    }
  }

  for (const entity of definition.entities) {
    if (!isRecord(entity) || !validateTargetSketchId(entity.target, 'entity')) {
      return {
        ok: false,
        reasonCode: 'inconsistent-commit-sketch-targets',
        message: `Operation history entry ${index} has a commitSketch definition with inconsistent entity sketch IDs.`,
      }
    }
  }

  return { ok: true }
}

function validateAdvancedSolidFeatureDefinition(
  definition: Record<string, unknown>,
  index: number,
): OperationHistoryEntryValidationResult {
  if (!isAdvancedSolidFeatureKind(definition.kind)) {
    return { ok: true }
  }

  if (!isRecord(definition.parameters) || !Array.isArray(definition.parameters.participants)) {
    return {
      ok: false,
      reasonCode: 'invalid-advanced-feature-parameters',
      message: `Operation history entry ${index} has invalid ${definition.kind} advanced feature parameters.`,
    }
  }

  const operationIntent = definition.parameters.operationIntent
  if (
    operationIntent !== undefined
    && operationIntent !== 'create'
    && operationIntent !== 'add'
    && operationIntent !== 'subtract'
    && operationIntent !== 'intersect'
  ) {
    return {
      ok: false,
      reasonCode: 'invalid-advanced-operation-intent',
      message: `Operation history entry ${index} has an invalid ${definition.kind} operation intent.`,
    }
  }

  for (const participant of definition.parameters.participants) {
    if (!isRecord(participant) || !isAdvancedParticipantRole(participant.role) || !Array.isArray(participant.targets)) {
      return {
        ok: false,
        reasonCode: 'invalid-advanced-participant',
        message: `Operation history entry ${index} has an invalid advanced participant.`,
      }
    }
  }

  return { ok: true }
}

function validateFeatureDefinition(
  definition: Record<string, unknown>,
  index: number,
): OperationHistoryEntryValidationResult {
  const profileResult = validateProfileBasedFeatureDefinition(definition, index)
  return profileResult.ok ? validateAdvancedSolidFeatureDefinition(definition, index) : profileResult
}

function validateEntry(value: unknown, index: number): OperationHistoryEntryValidationResult {
  if (!isRecord(value) || !isString(value.kind) || !isRecord(value.payload)) {
    return {
      ok: false,
      reasonCode: 'invalid-entry-shape',
      message: `Operation history entry ${index} is not a typed operation entry.`,
    }
  }

  if (hasForbiddenTransportFields(value.payload)) {
    return {
      ok: false,
      reasonCode: 'transport-field-leak',
      message: `Operation history entry ${index} contains transport-only request metadata.`,
    }
  }

  switch (value.kind) {
    case 'commitSketch':
      if (
        !(isString(value.payload.sketchId) || value.payload.sketchId === null)
        || !isString(value.payload.sketchLabel)
        || !isRecord(value.payload.plane)
        || !isRecord(value.payload.planeTarget)
        || !isRecord(value.payload.definition)
      ) {
        return {
          ok: false,
          reasonCode: 'invalid-commit-sketch-entry',
          message: `Operation history entry ${index} has an invalid commitSketch payload.`,
        }
      }
      return validateCommitSketchDefinitionTargets(value.payload.definition, value.payload.sketchId, index)
    case 'createFeature':
      if (!isRecord(value.payload.definition)) {
        return {
          ok: false,
          reasonCode: 'invalid-create-feature-entry',
          message: `Operation history entry ${index} has an invalid createFeature payload.`,
        }
      }
      return validateFeatureDefinition(value.payload.definition, index)
    case 'updateFeature':
      if (!isString(value.payload.featureId) || !isRecord(value.payload.definition)) {
        return {
          ok: false,
          reasonCode: 'invalid-update-feature-entry',
          message: `Operation history entry ${index} has an invalid updateFeature payload.`,
        }
      }
      return validateFeatureDefinition(value.payload.definition, index)
    case 'deleteFeature':
      if (!isString(value.payload.featureId)) {
        return {
          ok: false,
          reasonCode: 'invalid-delete-feature-entry',
          message: `Operation history entry ${index} has an invalid deleteFeature payload.`,
        }
      }
      return { ok: true }
    case 'reorderFeature':
      if (!isString(value.payload.featureId) || !(isString(value.payload.beforeFeatureId) || value.payload.beforeFeatureId === null)) {
        return {
          ok: false,
          reasonCode: 'invalid-reorder-feature-entry',
          message: `Operation history entry ${index} has an invalid reorderFeature payload.`,
        }
      }
      return { ok: true }
    case 'setFeatureCursor':
      if (
        !isRecord(value.payload.cursor)
        || (
          value.payload.cursor.kind !== 'empty'
          && !(value.payload.cursor.kind === 'feature' && isString(value.payload.cursor.featureId))
        )
      ) {
        return {
          ok: false,
          reasonCode: 'invalid-set-feature-cursor-entry',
          message: `Operation history entry ${index} has an invalid setFeatureCursor payload.`,
        }
      }
      return { ok: true }
    default:
      return {
        ok: false,
        reasonCode: 'unknown-entry-kind',
        message: `Operation history entry ${index} uses an unsupported operation kind.`,
      }
  }
}

export function validateOperationHistoryPayload(value: unknown): OperationHistoryValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      reasonCode: 'invalid-payload-shape',
      message: 'Operation history payload must be an object.',
    }
  }

  if (value.contractVersion !== CONTRACT_VERSION) {
    return {
      ok: false,
      reasonCode: 'unsupported-contract-version',
      message: 'Operation history contract version is not supported.',
    }
  }

  if (value.schemaVersion !== OPERATION_HISTORY_SCHEMA_VERSION) {
    return {
      ok: false,
      reasonCode: 'unsupported-schema-version',
      message: 'Operation history schema version is not supported.',
    }
  }

  if (!isString(value.documentId)) {
    return {
      ok: false,
      reasonCode: 'invalid-document-id',
      message: 'Operation history document identity is invalid.',
    }
  }

  if (!Array.isArray(value.entries)) {
    return {
      ok: false,
      reasonCode: 'invalid-entries',
      message: 'Operation history entries must be an ordered array.',
    }
  }

  for (const [index, entry] of value.entries.entries()) {
    const result = validateEntry(entry, index)
    if (!result.ok) {
      return result
    }
  }

  return {
    ok: true,
    payload: value as unknown as ModelingOperationHistoryPayload,
  }
}
