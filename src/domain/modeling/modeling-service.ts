import type { GeometryAssetResolver, ModelingKernelAdapter } from '@/contracts/modeling/adapter'
import type {
  DocumentExportDiagnostic,
  DocumentExportFormat,
  DocumentExportRequest,
  DocumentExportResult,
  DocumentExportSuccessResult,
} from '@/contracts/modeling/export'
import type {
  BodyId,
  ConstructionId,
  DocumentId,
  DocumentVariableId,
  EdgeId,
  FaceId,
  FeatureId,
  FeatureTreeNodeId,
  ObjectTreeNodeId,
  PickId,
  PrimitiveRef,
  RenderableId,
  RevisionId,
  SketchId,
  SnapshotEntityId,
  VertexId,
} from '@/domain/editor/schema'
import {
  getPrimitiveRefKey,
  getPrimitiveRefLabel as formatPrimitiveRefLabel,
} from '@/domain/editor/schema'
import type {
  BodySnapshotRecord,
  CommitSketchResponse,
  CommitSketchRequest,
  AddDocumentVariableRequest,
  AddDocumentVariableResponse,
  ConstructionSnapshotRecord,
  CreateFeatureResponse,
  CreateFeatureRequest,
  DeleteFeatureResponse,
  DeleteFeatureRequest,
  DocumentSnapshot,
  DocumentVariableRecord,
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
  EvaluatePreviewRequest,
  EvaluatePreviewResponse,
  ExtrudeEndCondition,
  ExtrudeFeatureExtent,
  ExtrudeFeatureParameters,
  ExtrudeProfileRef,
  FeatureDefinition,
  FeatureSnapshotRecord,
  FilletEdgeRef,
  FilletFeatureParameters,
  GetDocumentSnapshotResponse,
  GetDocumentSnapshotRequest,
  InvalidReferenceDetailPayload,
  ModelingDiagnostic,
  ModelingDiagnosticDetail,
  ModelingOperationResult,
  MutationRevisionState,
  ObjectTreeNodeRecord,
  KernelDocumentSnapshot,
  PreviewId,
  PreviewFreshness,
  RebuildResult,
  ReferenceRecord,
  RenameBodyRequest,
  RenameBodyResponse,
  ResolvedReferenceRecord,
  ResolveReferenceRequest,
  ResolveReferenceResponse,
  ReorderDocumentHistoryRequest,
  ReorderDocumentHistoryResponse,
  ReorderFeatureRequest,
  ReorderFeatureResponse,
  SketchSnapshotRecord,
  SetFeatureCursorRequest,
  SetFeatureCursorResponse,
  SnapshotMutationBasis,
  SnapshotEntityRecord,
  UpdateFeatureResponse,
  UpdateFeatureRequest,
  UpdateDocumentVariableRequest,
  UpdateDocumentVariableResponse,
  WorkspaceSnapshot,
  PlaneFeatureParameters,
  RevolveEndCondition,
  RevolveAxisRef,
  RevolveFeatureParameters,
  ShellFeatureParameters,
  AdvancedSolidFeatureParameters,
  UpToOffsetDirection,
} from '@/contracts/modeling/schema'
import type { GeometryAssetBlobInput, GeometryAssetDiagnosticDetail, GeometryAssetHash, GeometryAssetRecord } from '@/contracts/modeling/geometry-assets'
import { normalizeGeometryAssetManifest } from '@/contracts/modeling/geometry-assets'
import {
  documentExportRequestSchema,
  documentExportResultSchema,
} from '@/contracts/modeling/export.runtime-schema'
import type { RenderExport, RenderableEntityRecord } from '@/contracts/render/schema'
import { renderExportSchema } from '@/contracts/render/runtime-schema'
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION, isAdvancedParticipantRole, isAdvancedSolidFeatureKind } from '@/contracts/modeling/advanced-solid'
import {
  commitSketchResponseSchema,
  addDocumentVariableResponseSchema,
  createFeatureResponseSchema,
  deleteFeatureResponseSchema,
  evaluatePreviewResponseSchema,
  getDocumentSnapshotResponseSchema,
  kernelDocumentSnapshotSchema,
  renameBodyResponseSchema,
  reorderDocumentHistoryResponseSchema,
  reorderFeatureResponseSchema,
  resolveReferenceResponseSchema,
  setFeatureCursorResponseSchema,
  updateDocumentVariableResponseSchema,
  updateFeatureResponseSchema,
  workspaceSnapshotSchema,
} from '@/contracts/modeling/runtime-schema'
import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredModelDocument,
} from '@/contracts/modeling/authored-document'
import { stableJsonValue } from '@/contracts/modeling/authored-document-serialization'
import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import {
  createCommitSketchHistoryEntry,
  createAddDocumentVariableHistoryEntry,
  createCreateFeatureHistoryEntry,
  createDeleteFeatureHistoryEntry,
  createEmptyOperationHistory,
  createRenameBodyHistoryEntry,
  createReorderDocumentHistoryEntry,
  createReorderFeatureHistoryEntry,
  createSetFeatureCursorHistoryEntry,
  createUpdateDocumentVariableHistoryEntry,
  createUpdateFeatureHistoryEntry,
  type PersistedCommitSketchPayload,
  type ModelingOperationHistoryEntry,
  type ModelingOperationHistoryPayload,
} from '@/contracts/modeling/operation-history'
import { getAuthoredLiteralValue, isExpressionAuthoredValue, type MaybeAuthoredValue } from '@/contracts/modeling/authored-values'
import type {
  ConstraintStatusRecord,
  ConstraintDefinition,
  DimensionStatusRecord,
  DimensionDefinition,
  RegionRecord,
  SketchPoint2D,
  SketchReferenceDefinition,
  SketchSolveDiagnostic,
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
  SketchRecord,
  SketchStyleDefinition,
  SketchStyleRecord,
  SolvedSketchSnapshot,
} from '@/contracts/sketch/schema'
import type {
  DeriveSketchRegionsRequest,
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
  ProjectSketchExternalReferencesRequest,
  ProjectSketchExternalReferencesResponse,
  ResolveSketchReferenceRequest,
  SolveSketchRequest,
  ValidateSketchRequest,
} from '@/contracts/solver/schema'
import type { SketchSolverAdapter as SketchSolverBoundary } from '@/contracts/solver/adapter'
import type { DurableRef } from '@/contracts/shared/references'
import type { ConstraintId, DimensionId, GeometryAssetId, RegionId, RequestId, SketchEntityId, SketchPointId } from '@/contracts/shared/ids'
import type { SketchPlaneDefinition, SketchPlaneSupportRef } from '@/contracts/shared/sketch-plane'
import {
  appErrorFromModelingResult,
  normalizeUnknownError,
  ok,
  err,
  ResultAsync,
  type AppErrorContextEntry,
  type AppResult,
  type AppResultAsync,
} from '@/contracts/errors'
import {
  loadOrCreateOperationHistory,
  type OperationHistoryStore,
} from '@/domain/modeling/modeling-history-persistence'
import {
  isLocalFileSyncDocumentRepository,
  isGeometryAssetDocumentRepository,
  type DocumentRepository,
  type DocumentRepositoryChangeEvent,
  type DocumentRepositoryMetadata,
  type DocumentRepositoryRestoreStatus,
} from '@/domain/modeling/document-repository'
import type { OccTessellationTierId } from '@/domain/modeling/occ/tessellation'
import type { LocalFileBindingMetadata } from '@/domain/modeling/local-file-binding-store'
import type { DocumentSyncWriteStatus } from '@/domain/modeling/document-sync-worker-protocol'
import {
  createLocalAuthoredDocumentPayload,
  type LocalFileSystemFileHandle,
} from '@/lib/local-file-system-access'
import { CADARA_PACKAGE_MIME_TYPE, isCadaraPackagePayload } from '@/lib/cadara-package'
import { hashGeometryAssetBytes } from '@/domain/modeling/geometry-asset-store'
import {
  createBakedMeshGeometryAsset,
} from '@/domain/modeling/baked-mesh-geometry'
import { MeshParseError, parseMeshSourceFile } from '@/domain/modeling/mesh-parser'
import {
  createMeshImportDiagnostic,
  type MeshImportFeatureParameters,
  type MeshImportSourceFormat,
} from '@/contracts/modeling/mesh-import'

import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
  GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
  GEOMETRY_ASSET_SCHEMA_VERSION,
  MESH_IMPORT_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
  REVOLVE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
  STEP_IMPORT_FEATURE_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'

export interface ModelingService {
  readonly currentDocumentId: DocumentId
  readonly sketchSolver: SketchSolverService | null
  subscribeToDocumentChanges(listener: (event: ModelingServiceDocumentChangeEvent) => void): () => void
  getHistoryRestoreState(): Promise<ModelingHistoryRestoreState>
  resetOperationHistory(): void
  setViewportLodTier(tierId: OccTessellationTierId): boolean
  getCurrentDocumentSnapshot(): Promise<DocumentSnapshot>
  createNewDocument(): Promise<ModelingDocumentFileMutationResult>
  importDocument(input: ModelingImportDocumentInput): Promise<ModelingDocumentFileMutationResult>
  importStepFile(input: ModelingImportStepFileInput): Promise<ModelingDocumentFileMutationResult>
  importMeshFile(input: ModelingImportMeshFileInput): Promise<ModelingDocumentFileMutationResult>
  exportCurrentDocument(): Promise<DocumentExportSuccessResult>
  bindLocalFile(input: {
    handle: LocalFileSystemFileHandle
    metadata: LocalFileBindingMetadata
  }): Promise<ModelingDocumentFileMutationResult>
  restoreLocalFileBinding(): Promise<LocalFileBindingMetadata | null>
  getLocalFileSyncStatus(): Promise<DocumentSyncWriteStatus | null>
  subscribeToLocalFileSyncStatus(listener: (status: DocumentSyncWriteStatus) => void): () => void
  commitSketch(input: ModelingCommitSketchInput): AppResultAsync<ModelingCommitSketchResult>
  projectSketchExternalReferences(
    input: ModelingProjectSketchExternalReferencesInput,
  ): Promise<ProjectSketchExternalReferencesResponse>
  addDocumentVariable(input: ModelingAddDocumentVariableInput): AppResultAsync<ModelingDocumentVariableMutationResult>
  updateDocumentVariable(input: ModelingUpdateDocumentVariableInput): AppResultAsync<ModelingDocumentVariableMutationResult>
  createFeature(input: ModelingCreateFeatureInput): AppResultAsync<ModelingFeatureMutationResult>
  updateFeature(input: ModelingUpdateFeatureInput): AppResultAsync<ModelingFeatureMutationResult>
  deleteFeature(input: ModelingDeleteFeatureInput): AppResultAsync<ModelingDeleteFeatureResult>
  renameBody(input: ModelingRenameBodyInput): AppResultAsync<ModelingRenameBodyResult>
  reorderFeature(input: ModelingReorderFeatureInput): AppResultAsync<ModelingReorderFeatureResult>
  reorderDocumentHistory(input: ModelingReorderDocumentHistoryInput): AppResultAsync<ModelingReorderDocumentHistoryResult>
  setFeatureCursor(input: ModelingSetFeatureCursorInput): AppResultAsync<ModelingSetFeatureCursorResult>
  evaluatePreview(input: ModelingEvaluatePreviewInput): Promise<ModelingPreviewResult>
  exportDocument(input: ModelingExportDocumentInput): Promise<ModelingExportDocumentResult>
  resolveReference(target: PrimitiveRef): Promise<ModelingResolvedReferenceResult>
}

export interface ModelingServiceOptions {
  currentDocumentId: DocumentSnapshot['documentId']
  sketchSolver?: SketchSolverBoundary
  operationHistoryStore?: OperationHistoryStore | null
  documentRepository?: DocumentRepository | null
}

export interface ModelingServiceDocumentChangeEvent {
  documentId: DocumentId
  metadata: DocumentRepositoryMetadata
}

export interface ModelingHistoryRestoreDiagnostic {
  reasonCode: string
  message: string
  entryIndex: number | null
}

export type ModelingHistoryRestoreState =
  | { kind: 'pending'; entriesReplayed: number; diagnostics: [] }
  | { kind: 'empty'; entriesReplayed: 0; diagnostics: [] }
  | { kind: 'restored'; entriesReplayed: number; diagnostics: [] }
  | { kind: 'failed'; entriesReplayed: number; diagnostics: ModelingHistoryRestoreDiagnostic[] }

/**
 * Explicit sketch-solver service facade exposed to editor/runtime code.
 * This keeps Phase 3 solver behavior separate from the broader kernel service.
 */
export interface SketchSolverService {
  solveSketch(input: Omit<SolveSketchRequest, 'contractVersion'>): ReturnType<SketchSolverBoundary['solveSketch']>
  validateSketch(input: Omit<ValidateSketchRequest, 'contractVersion'>): ReturnType<SketchSolverBoundary['validateSketch']>
  deriveSketchRegions(
    input: Omit<DeriveSketchRegionsRequest, 'contractVersion'>,
  ): ReturnType<SketchSolverBoundary['deriveSketchRegions']>
  projectExternalReferences(
    input: Omit<ProjectSketchExternalReferencesRequest, 'contractVersion'>,
  ): ReturnType<SketchSolverBoundary['projectExternalReferences']>
  resolveSketchReference(
    input: Omit<ResolveSketchReferenceRequest, 'contractVersion'>,
  ): ReturnType<SketchSolverBoundary['resolveSketchReference']>
  createCommitCorrelation(requestId: RequestId): ModelingCommitSketchCorrelation
}

export interface ModelingFeatureMutationResult {
  revisionId: DocumentSnapshot['revisionId']
  featureId: FeatureId
  revisionState: MutationRevisionState
  rebuildResult: RebuildResult
  changedTargets: PrimitiveRef[]
  diagnostics: ModelingDiagnostic[]
}

export interface ModelingDeleteFeatureResult {
  revisionId: DocumentSnapshot['revisionId']
  deletedFeatureId: FeatureId
  revisionState: MutationRevisionState
  rebuildResult: RebuildResult
  changedTargets: PrimitiveRef[]
  diagnostics: ModelingDiagnostic[]
}

export interface ModelingRenameBodyResult {
  revisionId: DocumentSnapshot['revisionId']
  bodyId: BodyId
  revisionState: MutationRevisionState
  rebuildResult: RebuildResult
  changedTargets: PrimitiveRef[]
  diagnostics: ModelingDiagnostic[]
}

export interface ModelingReorderFeatureResult {
  revisionId: DocumentSnapshot['revisionId']
  featureId: FeatureId
  beforeFeatureId: FeatureId | null
  revisionState: MutationRevisionState
  rebuildResult: RebuildResult
  changedTargets: PrimitiveRef[]
  diagnostics: ModelingDiagnostic[]
}

export interface ModelingReorderDocumentHistoryResult {
  revisionId: DocumentSnapshot['revisionId']
  item: ReorderDocumentHistoryResponse['item']
  beforeItem: ReorderDocumentHistoryResponse['beforeItem']
  revisionState: MutationRevisionState
  rebuildResult: RebuildResult
  changedTargets: PrimitiveRef[]
  diagnostics: ModelingDiagnostic[]
}

export interface ModelingSetFeatureCursorResult {
  revisionId: DocumentSnapshot['revisionId']
  cursor: DocumentFeatureCursor
  revisionState: MutationRevisionState
  rebuildResult: RebuildResult
  changedTargets: PrimitiveRef[]
  diagnostics: ModelingDiagnostic[]
}

export interface ModelingCommitSketchResult {
  revisionId: DocumentSnapshot['revisionId']
  sketchId: SketchId
  revisionState: MutationRevisionState
  rebuildResult: RebuildResult
  changedTargets: PrimitiveRef[]
  diagnostics: ModelingDiagnostic[]
}

export interface ModelingDocumentVariableMutationResult {
  revisionId: DocumentSnapshot['revisionId']
  variableId: DocumentVariableId
  revisionState: MutationRevisionState
  rebuildResult: RebuildResult
  changedTargets: PrimitiveRef[]
  diagnostics: ModelingDiagnostic[]
}

type ModelingMutationBasisInput = Pick<SnapshotMutationBasis, 'baseRepositoryHeads'>

export type ModelingCreateFeatureInput = Omit<CreateFeatureRequest, 'contractVersion' | 'documentId'> & Partial<ModelingMutationBasisInput>
export type ModelingAddDocumentVariableInput = Omit<AddDocumentVariableRequest, 'contractVersion' | 'documentId'> & Partial<ModelingMutationBasisInput>
export type ModelingUpdateFeatureInput = Omit<UpdateFeatureRequest, 'contractVersion' | 'documentId'> & Partial<ModelingMutationBasisInput>
export type ModelingUpdateDocumentVariableInput = Omit<UpdateDocumentVariableRequest, 'contractVersion' | 'documentId'> & Partial<ModelingMutationBasisInput>
export type ModelingDeleteFeatureInput = Omit<DeleteFeatureRequest, 'contractVersion' | 'documentId'> & Partial<ModelingMutationBasisInput>
export type ModelingRenameBodyInput = Omit<RenameBodyRequest, 'contractVersion' | 'documentId'> & Partial<ModelingMutationBasisInput>
export type ModelingReorderFeatureInput = Omit<ReorderFeatureRequest, 'contractVersion' | 'documentId'> & Partial<ModelingMutationBasisInput>
export type ModelingReorderDocumentHistoryInput =
  Omit<ReorderDocumentHistoryRequest, 'contractVersion' | 'documentId'> & Partial<ModelingMutationBasisInput>
export type ModelingSetFeatureCursorInput =
  Omit<SetFeatureCursorRequest, 'contractVersion' | 'documentId'> & {
    persistHistory?: boolean
  } & Partial<ModelingMutationBasisInput>
export type ModelingExportDocumentInput = Omit<DocumentExportRequest, 'contractVersion' | 'documentId'>
export type ModelingExportDocumentResult = DocumentExportResult

export interface ModelingImportDocumentInput {
  document: unknown
  assets?: readonly GeometryAssetBlobInput[]
}

export interface ModelingImportStepFileInput {
  fileName: string
  bytes: Uint8Array
}

export interface ModelingImportMeshFileInput {
  fileName: string
  bytes: Uint8Array
}

export type ModelingDocumentFileMutationResult =
  | { ok: true; revisionId: RevisionId; diagnostics: ModelingDiagnostic[] }
  | { ok: false; diagnostics: ModelingDiagnostic[] }

export interface ModelingCommitSketchCorrelation {
  requestId: RequestId
  projectionRequestId: RequestId
  validationRequestId: RequestId
  solveRequestId: RequestId
  regionRequestId: RequestId
}

export interface ModelingCommitSketchInput extends Omit<CommitSketchRequest, 'contractVersion' | 'documentId'>, Partial<ModelingMutationBasisInput> {
  solverCorrelation: ModelingCommitSketchCorrelation | null
}
export type ModelingEvaluatePreviewInput = Omit<
  EvaluatePreviewRequest,
  'contractVersion' | 'documentId'
>
export type ModelingProjectSketchExternalReferencesInput = Omit<
  ProjectSketchExternalReferencesRequest,
  'contractVersion' | 'documentId'
>

export interface ModelingPreviewResult {
  revisionId: DocumentSnapshot['revisionId']
  previewId: EvaluatePreviewResponse['previewId']
  renderables: RenderExport['records']
  freshness: PreviewFreshness
  stale: boolean
  diagnostics: ModelingDiagnostic[]
}

export interface ModelingResolvedReferenceResult {
  resolution: ResolvedReferenceRecord
  diagnostics: ModelingDiagnostic[]
}

const CONTRACT_VERSION = 'modeling-contract/v1alpha1' as const
const SNAPSHOT_SCHEMA_VERSION = 'document-snapshot/v1alpha1' as const

function withContractVersion<TRequest extends { contractVersion: typeof CONTRACT_VERSION }>(
  input: Omit<TRequest, 'contractVersion'>,
): TRequest {
  return {
    contractVersion: CONTRACT_VERSION,
    ...input,
  } as TRequest
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) {
    return false
  }

  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}

function assertDocumentId(value: unknown): DocumentId {
  if (!isString(value)) {
    throw new Error('Invalid document ID payload.')
  }

  return value as DocumentId
}

function assertDocumentVariableId(value: unknown): DocumentVariableId {
  if (!isString(value)) {
    throw new Error('Invalid document variable ID payload.')
  }

  return value as DocumentVariableId
}

function assertRevisionId(value: unknown): RevisionId {
  if (!isString(value)) {
    throw new Error('Invalid revision ID payload.')
  }

  return value as RevisionId
}

function assertFeatureId(value: unknown): FeatureId {
  if (!isString(value)) {
    throw new Error('Invalid feature ID payload.')
  }

  return value as FeatureId
}

function assertGeometryAssetId(value: unknown): GeometryAssetId {
  if (!isString(value)) {
    throw new Error('Invalid geometry asset ID payload.')
  }

  return value as GeometryAssetId
}

function assertSketchId(value: unknown): SketchId {
  if (!isString(value)) {
    throw new Error('Invalid sketch ID payload.')
  }

  return value as SketchId
}

function assertBodyId(value: unknown): BodyId {
  if (!isString(value)) {
    throw new Error('Invalid body ID payload.')
  }

  return value as BodyId
}

function assertSketchPointId(value: unknown): SketchPointId {
  if (!isString(value)) {
    throw new Error('Invalid sketch point ID payload.')
  }

  return value as SketchPointId
}

function assertSketchEntityId(value: unknown): SketchEntityId {
  if (!isString(value)) {
    throw new Error('Invalid sketch entity ID payload.')
  }

  return value as SketchEntityId
}

function assertConstraintId(value: unknown): ConstraintId {
  if (!isString(value)) {
    throw new Error('Invalid constraint ID payload.')
  }

  return value as ConstraintId
}

function assertDimensionId(value: unknown): DimensionId {
  if (!isString(value)) {
    throw new Error('Invalid dimension ID payload.')
  }

  return value as DimensionId
}

function assertRegionId(value: unknown): RegionId {
  if (!isString(value)) {
    throw new Error('Invalid region ID payload.')
  }

  return value as RegionId
}

