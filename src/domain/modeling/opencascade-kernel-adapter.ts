import type { ModelingKernelAdapter } from '@/contracts/modeling/adapter'
import type { SketchSolverAdapter } from '@/contracts/solver/adapter'
import type { SolverTolerancePolicy } from '@/contracts/solver/schema'
import { SOLVER_SCHEMA_VERSION } from '@/contracts/solver/schema'
import type {
  CommitSketchRequest,
  CommitSketchResponse,
  CreateFeatureRequest,
  CreateFeatureResponse,
  DeleteFeatureRequest,
  DeleteFeatureResponse,
  EvaluatePreviewRequest,
  EvaluatePreviewResponse,
  FeatureDefinition,
  GetDocumentSnapshotRequest,
  GetDocumentSnapshotResponse,
  ModelingDiagnostic,
  ModelingDiagnosticDetail,
  ReorderFeatureRequest,
  ReorderFeatureResponse,
  ResolveReferenceRequest,
  ResolveReferenceResponse,
  SetFeatureCursorRequest,
  SetFeatureCursorResponse,
  SketchSnapshotRecord,
  UpdateFeatureRequest,
  UpdateFeatureResponse,
} from '@/contracts/modeling/schema'
import { isAdvancedSolidFeatureKind } from '@/contracts/modeling/advanced-solid'
import type {
  BodyId,
  DocumentId,
  FeatureId,
  RegionId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
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
import { buildOccWorkspaceSnapshot } from '@/domain/modeling/occ/snapshot'
import {
  getOccDurableRefKey,
  resolveOccReference,
} from '@/domain/modeling/occ/topology'
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
  documentId?: DocumentId
  tolerances?: SolverTolerancePolicy
}

interface OccKernelRuntimeState {
  authoringState: OccAuthoringState
  revisionSequence: number
}

const DEFAULT_SOLVER_TOLERANCES: SolverTolerancePolicy = {
  coincidence: OCC_KERNEL_SETTINGS.modelingTolerance,
  angleRadians: OCC_KERNEL_SETTINGS.angularToleranceRadians,
  minimumSegmentLength: OCC_KERNEL_SETTINGS.modelingTolerance,
}

