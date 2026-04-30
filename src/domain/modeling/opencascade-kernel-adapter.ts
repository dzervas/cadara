import type { GeometryAssetResolver, ModelingKernelAdapter } from '@/contracts/modeling/adapter'
import type { ExportCapabilities } from '@/contracts/export/capabilities'
import type { DocumentExportDiagnostic } from '@/contracts/modeling/export'
import { modelingDocumentRequestEnvelopeSchema } from '@/contracts/modeling/runtime-schema'
import type { SketchSolverAdapter } from '@/contracts/solver/adapter'
import type {
  ProjectedSketchReferenceRecord,
  ProjectSketchExternalReferencesRequest,
  ProjectSketchExternalReferencesResponse,
  SolverTolerancePolicy,
} from '@/contracts/solver/schema'
import { SOLVER_SCHEMA_VERSION } from '@/contracts/solver/schema'
import type {
  CommitSketchRequest,
  CommitSketchResponse,
  AddDocumentVariableRequest,
  AddDocumentVariableResponse,
  CreateFeatureRequest,
  CreateFeatureResponse,
  DeleteDocumentTargetRequest,
  DeleteDocumentTargetResponse,
  DeleteFeatureRequest,
  DeleteFeatureResponse,
  EvaluatePreviewRequest,
  EvaluatePreviewResponse,
  FeatureDefinition,
  GetDocumentSnapshotRequest,
  GetDocumentSnapshotResponse,
  ModelingDiagnostic,
  ModelingDiagnosticDetail,
  RenameBodyRequest,
  RenameBodyResponse,
  ReorderDocumentHistoryRequest,
  ReorderDocumentHistoryResponse,
  ReorderFeatureRequest,
  ReorderFeatureResponse,
  ResolveReferenceRequest,
  ResolveReferenceResponse,
  SetFeatureCursorRequest,
  SetFeatureCursorResponse,
  SketchSnapshotRecord,
  UpdateDocumentVariableRequest,
  UpdateDocumentVariableResponse,
  UpdateFeatureRequest,
  UpdateFeatureResponse,
} from '@/contracts/modeling/schema'
import {
  type AuthoredModelDocument,
} from '@/contracts/modeling/authored-document'
import type { GeometryAssetBlobInput } from '@/contracts/modeling/geometry-assets'
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION, isAdvancedSolidFeatureKind } from '@/contracts/modeling/advanced-solid'
import type {
  BodyId,
  DocumentId,
  DocumentVariableId,
  FeatureId,
  RegionId,
  RequestId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import {
  AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
  CONTRACT_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import type { DurableRef } from '@/contracts/shared/references'
import type {
  RegionRecord,
  SketchDefinition,
  SketchRecord,
  SketchSolveDiagnostic,
} from '@/contracts/sketch/schema'
import {
  applyOccFeatureToAuthoringState,
  createOccAuthoringState,
  type OccAuthoringFeatureRecord,
  type OccAuthoringState,
} from '@/domain/modeling/occ/authoring-state'
import { extractPlanarFaceData } from '@/domain/modeling/occ/planes'
import { OCC_CONTRACT_GAP_CODES } from '@/domain/modeling/occ/implementation-policy'
import { getOpenCascadeInstance, type OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  buildOccSnapshotDiagnostics,
  buildOccWorkspaceSnapshot,
} from '@/domain/modeling/occ/snapshot'
import type { OccTessellationTierId } from '@/domain/modeling/occ/tessellation'
import type { OccWorkerSnapshotClient } from '@/domain/modeling/occ/worker-client'
import { projectSketchExternalReferencesFromSnapshot } from '@/domain/modeling/sketch-reference-projection'
import {
  findDocumentHistoryOrderDependencyViolations,
  getDocumentHistoryOrderEntryKey,
  insertDocumentHistoryOrderEntryAfterCursor,
  reorderDocumentHistoryOrder,
  type DocumentHistoryOrderEntry,
} from '@/domain/modeling/document-history'
import {
  createDocumentVariableExpressionDiagnostics,
  evaluateDocumentVariableExpressions,
} from '@/domain/modeling/document-variable-expressions'
import {
  createDependencyBlockedDiagnostic,
  createFeatureFieldDiagnostic,
} from '@/domain/modeling/feature-diagnostic-mapping'
import {
  getOccDurableRefKey,
  resolveOccReference,
} from '@/domain/modeling/occ/topology'
import { getExtrudeFeatureExtent, getRevolveFeatureExtent } from '@/contracts/modeling/feature-extents'
import { createOccExportCapabilities } from '@/domain/export/occ-export-capabilities'
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
  OCC_KERNEL_PRIMARY_SKETCH_ID,
  OCC_KERNEL_SETTINGS,
} from '@/domain/modeling/opencascade-kernel-seed'

interface OpenCascadeKernelAdapterOptions {
  solverAdapter: SketchSolverAdapter
  solverAdapterFactory?: (revisionId: RevisionId) => SketchSolverAdapter
  getOpenCascadeInstance?: () => Promise<OpenCascadeInstance>
  initialSnapshotRequiresRuntime?: boolean
  workerSnapshotClient?: OccWorkerSnapshotClient | null
  documentId?: DocumentId
  tolerances?: SolverTolerancePolicy
}

interface OccKernelRuntimeState {
  authoringState: OccAuthoringState
  revisionSequence: number
}

interface WorkerRestoredAuthoredDocument {
  document: AuthoredModelDocument
  assets: readonly GeometryAssetBlobInput[]
}

const DEFAULT_SOLVER_TOLERANCES: SolverTolerancePolicy = {
  coincidence: OCC_KERNEL_SETTINGS.modelingTolerance,
  angleRadians: OCC_KERNEL_SETTINGS.angularToleranceRadians,
  minimumSegmentLength: OCC_KERNEL_SETTINGS.modelingTolerance,
}

const OCC_REVISION_CONFLICT_CODE = 'occ-revision-conflict'
const OCC_VALIDATION_ERROR_CODE = 'occ-validation-error'
const OCC_MISSING_FEATURE_CODE = 'occ-missing-feature'
const OCC_MISSING_BODY_CODE = 'occ-missing-body'
const OCC_MISSING_REORDER_ANCHOR_CODE = 'occ-missing-reorder-anchor'
const OCC_REBUILD_FAILURE_CODE = 'occ-rebuild-failure'
const OCC_STALE_PREVIEW_CODE = 'occ-stale-preview'
const OCC_REBUILD_DIAGNOSTIC_CODES = new Set<string>([
  ...Object.values(OCC_CONTRACT_GAP_CODES),
  'unsupported-profile-group',
  'advanced-feature-unsupported-kernel-case',
])
function assertSupportedModelingRequest(
  request: {
    contractVersion: string
    documentId: string
  },
  documentId: DocumentId,
) {
  const parsed = modelingDocumentRequestEnvelopeSchema.safeParse(request)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid modeling request envelope.')
  }

  if (request.documentId !== documentId) {
    throw new Error(`Unsupported document ${request.documentId}; expected ${documentId}.`)
  }
}

function parseRevisionSequence(revisionId: RevisionId) {
  const match = /^rev_(\d+)$/.exec(revisionId)

  if (!match) {
    throw new Error(`Unsupported revision format ${revisionId}.`)
  }

  return Number.parseInt(match[1]!, 10)
}

function createRevisionId(sequence: number) {
  return `rev_${String(sequence).padStart(4, '0')}` as RevisionId
}

function createAuthoredModelDocumentFromAuthoringState(
  state: OccAuthoringState,
): AuthoredModelDocument {
  return {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
    documentId: state.documentId,
    revisionId: state.revisionId,
    settings: {
      linearUnit: OCC_KERNEL_SETTINGS.linearUnit,
      modelingTolerance: state.modelingTolerance,
      angularToleranceRadians: OCC_KERNEL_SETTINGS.angularToleranceRadians,
    },
    variables: structuredClone([...state.variables]),
    sketches: state.sketches.map((sketch) => ({
      sketchId: sketch.sketchId,
      label: sketch.label,
      plane: structuredClone(sketch.plane),
      planeTarget: structuredClone(sketch.planeTarget),
      planeKey: sketch.planeKey,
      definition: structuredClone(sketch.sketch.definition),
    })),
    features: state.features.map((feature) => ({
      featureId: feature.featureId,
      label: feature.label ?? feature.featureId,
      definition: structuredClone(feature.definition),
    })),
    featureOrder: state.features.map((feature) => feature.featureId),
    historyOrder: state.historyOrder.map((item) => ({ ...item })),
    cursor: structuredClone(state.cursor),
    bodyLabels: state.bodies.map((body) => ({
      bodyId: body.bodyId,
      label: body.label,
    })),
    assets: structuredClone(state.assets),
    embeddedBinaryAssets: [...structuredClone(state.embeddedBinaryAssets)],
  }
}

function createRevisionConflictDiagnostic(
  expectedRevisionId: RevisionId,
  actualRevisionId: RevisionId,
): ModelingDiagnostic {
  return {
    code: OCC_REVISION_CONFLICT_CODE,
    severity: 'error',
    message: `Request revision ${expectedRevisionId} does not match current revision ${actualRevisionId}.`,
    target: null,
    detail: {
      kind: 'revisionConflict',
      expectedRevisionId,
      actualRevisionId,
    },
  }
}

function createDiagnostic(
  code: string,
  severity: ModelingDiagnostic['severity'],
  message: string,
  target: ModelingDiagnostic['target'],
  detail: ModelingDiagnosticDetail | null = null,
): ModelingDiagnostic {
  return {
    code,
    severity,
    message,
    target,
    detail,
  }
}

function createMissingFeatureDiagnostic(featureId: FeatureId): ModelingDiagnostic {
  return createDiagnostic(
    OCC_MISSING_FEATURE_CODE,
    'error',
    `Feature ${featureId} does not resolve in the current OCC authoring state.`,
    { kind: 'feature', featureId },
  )
}

function createMissingBodyDiagnostic(bodyId: BodyId): ModelingDiagnostic {
  return createDiagnostic(
    OCC_MISSING_BODY_CODE,
    'error',
    `Body ${bodyId} does not resolve in the current OCC authoring state.`,
    { kind: 'body', bodyId },
  )
}

function createMissingSketchDiagnostic(sketchId: SketchId): ModelingDiagnostic {
  return createDiagnostic(
    'occ-missing-sketch',
    'error',
    `Sketch ${sketchId} does not resolve in the current OCC authoring state.`,
    { kind: 'sketch', sketchId },
  )
}

function createUnsupportedDeleteTargetDiagnostic(target: DurableRef): ModelingDiagnostic {
  return createDiagnostic(
    'occ-unsupported-delete-target',
    'error',
    `Target ${getOccDurableRefKey(target)} cannot be deleted by generic document deletion.`,
    target,
  )
}

function createMissingReorderAnchorDiagnostic(featureId: FeatureId): ModelingDiagnostic {
  return createDiagnostic(
    OCC_MISSING_REORDER_ANCHOR_CODE,
    'error',
    `Feature reorder anchor ${featureId} does not resolve in the current OCC authoring state.`,
    { kind: 'feature', featureId },
  )
}

function createMissingDocumentHistoryItemDiagnostic(item: ReorderDocumentHistoryRequest['item']): ModelingDiagnostic {
  return createDiagnostic(
    'occ-missing-document-history-item',
    'error',
    `Document history item ${getDocumentHistoryOrderEntryKey(item)} does not resolve in the current OCC authoring state.`,
    item.kind === 'sketch'
      ? { kind: 'sketch', sketchId: item.sketchId }
      : { kind: 'feature', featureId: item.featureId },
  )
}

function createMissingDocumentHistoryAnchorDiagnostic(
  item: ReorderDocumentHistoryRequest['beforeItem'],
): ModelingDiagnostic {
  return createDiagnostic(
    'occ-missing-document-history-anchor',
    'error',
    `Document history anchor ${item === null ? 'tail' : getDocumentHistoryOrderEntryKey(item)} does not resolve in the current OCC authoring state.`,
    item === null
      ? null
      : item.kind === 'sketch'
        ? { kind: 'sketch', sketchId: item.sketchId }
        : { kind: 'feature', featureId: item.featureId },
  )
}

function createDocumentHistoryDependencyOrderDiagnostic(
  violation: ReturnType<typeof findDocumentHistoryOrderDependencyViolations>[number],
): ModelingDiagnostic {
  return createDiagnostic(
    'occ-document-history-dependency-order',
    'error',
    `Document history places ${violation.featureKey} before its dependency ${violation.dependencyKey}.`,
    { kind: 'feature', featureId: violation.featureId },
  )
}