function assertPrimitiveRef(value: unknown): PrimitiveRef {
  if (!isRecord(value) || !isString(value.kind)) {
    throw new Error('Invalid primitive reference payload.')
  }

  switch (value.kind) {
    case 'body':
      if (isString(value.bodyId)) {
        return { kind: 'body', bodyId: value.bodyId as BodyId }
      }
      break
    case 'face':
      if (isString(value.bodyId) && isString(value.faceId)) {
        return { kind: 'face', bodyId: value.bodyId as BodyId, faceId: value.faceId as FaceId }
      }
      break
    case 'edge':
      if (isString(value.bodyId) && isString(value.edgeId)) {
        return { kind: 'edge', bodyId: value.bodyId as BodyId, edgeId: value.edgeId as EdgeId }
      }
      break
    case 'vertex':
      if (isString(value.bodyId) && isString(value.vertexId)) {
        return { kind: 'vertex', bodyId: value.bodyId as BodyId, vertexId: value.vertexId as VertexId }
      }
      break
    case 'loop':
      if (isString(value.bodyId) && isString(value.loopId)) {
        return { kind: 'loop', bodyId: value.bodyId as import('@/contracts/shared/ids').BodyId, loopId: value.loopId as import('@/contracts/shared/ids').LoopId }
      }
      break
    case 'sketch':
      if (isString(value.sketchId)) {
        return { kind: 'sketch', sketchId: value.sketchId as SketchId }
      }
      break
    case 'sketchEntity':
      if (isString(value.sketchId) && isString(value.entityId)) {
        return {
          kind: 'sketchEntity',
          sketchId: value.sketchId as SketchId,
          entityId: value.entityId as SketchEntityId,
        }
      }
      break
    case 'sketchPoint':
      if (isString(value.sketchId) && isString(value.pointId)) {
        return {
          kind: 'sketchPoint',
          sketchId: value.sketchId as SketchId,
          pointId: value.pointId as SketchPointId,
        }
      }
      break
    case 'constraint':
      if (isString(value.sketchId) && isString(value.constraintId)) {
        return {
          kind: 'constraint',
          sketchId: value.sketchId as SketchId,
          constraintId: value.constraintId as ConstraintId,
        }
      }
      break
    case 'dimension':
      if (isString(value.sketchId) && isString(value.dimensionId)) {
        return {
          kind: 'dimension',
          sketchId: value.sketchId as SketchId,
          dimensionId: value.dimensionId as DimensionId,
        }
      }
      break
    case 'feature':
      if (isString(value.featureId)) {
        return { kind: 'feature', featureId: value.featureId as FeatureId }
      }
      break
    case 'construction':
      if (isString(value.constructionId)) {
        return { kind: 'construction', constructionId: value.constructionId as ConstructionId }
      }
      break
    case 'region':
      if (isString(value.sketchId) && isString(value.regionId)) {
        return {
          kind: 'region',
          sketchId: value.sketchId as SketchId,
          regionId: value.regionId as RegionId,
        }
      }
      break
  }

  throw new Error('Invalid primitive reference payload.')
}

function assertDurableRef(value: unknown): DurableRef {
  const target = assertPrimitiveRef(value)

  if (target.kind === 'projectedReferenceGeometry' || target.kind === 'sketchExternalReference') {
    throw new Error('Invalid durable reference payload.')
  }

  return target
}

function assertSketchPlaneSupportRef(value: unknown): SketchPlaneSupportRef {
  const target = assertPrimitiveRef(value)

  if (target.kind !== 'construction' && target.kind !== 'face') {
    throw new Error('Invalid sketch-plane support payload.')
  }

  return target
}

function normalizeSketchPlaneKey(value: unknown): SketchPlaneDefinition['key'] {
  if (value === null) {
    return null
  }

  if (value === 'xy' || value === 'yz' || value === 'xz') {
    return value
  }

  throw new Error('Invalid sketch plane key payload.')
}

function normalizeSketchPlaneDefinition(value: unknown): SketchPlaneDefinition {
  if (!isRecord(value) || !isRecord(value.frame)) {
    throw new Error('Invalid sketch plane payload.')
  }

  return {
    support: assertSketchPlaneSupportRef(value.support),
    frame: {
      origin: normalizePoint3(value.frame.origin),
      xAxis: normalizePoint3(value.frame.xAxis),
      yAxis: normalizePoint3(value.frame.yAxis),
      normal: normalizePoint3(value.frame.normal),
      linearUnit: value.frame.linearUnit === 'documentLength' ? value.frame.linearUnit : (() => {
        throw new Error('Invalid sketch plane linear unit payload.')
      })(),
      handedness: value.frame.handedness === 'rightHanded' ? value.frame.handedness : (() => {
        throw new Error('Invalid sketch plane handedness payload.')
      })(),
    },
    key: normalizeSketchPlaneKey(value.key),
  }
}

function normalizePoint3(value: unknown): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => typeof entry !== 'number')) {
    throw new Error('Invalid 3D point payload.')
  }

  return [value[0], value[1], value[2]]
}

function assertExtrudeProfileRef(value: unknown): ExtrudeProfileRef {
  const target = assertPrimitiveRef(value)

  switch (target.kind) {
    case 'region':
    case 'face':
      return target
    default:
      throw new Error('Invalid extrude profile reference payload.')
  }
}

function assertExtrudeProfileRefs(value: unknown, featureLabel: string): readonly [ExtrudeProfileRef, ...ExtrudeProfileRef[]] {
  if (!Array.isArray(value)) {
    throw new Error(`${featureLabel} parameters must include profiles.`)
  }

  if (value.length === 0) {
    throw new Error(`${featureLabel} profiles must include at least one explicit region or planar face reference.`)
  }

  const [first, ...rest] = value.map((entry) => assertExtrudeProfileRef(entry))
  const profiles = [first!, ...rest] as const
  const seen = new Set<string>()

  for (const profile of profiles) {
    const key = getPrimitiveRefKey(profile)
    if (seen.has(key)) {
      throw new Error(`${featureLabel} profiles must not contain duplicate profile references.`)
    }
    seen.add(key)
  }

  return profiles as readonly [ExtrudeProfileRef, ...ExtrudeProfileRef[]]
}

function assertFilletEdgeRef(value: unknown): FilletEdgeRef {
  const target = assertPrimitiveRef(value)

  if (target.kind !== 'edge') {
    throw new Error('Invalid fillet edge reference payload.')
  }

  return target
}

function assertShellFaceRef(value: unknown): Extract<PrimitiveRef, { kind: 'face' }> {
  const target = assertPrimitiveRef(value)

  if (target.kind !== 'face') {
    throw new Error('Invalid shell face reference payload.')
  }

  return target
}

function assertRevolveAxisRef(value: unknown): RevolveAxisRef {
  const target = assertPrimitiveRef(value)

  if (target.kind !== 'edge' && target.kind !== 'construction') {
    throw new Error('Invalid revolve axis reference payload.')
  }

  return target
}

function assertUpToTargetForKind(kind: 'upToFace' | 'upToPart' | 'upToVertex', value: unknown) {
  const target = assertPrimitiveRef(value)
  if (kind === 'upToFace' && target.kind === 'face') {
    return target
  }
  if (kind === 'upToPart' && target.kind === 'body') {
    return target
  }
  if (kind === 'upToVertex' && target.kind === 'vertex') {
    return target
  }

  throw new Error(`Invalid ${kind} target payload.`)
}

function normalizeUpToOffset(value: unknown, field: 'distance' | 'angle') {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value) || !isAuthoredNumberLike(value[field])) {
    throw new Error('Invalid up-to offset payload.')
  }

  if (value.direction !== 'shorten' && value.direction !== 'extend') {
    throw new Error('Invalid up-to offset direction payload.')
  }

  return field === 'distance'
    ? { distance: value.distance as MaybeAuthoredValue<number>, direction: value.direction as UpToOffsetDirection }
    : { angle: value.angle as MaybeAuthoredValue<number>, direction: value.direction as UpToOffsetDirection }
}

function normalizeExtrudeEnd(value: unknown): ExtrudeEndCondition {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('Invalid extrude end condition payload.')
  }

  const direction = value.direction
  if (direction !== 'positive' && direction !== 'negative') {
    throw new Error('Invalid extrude end condition direction payload.')
  }

  const draftAngle = value.draftAngle
  if (draftAngle !== undefined && !isAuthoredNumberLike(draftAngle)) {
    throw new Error('Invalid extrude draft angle payload.')
  }

  switch (value.kind) {
    case 'blind': {
      if (!isAuthoredNumberLike(value.distance)) {
        throw new Error('Invalid extrude blind distance payload.')
      }
      const literalDistance = getAuthoredLiteralValue(value.distance as MaybeAuthoredValue<number>)
      if (literalDistance !== null && literalDistance <= 0) {
        throw new Error('Extrude depth must be positive.')
      }
      return {
        kind: 'blind',
        direction,
        distance: value.distance as MaybeAuthoredValue<number>,
        ...(draftAngle !== undefined ? { draftAngle: draftAngle as MaybeAuthoredValue<number> } : {}),
      }
    }
    case 'throughAll':
      return {
        kind: 'throughAll',
        direction,
        ...(draftAngle !== undefined ? { draftAngle: draftAngle as MaybeAuthoredValue<number> } : {}),
    }
    case 'upToNext': {
      const offset = normalizeUpToOffset(value.offset, 'distance')
      const linearOffset = (offset && 'distance' in offset ? offset : undefined) as Extract<ExtrudeEndCondition, { kind: 'upToNext' }>['offset']
      return {
        kind: 'upToNext',
        direction,
        ...(linearOffset ? { offset: linearOffset } : {}),
        ...(draftAngle !== undefined ? { draftAngle: draftAngle as MaybeAuthoredValue<number> } : {}),
      }
    }
    case 'upToFace':
    case 'upToPart':
    case 'upToVertex': {
      const offset = normalizeUpToOffset(value.offset, 'distance')
      return {
        kind: value.kind,
        direction,
        target: assertUpToTargetForKind(value.kind, value.target),
        ...(offset && 'distance' in offset ? { offset } : {}),
        ...(draftAngle !== undefined ? { draftAngle: draftAngle as MaybeAuthoredValue<number> } : {}),
      } as ExtrudeEndCondition
    }
    default:
      throw new Error('Invalid extrude end condition payload.')
  }
}

function normalizeExtrudeExtent(value: unknown, legacyEndExtent: unknown): ExtrudeFeatureExtent {
  if (value === undefined && isRecord(legacyEndExtent)) {
    return {
      mode: 'oneSide',
      end: normalizeExtrudeEnd(legacyEndExtent),
    }
  }

  if (!isRecord(value)) {
    throw new Error('Invalid extrude extent payload.')
  }

  if (value.mode === 'oneSide') {
    return { mode: 'oneSide', end: normalizeExtrudeEnd(value.end) }
  }

  if (value.mode === 'symmetric') {
    const end = normalizeExtrudeEnd(value.end)
    if (end.kind !== 'blind' && end.kind !== 'throughAll') {
      throw new Error('Symmetric extrude extents only support blind or throughAll end conditions.')
    }
    return { mode: 'symmetric', end }
  }

  if (value.mode === 'twoSide') {
    return {
      mode: 'twoSide',
      firstEnd: normalizeExtrudeEnd(value.firstEnd),
      secondEnd: normalizeExtrudeEnd(value.secondEnd),
    }
  }

  throw new Error('Invalid extrude extent mode payload.')
}

function normalizeExtrudeFeatureParameters(value: unknown): ExtrudeFeatureParameters {
  if (!isRecord(value)) {
    throw new Error('Invalid extrude feature parameters payload.')
  }

  if ('profile' in value || 'depth' in value || 'direction' in value) {
    throw new Error('Legacy extrude profile, depth, and direction aliases are not supported; use profiles and extent.')
  }

  if (!isAuthoredEnumLike(value.operation, ['newBody', 'join', 'cut', 'intersect'])) {
    throw new Error('Invalid extrude operation payload.')
  }

  const extent = normalizeExtrudeExtent(value.extent, value.endExtent)
  const firstEnd = extent.mode === 'twoSide' ? extent.firstEnd : extent.end

  return {
    profiles: assertExtrudeProfileRefs(value.profiles, 'Extrude'),
    startExtent: { kind: 'profilePlane' },
    extent,
    endExtent: firstEnd.kind === 'blind'
      ? {
          kind: 'blind',
          direction: firstEnd.direction,
          distance: firstEnd.distance,
        }
      : undefined,
    operation: value.operation as ExtrudeFeatureParameters['operation'],
    booleanScope:
      isRecord(value.booleanScope) && value.booleanScope.kind === 'targetBody' && isString(value.booleanScope.bodyId)
        ? { kind: 'targetBody', bodyId: value.booleanScope.bodyId as BodyId }
        : isRecord(value.booleanScope) && value.booleanScope.kind === 'targetBodies' && Array.isArray(value.booleanScope.bodyIds)
          ? { kind: 'targetBodies', bodyIds: value.booleanScope.bodyIds.map((bodyId) => assertBodyId(bodyId)) }
          : { kind: 'standalone' },
  }
}

function isAuthoredNumberLike(value: unknown) {
  const literal = getAuthoredLiteralValue(value as MaybeAuthoredValue<unknown>)
  return typeof literal === 'number' || isExpressionAuthoredValue(value)
}

function isAuthoredEnumLike(value: unknown, options: readonly string[]) {
  const literal = getAuthoredLiteralValue(value as MaybeAuthoredValue<unknown>)
  return (typeof literal === 'string' && options.includes(literal)) || isExpressionAuthoredValue(value)
}

function normalizeFilletFeatureParameters(value: unknown): FilletFeatureParameters {
  if (!isRecord(value) || typeof value.radius !== 'number' || !Array.isArray(value.edgeTargets)) {
    throw new Error('Invalid fillet feature parameters payload.')
  }

  if (value.radius <= 0) {
    throw new Error('Fillet radius must be positive.')
  }

  if (value.edgeTargets.length === 0) {
    throw new Error('Fillet requests must include at least one durable edge target.')
  }

  return {
    edgeTargets: value.edgeTargets.map((target) => assertFilletEdgeRef(target)),
    radius: value.radius,
  }
}

function normalizePlaneFeatureParameters(value: unknown): PlaneFeatureParameters {
  if (!isRecord(value) || value.mode !== 'coplanar' || !isRecord(value.reference)) {
    throw new Error('Invalid plane feature parameters payload.')
  }

  const target = assertPrimitiveRef(value.reference.target)

  if (target.kind !== 'construction' && target.kind !== 'face') {
    throw new Error('Plane coplanar references must target a construction plane or planar face.')
  }

  return {
    mode: 'coplanar',
    reference: {
      target,
    },
  }
}

function normalizeRevolveEnd(value: unknown): RevolveEndCondition {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('Invalid revolve end condition payload.')
  }

  if (value.kind === 'full') {
    return { kind: 'full' }
  }

  const direction = value.direction
  if (direction !== 'clockwise' && direction !== 'counterClockwise') {
    throw new Error('Invalid revolve end direction payload.')
  }

  switch (value.kind) {
    case 'blind': {
      if (!isAuthoredNumberLike(value.angle)) {
        throw new Error('Invalid revolve blind angle payload.')
      }
      const literalAngle = getAuthoredLiteralValue(value.angle as MaybeAuthoredValue<number>)
      if (literalAngle !== null && literalAngle <= 0) {
        throw new Error('Revolve angle must be positive.')
      }
      return {
        kind: 'blind',
        direction,
        angle: value.angle as Extract<RevolveEndCondition, { kind: 'blind' }>['angle'],
      }
    }
    case 'upToNext': {
      const offset = normalizeUpToOffset(value.offset, 'angle')
      const angularOffset = (offset && 'angle' in offset ? offset : undefined) as Extract<RevolveEndCondition, { kind: 'upToNext' }>['offset']
      return {
        kind: 'upToNext',
        direction,
        ...(angularOffset ? { offset: angularOffset } : {}),
      }
    }
    case 'upToFace':
    case 'upToPart':
    case 'upToVertex': {
      const offset = normalizeUpToOffset(value.offset, 'angle')
      return {
        kind: value.kind,
        direction,
        target: assertUpToTargetForKind(value.kind, value.target),
        ...(offset && 'angle' in offset ? { offset } : {}),
      } as RevolveEndCondition
    }
    default:
      throw new Error('Invalid revolve end condition payload.')
  }
}

function normalizeRevolveExtent(value: unknown, angleAlias: unknown): RevolveFeatureParameters['extent'] {
  if (isRecord(value) && value.kind === 'angle') {
    if (!isAuthoredNumberLike(value.radians)) {
      throw new Error('Invalid revolve angular extent payload.')
    }
    const literalAngle = getAuthoredLiteralValue(value.radians as MaybeAuthoredValue<number>)
    if (literalAngle !== null && literalAngle <= 0) {
      throw new Error('Revolve angle must be positive.')
    }
    const direction = value.direction === 'clockwise' || value.direction === 'counterClockwise'
      ? value.direction
      : 'counterClockwise'

    return {
      kind: 'angle',
      direction,
      radians: value.radians as MaybeAuthoredValue<number>,
    }
  }

  if (!isRecord(value) && isAuthoredNumberLike(angleAlias)) {
    return {
      mode: 'oneSide',
      end: {
        kind: 'blind',
        direction: 'counterClockwise',
        angle: angleAlias as MaybeAuthoredValue<number>,
      },
    }
  }

  if (!isRecord(value)) {
    throw new Error('Invalid revolve extent payload.')
  }

  if (value.mode === 'oneSide') {
    return { mode: 'oneSide', end: normalizeRevolveEnd(value.end) }
  }

  if (value.mode === 'symmetric') {
    const end = normalizeRevolveEnd(value.end)
    if (end.kind !== 'blind') {
      throw new Error('Symmetric revolve extents only support blind angular end conditions.')
    }
    return { mode: 'symmetric', end }
  }

  if (value.mode === 'twoSide') {
    const firstEnd = normalizeRevolveEnd(value.firstEnd)
    const secondEnd = normalizeRevolveEnd(value.secondEnd)
    if (firstEnd.kind === 'full' || secondEnd.kind === 'full') {
      throw new Error('Two-side revolve extents cannot use full end conditions.')
    }
    return { mode: 'twoSide', firstEnd, secondEnd }
  }

  throw new Error('Invalid revolve extent mode payload.')
}

function isLegacyRevolveAngleExtent(
  extent: RevolveFeatureParameters['extent'],
): extent is Extract<RevolveFeatureParameters['extent'], { kind: 'angle' }> {
  return 'kind' in extent && extent.kind === 'angle'
}

function normalizeRevolveFeatureParameters(value: unknown): RevolveFeatureParameters {
  if (!isRecord(value)) {
    throw new Error('Invalid revolve feature parameters payload.')
  }

  if ('profile' in value) {
    throw new Error('Legacy revolve profile alias is not supported; use profiles.')
  }

  if (!isAuthoredEnumLike(value.operation, ['newBody', 'join', 'cut', 'intersect'])) {
    throw new Error('Invalid revolve operation payload.')
  }

  const extent = normalizeRevolveExtent(value.extent, value.angle)
  let firstEnd: RevolveEndCondition
  if (isLegacyRevolveAngleExtent(extent)) {
    firstEnd = { kind: 'blind', direction: extent.direction, angle: extent.radians }
  } else if (extent.mode === 'twoSide') {
    firstEnd = extent.firstEnd
  } else {
    firstEnd = extent.end
  }

  return {
    profiles: assertExtrudeProfileRefs(value.profiles, 'Revolve'),
    axis: assertRevolveAxisRef(value.axis),
    startAngle: isAuthoredNumberLike(value.startAngle) ? value.startAngle as RevolveFeatureParameters['startAngle'] : 0,
    extent,
    angle: firstEnd.kind === 'blind' ? firstEnd.angle : undefined,
    operation: value.operation as RevolveFeatureParameters['operation'],
    booleanScope:
      isRecord(value.booleanScope) && value.booleanScope.kind === 'targetBody' && isString(value.booleanScope.bodyId)
        ? { kind: 'targetBody', bodyId: value.booleanScope.bodyId as BodyId }
        : isRecord(value.booleanScope) && value.booleanScope.kind === 'targetBodies' && Array.isArray(value.booleanScope.bodyIds)
          ? { kind: 'targetBodies', bodyIds: value.booleanScope.bodyIds.map((bodyId) => assertBodyId(bodyId)) }
          : { kind: 'standalone' },
  }
}

function normalizeShellFeatureParameters(value: unknown): ShellFeatureParameters {
  if (!isRecord(value) || typeof value.thickness !== 'number' || !Array.isArray(value.faceTargets)) {
    throw new Error('Invalid shell feature parameters payload.')
  }

  if (value.thickness <= 0) {
    throw new Error('Shell thickness must be positive.')
  }

  const bodyTarget = assertPrimitiveRef(value.bodyTarget)

  if (bodyTarget.kind !== 'body') {
    throw new Error('Shell bodyTarget must resolve to one durable body.')
  }

  if (value.operation !== 'newBody' && value.operation !== 'join' && value.operation !== 'cut' && value.operation !== 'intersect') {
    throw new Error('Invalid shell operation payload.')
  }

  if (value.faceTargets.length === 0) {
    throw new Error('Shell requests must include at least one removable face target.')
  }

  return {
    bodyTarget,
    faceTargets: value.faceTargets.map((target) => assertShellFaceRef(target)),
    thickness: value.thickness,
    operation: value.operation,
    booleanScope:
      isRecord(value.booleanScope) && value.booleanScope.kind === 'targetBody' && isString(value.booleanScope.bodyId)
        ? { kind: 'targetBody', bodyId: value.booleanScope.bodyId as BodyId }
        : isRecord(value.booleanScope) && value.booleanScope.kind === 'targetBodies' && Array.isArray(value.booleanScope.bodyIds)
          ? { kind: 'targetBodies', bodyIds: value.booleanScope.bodyIds.map((bodyId) => assertBodyId(bodyId)) }
          : { kind: 'standalone' },
  }
}

function normalizeAdvancedSolidFeatureParameters(value: unknown): AdvancedSolidFeatureParameters {
  if (!isRecord(value) || !Array.isArray(value.participants)) {
    throw new Error('Invalid advanced solid feature parameters payload.')
  }

  const operationIntent = value.operationIntent
  if (
    operationIntent !== undefined
    && operationIntent !== 'create'
    && operationIntent !== 'add'
    && operationIntent !== 'subtract'
    && operationIntent !== 'intersect'
  ) {
    throw new Error('Invalid advanced solid operation intent payload.')
  }

  return {
    participants: value.participants.map((participant) => {
      if (!isRecord(participant) || !isAdvancedParticipantRole(participant.role) || !Array.isArray(participant.targets)) {
        throw new Error('Invalid advanced solid participant payload.')
      }

      return {
        role: participant.role,
        targets: participant.targets.map((target) => assertDurableRef(target)),
      }
    }),
    ...(operationIntent ? { operationIntent } : {}),
    ...(isRecord(value.options) ? { options: { ...value.options } } : {}),
  }
}

function normalizeStepImportFeatureParameters(
  value: unknown,
): Extract<FeatureDefinition, { kind: 'stepImport' }>['parameters'] {
  if (!isRecord(value) || !isString(value.label) || !isRecord(value.unit) || !isRecord(value.orientation) || !isRecord(value.placement)) {
    throw new Error('Invalid STEP import feature parameters payload.')
  }

  return {
    assetId: assertGeometryAssetId(value.assetId),
    unit: {
      source: value.unit.source === 'user' ? 'user' : 'file',
      resolvedUnit: value.unit.resolvedUnit === 'millimeter' ? 'millimeter' : 'millimeter',
      scaleToDocument: typeof value.unit.scaleToDocument === 'number' && value.unit.scaleToDocument > 0
        ? value.unit.scaleToDocument
        : 1,
    },
    orientation: {
      upAxis: value.orientation.upAxis === 'y' ? 'y' : 'z',
      handedness: 'rightHanded',
    },
    placement: {
      translation: Array.isArray(value.placement.translation) && value.placement.translation.length === 3
        ? value.placement.translation.map((entry) => Number(entry)) as [number, number, number]
        : [0, 0, 0],
      rotationEulerRadians: Array.isArray(value.placement.rotationEulerRadians) && value.placement.rotationEulerRadians.length === 3
        ? value.placement.rotationEulerRadians.map((entry) => Number(entry)) as [number, number, number]
        : [0, 0, 0],
      scale: typeof value.placement.scale === 'number' && value.placement.scale > 0 ? value.placement.scale : 1,
    },
    label: value.label.trim(),
  }
}