const OCC_REVISION_CONFLICT_CODE = 'occ-revision-conflict'
const OCC_VALIDATION_ERROR_CODE = 'occ-validation-error'
const OCC_MISSING_FEATURE_CODE = 'occ-missing-feature'
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
  if (request.contractVersion !== CONTRACT_VERSION) {
    throw new Error(`Unsupported contract version ${request.contractVersion}; expected ${CONTRACT_VERSION}.`)
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

function createMissingReorderAnchorDiagnostic(featureId: FeatureId): ModelingDiagnostic {
  return createDiagnostic(
    OCC_MISSING_REORDER_ANCHOR_CODE,
    'error',
    `Feature reorder anchor ${featureId} does not resolve in the current OCC authoring state.`,
    { kind: 'feature', featureId },
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
): ModelingDiagnostic {
  return createDiagnostic(
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
}

function createRebuildFailureDiagnostic(
  code: string,
  message: string,
  affectedFeatureIds: FeatureId[],
  affectedTargets: NonNullable<ModelingDiagnostic['target']>[],
): ModelingDiagnostic {
  return createDiagnostic(
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

function capitalizeFeatureKind(kind: FeatureDefinition['kind']) {
  return `${kind[0]!.toUpperCase()}${kind.slice(1)}`
}

function allocateSketchId(state: OccAuthoringState) {
  if (!state.sketches.some((sketch) => sketch.sketchId === OCC_KERNEL_PRIMARY_SKETCH_ID)) {
    return OCC_KERNEL_PRIMARY_SKETCH_ID
  }

  return `sketch_${state.sketches.length + 1}` as SketchId
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

function featureOrdinalForLabel(
  state: OccAuthoringState,
  kind: FeatureDefinition['kind'],
) {
  return state.features.filter((feature) => feature.definition.kind === kind).length + 1
}

function isValidFeatureCursor(cursor: OccAuthoringState['cursor'], features: readonly OccAuthoringFeatureRecord[]) {
  return cursor.kind === 'empty'
    ? features.length === 0
    : features.some((feature) => feature.featureId === cursor.featureId)
}

function getCursorInsertionIndex(cursor: OccAuthoringState['cursor'], features: readonly OccAuthoringFeatureRecord[]) {
  if (cursor.kind === 'empty') {
    return 0
  }

  const index = features.findIndex((feature) => feature.featureId === cursor.featureId)
  return index < 0 ? features.length : index + 1
}

function getAppliedFeatures(
  features: readonly OccAuthoringFeatureRecord[],
  cursor: OccAuthoringState['cursor'],
) {
  if (cursor.kind === 'empty') {
    return []
  }

  const cursorIndex = features.findIndex((feature) => feature.featureId === cursor.featureId)
  return cursorIndex < 0 ? features : features.slice(0, cursorIndex + 1)
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
  state: OccAuthoringState,
  previewFeatureId: FeatureId,
  diagnostics: readonly ModelingDiagnostic[],
) {
  return buildOccWorkspaceSnapshot(state, diagnostics)
    .render
    .records
    .filter((record) => record.ownerFeatureId === previewFeatureId)
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

type RebuildAttempt =
  | { ok: true; state: OccAuthoringState }
  | { ok: false; reasonCode: string; diagnostics: ModelingDiagnostic[] }

function collectInvalidConsumedTargetDiagnostics(
  state: Pick<OccAuthoringState, 'documentId' | 'revisionId' | 'referenceState'>,
  definition: FeatureDefinition,
) {
  const diagnostics: ModelingDiagnostic[] = []

  for (const target of getFeatureConsumedTargets(definition)) {
    const resolved = resolveOccReference({
      documentId: state.documentId,
      revisionId: state.revisionId,
      referenceState: state.referenceState,
    }, target)

    if (resolved.resolution.invalidation !== null) {
      diagnostics.push(createInvalidReferenceDiagnostic(resolved.resolution))
    }
  }

  return diagnostics
}

export class OpenCascadeKernelAdapter implements ModelingKernelAdapter {
  private readonly solverAdapter: SketchSolverAdapter
  private readonly solverAdapterFactory?: (revisionId: RevisionId) => SketchSolverAdapter
  private readonly loadOpenCascadeInstance: () => Promise<OpenCascadeInstance>
  private readonly documentId: DocumentId
  private readonly tolerances: SolverTolerancePolicy

  private initializationPromise: Promise<OccKernelRuntimeState> | null = null
  private runtimeState: OccKernelRuntimeState | null = null

  constructor(options: OpenCascadeKernelAdapterOptions) {
    this.solverAdapter = options.solverAdapter
    this.solverAdapterFactory = options.solverAdapterFactory
    this.loadOpenCascadeInstance = options.getOpenCascadeInstance ?? getOpenCascadeInstance
    this.documentId = options.documentId ?? OCC_KERNEL_DOCUMENT_ID
    this.tolerances = options.tolerances ?? DEFAULT_SOLVER_TOLERANCES
  }

  private getSolverAdapter(revisionId: RevisionId) {
    if (this.solverAdapterFactory) {
      return this.solverAdapterFactory(revisionId)
    }

    return this.solverAdapter
  }

  private async getRuntimeState() {
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

  private replaceRuntimeState(runtimeState: OccKernelRuntimeState) {
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
      features?: readonly OccAuthoringFeatureRecord[]
      cursor?: OccAuthoringState['cursor']
    },
  ) {
    const baseState = createOccAuthoringState(runtimeState.authoringState.oc, {
      documentId: this.documentId,
      revisionId: input.revisionId,
      modelingTolerance: runtimeState.authoringState.modelingTolerance,
      sketches: input.sketches ?? runtimeState.authoringState.sketches,
      bodies: runtimeState.authoringState.baseBodies,
      constructions: runtimeState.authoringState.baseConstructions,
      constructionPlanes: runtimeState.authoringState.baseConstructionPlanes,
    })

    let current = baseState
    const features = input.features ?? runtimeState.authoringState.features
    const cursor = input.cursor ?? runtimeState.authoringState.cursor

    for (const feature of getAppliedFeatures(features, cursor)) {
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
  ) {
    const invalidatedTargets = getNewInvalidatedTargets(previousState, nextState)
    const diagnostics = buildOccWorkspaceSnapshot(nextState, extraDiagnostics).diagnostics

    return {
      revisionId: nextState.revisionId,
      revisionState: {
        kind: 'accepted' as const,
        baseRevisionId: previousState.revisionId,
      },
      rebuildResult: {
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
      features?: readonly OccAuthoringFeatureRecord[]
      cursor?: OccAuthoringState['cursor']
    },
  ): RebuildAttempt {
    const features = input.features ?? runtimeState.authoringState.features
    const cursor = input.cursor ?? runtimeState.authoringState.cursor
    const baseState = createOccAuthoringState(runtimeState.authoringState.oc, {
      documentId: this.documentId,
      revisionId: input.revisionId,
      modelingTolerance: runtimeState.authoringState.modelingTolerance,
      sketches: input.sketches ?? runtimeState.authoringState.sketches,
      bodies: runtimeState.authoringState.baseBodies,
      constructions: runtimeState.authoringState.baseConstructions,
      constructionPlanes: runtimeState.authoringState.baseConstructionPlanes,
      previousReferenceState: runtimeState.authoringState.referenceState,
      cursor: { kind: 'empty' },
    })

    let current = baseState

    for (const feature of getAppliedFeatures(features, cursor)) {
      const invalidConsumedTargetDiagnostics = collectInvalidConsumedTargetDiagnostics(
        current,
        feature.definition,
      )

      if (invalidConsumedTargetDiagnostics.length > 0) {
        return {
          ok: false,
          reasonCode: invalidConsumedTargetDiagnostics[0]!.code,
          diagnostics: invalidConsumedTargetDiagnostics,
        }
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
            : [createInvalidReferenceDiagnostic(resolved.resolution)]
        })

        if (invalidDiagnostics.length > 0) {
          return {
            ok: false,
            reasonCode: invalidDiagnostics[0]!.code,
            diagnostics: invalidDiagnostics,
          }
        }

        return {
          ok: false,
          reasonCode: deriveRebuildFailureCode(error),
          diagnostics: [
            createRebuildFailureDiagnostic(
              deriveRebuildFailureCode(error),
              error instanceof Error ? error.message : 'OCC rebuild failed.',
              [feature.featureId],
              uniqueTargets(consumedTargets),
            ),
          ],
        }
      }
    }

    const rebuiltFeatures = new Map(current.features.map((feature) => [feature.featureId, feature]))

    return {
      ok: true,
      state: {
        ...current,
        features: features.map((feature) => rebuiltFeatures.get(feature.featureId) ?? feature),
        cursor,
      },
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
    const runtimeState = await this.getRuntimeState()

    return {
      contractVersion: CONTRACT_VERSION,
      snapshot: structuredClone(buildOccWorkspaceSnapshot(runtimeState.authoringState)),
    }
  }

  async commitSketch(request: CommitSketchRequest): Promise<CommitSketchResponse> {
    assertSupportedModelingRequest(request, this.documentId)
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

    const projection = await solverAdapter.projectExternalReferences({
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
    })

    const solverDiagnostics = [
      ...projection.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
      ...validation.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
      ...solved.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
      ...regions.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
    ]

    if (!validation.isValid || solved.status.solveState !== 'solved') {
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
    )
    const nextSketches = runtimeState.authoringState.sketches.some((entry) => entry.sketchId === sketchId)
      ? runtimeState.authoringState.sketches.map((entry) => (entry.sketchId === sketchId ? snapshotRecord : entry))
      : [...runtimeState.authoringState.sketches, snapshotRecord]

    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      sketches: nextSketches,
    })
    if (!nextAuthoringState.ok) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        nextAuthoringState.diagnostics,
        nextAuthoringState.reasonCode,
      )

      return this.withOperationEnvelope({
        sketchId,
        changedTargets: [],
        ...rejected,
      })
    }

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const accepted = this.buildAcceptedResult(
      runtimeState.authoringState,
      nextAuthoringState.state,
      solverDiagnostics,
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
      label: `${capitalizeFeatureKind(request.definition.kind)} ${featureOrdinalForLabel(runtimeState.authoringState, request.definition.kind)}`,
      definition: request.definition,
    }
    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)

    const nextFeatures = [...runtimeState.authoringState.features]
    nextFeatures.splice(getCursorInsertionIndex(runtimeState.authoringState.cursor, nextFeatures), 0, feature)

    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      features: nextFeatures,
      cursor: { kind: 'feature', featureId },
    })
    if (!nextAuthoringState.ok) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        nextAuthoringState.diagnostics,
        nextAuthoringState.reasonCode,
      )

      return this.withOperationEnvelope({
        featureId,
        changedTargets: [],
        ...rejected,
      })
    }

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const featureSnapshot = nextAuthoringState.state.features.find((entry) => entry.featureId === featureId)
    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [])

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

    const existing = runtimeState.authoringState.features.find((entry) => entry.featureId === request.featureId)

    if (!existing) {
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

    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)
    const nextFeatures = runtimeState.authoringState.features.map((feature) =>
      feature.featureId === request.featureId
        ? {
            ...feature,
            definition: request.definition,
          }
        : feature,
    )

    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      features: nextFeatures,
    })
    if (!nextAuthoringState.ok) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        nextAuthoringState.diagnostics,
        nextAuthoringState.reasonCode,
      )

      return this.withOperationEnvelope({
        featureId: request.featureId,
        changedTargets: [],
        ...rejected,
      })
    }

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const updated = nextAuthoringState.state.features.find((entry) => entry.featureId === request.featureId)
    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [])

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

    const existing = runtimeState.authoringState.features.find((entry) => entry.featureId === request.featureId)

    if (!existing) {
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

    const nextSequence = runtimeState.revisionSequence + 1
    const nextRevisionId = createRevisionId(nextSequence)
    const nextFeatures = runtimeState.authoringState.features.filter(
      (feature) => feature.featureId !== request.featureId,
    )
    const nextCursor = isValidFeatureCursor(runtimeState.authoringState.cursor, nextFeatures)
      ? runtimeState.authoringState.cursor
      : (() => {
          const tail = nextFeatures.at(-1)
          return tail ? { kind: 'feature' as const, featureId: tail.featureId } : { kind: 'empty' as const }
        })()

    const nextAuthoringState = this.tryBuildNextAuthoringState(runtimeState, {
      revisionId: nextRevisionId,
      features: nextFeatures,
      cursor: nextCursor,
    })
    if (!nextAuthoringState.ok) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        nextAuthoringState.diagnostics,
        nextAuthoringState.reasonCode,
      )

      return this.withOperationEnvelope({
        deletedFeatureId: request.featureId,
        changedTargets: [],
        ...rejected,
      })
    }

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [])

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

  async reorderFeature(request: ReorderFeatureRequest): Promise<ReorderFeatureResponse> {
    assertSupportedModelingRequest(request, this.documentId)
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
    if (!nextAuthoringState.ok) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        nextAuthoringState.diagnostics,
        nextAuthoringState.reasonCode,
      )

      return this.withOperationEnvelope({
        featureId: request.featureId,
        beforeFeatureId: request.beforeFeatureId,
        changedTargets: [],
        ...rejected,
      })
    }

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [])

    return {
      ...this.withOperationEnvelope({
        featureId: request.featureId,
        beforeFeatureId: request.beforeFeatureId,
        changedTargets: [{ kind: 'feature', featureId: request.featureId }],
        ...accepted,
      }),
    }
  }

  async setFeatureCursor(request: SetFeatureCursorRequest): Promise<SetFeatureCursorResponse> {
    assertSupportedModelingRequest(request, this.documentId)
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

    if (!isValidFeatureCursor(request.cursor, runtimeState.authoringState.features)) {
      const diagnostics = request.cursor.kind === 'feature'
        ? [createMissingFeatureDiagnostic(request.cursor.featureId)]
        : [createRebuildFailureDiagnostic(
            'occ-invalid-document-cursor',
            'The empty document cursor is only valid when the document has no features.',
            [],
            [],
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

    if (!nextAuthoringState.ok) {
      const rejected = this.buildRejectedResult(
        request.baseRevisionId,
        nextAuthoringState.diagnostics,
        nextAuthoringState.reasonCode,
      )

      return this.withOperationEnvelope({
        cursor: runtimeState.authoringState.cursor,
        changedTargets: [],
        ...rejected,
      })
    }

    this.replaceRuntimeState({
      authoringState: nextAuthoringState.state,
      revisionSequence: nextSequence,
    })

    const accepted = this.buildAcceptedResult(runtimeState.authoringState, nextAuthoringState.state, [])

    return this.withOperationEnvelope({
      cursor: request.cursor,
      changedTargets: request.cursor.kind === 'feature'
        ? [{ kind: 'feature' as const, featureId: request.cursor.featureId }]
        : [],
      ...accepted,
    })
  }

  async evaluatePreview(request: EvaluatePreviewRequest): Promise<EvaluatePreviewResponse> {
    assertSupportedModelingRequest(request, this.documentId)
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
          records: buildPreviewRenderRecords(previewState, previewFeatureId, []),
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
          schemaVersion: buildOccWorkspaceSnapshot(runtimeState.authoringState).render.schemaVersion,
          records: [],
        },
        diagnostics,
      }
    }
  }

  async resolveReference(request: ResolveReferenceRequest): Promise<ResolveReferenceResponse> {
    assertSupportedModelingRequest(request, this.documentId)
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