function createValidationDiagnostic(
  message: string,
  target: ModelingDiagnostic['target'] = null,
): ModelingDiagnostic {
  return createDiagnostic(OCC_VALIDATION_ERROR_CODE, 'error', message, target)
}

function createInvalidReferenceDiagnostic(
  resolution: ResolveReferenceResponse['resolution'],
  feature?: OccAuthoringFeatureRecord,
): ModelingDiagnostic {
  const diagnostic = createDiagnostic(
    resolution.invalidation?.reason ?? 'occ-invalid-reference',
    'error',
    'Requested durable reference does not resolve in the current OCC authoring state.',
    resolution.target,
    resolution.invalidation === null
      ? null
      : {
          kind: 'invalidReference',
          reference: resolution.invalidation,
        },
  )

  return feature
    ? createFeatureFieldDiagnostic({
        code: diagnostic.code,
        feature,
        target: diagnostic.target,
        detail: diagnostic.detail,
      })
    : diagnostic
}

function createRebuildFailureDiagnostic(
  code: string,
  message: string,
  affectedFeatureIds: FeatureId[],
  affectedTargets: NonNullable<ModelingDiagnostic['target']>[],
  feature?: OccAuthoringFeatureRecord,
): ModelingDiagnostic {
  const diagnostic = createDiagnostic(
    code,
    'error',
    message,
    affectedTargets[0] ?? null,
    {
      kind: 'rebuildFailure',
      affectedFeatureIds,
      affectedTargets,
    },
  )

  return feature
    ? createFeatureFieldDiagnostic({
        code: diagnostic.code,
        feature,
        target: diagnostic.target,
        detail: diagnostic.detail,
      })
    : diagnostic
}

function createAdvancedUnsupportedDiagnostic(
  featureId: FeatureId,
  message: string,
): ModelingDiagnostic {
  return createDiagnostic(
    'advanced-feature-unsupported-kernel-case',
    'error',
    message,
    { kind: 'feature', featureId },
    {
      kind: 'advancedFeatureValidation',
      diagnostic: {
        code: 'advanced-feature-unsupported-kernel-case',
        severity: 'error',
        message,
        role: null,
        target: null,
      },
    },
  )
}

function createOccExportDiagnostic(
  code: string,
  message: string,
  target: DocumentExportDiagnostic['target'],
): DocumentExportDiagnostic {
  return {
    code,
    severity: 'error',
    message,
    target,
  }
}

function mapSketchSolverDiagnostic(
  sketchId: SketchId,
  diagnostic: SketchSolveDiagnostic,
): ModelingDiagnostic {
  return createDiagnostic(
    `occ-solver:${diagnostic.code}`,
    diagnostic.severity,
    diagnostic.message,
    diagnostic.target?.kind === 'entity'
      ? { kind: 'sketchEntity', sketchId, entityId: diagnostic.target.entityId as SketchEntityId }
      : diagnostic.target?.kind === 'point'
        ? { kind: 'sketchPoint', sketchId, pointId: diagnostic.target.pointId as SketchPointId }
        : diagnostic.target?.kind === 'region'
          ? { kind: 'region', sketchId, regionId: diagnostic.target.regionId as RegionId }
          : null,
  )
}

function normalizeSketchDefinitionForSketchId(
  definition: SketchDefinition,
  sketchId: SketchId,
): SketchDefinition {
  const normalizeOperationGraph = (
    graph: NonNullable<NonNullable<SketchDefinition['authoringOperations']>[number]['createdGraph']> | undefined,
  ) => graph
    ? {
        ...graph,
        points: graph.points?.map((point) => ({
          ...point,
          target: {
            ...point.target,
            sketchId,
          },
        })),
        entities: graph.entities?.map((entity) => ({
          ...entity,
          target: {
            ...entity.target,
            sketchId,
          },
        })),
      }
    : undefined

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
    authoringOperations: definition.authoringOperations?.map((operation) => {
      const { createdGraph, removedGraph, ...rest } = operation
      const normalizedCreatedGraph = normalizeOperationGraph(createdGraph)
      const normalizedRemovedGraph = normalizeOperationGraph(removedGraph)

      return {
        ...rest,
        ...(normalizedCreatedGraph ? { createdGraph: normalizedCreatedGraph } : {}),
        ...(normalizedRemovedGraph ? { removedGraph: normalizedRemovedGraph } : {}),
      }
    }),
  }
}

function normalizeDerivedRegionsForSketchId(
  regions: readonly RegionRecord[],
  sketchId: SketchId,
  revisionId: RevisionId,
): RegionRecord[] {
  return regions.map((region) => ({
    ...region,
    ownerRevisionId: revisionId,
    ownerSketchId: sketchId,
    target: {
      ...region.target,
      sketchId,
    },
    sourceSketch: {
      ...region.sourceSketch,
      sketchId,
    },
  }))
}

function buildSketchSnapshotRecord(
  request: CommitSketchRequest,
  sketchId: SketchId,
  revisionId: RevisionId,
  definition: SketchDefinition,
  regions: readonly RegionRecord[],
  solvedSnapshot: SketchRecord['solvedSnapshot'],
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchSnapshotRecord {
  const sketch: SketchRecord = {
    ownerDocumentId: request.documentId,
    ownerRevisionId: revisionId,
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    sketchId,
    label: request.sketchLabel,
    planeSupport: request.plane.support,
    definition,
    solvedSnapshot,
    projectedReferences: structuredClone([...projectedReferences]),
    regions: [...regions],
  }

  return {
    ownerDocumentId: request.documentId,
    ownerRevisionId: revisionId,
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    sketchId,
    label: request.sketchLabel,
    plane: request.plane,
    planeTarget: request.plane.support,
    planeKey: request.plane.key,
    sketch,
  }
}

function buildSketchChangedTargets(sketch: SketchSnapshotRecord) {
  return [
    { kind: 'sketch', sketchId: sketch.sketchId } as const,
    ...sketch.sketch.regions.map((region) => region.target),
    ...sketch.sketch.definition.entities.map((entity) => ({
      kind: 'sketchEntity' as const,
      sketchId: sketch.sketchId,
      entityId: entity.entityId,
    })),
    ...sketch.sketch.definition.points.map((point) => ({
      kind: 'sketchPoint' as const,
      sketchId: sketch.sketchId,
      pointId: point.pointId,
    })),
  ]
}

function hasReferenceImageOperationState(definition: SketchDefinition) {
  return (definition.authoringOperations ?? []).some((operation) =>
    operation.kind === 'referenceImage'
    || operation.ownedState?.kind === 'referenceImage',
  )
}

function canPersistSketchSolveState(definition: SketchDefinition, solvedSnapshot: SketchRecord['solvedSnapshot']) {
  if (solvedSnapshot.status.solveState === 'solved') {
    return true
  }

  return solvedSnapshot.status.solveState === 'notEvaluated'
    && definition.points.length === 0
    && definition.entities.length === 0
    && hasReferenceImageOperationState(definition)
}

function createRestoreSolverCorrelation(sketchId: SketchId, revisionId: RevisionId) {
  const requestId = `request_restore_${sketchId}_${revisionId}` as RequestId

  return {
    requestId,
    projectionRequestId: `${requestId}_project` as RequestId,
    validationRequestId: `${requestId}_validate` as RequestId,
    solveRequestId: `${requestId}_solve` as RequestId,
    regionRequestId: `${requestId}_regions` as RequestId,
  }
}

function createRestoreSolverTolerances(
  document: AuthoredModelDocument,
  fallback: SolverTolerancePolicy,
): SolverTolerancePolicy {
  return {
    ...fallback,
    coincidence: document.settings.modelingTolerance,
    angleRadians: document.settings.angularToleranceRadians,
    minimumSegmentLength: document.settings.modelingTolerance,
  }
}

function createAuthoredHistoryRestoreOrder(
  document: AuthoredModelDocument,
): OccAuthoringState['historyOrder'] {
  const sketchById = new Set(document.sketches.map((sketch) => sketch.sketchId))
  const featureById = new Set(document.features.map((feature) => feature.featureId))
  const seen = new Set<string>()
  const order: DocumentHistoryOrderEntry[] = []

  const pushSketch = (sketchId: SketchId) => {
    const key = `sketch:${sketchId}`
    if (!sketchById.has(sketchId) || seen.has(key)) {
      return
    }

    seen.add(key)
    order.push({ kind: 'sketch', sketchId })
  }

  const pushFeature = (featureId: FeatureId) => {
    const key = `feature:${featureId}`
    if (!featureById.has(featureId) || seen.has(key)) {
      return
    }

    seen.add(key)
    order.push({ kind: 'feature', featureId })
  }

  for (const item of document.historyOrder ?? []) {
    if (item.kind === 'sketch') {
      pushSketch(item.sketchId)
      continue
    }

    pushFeature(item.featureId)
  }

  for (const sketch of document.sketches) {
    pushSketch(sketch.sketchId)
  }

  for (const featureId of document.featureOrder) {
    pushFeature(featureId)
  }

  return order
}

async function resolveGeometryAssetBlobs(
  document: AuthoredModelDocument,
  assetResolver?: GeometryAssetResolver,
) {
  const assetBlobs = new Map<AuthoredModelDocument['assets']['records'][number]['hash'], Uint8Array>()
  if (!assetResolver) {
    return assetBlobs
  }

  for (const asset of document.assets.records) {
    const bytes = await assetResolver.getGeometryAssetBytes(asset.hash)
    if (bytes) {
      assetBlobs.set(asset.hash, bytes.slice())
    }
  }

  return assetBlobs
}

function createGeometryAssetBlobInputs(
  document: AuthoredModelDocument,
  assetBlobs: ReadonlyMap<AuthoredModelDocument['assets']['records'][number]['hash'], Uint8Array>,
) {
  const assets: GeometryAssetBlobInput[] = []
  for (const asset of document.assets.records) {
    const bytes = assetBlobs.get(asset.hash)
    if (bytes) {
      assets.push({ asset, bytes: bytes.slice() })
    }
  }
  return assets
}

function createInMemoryGeometryAssetResolver(
  assets: readonly GeometryAssetBlobInput[],
): GeometryAssetResolver | undefined {
  if (assets.length === 0) {
    return undefined
  }

  const blobs = new Map(assets.map((asset) => [asset.asset.hash, asset.bytes.slice()] as const))
  return {
    async getGeometryAssetBytes(hash) {
      return blobs.get(hash)?.slice() ?? null
    },
  }
}

function capitalizeFeatureKind(kind: FeatureDefinition['kind']) {
  return `${kind[0]!.toUpperCase()}${kind.slice(1)}`
}

function allocateSketchId(state: OccAuthoringState) {
  if (!state.sketches.some((sketch) => sketch.sketchId === OCC_KERNEL_PRIMARY_SKETCH_ID)) {
    return OCC_KERNEL_PRIMARY_SKETCH_ID
  }

  let maxOrdinal = 1
  for (const sketch of state.sketches) {
    const match = /^sketch_(\d+)$/.exec(sketch.sketchId)
    if (match) {
      maxOrdinal = Math.max(maxOrdinal, Number.parseInt(match[1]!, 10))
    }
  }

  return `sketch_${maxOrdinal + 1}` as SketchId
}

function allocateFeatureId(
  state: OccAuthoringState,
  kind: FeatureDefinition['kind'],
) {
  const pattern = new RegExp(`^feature_${kind}-(\\d+)$`)
  let maxOrdinal = 0

  for (const feature of state.features) {
    const match = pattern.exec(feature.featureId)

    if (match) {
      maxOrdinal = Math.max(maxOrdinal, Number.parseInt(match[1]!, 10))
    }
  }

  return `feature_${kind}-${maxOrdinal + 1}` as FeatureId
}

function allocateDocumentVariableId(state: OccAuthoringState) {
  let maxOrdinal = 0

  for (const variable of state.variables) {
    const match = /^variable_(\d+)$/.exec(variable.variableId)
    if (match) {
      maxOrdinal = Math.max(maxOrdinal, Number.parseInt(match[1]!, 10))
    }
  }

  return `variable_${maxOrdinal + 1}` as DocumentVariableId
}

function featureOrdinalForLabel(
  state: OccAuthoringState,
  kind: FeatureDefinition['kind'],
) {
  return state.features.filter((feature) => feature.definition.kind === kind).length + 1
}

function isValidFeatureCursor(state: OccAuthoringState, cursor: OccAuthoringState['cursor']) {
  if (cursor.kind === 'empty') {
    return true
  }

  if (cursor.kind === 'sketch') {
    return state.sketches.some((sketch) => sketch.sketchId === cursor.sketchId)
  }

  return state.features.some((feature) => feature.featureId === cursor.featureId)
}

function getCursorInsertionIndex(
  cursor: OccAuthoringState['cursor'],
  features: readonly OccAuthoringFeatureRecord[],
  historyOrder?: OccAuthoringState['historyOrder'],
) {
  if (cursor.kind === 'empty') {
    return 0
  }

  if (!historyOrder) {
    if (cursor.kind === 'sketch') {
      return 0
    }

    const index = features.findIndex((feature) => feature.featureId === cursor.featureId)
    return index < 0 ? features.length : index + 1
  }

  const cursorIndex = historyOrder.findIndex((item) =>
    cursor.kind === 'sketch'
      ? item.kind === 'sketch' && item.sketchId === cursor.sketchId
      : item.kind === 'feature' && item.featureId === cursor.featureId,
  )
  if (cursorIndex < 0) {
    return cursor.kind === 'feature'
      ? Math.max(features.findIndex((feature) => feature.featureId === cursor.featureId) + 1, 0)
      : features.length
  }

  const appliedFeatureIds = new Set(
    historyOrder.slice(0, cursorIndex + 1)
      .filter((item): item is Extract<OccAuthoringState['historyOrder'][number], { kind: 'feature' }> =>
        item.kind === 'feature',
      )
      .map((item) => item.featureId),
  )
  return features.filter((feature) => appliedFeatureIds.has(feature.featureId)).length
}

function getAppliedFeatures(
  features: readonly OccAuthoringFeatureRecord[],
  cursor: OccAuthoringState['cursor'],
  historyOrder?: OccAuthoringState['historyOrder'],
) {
  if (cursor.kind === 'empty') {
    return []
  }

  if (!historyOrder) {
    if (cursor.kind === 'sketch') {
      return []
    }

    const cursorIndex = features.findIndex((feature) => feature.featureId === cursor.featureId)
    return cursorIndex < 0 ? features : features.slice(0, cursorIndex + 1)
  }

  const cursorIndex = historyOrder.findIndex((item) =>
    cursor.kind === 'sketch'
      ? item.kind === 'sketch' && item.sketchId === cursor.sketchId
      : item.kind === 'feature' && item.featureId === cursor.featureId,
  )
  if (cursorIndex < 0) {
    return cursor.kind === 'feature' ? features : []
  }

  const appliedFeatureIds = new Set(
    historyOrder.slice(0, cursorIndex + 1)
      .filter((item): item is Extract<OccAuthoringState['historyOrder'][number], { kind: 'feature' }> =>
        item.kind === 'feature',
      )
      .map((item) => item.featureId),
  )
  return features.filter((feature) => appliedFeatureIds.has(feature.featureId))
}

function reorderFeaturesByDocumentHistory(
  features: readonly OccAuthoringFeatureRecord[],
  historyOrder: readonly DocumentHistoryOrderEntry[],
) {
  const featuresById = new Map(features.map((feature) => [feature.featureId, feature]))
  const seen = new Set<FeatureId>()
  const ordered: OccAuthoringFeatureRecord[] = []

  for (const item of historyOrder) {
    if (item.kind !== 'feature') {
      continue
    }

    const feature = featuresById.get(item.featureId)
    if (feature && !seen.has(feature.featureId)) {
      ordered.push(feature)
      seen.add(feature.featureId)
    }
  }

  for (const feature of features) {
    if (!seen.has(feature.featureId)) {
      ordered.push(feature)
    }
  }

  return ordered
}

function getDeleteTargetHistoryEntry(target: DurableRef): DocumentHistoryOrderEntry | null {
  if (target.kind === 'sketch') {
    return { kind: 'sketch', sketchId: target.sketchId }
  }

  if (target.kind === 'feature') {
    return { kind: 'feature', featureId: target.featureId }
  }

  return null
}

function deleteDocumentHistoryOrderEntry(
  historyOrder: readonly DocumentHistoryOrderEntry[],
  item: DocumentHistoryOrderEntry,
): DocumentHistoryOrderEntry[] {
  const itemKey = getDocumentHistoryOrderEntryKey(item)
  return historyOrder.filter((entry) => getDocumentHistoryOrderEntryKey(entry) !== itemKey)
}

function documentHistoryOrderContainsCursor(
  historyOrder: readonly DocumentHistoryOrderEntry[],
  cursor: OccAuthoringState['cursor'],
) {
  if (cursor.kind === 'empty') {
    return true
  }

  return historyOrder.some((entry) =>
    cursor.kind === 'sketch'
      ? entry.kind === 'sketch' && entry.sketchId === cursor.sketchId
      : entry.kind === 'feature' && entry.featureId === cursor.featureId,
  )
}

function createTailCursorFromHistoryOrder(
  historyOrder: readonly DocumentHistoryOrderEntry[],
): OccAuthoringState['cursor'] {
  const tail = historyOrder.at(-1)
  if (!tail) {
    return { kind: 'empty' }
  }

  return tail.kind === 'sketch'
    ? { kind: 'sketch', sketchId: tail.sketchId }
    : { kind: 'feature', featureId: tail.featureId }
}

function repairCursorAfterHistoryDeletion(
  cursor: OccAuthoringState['cursor'],
  historyOrder: readonly DocumentHistoryOrderEntry[],
) {
  return documentHistoryOrderContainsCursor(historyOrder, cursor)
    ? cursor
    : createTailCursorFromHistoryOrder(historyOrder)
}

function createDeleteSolidDefinition(bodyId: BodyId): FeatureDefinition {
  return {
    kind: 'deleteSolid',
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [{ role: 'body', targets: [{ kind: 'body', bodyId }] }],
      options: {},
    },
  }
}