function normalizeMeshImportFeatureParameters(value: unknown): MeshImportFeatureParameters {
  if (!isRecord(value) || !isString(value.label) || !isRecord(value.source) || !isRecord(value.resolvedSettings)) {
    throw new Error('Invalid mesh import feature parameters payload.')
  }

  const sourceFormat = value.source.sourceFormat
  const sourceHash = value.source.sourceHash
  if ((sourceFormat !== 'stl' && sourceFormat !== '3mf') || !isString(sourceHash) || !sourceHash.startsWith('sha256:')) {
    throw new Error('Invalid mesh import source provenance payload.')
  }

  const settings = value.resolvedSettings
  if (!isRecord(settings.unit) || !isRecord(settings.orientation) || !isRecord(settings.placement)) {
    throw new Error('Invalid mesh import resolved settings payload.')
  }

  return {
    assetId: assertGeometryAssetId(value.assetId),
    source: {
      originalFileName: isString(value.source.originalFileName) ? value.source.originalFileName : 'mesh',
      sourceFormat,
      sourceHash: sourceHash as GeometryAssetHash,
      sourceStored: false,
    },
    resolvedSettings: {
      unit: {
        source: 'user',
        resolvedUnit: 'millimeter',
        scaleToDocument: typeof settings.unit.scaleToDocument === 'number' && settings.unit.scaleToDocument > 0
          ? settings.unit.scaleToDocument
          : 1,
      },
      orientation: {
        upAxis: settings.orientation.upAxis === 'y' ? 'y' : 'z',
        handedness: 'rightHanded',
      },
      placement: {
        translation: Array.isArray(settings.placement.translation) && settings.placement.translation.length === 3
          ? settings.placement.translation.map((entry) => Number(entry)) as [number, number, number]
          : [0, 0, 0],
        rotationEulerRadians: Array.isArray(settings.placement.rotationEulerRadians) && settings.placement.rotationEulerRadians.length === 3
          ? settings.placement.rotationEulerRadians.map((entry) => Number(entry)) as [number, number, number]
          : [0, 0, 0],
        scale: typeof settings.placement.scale === 'number' && settings.placement.scale > 0 ? settings.placement.scale : 1,
      },
    },
    label: value.label.trim(),
  }
}

function normalizeFeatureDefinition(value: unknown): FeatureDefinition {
  if (!isRecord(value) || !isString(value.kind) || !isString(value.featureTypeVersion)) {
    throw new Error('Invalid feature definition payload.')
  }

  switch (value.kind) {
    case 'extrude':
      return {
        kind: 'extrude',
        featureTypeVersion:
          value.featureTypeVersion === EXTRUDE_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: normalizeExtrudeFeatureParameters(value.parameters),
      }
    case 'fillet':
      return {
        kind: 'fillet',
        featureTypeVersion:
          value.featureTypeVersion === FILLET_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : FILLET_FEATURE_SCHEMA_VERSION,
        parameters: normalizeFilletFeatureParameters(value.parameters),
      }
    case 'plane':
      return {
        kind: 'plane',
        featureTypeVersion:
          value.featureTypeVersion === PLANE_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : PLANE_FEATURE_SCHEMA_VERSION,
        parameters: normalizePlaneFeatureParameters(value.parameters),
      }
    case 'revolve':
      return {
        kind: 'revolve',
        featureTypeVersion:
          value.featureTypeVersion === REVOLVE_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : REVOLVE_FEATURE_SCHEMA_VERSION,
        parameters: normalizeRevolveFeatureParameters(value.parameters),
      }
    case 'shell':
      return {
        kind: 'shell',
        featureTypeVersion:
          value.featureTypeVersion === SHELL_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : SHELL_FEATURE_SCHEMA_VERSION,
        parameters: normalizeShellFeatureParameters(value.parameters),
      }
    case 'stepImport':
      return {
        kind: 'stepImport',
        featureTypeVersion: STEP_IMPORT_FEATURE_SCHEMA_VERSION,
        parameters: normalizeStepImportFeatureParameters(value.parameters),
      }
    case 'meshImport':
      return {
        kind: 'meshImport',
        featureTypeVersion: MESH_IMPORT_FEATURE_SCHEMA_VERSION,
        parameters: normalizeMeshImportFeatureParameters(value.parameters),
      }
    default:
      if (isAdvancedSolidFeatureKind(value.kind)) {
        return {
          kind: value.kind,
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: normalizeAdvancedSolidFeatureParameters(value.parameters),
        }
      }
      throw new Error('Invalid feature definition kind.')
  }
}

function normalizeDiagnostics(value: unknown): ModelingDiagnostic[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid diagnostics payload.')
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.code) ||
      !isString(entry.message) ||
      (entry.severity !== 'info' && entry.severity !== 'warning' && entry.severity !== 'error')
    ) {
      throw new Error('Invalid diagnostic record.')
    }

    return {
      code: entry.code,
      severity: entry.severity,
      message: entry.message,
      featureId: entry.featureId == null ? null : assertFeatureId(entry.featureId),
      fieldId: entry.fieldId == null ? null : String(entry.fieldId),
      fieldPath: Array.isArray(entry.fieldPath)
        ? entry.fieldPath.map((segment) => typeof segment === 'number' ? segment : String(segment))
        : undefined,
      repairGuidance: entry.repairGuidance == null ? null : String(entry.repairGuidance),
      target: entry.target == null ? null : assertDurableRef(entry.target),
      detail: entry.detail == null ? null : normalizeDiagnosticDetail(entry.detail),
    }
  })
}

function normalizeModelingDocumentSettings(
  value: unknown,
): KernelDocumentSnapshot['settings'] {
  if (
    !isRecord(value)
    || value.linearUnit !== 'millimeter'
    || typeof value.modelingTolerance !== 'number'
    || typeof value.angularToleranceRadians !== 'number'
  ) {
    throw new Error('Invalid modeling document settings payload.')
  }

  return {
    linearUnit: 'millimeter',
    modelingTolerance: value.modelingTolerance,
    angularToleranceRadians: value.angularToleranceRadians,
  }
}

function normalizeModelingKernelCapabilities(
  value: unknown,
): KernelDocumentSnapshot['capabilities'] {
  if (
    !isRecord(value)
    || !Array.isArray(value.supportedFeatureKinds)
    || !Array.isArray(value.previewableFeatureKinds)
    || !Array.isArray(value.supportedProfileKinds)
    || typeof value.supportsFaceBackedSketchPlanes !== 'boolean'
    || typeof value.supportsDurableTopologyNaming !== 'boolean'
  ) {
    throw new Error('Invalid modeling kernel capability payload.')
  }

  return {
    supportedFeatureKinds: value.supportedFeatureKinds as KernelDocumentSnapshot['capabilities']['supportedFeatureKinds'],
    previewableFeatureKinds: value.previewableFeatureKinds as KernelDocumentSnapshot['capabilities']['previewableFeatureKinds'],
    supportedProfileKinds: value.supportedProfileKinds as KernelDocumentSnapshot['capabilities']['supportedProfileKinds'],
    supportsFaceBackedSketchPlanes: value.supportsFaceBackedSketchPlanes,
    supportsDurableTopologyNaming: value.supportsDurableTopologyNaming,
  }
}

function normalizeInvalidReferenceDetail(value: unknown): InvalidReferenceDetailPayload {
  if (!isRecord(value) || !isString(value.reason)) {
    throw new Error('Invalid invalid reference detail payload.')
  }

  return {
    reason: value.reason,
    target: assertDurableRef(value.target),
    ownerFeatureId: value.ownerFeatureId === null ? null : assertFeatureId(value.ownerFeatureId),
    ownerSketchId: value.ownerSketchId === null ? null : assertSketchId(value.ownerSketchId),
    sourceTarget: value.sourceTarget === null ? null : assertDurableRef(value.sourceTarget),
  }
}

function normalizeDiagnosticDetail(value: unknown): ModelingDiagnosticDetail {
  if (!isRecord(value) || !isString(value.kind)) {
    throw new Error('Invalid diagnostic detail payload.')
  }

  switch (value.kind) {
    case 'invalidReference':
      return {
        kind: 'invalidReference',
        reference: normalizeInvalidReferenceDetail(value.reference),
      }
    case 'revisionConflict':
      return {
        kind: 'revisionConflict',
        expectedRevisionId: assertRevisionId(value.expectedRevisionId),
        actualRevisionId: assertRevisionId(value.actualRevisionId),
      }
    case 'stalePreview':
      return {
        kind: 'stalePreview',
        previewId: value.previewId as PreviewId,
        requestedRevisionId: assertRevisionId(value.requestedRevisionId),
        currentRevisionId: assertRevisionId(value.currentRevisionId),
      }
    case 'rebuildFailure':
      if (!Array.isArray(value.affectedFeatureIds) || !Array.isArray(value.affectedTargets)) {
        throw new Error('Invalid rebuild failure detail payload.')
      }

      return {
        kind: 'rebuildFailure',
        affectedFeatureIds: value.affectedFeatureIds.map((featureId) => assertFeatureId(featureId)),
        affectedTargets: value.affectedTargets.map((target) => assertDurableRef(target)),
      }
    case 'geometryAsset':
      if (
        !isString(value.code) ||
        !isString(value.assetId) ||
        !isString(value.hash) ||
        !isString(value.hashPrefix) ||
        typeof value.byteLength !== 'number' ||
        !isString(value.format) ||
        !isString(value.mediaType) ||
        !Array.isArray(value.ownerFeatureIds)
      ) {
        throw new Error('Invalid geometry asset diagnostic detail payload.')
      }

      return {
        kind: 'geometryAsset',
        code: value.code as GeometryAssetDiagnosticDetail['code'],
        assetId: value.assetId as GeometryAssetDiagnosticDetail['assetId'],
        hash: value.hash as GeometryAssetDiagnosticDetail['hash'],
        hashPrefix: value.hashPrefix,
        byteLength: value.byteLength,
        format: value.format as GeometryAssetDiagnosticDetail['format'],
        mediaType: value.mediaType,
        ownerFeatureIds: value.ownerFeatureIds.map((featureId) => assertFeatureId(featureId)),
      }
    default:
      throw new Error('Invalid diagnostic detail kind.')
  }
}

function normalizeRevisionState(value: unknown): MutationRevisionState {
  if (!isRecord(value) || !isString(value.kind)) {
    throw new Error('Invalid revision state payload.')
  }

  switch (value.kind) {
    case 'accepted':
      return {
        kind: 'accepted',
        baseRevisionId: assertRevisionId(value.baseRevisionId),
      }
    case 'conflict':
      return {
        kind: 'conflict',
        expectedRevisionId: assertRevisionId(value.expectedRevisionId),
        actualRevisionId: assertRevisionId(value.actualRevisionId),
      }
    case 'rejected':
      if (!isString(value.reasonCode)) {
        throw new Error('Invalid rejected revision state payload.')
      }

      return {
        kind: 'rejected',
        baseRevisionId: assertRevisionId(value.baseRevisionId),
        reasonCode: value.reasonCode,
      }
    default:
      throw new Error('Invalid revision state kind.')
  }
}

function normalizePreviewFreshness(value: unknown): PreviewFreshness {
  if (!isRecord(value) || !isString(value.kind)) {
    throw new Error('Invalid preview freshness payload.')
  }

  switch (value.kind) {
    case 'fresh':
      return {
        kind: 'fresh',
        baseRevisionId: assertRevisionId(value.baseRevisionId),
      }
    case 'stale':
      return {
        kind: 'stale',
        requestedRevisionId: assertRevisionId(value.requestedRevisionId),
        currentRevisionId: assertRevisionId(value.currentRevisionId),
      }
    default:
      throw new Error('Invalid preview freshness kind.')
  }
}

function normalizeRebuildResult(value: unknown): RebuildResult {
  if (!isRecord(value) || !isString(value.kind) || !Array.isArray(value.diagnostics)) {
    throw new Error('Invalid rebuild result payload.')
  }

  switch (value.kind) {
    case 'rebuilt':
      if (!isString(value.revisionId) || !Array.isArray(value.invalidatedTargets)) {
        throw new Error('Invalid rebuilt result payload.')
      }

      return {
        kind: 'rebuilt',
        revisionId: assertRevisionId(value.revisionId),
        invalidatedTargets: normalizeChangedTargets(value.invalidatedTargets),
        diagnostics: normalizeDiagnostics(value.diagnostics),
      }
    case 'skipped':
      if (
        value.reasonCode !== 'revisionConflict' &&
        value.reasonCode !== 'validationRejected' &&
        value.reasonCode !== 'noOp'
      ) {
        throw new Error('Invalid skipped rebuild result payload.')
      }

      return {
        kind: 'skipped',
        reasonCode: value.reasonCode,
        invalidatedTargets: [],
        diagnostics: normalizeDiagnostics(value.diagnostics),
      }
    case 'failed':
      if (!isString(value.revisionId) || !isString(value.reasonCode) || !Array.isArray(value.invalidatedTargets)) {
        throw new Error('Invalid failed rebuild result payload.')
      }

      return {
        kind: 'failed',
        revisionId: assertRevisionId(value.revisionId),
        reasonCode: value.reasonCode,
        invalidatedTargets: normalizeChangedTargets(value.invalidatedTargets),
        diagnostics: normalizeDiagnostics(value.diagnostics),
      }
    default:
      throw new Error('Unsupported rebuild result payload.')
  }
}

function normalizeFeatureTree(value: unknown): DocumentSnapshot['featureTree'] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid feature tree payload.')
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !isString(entry.description) ||
      (entry.kind !== 'plane' && entry.kind !== 'sketch' && entry.kind !== 'feature')
    ) {
      throw new Error('Invalid feature tree record.')
    }

    return {
      id: entry.id as FeatureTreeNodeId,
      label: entry.label,
      description: entry.description,
      kind: entry.kind,
      target: assertDurableRef(entry.target),
      ownerFeatureId: entry.ownerFeatureId === null ? null : assertFeatureId(entry.ownerFeatureId),
      ownerSketchId: entry.ownerSketchId === null ? null : assertSketchId(entry.ownerSketchId),
      sourceFeatureId: entry.sourceFeatureId === null ? null : assertFeatureId(entry.sourceFeatureId),
    }
  })
}

function normalizeDocumentPresentation(value: unknown): DocumentSnapshot['presentation'] {
  if (!isRecord(value)) {
    throw new Error('Invalid document presentation payload.')
  }

  return {
    featureTree: normalizeFeatureTree(value.featureTree),
    objects: normalizeObjects(value.objects),
    documentHistory: normalizeDocumentHistory(value.documentHistory),
    entities: normalizeEntities(value.entities),
  }
}

function normalizeObjects(value: unknown): ObjectTreeNodeRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid object tree payload.')
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !isString(entry.description) ||
      (entry.kind !== 'body' && entry.kind !== 'construction' && entry.kind !== 'sketch')
    ) {
      throw new Error('Invalid object tree record.')
    }

    return {
      id: entry.id as ObjectTreeNodeId,
      label: entry.label,
      description: entry.description,
      kind: entry.kind,
      target: assertDurableRef(entry.target),
      ownerBodyId: entry.ownerBodyId === null ? null : assertBodyId(entry.ownerBodyId),
      ownerFeatureId: entry.ownerFeatureId === null ? null : assertFeatureId(entry.ownerFeatureId),
      ownerSketchId: entry.ownerSketchId === null ? null : assertSketchId(entry.ownerSketchId),
    }
  })
}

function normalizeDocumentHistory(value: unknown): DocumentHistoryItemRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid document history payload.')
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !isString(entry.description) ||
      (entry.kind !== 'sketch' && entry.kind !== 'feature')
    ) {
      throw new Error('Invalid document history item.')
    }

    if (entry.kind === 'sketch') {
      const sketchId = assertSketchId(entry.sketchId)
      return {
        id: entry.id as DocumentHistoryItemRecord['id'],
        label: entry.label,
        description: entry.description,
        kind: 'sketch',
        target: { kind: 'sketch', sketchId },
        sketchId,
        featureId: null,
      }
    }

    const featureId = assertFeatureId(entry.featureId)
    return {
      id: entry.id as DocumentHistoryItemRecord['id'],
      label: entry.label,
      description: entry.description,
      kind: 'feature',
      target: { kind: 'feature', featureId },
      sketchId: null,
      featureId,
    }
  })
}

function normalizeOwnership(value: unknown) {
  if (!isRecord(value)) {
    throw new Error('Invalid ownership payload.')
  }

  return {
    ownerDocumentId: assertDocumentId(value.ownerDocumentId),
    ownerRevisionId: assertRevisionId(value.ownerRevisionId),
    ownerFeatureId: value.ownerFeatureId === null ? null : assertFeatureId(value.ownerFeatureId),
    ownerSketchId: value.ownerSketchId === null ? null : assertSketchId(value.ownerSketchId),
    ownerBodyId: value.ownerBodyId === null ? null : assertBodyId(value.ownerBodyId),
  }
}

function normalizeReferences(value: unknown): ReferenceRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid reference payload.')
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !(entry.ownerFeatureId === null || isString(entry.ownerFeatureId))
    ) {
      throw new Error('Invalid reference record.')
    }

    return {
      id: entry.id as ReferenceRecord['id'],
      label: entry.label,
      target: assertDurableRef(entry.target),
      ownerDocumentId: assertDocumentId(entry.ownerDocumentId),
      ownerRevisionId: assertRevisionId(entry.ownerRevisionId),
      ownerFeatureId: entry.ownerFeatureId as FeatureId | null,
      ownerSketchId: entry.ownerSketchId === null ? null : assertSketchId(entry.ownerSketchId),
      ownerBodyId: entry.ownerBodyId === null ? null : assertBodyId(entry.ownerBodyId),
      invalidation: entry.invalidation === null ? null : normalizeInvalidReferenceDetail(entry.invalidation),
    }
  })
}

function normalizeDocumentVariables(value: unknown): DocumentVariableRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid document variables payload.')
  }

  return value.map((entry) => {
    if (!isRecord(entry) || !isString(entry.variableId) || !isString(entry.name) || !isString(entry.valueText)) {
      throw new Error('Invalid document variable record.')
    }

    return {
      variableId: assertDocumentVariableId(entry.variableId),
      name: entry.name,
      valueText: entry.valueText,
    }
  })
}

function normalizeRenderables(value: unknown): RenderableEntityRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid renderable payload.')
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !isRecord(entry.binding) ||
      !isString(entry.binding.pickId) ||
      typeof entry.binding.pickPriority !== 'number' ||
      !(entry.binding.topology === null ||
        entry.binding.topology === 'face' ||
        entry.binding.topology === 'edge' ||
        entry.binding.topology === 'vertex') ||
      (entry.binding.semanticClass !== 'bodyFace' &&
        entry.binding.semanticClass !== 'planarFace' &&
        entry.binding.semanticClass !== 'featureEdge' &&
        entry.binding.semanticClass !== 'featureVertex' &&
        entry.binding.semanticClass !== 'region' &&
        entry.binding.semanticClass !== 'sketchCurve' &&
        entry.binding.semanticClass !== 'sketchPoint' &&
        entry.binding.semanticClass !== 'construction') ||
      !isRecord(entry.geometry) ||
      !isString(entry.geometry.kind)
    ) {
      throw new Error('Invalid renderable record.')
    }

    const geometry: RenderableEntityRecord['geometry'] = (() => {
      switch (entry.geometry.kind) {
        case 'mesh': {
          if (
            !Array.isArray(entry.geometry.vertexPositions) ||
            !Array.isArray(entry.geometry.triangleIndices) ||
            !(
              entry.geometry.vertexNormals === null ||
              Array.isArray(entry.geometry.vertexNormals)
            )
          ) {
            throw new Error('Invalid mesh geometry payload.')
          }

          if (entry.geometry.vertexPositions.length === 0) {
            throw new Error('Mesh geometry must contain at least one vertex position.')
          }

          const vertexPositions = entry.geometry.vertexPositions
          const vertexNormals = entry.geometry.vertexNormals
          const triangleIndices = entry.geometry.triangleIndices

          if (
            vertexNormals !== null
            && vertexNormals.length !== vertexPositions.length
          ) {
            throw new Error('Mesh vertex normals must align 1:1 with vertex positions.')
          }

          return {
            kind: 'mesh' as const,
            vertexPositions: vertexPositions.map((point) => {
              if (
                !Array.isArray(point) ||
                point.length !== 3 ||
                point.some((component) => typeof component !== 'number')
              ) {
                throw new Error('Invalid mesh vertex position payload.')
              }

              return point as [number, number, number]
            }),
            vertexNormals:
              vertexNormals === null
                ? null
                : vertexNormals.map((normal) => {
                    if (
                      !Array.isArray(normal) ||
                      normal.length !== 3 ||
                      normal.some((component) => typeof component !== 'number')
                    ) {
                      throw new Error('Invalid mesh vertex normal payload.')
                    }

                    return normal as [number, number, number]
                  }),
            triangleIndices: triangleIndices.map((triangle) => {
              if (
                !Array.isArray(triangle) ||
                triangle.length !== 3 ||
                triangle.some((index) => typeof index !== 'number' || !Number.isInteger(index))
              ) {
                throw new Error('Invalid mesh triangle index payload.')
              }

              if (
                triangle.some((index) =>
                  index < 0 || index >= vertexPositions.length,
                )
              ) {
                throw new Error('Mesh triangle indices must reference existing vertex positions.')
              }

              return triangle as [number, number, number]
            }),
          }
        }
        case 'polyline': {
          if (!Array.isArray(entry.geometry.points) || typeof entry.geometry.isClosed !== 'boolean') {
            throw new Error('Invalid polyline geometry payload.')
          }

          if (!entry.geometry.isClosed && entry.geometry.points.length < 2) {
            throw new Error('Open polylines must contain at least 2 points.')
          }

          if (entry.geometry.isClosed && entry.geometry.points.length < 3) {
            throw new Error('Closed polylines must contain at least 3 points.')
          }

          let previousPointKey: string | null = null
          const distinctPointKeys = new Set<string>()

          return {
            kind: 'polyline' as const,
            points: entry.geometry.points.map((point) => {
              if (
                !Array.isArray(point) ||
                point.length !== 3 ||
                point.some((component) => typeof component !== 'number')
              ) {
                throw new Error('Invalid polyline point payload.')
              }

              const pointKey = `${point[0]}:${point[1]}:${point[2]}`

              if (previousPointKey === pointKey) {
                throw new Error('Polyline points must not contain consecutive duplicates.')
              }

              previousPointKey = pointKey
              distinctPointKeys.add(pointKey)

              return point as [number, number, number]
            }),
            isClosed: entry.geometry.isClosed,
          }
        }
        case 'marker': {
          if (
            !Array.isArray(entry.geometry.position) ||
            entry.geometry.position.length !== 3 ||
            entry.geometry.position.some((component) => typeof component !== 'number') ||
            typeof entry.geometry.displayRadius !== 'number'
          ) {
            throw new Error('Invalid marker geometry payload.')
          }

          if (entry.geometry.displayRadius <= 0) {
            throw new Error('Marker display radius must be strictly positive.')
          }

          return {
            kind: 'marker' as const,
            position: entry.geometry.position as [number, number, number],
            displayRadius: entry.geometry.displayRadius,
          }
        }
        default:
          throw new Error('Invalid renderable geometry kind.')
      }
    })()

    const target = assertPrimitiveRef(entry.binding.target)
    if (
      geometry.kind === 'polyline' &&
      geometry.isClosed &&
      new Set(geometry.points.map((point) => `${point[0]}:${point[1]}:${point[2]}`)).size < 3
    ) {
      throw new Error('Closed polylines must contain at least 3 distinct positions.')
    }

    if (entry.binding.topology === 'face' && target.kind !== 'face') {
      throw new Error('Face bindings must target durable faces.')
    }

    if (entry.binding.topology === 'edge' && target.kind !== 'edge') {
      throw new Error('Edge bindings must target durable edges.')
    }

    if (entry.binding.topology === 'vertex' && target.kind !== 'vertex') {
      throw new Error('Vertex bindings must target durable vertices.')
    }

    if (entry.binding.topology === null && target.kind !== 'construction' && target.kind !== 'region' && target.kind !== 'sketchEntity' && target.kind !== 'sketchPoint') {
      throw new Error('Non-topological render bindings must target durable construction, region, or sketch refs.')
    }

    if (
      (entry.binding.semanticClass === 'bodyFace' || entry.binding.semanticClass === 'planarFace') &&
      (entry.binding.topology !== 'face' || target.kind !== 'face')
    ) {
      throw new Error('Face semantic classes must bind to durable faces.')
    }

    if (entry.binding.semanticClass === 'featureEdge' && (entry.binding.topology !== 'edge' || target.kind !== 'edge')) {
      throw new Error('featureEdge bindings must bind to durable edges.')
    }

    if (
      entry.binding.semanticClass === 'featureVertex' &&
      (entry.binding.topology !== 'vertex' || target.kind !== 'vertex')
    ) {
      throw new Error('featureVertex bindings must bind to durable vertices.')
    }

    if (
      entry.binding.semanticClass === 'region' &&
      (entry.binding.topology !== null || target.kind !== 'region')
    ) {
      throw new Error('region bindings must target durable sketch regions without topology.')
    }

    if (
      entry.binding.semanticClass === 'construction' &&
      (entry.binding.topology !== null || target.kind !== 'construction')
    ) {
      throw new Error('construction bindings must target durable construction refs without topology.')
    }

    if (
      entry.binding.semanticClass === 'sketchCurve' &&
      (entry.binding.topology !== null || target.kind !== 'sketchEntity')
    ) {
      throw new Error('sketchCurve bindings must target durable sketch entities without topology.')
    }

    if (
      entry.binding.semanticClass === 'sketchPoint' &&
      (entry.binding.topology !== null || target.kind !== 'sketchPoint')
    ) {
      throw new Error('sketchPoint bindings must target durable sketch points without topology.')
    }

    const binding: RenderableEntityRecord['binding'] = (() => {
      switch (entry.binding.semanticClass) {
        case 'bodyFace':
        case 'planarFace':
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: 'face' }>,
            topology: 'face',
            semanticClass: entry.binding.semanticClass,
          }
        case 'featureEdge':
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: 'edge' }>,
            topology: 'edge',
            semanticClass: 'featureEdge',
          }
        case 'featureVertex':
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: 'vertex' }>,
            topology: 'vertex',
            semanticClass: 'featureVertex',
          }
        case 'construction':
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: 'construction' }>,
            topology: null,
            semanticClass: 'construction',
          }
        case 'region':
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: 'region' }>,
            topology: null,
            semanticClass: 'region',
          }
        case 'sketchCurve':
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: 'sketchEntity' }>,
            topology: null,
            semanticClass: 'sketchCurve',
          }
        case 'sketchPoint':
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: 'sketchPoint' }>,
            topology: null,
            semanticClass: 'sketchPoint',
          }
      }
    })()

    return {
      id: entry.id as RenderableId,
      label: entry.label,
      ownerBodyId: entry.ownerBodyId === null ? null : assertBodyId(entry.ownerBodyId),
      ownerFeatureId: entry.ownerFeatureId === null ? null : assertFeatureId(entry.ownerFeatureId),
      binding,
      geometry,
    }
  })
}

function normalizeRenderExport(value: unknown): RenderExport {
  if (!isRecord(value) || value.schemaVersion !== 'render-export/v1alpha1') {
    throw new Error('Invalid render export payload.')
  }

  return {
    schemaVersion: value.schemaVersion,
    records: normalizeRenderables(value.records),
  }
}

function normalizeSketches(value: unknown): SketchSnapshotRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid sketch snapshot payload.')
  }

  return value.map((entry) => {
    if (!isRecord(entry) || !isString(entry.sketchId) || !isString(entry.label)) {
      throw new Error('Invalid sketch snapshot record.')
    }

    return {
      ...normalizeOwnership(entry),
      sketchId: assertSketchId(entry.sketchId),
      label: entry.label,
      plane: normalizeSketchPlaneDefinition(entry.plane),
      planeTarget: assertSketchPlaneSupportRef(entry.planeTarget),
      planeKey: normalizeSketchPlaneKey(entry.planeKey),
      sketch: normalizeSketchRecord(entry.sketch),
    }
  })
}

function normalizeSketchRecord(value: unknown): SketchRecord {
  if (!isRecord(value) || !isString(value.sketchId) || !isString(value.label)) {
    throw new Error('Invalid sketch record payload.')
  }

  return {
    ...normalizeOwnership(value),
    sketchId: assertSketchId(value.sketchId),
    label: value.label,
    planeSupport: assertSketchPlaneSupportRef(value.planeSupport),
    definition: normalizeSketchDefinition(value.definition),
    solvedSnapshot: normalizeSolvedSketchSnapshot(value.solvedSnapshot),
    projectedReferences: normalizeProjectedSketchReferences(value.projectedReferences ?? []),
    regions: normalizeRegionRecords(value.regions),
  }
}

function normalizeProjectedSketchReferences(value: unknown): ProjectedSketchReferenceRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid projected sketch reference payload.')
  }

  return value.map((reference) => {
    if (!isRecord(reference) || !isString(reference.referenceId) || !isString(reference.status) || !Array.isArray(reference.geometry) || !Array.isArray(reference.diagnostics)) {
      throw new Error('Invalid projected sketch reference record.')
    }

    return {
      referenceId: reference.referenceId as import('@/contracts/shared/ids').ReferenceId,
      status:
        reference.status === 'projected'
        || reference.status === 'unsupportedSource'
        || reference.status === 'missingSource'
        || reference.status === 'outOfPlane'
        || reference.status === 'ambiguous'
          ? reference.status
          : (() => { throw new Error('Invalid projected sketch reference status payload.') })(),
      geometry: reference.geometry.map((geometry) => normalizeProjectedSketchReferenceGeometry(geometry)),
      diagnostics: reference.diagnostics.map((diagnostic) => normalizeSketchSolveDiagnostic(diagnostic)),
    }
  })
}

function normalizeProjectedSketchReferenceGeometry(value: unknown): ProjectedSketchReferenceGeometry {
  if (!isRecord(value) || !isString(value.geometryId) || !isString(value.kind)) {
    throw new Error('Invalid projected sketch geometry payload.')
  }

  const geometryId = value.geometryId as import('@/contracts/shared/ids').ProjectedGeometryId

  if (value.kind === 'point') {
    return {
      geometryId,
      kind: 'point',
      position: normalizePoint2D(value.position, 'Invalid projected point payload.'),
    }
  }

  if (value.kind === 'lineSegment') {
    return {
      geometryId,
      kind: 'lineSegment',
      startPosition: normalizePoint2D(value.startPosition, 'Invalid projected line start payload.'),
      endPosition: normalizePoint2D(value.endPosition, 'Invalid projected line end payload.'),
    }
  }

  if (value.kind === 'circle') {
    if (typeof value.radius !== 'number') {
      throw new Error('Invalid projected circle radius payload.')
    }
    return {
      geometryId,
      kind: 'circle',
      centerPosition: normalizePoint2D(value.centerPosition, 'Invalid projected circle center payload.'),
      radius: value.radius,
    }
  }

  if (value.kind === 'arc') {
    if (value.sweepDirection !== 'clockwise' && value.sweepDirection !== 'counterClockwise') {
      throw new Error('Invalid projected arc sweep payload.')
    }
    return {
      geometryId,
      kind: 'arc',
      centerPosition: normalizePoint2D(value.centerPosition, 'Invalid projected arc center payload.'),
      startPosition: normalizePoint2D(value.startPosition, 'Invalid projected arc start payload.'),
      endPosition: normalizePoint2D(value.endPosition, 'Invalid projected arc end payload.'),
      sweepDirection: value.sweepDirection,
    }
  }

  if (value.kind === 'spline') {
    if (!Array.isArray(value.fitPoints) || (value.degree !== 2 && value.degree !== 3) || typeof value.isClosed !== 'boolean') {
      throw new Error('Invalid projected spline payload.')
    }
    return {
      geometryId,
      kind: 'spline',
      fitPoints: value.fitPoints.map((point) => normalizePoint2D(point, 'Invalid projected spline point payload.')),
      degree: value.degree,
      isClosed: value.isClosed,
    }
  }

  throw new Error('Invalid projected sketch geometry kind payload.')
}

function normalizePoint2D(value: unknown, errorMessage: string): SketchPoint2D {
  if (!Array.isArray(value) || value.length !== 2 || value.some((component) => typeof component !== 'number')) {
    throw new Error(errorMessage)
  }

  return value as unknown as SketchPoint2D
}

function normalizeSketchDefinition(value: unknown): SketchDefinition {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 'sketch-definition/v1alpha1' ||
    !Array.isArray(value.referenceIds) ||
    !Array.isArray(value.references) ||
    !Array.isArray(value.pointIds) ||
    !Array.isArray(value.points) ||
    !Array.isArray(value.entityIds) ||
    !Array.isArray(value.entities) ||
    !Array.isArray(value.constraintIds) ||
    !Array.isArray(value.constraints) ||
    !Array.isArray(value.dimensionIds) ||
    !Array.isArray(value.dimensions)
  ) {
    throw new Error('Invalid sketch definition payload.')
  }

  return {
    schemaVersion: value.schemaVersion,
    referenceIds: value.referenceIds.map((referenceId) => {
      if (!isString(referenceId)) {
        throw new Error('Invalid sketch reference ID payload.')
      }

      return referenceId as import('@/contracts/shared/ids').ReferenceId
    }),
    references: value.references.map((reference) => normalizeSketchReferenceDefinition(reference)),
    pointIds: value.pointIds.map((pointId) => assertSketchPointId(pointId)),
    points: value.points.map((point) => normalizeSketchPointDefinition(point)),
    entityIds: value.entityIds.map((entityId) => assertSketchEntityId(entityId)),
    entities: value.entities.map((entity) => normalizeSketchEntityDefinition(entity)),
    constraintIds: value.constraintIds.map((constraintId) => assertConstraintId(constraintId)),
    constraints: value.constraints.map((constraint) => normalizeConstraintDefinition(constraint)),
    dimensionIds: value.dimensionIds.map((dimensionId) => assertDimensionId(dimensionId)),
    dimensions: value.dimensions.map((dimension) => normalizeDimensionDefinition(dimension)),
    styleIds: Array.isArray(value.styleIds)
      ? value.styleIds.map((styleId) => {
          if (!isString(styleId)) {
            throw new Error('Invalid sketch style ID payload.')
          }

          return styleId as import('@/contracts/shared/ids').SketchStyleId
        })
      : [],
    styles: Array.isArray(value.styles)
      ? value.styles.map((style) => normalizeSketchStyleRecord(style))
      : [],
    svgRenderingEnabled: typeof value.svgRenderingEnabled === 'boolean' ? value.svgRenderingEnabled : true,
    derivedRelationships: Array.isArray(value.derivedRelationships)
      ? value.derivedRelationships.map((relationship) => normalizeSketchDerivationDefinition(relationship))
      : [],
    authoringOperations: Array.isArray(value.authoringOperations)
      ? value.authoringOperations as SketchDefinition['authoringOperations']
      : [],
  }
}

function normalizeSketchStyleDefinition(value: unknown): SketchStyleDefinition | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new Error('Invalid sketch style definition payload.')
  }

  return {
    ...(value.fillMode === 'none' || value.fillMode === 'solid' || value.fillMode === 'gradient' ? { fillMode: value.fillMode } : {}),
    ...(isString(value.fillColor) ? { fillColor: value.fillColor } : {}),
    ...(isString(value.gradientStartColor) ? { gradientStartColor: value.gradientStartColor } : {}),
    ...(isString(value.gradientEndColor) ? { gradientEndColor: value.gradientEndColor } : {}),
    ...(typeof value.strokeEnabled === 'boolean' ? { strokeEnabled: value.strokeEnabled } : {}),
    ...(isString(value.strokeColor) ? { strokeColor: value.strokeColor } : {}),
    ...(typeof value.strokeWidth === 'number' ? { strokeWidth: value.strokeWidth } : {}),
    ...(value.strokeCap === 'butt' || value.strokeCap === 'round' || value.strokeCap === 'square' ? { strokeCap: value.strokeCap } : {}),
    ...(value.strokeJoin === 'miter' || value.strokeJoin === 'round' || value.strokeJoin === 'bevel' ? { strokeJoin: value.strokeJoin } : {}),
    ...(typeof value.strokeMiterLimit === 'number' ? { strokeMiterLimit: value.strokeMiterLimit } : {}),
    ...(typeof value.strokeDashSize === 'number' ? { strokeDashSize: value.strokeDashSize } : {}),
    ...(typeof value.strokeGapSize === 'number' ? { strokeGapSize: value.strokeGapSize } : {}),
  }
}

function normalizeSketchStyleRecord(value: unknown): SketchStyleRecord {
  if (!isRecord(value) || !isString(value.styleId) || !isString(value.label) || !isRecord(value.target)) {
    throw new Error('Invalid sketch style record payload.')
  }

  const target = value.target.kind === 'entity' && isString(value.target.entityId)
    ? { kind: 'entity' as const, entityId: assertSketchEntityId(value.target.entityId) }
    : value.target.kind === 'region' && isString(value.target.regionId)
      ? { kind: 'region' as const, regionId: value.target.regionId as RegionId }
      : null

  if (!target || !isRecord(value.fill) || !isRecord(value.stroke)) {
    throw new Error('Invalid sketch style record payload.')
  }

  return {
    styleId: value.styleId as import('@/contracts/shared/ids').SketchStyleId,
    label: value.label,
    target,
    fill: normalizeSketchStyleFill(value.fill),
    stroke: normalizeSketchStyleStroke(value.stroke),
  }
}

function normalizeSketchStyleFill(value: Record<string, unknown>): SketchStyleRecord['fill'] {
  if (value.kind === 'none') {
    return { kind: 'none' }
  }

  if (value.kind === 'solid' && isString(value.color) && typeof value.opacity === 'number') {
    return { kind: 'solid', color: value.color, opacity: value.opacity }
  }

  if (value.kind === 'gradient' && isRecord(value.gradient)) {
    const gradient = value.gradient
    if (
      gradient.kind === 'linear'
      && typeof gradient.angleRadians === 'number'
      && isString(gradient.startColor)
      && typeof gradient.startOpacity === 'number'
      && isString(gradient.endColor)
      && typeof gradient.endOpacity === 'number'
    ) {
      return {
        kind: 'gradient',
        gradient: {
          kind: 'linear',
          angleRadians: gradient.angleRadians,
          startColor: gradient.startColor,
          startOpacity: gradient.startOpacity,
          endColor: gradient.endColor,
          endOpacity: gradient.endOpacity,
        },
      }
    }
  }

  throw new Error('Invalid sketch style fill payload.')
}

function normalizeSketchStyleStroke(value: Record<string, unknown>): SketchStyleRecord['stroke'] {
  if (
    !isString(value.color)
    || typeof value.opacity !== 'number'
    || typeof value.width !== 'number'
    || (value.lineCap !== 'butt' && value.lineCap !== 'round' && value.lineCap !== 'square')
    || (value.lineJoin !== 'miter' && value.lineJoin !== 'round' && value.lineJoin !== 'bevel')
    || typeof value.miterLimit !== 'number'
  ) {
    throw new Error('Invalid sketch style stroke payload.')
  }

  return {
    color: value.color,
    opacity: value.opacity,
    width: value.width,
    lineCap: value.lineCap,
    lineJoin: value.lineJoin,
    miterLimit: value.miterLimit,
    ...(typeof value.dashSize === 'number' ? { dashSize: value.dashSize } : {}),
    ...(typeof value.gapSize === 'number' ? { gapSize: value.gapSize } : {}),
  }
}

function normalizeSketchDerivationOutput(value: unknown): SketchDerivationDefinition['outputs'][number] {
  if (
    !isRecord(value) ||
    !isString(value.seedEntityId) ||
    !isString(value.outputEntityId) ||
    typeof value.instanceIndex !== 'number' ||
    !Array.isArray(value.seedPointIds) ||
    !Array.isArray(value.outputPointIds)
  ) {
    throw new Error('Invalid sketch derivation output payload.')
  }

  return {
    seedEntityId: assertSketchEntityId(value.seedEntityId),
    outputEntityId: assertSketchEntityId(value.outputEntityId),
    instanceIndex: value.instanceIndex,
    seedPointIds: value.seedPointIds.map((pointId) => assertSketchPointId(pointId)),
    outputPointIds: value.outputPointIds.map((pointId) => assertSketchPointId(pointId)),
  }
}

function normalizeSketchDerivationDefinition(value: unknown): SketchDerivationDefinition {
  if (
    !isRecord(value) ||
    !isString(value.derivationId) ||
    !value.derivationId.startsWith('sketch_derivation_') ||
    !isString(value.label) ||
    !isString(value.kind) ||
    !Array.isArray(value.seedEntityIds) ||
    !Array.isArray(value.outputs)
  ) {
    throw new Error('Invalid sketch derivation definition payload.')
  }

  const base = {
    derivationId: value.derivationId,
    label: value.label,
    seedEntityIds: value.seedEntityIds.map((entityId) => assertSketchEntityId(entityId)),
    outputs: value.outputs.map((output) => normalizeSketchDerivationOutput(output)),
  }

  if (value.kind === 'mirror') {
    if (!isRecord(value.mirrorReference) || value.mirrorReference.kind !== 'lineEntity') {
      throw new Error('Invalid sketch mirror derivation payload.')
    }

    return {
      ...base,
      kind: 'mirror',
      mirrorReference: {
        kind: 'lineEntity',
        entityId: assertSketchEntityId(value.mirrorReference.entityId),
      },
    }
  }

  if (value.kind === 'linearPattern') {
    return {
      ...base,
      kind: 'linearPattern',
      vector: normalizePoint2D(value.vector, 'Invalid sketch linear pattern vector payload.'),
      instanceCount: typeof value.instanceCount === 'number' ? value.instanceCount : 0,
    }
  }

  if (value.kind === 'circularPattern') {
    return {
      ...base,
      kind: 'circularPattern',
      center: normalizePoint2D(value.center, 'Invalid sketch circular pattern center payload.'),
      angleRadians: typeof value.angleRadians === 'number' ? value.angleRadians : Number.NaN,
      instanceCount: typeof value.instanceCount === 'number' ? value.instanceCount : 0,
    }
  }

  if (value.kind === 'transform') {
    return {
      ...base,
      kind: 'transform',
      origin: normalizePoint2D(value.origin, 'Invalid sketch transform origin payload.'),
      translation: normalizePoint2D(value.translation, 'Invalid sketch transform translation payload.'),
      rotationRadians: typeof value.rotationRadians === 'number' ? value.rotationRadians : Number.NaN,
      scale: typeof value.scale === 'number' ? value.scale : Number.NaN,
    }
  }

  throw new Error('Invalid sketch derivation kind payload.')
}

function normalizeSketchReferenceDefinition(value: unknown): SketchReferenceDefinition {
  if (!isRecord(value) || !isString(value.referenceId) || !isString(value.kind) || !isString(value.label)) {
    throw new Error('Invalid sketch reference definition payload.')
  }

  if (value.kind === 'constructionPlane') {
    if (!isRecord(value.source) || value.projectionMode !== 'coplanar') {
      throw new Error('Invalid construction-plane sketch reference payload.')
    }

    const source = assertPrimitiveRef(value.source)

    if (source.kind !== 'construction') {
      throw new Error('Construction-plane sketch reference must target construction geometry.')
    }

    return {
      referenceId: value.referenceId as import('@/contracts/shared/ids').ReferenceId,
      kind: 'constructionPlane',
      label: value.label,
      source,
      projectionMode: value.projectionMode,
    }
  }

  if (value.kind === 'modelReference') {
    if (
      !isRecord(value.source) ||
      (value.projectionMode !== 'projectAlongPlaneNormal' &&
        value.projectionMode !== 'useExistingCoplanarGeometry')
    ) {
      throw new Error('Invalid model sketch reference payload.')
    }

    const source = assertPrimitiveRef(value.source)

    if (source.kind !== 'face' && source.kind !== 'edge' && source.kind !== 'vertex') {
      throw new Error('Model sketch reference must target a face, edge, or vertex.')
    }

    return {
      referenceId: value.referenceId as import('@/contracts/shared/ids').ReferenceId,
      kind: 'modelReference',
      label: value.label,
      source,
      projectionMode: value.projectionMode,
    }
  }

  throw new Error('Invalid sketch reference definition kind.')
}

function normalizeSketchPointDefinition(value: unknown): SketchPointDefinition {
  if (
    !isRecord(value) ||
    !isString(value.pointId) ||
    !isString(value.label) ||
    !isRecord(value.target) ||
    !Array.isArray(value.position) ||
    value.position.length !== 2 ||
    value.position.some((component) => typeof component !== 'number') ||
    typeof value.isConstruction !== 'boolean'
  ) {
    throw new Error('Invalid sketch point definition payload.')
  }

  return {
    pointId: assertSketchPointId(value.pointId),
    label: value.label,
    target: assertPrimitiveRef(value.target) as SketchPointDefinition['target'],
    position: value.position as unknown as SketchPointDefinition['position'],
    isConstruction: value.isConstruction,
    style: normalizeSketchStyleDefinition(value.style),
  }
}