function uniqueTargets(targets: readonly NonNullable<ModelingDiagnostic['target']>[]) {
  const seen = new Set<string>()
  const result: NonNullable<ModelingDiagnostic['target']>[] = []

  for (const target of targets) {
    const key = getOccDurableRefKey(target)

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(target)
  }

  return result
}

function bodyIdLooksOwnedByFeature(bodyId: BodyId, featureId: FeatureId) {
  return bodyId === `body_${featureId}` || bodyId.startsWith(`body_${featureId}_`)
}

function targetLooksOwnedByFeature(target: DurableRef, featureId: FeatureId) {
  switch (target.kind) {
    case 'feature':
      return target.featureId === featureId
    case 'body':
    case 'face':
    case 'edge':
    case 'vertex':
    case 'loop':
      return bodyIdLooksOwnedByFeature(target.bodyId, featureId)
    default:
      return false
  }
}

interface FailedFeatureRecord {
  featureId: FeatureId
  featureLabel: string
  affectedTargets: readonly DurableRef[]
}

function targetsOverlap(left: DurableRef, right: DurableRef) {
  if (getOccDurableRefKey(left) === getOccDurableRefKey(right)) {
    return true
  }

  if ('bodyId' in left && 'bodyId' in right) {
    return left.bodyId === right.bodyId
  }

  return false
}

function targetBlockedByFailedFeature(target: DurableRef, failedFeature: FailedFeatureRecord) {
  return targetLooksOwnedByFeature(target, failedFeature.featureId)
    || failedFeature.affectedTargets.some((affectedTarget) => targetsOverlap(affectedTarget, target))
}

function findBlockingFeature(
  failedFeatures: readonly FailedFeatureRecord[],
  feature: OccAuthoringFeatureRecord,
) {
  for (const target of getFeatureConsumedTargets(feature.definition)) {
    for (const failedFeature of failedFeatures) {
      if (targetBlockedByFailedFeature(target, failedFeature)) {
        return failedFeature
      }
    }
  }

  return null
}

function createFailedFeatureRecord(feature: OccAuthoringFeatureRecord): FailedFeatureRecord {
  return {
    featureId: feature.featureId,
    featureLabel: feature.label ?? feature.featureId,
    affectedTargets: uniqueTargets(getFeatureConsumedTargets(feature.definition)),
  }
}

function getPersistentAuthoringDiagnostics(diagnostics: readonly ModelingDiagnostic[]) {
  return diagnostics.filter((diagnostic) => diagnostic.featureId == null)
}