function normalizeSketchEntityDefinition(value: unknown): SketchEntityDefinition {
  if (!isRecord(value) || !isString(value.kind) || !isString(value.entityId) || !isString(value.label)) {
    throw new Error('Invalid sketch entity definition payload.')
  }

  if (value.kind === 'lineSegment') {
    if (
      !isRecord(value.target) ||
      !isString(value.startPointId) ||
      !isString(value.endPointId) ||
      typeof value.isConstruction !== 'boolean'
    ) {
      throw new Error('Invalid line segment definition payload.')
    }

    return {
      kind: 'lineSegment',
      entityId: assertSketchEntityId(value.entityId),
      label: value.label,
      target: assertPrimitiveRef(value.target) as SketchEntityDefinition['target'],
      isConstruction: value.isConstruction,
      startPointId: assertSketchPointId(value.startPointId),
      endPointId: assertSketchPointId(value.endPointId),
      style: normalizeSketchStyleDefinition(value.style),
    }
  }

  if (value.kind === 'circle') {
    if (
      !isRecord(value.target) ||
      !isString(value.centerPointId) ||
      typeof value.radius !== 'number' ||
      typeof value.isConstruction !== 'boolean'
    ) {
      throw new Error('Invalid circle definition payload.')
    }

    return {
      kind: 'circle',
      entityId: assertSketchEntityId(value.entityId),
      label: value.label,
      target: assertPrimitiveRef(value.target) as SketchEntityDefinition['target'],
      isConstruction: value.isConstruction,
      centerPointId: assertSketchPointId(value.centerPointId),
      radius: value.radius,
      style: normalizeSketchStyleDefinition(value.style),
    }
  }

  if (value.kind === 'point') {
    if (
      !isRecord(value.target) ||
      !isString(value.pointId) ||
      typeof value.isConstruction !== 'boolean'
    ) {
      throw new Error('Invalid point definition payload.')
    }

    return {
      kind: 'point',
      entityId: assertSketchEntityId(value.entityId),
      label: value.label,
      target: assertPrimitiveRef(value.target) as SketchEntityDefinition['target'],
      isConstruction: value.isConstruction,
      pointId: assertSketchPointId(value.pointId),
      style: normalizeSketchStyleDefinition(value.style),
    }
  }

  if (value.kind === 'arc') {
    if (
      !isRecord(value.target) ||
      !isString(value.centerPointId) ||
      !isString(value.startPointId) ||
      !isString(value.endPointId) ||
      (value.sweepDirection !== 'clockwise' && value.sweepDirection !== 'counterClockwise') ||
      typeof value.isConstruction !== 'boolean'
    ) {
      throw new Error('Invalid arc definition payload.')
    }

    return {
      kind: 'arc',
      entityId: assertSketchEntityId(value.entityId),
      label: value.label,
      target: assertPrimitiveRef(value.target) as SketchEntityDefinition['target'],
      isConstruction: value.isConstruction,
      centerPointId: assertSketchPointId(value.centerPointId),
      startPointId: assertSketchPointId(value.startPointId),
      endPointId: assertSketchPointId(value.endPointId),
      sweepDirection: value.sweepDirection,
      style: normalizeSketchStyleDefinition(value.style),
    }
  }

  throw new Error('Invalid sketch entity definition kind.')
}

function normalizeConstraintDefinition(value: unknown): ConstraintDefinition {
  if (!isRecord(value) || !isString(value.constraintId) || !isString(value.kind) || !isString(value.label)) {
    throw new Error('Invalid constraint definition payload.')
  }

  if (value.kind === 'coincident') {
    if (
      !Array.isArray(value.pointIds) ||
      value.pointIds.length !== 2
    ) {
      throw new Error('Invalid coincident constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'coincident',
      label: value.label,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
      ],
    }
  }

  if (value.kind === 'horizontal' || value.kind === 'vertical') {
    if (!isString(value.entityId)) {
      throw new Error('Invalid axis constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: value.kind,
      label: value.label,
      entityId: assertSketchEntityId(value.entityId),
    }
  }

  if (value.kind === 'fixPoint') {
    if (
      !isString(value.pointId)
      || !Array.isArray(value.position)
      || value.position.length !== 2
      || typeof value.position[0] !== 'number'
      || typeof value.position[1] !== 'number'
    ) {
      throw new Error('Invalid fix point constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'fixPoint',
      label: value.label,
      pointId: assertSketchPointId(value.pointId),
      position: [value.position[0], value.position[1]],
    }
  }

  if (value.kind === 'angle') {
    if (
      !Array.isArray(value.pointIds)
      || value.pointIds.length !== 3
      || typeof value.valueRadians !== 'number'
    ) {
      throw new Error('Invalid angle constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'angle',
      label: value.label,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
        assertSketchPointId(value.pointIds[2]),
      ],
      valueRadians: value.valueRadians,
    }
  }

  if (
    value.kind === 'parallel'
    || value.kind === 'perpendicular'
    || value.kind === 'equalLength'
    || value.kind === 'tangent'
    || value.kind === 'concentric'
  ) {
    if (!Array.isArray(value.entityIds) || value.entityIds.length !== 2) {
      throw new Error('Invalid two-line constraint payload.')
    }

    const constraintId = assertConstraintId(value.constraintId)
    const entityIds = [
      assertSketchEntityId(value.entityIds[0]),
      assertSketchEntityId(value.entityIds[1]),
    ] as const
    const label = value.label

    const base = {
      constraintId,
      label,
      entityIds,
    }

    if (value.kind === 'tangent') {
      if (value.relation !== 'external' && value.relation !== 'internal') {
        throw new Error('Invalid tangent constraint payload.')
      }

      return {
        ...base,
        kind: 'tangent',
        relation: value.relation,
      }
    }

    return {
      ...base,
      kind: value.kind,
    }
  }

  if (value.kind === 'coincidentProjectedPoint') {
    if (!isRecord(value.point) || !isRecord(value.projectedPoint)) {
      throw new Error('Invalid projected coincident constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'coincidentProjectedPoint',
      label: value.label,
      point: normalizeLocalPointConstraintOperand(value.point),
      projectedPoint: normalizeProjectedGeometryConstraintOperand(value.projectedPoint),
    }
  }

  if (value.kind === 'pointOnProjectedCurve') {
    if (!isRecord(value.point) || !isRecord(value.projectedCurve)) {
      throw new Error('Invalid point-on-projected-curve constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'pointOnProjectedCurve',
      label: value.label,
      point: normalizeLocalPointConstraintOperand(value.point),
      projectedCurve: normalizeProjectedGeometryConstraintOperand(value.projectedCurve),
    }
  }

  if (value.kind === 'midpoint') {
    if (!isRecord(value.point) || !isRecord(value.line)) {
      throw new Error('Invalid midpoint constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'midpoint',
      label: value.label,
      point: normalizeLocalPointConstraintOperand(value.point),
      line: normalizeLocalEntityConstraintOperand(value.line),
    }
  }

  if (value.kind === 'midpointProjectedLine') {
    if (!isRecord(value.point) || !isRecord(value.projectedLine)) {
      throw new Error('Invalid projected midpoint constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'midpointProjectedLine',
      label: value.label,
      point: normalizeLocalPointConstraintOperand(value.point),
      projectedLine: normalizeProjectedGeometryConstraintOperand(value.projectedLine),
    }
  }

  if (value.kind === 'pointOnCurve') {
    if (!isRecord(value.point) || !isRecord(value.curve)) {
      throw new Error('Invalid point-on-curve constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'pointOnCurve',
      label: value.label,
      point: normalizeLocalPointConstraintOperand(value.point),
      curve: normalizeLocalEntityConstraintOperand(value.curve),
    }
  }

  if (value.kind === 'parallelProjectedLine' || value.kind === 'perpendicularProjectedLine') {
    if (!isRecord(value.line) || !isRecord(value.projectedLine)) {
      throw new Error('Invalid projected line relationship constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: value.kind,
      label: value.label,
      line: normalizeLocalEntityConstraintOperand(value.line),
      projectedLine: normalizeProjectedGeometryConstraintOperand(value.projectedLine),
    }
  }

  if (value.kind === 'tangentProjectedCurve') {
    if (
      !isRecord(value.curve) ||
      !isRecord(value.projectedCurve) ||
      (value.relation !== 'external' && value.relation !== 'internal')
    ) {
      throw new Error('Invalid projected tangent constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'tangentProjectedCurve',
      label: value.label,
      curve: normalizeLocalEntityConstraintOperand(value.curve),
      projectedCurve: normalizeProjectedGeometryConstraintOperand(value.projectedCurve),
      relation: value.relation,
    }
  }

  if (value.kind === 'concentricProjectedCurve') {
    if (!isRecord(value.curve) || !isRecord(value.projectedCurve)) {
      throw new Error('Invalid projected concentric constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'concentricProjectedCurve',
      label: value.label,
      curve: normalizeLocalEntityConstraintOperand(value.curve),
      projectedCurve: normalizeProjectedGeometryConstraintOperand(value.projectedCurve),
    }
  }

  if (value.kind === 'normal') {
    if (!isRecord(value.line) || !isRecord(value.curve) || !isRecord(value.point)) {
      throw new Error('Invalid normal constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'normal',
      label: value.label,
      line: normalizeLocalEntityConstraintOperand(value.line),
      curve: normalizeLocalEntityConstraintOperand(value.curve),
      point: normalizeLocalPointConstraintOperand(value.point),
    }
  }

  if (value.kind === 'normalProjectedCurve') {
    if (!isRecord(value.line) || !isRecord(value.projectedCurve) || !isRecord(value.point)) {
      throw new Error('Invalid projected normal constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'normalProjectedCurve',
      label: value.label,
      line: normalizeLocalEntityConstraintOperand(value.line),
      projectedCurve: normalizeProjectedGeometryConstraintOperand(value.projectedCurve),
      point: normalizeLocalPointConstraintOperand(value.point),
    }
  }

  if (value.kind === 'symmetric') {
    if (!Array.isArray(value.pointIds) || value.pointIds.length !== 2 || !isRecord(value.axis)) {
      throw new Error('Invalid symmetric constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'symmetric',
      label: value.label,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
      ],
      axis: normalizeLocalEntityConstraintOperand(value.axis),
    }
  }

  if (value.kind === 'symmetricProjectedLine') {
    if (!Array.isArray(value.pointIds) || value.pointIds.length !== 2 || !isRecord(value.projectedLine)) {
      throw new Error('Invalid projected symmetric constraint payload.')
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: 'symmetricProjectedLine',
      label: value.label,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
      ],
      projectedLine: normalizeProjectedGeometryConstraintOperand(value.projectedLine),
    }
  }

  throw new Error('Invalid constraint definition kind.')
}

function normalizeLocalPointConstraintOperand(
  value: Record<string, unknown>,
): Extract<ConstraintDefinition, { kind: 'coincidentProjectedPoint' }>['point'] {
  if (value.kind !== 'localPoint' || !isString(value.pointId)) {
    throw new Error('Invalid local point constraint operand payload.')
  }

  return {
    kind: 'localPoint',
    pointId: assertSketchPointId(value.pointId),
  }
}

function normalizeLocalEntityConstraintOperand(
  value: Record<string, unknown>,
): Extract<ConstraintDefinition, { kind: 'parallelProjectedLine' }>['line'] {
  if (value.kind !== 'localEntity' || !isString(value.entityId)) {
    throw new Error('Invalid local entity constraint operand payload.')
  }

  return {
    kind: 'localEntity',
    entityId: assertSketchEntityId(value.entityId),
  }
}

function normalizeProjectedGeometryConstraintOperand(
  value: Record<string, unknown>,
): Extract<ConstraintDefinition, { kind: 'coincidentProjectedPoint' }>['projectedPoint'] {
  if (!isRecord(value.reference) || value.kind !== 'projectedGeometry') {
    throw new Error('Invalid projected geometry constraint operand payload.')
  }

  const reference = value.reference
  if (
    !isString(reference.kind) ||
    (
      reference.kind !== 'projectedPoint' &&
      reference.kind !== 'projectedLineSegment' &&
      reference.kind !== 'projectedCircle' &&
      reference.kind !== 'projectedArc' &&
      reference.kind !== 'projectedSpline'
    ) ||
    !isString(reference.referenceId) ||
    !isString(reference.geometryId)
  ) {
    throw new Error('Invalid projected geometry reference constraint operand payload.')
  }

  return {
    kind: 'projectedGeometry',
    reference: {
      kind: reference.kind,
      referenceId: reference.referenceId as import('@/contracts/shared/ids').ReferenceId,
      geometryId: reference.geometryId as import('@/contracts/shared/ids').ProjectedGeometryId,
    },
  }
}

function normalizeDimensionDefinition(value: unknown): DimensionDefinition {
  if (!isRecord(value) || !isString(value.dimensionId) || !isString(value.kind) || !isString(value.label)) {
    throw new Error('Invalid dimension definition payload.')
  }

  if (value.kind === 'distance') {
    if (
      (value.axis !== 'aligned' && value.axis !== 'horizontal' && value.axis !== 'vertical') ||
      !Array.isArray(value.pointIds) ||
      value.pointIds.length !== 2 ||
      typeof value.value !== 'number'
    ) {
      throw new Error('Invalid distance dimension payload.')
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: 'distance',
      label: value.label,
      axis: value.axis,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
      ],
      value: value.value,
    }
  }

  if (value.kind === 'circleRadius') {
    if (!isString(value.entityId) || typeof value.value !== 'number') {
      throw new Error('Invalid circle radius dimension payload.')
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: 'circleRadius',
      label: value.label,
      entityId: assertSketchEntityId(value.entityId),
      value: value.value,
    }
  }

  if (value.kind === 'horizontalDistance' || value.kind === 'verticalDistance') {
    if (
      !Array.isArray(value.pointIds)
      || value.pointIds.length !== 2
      || typeof value.value !== 'number'
    ) {
      throw new Error('Invalid directional distance dimension payload.')
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: value.kind,
      label: value.label,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
      ],
      value: value.value,
    }
  }

  if (value.kind === 'arcStartPointCoincident' || value.kind === 'arcEndPointCoincident') {
    if (!isString(value.entityId) || !isString(value.pointId)) {
      throw new Error('Invalid arc endpoint coincidence dimension payload.')
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: value.kind,
      label: value.label,
      entityId: assertSketchEntityId(value.entityId),
      pointId: assertSketchPointId(value.pointId),
    }
  }

  throw new Error('Invalid dimension definition kind.')
}

function normalizeSolvedSketchSnapshot(value: unknown): SolvedSketchSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 'solved-sketch/v1alpha1' ||
    !isRecord(value.status) ||
    !isString(value.status.solveState) ||
    !isString(value.status.constraintState) ||
    !Array.isArray(value.solvedEntities) ||
    !Array.isArray(value.solvedPoints) ||
    !Array.isArray(value.constraintStatuses) ||
    !Array.isArray(value.dimensionStatuses) ||
    !Array.isArray(value.diagnostics)
  ) {
    throw new Error('Invalid solved sketch snapshot payload.')
  }

  return {
    schemaVersion: value.schemaVersion,
    status: {
      solveState:
        value.status.solveState === 'notEvaluated'
        || value.status.solveState === 'solved'
        || value.status.solveState === 'partiallySolved'
        || value.status.solveState === 'failed'
          ? value.status.solveState
          : (() => { throw new Error('Invalid solved sketch solve state payload.') })(),
      constraintState:
        value.status.constraintState === 'unknown'
        || value.status.constraintState === 'underConstrained'
        || value.status.constraintState === 'wellConstrained'
        || value.status.constraintState === 'overConstrained'
        || value.status.constraintState === 'inconsistent'
          ? value.status.constraintState
          : (() => { throw new Error('Invalid solved sketch constraint state payload.') })(),
    },
    solvedEntities: value.solvedEntities.map((entity) => normalizeSolvedSketchEntityGeometry(entity)),
    solvedPoints: value.solvedPoints.map((point) => {
      if (
        !isRecord(point) ||
        !isString(point.pointId) ||
        !isRecord(point.target) ||
        !Array.isArray(point.solvedPosition) ||
        point.solvedPosition.length !== 2 ||
        point.solvedPosition.some((component) => typeof component !== 'number')
      ) {
        throw new Error('Invalid solved sketch point payload.')
      }

      return {
        pointId: assertSketchPointId(point.pointId),
        target: assertPrimitiveRef(point.target) as SolvedSketchSnapshot['solvedPoints'][number]['target'],
        solvedPosition: point.solvedPosition as unknown as SolvedSketchSnapshot['solvedPoints'][number]['solvedPosition'],
      }
    }),
    constraintStatuses: value.constraintStatuses.map((status) => normalizeConstraintStatusRecord(status)),
    dimensionStatuses: value.dimensionStatuses.map((status) => normalizeDimensionStatusRecord(status)),
    diagnostics: value.diagnostics.map((diagnostic) => normalizeSketchSolveDiagnostic(diagnostic)),
  }
}

function normalizeSolvedSketchEntityGeometry(value: unknown): SolvedSketchSnapshot['solvedEntities'][number] {
  if (!isRecord(value) || !isString(value.entityId) || !isString(value.kind)) {
    throw new Error('Invalid solved sketch entity payload.')
  }

  if (value.kind === 'point') {
    if (!Array.isArray(value.solvedPosition) || value.solvedPosition.length !== 2 || value.solvedPosition.some((component) => typeof component !== 'number')) {
      throw new Error('Invalid solved point-entity payload.')
    }

    return {
      entityId: assertSketchEntityId(value.entityId),
      kind: 'point',
      solvedPosition: value.solvedPosition as unknown as [number, number],
    }
  }

  if (value.kind === 'lineSegment') {
    if (
      !Array.isArray(value.startPosition) ||
      value.startPosition.length !== 2 ||
      value.startPosition.some((component) => typeof component !== 'number') ||
      !Array.isArray(value.endPosition) ||
      value.endPosition.length !== 2 ||
      value.endPosition.some((component) => typeof component !== 'number')
    ) {
      throw new Error('Invalid solved line-segment payload.')
    }

    return {
      entityId: assertSketchEntityId(value.entityId),
      kind: 'lineSegment',
      startPosition: value.startPosition as unknown as [number, number],
      endPosition: value.endPosition as unknown as [number, number],
    }
  }

  if (value.kind === 'circle') {
    if (
      !Array.isArray(value.centerPosition) ||
      value.centerPosition.length !== 2 ||
      value.centerPosition.some((component) => typeof component !== 'number') ||
      typeof value.solvedRadius !== 'number'
    ) {
      throw new Error('Invalid solved circle payload.')
    }

    return {
      entityId: assertSketchEntityId(value.entityId),
      kind: 'circle',
      centerPosition: value.centerPosition as unknown as [number, number],
      solvedRadius: value.solvedRadius,
    }
  }

  if (value.kind === 'arc') {
    if (
      !Array.isArray(value.centerPosition) ||
      value.centerPosition.length !== 2 ||
      value.centerPosition.some((component) => typeof component !== 'number') ||
      !Array.isArray(value.startPosition) ||
      value.startPosition.length !== 2 ||
      value.startPosition.some((component) => typeof component !== 'number') ||
      !Array.isArray(value.endPosition) ||
      value.endPosition.length !== 2 ||
      value.endPosition.some((component) => typeof component !== 'number') ||
      (value.sweepDirection !== 'clockwise' && value.sweepDirection !== 'counterClockwise')
    ) {
      throw new Error('Invalid solved arc payload.')
    }

    return {
      entityId: assertSketchEntityId(value.entityId),
      kind: 'arc',
      centerPosition: value.centerPosition as unknown as [number, number],
      startPosition: value.startPosition as unknown as [number, number],
      endPosition: value.endPosition as unknown as [number, number],
      sweepDirection: value.sweepDirection,
    }
  }

  throw new Error('Invalid solved sketch entity kind.')
}

function normalizeConstraintStatusRecord(value: unknown): ConstraintStatusRecord {
  if (
    !isRecord(value) ||
    !isString(value.constraintId) ||
    (value.status !== 'satisfied' && value.status !== 'unsatisfied' && value.status !== 'conflicting')
  ) {
    throw new Error('Invalid constraint status payload.')
  }

  return {
    constraintId: assertConstraintId(value.constraintId),
    status: value.status,
  }
}

function normalizeDimensionStatusRecord(value: unknown): DimensionStatusRecord {
  if (
    !isRecord(value) ||
    !isString(value.dimensionId) ||
    (value.status !== 'driving' && value.status !== 'driven' && value.status !== 'unsatisfied') ||
    !(typeof value.solvedValue === 'number' || value.solvedValue === null)
  ) {
    throw new Error('Invalid dimension status payload.')
  }

  return {
    dimensionId: assertDimensionId(value.dimensionId),
    status: value.status,
    solvedValue: value.solvedValue,
  }
}

function normalizeSketchSolveDiagnostic(value: unknown): SketchSolveDiagnostic {
  if (
    !isRecord(value) ||
    !isString(value.code) ||
    (value.severity !== 'info' && value.severity !== 'warning' && value.severity !== 'error') ||
    !isString(value.message)
  ) {
    throw new Error('Invalid sketch solve diagnostic payload.')
  }

  const target = (() => {
    if (value.target == null) {
      return null
    }

    if (!isRecord(value.target) || !isString(value.target.kind)) {
      throw new Error('Invalid sketch solve diagnostic target payload.')
    }

    switch (value.target.kind) {
      case 'entity':
        return isString(value.target.entityId)
          ? { kind: 'entity' as const, entityId: assertSketchEntityId(value.target.entityId) }
          : (() => { throw new Error('Invalid sketch solve entity target.') })()
      case 'point':
        return isString(value.target.pointId)
          ? { kind: 'point' as const, pointId: assertSketchPointId(value.target.pointId) }
          : (() => { throw new Error('Invalid sketch solve point target.') })()
      case 'constraint':
        return isString(value.target.constraintId)
          ? { kind: 'constraint' as const, constraintId: assertConstraintId(value.target.constraintId) }
          : (() => { throw new Error('Invalid sketch solve constraint target.') })()
      case 'dimension':
        return isString(value.target.dimensionId)
          ? { kind: 'dimension' as const, dimensionId: assertDimensionId(value.target.dimensionId) }
          : (() => { throw new Error('Invalid sketch solve dimension target.') })()
      case 'region':
        return isString(value.target.regionId)
          ? { kind: 'region' as const, regionId: assertRegionId(value.target.regionId) }
          : (() => { throw new Error('Invalid sketch solve region target.') })()
      default:
        throw new Error('Invalid sketch solve diagnostic target kind.')
    }
  })()

  return {
    code: value.code,
    severity: value.severity,
    message: value.message,
    target,
  }
}

function normalizeRegionRecords(value: unknown): RegionRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid sketch region payload.')
  }

  return value.map((region) => {
    if (
      !isRecord(region) ||
      !isString(region.regionId) ||
      !isString(region.label) ||
      !isRecord(region.target) ||
      !isRecord(region.sourceSketch) ||
      !Array.isArray(region.loops) ||
      typeof region.isClosed !== 'boolean'
    ) {
      throw new Error('Invalid region record payload.')
    }

    return {
      ...normalizeOwnership(region),
      regionId: assertRegionId(region.regionId),
      label: region.label,
      target: assertPrimitiveRef(region.target) as RegionRecord['target'],
      sourceSketch: assertPrimitiveRef(region.sourceSketch) as RegionRecord['sourceSketch'],
      loops: region.loops.map((loop) => {
        if (
          !isRecord(loop)
          || !isString(loop.loopId)
          || (loop.role !== 'outer' && loop.role !== 'inner')
          || (loop.orientation !== 'clockwise' && loop.orientation !== 'counterClockwise')
          || !Array.isArray(loop.segments)
          || !Array.isArray(loop.boundaryPointIds)
          || typeof loop.isClosed !== 'boolean'
        ) {
          throw new Error('Invalid region loop payload.')
        }

        return {
          loopId: loop.loopId as RegionRecord['loops'][number]['loopId'],
          role: loop.role,
          orientation: loop.orientation,
          segments: loop.segments.map((segment) => {
            if (!isRecord(segment) || !isRecord(segment.source) || !isString(segment.source.kind)) {
              throw new Error('Invalid region boundary segment payload.')
            }

            return {
              source:
                segment.source.kind === 'entity'
                  ? {
                      kind: 'entity' as const,
                      entityId: assertSketchEntityId(segment.source.entityId),
                    }
                  : segment.source.kind === 'projectedGeometry'
                    ? {
                        kind: 'projectedGeometry' as const,
                        reference: {
                          kind:
                            isRecord(segment.source.reference) && (
                              segment.source.reference.kind === 'projectedPoint'
                              || segment.source.reference.kind === 'projectedLineSegment'
                              || segment.source.reference.kind === 'projectedCircle'
                              || segment.source.reference.kind === 'projectedArc'
                              || segment.source.reference.kind === 'projectedSpline'
                            )
                              ? segment.source.reference.kind
                              : undefined,
                          referenceId:
                            isRecord(segment.source.reference) && isString(segment.source.reference.referenceId)
                              ? segment.source.reference.referenceId as import('@/contracts/shared/ids').ReferenceId
                              : (() => { throw new Error('Invalid projected geometry reference ID payload.') })(),
                          geometryId:
                            isRecord(segment.source.reference) && isString(segment.source.reference.geometryId)
                              ? segment.source.reference.geometryId as import('@/contracts/shared/ids').ProjectedGeometryId
                              : (() => { throw new Error('Invalid projected geometry geometry ID payload.') })(),
                        },
                      }
                    : (() => { throw new Error('Invalid region boundary source payload.') })(),
              startPointId: segment.startPointId === null ? null : assertSketchPointId(segment.startPointId),
              endPointId: segment.endPointId === null ? null : assertSketchPointId(segment.endPointId),
              traversalDirection:
                segment.traversalDirection === 'reverse'
                  ? 'reverse' as const
                  : undefined,
            }
          }),
          boundaryPointIds: loop.boundaryPointIds.map((pointId) => assertSketchPointId(pointId)),
          isClosed: loop.isClosed,
        }
      }),
      isClosed: region.isClosed,
    }
  })
}

function normalizeFeatures(value: unknown): FeatureSnapshotRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid feature snapshot payload.')
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.featureId) ||
      !isString(entry.label) ||
      !isRecord(entry.definition) ||
      !Array.isArray(entry.producedTargets)
    ) {
      throw new Error('Invalid feature snapshot record.')
    }

    return {
      ...normalizeOwnership(entry),
      featureId: assertFeatureId(entry.featureId),
      label: entry.label,
      definition: normalizeFeatureDefinition(entry.definition),
      producedTargets: entry.producedTargets.map((target) => assertDurableRef(target)),
    }
  })
}

function normalizeDocumentFeatureCursor(
  value: unknown,
  features: readonly FeatureSnapshotRecord[],
  sketches: readonly SketchSnapshotRecord[] = [],
): DocumentFeatureCursor {
  if (!isRecord(value) || !isString(value.kind)) {
    throw new Error('Invalid document feature cursor payload.')
  }

  if (value.kind === 'empty') {
    return { kind: 'empty' }
  }

  if (value.kind === 'sketch' && isString(value.sketchId)) {
    const sketchId = assertSketchId(value.sketchId)

    if (!sketches.some((sketch) => sketch.sketchId === sketchId)) {
      throw new Error(`Document feature cursor references missing sketch ${sketchId}.`)
    }

    return { kind: 'sketch', sketchId }
  }

  if (value.kind === 'feature' && isString(value.featureId)) {
    const featureId = assertFeatureId(value.featureId)

    if (!features.some((feature) => feature.featureId === featureId)) {
      throw new Error(`Document feature cursor references missing feature ${featureId}.`)
    }

    return { kind: 'feature', featureId }
  }

  throw new Error('Invalid document feature cursor payload.')
}

function normalizeBodies(value: unknown): BodySnapshotRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid body snapshot payload.')
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.bodyId) ||
      !isString(entry.label) ||
      !isRecord(entry.topology) ||
      !Array.isArray(entry.topology.faceIds) ||
      !Array.isArray(entry.topology.edgeIds) ||
      !Array.isArray(entry.topology.vertexIds)
    ) {
      throw new Error('Invalid body snapshot record.')
    }

    return {
      ...normalizeOwnership(entry),
      bodyId: assertBodyId(entry.bodyId),
      label: entry.label,
      topology: {
        faceIds: entry.topology.faceIds.map((faceId) => {
          if (!isString(faceId)) {
            throw new Error('Invalid face ID payload.')
          }

          return faceId as BodySnapshotRecord['topology']['faceIds'][number]
        }),
        edgeIds: entry.topology.edgeIds.map((edgeId) => {
          if (!isString(edgeId)) {
            throw new Error('Invalid edge ID payload.')
          }

          return edgeId as BodySnapshotRecord['topology']['edgeIds'][number]
        }),
        vertexIds: entry.topology.vertexIds.map((vertexId) => {
          if (!isString(vertexId)) {
            throw new Error('Invalid vertex ID payload.')
          }

          return vertexId as BodySnapshotRecord['topology']['vertexIds'][number]
        }),
      },
    }
  })
}

function normalizeConstructions(value: unknown): ConstructionSnapshotRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid construction snapshot payload.')
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.constructionId) ||
      !isString(entry.label) ||
      entry.constructionType !== 'plane'
    ) {
      throw new Error('Invalid construction snapshot record.')
    }

    return {
      ...normalizeOwnership(entry),
      constructionId: entry.constructionId as ConstructionSnapshotRecord['constructionId'],
      label: entry.label,
      constructionType: entry.constructionType,
      plane: normalizeSketchPlaneDefinition(entry.plane),
      target: assertDurableRef(entry.target),
    }
  })
}

function normalizeEntities(value: unknown): SnapshotEntityRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid snapshot entity payload.')
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !Array.isArray(entry.relatedTargets) ||
      !Array.isArray(entry.consumedByFeatureIds) ||
      !Array.isArray(entry.selectionSemantics)
    ) {
      throw new Error('Invalid snapshot entity record.')
    }

    return {
      ...normalizeOwnership(entry),
      id: entry.id as SnapshotEntityId,
      label: entry.label,
      target: assertDurableRef(entry.target),
      relatedTargets: entry.relatedTargets.map((target) => assertDurableRef(target)),
      consumedByFeatureIds: entry.consumedByFeatureIds.map((featureId) => assertFeatureId(featureId)),
      selectionSemantics: entry.selectionSemantics.map((semantic) => {
        if (
          semantic !== 'body' &&
          semantic !== 'face' &&
          semantic !== 'edge' &&
          semantic !== 'vertex' &&
          semantic !== 'constructionPlane' &&
          semantic !== 'existingSketch' &&
          semantic !== 'sketchEntity' &&
          semantic !== 'sketchPoint' &&
          semantic !== 'constraintAnnotation' &&
          semantic !== 'dimensionAnnotation' &&
          semantic !== 'planarFace' &&
          semantic !== 'planarReference'
        ) {
          throw new Error('Invalid snapshot entity selection semantic.')
        }

        return semantic
      }),
    }
  })
}

function normalizeKernelDocumentSnapshot(value: unknown): KernelDocumentSnapshot {
  const parsed = kernelDocumentSnapshotSchema.parse(value)

  return {
    ...parsed,
    settings: normalizeModelingDocumentSettings(parsed.settings),
    capabilities: normalizeModelingKernelCapabilities(parsed.capabilities),
    render: normalizeRenderExport(parsed.render),
  }
}

function normalizeWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  const parsed = workspaceSnapshotSchema.parse(value)
  const document = normalizeKernelDocumentSnapshot(parsed.document)
  const presentation = normalizeDocumentPresentation(parsed.presentation)

  return {
    ...parsed,
    document,
    presentation,
    contractVersion: document.contractVersion,
    schemaVersion: document.schemaVersion,
    documentId: document.documentId,
    revisionId: document.revisionId,
    settings: document.settings,
    capabilities: document.capabilities,
    featureTree: presentation.featureTree,
    objects: presentation.objects,
    documentHistory: presentation.documentHistory,
    features: document.features,
    cursor: document.cursor,
    sketches: document.sketches,
    bodies: document.bodies,
    constructions: document.constructions,
    variables: document.variables,
    entities: presentation.entities,
    references: document.references,
    diagnostics: document.diagnostics,
    render: document.render,
  }
}

function normalizeChangedTargets(value: unknown): DurableRef[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid changed target payload.')
  }

  return value.map((entry) => assertDurableRef(entry))
}

function normalizeResolution(value: unknown): ResolvedReferenceRecord {
  return resolveReferenceResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    resolution: value,
    diagnostics: [],
  }).resolution
}

function buildDocumentRequest(documentId: DocumentSnapshot['documentId']): GetDocumentSnapshotRequest {
  return {
    contractVersion: CONTRACT_VERSION,
    documentId,
  }
}

async function collectRepositoryAssetBlobs(
  repository: DocumentRepository | null,
  document: AuthoredModelDocument,
) {
  if (!isGeometryAssetDocumentRepository(repository) || document.assets.records.length === 0) {
    return [] as GeometryAssetBlobInput[]
  }

  const assets: GeometryAssetBlobInput[] = []
  for (const asset of document.assets.records) {
    const bytes = await repository.getGeometryAssetRecord(asset)
    if (bytes) {
      assets.push({ asset, bytes })
    }
  }
  return assets
}

function assertKernelContractVersion(contractVersion: GetDocumentSnapshotResponse['snapshot']['contractVersion']) {
  if (contractVersion !== CONTRACT_VERSION) {
    throw new Error('Kernel contract version does not match the active modeling service.')
  }
}

function assertSnapshotSchemaVersion(schemaVersion: DocumentSnapshot['schemaVersion']) {
  if (schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error('Snapshot schema version does not match the active modeling service.')
  }
}

function assertKernelDocumentIdMatches(
  responseDocumentId: DocumentId,
  expectedDocumentId: DocumentId,
  operationLabel: string,
) {
  if (responseDocumentId !== expectedDocumentId) {
    throw new Error(`${operationLabel} response document ID does not match the active document.`)
  }
}

function validateSnapshotResponse(
  response: GetDocumentSnapshotResponse,
  expectedDocumentId: DocumentId,
): DocumentSnapshot {
  const parsed = getDocumentSnapshotResponseSchema.parse(response)
  assertKernelContractVersion(parsed.snapshot.document.contractVersion)
  assertSnapshotSchemaVersion(parsed.snapshot.document.schemaVersion)
  assertKernelDocumentIdMatches(parsed.snapshot.document.documentId, expectedDocumentId, 'Snapshot')
  return normalizeWorkspaceSnapshot(parsed.snapshot)
}

interface SafeParseIssue {
  path: readonly (string | number | symbol)[]
  message: string
}

interface SafeParser<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly SafeParseIssue[] } }
}