function mergeModelingDiagnostics(
  existing: readonly ModelingDiagnostic[],
  additional: readonly ModelingDiagnostic[],
) {
  const merged: ModelingDiagnostic[] = [...existing]
  const seen = new Set(existing.map((diagnostic) => `${diagnostic.code}|${diagnostic.featureId ?? ''}|${diagnostic.message}`))
  for (const diagnostic of additional) {
    const key = `${diagnostic.code}|${diagnostic.featureId ?? ''}|${diagnostic.message}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    merged.push(diagnostic)
  }

  return merged
}

function getNewInvalidatedTargets(
  previous: OccAuthoringState,
  next: OccAuthoringState,
) {
  const previousKeys = new Set(previous.referenceState.invalidatedReferencesByKey.keys())

  return Array.from(next.referenceState.invalidatedReferencesByKey.entries())
    .filter(([key]) => !previousKeys.has(key))
    .map(([, resolution]) => resolution.target)
}

function buildPreviewRenderRecords(
  records: ReturnType<typeof buildOccWorkspaceSnapshot>['render']['records'],
  previewFeatureId: FeatureId,
) {
  return records.filter((record) => record.ownerFeatureId === previewFeatureId)
}

function filterPreviewInvalidationDiagnostics(
  previousState: OccAuthoringState,
  previewState: OccAuthoringState,
  diagnostics: readonly ModelingDiagnostic[],
) {
  const previewInvalidationKeys = new Set(
    getNewInvalidatedTargets(previousState, previewState).map((target) => getOccDurableRefKey(target)),
  )

  return diagnostics.filter((diagnostic) => {
    if (diagnostic.code !== 'occ-invalid-reference' || diagnostic.target === null) {
      return true
    }

    return !previewInvalidationKeys.has(getOccDurableRefKey(diagnostic.target))
  })
}

function createDefaultSolverCorrelation(sketchId: SketchId, revisionId: RevisionId) {
  const revisionSuffix = revisionId.replace(/[^a-zA-Z0-9]+/g, '_')
  const sketchSuffix = sketchId.replace(/[^a-zA-Z0-9]+/g, '_')

  return {
    requestId: `request_commit_${sketchSuffix}_${revisionSuffix}` as const,
    projectionRequestId: `request_project_${sketchSuffix}_${revisionSuffix}` as const,
    validationRequestId: `request_validate_${sketchSuffix}_${revisionSuffix}` as const,
    solveRequestId: `request_solve_${sketchSuffix}_${revisionSuffix}` as const,
    regionRequestId: `request_regions_${sketchSuffix}_${revisionSuffix}` as const,
  }
}

function createStalePreviewDiagnostic(
  previewId: EvaluatePreviewRequest['previewId'],
  requestedRevisionId: RevisionId,
  currentRevisionId: RevisionId,
): ModelingDiagnostic {
  return createDiagnostic(
    OCC_STALE_PREVIEW_CODE,
    'warning',
    `Preview ${previewId} targeted ${requestedRevisionId}, but the current revision is ${currentRevisionId}.`,
    null,
    {
      kind: 'stalePreview',
      previewId,
      requestedRevisionId,
      currentRevisionId,
    },
  )
}

function deriveRebuildFailureCode(error: unknown) {
  if (!(error instanceof Error)) {
    return OCC_REBUILD_FAILURE_CODE
  }

  const structuredCode =
    'code' in error && typeof (error as Error & { code?: unknown }).code === 'string'
      ? (error as Error & { code: string }).code
      : null

  if (structuredCode && OCC_REBUILD_DIAGNOSTIC_CODES.has(structuredCode)) {
    return structuredCode
  }

  const match = /^([a-z0-9-]+):\s+/i.exec(error.message)

  if (!match) {
    return OCC_REBUILD_FAILURE_CODE
  }

  return OCC_REBUILD_DIAGNOSTIC_CODES.has(match[1]!)
    ? match[1]!
    : OCC_REBUILD_FAILURE_CODE
}

function getFeatureConsumedTargets(definition: FeatureDefinition) {
  switch (definition.kind) {
    case 'extrude': {
      const targets: NonNullable<ModelingDiagnostic['target']>[] = [...definition.parameters.profiles]
      const extent = getExtrudeFeatureExtent(definition.parameters)
      const ends = extent.mode === 'twoSide' ? [extent.firstEnd, extent.secondEnd] : [extent.end]
      for (const end of ends) {
        if ('target' in end) {
          targets.push(end.target)
        }
      }
      const scope = definition.parameters.booleanScope
      if (scope.kind === 'targetBody') {
        targets.push({ kind: 'body', bodyId: scope.bodyId })
      } else if (scope.kind === 'targetBodies') {
        targets.push(...scope.bodyIds.map((bodyId) => ({ kind: 'body', bodyId } as const)))
      }

      return targets
    }
    case 'fillet':
      return [...definition.parameters.edgeTargets]
    case 'plane':
      return [definition.parameters.reference.target]
    case 'revolve': {
      const targets: NonNullable<ModelingDiagnostic['target']>[] = [
        ...definition.parameters.profiles,
        definition.parameters.axis,
      ]
      const extent = getRevolveFeatureExtent(definition.parameters)
      const ends = extent.mode === 'twoSide' ? [extent.firstEnd, extent.secondEnd] : [extent.end]
      for (const end of ends) {
        if ('target' in end) {
          targets.push(end.target)
        }
      }
      const scope = definition.parameters.booleanScope
      if (scope.kind === 'targetBody') {
        targets.push({ kind: 'body', bodyId: scope.bodyId })
      } else if (scope.kind === 'targetBodies') {
        targets.push(...scope.bodyIds.map((bodyId) => ({ kind: 'body', bodyId } as const)))
      }

      return targets
    }
    case 'shell': {
      const targets: NonNullable<ModelingDiagnostic['target']>[] = [
        definition.parameters.bodyTarget,
        ...definition.parameters.faceTargets,
      ]
      const scope = definition.parameters.booleanScope
      if (scope.kind === 'targetBody') {
        targets.push({ kind: 'body', bodyId: scope.bodyId })
      } else if (scope.kind === 'targetBodies') {
        targets.push(...scope.bodyIds.map((bodyId) => ({ kind: 'body', bodyId } as const)))
      }

      return targets
    }
    case 'split':
    case 'deleteSolid':
      return []
    default:
      return definition.parameters.participants.flatMap((participant) => [...participant.targets])
  }
}

type RebuildAttempt = {
  ok: true
  state: OccAuthoringState
  partial: boolean
  diagnostics: ModelingDiagnostic[]
}

function collectInvalidConsumedTargetDiagnostics(
  state: Pick<OccAuthoringState, 'documentId' | 'revisionId' | 'referenceState'>,
  feature: OccAuthoringFeatureRecord,
) {
  const diagnostics: ModelingDiagnostic[] = []

  for (const target of getFeatureConsumedTargets(feature.definition)) {
    const resolved = resolveOccReference({
      documentId: state.documentId,
      revisionId: state.revisionId,
      referenceState: state.referenceState,
    }, target)

    if (resolved.resolution.invalidation !== null) {
      diagnostics.push(createInvalidReferenceDiagnostic(resolved.resolution, feature))
    }
  }

  return diagnostics
}

function isRepairableFeatureDiagnostic(diagnostic: ModelingDiagnostic) {
  return diagnostic.detail?.kind === 'invalidReference'
    || diagnostic.code === 'feature-dependency-blocked'
}

function getNonRepairableFeatureDiagnostics(
  diagnostics: readonly ModelingDiagnostic[],
  featureIds: ReadonlySet<FeatureId>,
) {
  return diagnostics.filter((diagnostic) =>
    diagnostic.featureId
    && featureIds.has(diagnostic.featureId)
    && !isRepairableFeatureDiagnostic(diagnostic),
  )
}

export class OpenCascadeKernelAdapter implements ModelingKernelAdapter {
  private readonly solverAdapter: SketchSolverAdapter
  private readonly solverAdapterFactory?: (revisionId: RevisionId) => SketchSolverAdapter
  private readonly loadOpenCascadeInstance: () => Promise<OpenCascadeInstance>
  private readonly initialSnapshotRequiresRuntime: boolean
  private readonly workerSnapshotClient: OccWorkerSnapshotClient | null
  private readonly documentId: DocumentId
  private readonly tolerances: SolverTolerancePolicy

  private initializationPromise: Promise<OccKernelRuntimeState> | null = null
  private runtimeState: OccKernelRuntimeState | null = null
  private workerRestoredDocument: WorkerRestoredAuthoredDocument | null = null
  private snapshotLodTierId: OccTessellationTierId = 'startup'

  constructor(options: OpenCascadeKernelAdapterOptions) {
    this.solverAdapter = options.solverAdapter
    this.solverAdapterFactory = options.solverAdapterFactory
    this.loadOpenCascadeInstance = options.getOpenCascadeInstance ?? getOpenCascadeInstance
    this.initialSnapshotRequiresRuntime = options.initialSnapshotRequiresRuntime ?? false
    this.workerSnapshotClient = options.workerSnapshotClient ?? null
    this.documentId = options.documentId ?? OCC_KERNEL_DOCUMENT_ID
    this.tolerances = options.tolerances ?? DEFAULT_SOLVER_TOLERANCES
  }

  preloadRuntime(): Promise<void> {
    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.warmup()
    }

    return this.getRuntimeState().then(() => undefined)
  }

  setSnapshotLodTier(tierId: OccTessellationTierId) {
    if (this.snapshotLodTierId === tierId) {
      return false
    }

    this.snapshotLodTierId = tierId
    return true
  }

  private getSolverAdapter(revisionId: RevisionId) {
    if (this.solverAdapterFactory) {
      return this.solverAdapterFactory(revisionId)
    }

    return this.solverAdapter
  }

  private async getRuntimeState() {
    if (this.workerRestoredDocument) {
      const restored = this.workerRestoredDocument
      this.workerRestoredDocument = null
      await this.restoreAuthoredModelDocumentOnMainThread(
        restored.document,
        [],
        createInMemoryGeometryAssetResolver(restored.assets),
      )
    }

    if (this.runtimeState) {
      return this.runtimeState
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeRuntimeState()
        .then((state) => {
          this.runtimeState = state
          return state
        })
        .catch((error: unknown) => {
          this.initializationPromise = null
          throw error
        })
    }

    return this.initializationPromise
  }

  private async initializeRuntimeState(): Promise<OccKernelRuntimeState> {
    const oc = await this.loadOpenCascadeInstance()
    const authoringState = createOccAuthoringState(oc, {
      documentId: this.documentId,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    })

    return {
      authoringState,
      revisionSequence: parseRevisionSequence(OCC_KERNEL_INITIAL_REVISION_ID),
    }
  }

  private async rebuildAuthoredSketchRecord(
    document: AuthoredModelDocument,
    sketch: AuthoredModelDocument['sketches'][number],
    sourceState: OccAuthoringState,
  ): Promise<SketchSnapshotRecord> {
    const sketchId = sketch.sketchId
    const definition = normalizeSketchDefinitionForSketchId(structuredClone(sketch.definition), sketchId)
    const correlation = createRestoreSolverCorrelation(sketchId, document.revisionId)
    const solverAdapter = this.getSolverAdapter(document.revisionId)
    const tolerances = createRestoreSolverTolerances(document, this.tolerances)
    const projection = projectSketchExternalReferencesFromSnapshot(buildOccWorkspaceSnapshot(sourceState), {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: correlation.projectionRequestId,
      documentId: document.documentId,
      revisionId: document.revisionId,
      sketchId,
      plane: sketch.plane.frame,
      tolerances,
      references: definition.references.map((reference) => ({
        referenceId: reference.referenceId,
        reference,
      })),
    })
    const validation = await solverAdapter.validateSketch({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: correlation.validationRequestId,
      documentId: document.documentId,
      revisionId: document.revisionId,
      sketchId,
      plane: sketch.plane.frame,
      tolerances,
      definition,
      projectedReferences: projection.projectedReferences,
    })
    const solved = await solverAdapter.solveSketch({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: correlation.solveRequestId,
      documentId: document.documentId,
      revisionId: document.revisionId,
      sketchId,
      plane: sketch.plane.frame,
      tolerances,
      partialSolvePolicy: 'bestEffort',
      definition,
      projectedReferences: projection.projectedReferences,
      incrementalEdit: null,
    })
    const regions = await solverAdapter.deriveSketchRegions({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: correlation.regionRequestId,
      documentId: document.documentId,
      revisionId: document.revisionId,
      sketchId,
      solvedSnapshot: solved.solvedSnapshot,
      definition,
      projectedReferences: projection.projectedReferences,
    })

    if (!validation.isValid || !canPersistSketchSolveState(definition, solved.solvedSnapshot)) {
      throw new Error(`Authored sketch ${sketchId} could not be restored from persisted authored inputs.`)
    }

    return buildSketchSnapshotRecord(
      {
        contractVersion: CONTRACT_VERSION,
        documentId: document.documentId,
        baseRevisionId: document.revisionId,
        solverCorrelation: correlation,
        sketchId,
        sketchLabel: sketch.label,
        plane: structuredClone(sketch.plane),
        planeTarget: structuredClone(sketch.planeTarget),
        planeKey: sketch.planeKey,
        definition,
      },
      sketchId,
      document.revisionId,
      definition,
      normalizeDerivedRegionsForSketchId(regions.regions, sketchId, document.revisionId),
      solved.solvedSnapshot,
      projection.projectedReferences,
    )
  }

  async restoreAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics: readonly ModelingDiagnostic[] = [],
    assetResolver?: GeometryAssetResolver,
  ): Promise<void> {
    const assetBlobs = await resolveGeometryAssetBlobs(document, assetResolver)
    const assets = createGeometryAssetBlobInputs(document, assetBlobs)

    if (this.workerSnapshotClient) {
      this.workerRestoredDocument = null
      this.runtimeState = null
      this.initializationPromise = null
      await this.workerSnapshotClient.restoreAuthoredModelDocument(document, diagnostics, assets)
      return
    }

    this.workerRestoredDocument = null

    await this.restoreAuthoredModelDocumentOnMainThread(
      document,
      diagnostics,
      createInMemoryGeometryAssetResolver(assets),
    )
  }

  async validateAuthoredModelDocument(
    document: AuthoredModelDocument,
    diagnostics: readonly ModelingDiagnostic[] = [],
    assetResolver?: GeometryAssetResolver,
  ): Promise<void> {
    if (this.workerSnapshotClient) {
      const assetBlobs = await resolveGeometryAssetBlobs(document, assetResolver)
      const assets = createGeometryAssetBlobInputs(document, assetBlobs)
      await this.workerSnapshotClient.validateAuthoredModelDocument(document, diagnostics, assets)

      this.runtimeState = null
      this.initializationPromise = null
      this.workerRestoredDocument = null
      return
    }

    await this.restoreAuthoredModelDocumentOnMainThread(document, diagnostics, assetResolver)
  }

  private async restoreAuthoredModelDocumentOnMainThread(
    document: AuthoredModelDocument,
    diagnostics: readonly ModelingDiagnostic[] = [],
    assetResolver?: GeometryAssetResolver,
    options: {
      deferredFeatureIds?: ReadonlySet<FeatureId>
      replaceRuntimeState?: boolean
    } = {},
  ): Promise<OccKernelRuntimeState> {
    const oc = await this.loadOpenCascadeInstance()
    const assetBlobs = await resolveGeometryAssetBlobs(document, assetResolver)
    const restoreDiagnostics = [...diagnostics]
    const historyOrder = createAuthoredHistoryRestoreOrder(document)
    const sketchById = new Map(document.sketches.map((sketch) => [sketch.sketchId, sketch]))
    const featureById = new Map(document.features.map((feature) => [feature.featureId, feature]))
    const features: OccAuthoringFeatureRecord[] = document.featureOrder
      .map((featureId) => featureById.get(featureId))
      .filter((feature): feature is AuthoredModelDocument['features'][number] => Boolean(feature))
      .map((feature) => ({
        featureId: feature.featureId,
        label: feature.label,
        definition: structuredClone(feature.definition),
      }))
    const featureRecordById = new Map(features.map((feature) => [feature.featureId, feature]))
    const sketches: SketchSnapshotRecord[] = []
    let projectionState = createOccAuthoringState(oc, {
      documentId: document.documentId,
      revisionId: document.revisionId,
      modelingTolerance: document.settings.modelingTolerance,
      variables: structuredClone(document.variables),
      bodyLabels: new Map(document.bodyLabels.map((label) => [label.bodyId, label.label])),
      assets: document.assets,
      assetBlobs,
      embeddedBinaryAssets: document.embeddedBinaryAssets,
      historyOrder,
      diagnostics: restoreDiagnostics,
      cursor: { kind: 'empty' },
    })
    const pendingProjectionFeatures: OccAuthoringFeatureRecord[] = []
    const failedProjectionFeatures: FailedFeatureRecord[] = []

    for (const item of historyOrder) {
      if (item.kind === 'sketch') {
        const authoredSketch = sketchById.get(item.sketchId)
        if (!authoredSketch) {
          continue
        }

        for (const feature of pendingProjectionFeatures.splice(0)) {
          if (findBlockingFeature(failedProjectionFeatures, feature)) {
            failedProjectionFeatures.push(createFailedFeatureRecord(feature))
            continue
          }

          try {
            projectionState = applyOccFeatureToAuthoringState(projectionState, feature)
          } catch {
            failedProjectionFeatures.push(createFailedFeatureRecord(feature))
          }
        }

        const rebuiltSketch = await this.rebuildAuthoredSketchRecord(document, authoredSketch, projectionState)
        sketches.push(rebuiltSketch)
        projectionState = {
          ...projectionState,
          sketches: [...projectionState.sketches, rebuiltSketch],
        }
        continue
      }

      const feature = featureRecordById.get(item.featureId)
      if (feature) {
        if (options.deferredFeatureIds?.has(feature.featureId)) {
          failedProjectionFeatures.push(createFailedFeatureRecord(feature))
          continue
        }

        pendingProjectionFeatures.push(feature)
      }
    }

    let authoringState = createOccAuthoringState(oc, {
      documentId: document.documentId,
      revisionId: document.revisionId,
      modelingTolerance: document.settings.modelingTolerance,
      sketches,
      variables: structuredClone(document.variables),
      bodyLabels: new Map(document.bodyLabels.map((label) => [label.bodyId, label.label])),
      assets: document.assets,
      assetBlobs,
      embeddedBinaryAssets: document.embeddedBinaryAssets,
      historyOrder,
      diagnostics: restoreDiagnostics,
      cursor: { kind: 'empty' },
    })

    const rebuiltAuthoringState = this.tryBuildNextAuthoringState(
      {
        authoringState,
        revisionSequence: parseRevisionSequence(document.revisionId),
      },
      {
        revisionId: document.revisionId,
        features,
        cursor: document.cursor,
        deferredFeatureIds: options.deferredFeatureIds,
      },
    ).state
    authoringState = {
      ...rebuiltAuthoringState,
      diagnostics: mergeModelingDiagnostics(rebuiltAuthoringState.diagnostics, restoreDiagnostics),
    }
    const runtimeState = {
      authoringState,
      revisionSequence: parseRevisionSequence(document.revisionId),
    }
    if (options.replaceRuntimeState !== false) {
      this.replaceRuntimeState(runtimeState)
    }
    return runtimeState
  }

  async exportAuthoredModelDocument(documentId: AuthoredModelDocument['documentId']) {
    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.exportAuthoredModelDocument(documentId)
    }

    if (this.workerRestoredDocument) {
      if (this.workerRestoredDocument.document.documentId !== documentId) {
        throw new Error(`OCC authored export requested document ${documentId}, but active document is ${this.workerRestoredDocument.document.documentId}.`)
      }

      return structuredClone(this.workerRestoredDocument.document)
    }

    const runtimeState = await this.getRuntimeState()

    if (runtimeState.authoringState.documentId !== documentId) {
      throw new Error(`OCC authored export requested document ${documentId}, but active document is ${runtimeState.authoringState.documentId}.`)
    }

    return createAuthoredModelDocumentFromAuthoringState(runtimeState.authoringState)
  }

  private buildInitialSnapshotWithoutRuntime() {
    const authoringState = createOccAuthoringState({} as OpenCascadeInstance, {
      documentId: this.documentId,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    })

    return buildOccWorkspaceSnapshot(authoringState)
  }

  private replaceRuntimeState(runtimeState: OccKernelRuntimeState) {
    this.workerRestoredDocument = null
    this.runtimeState = runtimeState
    this.initializationPromise = Promise.resolve(runtimeState)
  }

  private getCurrentRevisionId(runtimeState: OccKernelRuntimeState) {
    return runtimeState.authoringState.revisionId
  }

  private buildNextAuthoringState(
    runtimeState: OccKernelRuntimeState,
    input: {
      revisionId: RevisionId
      sketches?: readonly SketchSnapshotRecord[]
      bodyLabels?: ReadonlyMap<BodyId, string>
      variables?: OccAuthoringState['variables']
      features?: readonly OccAuthoringFeatureRecord[]
      historyOrder?: OccAuthoringState['historyOrder']
      cursor?: OccAuthoringState['cursor']
    },
  ) {
    const baseState = createOccAuthoringState(runtimeState.authoringState.oc, {
      documentId: this.documentId,
      revisionId: input.revisionId,
      modelingTolerance: runtimeState.authoringState.modelingTolerance,
      sketches: input.sketches ?? runtimeState.authoringState.sketches,
      variables: input.variables ?? runtimeState.authoringState.variables,
      bodies: runtimeState.authoringState.baseBodies,
      bodyLabels: input.bodyLabels ?? runtimeState.authoringState.bodyLabels,
      assets: runtimeState.authoringState.assets,
      assetBlobs: runtimeState.authoringState.assetBlobs,
      embeddedBinaryAssets: runtimeState.authoringState.embeddedBinaryAssets,
      constructions: runtimeState.authoringState.baseConstructions,
      constructionPlanes: runtimeState.authoringState.baseConstructionPlanes,
      historyOrder: input.historyOrder ?? runtimeState.authoringState.historyOrder,
      diagnostics: getPersistentAuthoringDiagnostics(runtimeState.authoringState.diagnostics),
    })

    let current = baseState
    const features = input.features ?? runtimeState.authoringState.features
    const cursor = input.cursor ?? runtimeState.authoringState.cursor

    for (const feature of getAppliedFeatures(features, cursor, baseState.historyOrder)) {
      current = applyOccFeatureToAuthoringState(current, feature)
    }

    const rebuiltFeatures = new Map(current.features.map((feature) => [feature.featureId, feature]))

    return {
      ...current,
      features: features.map((feature) => rebuiltFeatures.get(feature.featureId) ?? feature),
      cursor,
    }
  }

  private requireLiveConstructionPlane(
    state: OccAuthoringState,
    constructionId: `construction_${string}`,
  ) {
    const plane = state.constructionPlanes.get(constructionId)

    if (!plane) {
      throw new Error(`Construction plane ${constructionId} does not resolve in the current OCC authoring state.`)
    }

    return plane
  }

  private requireLiveFace(state: OccAuthoringState, bodyId: BodyId, faceId: `face_${string}`) {
    const body = state.bodies.find((entry) => entry.bodyId === bodyId)

    if (!body) {
      throw new Error(`Body ${bodyId} does not resolve in the current OCC authoring state.`)
    }

    const face = body.facesById.get(faceId)

    if (!face) {
      throw new Error(`Face ${faceId} does not resolve on body ${bodyId}.`)
    }

    return face
  }

  private validateSketchPlaneSupport(state: OccAuthoringState, plane: SketchPlaneDefinition) {
    if (plane.support.kind === 'construction') {
      this.requireLiveConstructionPlane(state, plane.support.constructionId)
      return
    }

    extractPlanarFaceData(
      state.oc,
      this.requireLiveFace(state, plane.support.bodyId, plane.support.faceId),
    )
  }

  private validateCommitSketchRequest(
    state: OccAuthoringState,
    request: CommitSketchRequest,
  ): ModelingDiagnostic[] {
    const diagnostics: ModelingDiagnostic[] = []

    if (request.planeTarget.kind !== request.plane.support.kind) {
      diagnostics.push(
        createValidationDiagnostic(
          'Commit sketch planeTarget must match plane.support exactly.',
          request.plane.support,
        ),
      )
    } else if (
      request.planeTarget.kind === 'construction'
      && request.plane.support.kind === 'construction'
      && request.planeTarget.constructionId !== request.plane.support.constructionId
    ) {
      diagnostics.push(
        createValidationDiagnostic(
          'Commit sketch planeTarget must match plane.support exactly.',
          request.plane.support,
        ),
      )
    } else if (
      request.planeTarget.kind === 'face'
      && request.plane.support.kind === 'face'
      && (
        request.planeTarget.bodyId !== request.plane.support.bodyId
        || request.planeTarget.faceId !== request.plane.support.faceId
      )
    ) {
      diagnostics.push(
        createValidationDiagnostic(
          'Commit sketch planeTarget must match plane.support exactly.',
          request.plane.support,
        ),
      )
    }

    if (request.planeKey !== request.plane.key) {
      diagnostics.push(
        createValidationDiagnostic(
          'Commit sketch planeKey must match plane.key exactly.',
          request.plane.support,
        ),
      )
    }

    if (
      request.sketchId !== null
      && !state.sketches.some((entry) => entry.sketchId === request.sketchId)
    ) {
      diagnostics.push(
        createDiagnostic(
          'occ-missing-sketch',
          'error',
          `Sketch ${request.sketchId} does not resolve in the current OCC authoring state.`,
          { kind: 'sketch', sketchId: request.sketchId },
        ),
      )
    }

    try {
      this.validateSketchPlaneSupport(state, request.plane)
    } catch (error) {
      diagnostics.push(
        createValidationDiagnostic(
          error instanceof Error ? error.message : 'Invalid sketch plane support.',
          request.plane.support,
        ),
      )
    }

    return diagnostics
  }

  private buildConflictResult(
    baseRevisionId: RevisionId,
    currentRevisionId: RevisionId,
  ) {
    const diagnostics = [createRevisionConflictDiagnostic(baseRevisionId, currentRevisionId)]

    return {
      revisionId: currentRevisionId,
      revisionState: {
        kind: 'conflict' as const,
        expectedRevisionId: baseRevisionId,
        actualRevisionId: currentRevisionId,
      },
      rebuildResult: {
        kind: 'skipped' as const,
        reasonCode: 'revisionConflict' as const,
        invalidatedTargets: [],
        diagnostics,
      },
      diagnostics,
    }
  }

  private buildRejectedResult(
    baseRevisionId: RevisionId,
    diagnostics: readonly ModelingDiagnostic[],
    reasonCode: string,
  ) {
    return {
      revisionId: baseRevisionId,
      revisionState: {
        kind: 'rejected' as const,
        baseRevisionId,
        reasonCode,
      },
      rebuildResult: {
        kind: 'skipped' as const,
        reasonCode: 'validationRejected' as const,
        invalidatedTargets: [],
        diagnostics: [...diagnostics],
      },
      diagnostics: [...diagnostics],
    }
  }

  private buildAcceptedResult(
    previousState: OccAuthoringState,
    nextState: OccAuthoringState,
    extraDiagnostics: readonly ModelingDiagnostic[],
    rebuildFailed = false,
  ) {
    const invalidatedTargets = getNewInvalidatedTargets(previousState, nextState)
    const diagnostics = buildOccSnapshotDiagnostics(nextState, extraDiagnostics)

    return {
      revisionId: nextState.revisionId,
      revisionState: {
        kind: 'accepted' as const,
        baseRevisionId: previousState.revisionId,
      },
      rebuildResult: rebuildFailed
        ? {
            kind: 'failed' as const,
            revisionId: nextState.revisionId,
            reasonCode: diagnostics[0]?.code ?? OCC_REBUILD_FAILURE_CODE,
            invalidatedTargets,
            diagnostics,
          }
        : {
            kind: 'rebuilt' as const,
            revisionId: nextState.revisionId,
            invalidatedTargets,
            diagnostics,
          },
      diagnostics,
    }
  }

  private tryBuildNextAuthoringState(
    runtimeState: OccKernelRuntimeState,
    input: {
      revisionId: RevisionId
      sketches?: readonly SketchSnapshotRecord[]
      bodyLabels?: ReadonlyMap<BodyId, string>
      variables?: OccAuthoringState['variables']
      features?: readonly OccAuthoringFeatureRecord[]
      historyOrder?: OccAuthoringState['historyOrder']
      cursor?: OccAuthoringState['cursor']
      deferredFeatureIds?: ReadonlySet<FeatureId>
    },
  ): RebuildAttempt {
    const features = input.features ?? runtimeState.authoringState.features
    const cursor = input.cursor ?? runtimeState.authoringState.cursor
    const deferredFeatureIds = input.deferredFeatureIds
    const baseState = createOccAuthoringState(runtimeState.authoringState.oc, {
      documentId: this.documentId,
      revisionId: input.revisionId,
      modelingTolerance: runtimeState.authoringState.modelingTolerance,
      sketches: input.sketches ?? runtimeState.authoringState.sketches,
      variables: input.variables ?? runtimeState.authoringState.variables,
      bodies: runtimeState.authoringState.baseBodies,
      bodyLabels: input.bodyLabels ?? runtimeState.authoringState.bodyLabels,
      assets: runtimeState.authoringState.assets,
      assetBlobs: runtimeState.authoringState.assetBlobs,
      embeddedBinaryAssets: runtimeState.authoringState.embeddedBinaryAssets,
      constructions: runtimeState.authoringState.baseConstructions,
      constructionPlanes: runtimeState.authoringState.baseConstructionPlanes,
      historyOrder: input.historyOrder ?? runtimeState.authoringState.historyOrder,
      previousReferenceState: runtimeState.authoringState.referenceState,
      diagnostics: getPersistentAuthoringDiagnostics(runtimeState.authoringState.diagnostics),
      cursor: { kind: 'empty' },
    })

    let current = baseState
    const failedFeatures: FailedFeatureRecord[] = []
    const diagnostics: ModelingDiagnostic[] = []
    const dependencyOrderDiagnostics = new Map<FeatureId, ModelingDiagnostic[]>()

    for (const diagnostic of findDocumentHistoryOrderDependencyViolations(features, baseState.historyOrder)
      .map(createDocumentHistoryDependencyOrderDiagnostic)) {
      if (diagnostic.target?.kind !== 'feature') {
        continue
      }

      const featureDiagnostics = dependencyOrderDiagnostics.get(diagnostic.target.featureId) ?? []
      featureDiagnostics.push(diagnostic)
      dependencyOrderDiagnostics.set(diagnostic.target.featureId, featureDiagnostics)
    }

    for (const feature of getAppliedFeatures(features, cursor, baseState.historyOrder)) {
      if (deferredFeatureIds?.has(feature.featureId)) {
        failedFeatures.push(createFailedFeatureRecord(feature))
        continue
      }

      const orderingDiagnostics = dependencyOrderDiagnostics.get(feature.featureId)
      if (orderingDiagnostics) {
        diagnostics.push(...orderingDiagnostics)
        failedFeatures.push(createFailedFeatureRecord(feature))
        continue
      }

      const blockingFeature = findBlockingFeature(failedFeatures, feature)
      if (blockingFeature) {
        diagnostics.push(createDependencyBlockedDiagnostic({
          featureId: feature.featureId,
          featureLabel: feature.label ?? feature.featureId,
          blockingFeatureId: blockingFeature.featureId,
          blockingFeatureLabel: blockingFeature.featureLabel,
        }))
        failedFeatures.push(createFailedFeatureRecord(feature))
        continue
      }

      const invalidConsumedTargetDiagnostics = collectInvalidConsumedTargetDiagnostics(
        current,
        feature,
      )

      if (invalidConsumedTargetDiagnostics.length > 0) {
        diagnostics.push(...invalidConsumedTargetDiagnostics)
        failedFeatures.push(createFailedFeatureRecord(feature))
        continue
      }

      try {
        current = applyOccFeatureToAuthoringState(current, feature)
      } catch (error) {
        const consumedTargets = getFeatureConsumedTargets(feature.definition)
        const invalidDiagnostics = consumedTargets.flatMap((target) => {
          const resolved = resolveOccReference({
            documentId: this.documentId,
            revisionId: current.revisionId,
            referenceState: current.referenceState,
          }, target)

          return resolved.resolution.invalidation === null
            ? []
            : [createInvalidReferenceDiagnostic(resolved.resolution, feature)]
        })

        if (invalidDiagnostics.length > 0) {
          diagnostics.push(...invalidDiagnostics)
          failedFeatures.push(createFailedFeatureRecord(feature))
          continue
        }

        diagnostics.push(createRebuildFailureDiagnostic(
          deriveRebuildFailureCode(error),
          error instanceof Error ? error.message : 'OCC rebuild failed.',
          [feature.featureId],
          uniqueTargets(consumedTargets),
          feature,
        ))
        failedFeatures.push(createFailedFeatureRecord(feature))
      }
    }

    const rebuiltFeatures = new Map(current.features.map((feature) => [feature.featureId, feature]))
    const state = {
      ...current,
      features: features.map((feature) => rebuiltFeatures.get(feature.featureId) ?? feature),
      cursor,
      diagnostics: [...current.diagnostics, ...diagnostics],
    }

    return {
      ok: true,
      state,
      partial: diagnostics.length > 0,
      diagnostics,
    }
  }

  private withOperationEnvelope<T extends object>(payload: T) {
    return {
      ...payload,
      contractVersion: CONTRACT_VERSION,
      documentId: this.documentId,
    }
  }

  async getDocumentSnapshot(request: GetDocumentSnapshotRequest): Promise<GetDocumentSnapshotResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.getDocumentSnapshot(request, this.snapshotLodTierId)
    }

    if (!this.initialSnapshotRequiresRuntime && !this.runtimeState && !this.initializationPromise) {
      return {
        contractVersion: CONTRACT_VERSION,
        snapshot: this.buildInitialSnapshotWithoutRuntime(),
      }
    }

    const runtimeState = await this.getRuntimeState()

    return {
      contractVersion: CONTRACT_VERSION,
      snapshot: buildOccWorkspaceSnapshot(runtimeState.authoringState, [], {
        lodTierId: this.snapshotLodTierId,
      }),
    }
  }

  async projectSketchExternalReferences(
    request: ProjectSketchExternalReferencesRequest,
  ): Promise<ProjectSketchExternalReferencesResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.projectSketchExternalReferences(request)
    }

    if (!this.runtimeState && !this.initializationPromise) {
      return projectSketchExternalReferencesFromSnapshot(this.buildInitialSnapshotWithoutRuntime(), request)
    }

    const runtimeState = await this.getRuntimeState()
    return projectSketchExternalReferencesFromSnapshot(
      buildOccWorkspaceSnapshot(runtimeState.authoringState),
      request,
    )
  }

  async commitSketch(request: CommitSketchRequest): Promise<CommitSketchResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.commitSketch(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)
    const sketchId = request.sketchId ?? allocateSketchId(runtimeState.authoringState)

    if (request.baseRevisionId !== currentRevisionId) {
      const conflict = this.buildConflictResult(request.baseRevisionId, currentRevisionId)
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        sketchId,
        changedTargets: [],
        ...conflict,
      }
    }

    const requestDiagnostics = this.validateCommitSketchRequest(runtimeState.authoringState, request)
    if (requestDiagnostics.length > 0) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        requestDiagnostics,
        requestDiagnostics[0]!.code,
      )

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        sketchId,
        changedTargets: [],
        ...rejected,
      }
    }

    const normalizedDefinition = normalizeSketchDefinitionForSketchId(request.definition, sketchId)
    const correlation = request.solverCorrelation ?? createDefaultSolverCorrelation(sketchId, request.baseRevisionId)
    const solverAdapter = this.getSolverAdapter(request.baseRevisionId)

    const projection = await this.projectSketchExternalReferences({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: correlation.projectionRequestId,
      documentId: this.documentId,
      revisionId: request.baseRevisionId,
      sketchId,
      plane: request.plane.frame,
      tolerances: this.tolerances,
      references: normalizedDefinition.references.map((reference) => ({
        referenceId: reference.referenceId,
        reference,
      })),
    })
    const validation = await solverAdapter.validateSketch({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: correlation.validationRequestId,
      documentId: this.documentId,
      revisionId: request.baseRevisionId,
      sketchId,
      plane: request.plane.frame,
      tolerances: this.tolerances,
      definition: normalizedDefinition,
      projectedReferences: projection.projectedReferences,
    })
    const solved = await solverAdapter.solveSketch({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: correlation.solveRequestId,
      documentId: this.documentId,
      revisionId: request.baseRevisionId,
      sketchId,
      plane: request.plane.frame,
      tolerances: this.tolerances,
      partialSolvePolicy: 'bestEffort',
      definition: normalizedDefinition,
      projectedReferences: projection.projectedReferences,
      incrementalEdit: null,
    })
    const regions = await solverAdapter.deriveSketchRegions({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: correlation.regionRequestId,
      documentId: this.documentId,
      revisionId: request.baseRevisionId,
      sketchId,
      solvedSnapshot: solved.solvedSnapshot,
      definition: normalizedDefinition,
      projectedReferences: projection.projectedReferences,
    })

    const solverDiagnostics = [
      ...projection.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
      ...validation.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
      ...solved.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
      ...regions.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
    ]

    if (!validation.isValid || !canPersistSketchSolveState(normalizedDefinition, solved.solvedSnapshot)) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        solverDiagnostics,
        OCC_VALIDATION_ERROR_CODE,
      )

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        sketchId,
        changedTargets: [],
        ...rejected,
      }
    }

    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)
    const normalizedRegions = normalizeDerivedRegionsForSketchId(regions.regions, sketchId, nextRevisionId)
    const snapshotRecord = buildSketchSnapshotRecord(
      request,
      sketchId,
      nextRevisionId,
      normalizedDefinition,
      normalizedRegions,
      solved.solvedSnapshot,
      projection.projectedReferences,
    )
    const isNewSketch = !runtimeState.authoringState.sketches.some((entry) => entry.sketchId === sketchId)
    const nextSketches = !isNewSketch
      ? runtimeState.authoringState.sketches.map((entry) => (entry.sketchId === sketchId ? snapshotRecord : entry))
      : [...runtimeState.authoringState.sketches, snapshotRecord]
    const nextHistoryOrder = isNewSketch
      ? insertDocumentHistoryOrderEntryAfterCursor(
          buildOccWorkspaceSnapshot(runtimeState.authoringState).presentation.documentHistory,
          runtimeState.authoringState.cursor,
          { kind: 'sketch', sketchId },
        )
      : runtimeState.authoringState.historyOrder

    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      sketches: nextSketches,
      historyOrder: nextHistoryOrder,
      cursor: isNewSketch ? { kind: 'sketch', sketchId } : runtimeState.authoringState.cursor,
    })
    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const accepted = this.buildAcceptedResult(
      runtimeState.authoringState,
      nextAuthoringState.state,
      solverDiagnostics,
      nextAuthoringState.partial,
    )

    return {
      ...this.withOperationEnvelope({
        sketchId,
        changedTargets: buildSketchChangedTargets(snapshotRecord),
        ...accepted,
      }),
    }
  }

  async createFeature(request: CreateFeatureRequest): Promise<CreateFeatureResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.createFeature(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)
    const featureId = allocateFeatureId(runtimeState.authoringState, request.definition.kind)

    if (request.baseRevisionId !== currentRevisionId) {
      const conflict = this.buildConflictResult(request.baseRevisionId, currentRevisionId)
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        featureId,
        changedTargets: [],
        ...conflict,
      }
    }

    const feature: OccAuthoringFeatureRecord = {
      featureId,
      label: request.featureLabel ?? `${capitalizeFeatureKind(request.definition.kind)} ${featureOrdinalForLabel(runtimeState.authoringState, request.definition.kind)}`,
      definition: request.definition,
    }
    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)
    const insertionIndex = getCursorInsertionIndex(
      runtimeState.authoringState.cursor,
      runtimeState.authoringState.features,
      runtimeState.authoringState.historyOrder,
    )
    const nextFeatures = [...runtimeState.authoringState.features]
    nextFeatures.splice(insertionIndex, 0, feature)

    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      features: nextFeatures,
      historyOrder: insertDocumentHistoryOrderEntryAfterCursor(
        buildOccWorkspaceSnapshot(runtimeState.authoringState).presentation.documentHistory,
        runtimeState.authoringState.cursor,
        { kind: 'feature', featureId },
      ),
      cursor: { kind: 'feature', featureId },
    })
    const nonRepairableDiagnostics = getNonRepairableFeatureDiagnostics(
      nextAuthoringState.diagnostics,
      new Set([featureId]),
    )
    if (nonRepairableDiagnostics.length > 0) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        nonRepairableDiagnostics,
        nonRepairableDiagnostics[0]!.code,
      )

      return {
        ...this.withOperationEnvelope({
          featureId,
          changedTargets: [],
          ...rejected,
        }),
      }
    }

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const featureSnapshot = nextAuthoringState.state.features[insertionIndex]
    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [], nextAuthoringState.partial)

    return {
      ...this.withOperationEnvelope({
        featureId,
        ...accepted,
        changedTargets: [
          { kind: 'feature', featureId },
          ...(featureSnapshot?.producedTargets ?? []),
        ],
      }),
    }
  }

  async updateFeature(request: UpdateFeatureRequest): Promise<UpdateFeatureResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.updateFeature(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)

    if (request.baseRevisionId !== currentRevisionId) {
      const conflict = this.buildConflictResult(request.baseRevisionId, currentRevisionId)
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        featureId: request.featureId,
        changedTargets: [],
        ...conflict,
      }
    }

    const featureIndex = runtimeState.authoringState.features.findIndex(
      (entry) => entry.featureId === request.featureId,
    )

    if (featureIndex < 0) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        [createMissingFeatureDiagnostic(request.featureId)],
        OCC_MISSING_FEATURE_CODE,
      )

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        featureId: request.featureId,
        changedTargets: [],
        ...rejected,
      }
    }

    const existing = runtimeState.authoringState.features[featureIndex]!

    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)
    const nextFeatures = runtimeState.authoringState.features.map((feature) =>
      feature.featureId === request.featureId
        ? {
            ...feature,
            label: request.featureLabel ?? feature.label,
            definition: request.definition,
          }
        : feature,
    )

    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      features: nextFeatures,
    })
    const nonRepairableDiagnostics = getNonRepairableFeatureDiagnostics(
      nextAuthoringState.diagnostics,
      new Set([request.featureId]),
    )
    if (nonRepairableDiagnostics.length > 0) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        nonRepairableDiagnostics,
        nonRepairableDiagnostics[0]!.code,
      )

      return {
        ...this.withOperationEnvelope({
          featureId: request.featureId,
          changedTargets: [],
          ...rejected,
        }),
      }
    }

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const updated = nextAuthoringState.state.features[featureIndex]
    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [], nextAuthoringState.partial)

    return {
      ...this.withOperationEnvelope({
        featureId: request.featureId,
        ...accepted,
        changedTargets: uniqueTargets([
          { kind: 'feature', featureId: request.featureId },
          ...(existing.producedTargets ?? []),
          ...(updated?.producedTargets ?? []),
        ]),
      }),
    }
  }

  async deleteFeature(request: DeleteFeatureRequest): Promise<DeleteFeatureResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.deleteFeature(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)

    if (request.baseRevisionId !== currentRevisionId) {
      const conflict = this.buildConflictResult(request.baseRevisionId, currentRevisionId)
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        deletedFeatureId: request.featureId,
        changedTargets: [],
        ...conflict,
      }
    }

    const featureIndex = runtimeState.authoringState.features.findIndex(
      (entry) => entry.featureId === request.featureId,
    )

    if (featureIndex < 0) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        [createMissingFeatureDiagnostic(request.featureId)],
        OCC_MISSING_FEATURE_CODE,
      )

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        deletedFeatureId: request.featureId,
        changedTargets: [],
        ...rejected,
      }
    }

    const existing = runtimeState.authoringState.features[featureIndex]!

    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)
    const nextFeatures = runtimeState.authoringState.features.filter(
      (feature) => feature.featureId !== request.featureId,
    )
    const deletedItem = { kind: 'feature' as const, featureId: request.featureId }
    const nextHistoryOrder = deleteDocumentHistoryOrderEntry(runtimeState.authoringState.historyOrder, deletedItem)
    const nextCursor = repairCursorAfterHistoryDeletion(runtimeState.authoringState.cursor, nextHistoryOrder)

    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      features: nextFeatures,
      historyOrder: nextHistoryOrder,
      cursor: nextCursor,
    })
    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [], nextAuthoringState.partial)

    return {
      ...this.withOperationEnvelope({
        deletedFeatureId: request.featureId,
        changedTargets: [
          { kind: 'feature', featureId: request.featureId },
          ...(existing.producedTargets ?? []),
        ],
        ...accepted,
      }),
    }
  }

  async deleteTarget(request: DeleteDocumentTargetRequest): Promise<DeleteDocumentTargetResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.deleteTarget(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)

    if (request.baseRevisionId !== currentRevisionId) {
      const conflict = this.buildConflictResult(request.baseRevisionId, currentRevisionId)
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        deletedTarget: request.target,
        changedTargets: [],
        ...conflict,
      }
    }

    if (request.target.kind === 'feature' || request.target.kind === 'sketch') {
      const target = request.target
      const deletedItem = getDeleteTargetHistoryEntry(target)
      if (!deletedItem) {
        throw new Error('Unsupported history delete target.')
      }

      const itemKey = getDocumentHistoryOrderEntryKey(deletedItem)
      if (!runtimeState.authoringState.historyOrder.some((entry) => getDocumentHistoryOrderEntryKey(entry) === itemKey)) {
        const diagnostic = target.kind === 'feature'
          ? createMissingFeatureDiagnostic(target.featureId)
          : createMissingSketchDiagnostic(target.sketchId)
        const rejected = this.buildRejectedResult(request.baseRevisionId, [diagnostic], diagnostic.code)
        return this.withOperationEnvelope({
          deletedTarget: target,
          changedTargets: [],
          ...rejected,
        })
      }

      const nextSequence = runtimeState.revisionSequence + 1
      const nextRevisionId = createRevisionId(nextSequence)
      const nextHistoryOrder = deleteDocumentHistoryOrderEntry(runtimeState.authoringState.historyOrder, deletedItem)
      const nextFeatures = target.kind === 'feature'
        ? runtimeState.authoringState.features.filter((feature) => feature.featureId !== target.featureId)
        : runtimeState.authoringState.features
      const nextSketches = target.kind === 'sketch'
        ? runtimeState.authoringState.sketches.filter((sketch) => sketch.sketchId !== target.sketchId)
        : runtimeState.authoringState.sketches
      const nextCursor = repairCursorAfterHistoryDeletion(runtimeState.authoringState.cursor, nextHistoryOrder)

      const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
        revisionId: nextRevisionId,
        sketches: nextSketches,
        features: nextFeatures,
        historyOrder: nextHistoryOrder,
        cursor: nextCursor,
      })
      this.replaceRuntimeState({
        authoringState: nextAuthoringState.state,
        revisionSequence: nextSequence,
      })

      const deletedFeature = target.kind === 'feature'
        ? runtimeState.authoringState.features.find((feature) => feature.featureId === target.featureId)
        : null
      const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [], nextAuthoringState.partial)

      return this.withOperationEnvelope({
        deletedTarget: target,
        changedTargets: uniqueTargets([
          target,
          ...(deletedFeature?.producedTargets ?? []),
        ]),
        ...accepted,
      })
    }

    if (request.target.kind === 'body') {
      const target = request.target
      if (!runtimeState.authoringState.bodies.some((body) => body.bodyId === target.bodyId)) {
        const rejected = this.buildRejectedResult(
          request.baseRevisionId,
          [createMissingBodyDiagnostic(target.bodyId)],
          OCC_MISSING_BODY_CODE,
        )
        return this.withOperationEnvelope({
          deletedTarget: target,
          changedTargets: [],
          ...rejected,
        })
      }

      const nextSequence = runtimeState.revisionSequence + 1
      const nextRevisionId = createRevisionId(nextSequence)
      const featureId = allocateFeatureId(runtimeState.authoringState, 'deleteSolid')
      const feature: OccAuthoringFeatureRecord = {
        featureId,
        label: `DeleteSolid ${featureOrdinalForLabel(runtimeState.authoringState, 'deleteSolid')}`,
        definition: createDeleteSolidDefinition(target.bodyId),
      }
      const insertionIndex = getCursorInsertionIndex(
        runtimeState.authoringState.cursor,
        runtimeState.authoringState.features,
        runtimeState.authoringState.historyOrder,
      )
      const nextFeatures = [...runtimeState.authoringState.features]
      nextFeatures.splice(insertionIndex, 0, feature)
      const nextHistoryOrder = insertDocumentHistoryOrderEntryAfterCursor(
        buildOccWorkspaceSnapshot(runtimeState.authoringState).presentation.documentHistory,
        runtimeState.authoringState.cursor,
        { kind: 'feature', featureId },
      )
      const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
        revisionId: nextRevisionId,
        features: nextFeatures,
        historyOrder: nextHistoryOrder,
        cursor: { kind: 'feature', featureId },
      })

      this.replaceRuntimeState({
        authoringState: nextAuthoringState.state,
        revisionSequence: nextSequence,
      })

      const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [], nextAuthoringState.partial)
      return this.withOperationEnvelope({
        deletedTarget: target,
        changedTargets: uniqueTargets([target, { kind: 'feature', featureId }]),
        ...accepted,
      })
    }

    const rejected = this.buildRejectedResult(
      request.baseRevisionId,
      [createUnsupportedDeleteTargetDiagnostic(request.target)],
      'occ-unsupported-delete-target',
    )
    return this.withOperationEnvelope({
      deletedTarget: request.target,
      changedTargets: [],
      ...rejected,
    })
  }

  async renameBody(request: RenameBodyRequest): Promise<RenameBodyResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.renameBody(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)

    if (request.baseRevisionId !== currentRevisionId) {
      const conflict = this.buildConflictResult(request.baseRevisionId, currentRevisionId)
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        bodyId: request.bodyId,
        changedTargets: [],
        ...conflict,
      }
    }

    if (!runtimeState.authoringState.bodies.some((body) => body.bodyId === request.bodyId)) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        [createMissingBodyDiagnostic(request.bodyId)],
        OCC_MISSING_BODY_CODE,
      )

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        bodyId: request.bodyId,
        changedTargets: [],
        ...rejected,
      }
    }

    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)
    const nextBodyLabels = new Map(runtimeState.authoringState.bodyLabels)
    nextBodyLabels.set(request.bodyId, request.bodyLabel)
    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      bodyLabels: nextBodyLabels,
    })

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const bodyTarget = { kind: 'body' as const, bodyId: request.bodyId }
    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [], nextAuthoringState.partial)

    return this.withOperationEnvelope({
      bodyId: request.bodyId,
      changedTargets: [bodyTarget],
      ...accepted,
    })
  }

  async reorderFeature(request: ReorderFeatureRequest): Promise<ReorderFeatureResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.reorderFeature(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)

    if (request.baseRevisionId !== currentRevisionId) {
      const conflict = this.buildConflictResult(request.baseRevisionId, currentRevisionId)
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        featureId: request.featureId,
        beforeFeatureId: request.beforeFeatureId,
        changedTargets: [],
        ...conflict,
      }
    }

    const featureIndex = runtimeState.authoringState.features.findIndex(
      (feature) => feature.featureId === request.featureId,
    )

    if (featureIndex < 0) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        [createMissingFeatureDiagnostic(request.featureId)],
        OCC_MISSING_FEATURE_CODE,
      )

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        featureId: request.featureId,
        beforeFeatureId: request.beforeFeatureId,
        changedTargets: [],
        ...rejected,
      }
    }

    if (
      request.beforeFeatureId !== null
      && !runtimeState.authoringState.features.some((feature) => feature.featureId === request.beforeFeatureId)
    ) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        [createMissingReorderAnchorDiagnostic(request.beforeFeatureId)],
        OCC_MISSING_REORDER_ANCHOR_CODE,
      )

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        featureId: request.featureId,
        beforeFeatureId: request.beforeFeatureId,
        changedTargets: [],
        ...rejected,
      }
    }

    const nextFeatures = [...runtimeState.authoringState.features]
    const [movedFeature] = nextFeatures.splice(featureIndex, 1)

    if (!movedFeature) {
      throw new Error(`Feature ${request.featureId} disappeared during reorder preparation.`)
    }

    const insertIndex = request.beforeFeatureId === null
      ? nextFeatures.length
      : nextFeatures.findIndex((feature) => feature.featureId === request.beforeFeatureId)

    nextFeatures.splice(insertIndex < 0 ? nextFeatures.length : insertIndex, 0, movedFeature)

    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)

    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      features: nextFeatures,
    })
    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [], nextAuthoringState.partial)

    return {
      ...this.withOperationEnvelope({
        featureId: request.featureId,
        beforeFeatureId: request.beforeFeatureId,
        changedTargets: [{ kind: 'feature', featureId: request.featureId }],
        ...accepted,
      }),
    }
  }

  async reorderDocumentHistory(request: ReorderDocumentHistoryRequest): Promise<ReorderDocumentHistoryResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.reorderDocumentHistory(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)

    if (request.baseRevisionId !== currentRevisionId) {
      const conflict = this.buildConflictResult(request.baseRevisionId, currentRevisionId)
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        item: request.item,
        beforeItem: request.beforeItem,
        changedTargets: [],
        ...conflict,
      }
    }

    const currentOrder = runtimeState.authoringState.historyOrder
    const itemKey = getDocumentHistoryOrderEntryKey(request.item)
    const beforeKey = request.beforeItem === null ? null : getDocumentHistoryOrderEntryKey(request.beforeItem)

    if (!currentOrder.some((entry) => getDocumentHistoryOrderEntryKey(entry) === itemKey)) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        [createMissingDocumentHistoryItemDiagnostic(request.item)],
        'occ-missing-document-history-item',
      )

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        item: request.item,
        beforeItem: request.beforeItem,
        changedTargets: [],
        ...rejected,
      }
    }

    if (
      beforeKey !== null
      && !currentOrder.some((entry) => getDocumentHistoryOrderEntryKey(entry) === beforeKey)
    ) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        [createMissingDocumentHistoryAnchorDiagnostic(request.beforeItem)],
        'occ-missing-document-history-anchor',
      )

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        item: request.item,
        beforeItem: request.beforeItem,
        changedTargets: [],
        ...rejected,
      }
    }

    const nextHistoryOrder = reorderDocumentHistoryOrder(currentOrder, request.item, request.beforeItem)

    if (nextHistoryOrder === null) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        [createMissingDocumentHistoryItemDiagnostic(request.item)],
        'occ-missing-document-history-item',
      )

      return this.withOperationEnvelope({
        item: request.item,
        beforeItem: request.beforeItem,
        changedTargets: [],
        ...rejected,
      })
    }

    const nextFeatures = reorderFeaturesByDocumentHistory(runtimeState.authoringState.features, nextHistoryOrder)
    const dependencyDiagnostics = findDocumentHistoryOrderDependencyViolations(nextFeatures, nextHistoryOrder)
      .map(createDocumentHistoryDependencyOrderDiagnostic)

    if (dependencyDiagnostics.length > 0) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        dependencyDiagnostics,
        'occ-document-history-dependency-order',
      )

      return this.withOperationEnvelope({
        item: request.item,
        beforeItem: request.beforeItem,
        changedTargets: [],
        ...rejected,
      })
    }

    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)

    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      features: nextFeatures,
      historyOrder: nextHistoryOrder,
    })
    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [], nextAuthoringState.partial)

    return this.withOperationEnvelope({
      item: request.item,
      beforeItem: request.beforeItem,
      changedTargets: [request.item.kind === 'sketch'
        ? { kind: 'sketch', sketchId: request.item.sketchId }
        : { kind: 'feature', featureId: request.item.featureId }],
      ...accepted,
    })
  }

  async setFeatureCursor(request: SetFeatureCursorRequest): Promise<SetFeatureCursorResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.setFeatureCursor(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)

    if (request.baseRevisionId !== currentRevisionId) {
      const conflict = this.buildConflictResult(request.baseRevisionId, currentRevisionId)
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        cursor: runtimeState.authoringState.cursor,
        changedTargets: [],
        ...conflict,
      }
    }

    if (!isValidFeatureCursor(runtimeState.authoringState, request.cursor)) {
      const diagnostics = request.cursor.kind === 'feature'
        ? [createMissingFeatureDiagnostic(request.cursor.featureId)]
        : [createRebuildFailureDiagnostic(
            'occ-invalid-document-cursor',
            'The requested document cursor does not resolve to an authored history item.',
            [],
            request.cursor.kind === 'sketch'
              ? [{ kind: 'sketch' as const, sketchId: request.cursor.sketchId }]
              : [],
          )]
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        diagnostics,
        'occ-invalid-document-cursor',
      )

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        cursor: runtimeState.authoringState.cursor,
        changedTargets: [],
        ...rejected,
      }
    }

    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)
    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      cursor: request.cursor,
    })

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [], nextAuthoringState.partial)

    return this.withOperationEnvelope({
      cursor: request.cursor,
      changedTargets: request.cursor.kind === 'feature'
        ? [{ kind: 'feature' as const, featureId: request.cursor.featureId }]
        : request.cursor.kind === 'sketch'
          ? [{ kind: 'sketch' as const, sketchId: request.cursor.sketchId }]
        : [],
      ...accepted,
    })
  }

  async addDocumentVariable(request: AddDocumentVariableRequest): Promise<AddDocumentVariableResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.addDocumentVariable(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)
    const variableId = request.variableId ?? allocateDocumentVariableId(runtimeState.authoringState)

    if (request.baseRevisionId !== currentRevisionId) {
      const conflict = this.buildConflictResult(request.baseRevisionId, currentRevisionId)
      return this.withOperationEnvelope({
        variableId,
        changedTargets: [],
        ...conflict,
      })
    }

    const candidateVariables = [
      ...runtimeState.authoringState.variables,
      {
        variableId,
        name: request.name,
        valueText: request.valueText,
      },
    ]
    const variableValidation = evaluateDocumentVariableExpressions(candidateVariables)

    if (!variableValidation.ok) {
      const diagnostics = createDocumentVariableExpressionDiagnostics(variableValidation.diagnostics)
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        diagnostics,
        diagnostics[0]?.code ?? 'document-variable-invalid-expression',
      )

      return this.withOperationEnvelope({
        variableId,
        changedTargets: [],
        ...rejected,
      })
    }

    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)
    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      variables: candidateVariables,
    })

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [], nextAuthoringState.partial)

    return this.withOperationEnvelope({
      variableId,
      changedTargets: [],
      ...accepted,
    })
  }

  async updateDocumentVariable(request: UpdateDocumentVariableRequest): Promise<UpdateDocumentVariableResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.updateDocumentVariable(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)

    if (request.baseRevisionId !== currentRevisionId) {
      const conflict = this.buildConflictResult(request.baseRevisionId, currentRevisionId)
      return this.withOperationEnvelope({
        variableId: request.variableId,
        changedTargets: [],
        ...conflict,
      })
    }

    if (!runtimeState.authoringState.variables.some((variable) => variable.variableId === request.variableId)) {
      const diagnostics = [
        createDiagnostic(
          'occ-missing-document-variable',
          'error',
          `Document variable ${request.variableId} does not resolve in the current OCC authoring state.`,
          null,
        ),
      ]
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        diagnostics,
        'occ-missing-document-variable',
      )

      return this.withOperationEnvelope({
        variableId: request.variableId,
        changedTargets: [],
        ...rejected,
      })
    }

    const candidateVariables = runtimeState.authoringState.variables.map((variable) =>
      variable.variableId === request.variableId
        ? { variableId: request.variableId, name: request.name, valueText: request.valueText }
        : variable,
    )
    const variableValidation = evaluateDocumentVariableExpressions(candidateVariables)

    if (!variableValidation.ok) {
      const diagnostics = createDocumentVariableExpressionDiagnostics(variableValidation.diagnostics)
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        diagnostics,
        diagnostics[0]?.code ?? 'document-variable-invalid-expression',
      )

      return this.withOperationEnvelope({
        variableId: request.variableId,
        changedTargets: [],
        ...rejected,
      })
    }

    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)
    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      variables: candidateVariables,
    })

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [], nextAuthoringState.partial)

    return this.withOperationEnvelope({
      variableId: request.variableId,
      changedTargets: [],
      ...accepted,
    })
  }

  async evaluatePreview(request: EvaluatePreviewRequest): Promise<EvaluatePreviewResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.evaluatePreview(request)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)
    const previewFeatureId = `feature_preview_${request.previewId}` as FeatureId
    const previewFeature: OccAuthoringFeatureRecord = {
      featureId: previewFeatureId,
      label: `Preview ${request.previewId}`,
      definition: request.definition,
    }
    const previewInsertionIndex = getCursorInsertionIndex(
      runtimeState.authoringState.cursor,
      runtimeState.authoringState.features,
      runtimeState.authoringState.historyOrder,
    )
    const previewFeatures = [
      ...runtimeState.authoringState.features.slice(0, previewInsertionIndex),
      previewFeature,
      ...runtimeState.authoringState.features.slice(previewInsertionIndex),
    ]

    try {
      const previewState = this.buildNextAuthoringState(runtimeState, {
        revisionId: currentRevisionId,
        features: previewFeatures,
        cursor: { kind: 'feature', featureId: previewFeatureId },
      })
      const snapshot = buildOccWorkspaceSnapshot(previewState)
      const previewDiagnostics = filterPreviewInvalidationDiagnostics(
        runtimeState.authoringState,
        previewState,
        snapshot.diagnostics,
      )
      const diagnostics = request.baseRevisionId === currentRevisionId
        ? previewDiagnostics
        : [createStalePreviewDiagnostic(request.previewId, request.baseRevisionId, currentRevisionId), ...previewDiagnostics]

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        revisionId: currentRevisionId,
        previewId: request.previewId,
        freshness: request.baseRevisionId === currentRevisionId
          ? {
              kind: 'fresh',
              baseRevisionId: request.baseRevisionId,
            }
          : {
              kind: 'stale',
              requestedRevisionId: request.baseRevisionId,
              currentRevisionId,
        },
        render: {
          schemaVersion: snapshot.render.schemaVersion,
          records: buildPreviewRenderRecords(snapshot.render.records, previewFeatureId),
        },
        diagnostics,
      }
    } catch (error) {
      const diagnostics = [
        ...(request.baseRevisionId === currentRevisionId
          ? []
          : [createStalePreviewDiagnostic(request.previewId, request.baseRevisionId, currentRevisionId)]),
        isAdvancedSolidFeatureKind(request.definition.kind)
          ? createAdvancedUnsupportedDiagnostic(
              previewFeatureId,
              error instanceof Error ? error.message : `OCC adapter does not implement ${request.definition.kind} yet.`,
            )
          : createDiagnostic(
              deriveRebuildFailureCode(error),
              'error',
              error instanceof Error ? error.message : 'OCC preview rebuild failed.',
              { kind: 'feature', featureId: previewFeatureId },
              {
                kind: 'rebuildFailure',
                affectedFeatureIds: [previewFeatureId],
                affectedTargets: [{ kind: 'feature', featureId: previewFeatureId }],
              },
            ),
      ]

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: this.documentId,
        revisionId: currentRevisionId,
        previewId: request.previewId,
        freshness: request.baseRevisionId === currentRevisionId
          ? {
              kind: 'fresh',
              baseRevisionId: request.baseRevisionId,
            }
          : {
              kind: 'stale',
              requestedRevisionId: request.baseRevisionId,
              currentRevisionId,
            },
        render: {
          schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
          records: [],
        },
        diagnostics,
      }
    }
  }

  async getExportCapabilities(baseRevisionId: RevisionId): Promise<ExportCapabilities | DocumentExportDiagnostic> {
    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.getExportCapabilities(baseRevisionId)
    }

    const runtimeState = await this.getRuntimeState()
    const currentRevisionId = this.getCurrentRevisionId(runtimeState)

    if (baseRevisionId !== currentRevisionId) {
      return createOccExportDiagnostic(
        'occ-export-revision-conflict',
        `Export request revision ${baseRevisionId} does not match current revision ${currentRevisionId}.`,
        null,
      )
    }

    return createOccExportCapabilities(runtimeState.authoringState)
  }

  async resolveReference(request: ResolveReferenceRequest): Promise<ResolveReferenceResponse> {
    assertSupportedModelingRequest(request, this.documentId)

    if (this.workerSnapshotClient) {
      return this.workerSnapshotClient.resolveReference(request)
    }

    const runtimeState = await this.getRuntimeState()
    const resolved = resolveOccReference({
      documentId: this.documentId,
      revisionId: runtimeState.authoringState.revisionId,
      referenceState: runtimeState.authoringState.referenceState,
    }, request.target)

    return {
      contractVersion: CONTRACT_VERSION,
      resolution: resolved.resolution,
      diagnostics: resolved.diagnostics,
    }
  }
}