function formatSafeParseIssues(issues: readonly SafeParseIssue[]) {
  if (issues.length === 0) {
    return 'no issue details reported'
  }

  return issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '<root>'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

function parseResponseWithFallback<TPrimary, TFallback>(input: {
  operation: string
  response: unknown
  primarySchemaName: string
  primarySchema: SafeParser<TPrimary>
  fallbackSchemaName: string
  fallbackSchema: SafeParser<TFallback>
}): TPrimary | TFallback {
  const primary = input.primarySchema.safeParse(input.response)
  if (primary.success) {
    return primary.data
  }

  const fallback = input.fallbackSchema.safeParse(input.response)
  if (fallback.success) {
    return fallback.data
  }

  throw new Error(
    `${input.operation} response failed runtime validation for both ${input.primarySchemaName} and ${input.fallbackSchemaName}. `
    + `${input.primarySchemaName}: ${formatSafeParseIssues(primary.error.issues)}. `
    + `${input.fallbackSchemaName}: ${formatSafeParseIssues(fallback.error.issues)}.`,
  )
}

function mapFeatureMutationResponse(
  response: CreateFeatureResponse | UpdateFeatureResponse,
  expectedDocumentId: DocumentId,
): ModelingFeatureMutationResult {
  const normalized = parseResponseWithFallback({
    operation: 'Feature mutation',
    response,
    primarySchemaName: 'CreateFeatureResponse',
    primarySchema: createFeatureResponseSchema,
    fallbackSchemaName: 'UpdateFeatureResponse',
    fallbackSchema: updateFeatureResponseSchema,
  })
  assertKernelContractVersion(normalized.contractVersion)
  assertKernelDocumentIdMatches(normalized.documentId, expectedDocumentId, 'Feature mutation')
  return {
    revisionId: normalized.revisionId,
    featureId: normalized.featureId,
    revisionState: normalized.revisionState,
    rebuildResult: normalized.rebuildResult,
    changedTargets: normalized.changedTargets,
    diagnostics: normalized.diagnostics,
  }
}

function mapDeleteFeatureResponse(
  response: DeleteFeatureResponse,
  expectedDocumentId: DocumentId,
): ModelingDeleteFeatureResult {
  const parsed = deleteFeatureResponseSchema.parse(response)
  assertKernelContractVersion(parsed.contractVersion)
  assertKernelDocumentIdMatches(parsed.documentId, expectedDocumentId, 'Delete feature')
  return {
    revisionId: parsed.revisionId,
    deletedFeatureId: parsed.deletedFeatureId,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  }
}

function mapRenameBodyResponse(
  response: RenameBodyResponse,
  expectedDocumentId: DocumentId,
): ModelingRenameBodyResult {
  const parsed = renameBodyResponseSchema.parse(response)
  assertKernelContractVersion(parsed.contractVersion)
  assertKernelDocumentIdMatches(parsed.documentId, expectedDocumentId, 'Rename body')
  return {
    revisionId: parsed.revisionId,
    bodyId: parsed.bodyId,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  }
}

function mapDocumentVariableResponse(
  response: AddDocumentVariableResponse | UpdateDocumentVariableResponse,
  expectedDocumentId: DocumentId,
): ModelingDocumentVariableMutationResult {
  const normalized = parseResponseWithFallback({
    operation: 'Document variable mutation',
    response,
    primarySchemaName: 'AddDocumentVariableResponse',
    primarySchema: addDocumentVariableResponseSchema,
    fallbackSchemaName: 'UpdateDocumentVariableResponse',
    fallbackSchema: updateDocumentVariableResponseSchema,
  })
  assertKernelContractVersion(normalized.contractVersion)
  assertKernelDocumentIdMatches(normalized.documentId, expectedDocumentId, 'Document variable mutation')
  return {
    revisionId: normalized.revisionId,
    variableId: normalized.variableId,
    revisionState: normalized.revisionState,
    rebuildResult: normalized.rebuildResult,
    changedTargets: normalized.changedTargets,
    diagnostics: normalized.diagnostics,
  }
}

function mapCommitSketchResponse(
  response: CommitSketchResponse,
  expectedDocumentId: DocumentId,
): ModelingCommitSketchResult {
  const parsed = commitSketchResponseSchema.parse(response)
  assertKernelContractVersion(parsed.contractVersion)
  assertKernelDocumentIdMatches(parsed.documentId, expectedDocumentId, 'Commit sketch')
  return {
    revisionId: parsed.revisionId,
    sketchId: parsed.sketchId,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  }
}

function mapPreviewResponse(
  response: EvaluatePreviewResponse,
  expectedDocumentId: DocumentId,
): ModelingPreviewResult {
  const parsed = evaluatePreviewResponseSchema.parse(response)
  assertKernelContractVersion(parsed.contractVersion)
  assertKernelDocumentIdMatches(parsed.documentId, expectedDocumentId, 'Preview')
  return {
    revisionId: parsed.revisionId,
    previewId: parsed.previewId,
    renderables: parsed.render.records,
    freshness: parsed.freshness,
    stale: parsed.freshness.kind === 'stale',
    diagnostics: parsed.diagnostics,
  }
}

function mapExportDocumentResponse(
  response: DocumentExportResult,
): ModelingExportDocumentResult {
  return documentExportResultSchema.parse(response)
}

function mapReorderFeatureResponse(
  response: ReorderFeatureResponse,
  expectedDocumentId: DocumentId,
): ModelingReorderFeatureResult {
  const parsed = reorderFeatureResponseSchema.parse(response)
  assertKernelContractVersion(parsed.contractVersion)
  assertKernelDocumentIdMatches(parsed.documentId, expectedDocumentId, 'Reorder feature')
  return {
    revisionId: parsed.revisionId,
    featureId: parsed.featureId,
    beforeFeatureId: parsed.beforeFeatureId,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  }
}

function mapReorderDocumentHistoryResponse(
  response: ReorderDocumentHistoryResponse,
  expectedDocumentId: DocumentId,
): ModelingReorderDocumentHistoryResult {
  const parsed = reorderDocumentHistoryResponseSchema.parse(response)
  assertKernelContractVersion(parsed.contractVersion)
  assertKernelDocumentIdMatches(parsed.documentId, expectedDocumentId, 'Reorder document history')
  return {
    revisionId: parsed.revisionId,
    item: parsed.item,
    beforeItem: parsed.beforeItem,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  }
}

function mapSetFeatureCursorResponse(
  response: SetFeatureCursorResponse,
  expectedDocumentId: DocumentId,
): ModelingSetFeatureCursorResult {
  const parsed = setFeatureCursorResponseSchema.parse(response)
  assertKernelContractVersion(parsed.contractVersion)
  assertKernelDocumentIdMatches(parsed.documentId, expectedDocumentId, 'Set feature cursor')
  return {
    revisionId: parsed.revisionId,
    cursor: parsed.cursor,
    revisionState: parsed.revisionState,
    rebuildResult: parsed.rebuildResult,
    changedTargets: parsed.changedTargets,
    diagnostics: parsed.diagnostics,
  }
}

function mapResolvedReferenceResponse(
  response: ResolveReferenceResponse,
  expectedDocumentId: DocumentId,
): ModelingResolvedReferenceResult {
  const parsed = resolveReferenceResponseSchema.parse(response)
  assertKernelContractVersion(parsed.contractVersion)
  assertKernelDocumentIdMatches(parsed.resolution.ownerDocumentId, expectedDocumentId, 'Resolve reference')
  return {
    resolution: parsed.resolution,
    diagnostics: parsed.diagnostics,
  }
}

function assertMutationBase(input: {
  baseRevisionId: RevisionId
  baseRepositoryHeads?: readonly string[]
}) {
  assertRevisionId(input.baseRevisionId)
  if (input.baseRepositoryHeads !== undefined && !Array.isArray(input.baseRepositoryHeads)) {
    throw new Error('Invalid repository heads mutation basis.')
  }
}

function stripRepositoryMutationBasis<T extends { baseRepositoryHeads?: readonly string[] }>(
  input: T,
): Omit<T, 'baseRepositoryHeads'> {
  const requestInput = { ...input }
  delete requestInput.baseRepositoryHeads
  return requestInput
}

function normalizeCreateFeatureInput(
  input: ModelingCreateFeatureInput,
  documentId: DocumentId,
): CreateFeatureRequest {
  assertMutationBase(input)
  const requestInput = stripRepositoryMutationBasis(input)

  return {
    ...requestInput,
    definition: normalizeFeatureDefinition(input.definition),
    contractVersion: CONTRACT_VERSION,
    documentId,
  }
}

function normalizeCommitSketchInput(
  input: ModelingCommitSketchInput,
  documentId: DocumentId,
): CommitSketchRequest {
  assertMutationBase(input)
  const requestInput = stripRepositoryMutationBasis(input)

  return {
    ...requestInput,
    contractVersion: CONTRACT_VERSION,
    documentId,
  }
}

function normalizeUpdateFeatureInput(
  input: ModelingUpdateFeatureInput,
  documentId: DocumentId,
): UpdateFeatureRequest {
  assertMutationBase(input)
  const requestInput = stripRepositoryMutationBasis(input)

  return {
    ...requestInput,
    definition: normalizeFeatureDefinition(input.definition),
    contractVersion: CONTRACT_VERSION,
    documentId,
  }
}

function normalizeDeleteFeatureInput(
  input: ModelingDeleteFeatureInput,
  documentId: DocumentId,
): DeleteFeatureRequest {
  assertMutationBase(input)
  const requestInput = stripRepositoryMutationBasis(input)

  return {
    ...requestInput,
    contractVersion: CONTRACT_VERSION,
    documentId,
  }
}

function normalizeRenameBodyInput(
  input: ModelingRenameBodyInput,
  documentId: DocumentId,
): RenameBodyRequest {
  assertMutationBase(input)
  const requestInput = stripRepositoryMutationBasis(input)

  return {
    ...requestInput,
    contractVersion: CONTRACT_VERSION,
    documentId,
  }
}

function normalizeAddDocumentVariableInput(
  input: ModelingAddDocumentVariableInput,
  documentId: DocumentId,
): AddDocumentVariableRequest {
  assertMutationBase(input)
  const requestInput = stripRepositoryMutationBasis(input)

  return {
    ...requestInput,
    variableId: input.variableId === undefined ? undefined : assertDocumentVariableId(input.variableId),
    contractVersion: CONTRACT_VERSION,
    documentId,
  }
}

function normalizeUpdateDocumentVariableInput(
  input: ModelingUpdateDocumentVariableInput,
  documentId: DocumentId,
): UpdateDocumentVariableRequest {
  assertMutationBase(input)
  const requestInput = stripRepositoryMutationBasis(input)

  return {
    ...requestInput,
    variableId: assertDocumentVariableId(input.variableId),
    contractVersion: CONTRACT_VERSION,
    documentId,
  }
}

function normalizeReorderFeatureInput(
  input: ModelingReorderFeatureInput,
  documentId: DocumentId,
): ReorderFeatureRequest {
  assertMutationBase(input)
  const requestInput = stripRepositoryMutationBasis(input)

  return {
    ...requestInput,
    contractVersion: CONTRACT_VERSION,
    documentId,
  }
}

function normalizeReorderDocumentHistoryInput(
  input: ModelingReorderDocumentHistoryInput,
  documentId: DocumentId,
): ReorderDocumentHistoryRequest {
  assertMutationBase(input)
  const requestInput = stripRepositoryMutationBasis(input)

  return {
    ...requestInput,
    contractVersion: CONTRACT_VERSION,
    documentId,
  }
}

function normalizeSetFeatureCursorInput(
  input: ModelingSetFeatureCursorInput,
  documentId: DocumentId,
): SetFeatureCursorRequest {
  assertMutationBase(input)

  return {
    contractVersion: CONTRACT_VERSION,
    documentId,
    baseRevisionId: input.baseRevisionId,
    cursor: input.cursor,
  }
}

function normalizePreviewInput(
  input: ModelingEvaluatePreviewInput,
  documentId: DocumentId,
): EvaluatePreviewRequest {
  assertMutationBase(input)

  return {
    ...input,
    definition: normalizeFeatureDefinition(input.definition),
    contractVersion: CONTRACT_VERSION,
    documentId,
  }
}

function normalizeResolveReferenceInput(
  target: PrimitiveRef,
  documentId: DocumentId,
): ResolveReferenceRequest {
  return {
    contractVersion: CONTRACT_VERSION,
    documentId,
    target: assertDurableRef(target),
  }
}

function normalizeExportDocumentInput(
  input: ModelingExportDocumentInput,
  documentId: DocumentId,
): DocumentExportRequest {
  assertMutationBase(input)

  return documentExportRequestSchema.parse({
    ...input,
    target: assertDurableRef(input.target),
    contractVersion: CONTRACT_VERSION,
    documentId,
  })
}

function createExportDiagnostic(
  code: string,
  message: string,
  target: DurableRef | null,
): DocumentExportDiagnostic {
  return {
    code,
    severity: 'error',
    message,
    target,
  }
}

function getDocumentExportExtension(format: DocumentExportFormat) {
  switch (format) {
    case 'stl':
      return 'stl'
    case 'step':
      return 'step'
    case '3mf':
      return '3mf'
    case 'cadara':
      return 'cadara'
  }
}

function getDocumentExportMimeType(format: DocumentExportFormat) {
  switch (format) {
    case 'stl':
      return 'model/stl'
    case 'step':
      return 'model/step'
    case '3mf':
      return 'model/3mf'
    case 'cadara':
      return 'application/vnd.cadara+json'
  }
}

function createExportFilename(targetLabel: string, format: DocumentExportFormat) {
  const slug = targetLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'document'

  return `${slug}.${getDocumentExportExtension(format)}`
}

function stringifyCadaraDocument(document: KernelDocumentSnapshot, pretty: boolean) {
  return JSON.stringify(stableJsonValue(document), null, pretty ? 2 : 0)
}

function normalizeCurrentDocumentId(value: DocumentSnapshot['documentId']): DocumentId {
  return assertDocumentId(value)
}

function getResolutionLabel(resolution: ResolvedReferenceRecord) {
  return resolution.label || formatPrimitiveRefLabel(resolution.target)
}

function createRestoreFailure(
  reasonCode: string,
  message: string,
  entryIndex: number | null,
  entriesReplayed: number,
): ModelingHistoryRestoreState {
  return {
    kind: 'failed',
    entriesReplayed,
    diagnostics: [
      {
        reasonCode,
        message,
        entryIndex,
      },
    ],
  }
}

function createRepositoryRestoreFailure(
  status: Extract<DocumentRepositoryRestoreStatus, { kind: 'failed' }>,
  entriesReplayed = 0,
): ModelingHistoryRestoreState {
  return createRestoreFailure(
    status.diagnostic.reasonCode,
    status.diagnostic.message,
    null,
    entriesReplayed,
  )
}

function createDocumentRepositoryDiagnostic(status: Extract<DocumentRepositoryRestoreStatus, { kind: 'failed' }>): ModelingDiagnostic {
  return {
    code: status.diagnostic.reasonCode,
    severity: 'error',
    message: status.diagnostic.message,
    target: null,
    detail: null,
  }
}

function isAcceptedMutation(response: ModelingOperationResult) {
  return response.revisionState.kind === 'accepted'
}

type ModelingMutationBoundaryResult = {
  revisionState: MutationRevisionState
  diagnostics: ModelingDiagnostic[]
}

function modelingMutationResultToAppResult<T extends ModelingMutationBoundaryResult>(
  result: T,
  input: {
    operation: string
    fallbackMessage: string
    requestId?: RequestId
    context?: readonly AppErrorContextEntry[]
  },
): AppResult<T> {
  if (result.revisionState.kind === 'accepted') {
    return ok(result)
  }

  return err(appErrorFromModelingResult({
    operation: input.operation,
    fallbackMessage: input.fallbackMessage,
    diagnostics: result.diagnostics,
    revisionState: result.revisionState,
    requestId: input.requestId,
    context: input.context,
  }))
}

function runModelingMutationBoundary<T extends ModelingMutationBoundaryResult>(input: {
  operation: string
  fallbackMessage: string
  requestId?: RequestId
  context?: readonly AppErrorContextEntry[]
  action: () => Promise<T>
}): AppResultAsync<T> {
  return ResultAsync.fromPromise(
    input.action(),
    (error) => normalizeUnknownError(error, {
      code: 'app/operation-failed',
      fallbackMessage: input.fallbackMessage,
      requestId: input.requestId,
      context: [
        { key: 'operation', value: input.operation },
        ...(input.context ?? []),
      ],
    }),
  ).andThen((result) => modelingMutationResultToAppResult(result, input))
}

interface HistoryReplayCursor {
  revisionId: RevisionId
  sketchIds: Set<SketchId>
  sketchCount: number
}

async function getAdapterReplayCursor(
  adapter: ModelingKernelAdapter,
  documentId: DocumentId,
): Promise<HistoryReplayCursor> {
  const response = await adapter.getDocumentSnapshot(buildDocumentRequest(documentId))
  const snapshot = validateSnapshotResponse(response, documentId)

  return {
    revisionId: snapshot.document.revisionId,
    sketchIds: new Set(snapshot.document.sketches.map((entry) => entry.sketchId)),
    sketchCount: snapshot.document.sketches.length,
  }
}

function createHistoryReplayCorrelation(index: number): ModelingCommitSketchCorrelation {
  const requestId = `request_history_replay_${index + 1}` as RequestId
  return {
    requestId,
    projectionRequestId: `${requestId}:project` as RequestId,
    validationRequestId: `${requestId}:validate` as RequestId,
    solveRequestId: `${requestId}:solve` as RequestId,
    regionRequestId: `${requestId}:regions` as RequestId,
  }
}

function getExpectedAllocatedReplaySketchId(
  sketchCount: number,
): SketchId {
  return sketchCount === 0
    ? 'sketch_primary'
    : (`sketch_${sketchCount + 1}` as SketchId)
}

function resolveReplayCommitSketchId(
  cursor: HistoryReplayCursor,
  sketchId: PersistedCommitSketchPayload['sketchId'],
): PersistedCommitSketchPayload['sketchId'] {
  if (sketchId === null) {
    return null
  }

  if (cursor.sketchIds.has(sketchId)) {
    return sketchId
  }

  return sketchId === getExpectedAllocatedReplaySketchId(cursor.sketchCount) ? null : sketchId
}

function advanceHistoryReplayCursor(
  cursor: HistoryReplayCursor,
  entry: ModelingOperationHistoryEntry,
  response: ModelingOperationResult,
): HistoryReplayCursor {
  if (!isAcceptedMutation(response)) {
    return cursor
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
    sketchCount: cursor.sketchCount + 1,
  }
}

async function replayHistoryEntry(input: {
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

export function createModelingService(
  adapter: ModelingKernelAdapter,
  options: ModelingServiceOptions,
): ModelingService {
  const currentDocumentId = normalizeCurrentDocumentId(options.currentDocumentId)
  const sketchSolver = options.sketchSolver ? createSketchSolverService(options.sketchSolver) : null
  const operationHistoryStore = options.operationHistoryStore ?? null
  const documentRepository = options.documentRepository ?? null
  let operationHistoryPayload: ModelingOperationHistoryPayload = createEmptyOperationHistory(currentDocumentId)
  let canPersistOperationHistory = true
  let canPersistAuthoredDocument = true
  let historyRestoreState: ModelingHistoryRestoreState = {
    kind: 'pending',
    entriesReplayed: 0,
    diagnostics: [],
  }
  let currentRepositoryMetadata: DocumentRepositoryMetadata | null = null
  let seedAuthoredDocument: AuthoredModelDocument | null = null
  let repositoryChangePromise = Promise.resolve()
  let isRestoringRepositoryDocument = documentRepository !== null
  const documentChangeListeners = new Set<(event: ModelingServiceDocumentChangeEvent) => void>()

  function rememberRepositoryMetadata(metadata: DocumentRepositoryMetadata) {
    currentRepositoryMetadata = {
      ...metadata,
      heads: [...metadata.heads],
    }
  }

  function markRepositorySnapshotFresh(metadata: DocumentRepositoryMetadata) {
    rememberRepositoryMetadata(metadata)
  }

  function attachRepositoryProvenance(snapshot: DocumentSnapshot): DocumentSnapshot {
    const metadata = documentRepository ? currentRepositoryMetadata ?? documentRepository.getMetadata(currentDocumentId) : null
    if (!metadata) {
      return {
        ...snapshot,
        provenance: null,
      }
    }

    return {
      ...snapshot,
      provenance: {
        repositoryHeads: [...metadata.heads],
        repositorySource: metadata.source,
      },
    }
  }

  function repositoryHeadsChangedSinceBasis(input: { baseRepositoryHeads?: readonly string[] }) {
    if (!currentRepositoryMetadata || !input.baseRepositoryHeads) {
      return false
    }

    return !sameStringSet(currentRepositoryMetadata.heads, input.baseRepositoryHeads)
  }

  function addRepositoryFreshnessDiagnostic<T extends { revisionState: MutationRevisionState; diagnostics: ModelingDiagnostic[] }>(
    result: T,
    input: { baseRepositoryHeads?: readonly string[] },
  ): T {
    if (!repositoryHeadsChangedSinceBasis(input)) {
      return result
    }

    return {
      ...result,
      diagnostics: [
        ...result.diagnostics,
        {
          code: 'repository-head-conflict',
          severity: 'error',
          message: 'The authored document changed after the current snapshot was loaded. Refresh before retrying this mutation.',
          target: null,
          detail: null,
        },
      ],
    }
  }

  async function restoreAuthoredRepositoryDocument(
    document: Parameters<NonNullable<ModelingKernelAdapter['restoreAuthoredModelDocument']>>[0],
    diagnostics: ModelingDiagnostic[] = [],
    assets: readonly GeometryAssetBlobInput[] = [],
  ) {
    await adapter.restoreAuthoredModelDocument?.(
      document,
      diagnostics,
      createLocalAssetResolver(assets),
    )
  }

  async function getSeedAuthoredDocument() {
    if (seedAuthoredDocument) {
      return structuredClone(seedAuthoredDocument)
    }

    const seedSnapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
      currentDocumentId,
    )
    seedAuthoredDocument = createAuthoredModelDocumentFromSnapshot(seedSnapshot)
    return structuredClone(seedAuthoredDocument)
  }

  async function exportAuthoredDocumentForRepository() {
    if (adapter.exportAuthoredModelDocument) {
      return adapter.exportAuthoredModelDocument(currentDocumentId)
    }

    const snapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
      currentDocumentId,
    )
    return createAuthoredModelDocumentFromSnapshot(snapshot)
  }

  function createDocumentFileDiagnostic(code: string, message: string): ModelingDiagnostic {
    return {
      code,
      severity: 'error',
      message,
      target: null,
      detail: null,
    }
  }

  function createLocalAssetResolver(assets: readonly GeometryAssetBlobInput[]): GeometryAssetResolver | undefined {
    const transientAssetBytes = new Map<GeometryAssetHash, Uint8Array>()
    for (const asset of assets) {
      transientAssetBytes.set(asset.asset.hash, asset.bytes.slice())
    }

    const repositoryResolver = isGeometryAssetDocumentRepository(documentRepository)
      ? documentRepository
      : undefined

    if (transientAssetBytes.size === 0) {
      return repositoryResolver
    }

    return {
      async getGeometryAssetBytes(hash) {
        const bytes = transientAssetBytes.get(hash)
        if (bytes) {
          return bytes.slice()
        }

        return repositoryResolver?.getGeometryAssetBytes(hash) ?? null
      },
    }
  }

  function createNextAuthoredRevisionId(revisionId: RevisionId): RevisionId {
    const match = /^rev_(\d+)$/.exec(revisionId)
    if (!match) {
      throw new Error(`Unsupported revision format ${revisionId}.`)
    }

    return `rev_${String(Number.parseInt(match[1]!, 10) + 1).padStart(match[1]!.length, '0')}` as RevisionId
  }

  function allocateStepImportFeatureId(document: AuthoredModelDocument): FeatureId {
    const pattern = /^feature_stepImport-(\d+)$/
    let maxOrdinal = 0
    for (const feature of document.features) {
      const match = pattern.exec(feature.featureId)
      if (match) {
        maxOrdinal = Math.max(maxOrdinal, Number.parseInt(match[1]!, 10))
      }
    }

    return `feature_stepImport-${maxOrdinal + 1}` as FeatureId
  }

  function allocateMeshImportFeatureId(document: AuthoredModelDocument): FeatureId {
    const pattern = /^feature_meshImport-(\d+)$/
    let maxOrdinal = 0
    for (const feature of document.features) {
      const match = pattern.exec(feature.featureId)
      if (match) {
        maxOrdinal = Math.max(maxOrdinal, Number.parseInt(match[1]!, 10))
      }
    }

    return `feature_meshImport-${maxOrdinal + 1}` as FeatureId
  }

  function createStepImportAssetId(hash: GeometryAssetHash): GeometryAssetId {
    return `asset_step_import_${hash.replace(/^sha256:/, '').slice(0, 16)}` as GeometryAssetId
  }

  function createStepImportLabel(fileName: string) {
    const trimmed = fileName.trim()
    const baseName = trimmed.split(/[\\/]/).pop()?.replace(/\.(?:step|stp)$/i, '').trim()
    return baseName && baseName.length > 0 ? baseName : 'STEP Import'
  }

  function createMeshImportLabel(fileName: string) {
    const trimmed = fileName.trim()
    const baseName = trimmed.split(/[\\/]/).pop()?.replace(/\.(?:stl|3mf)$/i, '').trim()
    return baseName && baseName.length > 0 ? baseName : 'Mesh Import'
  }

  function getAuthoredHistoryOrder(document: AuthoredModelDocument) {
    if (document.historyOrder) {
      return structuredClone(document.historyOrder)
    }

    return [
      ...document.sketches.map((sketch) => ({ kind: 'sketch' as const, sketchId: sketch.sketchId })),
      ...document.featureOrder.map((featureId) => ({ kind: 'feature' as const, featureId })),
    ]
  }

  async function createStepImportAuthoredDocument(input: ModelingImportStepFileInput) {
    if (!/\.(?:step|stp)$/i.test(input.fileName)) {
      return {
        ok: false as const,
        diagnostics: [
          createDocumentFileDiagnostic(
            'step-import-unsupported-file-type',
            'Import failed. Select a STEP file with a .step or .stp extension.',
          ),
        ],
      }
    }

    if (input.bytes.byteLength === 0) {
      return {
        ok: false as const,
        diagnostics: [
          createDocumentFileDiagnostic(
            'step-import-empty-file',
            'Import failed. The selected STEP file is empty.',
          ),
        ],
      }
    }

    const sourceDocument = await exportAuthoredDocumentForRepository()
    const bytes = input.bytes.slice()
    const hash = await hashGeometryAssetBytes(bytes)
    const featureId = allocateStepImportFeatureId(sourceDocument)
    const label = createStepImportLabel(input.fileName)
    const asset: GeometryAssetRecord = {
      schemaVersion: GEOMETRY_ASSET_SCHEMA_VERSION,
      assetId: createStepImportAssetId(hash),
      hash,
      byteLength: bytes.byteLength,
      format: 'step',
      mediaType: 'model/step',
      provenance: {
        kind: 'imported',
        sourceName: input.fileName,
        sourceHash: hash,
      },
      ownerFeatureIds: [featureId],
    }

    const document: AuthoredModelDocument = {
      ...sourceDocument,
      revisionId: createNextAuthoredRevisionId(sourceDocument.revisionId),
      features: [
        ...sourceDocument.features,
        {
          featureId,
          label,
          definition: {
            kind: 'stepImport',
            featureTypeVersion: STEP_IMPORT_FEATURE_SCHEMA_VERSION,
            parameters: {
              assetId: asset.assetId,
              unit: {
                source: 'file',
                resolvedUnit: sourceDocument.settings.linearUnit,
                scaleToDocument: 1,
              },
              orientation: {
                upAxis: 'z',
                handedness: 'rightHanded',
              },
              placement: {
                translation: [0, 0, 0],
                rotationEulerRadians: [0, 0, 0],
                scale: 1,
              },
              label,
            },
          },
        },
      ],
      featureOrder: [...sourceDocument.featureOrder, featureId],
      historyOrder: [
        ...getAuthoredHistoryOrder(sourceDocument),
        { kind: 'feature', featureId },
      ],
      cursor: { kind: 'feature', featureId },
      assets: normalizeGeometryAssetManifest({
        schemaVersion: GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
        records: [...sourceDocument.assets.records, asset],
      }),
    }

    return {
      ok: true as const,
      document,
      assets: [{ asset, bytes }],
    }
  }

  async function createMeshImportAuthoredDocument(input: ModelingImportMeshFileInput) {
    if (!/\.(?:stl|3mf)$/i.test(input.fileName)) {
      return {
        ok: false as const,
        diagnostics: [
          createDocumentFileDiagnostic(
            'mesh-import-unsupported-file-type',
            'Import failed. Select an STL or 3MF file.',
          ),
        ],
      }
    }

    if (input.bytes.byteLength === 0) {
      return {
        ok: false as const,
        diagnostics: [
          createDocumentFileDiagnostic(
            'mesh-import-empty-file',
            'Import failed. The selected mesh file is empty.',
          ),
        ],
      }
    }

    const sourceBytes = input.bytes.slice()
    const sourceHash = await hashGeometryAssetBytes(sourceBytes)
    let sourceFormat: MeshImportSourceFormat = /\.3mf$/i.test(input.fileName) ? '3mf' : 'stl'
    let triangles

    try {
      const parsed = parseMeshSourceFile({ fileName: input.fileName, bytes: sourceBytes })
      sourceFormat = parsed.sourceFormat
      triangles = parsed.triangles
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mesh source could not be parsed.'
      return {
        ok: false as const,
        diagnostics: [
          createMeshImportDiagnostic(
            'mesh-import-parse-failed',
            `Mesh import failed while parsing ${input.fileName}.`,
            {
              sourceFormat: error instanceof MeshParseError ? error.sourceFormat : sourceFormat,
              sourceHash,
              conversionPhase: 'parse',
              rejectionReason: message,
            },
          ),
        ],
      }
    }

    const sourceDocument = await exportAuthoredDocumentForRepository()
    const featureId = allocateMeshImportFeatureId(sourceDocument)
    const label = createMeshImportLabel(input.fileName)
    const baked = await createBakedMeshGeometryAsset({
      triangles,
      sourceFileName: input.fileName,
      sourceFormat,
      sourceHash,
      ownerFeatureId: featureId,
    })

    if (!baked.ok) {
      return {
        ok: false as const,
        diagnostics: [
          createMeshImportDiagnostic(
            'mesh-import-conversion-failed',
            `Mesh import failed while baking ${input.fileName}.`,
            {
              sourceFormat,
              sourceHash,
              triangleCount: baked.triangleCount,
              conversionPhase: 'bake',
              rejectionReason: baked.reason,
            },
          ),
        ],
      }
    }

    const asset = baked.assetInput.asset
    const document: AuthoredModelDocument = {
      ...sourceDocument,
      revisionId: createNextAuthoredRevisionId(sourceDocument.revisionId),
      features: [
        ...sourceDocument.features,
        {
          featureId,
          label,
          definition: {
            kind: 'meshImport',
            featureTypeVersion: MESH_IMPORT_FEATURE_SCHEMA_VERSION,
            parameters: {
              assetId: asset.assetId,
              source: {
                originalFileName: input.fileName,
                sourceFormat,
                sourceHash,
                sourceStored: false,
              },
              resolvedSettings: {
                unit: {
                  source: 'user',
                  resolvedUnit: 'millimeter',
                  scaleToDocument: 1,
                },
                orientation: {
                  upAxis: 'z',
                  handedness: 'rightHanded',
                },
                placement: {
                  translation: [0, 0, 0],
                  rotationEulerRadians: [0, 0, 0],
                  scale: 1,
                },
              },
              label,
            },
          },
        },
      ],
      featureOrder: [...sourceDocument.featureOrder, featureId],
      historyOrder: [
        ...getAuthoredHistoryOrder(sourceDocument),
        { kind: 'feature', featureId },
      ],
      cursor: { kind: 'feature', featureId },
      assets: normalizeGeometryAssetManifest({
        schemaVersion: GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
        records: [...sourceDocument.assets.records, asset],
      }),
    }

    return {
      ok: true as const,
      document,
      assets: [baked.assetInput],
    }
  }

  type AuthoredDocumentValidationResult =
    | { ok: true; document: AuthoredModelDocument }
    | { ok: false; diagnostics: ModelingDiagnostic[] }

  function normalizeImportedDocument(value: unknown): AuthoredDocumentValidationResult {
    const parsed = parseAuthoredModelDocument(structuredClone(value))

    if (!parsed.ok) {
      return {
        ok: false,
        diagnostics: [
          createDocumentFileDiagnostic(
            `document-import-${parsed.diagnostic.reasonCode}`,
            parsed.diagnostic.message,
          ),
        ],
      }
    }

    return {
      ok: true,
      document: {
        ...parsed.document,
        documentId: currentDocumentId,
      },
    }
  }

  async function replaceCurrentAuthoredDocument(
    document: AuthoredModelDocument,
    assets: readonly GeometryAssetBlobInput[] = [],
  ): Promise<ModelingDocumentFileMutationResult> {
    if (!adapter.restoreAuthoredModelDocument) {
      return {
        ok: false,
        diagnostics: [
          createDocumentFileDiagnostic(
            'document-import-unsupported-adapter',
            'The active modeling adapter cannot restore authored documents.',
          ),
        ],
      }
    }

    const normalized = normalizeImportedDocument(document)
    if (!normalized.ok) {
      return normalized
    }

    const activeDocument = normalized.document
    let restoreDiagnostics: ModelingDiagnostic[] = []

    if (documentRepository) {
      await documentRepository.reset(currentDocumentId)
      const writeResult = await documentRepository.mutate({
        documentId: currentDocumentId,
        document: activeDocument,
        assets,
      })

      if (!writeResult.ok) {
        canPersistAuthoredDocument = false
        return {
          ok: false,
          diagnostics: [createDocumentRepositoryDiagnostic(writeResult.status)],
        }
      }

      markRepositorySnapshotFresh(writeResult.metadata)
      restoreDiagnostics = writeResult.diagnostics ?? []
    }

    await restoreAuthoredRepositoryDocument(activeDocument, restoreDiagnostics, assets)
    operationHistoryStore?.clear()
    operationHistoryPayload = createEmptyOperationHistory(currentDocumentId)
    canPersistOperationHistory = true
    canPersistAuthoredDocument = true
    historyRestoreState = { kind: 'restored', entriesReplayed: 0, diagnostics: [] }

    const snapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
      currentDocumentId,
    )

    return {
      ok: true,
      revisionId: snapshot.document.revisionId,
      diagnostics: snapshot.document.diagnostics,
    }
  }

  async function createRepositoryHeadConflictResult<
    T extends {
      revisionId: RevisionId
      revisionState: MutationRevisionState
      rebuildResult: RebuildResult
      changedTargets: PrimitiveRef[]
      diagnostics: ModelingDiagnostic[]
    },
  >(result: T, input: { baseRepositoryHeads?: readonly string[] }): Promise<T> {
    await repositoryChangePromise
    const snapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
      currentDocumentId,
    )
    const diagnostics = result.diagnostics.some((diagnostic) => diagnostic.code === 'repository-head-conflict')
      ? result.diagnostics
      : addRepositoryFreshnessDiagnostic(result, input).diagnostics
    const expectedRevisionId = result.revisionState.kind === 'accepted'
      ? result.revisionState.baseRevisionId
      : result.revisionId

    return {
      ...result,
      revisionId: snapshot.revisionId,
      revisionState: {
        kind: 'conflict',
        expectedRevisionId,
        actualRevisionId: snapshot.revisionId,
      },
      rebuildResult: {
        kind: 'skipped',
        reasonCode: 'revisionConflict',
        invalidatedTargets: [],
        diagnostics,
      },
      changedTargets: [],
      diagnostics,
    }
  }

  async function finalizeMutationResult<T extends {
    revisionId: RevisionId
    revisionState: MutationRevisionState
    rebuildResult: RebuildResult
    changedTargets: PrimitiveRef[]
    diagnostics: ModelingDiagnostic[]
  }>(
    response: ModelingOperationResult,
    result: T,
    input: { baseRepositoryHeads?: readonly string[] },
    createHistoryEntry: (() => ModelingOperationHistoryEntry) | null,
  ): Promise<T> {
    const repositoryConflict = repositoryHeadsChangedSinceBasis(input)
    const freshResult = repositoryConflict ? addRepositoryFreshnessDiagnostic(result, input) : result

    if (!isAcceptedMutation(response)) {
      return freshResult
    }

    if (repositoryConflict) {
      return createRepositoryHeadConflictResult(freshResult, input)
    }

    if (createHistoryEntry) {
      appendOperationHistoryEntry(createHistoryEntry())
    }

    return persistAcceptedAuthoredDocument(freshResult)
  }

  function notifyModelingDocumentChange(event: DocumentRepositoryChangeEvent) {
    const serviceEvent: ModelingServiceDocumentChangeEvent = {
      documentId: currentDocumentId,
      metadata: event.metadata,
    }
    for (const listener of documentChangeListeners) {
      listener(serviceEvent)
    }
  }

  documentRepository?.subscribe(currentDocumentId, (event) => {
    if (isRestoringRepositoryDocument) {
      return
    }

    rememberRepositoryMetadata(event.metadata)
    if (event.metadata.source !== 'peer') {
      notifyModelingDocumentChange(event)
      return
    }

    repositoryChangePromise = repositoryChangePromise.then(async () => {
      await restoreAuthoredRepositoryDocument(event.document, event.diagnostics)
      notifyModelingDocumentChange(event)
    })
  })

  async function replayOperationHistoryPayload(loadResultPayload: ModelingOperationHistoryPayload) {
    operationHistoryPayload = structuredClone(loadResultPayload)
    let replayCursor = await getAdapterReplayCursor(adapter, currentDocumentId)

    for (const [entryIndex, entry] of loadResultPayload.entries.entries()) {
      const { response, cursor } = await replayHistoryEntry({
        adapter,
        documentId: currentDocumentId,
        entry,
        entryIndex,
        cursor: replayCursor,
      })
      replayCursor = cursor

      if (!isAcceptedMutation(response)) {
        canPersistOperationHistory = false
        historyRestoreState = createRestoreFailure(
          response.revisionState.kind === 'rejected'
            ? response.revisionState.reasonCode
            : 'revision-conflict',
          `Operation history replay failed at entry ${entryIndex}.`,
          entryIndex,
          entryIndex,
        )
        return
      }

      historyRestoreState = {
        kind: 'restored',
        entriesReplayed: entryIndex + 1,
        diagnostics: [],
      }
    }

    historyRestoreState = loadResultPayload.entries.length === 0
      ? { kind: 'empty', entriesReplayed: 0, diagnostics: [] }
      : {
          kind: 'restored',
          entriesReplayed: loadResultPayload.entries.length,
          diagnostics: [],
        }
  }

  async function restoreOperationHistoryCompatibility() {
    await getSeedAuthoredDocument()
    const loadResult = loadOrCreateOperationHistory(operationHistoryStore, currentDocumentId)

    if (!loadResult.ok) {
      canPersistOperationHistory = false
      historyRestoreState = createRestoreFailure(loadResult.reasonCode, loadResult.message, null, 0)
      return
    }

    if (loadResult.payload.documentId !== currentDocumentId) {
      canPersistOperationHistory = false
      historyRestoreState = createRestoreFailure(
        'document-id-mismatch',
        'Operation history document identity does not match the active document.',
        null,
        0,
      )
      return
    }

    await replayOperationHistoryPayload(loadResult.payload)
  }

  async function restoreRepositoryBackedDocument() {
    const seedDocument = await getSeedAuthoredDocument()
    const loadResult = await documentRepository!.load({
      documentId: currentDocumentId,
      seedDocument,
    })

    if (!loadResult.ok) {
      canPersistOperationHistory = false
      canPersistAuthoredDocument = false
      historyRestoreState = createRepositoryRestoreFailure(loadResult.status)
      return
    }

    rememberRepositoryMetadata(loadResult.metadata)

    if (loadResult.status.kind === 'restored') {
      await restoreAuthoredRepositoryDocument(loadResult.document, loadResult.diagnostics)
      operationHistoryPayload = createEmptyOperationHistory(currentDocumentId)
      historyRestoreState = { kind: 'restored', entriesReplayed: 0, diagnostics: [] }
      return
    }

    const historyLoadResult = operationHistoryStore?.load()
    if (historyLoadResult && !historyLoadResult.ok) {
      operationHistoryStore?.clear()
      operationHistoryPayload = createEmptyOperationHistory(currentDocumentId)
      historyRestoreState = { kind: 'empty', entriesReplayed: 0, diagnostics: [] }
      return
    }

    if (historyLoadResult?.payload && historyLoadResult.payload.entries.length > 0) {
      if (historyLoadResult.payload.documentId !== currentDocumentId) {
        await documentRepository!.reset(currentDocumentId)
        canPersistOperationHistory = false
        canPersistAuthoredDocument = false
        historyRestoreState = createRestoreFailure(
          'document-id-mismatch',
          'Operation history document identity does not match the active document.',
          null,
          0,
        )
        return
      }

      await replayOperationHistoryPayload(historyLoadResult.payload)
      if (historyRestoreState.kind === 'failed') {
        await documentRepository!.reset(currentDocumentId)
        canPersistAuthoredDocument = false
        return
      }

      const writeResult = await documentRepository!.mutate({
        documentId: currentDocumentId,
        document: await exportAuthoredDocumentForRepository(),
      })
      if (!writeResult.ok) {
        await documentRepository!.reset(currentDocumentId)
        canPersistOperationHistory = false
        canPersistAuthoredDocument = false
        historyRestoreState = createRepositoryRestoreFailure(writeResult.status, historyRestoreState.entriesReplayed)
      }
      if (writeResult.ok) {
        markRepositorySnapshotFresh(writeResult.metadata)
      }
      return
    }

    operationHistoryPayload = createEmptyOperationHistory(currentDocumentId)
    historyRestoreState = { kind: 'empty', entriesReplayed: 0, diagnostics: [] }
  }

  const restorePromise = (async () => {
    if (documentRepository) {
      await restoreRepositoryBackedDocument()
      return
    }

    await restoreOperationHistoryCompatibility()
  })().catch((error: unknown) => {
    canPersistOperationHistory = false
    canPersistAuthoredDocument = false
    historyRestoreState = createRestoreFailure(
      'replay-exception',
      error instanceof Error ? error.message : 'Operation history replay failed unexpectedly.',
      historyRestoreState.entriesReplayed,
      historyRestoreState.entriesReplayed,
    )
  }).finally(() => {
    isRestoringRepositoryDocument = false
  })

  function resetOperationHistory() {
    operationHistoryStore?.clear()
    void documentRepository?.reset(currentDocumentId)
    operationHistoryPayload = createEmptyOperationHistory(currentDocumentId)
    canPersistOperationHistory = true
    canPersistAuthoredDocument = true
    historyRestoreState = {
      kind: 'empty',
      entriesReplayed: 0,
      diagnostics: [],
    }
  }

  function appendOperationHistoryEntry(entry: ModelingOperationHistoryEntry) {
    if (!operationHistoryStore || !canPersistOperationHistory) {
      return
    }

    operationHistoryPayload = {
      ...operationHistoryPayload,
      entries: [...operationHistoryPayload.entries, structuredClone(entry)],
    }

    try {
      operationHistoryStore.save(operationHistoryPayload)
    } catch (error: unknown) {
      canPersistOperationHistory = false
      historyRestoreState = createRestoreFailure(
        'history-write-failed',
        error instanceof Error ? error.message : 'Operation history could not be written.',
        null,
        operationHistoryPayload.entries.length,
      )
    }
  }

  async function persistAcceptedAuthoredDocument<T extends { diagnostics: ModelingDiagnostic[] }>(result: T): Promise<T> {
    if (!documentRepository) {
      return result
    }

    if (!canPersistAuthoredDocument) {
      const status = documentRepository.getRestoreStatus(currentDocumentId)
      return status.kind === 'failed'
        ? {
            ...result,
            diagnostics: [...result.diagnostics, createDocumentRepositoryDiagnostic(status)],
          }
        : result
    }

    const writeResult = await documentRepository.mutate({
      documentId: currentDocumentId,
      document: await exportAuthoredDocumentForRepository(),
    })

    if (writeResult.ok) {
      markRepositorySnapshotFresh(writeResult.metadata)
      return result
    }

    canPersistAuthoredDocument = false
    return {
      ...result,
      diagnostics: [...result.diagnostics, createDocumentRepositoryDiagnostic(writeResult.status)],
    }
  }

  return {
    currentDocumentId,
    sketchSolver,
    subscribeToDocumentChanges(listener) {
      documentChangeListeners.add(listener)
      return () => {
        documentChangeListeners.delete(listener)
      }
    },
    async getHistoryRestoreState() {
      await restorePromise
      await repositoryChangePromise
      return historyRestoreState
    },
    resetOperationHistory,
    setViewportLodTier(tierId) {
      return adapter.setSnapshotLodTier?.(tierId) ?? false
    },
    async getCurrentDocumentSnapshot() {
      await restorePromise
      await repositoryChangePromise
      const response = await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId))
      return attachRepositoryProvenance(validateSnapshotResponse(response, currentDocumentId))
    },
    async createNewDocument() {
      await restorePromise
      await repositoryChangePromise
      return replaceCurrentAuthoredDocument(await getSeedAuthoredDocument())
    },
    async importDocument(input) {
      await restorePromise
      await repositoryChangePromise
      const imported = isCadaraPackagePayload(input.document)
        ? input.document
        : { document: input.document, assets: input.assets ?? [] }
      const normalized = normalizeImportedDocument(imported.document)
      if (!normalized.ok) {
        return normalized
      }

      return replaceCurrentAuthoredDocument(normalized.document, imported.assets)
    },
    async importStepFile(input) {
      await restorePromise
      await repositoryChangePromise
      const imported = await createStepImportAuthoredDocument(input)
      if (!imported.ok) {
        return imported
      }

      return replaceCurrentAuthoredDocument(imported.document, imported.assets)
    },
    async importMeshFile(input) {
      await restorePromise
      await repositoryChangePromise
      const imported = await createMeshImportAuthoredDocument(input)
      if (!imported.ok) {
        return imported
      }

      return replaceCurrentAuthoredDocument(imported.document, imported.assets)
    },
    async bindLocalFile(input) {
      await restorePromise
      await repositoryChangePromise
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return {
          ok: false,
          diagnostics: [
            createDocumentFileDiagnostic(
              'local-file-sync-unsupported-repository',
              'Local file sync is unavailable for the active document repository.',
            ),
          ],
        }
      }

      const result = await documentRepository.bindLocalFile({
        documentId: currentDocumentId,
        handle: input.handle,
        metadata: input.metadata,
      })
      if (!result.ok) {
        return {
          ok: false,
          diagnostics: [
            createDocumentFileDiagnostic('local-file-sync-bind-failed', result.message),
          ],
        }
      }

      const snapshot = validateSnapshotResponse(
        await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
        currentDocumentId,
      )
      return { ok: true, revisionId: snapshot.document.revisionId, diagnostics: [] }
    },
    async restoreLocalFileBinding() {
      await restorePromise
      await repositoryChangePromise
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return null
      }

      return documentRepository.restoreLocalFileBinding(currentDocumentId)
    },
    async getLocalFileSyncStatus() {
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return null
      }

      return documentRepository.getLocalFileSyncStatus(currentDocumentId)
    },
    subscribeToLocalFileSyncStatus(listener) {
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return () => undefined
      }

      return documentRepository.subscribeToLocalFileSyncStatus((status) => {
        if (status.documentId === currentDocumentId) {
          listener(status)
        }
      })
    },
    async exportCurrentDocument() {
      await restorePromise
      await repositoryChangePromise
      const document = await exportAuthoredDocumentForRepository()
      const assets = await collectRepositoryAssetBlobs(documentRepository, document)

      return {
        ok: true,
        format: 'cadara',
        filename: 'document.cadara',
        extension: getDocumentExportExtension('cadara'),
        mimeType: assets.length > 0 ? CADARA_PACKAGE_MIME_TYPE : getDocumentExportMimeType('cadara'),
        payload: createLocalAuthoredDocumentPayload(document, assets),
        diagnostics: [],
      }
    },
    commitSketch(input) {
      return runModelingMutationBoundary({
        operation: 'Commit sketch',
        fallbackMessage: 'Commit sketch failed.',
        requestId: input.solverCorrelation?.requestId,
        context: [{ key: 'baseRevisionId', value: input.baseRevisionId }],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeCommitSketchInput(input, currentDocumentId)
          const response = await adapter.commitSketch(request)
          return finalizeMutationResult(
            response,
            mapCommitSketchResponse(response, currentDocumentId),
            input,
            () => createCommitSketchHistoryEntry(request, response.sketchId),
          )
        },
      })
    },
    async projectSketchExternalReferences(input) {
      await restorePromise
      await repositoryChangePromise
      return adapter.projectSketchExternalReferences(
        withContractVersion<ProjectSketchExternalReferencesRequest>({
          ...input,
          documentId: currentDocumentId,
        }),
      )
    },
    addDocumentVariable(input) {
      return runModelingMutationBoundary({
        operation: 'Add document variable',
        fallbackMessage: 'Add document variable failed.',
        context: [{ key: 'baseRevisionId', value: input.baseRevisionId }],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeAddDocumentVariableInput(input, currentDocumentId)
          const response = await adapter.addDocumentVariable(request)
          return finalizeMutationResult(
            response,
            mapDocumentVariableResponse(response, currentDocumentId),
            input,
            () => createAddDocumentVariableHistoryEntry(request, response.variableId),
          )
        },
      })
    },
    updateDocumentVariable(input) {
      return runModelingMutationBoundary({
        operation: 'Update document variable',
        fallbackMessage: 'Update document variable failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'variableId', value: input.variableId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeUpdateDocumentVariableInput(input, currentDocumentId)
          const response = await adapter.updateDocumentVariable(request)
          return finalizeMutationResult(
            response,
            mapDocumentVariableResponse(response, currentDocumentId),
            input,
            () => createUpdateDocumentVariableHistoryEntry(request),
          )
        },
      })
    },
    createFeature(input) {
      return runModelingMutationBoundary({
        operation: 'Create feature',
        fallbackMessage: 'Create feature failed.',
        context: [{ key: 'baseRevisionId', value: input.baseRevisionId }],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeCreateFeatureInput(input, currentDocumentId)
          const response = await adapter.createFeature(request)
          return finalizeMutationResult(
            response,
            mapFeatureMutationResponse(response, currentDocumentId),
            input,
            () => createCreateFeatureHistoryEntry(request),
          )
        },
      })
    },
    updateFeature(input) {
      return runModelingMutationBoundary({
        operation: 'Update feature',
        fallbackMessage: 'Update feature failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'featureId', value: input.featureId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeUpdateFeatureInput(input, currentDocumentId)
          const response = await adapter.updateFeature(request)
          return finalizeMutationResult(
            response,
            mapFeatureMutationResponse(response, currentDocumentId),
            input,
            () => createUpdateFeatureHistoryEntry(request),
          )
        },
      })
    },
    deleteFeature(input) {
      return runModelingMutationBoundary({
        operation: 'Delete feature',
        fallbackMessage: 'Delete feature failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'featureId', value: input.featureId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeDeleteFeatureInput(input, currentDocumentId)
          const response = await adapter.deleteFeature(request)
          return finalizeMutationResult(
            response,
            mapDeleteFeatureResponse(response, currentDocumentId),
            input,
            () => createDeleteFeatureHistoryEntry(request),
          )
        },
      })
    },
    renameBody(input) {
      return runModelingMutationBoundary({
        operation: 'Rename body',
        fallbackMessage: 'Rename body failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'bodyId', value: input.bodyId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeRenameBodyInput(input, currentDocumentId)
          const response = await adapter.renameBody(request)
          return finalizeMutationResult(
            response,
            mapRenameBodyResponse(response, currentDocumentId),
            input,
            () => createRenameBodyHistoryEntry(request),
          )
        },
      })
    },
    reorderFeature(input) {
      return runModelingMutationBoundary({
        operation: 'Reorder feature',
        fallbackMessage: 'Reorder feature failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'featureId', value: input.featureId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeReorderFeatureInput(input, currentDocumentId)
          const response = await adapter.reorderFeature(request)
          return finalizeMutationResult(
            response,
            mapReorderFeatureResponse(response, currentDocumentId),
            input,
            () => createReorderFeatureHistoryEntry(request),
          )
        },
      })
    },
    reorderDocumentHistory(input) {
      return runModelingMutationBoundary({
        operation: 'Reorder document history',
        fallbackMessage: 'Reorder document history failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'item', value: input.item.kind === 'sketch' ? input.item.sketchId : input.item.featureId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeReorderDocumentHistoryInput(input, currentDocumentId)
          const response = await adapter.reorderDocumentHistory(request)
          return finalizeMutationResult(
            response,
            mapReorderDocumentHistoryResponse(response, currentDocumentId),
            input,
            () => createReorderDocumentHistoryEntry(request),
          )
        },
      })
    },
    setFeatureCursor(input) {
      return runModelingMutationBoundary({
        operation: 'Set feature cursor',
        fallbackMessage: 'Set feature cursor failed.',
        context: [{ key: 'baseRevisionId', value: input.baseRevisionId }],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeSetFeatureCursorInput(input, currentDocumentId)
          const response = await adapter.setFeatureCursor(request)
          return finalizeMutationResult(
            response,
            mapSetFeatureCursorResponse(response, currentDocumentId),
            input,
            input.persistHistory === false ? null : () => createSetFeatureCursorHistoryEntry(request),
          )
        },
      })
    },
    async evaluatePreview(input) {
      await restorePromise
      await repositoryChangePromise
      const response = await adapter.evaluatePreview(normalizePreviewInput(input, currentDocumentId))

      return mapPreviewResponse(response, currentDocumentId)
    },
    async exportDocument(input) {
      await restorePromise
      await repositoryChangePromise
      const request = normalizeExportDocumentInput(input, currentDocumentId)

      if (request.format !== 'cadara') {
        return mapExportDocumentResponse(await adapter.exportDocument(request))
      }

      const snapshot = await validateSnapshotResponse(
        await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
        currentDocumentId,
      )

      if (request.baseRevisionId !== snapshot.document.revisionId) {
        return {
          ok: false,
          format: request.format,
          diagnostics: [
            createExportDiagnostic(
              'export-revision-conflict',
              `Export request revision ${request.baseRevisionId} does not match current revision ${snapshot.document.revisionId}.`,
              request.target,
            ),
          ],
        }
      }

      return mapExportDocumentResponse({
        ok: true,
        format: request.format,
        filename: createExportFilename(request.targetLabel, request.format),
        extension: getDocumentExportExtension(request.format),
        mimeType: getDocumentExportMimeType(request.format),
        payload: stringifyCadaraDocument(snapshot.document, request.options.pretty),
        diagnostics: [],
      })
    },
    async resolveReference(target) {
      await restorePromise
      await repositoryChangePromise
      const response = await adapter.resolveReference(
        normalizeResolveReferenceInput(target, currentDocumentId),
      )

      const normalized = mapResolvedReferenceResponse(response, currentDocumentId)
      return {
        ...normalized,
        resolution: {
          ...normalized.resolution,
          label: getResolutionLabel(normalized.resolution),
        },
      }
    },
  }
}

/**
 * Optional runtime validators for typed modeling payloads.
 * The kernel boundary is statically authoritative; these helpers exist only for
 * callers that want defensive runtime checks around external adapter payloads.
 */
export const modelingRuntimeValidators = {
  revisionState: normalizeRevisionState,
  previewFreshness: normalizePreviewFreshness,
  rebuildResult: normalizeRebuildResult,
  featureTree: normalizeFeatureTree,
  objects: normalizeObjects,
  references: normalizeReferences,
  variables: normalizeDocumentVariables,
  renderables: normalizeRenderables,
  renderExport: (value: unknown) => renderExportSchema.parse(value),
  sketches: normalizeSketches,
  features: normalizeFeatures,
  documentFeatureCursor: normalizeDocumentFeatureCursor,
  bodies: normalizeBodies,
  constructions: normalizeConstructions,
  entities: normalizeEntities,
  resolution: normalizeResolution,
} as const

export function createSketchSolverService(
  adapter: SketchSolverBoundary,
): SketchSolverService {
  return {
    solveSketch(input) {
      return adapter.solveSketch(withContractVersion<SolveSketchRequest>(input))
    },
    validateSketch(input) {
      return adapter.validateSketch(withContractVersion<ValidateSketchRequest>(input))
    },
    deriveSketchRegions(input) {
      return adapter.deriveSketchRegions(withContractVersion<DeriveSketchRegionsRequest>(input))
    },
    projectExternalReferences(input) {
      return adapter.projectExternalReferences(
        withContractVersion<ProjectSketchExternalReferencesRequest>(input),
      )
    },
    resolveSketchReference(input) {
      return adapter.resolveSketchReference(
        withContractVersion<ResolveSketchReferenceRequest>(input),
      )
    },
    createCommitCorrelation(requestId) {
      return {
        requestId,
        projectionRequestId: `${requestId}:project` as RequestId,
        validationRequestId: `${requestId}:validate` as RequestId,
        solveRequestId: `${requestId}:solve` as RequestId,
        regionRequestId: `${requestId}:regions` as RequestId,
      }
    },
  }
}
