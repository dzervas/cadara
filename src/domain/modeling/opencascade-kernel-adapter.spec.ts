import { test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import { createAuthoredModelDocumentFromSnapshot, type AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { SketchSolverAdapter } from '@/contracts/solver/adapter'
import type {
  DeriveSketchRegionsRequest,
  DeriveSketchRegionsResponse,
  ProjectedSketchReferenceRecord,
  ProjectSketchExternalReferencesRequest,
  ProjectSketchExternalReferencesResponse,
  ResolveSketchReferenceRequest,
  ResolveSketchReferenceResponse,
  SolveSketchRequest,
  SolveSketchResponse,
  ValidateSketchRequest,
  ValidateSketchResponse,
} from '@/contracts/solver/schema'
import { SOLVER_SCHEMA_VERSION } from '@/contracts/solver/schema'
import type {
  BodySnapshotRecord,
  AdvancedParticipantValue,
  CommitSketchRequest,
  FeatureDefinition,
  GetDocumentSnapshotResponse,
  ModelingDiagnostic,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import type {
  BodyId,
  ConstructionId,
  ConstraintId,
  EdgeId,
  DocumentId,
  FaceId,
  FeatureId,
  ProjectedGeometryId,
  ReferenceId,
  RegionId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
  VertexId,
} from '@/contracts/shared/ids'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
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
import { encodeGeometryAssetData, normalizeGeometryAssetManifest, type GeometryAssetHash, type GeometryAssetRecord } from '@/contracts/modeling/geometry-assets'
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from '@/contracts/modeling/advanced-solid'
import { OCC_CONTRACT_GAP_CODES } from '@/domain/modeling/occ/implementation-policy'
import {
  DEFAULT_MOCK_SOLVER_TOLERANCES,
  evaluateMockSketchDefinition,
} from '@/domain/solver/mock-sketch-solver-adapter'
import { SketchConstraintSolverAdapter } from '@/domain/solver/sketch-constraint-solver-adapter'
import {
  OCC_KERNEL_PRIMARY_SKETCH_ID,
  createSeedSketchCommitRequest,
  createStandardPlaneDefinition,
} from '@/domain/modeling/opencascade-kernel-seed'
import { OpenCascadeKernelAdapter } from '@/domain/modeling/opencascade-kernel-adapter'
import { createModelingService } from '@/domain/modeling/modeling-service'
import { createMemoryOperationHistoryStore } from '@/domain/modeling/modeling-history-persistence'
import { getDefaultOpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import type { DocumentRepository } from '@/domain/modeling/document-repository'
import {
  COLLABORATIVE_MERGE_DIAGNOSTIC_CODES,
  normalizeCollaborativeAuthoredModelDocument,
} from '@/domain/modeling/collaborative-authored-document'
import { createEmptyOperationHistory, type ModelingOperationHistoryPayload } from '@/contracts/modeling/operation-history'
import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
import { extractSolidShapes, getOccDurableRefKey } from '@/domain/modeling/occ/topology'
import { getDefaultDocumentExportOptions } from '@/contracts/modeling/export.runtime-schema'
import type { AppResultAsync } from '@/contracts/errors'
import { createMemoryDocumentRepository } from '@/domain/modeling/memory-document-repository'
import { getNextDocumentHistoryCursor } from '@/domain/modeling/document-history'
import { hashGeometryAssetBytes } from '@/domain/modeling/geometry-asset-store'
import { toGpPnt } from '@/domain/modeling/occ/geometry'
import { createBakedMeshGeometryAsset } from '@/domain/modeling/baked-mesh-geometry'
import type { MeshPoint, MeshTriangle } from '@/domain/modeling/mesh-parser'
import { createStepSolidKey } from '@/contracts/modeling/step-import'
import { bakeStepImportGeometryWithOpenCascade } from '@/domain/modeling/occ/features'

test('src/domain/modeling/opencascade-kernel-adapter.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function unwrapModelingResult<T>(result: AppResultAsync<T>): Promise<T> {
    const resolved = await result
    assert(resolved.isOk(), resolved.isErr() ? resolved.error.message : 'Modeling result should be ok.')
    return resolved.value
  }

  async function expectModelingError<T>(result: AppResultAsync<T>) {
    const resolved = await result
    assert(resolved.isErr(), 'Modeling result should be an error.')
    return resolved.error
  }

  function createProjectedGeometryId(referenceId: string, ordinal: number): ProjectedGeometryId {
    return `projected_geometry_${referenceId}_${ordinal}` as ProjectedGeometryId
  }

  function projectReference(
    reference: ProjectSketchExternalReferencesRequest['references'][number],
  ): ProjectedSketchReferenceRecord {
    if (reference.reference.kind === 'constructionPlane') {
      return {
        referenceId: reference.referenceId,
        status: 'projected',
        geometry: [],
        diagnostics: [],
      }
    }

    if (reference.reference.source.kind === 'vertex') {
      return {
        referenceId: reference.referenceId,
        status: 'projected',
        geometry: [{
          geometryId: createProjectedGeometryId(reference.referenceId, 0),
          kind: 'point',
          position: [0, 0],
        }],
        diagnostics: [],
      }
    }

    if (reference.reference.source.kind === 'edge') {
      return {
        referenceId: reference.referenceId,
        status: 'projected',
        geometry: [{
          geometryId: createProjectedGeometryId(reference.referenceId, 0),
          kind: 'lineSegment',
          startPosition: [-2, 0],
          endPosition: [2, 0],
        }],
        diagnostics: [],
      }
    }

    return {
      referenceId: reference.referenceId,
      status: 'projected',
      geometry: [{
        geometryId: createProjectedGeometryId(reference.referenceId, 0),
        kind: 'circle',
        centerPosition: [0, 0],
        radius: 1,
      }],
      diagnostics: [],
    }
  }

  class DeterministicSketchSolverAdapter implements SketchSolverAdapter {
    async projectExternalReferences(
      request: ProjectSketchExternalReferencesRequest,
    ): Promise<ProjectSketchExternalReferencesResponse> {
      return {
        contractVersion: CONTRACT_VERSION,
        solverSchemaVersion: SOLVER_SCHEMA_VERSION,
        requestId: request.requestId,
        documentId: request.documentId,
        revisionId: request.revisionId,
        sketchId: request.sketchId,
        projectedReferences: request.references.map(projectReference),
        diagnostics: [],
      }
    }

    async validateSketch(request: ValidateSketchRequest): Promise<ValidateSketchResponse> {
      const evaluation = evaluateMockSketchDefinition({
        documentId: request.documentId,
        revisionId: request.revisionId,
        sketchId: request.sketchId,
        plane: request.plane,
        tolerances: request.tolerances,
        definition: request.definition,
        requestId: request.requestId,
      })

      return evaluation.validation
    }

    async solveSketch(request: SolveSketchRequest): Promise<SolveSketchResponse> {
      const evaluation = evaluateMockSketchDefinition({
        documentId: request.documentId,
        revisionId: request.revisionId,
        sketchId: request.sketchId,
        plane: request.plane,
        tolerances: request.tolerances,
        definition: request.definition,
        requestId: request.requestId,
      })

      return evaluation.solve
    }

    async deriveSketchRegions(
      request: DeriveSketchRegionsRequest,
    ): Promise<DeriveSketchRegionsResponse> {
      const evaluation = evaluateMockSketchDefinition({
        documentId: request.documentId,
        revisionId: request.revisionId,
        sketchId: request.sketchId,
        plane: createSeedSketchCommitRequest().plane.frame,
        tolerances: DEFAULT_MOCK_SOLVER_TOLERANCES,
        definition: request.definition,
        requestId: request.requestId,
      })

      return evaluation.regions
    }

    async resolveSketchReference(
      request: ResolveSketchReferenceRequest,
    ): Promise<ResolveSketchReferenceResponse> {
      void request
      throw new Error('OCC adapter tests do not exercise resolveSketchReference directly.')
    }
  }

  class ProjectedRegionLoopSketchSolverAdapter extends DeterministicSketchSolverAdapter {
    override async deriveSketchRegions(
      request: DeriveSketchRegionsRequest,
    ): Promise<DeriveSketchRegionsResponse> {
      const response = await super.deriveSketchRegions(request)
      const region = response.regions[0]
      const loop = region?.loops[0]
      const segment = loop?.segments[0]

      if (!region || !loop || !segment) {
        return response
      }

      const referenceId = request.definition.referenceIds[0] ?? 'ref_projected_gap'

      return {
        ...response,
        regions: [
          {
            ...region,
            loops: [
              {
                ...loop,
                segments: [
                  {
                    ...segment,
                    source: {
                      kind: 'projectedGeometry',
                      reference: {
                        referenceId,
                        geometryId: createProjectedGeometryId(referenceId, 0),
                      },
                    },
                  },
                  ...loop.segments.slice(1),
                ],
              },
              ...region.loops.slice(1),
            ],
          },
          ...response.regions.slice(1),
        ],
      }
    }
  }

  function createAdapter(
    createSolverAdapter: () => SketchSolverAdapter = () => new DeterministicSketchSolverAdapter(),
    options: Partial<ConstructorParameters<typeof OpenCascadeKernelAdapter>[0]> = {},
  ) {
    return new OpenCascadeKernelAdapter({
      solverAdapter: createSolverAdapter(),
      solverAdapterFactory: () => createSolverAdapter(),
      ...options,
    })
  }

  async function waitFor(condition: () => boolean, message: string, attempts = 1_000) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (condition()) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    throw new Error(message)
  }

  function createPermissiveRestoredRepository(
    document: AuthoredModelDocument,
    diagnostics: ReturnType<typeof normalizeCollaborativeAuthoredModelDocument>['diagnostics'] = [],
  ): DocumentRepository {
    const metadata = {
      documentId: document.documentId,
      heads: [`test:${document.revisionId}`],
      source: 'restore' as const,
    }
    const status = { kind: 'restored' as const, documentId: document.documentId }

    return {
      async load() {
        return {
          ok: true,
          document: structuredClone(document),
          diagnostics,
          status,
          metadata,
        }
      },
      async mutate() {
        throw new Error('Test repository should not receive OCC restore writes.')
      },
      subscribe() {
        return () => {}
      },
      async reset() {
        return { kind: 'reset' as const, documentId: document.documentId }
      },
      getRestoreStatus() {
        return status
      },
      getMetadata() {
        return metadata
      },
    }
  }

  function createSolverCorrelation(prefix: string) {
    return {
      requestId: `request_${prefix}_commit` as const,
      projectionRequestId: `request_${prefix}_project` as const,
      validationRequestId: `request_${prefix}_validate` as const,
      solveRequestId: `request_${prefix}_solve` as const,
      regionRequestId: `request_${prefix}_regions` as const,
    }
  }

  function createSketchCommitRequest(
    baseRevisionId: RevisionId,
    overrides: Partial<ReturnType<typeof createSeedSketchCommitRequest>> = {},
  ): CommitSketchRequest {
    const seed = createSeedSketchCommitRequest()
    const plane = overrides.plane ?? seed.plane

    return {
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace' as DocumentId,
      baseRevisionId,
      solverCorrelation: createSolverCorrelation(`request_${String(baseRevisionId)}_${overrides.sketchLabel ?? seed.sketchLabel}`),
      ...seed,
      ...overrides,
      plane,
      planeTarget: plane.support,
      planeKey: plane.key,
    }
  }

  function createServiceSketchCommitInput(
    request: CommitSketchRequest,
  ): Omit<CommitSketchRequest, 'contractVersion' | 'documentId'> {
    return {
      baseRevisionId: request.baseRevisionId,
      solverCorrelation: request.solverCorrelation,
      sketchId: request.sketchId,
      sketchLabel: request.sketchLabel,
      plane: request.plane,
      planeTarget: request.planeTarget,
      planeKey: request.planeKey,
      definition: request.definition,
    }
  }

  async function commitSeedSketch(
    adapter: OpenCascadeKernelAdapter,
    baseRevisionId: RevisionId = 'rev_0001',
  ) {
    return adapter.commitSketch(createSketchCommitRequest(baseRevisionId))
  }

  function translateSeedDefinition(offsetX: number, offsetY: number) {
    const seed = createSeedSketchCommitRequest().definition

    return {
      ...seed,
      points: seed.points.map((point) => ({
        ...point,
        position: [point.position[0] + offsetX, point.position[1] + offsetY] as const,
      })),
    }
  }

  async function commitOffsetSketch(
    adapter: OpenCascadeKernelAdapter,
    baseRevisionId: RevisionId,
    options: {
      sketchLabel: string
      offsetX: number
      offsetY: number
      plane?: ReturnType<typeof createStandardPlaneDefinition>
    },
  ) {
    return adapter.commitSketch(createSketchCommitRequest(baseRevisionId, {
      sketchLabel: options.sketchLabel,
      plane: options.plane,
      definition: translateSeedDefinition(options.offsetX, options.offsetY),
    }))
  }

  function requirePrimarySketch(snapshot: GetDocumentSnapshotResponse['snapshot']): SketchSnapshotRecord {
    const sketch = snapshot.sketches.find((entry) => entry.sketchId === OCC_KERNEL_PRIMARY_SKETCH_ID)

    if (!sketch) {
      throw new Error('Primary committed sketch must exist in the snapshot.')
    }

    return sketch
  }

  function requireSketch(snapshot: GetDocumentSnapshotResponse['snapshot'], sketchId: SketchId) {
    const sketch = snapshot.sketches.find((entry) => entry.sketchId === sketchId)

    if (!sketch) {
      throw new Error(`Expected snapshot to contain sketch ${sketchId}.`)
    }

    return sketch
  }

  function requireBody(snapshot: GetDocumentSnapshotResponse['snapshot'], bodyId: BodyId): BodySnapshotRecord {
    const body = snapshot.bodies.find((entry) => entry.bodyId === bodyId)

    if (!body) {
      throw new Error(`Expected snapshot to contain body ${bodyId}.`)
    }

    return body
  }

  function hasErrorDiagnostics(diagnostics: readonly ModelingDiagnostic[]) {
    return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  }

  function hasFeatureExecutionFailureDiagnostics(diagnostics: readonly ModelingDiagnostic[]) {
    return diagnostics.some((diagnostic) =>
      diagnostic.detail?.kind === 'rebuildFailure'
      || diagnostic.detail?.kind === 'advancedFeatureValidation',
    )
  }

  function assertNoErrorDiagnostics(diagnostics: readonly ModelingDiagnostic[], message: string) {
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error')

    if (errors.length > 0) {
      throw new Error(`${message}: ${errors.map((diagnostic) => `${diagnostic.code}=${diagnostic.message}`).join(' | ')}`)
    }
  }

  function topologySignature(body: BodySnapshotRecord) {
    return JSON.stringify(body.topology)
  }

  function renderGeometrySignature(
    snapshot: GetDocumentSnapshotResponse['snapshot'],
    bodyId: BodyId,
  ) {
    const records = snapshot.render.records
      .filter((record) => record.ownerBodyId === bodyId)
      .map((record) => ({
        id: record.id,
        geometry: record.geometry,
        binding: record.binding,
      }))

    return JSON.stringify(records)
  }

  function bodyRenderGeometryOnlySignature(
    snapshot: GetDocumentSnapshotResponse['snapshot'],
    bodyId: BodyId,
  ) {
    const records = snapshot.render.records
      .filter((record) => record.ownerBodyId === bodyId)
      .map((record) => JSON.stringify(record.geometry))
      .sort()

    return JSON.stringify(records)
  }

  function committedBodySignature(
    snapshot: GetDocumentSnapshotResponse['snapshot'],
    bodyId: BodyId,
  ) {
    return JSON.stringify({
      topology: requireBody(snapshot, bodyId).topology,
      render: renderGeometrySignature(snapshot, bodyId),
    })
  }

  function createExtrudeDefinition(sketch: SketchSnapshotRecord, distance: number): FeatureDefinition {
    const region = sketch.sketch.regions[0]

    if (!region) {
      throw new Error('Committed sketch must expose at least one derived region for extrude testing.')
    }

    return {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{
          kind: 'region',
          sketchId: sketch.sketchId,
          regionId: region.regionId,
        }],
        startExtent: { kind: 'profilePlane' },
        endExtent: { kind: 'blind', direction: 'positive', distance },
        operation: 'newBody',
        booleanScope: { kind: 'standalone' },
      },
    }
  }

  function createPlaneDefinitionFromConstruction(constructionId: `construction_${string}`): FeatureDefinition {
    return {
      kind: 'plane',
      featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
      parameters: {
        mode: 'coplanar',
        reference: {
          target: { kind: 'construction', constructionId },
        },
      },
    }
  }

  function createPlaneDefinitionFromFace(bodyId: BodyId, faceId: FaceId): FeatureDefinition {
    return {
      kind: 'plane',
      featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
      parameters: {
        mode: 'coplanar',
        reference: {
          target: { kind: 'face', bodyId, faceId },
        },
      },
    }
  }

  function createRevolveDefinition(
    sketch: SketchSnapshotRecord,
    axisBodyId: BodyId,
    axisEdgeId: EdgeId,
  ): FeatureDefinition {
    const region = sketch.sketch.regions[0]

    if (!region) {
      throw new Error('Committed sketch must expose a region for revolve testing.')
    }

    return {
      kind: 'revolve',
      featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{
          kind: 'region',
          sketchId: sketch.sketchId,
          regionId: region.regionId,
        }],
        axis: {
          kind: 'edge',
          bodyId: axisBodyId,
          edgeId: axisEdgeId,
        },
        startAngle: 0,
        extent: { kind: 'angle', direction: 'counterClockwise', radians: Math.PI / 2 },
        angle: Math.PI / 2,
        operation: 'newBody',
        booleanScope: { kind: 'standalone' },
      },
    }
  }

  function createSweepDefinition(
    sketch: SketchSnapshotRecord,
    pathBodyId: BodyId,
    pathEdgeId: EdgeId,
    extraParticipants: readonly AdvancedParticipantValue[] = [],
  ): FeatureDefinition {
    const region = sketch.sketch.regions[0]

    if (!region) {
      throw new Error('Committed sketch must expose a region for sweep testing.')
    }

    return {
      kind: 'sweep',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          {
            role: 'profile',
            targets: [{
              kind: 'region',
              sketchId: sketch.sketchId,
              regionId: region.regionId,
            }],
          },
          {
            role: 'path',
            targets: [{
              kind: 'edge',
              bodyId: pathBodyId,
              edgeId: pathEdgeId,
            }],
          },
          ...(extraParticipants ?? []),
        ],
      },
    }
  }

  function createLoftDefinition(
    sketch: SketchSnapshotRecord,
    secondaryProfile:
      | { kind: 'face'; bodyId: BodyId; faceId: FaceId }
      | { kind: 'region'; sketchId: SketchId; regionId: RegionId },
    extraParticipants: readonly AdvancedParticipantValue[] = [],
  ): FeatureDefinition {
    const region = sketch.sketch.regions[0]

    if (!region) {
      throw new Error('Committed sketch must expose a region for loft testing.')
    }

    return {
      kind: 'loft',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          {
            role: 'profile',
            targets: [
              {
                kind: 'region',
                sketchId: sketch.sketchId,
                regionId: region.regionId,
              },
              secondaryProfile,
            ],
          },
          ...(extraParticipants ?? []),
        ],
      },
    }
  }

  function createConstructionAxisRevolveDefinition(
    sketch: SketchSnapshotRecord,
    constructionId: `construction_${string}`,
  ): FeatureDefinition {
    const region = sketch.sketch.regions[0]

    if (!region) {
      throw new Error('Committed sketch must expose a region for revolve testing.')
    }

    return {
      kind: 'revolve',
      featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{
          kind: 'region',
          sketchId: sketch.sketchId,
          regionId: region.regionId,
        }],
        axis: {
          kind: 'construction',
          constructionId,
        },
        startAngle: 0,
        extent: { kind: 'angle', direction: 'counterClockwise', radians: Math.PI / 2 },
        angle: Math.PI / 2,
        operation: 'newBody',
        booleanScope: { kind: 'standalone' },
      },
    }
  }

  function createFilletDefinition(bodyId: BodyId, edgeId: EdgeId, radius: number): FeatureDefinition {
    return {
      kind: 'fillet',
      featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
      parameters: {
        radius,
        edgeTargets: [{ kind: 'edge', bodyId, edgeId }],
      },
    }
  }

  function createChamferDefinition(bodyId: BodyId, edgeId: EdgeId, distance: number): FeatureDefinition {
    return {
      kind: 'chamfer',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'edge', targets: [{ kind: 'edge', bodyId, edgeId }] },
        ],
        options: { distance },
      },
    }
  }

  function createThickenDefinition(bodyId: BodyId, faceId: FaceId, thickness: number, side: 'oneSide' | 'symmetric' = 'oneSide'): FeatureDefinition {
    return {
      kind: 'thicken',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'face', targets: [{ kind: 'face', bodyId, faceId }] },
        ],
        options: { thickness, side },
      },
    }
  }

  function createSplitDefinition(targetBodyId: BodyId, toolBodyId: BodyId): FeatureDefinition {
    return {
      kind: 'split',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'targetBody', targets: [{ kind: 'body', bodyId: targetBodyId }] },
          { role: 'toolBody', targets: [{ kind: 'body', bodyId: toolBodyId }] },
        ],
      },
    }
  }

  function createCombineDefinition(
    targetBodyIds: readonly BodyId[],
    toolBodyIds: readonly BodyId[],
    operationIntent: 'add' | 'subtract' | 'intersect',
  ): FeatureDefinition {
    return {
      kind: 'combine',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent,
        participants: [
          { role: 'targetBody', targets: targetBodyIds.map((bodyId) => ({ kind: 'body' as const, bodyId })) },
          { role: 'toolBody', targets: toolBodyIds.map((bodyId) => ({ kind: 'body' as const, bodyId })) },
        ],
      },
    }
  }

  function createDeleteSolidDefinition(bodyIds: readonly BodyId[]): FeatureDefinition {
    return {
      kind: 'deleteSolid',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'body', targets: bodyIds.map((bodyId) => ({ kind: 'body' as const, bodyId })) },
        ],
      },
    }
  }

  function createMirrorDefinition(bodyIds: readonly BodyId[], planeTarget: { kind: 'construction'; constructionId: ConstructionId } | { kind: 'face'; bodyId: BodyId; faceId: FaceId }): FeatureDefinition {
    return {
      kind: 'mirror',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'body', targets: bodyIds.map((bodyId) => ({ kind: 'body' as const, bodyId })) },
          { role: 'plane', targets: [planeTarget] },
        ],
        options: { copy: true },
      },
    }
  }

  function createTransformDefinition(bodyIds: readonly BodyId[], referenceTarget: { kind: 'construction'; constructionId: ConstructionId } | { kind: 'face'; bodyId: BodyId; faceId: FaceId }, distance: number): FeatureDefinition {
    return {
      kind: 'transform',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'body', targets: bodyIds.map((bodyId) => ({ kind: 'body' as const, bodyId })) },
          { role: 'transformReference', targets: [referenceTarget] },
        ],
        options: { distance },
      },
    }
  }

  function createShellDefinition(bodyId: BodyId, faceId: FaceId, thickness: number): FeatureDefinition {
    return {
      kind: 'shell',
      featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
      parameters: {
        bodyTarget: { kind: 'body', bodyId },
        faceTargets: [{ kind: 'face', bodyId, faceId }],
        thickness,
        operation: 'newBody',
        booleanScope: { kind: 'standalone' },
      },
    }
  }

  async function createExtrudeBody(
    adapter: OpenCascadeKernelAdapter,
    baseRevisionId: RevisionId,
    sketch: SketchSnapshotRecord,
    distance: number,
  ) {
    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId,
      definition: createExtrudeDefinition(sketch, distance),
    })

    assert(created.revisionState.kind === 'accepted', 'Extrude create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Extrude create must rebuild.')

    const createdBodyTarget = created.changedTargets.find((target) => target.kind === 'body')

    if (!createdBodyTarget || createdBodyTarget.kind !== 'body') {
      throw new Error('Extrude create must report a created body target.')
    }

    return {
      response: created,
      bodyId: createdBodyTarget.bodyId,
    }
  }

  async function createFeatureBody(
    adapter: OpenCascadeKernelAdapter,
    baseRevisionId: RevisionId,
    definition: FeatureDefinition,
    message: string,
  ) {
    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId,
      definition,
    })

    assert(created.revisionState.kind === 'accepted', `${message} must be accepted.`)
    assert(created.rebuildResult.kind === 'rebuilt', `${message} must rebuild.`)

    const bodyTarget = created.changedTargets.find((target) => target.kind === 'body')
    if (!bodyTarget || bodyTarget.kind !== 'body') {
      throw new Error(`${message} must report a body target.`)
    }

    return {
      response: created,
      bodyId: bodyTarget.bodyId,
    }
  }

  async function findPreviewablePlanarFace(
    adapter: OpenCascadeKernelAdapter,
    revisionId: RevisionId,
    bodyId: BodyId,
  ) {
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const body = requireBody(snapshot.snapshot, bodyId)

    for (const faceId of body.topology.faceIds) {
      const preview = await adapter.evaluatePreview({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace',
        baseRevisionId: revisionId,
        previewId: `preview_plane_face_${faceId}`,
        definition: createPlaneDefinitionFromFace(bodyId, faceId),
      })

      if (!hasErrorDiagnostics(preview.diagnostics) && preview.render.records.length > 0) {
        return faceId
      }
    }

    throw new Error(`Expected body ${bodyId} to expose a planar face usable for plane-feature preview.`)
  }

  async function findPreviewableFilletEdge(
    adapter: OpenCascadeKernelAdapter,
    bodyId: BodyId,
  ) {
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const body = requireBody(snapshot.snapshot, bodyId)
    const edgeId = body.topology.edgeIds[0]

    if (!edgeId) {
      throw new Error(`Expected body ${bodyId} to expose at least one edge for fillet coverage.`)
    }

    return edgeId
  }

  async function findPreviewableFilletEdgeForRadius(
    adapter: OpenCascadeKernelAdapter,
    revisionId: RevisionId,
    bodyId: BodyId,
    radius: number,
  ) {
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const body = requireBody(snapshot.snapshot, bodyId)
    const rejectionSummaries: string[] = []

    for (const edgeId of body.topology.edgeIds) {
      const preview = await adapter.evaluatePreview({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace',
        baseRevisionId: revisionId,
        previewId: `preview_fillet_edge_${edgeId}_${String(radius).replace('.', '_')}`,
        definition: createFilletDefinition(bodyId, edgeId, radius),
      })

      if (!hasFeatureExecutionFailureDiagnostics(preview.diagnostics) && preview.render.records.length > 0) {
        return edgeId
      }

      rejectionSummaries.push(
        `${edgeId}: records=${preview.render.records.length}; diagnostics=${
          preview.diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.message}`).join(' | ')
        }`,
      )
    }

    throw new Error(
      `Expected body ${bodyId} to expose a previewable fillet edge. Tried ${body.topology.edgeIds.length} edges:\n${rejectionSummaries.join('\n')}`,
    )
  }

  async function findPreviewableChamferEdge(
    adapter: OpenCascadeKernelAdapter,
    revisionId: RevisionId,
    bodyId: BodyId,
  ) {
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const body = requireBody(snapshot.snapshot, bodyId)
    const rejectionSummaries: string[] = []

    for (const edgeId of body.topology.edgeIds) {
      const preview = await adapter.evaluatePreview({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace',
        baseRevisionId: revisionId,
        previewId: `preview_chamfer_edge_${edgeId}`,
        definition: createChamferDefinition(bodyId, edgeId, 0.05),
      })

      if (!hasFeatureExecutionFailureDiagnostics(preview.diagnostics) && preview.render.records.length > 0) {
        return edgeId
      }

      rejectionSummaries.push(
        `${edgeId}: records=${preview.render.records.length}; diagnostics=${
          preview.diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.message}`).join(' | ')
        }`,
      )
    }

    throw new Error(
      `Expected body ${bodyId} to expose a previewable chamfer edge. Tried ${body.topology.edgeIds.length} edges:\n${rejectionSummaries.join('\n')}`,
    )
  }

  async function findPreviewableRevolveAxisEdge(
    adapter: OpenCascadeKernelAdapter,
    revisionId: RevisionId,
    sketch: SketchSnapshotRecord,
    bodyId: BodyId,
  ) {
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const body = requireBody(snapshot.snapshot, bodyId)

    for (const edgeId of body.topology.edgeIds) {
      const preview = await adapter.evaluatePreview({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace',
        baseRevisionId: revisionId,
        previewId: `preview_revolve_edge_${edgeId}`,
        definition: createRevolveDefinition(sketch, bodyId, edgeId),
      })

      if (!hasErrorDiagnostics(preview.diagnostics) && preview.render.records.length > 0) {
        return edgeId
      }
    }

    throw new Error(`Expected body ${bodyId} to expose an edge-backed revolve axis.`)
  }

  async function findPreviewableSweepPathEdge(
    adapter: OpenCascadeKernelAdapter,
    revisionId: RevisionId,
    sketch: SketchSnapshotRecord,
    bodyId: BodyId,
  ) {
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const body = requireBody(snapshot.snapshot, bodyId)

    for (const edgeId of body.topology.edgeIds) {
      const preview = await adapter.evaluatePreview({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace',
        baseRevisionId: revisionId,
        previewId: `preview_sweep_edge_${edgeId}`,
        definition: createSweepDefinition(sketch, bodyId, edgeId),
      })

      if (!hasErrorDiagnostics(preview.diagnostics) && preview.render.records.length > 0) {
        return edgeId
      }
    }

    throw new Error(`Expected body ${bodyId} to expose a previewable sweep path edge.`)
  }

  async function createExportableBodyFixture() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    assert(committed.revisionState.kind === 'accepted', 'Seed sketch commit must succeed before export coverage.')

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const extrude = await createExtrudeBody(adapter, committedSnapshot.snapshot.revisionId, sketch, 10)

    return {
      adapter,
      bodyId: extrude.bodyId,
      revisionId: extrude.response.revisionId,
      targetLabel: 'Export Body',
    }
  }

  async function createStepImportDocumentFromPayload(
    sourceDocument: AuthoredModelDocument,
    input: {
      featureId: FeatureId
      label: string
      fileName: string
      payload: string
      selectedSolidKeys?: readonly string[]
    },
  ) {
    const sourceBytes = new TextEncoder().encode(input.payload)
    const oc = await getDefaultOpenCascadeInstance()
    let baked = bakeStepImportGeometryWithOpenCascade(oc, {
      files: [{ fileName: input.fileName, bytes: sourceBytes }],
      selectedSolidKeys: input.selectedSolidKeys,
    })
    if (!baked.ok && input.selectedSolidKeys) {
      baked = bakeStepImportGeometryWithOpenCascade(oc, {
        files: [{ fileName: input.fileName, bytes: sourceBytes }],
      })
    }
    assert(baked.ok, 'Test STEP payload should bake into Cadara B-rep geometry.')
    assert(
      baked.data.bodies.every((body) => body.topology.faces.length > 0 && body.topology.edges.length > 0 && body.topology.vertices.length > 0),
      'Test STEP payload should bake into explicit Cadara B-rep topology records.',
    )
    assert(
      !JSON.stringify(baked.data).toLowerCase().includes('opencascade'),
      'Persisted Cadara B-rep test data must not contain OpenCascade-specific geometry fields.',
    )
    const bytes = encodeGeometryAssetData(baked.data)
    const hash = await hashGeometryAssetBytes(bytes)
    const sourceHash = await hashGeometryAssetBytes(sourceBytes)
    const asset: GeometryAssetRecord = {
      schemaVersion: GEOMETRY_ASSET_SCHEMA_VERSION,
      assetId: `asset_step_import_${hash.replace(/^sha256:/, '').slice(0, 16)}`,
      hash,
      byteLength: bytes.byteLength,
      format: 'cadara-brep',
      mediaType: 'application/vnd.cadara.brep+json',
      provenance: {
        kind: 'imported',
        sourceName: input.fileName,
        selectedFileName: input.fileName,
        stepDocumentName: input.fileName,
        sourceHash,
        sourceFormat: 'step',
        sourceStored: false,
      },
      data: baked.data,
      ownerFeatureIds: [input.featureId],
    }
    const document: AuthoredModelDocument = {
      ...sourceDocument,
      revisionId: 'rev_0100',
      features: [
        ...sourceDocument.features,
        {
          featureId: input.featureId,
          label: input.label,
          definition: {
            kind: 'stepImport',
            featureTypeVersion: STEP_IMPORT_FEATURE_SCHEMA_VERSION,
            parameters: {
              assetId: asset.assetId,
              unit: {
                source: 'file',
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
              label: input.label,
              ...(input.selectedSolidKeys
                ? {
                    sourceFiles: [
                      {
                        role: 'root' as const,
                        assetId: asset.assetId,
                        selectedFileName: input.fileName,
                        documentName: input.fileName,
                      },
                    ],
                    selectedSolids: input.selectedSolidKeys.map((solidKey) => ({
                      solidKey,
                      label: `${input.label} selection`,
                      sourceAssetId: asset.assetId,
                    })),
                  }
                : {}),
            },
          },
        },
      ],
      featureOrder: [...sourceDocument.featureOrder, input.featureId],
      historyOrder: [
        ...(sourceDocument.historyOrder ?? []),
        { kind: 'feature', featureId: input.featureId },
      ],
      cursor: { kind: 'feature', featureId: input.featureId },
      assets: normalizeGeometryAssetManifest({
        schemaVersion: GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
        records: [...sourceDocument.assets.records, asset],
      }),
    }

    return { document, asset, bytes }
  }

  function createCubeMeshTriangles(): MeshTriangle[] {
    return [
      [[0, 0, 0], [0, 1, 0], [1, 1, 0]],
      [[0, 0, 0], [1, 1, 0], [1, 0, 0]],
      [[0, 0, 1], [1, 1, 1], [0, 1, 1]],
      [[0, 0, 1], [1, 0, 1], [1, 1, 1]],
      [[0, 0, 0], [1, 0, 0], [1, 0, 1]],
      [[0, 0, 0], [1, 0, 1], [0, 0, 1]],
      [[1, 0, 0], [1, 1, 0], [1, 1, 1]],
      [[1, 0, 0], [1, 1, 1], [1, 0, 1]],
      [[1, 1, 0], [0, 1, 0], [0, 1, 1]],
      [[1, 1, 0], [0, 1, 1], [1, 1, 1]],
      [[0, 1, 0], [0, 0, 0], [0, 0, 1]],
      [[0, 1, 0], [0, 0, 1], [0, 1, 1]],
    ]
  }

  function createCylinderMeshTriangles(segments = 16, radius = 1, height = 2): MeshTriangle[] {
    const bottomCenter: MeshPoint = [0, 0, 0]
    const topCenter: MeshPoint = [0, 0, height]
    const bottom = Array.from({ length: segments }, (_, index) => {
      const angle = (index / segments) * Math.PI * 2
      return [Math.cos(angle) * radius, Math.sin(angle) * radius, 0] as MeshPoint
    })
    const top = bottom.map((point) => [point[0], point[1], height] as MeshPoint)
    const triangles: MeshTriangle[] = []

    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments
      triangles.push(
        [bottom[index]!, bottom[next]!, top[next]!],
        [bottom[index]!, top[next]!, top[index]!],
        [bottomCenter, bottom[index]!, bottom[next]!],
        [topCenter, top[next]!, top[index]!],
      )
    }

    return triangles
  }

  async function createMeshImportDocumentFromTriangles(
    sourceDocument: AuthoredModelDocument,
    input: {
      featureId: FeatureId
      label: string
      fileName: string
      triangles: MeshTriangle[]
    },
  ) {
    const sourceHash = await hashGeometryAssetBytes(new TextEncoder().encode(input.fileName))
    const baked = await createBakedMeshGeometryAsset({
      triangles: input.triangles,
      sourceFileName: input.fileName,
      sourceFormat: 'stl',
      sourceHash,
      ownerFeatureId: input.featureId,
      acceptFacetedFallback: true,
    })
    assert(baked.ok, baked.ok ? 'Baked mesh fixture should succeed.' : baked.reason)
    const asset = baked.assetInput.asset
    const document: AuthoredModelDocument = {
      ...sourceDocument,
      revisionId: 'rev_0100',
      features: [
        ...sourceDocument.features,
        {
          featureId: input.featureId,
          label: input.label,
          definition: {
            kind: 'meshImport',
            featureTypeVersion: MESH_IMPORT_FEATURE_SCHEMA_VERSION,
            parameters: {
              assetId: asset.assetId,
              source: {
                originalFileName: input.fileName,
                sourceFormat: 'stl',
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
              reconstruction: baked.reconstruction,
              label: input.label,
            },
          },
        },
      ],
      featureOrder: [...sourceDocument.featureOrder, input.featureId],
      historyOrder: [
        ...(sourceDocument.historyOrder ?? []),
        { kind: 'feature', featureId: input.featureId },
      ],
      cursor: { kind: 'feature', featureId: input.featureId },
      assets: normalizeGeometryAssetManifest({
        schemaVersion: GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
        records: [...sourceDocument.assets.records, asset],
      }),
    }

    return { document, asset, bytes: baked.assetInput.bytes }
  }

  function createStepAssetResolver(asset: GeometryAssetRecord, bytes: Uint8Array) {
    return {
      async getGeometryAssetBytes(hash: GeometryAssetHash) {
        return hash === asset.hash ? bytes.slice() : null
      },
    }
  }

  async function readStepPayloadVolume(payload: string) {
    const oc = await getDefaultOpenCascadeInstance()
    const inputPath = `/cadara-test-step-volume-${Date.now()}-${Math.random().toString(36).slice(2)}.step`
    const reader = new oc.STEPControl_Reader_1()

    try {
      oc.FS.writeFile(inputPath, payload)
      assert(reader.ReadFile(inputPath) === oc.IFSelect_ReturnStatus.IFSelect_RetDone, 'STEP volume reader should read payload.')
      assert(reader.TransferRoots(new oc.Message_ProgressRange_1()) > 0, 'STEP volume reader should transfer at least one root.')

      const solids = extractSolidShapes(oc, reader.OneShape())
      assert(solids.length > 0, 'STEP volume reader should find at least one solid.')

      let total = 0
      for (const solid of solids) {
        const props = new oc.GProp_GProps_1()
        oc.BRepGProp.VolumeProperties_1(solid, props, false, false, false)
        total += props.Mass()
      }

      return total
    } finally {
      if (oc.FS.analyzePath(inputPath).exists) {
        oc.FS.unlink(inputPath)
      }
      reader.delete()
    }
  }

  async function writeStepShape(
    createShape: (oc: Awaited<ReturnType<typeof getDefaultOpenCascadeInstance>>) => InstanceType<Awaited<ReturnType<typeof getDefaultOpenCascadeInstance>>['TopoDS_Shape']>,
  ) {
    const oc = await getDefaultOpenCascadeInstance()
    oc.STEPControl_Controller.Init()
    oc.Interface_Static.SetCVal('write.step.schema', 'AP242DIS')
    oc.Interface_Static.SetCVal('write.step.unit', 'MM')
    const outputPath = `/cadara-test-step-import-${Date.now()}-${Math.random().toString(36).slice(2)}.step`
    const writer = new oc.STEPControl_Writer_1()
    const progress = new oc.Message_ProgressRange_1()
    const transferMode = oc.STEPControl_StepModelType.STEPControl_AsIs as unknown as Awaited<ReturnType<typeof getDefaultOpenCascadeInstance>>['STEPControl_StepModelType']

    try {
      const status = writer.Transfer(createShape(oc), transferMode, true, progress)

      assert(status === oc.IFSelect_ReturnStatus.IFSelect_RetDone, 'Test STEP writer should transfer shape.')
      assert(writer.Write(outputPath) === oc.IFSelect_ReturnStatus.IFSelect_RetDone, 'Test STEP writer should write shape.')
      return oc.FS.readFile(outputPath, { encoding: 'utf8' }) as string
    } finally {
      if (oc.FS.analyzePath(outputPath).exists) {
        oc.FS.unlink(outputPath)
      }
      writer.delete()
    }
  }

  function createEdgeOnlyStepPayload() {
    return writeStepShape((oc) => {
      const edge = new oc.BRepBuilderAPI_MakeEdge_3(
        toGpPnt(oc, [0, 0, 0]),
        toGpPnt(oc, [10, 0, 0]),
      )
      return edge.Edge()
    })
  }

  function createMixedSolidAndEdgeStepPayload() {
    return writeStepShape((oc) => {
      const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10)
      box.Build(new oc.Message_ProgressRange_1())
      assert(box.IsDone(), 'Test box should build for mixed STEP import payload.')
      const edge = new oc.BRepBuilderAPI_MakeEdge_3(
        toGpPnt(oc, [20, 0, 0]),
        toGpPnt(oc, [30, 0, 0]),
      )
      const builder = new oc.BRep_Builder()
      const compound = new oc.TopoDS_Compound()
      builder.MakeCompound(compound)
      builder.Add(compound, box.Shape())
      builder.Add(compound, edge.Edge())
      return compound
    })
  }

  function createTwoSolidStepPayload() {
    return writeStepShape((oc) => {
      const firstBox = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [0, 0, 0]), 10, 10, 10)
      const secondBox = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [20, 0, 0]), 8, 8, 8)
      firstBox.Build(new oc.Message_ProgressRange_1())
      secondBox.Build(new oc.Message_ProgressRange_1())
      assert(firstBox.IsDone() && secondBox.IsDone(), 'Test boxes should build for multi-solid STEP import payload.')
      const builder = new oc.BRep_Builder()
      const compound = new oc.TopoDS_Compound()
      builder.MakeCompound(compound)
      builder.Add(compound, firstBox.Shape())
      builder.Add(compound, secondBox.Shape())
      return compound
    })
  }

  function createCylinderStepPayload() {
    return writeStepShape((oc) => {
      const cylinder = new oc.BRepPrimAPI_MakeCylinder_1(6, 18)
      cylinder.Build(new oc.Message_ProgressRange_1())
      assert(cylinder.IsDone(), 'Test cylinder should build for curved mesh volume round-trip coverage.')
      return cylinder.Shape()
    })
  }

  function assertExportPayloadMetadata(
    result: Awaited<ReturnType<OpenCascadeKernelAdapter['exportDocument']>>,
    format: 'stl' | 'step' | '3mf',
  ): asserts result is Extract<typeof result, { ok: true }> {
    assert(result.ok, `${format} export should succeed for a live body target.`)
    assert(result.format === format, `${format} export should return the requested format.`)
    assert(result.filename === `export-body.${format}`, `${format} export should use the selected row label for the filename.`)
    assert(result.extension === format, `${format} export should report the expected file extension.`)
    assert(result.mimeType === `model/${format}`, `${format} export should report the expected MIME type.`)
  }

  async function testOccGeometryExportsProduceRealPayloads() {
    const fixture = await createExportableBodyFixture()

    const stl = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: fixture.revisionId,
      target: { kind: 'body', bodyId: fixture.bodyId },
      targetLabel: fixture.targetLabel,
      format: 'stl',
      options: getDefaultDocumentExportOptions('stl'),
    })

    assertExportPayloadMetadata(stl, 'stl')
    assert(stl.payload instanceof Uint8Array, 'Default STL export should return binary bytes.')
    assert(stl.payload.length > 84, 'STL export should contain a binary header and triangle records.')
    assert(new DataView(stl.payload.buffer, stl.payload.byteOffset, stl.payload.byteLength).getUint32(80, true) > 0, 'STL export should contain triangle records.')

    const step = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: fixture.revisionId,
      target: { kind: 'body', bodyId: fixture.bodyId },
      targetLabel: fixture.targetLabel,
      format: 'step',
      options: getDefaultDocumentExportOptions('step'),
    })

    assertExportPayloadMetadata(step, 'step')
    assert(typeof step.payload === 'string', 'STEP export should return text payload.')
    assert(step.payload.startsWith('ISO-10303-21;'), 'STEP export should contain a STEP file signature.')
    assert(step.payload.includes('MANIFOLD_SOLID_BREP') || step.payload.includes('ADVANCED_BREP_SHAPE_REPRESENTATION'), 'STEP export should contain B-Rep geometry entities.')

    const threeMf = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: fixture.revisionId,
      target: { kind: 'body', bodyId: fixture.bodyId },
      targetLabel: fixture.targetLabel,
      format: '3mf',
      options: getDefaultDocumentExportOptions('3mf'),
    })

    assertExportPayloadMetadata(threeMf, '3mf')
    assert(threeMf.payload instanceof Uint8Array, '3MF export should return package bytes.')
    assert(threeMf.payload[0] === 0x50 && threeMf.payload[1] === 0x4b, '3MF export should be a ZIP package.')

    const packageParts = unzipSync(threeMf.payload)
    const modelPart = packageParts['3D/3dmodel.model']

    assert(packageParts['[Content_Types].xml'] !== undefined, '3MF package should include content types.')
    assert(packageParts['_rels/.rels'] !== undefined, '3MF package should include root relationships.')
    assert(modelPart !== undefined, '3MF package should include the model part.')

    const modelXml = strFromU8(modelPart)
    const vertexCount = modelXml.match(/<vertex /g)?.length ?? 0
    const triangleCount = modelXml.match(/<triangle /g)?.length ?? 0

    assert(modelXml.includes('<model unit="millimeter"'), '3MF model should declare millimeter units.')
    assert(modelXml.includes('<triangle '), '3MF model should contain tessellated triangles.')
    assert(vertexCount > 0 && triangleCount > 0, '3MF model should contain indexed mesh data.')
    assert(vertexCount < triangleCount * 3, '3MF model should reuse coincident vertices instead of emitting disconnected triangles.')
  }

  async function testStepImportRestoresExactBodiesFromAssetBytes() {
    const fixture = await createExportableBodyFixture()
    const step = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: fixture.revisionId,
      target: { kind: 'body', bodyId: fixture.bodyId },
      targetLabel: fixture.targetLabel,
      format: 'step',
      options: getDefaultDocumentExportOptions('step'),
    })
    assert(step.ok && typeof step.payload === 'string', 'Fixture STEP export should produce importable text.')

    const sourceDocument = await fixture.adapter.exportAuthoredModelDocument('doc_workspace')
    const featureId = 'feature_stepImport-1' as FeatureId
    const imported = await createStepImportDocumentFromPayload(sourceDocument, {
      featureId,
      label: 'Imported exact body',
      fileName: 'imported.step',
      payload: step.payload,
    })
    const adapter = createAdapter()

    await adapter.restoreAuthoredModelDocument(imported.document, [], createStepAssetResolver(imported.asset, imported.bytes))
    const provisionalSnapshot = (await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    const provisionalImportedBody = provisionalSnapshot.bodies.find((body) => body.ownerFeatureId === featureId)

    assert(provisionalImportedBody, 'STEP import should rebuild into a tracked body.')
    assert(provisionalImportedBody.label === 'Imported exact body', 'Imported STEP body should use the authored import label.')
    assert(provisionalImportedBody.topology.faceIds.length > 0, 'STEP import should expose provisional faceted face refs immediately.')
    assert(provisionalImportedBody.topology.edgeIds.length === 0, 'Provisional STEP presentation should defer edge refs until OCC materialization completes.')
    assert(provisionalImportedBody.topology.vertexIds.length === 0, 'Provisional STEP presentation should defer vertex refs until OCC materialization completes.')

    await waitFor(
      () => adapter.getStepImportMaterializationStatus() === null,
      'STEP import should eventually finish background OCC materialization.',
    )

    const snapshot = (await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    const importedBody = snapshot.bodies.find((body) => body.ownerFeatureId === featureId)

    assert(importedBody, 'STEP import should remain present after background OCC materialization completes.')
    assert(importedBody.topology.faceIds.length > 0, 'Imported STEP body should expose selectable face refs.')
    assert(importedBody.topology.edgeIds.length > 0, 'Imported STEP body should expose selectable edge refs.')
    assert(importedBody.topology.vertexIds.length > 0, 'Imported STEP body should expose selectable vertex refs.')

    const importedRenderRecords = snapshot.render.records.filter((record) =>
      record.ownerBodyId === importedBody.bodyId,
    )
    const importedFaceRenderRecords = importedRenderRecords.filter((record) =>
      record.binding.target.kind === 'face'
      && record.binding.target.bodyId === importedBody.bodyId
      && (record.binding.semanticClass === 'bodyFace' || record.binding.semanticClass === 'planarFace')
      && record.geometry.kind === 'mesh',
    )
    const importedEdgeRenderRecords = importedRenderRecords.filter((record) =>
      record.binding.target.kind === 'edge'
      && record.binding.target.bodyId === importedBody.bodyId
      && record.binding.semanticClass === 'featureEdge'
      && record.geometry.kind === 'polyline',
    )
    const importedVertexRenderRecords = importedRenderRecords.filter((record) =>
      record.binding.target.kind === 'vertex'
      && record.binding.target.bodyId === importedBody.bodyId
      && record.binding.semanticClass === 'featureVertex'
      && record.geometry.kind === 'marker',
    )

    assert(
      importedFaceRenderRecords.length === importedBody.topology.faceIds.length,
      'Imported STEP body should render every native face as a selectable mesh record.',
    )
    assert(
      importedEdgeRenderRecords.length === importedBody.topology.edgeIds.length,
      'Imported STEP body should render every native edge as a selectable polyline record.',
    )
    assert(
      importedVertexRenderRecords.length === importedBody.topology.vertexIds.length,
      'Imported STEP body should render every native vertex as a selectable marker record.',
    )

    const resolved = await adapter.resolveReference({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      target: {
        kind: 'face',
        bodyId: importedBody.bodyId,
        faceId: importedBody.topology.faceIds[0]!,
      },
    })
    assert(
      resolved.resolution.invalidation === null && resolved.resolution.ownerFeatureId === featureId,
      'Downstream feature refs should resolve imported STEP body topology.',
    )
  }

  async function testStepFileImportServiceRefreshExposesNativeRenderRecords() {
    const fixture = await createExportableBodyFixture()
    const step = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: fixture.revisionId,
      target: { kind: 'body', bodyId: fixture.bodyId },
      targetLabel: fixture.targetLabel,
      format: 'step',
      options: getDefaultDocumentExportOptions('step'),
    })
    assert(step.ok && typeof step.payload === 'string', 'Fixture STEP export should produce importable text.')

    const importAdapter = createAdapter()
    const importService = createModelingService(importAdapter, {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: null,
      documentRepository: null,
    })
    const imported = await importService.importStepFile({
      fileName: 'service-import.step',
      bytes: new TextEncoder().encode(step.payload),
    })
    assert(imported.ok, 'STEP file import service should accept an OCC-rebuildable exact solid.')

    const provisionalSnapshot = await importService.getCurrentDocumentSnapshot()
    const provisionalImportedBody = provisionalSnapshot.bodies.find((body) => body.ownerFeatureId?.startsWith('feature_stepImport-'))
    assert(provisionalImportedBody, 'STEP file import service refresh should expose the imported body.')

    const provisionalBodyRenderRecords = provisionalSnapshot.render.records.filter((record) =>
      record.ownerBodyId === provisionalImportedBody.bodyId,
    )
    assert(
      provisionalBodyRenderRecords.some((record) =>
        record.binding.target.kind === 'face'
        && record.binding.target.bodyId === provisionalImportedBody.bodyId
        && record.geometry.kind === 'mesh',
      ),
      'STEP file import service refresh should expose provisional face mesh render records immediately.',
    )
    assert(
      provisionalBodyRenderRecords.every((record) =>
        record.binding.target.kind !== 'edge' || record.binding.target.bodyId !== provisionalImportedBody.bodyId,
      ),
      'STEP file import service refresh should defer native edge polyline render records until background materialization completes.',
    )
    assert(
      provisionalBodyRenderRecords.every((record) =>
        record.binding.target.kind !== 'vertex' || record.binding.target.bodyId !== provisionalImportedBody.bodyId,
      ),
      'STEP file import service refresh should defer native vertex marker render records until background materialization completes.',
    )

    await waitFor(
      () => importService.getStepImportMaterializationStatus() === null,
      'STEP file import service should eventually finish background OCC materialization.',
    )

    const snapshot = await importService.getCurrentDocumentSnapshot()
    const importedBody = snapshot.bodies.find((body) => body.ownerFeatureId?.startsWith('feature_stepImport-'))
    assert(importedBody, 'STEP file import service refresh should keep the imported body after background materialization completes.')

    const bodyRenderRecords = snapshot.render.records.filter((record) => record.ownerBodyId === importedBody.bodyId)
    assert(
      bodyRenderRecords.some((record) =>
        record.binding.target.kind === 'edge'
        && record.binding.target.bodyId === importedBody.bodyId
        && record.geometry.kind === 'polyline',
      ),
      'STEP file import service refresh should expose native edge polyline render records after background materialization completes.',
    )
    assert(
      bodyRenderRecords.some((record) =>
        record.binding.target.kind === 'vertex'
        && record.binding.target.bodyId === importedBody.bodyId
        && record.geometry.kind === 'marker',
      ),
      'STEP file import service refresh should expose native vertex marker render records after background materialization completes.',
    )
  }

  async function testPreparedStepImportShowsFacetedPresentationWhileBackgroundMaterializationIsPending() {
    const fixture = await createExportableBodyFixture()
    const step = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: fixture.revisionId,
      target: { kind: 'body', bodyId: fixture.bodyId },
      targetLabel: fixture.targetLabel,
      format: 'step',
      options: getDefaultDocumentExportOptions('step'),
    })
    assert(step.ok && typeof step.payload === 'string', 'Fixture STEP export should produce importable text.')

    let releaseDeferredMaterialization = () => {}
    const deferredMaterializationGate = new Promise<void>((resolve) => {
      releaseDeferredMaterialization = resolve
    })
    const importAdapter = createAdapter(
      () => new DeterministicSketchSolverAdapter(),
      {
        beforeDeferredStepImportMaterialization: () => deferredMaterializationGate,
      },
    )
    const importService = createModelingService(importAdapter, {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: null,
      documentRepository: null,
    })
    const files = [{ fileName: 'prepared-import.step', bytes: new TextEncoder().encode(step.payload) }]
    const review = await importService.prepareStepImportReview({ files })
    const imported = await importService.commitPreparedStepImport({
      files,
      review,
      selectedSolidKeys: [review.solids[0]!.solidKey],
    })
    assert(imported.ok, 'Prepared STEP import should commit while background materialization remains pending.')

    const pendingStatus = importService.getStepImportMaterializationStatus()
    assert(
      pendingStatus?.features[0]?.state === 'pending',
      'Prepared STEP import should report pending background materialization immediately after commit.',
    )

    const snapshot = await importService.getCurrentDocumentSnapshot()
    const importedBody = snapshot.bodies.find((body) => body.ownerFeatureId?.startsWith('feature_stepImport-'))
    assert(importedBody, 'Prepared STEP import should expose a provisional imported body before background materialization finishes.')
    assert(
      importedBody.topology.faceIds.length > 0 && importedBody.topology.edgeIds.length === 0 && importedBody.topology.vertexIds.length === 0,
      'Provisional STEP presentation should use persisted faceted faces without waiting for full OCC edge and vertex materialization.',
    )
    assert(
      snapshot.render.records.some((record) =>
        record.ownerBodyId === importedBody.bodyId
        && record.binding.target.kind === 'face'
        && record.geometry.kind === 'mesh',
      ),
      'Prepared STEP import should render faceted face meshes while background materialization is pending.',
    )

    releaseDeferredMaterialization()
    await waitFor(
      () => importService.getStepImportMaterializationStatus() === null,
      'Background STEP materialization should eventually clear its pending status.',
    )
  }

  async function testPreparedStepImportReportsTimeoutWhileKeepingFacetedPresentationVisible() {
    const fixture = await createExportableBodyFixture()
    const step = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: fixture.revisionId,
      target: { kind: 'body', bodyId: fixture.bodyId },
      targetLabel: fixture.targetLabel,
      format: 'step',
      options: getDefaultDocumentExportOptions('step'),
    })
    assert(step.ok && typeof step.payload === 'string', 'Fixture STEP export should produce importable text.')

    const importAdapter = createAdapter(
      () => new DeterministicSketchSolverAdapter(),
      {
        stepImportMaterializationTimeoutMs: 5,
        beforeDeferredStepImportMaterialization: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
        },
      },
    )
    const importService = createModelingService(importAdapter, {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: null,
      documentRepository: null,
    })
    const files = [{ fileName: 'timed-import.step', bytes: new TextEncoder().encode(step.payload) }]
    const review = await importService.prepareStepImportReview({ files })
    const imported = await importService.commitPreparedStepImport({
      files,
      review,
      selectedSolidKeys: [review.solids[0]!.solidKey],
    })
    assert(imported.ok, 'Prepared STEP import should commit before timeout monitoring degrades background materialization.')

    await waitFor(
      () => importService.getStepImportMaterializationStatus()?.features.some((feature) => feature.state === 'degraded') === true,
      'Prepared STEP import should report a degraded background materialization state after the timeout budget elapses.',
    )

    const degradedStatus = importService.getStepImportMaterializationStatus()
    assert(
      degradedStatus?.features[0]?.message.includes('Visible faceted presentation remains available.'),
      'Timeout status should explain that faceted STEP presentation remains available after degradation.',
    )

    const snapshot = await importService.getCurrentDocumentSnapshot()
    const importedBody = snapshot.bodies.find((body) => body.ownerFeatureId?.startsWith('feature_stepImport-'))
    assert(importedBody, 'Timed STEP materialization should keep the provisional imported body visible.')
    assert(
      snapshot.document.diagnostics.some((diagnostic) =>
        diagnostic.code === 'step-import-materialization-timeout'
        && diagnostic.featureId === importedBody.ownerFeatureId,
      ),
      'Timed STEP materialization should surface a structured timeout diagnostic on the snapshot while faceted presentation remains visible.',
    )
  }

  async function testMeshImportRestoresBakedBodiesFromGeneratedAssetBytes() {
    const sourceDocument = await createAdapter().exportAuthoredModelDocument('doc_workspace')
    const featureId = 'feature_meshImport-1' as FeatureId
    const imported = await createMeshImportDocumentFromTriangles(sourceDocument, {
      featureId,
      label: 'Imported baked cube',
      fileName: 'cube.stl',
      triangles: createCubeMeshTriangles(),
    })
    const adapter = createAdapter()

    await adapter.restoreAuthoredModelDocument(imported.document, [], createStepAssetResolver(imported.asset, imported.bytes))
    const snapshot = (await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    const importedBody = snapshot.bodies.find((body) => body.ownerFeatureId === featureId)

    assert(importedBody, 'Mesh import should rebuild into a tracked baked body.')
    assert(importedBody.label === 'Imported baked cube', 'Baked mesh body should use the authored import label.')
    assert(importedBody.topology.faceIds.length === 6, `Baked cube mesh should unify to six selectable faces, got ${importedBody.topology.faceIds.length}.`)
    assert(importedBody.topology.edgeIds.length > 0, 'Baked mesh body should expose durable edge topology.')
    assert(importedBody.topology.vertexIds.length > 0, 'Baked mesh body should expose durable vertex topology.')
    const restoredDocument = await adapter.exportAuthoredModelDocument('doc_workspace')
    const restoredFeature = restoredDocument.features.find((feature) => feature.featureId === featureId)
    const diagnostics = restoredFeature?.definition.kind === 'meshImport'
      ? restoredFeature.definition.parameters.reconstruction?.unificationDiagnostics
      : undefined
    const assetDiagnostics = restoredDocument.assets.records.find((record) => record.assetId === imported.asset.assetId)
      ?.provenance.reconstruction?.unificationDiagnostics

    assert(diagnostics?.preFaceCount === 12, `Baked cube provenance should record 12 pre-unification faces, got ${diagnostics?.preFaceCount}.`)
    assert(diagnostics.postFaceCount === 6, `Baked cube provenance should record 6 post-unification faces, got ${diagnostics.postFaceCount}.`)
    assert(diagnostics.mergedSurfaceTypes.plane === 6, `Baked cube should record six planar faces, got ${diagnostics.mergedSurfaceTypes.plane}.`)
    assert(assetDiagnostics?.postFaceCount === 6, 'Baked mesh asset provenance should record post-unification face count.')
    assert(
      snapshot.document.diagnostics.every((diagnostic) => diagnostic.code !== 'mesh-import-missing-baked-asset'),
      'Baked mesh restore should not require original STL source bytes.',
    )
  }

  async function testCylinderMeshImportRecordsUnifiedSurfaceDiagnostics() {
    const sourceDocument = await createAdapter().exportAuthoredModelDocument('doc_workspace')
    const featureId = 'feature_meshImport-cylinder' as FeatureId
    const imported = await createMeshImportDocumentFromTriangles(sourceDocument, {
      featureId,
      label: 'Imported baked cylinder',
      fileName: 'cylinder.stl',
      triangles: createCylinderMeshTriangles(),
    })
    const adapter = createAdapter()

    await adapter.restoreAuthoredModelDocument(imported.document, [], createStepAssetResolver(imported.asset, imported.bytes))
    const restoredDocument = await adapter.exportAuthoredModelDocument('doc_workspace')
    const restoredFeature = restoredDocument.features.find((feature) => feature.featureId === featureId)
    const diagnostics = restoredFeature?.definition.kind === 'meshImport'
      ? restoredFeature.definition.parameters.reconstruction?.unificationDiagnostics
      : undefined

    assert(diagnostics, 'Cylinder mesh import should record unification diagnostics.')
    assert(diagnostics.postFaceCount < diagnostics.preFaceCount, 'Cylinder mesh unification should reduce the imported face count.')
    assert(diagnostics.mergedSurfaceTypes.plane >= 2, `Cylinder mesh diagnostics should include planar cap faces, got ${diagnostics.mergedSurfaceTypes.plane}.`)
    assert(diagnostics.mergedSurfaceTypes.cylinder >= 1, `Cylinder mesh diagnostics should include a cylindrical face, got ${diagnostics.mergedSurfaceTypes.cylinder}.`)
  }

  async function testFacetedMeshImportUsesBakedAssetRenderMesh() {
    const sourceDocument = await createAdapter().exportAuthoredModelDocument('doc_workspace')
    const featureId = 'feature_meshImport-faceted' as FeatureId
    const imported = await createMeshImportDocumentFromTriangles(sourceDocument, {
      featureId,
      label: 'Imported faceted tetrahedron',
      fileName: 'tetra.stl',
      triangles: [
        [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        [[0, 0, 0], [0, 0, 1], [1, 0, 0]],
        [[0, 0, 0], [0, 1, 0], [0, 0, 1]],
        [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
      ],
    })
    const adapter = createAdapter()

    await adapter.restoreAuthoredModelDocument(imported.document, [], createStepAssetResolver(imported.asset, imported.bytes))
    const snapshot = (await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    const meshRecords = snapshot.render.records.filter((record) =>
      record.ownerFeatureId === featureId && record.geometry.kind === 'mesh',
    )
    const importedBody = snapshot.bodies.find((body) => body.ownerFeatureId === featureId)

    assert(importedBody?.topology.faceIds.length === 4, 'Faceted fallback mesh imports should still produce durable face IDs.')
    const resolved = importedBody
      ? await adapter.resolveReference({
          contractVersion: CONTRACT_VERSION,
          documentId: 'doc_workspace',
          target: {
            kind: 'face',
            bodyId: importedBody.bodyId,
            faceId: importedBody.topology.faceIds[0]!,
          },
        })
      : null
    assert(resolved?.resolution.invalidation === null, 'Faceted fallback face IDs should resolve as durable topology refs.')
    assert(meshRecords.length === 1, 'Faceted mesh imports should render from one baked asset mesh record.')
    assert(
      meshRecords[0]?.geometry.kind === 'mesh' && meshRecords[0].geometry.triangleIndices.length === 4,
      'Faceted mesh import render geometry should preserve baked mesh triangles.',
    )
  }

  async function testStlAndThreeMfExportImportPreservesVolume() {
    const fixture = await createExportableBodyFixture()
    const originalStep = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: fixture.revisionId,
      target: { kind: 'body', bodyId: fixture.bodyId },
      targetLabel: fixture.targetLabel,
      format: 'step',
      options: getDefaultDocumentExportOptions('step'),
    })
    assert(originalStep.ok && typeof originalStep.payload === 'string', 'Fixture STEP export should produce a volume baseline.')
    const beforeVolume = await readStepPayloadVolume(originalStep.payload)

    async function assertMeshRoundTripVolume(format: 'stl' | '3mf') {
      const exported = await fixture.adapter.exportDocument({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace',
        baseRevisionId: fixture.revisionId,
        target: { kind: 'body', bodyId: fixture.bodyId },
        targetLabel: fixture.targetLabel,
        format,
        options: getDefaultDocumentExportOptions(format),
      })
      assert(exported.ok && exported.payload instanceof Uint8Array, `${format} export should produce mesh bytes.`)

      const importAdapter = createAdapter()
      const importService = createModelingService(importAdapter, {
        currentDocumentId: 'doc_workspace',
        operationHistoryStore: null,
        documentRepository: null,
      })
      const imported = await importService.importMeshFile({
        fileName: `round-trip.${format}`,
        bytes: exported.payload,
        acceptFacetedFallback: true,
      })
      assert(imported.ok, `${format} mesh import should bake a generated geometry asset.`)

      const importedSnapshot = await importService.getCurrentDocumentSnapshot()
      const importedBody = importedSnapshot.bodies.find((body) => body.ownerFeatureId?.startsWith('feature_meshImport-'))
      assert(importedBody, `${format} mesh import should restore a baked body.`)

      const importedStep = await importAdapter.exportDocument({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace',
        baseRevisionId: importedSnapshot.revisionId,
        target: { kind: 'body', bodyId: importedBody.bodyId },
        targetLabel: `Imported ${format.toUpperCase()} Body`,
        format: 'step',
        options: getDefaultDocumentExportOptions('step'),
      })
      assert(importedStep.ok && typeof importedStep.payload === 'string', `Imported ${format} baked body should export as STEP.`)

      const afterVolume = await readStepPayloadVolume(importedStep.payload)
      const relativeDelta = Math.abs(beforeVolume - afterVolume) / Math.max(beforeVolume, 1)
      assert(beforeVolume > 0, `${format} round-trip source volume should be positive.`)
      assert(
        relativeDelta < 1e-6,
        `${format} export/import should preserve volume. Before=${beforeVolume}; after=${afterVolume}; relative delta=${relativeDelta}.`,
      )
    }

    await assertMeshRoundTripVolume('stl')
    await assertMeshRoundTripVolume('3mf')
  }

  async function testStlAndThreeMfCurvedExportImportTracksTessellatedVolume() {
    const sourceAdapter = createAdapter()
    const sourceDocument = await sourceAdapter.exportAuthoredModelDocument('doc_workspace' as DocumentId)
    const featureId = 'feature_stepImport-curved' as FeatureId
    const cylinderPayload = await createCylinderStepPayload()
    const imported = await createStepImportDocumentFromPayload(sourceDocument, {
      featureId,
      label: 'Imported exact cylinder',
      fileName: 'curved-cylinder.step',
      payload: cylinderPayload,
    })
    const exactAdapter = createAdapter()

    await exactAdapter.restoreAuthoredModelDocument(imported.document, [], createStepAssetResolver(imported.asset, imported.bytes))
    await waitFor(
      () => exactAdapter.getStepImportMaterializationStatus() === null,
      'Curved STEP import should finish background OCC materialization before curved mesh export.',
    )
    const exactSnapshotResponse = await exactAdapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const exactSnapshot = exactSnapshotResponse.snapshot
    const exactBody = exactSnapshot.bodies.find((body) => body.ownerFeatureId === featureId)
    assert(exactBody, 'Curved STEP import should restore an exact source body.')

    const beforeVolume = await readStepPayloadVolume(cylinderPayload)
    assert(beforeVolume > 0, 'Curved round-trip source volume should be positive.')
    const curvedMeshAccuracy = {
      chordTolerance: 1,
      angleToleranceRadians: 0.5,
    }

    async function assertCurvedMeshRoundTripVolume(format: 'stl' | '3mf') {
      const exported = await exactAdapter.exportDocument({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace',
        baseRevisionId: exactSnapshot.revisionId,
        target: { kind: 'body', bodyId: exactBody.bodyId },
        targetLabel: 'Imported exact cylinder',
        format,
        options: {
          ...getDefaultDocumentExportOptions(format),
          meshAccuracy: curvedMeshAccuracy,
        },
      })
      assert(exported.ok && exported.payload instanceof Uint8Array, `${format} curved export should produce mesh bytes.`)

      const importAdapter = createAdapter()
      const importService = createModelingService(importAdapter, {
        currentDocumentId: 'doc_workspace',
        operationHistoryStore: null,
        documentRepository: null,
      })
      const importedMesh = await importService.importMeshFile({
        fileName: `curved-cylinder.${format}`,
        bytes: exported.payload,
        acceptFacetedFallback: true,
      })
      assert(importedMesh.ok, `${format} curved mesh import should bake a generated geometry asset.`)

      const importedSnapshot = await importService.getCurrentDocumentSnapshot()
      const importedBody = importedSnapshot.bodies.find((body) => body.ownerFeatureId?.startsWith('feature_meshImport-'))
      assert(importedBody, `${format} curved mesh import should restore a baked body.`)

      const importedStep = await importAdapter.exportDocument({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace',
        baseRevisionId: importedSnapshot.revisionId,
        target: { kind: 'body', bodyId: importedBody.bodyId },
        targetLabel: `Imported curved ${format.toUpperCase()} body`,
        format: 'step',
        options: getDefaultDocumentExportOptions('step'),
      })
      assert(importedStep.ok && typeof importedStep.payload === 'string', `Imported curved ${format} baked body should export as STEP.`)

      const afterVolume = await readStepPayloadVolume(importedStep.payload)
      const relativeDelta = Math.abs(beforeVolume - afterVolume) / Math.max(beforeVolume, 1)
      assert(
        relativeDelta < 0.08,
        `${format} curved mesh round-trip should stay within tessellated volume tolerance. Before=${beforeVolume}; after=${afterVolume}; relative delta=${relativeDelta}.`,
      )
    }

    await assertCurvedMeshRoundTripVolume('stl')
    await assertCurvedMeshRoundTripVolume('3mf')
  }

  async function testStepExportImportPreservesComplexFilletedChamferedVolume() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)
    assert(committed.revisionState.kind === 'accepted', 'Seed sketch commit must succeed before complex STEP round-trip coverage.')

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const extrude = await createExtrudeBody(adapter, committedSnapshot.snapshot.revisionId, sketch, 18)
    let revisionId = extrude.response.revisionId
    let bodyId = extrude.bodyId

    const extrudedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const removableFaceId = requireBody(extrudedSnapshot.snapshot, bodyId).topology.faceIds[0]
    assert(removableFaceId, 'Complex STEP round-trip body should expose a removable face for shelling.')

    const shell = await createFeatureBody(
      adapter,
      revisionId,
      createShellDefinition(bodyId, removableFaceId, 0.65),
      'Shell create',
    )
    revisionId = shell.response.revisionId
    bodyId = shell.bodyId

    const internalFilletEdge = await findPreviewableFilletEdgeForRadius(adapter, revisionId, bodyId, 0.18)
    const internalFillet = await createFeatureBody(
      adapter,
      revisionId,
      createFilletDefinition(bodyId, internalFilletEdge, 0.18),
      'Internal fillet create',
    )
    revisionId = internalFillet.response.revisionId
    bodyId = internalFillet.bodyId

    const chamferEdge = await findPreviewableChamferEdge(adapter, revisionId, bodyId)
    const chamfer = await createFeatureBody(
      adapter,
      revisionId,
      createChamferDefinition(bodyId, chamferEdge, 0.08),
      'Exterior chamfer create',
    )
    revisionId = chamfer.response.revisionId
    bodyId = chamfer.bodyId

    const exteriorFilletEdge = await findPreviewableFilletEdgeForRadius(adapter, revisionId, bodyId, 0.12)
    const exteriorFillet = await createFeatureBody(
      adapter,
      revisionId,
      createFilletDefinition(bodyId, exteriorFilletEdge, 0.12),
      'Exterior fillet create',
    )
    revisionId = exteriorFillet.response.revisionId
    bodyId = exteriorFillet.bodyId

    const originalStep = await adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: revisionId,
      target: { kind: 'body', bodyId },
      targetLabel: 'Complex Filleted Chamfered Body',
      format: 'step',
      options: getDefaultDocumentExportOptions('step'),
    })
    assert(originalStep.ok && typeof originalStep.payload === 'string', 'Complex STEP export should succeed.')
    const beforeVolume = await readStepPayloadVolume(originalStep.payload)

    const sourceDocument = await adapter.exportAuthoredModelDocument('doc_workspace')
    const featureId = 'feature_stepImport-1' as FeatureId
    const imported = await createStepImportDocumentFromPayload(sourceDocument, {
      featureId,
      label: 'Imported complex body',
      fileName: 'complex-filleted-chamfered.step',
      payload: originalStep.payload,
    })
    assert(
      imported.asset.data.kind === 'cadaraBrep'
      && imported.asset.data.bodies.some((body) =>
        body.topology.faces.some((face) => face.surface.kind !== 'plane'),
      ),
      'Complex STEP import should persist exact curved face surfaces instead of collapsing the body into planar triangle facets.',
    )
    const importAdapter = createAdapter()

    await importAdapter.restoreAuthoredModelDocument(imported.document, [], createStepAssetResolver(imported.asset, imported.bytes))
    await waitFor(
      () => importAdapter.getStepImportMaterializationStatus() === null,
      'Complex STEP import should finish background OCC materialization before exact re-export.',
    )
    const importedSnapshot = (await importAdapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    const importedBody = importedSnapshot.bodies.find((body) => body.ownerFeatureId === featureId)
    assert(importedBody, 'Complex STEP import should rebuild an imported body.')

    const importedStep = await importAdapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: importedSnapshot.revisionId,
      target: { kind: 'body', bodyId: importedBody.bodyId },
      targetLabel: 'Imported Complex Body',
      format: 'step',
      options: getDefaultDocumentExportOptions('step'),
    })
    assert(importedStep.ok && typeof importedStep.payload === 'string', 'Imported complex body STEP export should succeed.')

    const afterVolume = await readStepPayloadVolume(importedStep.payload)
    const relativeDelta = Math.abs(beforeVolume - afterVolume) / Math.max(beforeVolume, 1)
    assert(beforeVolume > 0, 'Complex STEP round-trip source volume should be positive.')
    assert(
      relativeDelta < 1e-4,
      `Complex STEP import should stay within neutral faceted B-rep volume tolerance. Before=${beforeVolume}; after=${afterVolume}; relative delta=${relativeDelta}.`,
    )
  }

  async function testStepImportReportsCorruptBrepData() {
    const fixture = await createExportableBodyFixture()
    const step = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: fixture.revisionId,
      target: { kind: 'body', bodyId: fixture.bodyId },
      targetLabel: fixture.targetLabel,
      format: 'step',
      options: getDefaultDocumentExportOptions('step'),
    })
    assert(step.ok && typeof step.payload === 'string', 'Fixture STEP export should produce importable text.')

    const sourceDocument = await fixture.adapter.exportAuthoredModelDocument('doc_workspace')
    const imported = await createStepImportDocumentFromPayload(sourceDocument, {
      featureId: 'feature_stepImport-1' as FeatureId,
      label: 'Missing asset body',
      fileName: 'missing.step',
      payload: step.payload,
    })
    const adapter = createAdapter()
    const corruptDocument: AuthoredModelDocument = {
      ...imported.document,
      assets: {
        ...imported.document.assets,
        records: imported.document.assets.records.map((asset) =>
          asset.assetId === imported.asset.assetId && asset.data?.kind === 'cadaraBrep'
            ? {
                ...asset,
                data: {
                  ...asset.data,
                  bodies: asset.data.bodies.map((body) => ({
                    ...body,
                    topology: {
                      ...body.topology,
                      faces: body.topology.faces.map((face, index) =>
                        index === 0
                          ? { ...face, triangles: [[999_999, 999_998, 999_997]] }
                          : face,
                      ),
                    },
                  })),
                },
              }
            : asset,
        ),
      },
    }

    await adapter.restoreAuthoredModelDocument(corruptDocument, [], {
      async getGeometryAssetBytes() {
        return null
      },
    })
    const snapshot = (await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot

    const missingAssetDiagnostic = snapshot.document.diagnostics.find((diagnostic) =>
      diagnostic.featureId === 'feature_stepImport-1',
    )
    assert(
      missingAssetDiagnostic
        && (
          missingAssetDiagnostic.detail?.kind !== 'stepImport'
          || missingAssetDiagnostic.detail.assetId === imported.asset.assetId
        ),
      'STEP import should report corrupt translated B-rep data as a structured document diagnostic.',
	    )
  }

	  async function testStepImportReportsUnsupportedStepFiles() {
	    const sourceDocument = await createAdapter().exportAuthoredModelDocument('doc_workspace')
	    const edgeOnlyPayload = await createEdgeOnlyStepPayload()
	    const noSolidBake = bakeStepImportGeometryWithOpenCascade(await getDefaultOpenCascadeInstance(), {
	      files: [{ fileName: 'edge-only.step', bytes: new TextEncoder().encode(edgeOnlyPayload) }],
	    })
	    assert(
	      !noSolidBake.ok && noSolidBake.diagnostics.some((diagnostic) => diagnostic.code === 'step-import-no-solids'),
	      'STEP import baking should reject readable STEP files with no supported solid bodies.',
	    )

    const mixedPayload = await createMixedSolidAndEdgeStepPayload()
    const mixedFeatureId = 'feature_stepImport-2' as FeatureId
    const mixedImport = await createStepImportDocumentFromPayload(sourceDocument, {
      featureId: mixedFeatureId,
      label: 'Mixed body',
      fileName: 'mixed.step',
      payload: mixedPayload,
    })
    const mixedAdapter = createAdapter()

    await mixedAdapter.restoreAuthoredModelDocument(
      mixedImport.document,
      [],
      createStepAssetResolver(mixedImport.asset, mixedImport.bytes),
    )
    await waitFor(
      () => mixedAdapter.getStepImportMaterializationStatus() === null,
      'Mixed STEP import should finish background OCC materialization before final diagnostic assertions.',
    )
    const mixedSnapshot = (await mixedAdapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot

    assert(
      mixedSnapshot.bodies.some((body) => body.ownerFeatureId === mixedFeatureId),
      'STEP import should keep supported solids from mixed STEP files.',
    )
	    assert(mixedSnapshot.document.diagnostics.length === 0, 'Baked STEP import restore should not reprocess skipped source-only non-solid content.')
	  }

	  async function testStepImportTransfersAssemblyRootWhenAggregateCountIsZero() {
	    const samplePayload = new TextDecoder().decode(await readFile('Windows 98 Theme Progress Bar pp1425198.step'))
	    const baked = bakeStepImportGeometryWithOpenCascade(await getDefaultOpenCascadeInstance(), {
	      files: [{
	        fileName: 'Windows 98 Theme Progress Bar pp1425198.step',
	        bytes: new TextEncoder().encode(samplePayload),
	      }],
	    })
	    assert(
	      baked.ok || !baked.diagnostics.some((diagnostic) =>
	        diagnostic.code === 'step-import-unsupported-structure'
	        && diagnostic.message.includes('contains no transferable shape roots'),
	      ),
	      'STEP import baking should not reject transferable assembly roots because aggregate transfer returned zero.',
	    )
	    assert(
	      !baked.ok && baked.diagnostics.some((diagnostic) =>
	        diagnostic.code === 'step-import-no-solids',
	      ),
	      'Assembly STEP files with no embedded solids should reach the no-solids bake diagnostic after root transfer.',
	    )
	  }

  async function testStepImportRestoresMultipleSupportedSolids() {
    const sourceDocument = await createAdapter().exportAuthoredModelDocument('doc_workspace')
    const featureId = 'feature_stepImport-1' as FeatureId
    const imported = await createStepImportDocumentFromPayload(sourceDocument, {
      featureId,
      label: 'Multi body',
      fileName: 'multi-body.step',
      payload: await createTwoSolidStepPayload(),
    })
    const adapter = createAdapter()

    await adapter.restoreAuthoredModelDocument(
      imported.document,
      [],
      createStepAssetResolver(imported.asset, imported.bytes),
    )
    await waitFor(
      () => adapter.getStepImportMaterializationStatus() === null,
      'Multi-solid STEP import should finish background OCC materialization before exact topology assertions.',
    )
    const snapshot = (await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    const importedBodies = snapshot.bodies.filter((body) => body.ownerFeatureId === featureId)

    assert(importedBodies.length === 2, 'STEP import should flatten multiple supported solids into separate bodies.')
    assert(
      importedBodies.map((body) => body.label).join(',') === 'Multi body 1,Multi body 2',
      'STEP import should assign deterministic labels to multiple imported bodies.',
    )
    assert(
      importedBodies.every((body) =>
        body.topology.faceIds.length > 0
        && body.topology.edgeIds.length > 0
        && body.topology.vertexIds.length > 0,
      ),
      'Every imported STEP body should expose selectable topology refs.',
    )
  }

  async function testStepImportReviewKeepsEmbeddedSolidsWithMissingReferences() {
    const adapter = createAdapter()
    const payloadText = await createTwoSolidStepPayload()
    const payloadWithMissingReference = `${payloadText}\n#999999=DOCUMENT_FILE('missing.step','',(),(),(),());\n`

    const review = await adapter.prepareStepImportReview([
      { fileName: 'multi-body.step', bytes: new TextEncoder().encode(payloadWithMissingReference) },
    ])

    const missingReference = review.diagnostics.find((diagnostic) => diagnostic.code === 'step-import-missing-reference')
    assert(missingReference?.severity === 'warning', 'STEP review should warn about unresolved external references.')
    assert(
      !review.diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
      'Unresolved external STEP references should not block embedded solid review.',
    )
    assert(review.solids.length === 2, 'STEP review should still expose embedded solids from the selected file.')
  }

  async function testStepImportRestoresSelectedSolidSubset() {
    const sourceDocument = await createAdapter().exportAuthoredModelDocument('doc_workspace')
    const featureId = 'feature_stepImport-selected-subset' as FeatureId
    const fileName = 'multi-body.step'
    const imported = await createStepImportDocumentFromPayload(sourceDocument, {
      featureId,
      label: 'Selected body',
      fileName,
      payload: await createTwoSolidStepPayload(),
      selectedSolidKeys: [createStepSolidKey({ documentName: fileName, solidOrdinal: 2 })],
    })
    const adapter = createAdapter()

    await adapter.restoreAuthoredModelDocument(
      imported.document,
      [],
      createStepAssetResolver(imported.asset, imported.bytes),
    )
    await waitFor(
      () => adapter.getStepImportMaterializationStatus() === null,
      'STEP import with stale selected solids should finish background OCC materialization before final diagnostics are asserted.',
    )
    const snapshot = (await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    const importedBodies = snapshot.bodies.filter((body) => body.ownerFeatureId === featureId)

    assert(importedBodies.length === 1, 'STEP import should rebuild only selected solid keys.')
    assert(importedBodies[0]?.label === 'Selected body selection', 'STEP import should use the selected solid label.')
  }

  async function testStepImportReportsStaleSelectedSolidKey() {
    const sourceDocument = await createAdapter().exportAuthoredModelDocument('doc_workspace')
    const featureId = 'feature_stepImport-stale-selection' as FeatureId
    const imported = await createStepImportDocumentFromPayload(sourceDocument, {
      featureId,
      label: 'Stale body',
      fileName: 'multi-body.step',
      payload: await createTwoSolidStepPayload(),
      selectedSolidKeys: ['multi-body.step#solid-99'],
    })
    const adapter = createAdapter()

    await adapter.restoreAuthoredModelDocument(
      imported.document,
      [],
      createStepAssetResolver(imported.asset, imported.bytes),
    )
    const snapshot = (await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot

    assert(
      snapshot.document.diagnostics.some((diagnostic) =>
        diagnostic.code === 'step-import-stale-selected-solid'
        && diagnostic.featureId === featureId
        && diagnostic.detail?.kind === 'stepImport'
        && diagnostic.detail.solidKey === 'multi-body.step#solid-99',
      ),
      'STEP import should report stale selected solid keys as structured diagnostics.',
    )
    assert(
      snapshot.bodies.every((body) => body.ownerFeatureId !== featureId),
      'STEP import with stale selected solid keys should not silently import replacement bodies.',
    )
  }

  async function testOccGeometryExportsRejectInvalidTargets() {
    const fixture = await createExportableBodyFixture()
    const stale = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_0001',
      target: { kind: 'body', bodyId: fixture.bodyId },
      targetLabel: fixture.targetLabel,
      format: 'step',
      options: getDefaultDocumentExportOptions('step'),
    })

    assert(!stale.ok, 'OCC geometry export should reject stale revision requests.')
    assert(stale.diagnostics.some((diagnostic) => diagnostic.code === 'occ-export-revision-conflict'), 'Stale geometry exports should report a revision conflict diagnostic.')

    const missingBody = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: fixture.revisionId,
      target: { kind: 'body', bodyId: 'body_missing' as BodyId },
      targetLabel: 'Missing Body',
      format: 'stl',
      options: getDefaultDocumentExportOptions('stl'),
    })

    assert(!missingBody.ok, 'OCC geometry export should reject missing body targets.')
    assert(missingBody.diagnostics.some((diagnostic) => diagnostic.code === 'occ-export-missing-body'), 'Missing body exports should report a missing body diagnostic.')

    const nonBody = await fixture.adapter.exportDocument({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: fixture.revisionId,
      target: { kind: 'sketch', sketchId: OCC_KERNEL_PRIMARY_SKETCH_ID },
      targetLabel: 'Sketch',
      format: '3mf',
      options: getDefaultDocumentExportOptions('3mf'),
    })

    assert(!nonBody.ok, 'OCC geometry export should reject non-body targets.')
    assert(nonBody.diagnostics.some((diagnostic) => diagnostic.code === 'occ-export-unexportable-target'), 'Non-body geometry exports should report an unexportable target diagnostic.')
  }

  async function testSnapshotFetchAndSketchCommit() {
    const adapter = createAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })

    assert(before.snapshot.constructions.length === 3, 'Initial OCC snapshot must expose the three datum planes.')
    assert(before.snapshot.render.records.length > 0, 'Initial OCC snapshot must expose render export records.')

    const committed = await commitSeedSketch(adapter)

    assert(committed.revisionState.kind === 'accepted', 'Seed sketch commit must be accepted.')
    assert(committed.rebuildResult.kind === 'rebuilt', 'Accepted sketch commits must report rebuilt results.')

    const after = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })

    assert(after.snapshot.revisionId === committed.revisionId, 'Snapshot fetch must observe the committed sketch revision.')
    assert(
      after.snapshot.sketches.some((sketch) => sketch.sketchId === OCC_KERNEL_PRIMARY_SKETCH_ID),
      'Committed sketches must persist in later authoritative snapshots.',
    )
  }

  async function testPlaneFeatureCreateSupportsConstructionAndPlanarFaceReferences() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before plane coverage.')
    }

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const constructionPlane = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committedSnapshot.snapshot.revisionId,
      definition: createPlaneDefinitionFromConstruction('construction_plane-xy'),
    })

    assert(constructionPlane.revisionState.kind === 'accepted', 'Construction-backed coplanar planes must create successfully.')
    assert(constructionPlane.rebuildResult.kind === 'rebuilt', 'Construction-backed plane create must rebuild.')
    assert(
      constructionPlane.changedTargets.some((target) => target.kind === 'construction'),
      'Plane create must report the produced construction target.',
    )

    const extrude = await createExtrudeBody(adapter, constructionPlane.revisionId, sketch, 12)
    const planarFaceId = await findPreviewablePlanarFace(adapter, extrude.response.revisionId, extrude.bodyId)
    const facePlane = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      definition: createPlaneDefinitionFromFace(extrude.bodyId, planarFaceId),
    })

    assert(facePlane.revisionState.kind === 'accepted', 'Planar-face-backed coplanar planes must create successfully.')
    assert(facePlane.rebuildResult.kind === 'rebuilt', 'Planar-face-backed plane create must rebuild.')
    assert(
      facePlane.changedTargets.some((target) => target.kind === 'construction'),
      'Face-backed plane create must report the produced construction target.',
    )
  }

  async function testExtrudePreviewCreateAndUpdateCommitGeometry() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before extrude coverage.')
    }

    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(snapshot.snapshot)
    const preview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: snapshot.snapshot.revisionId,
      previewId: 'preview_extrude_fresh',
      definition: createExtrudeDefinition(sketch, 12),
    })

    assert(preview.freshness.kind === 'fresh', 'Fresh extrude previews must report fresh freshness state.')
    assert(preview.render.records.length > 0, 'Extrude preview must return transient renderables.')
    assertNoErrorDiagnostics(preview.diagnostics, 'Extrude preview must not surface error diagnostics for valid input')

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: snapshot.snapshot.revisionId,
      definition: createExtrudeDefinition(sketch, 12),
    })

    assert(created.revisionState.kind === 'accepted', 'Extrude create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Extrude create must rebuild.')

    const createdBodyTarget = created.changedTargets.find((target) => target.kind === 'body')

    if (!createdBodyTarget || createdBodyTarget.kind !== 'body') {
      throw new Error('Extrude create must report the created body as a changed target.')
    }

    const createdSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const createdSignature = committedBodySignature(createdSnapshot.snapshot, createdBodyTarget.bodyId)
    const updated = await adapter.updateFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      featureId: created.featureId,
      featureLabel: 'Renamed OCC Extrude',
      definition: createExtrudeDefinition(sketch, 20),
    })

    assert(updated.revisionState.kind === 'accepted', 'Extrude update must be accepted.')
    assert(updated.rebuildResult.kind === 'rebuilt', 'Accepted extrude update must rebuild.')
    assert(
      updated.changedTargets.some((target) => target.kind === 'body' && target.bodyId === createdBodyTarget.bodyId),
      'Extrude update must report the rebuilt body target.',
    )

    const updatedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })

    assert(
      committedBodySignature(updatedSnapshot.snapshot, createdBodyTarget.bodyId) !== createdSignature,
      'Extrude update must commit changed body topology into later snapshots.',
    )
    assert(
      updatedSnapshot.snapshot.features.find((feature) => feature.featureId === created.featureId)?.label === 'Renamed OCC Extrude',
      'Extrude update must commit renamed feature labels into later snapshots.',
    )
  }

  async function testRevolvePreviewCreateAndConstructionAxisRejection() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before revolve coverage.')
    }

    const firstSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const axisSketch = requirePrimarySketch(firstSnapshot.snapshot)
    const axisBody = await createExtrudeBody(adapter, firstSnapshot.snapshot.revisionId, axisSketch, 12)
    const revolveSketchCommit = await commitOffsetSketch(adapter, axisBody.response.revisionId, {
      sketchLabel: 'Revolve Profile',
      offsetX: 0,
      offsetY: 0,
      plane: createStandardPlaneDefinition('xz'),
    })

    assert(revolveSketchCommit.revisionState.kind === 'accepted', 'Revolve profile sketch commit must be accepted.')

    const revolveSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const revolveSketch = requireSketch(revolveSnapshot.snapshot, revolveSketchCommit.sketchId)
    const axisEdgeId = await findPreviewableRevolveAxisEdge(
      adapter,
      revolveSnapshot.snapshot.revisionId,
      revolveSketch,
      axisBody.bodyId,
    )
    const preview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: revolveSnapshot.snapshot.revisionId,
      previewId: 'preview_revolve_edge_axis',
      definition: createRevolveDefinition(revolveSketch, axisBody.bodyId, axisEdgeId),
    })

    assert(preview.freshness.kind === 'fresh', 'Fresh revolve previews must report fresh freshness state.')
    assert(preview.render.records.length > 0, 'Edge-backed revolve preview must return transient renderables.')
    assertNoErrorDiagnostics(preview.diagnostics, 'Edge-backed revolve preview must not emit error diagnostics')

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: revolveSnapshot.snapshot.revisionId,
      definition: createRevolveDefinition(revolveSketch, axisBody.bodyId, axisEdgeId),
    })

    assert(created.revisionState.kind === 'accepted', 'Edge-backed revolve create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Edge-backed revolve create must rebuild.')
    assert(
      created.changedTargets.some((target) => target.kind === 'body'),
      'Edge-backed revolve create must report a produced body target.',
    )

    const rejected = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: createConstructionAxisRevolveDefinition(revolveSketch, 'construction_plane-xy'),
    })

    assert(rejected.revisionState.kind === 'rejected', 'Construction-axis revolve requests must reject explicitly.')
    assert(rejected.rebuildResult.kind === 'skipped', 'Rejected construction-axis revolve requests must skip rebuild.')
    assert(
      rejected.diagnostics.some((diagnostic) => diagnostic.code === OCC_CONTRACT_GAP_CODES.constructionRevolveAxisUnsupported),
      'Construction-axis revolve rejection must surface the contract-gap diagnostic code.',
    )
    assert(
      rejected.diagnostics.some((diagnostic) => diagnostic.detail?.kind === 'rebuildFailure'),
      'Construction-axis revolve rejection must surface structured diagnostics.',
    )
  }

  async function testRepositoryRestorePreservesRolledBackFutureRevolve() {
    const adapter = createAdapter()
    const documentRepository = createMemoryDocumentRepository()
    const service = createModelingService(adapter, {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const initial = await service.getCurrentDocumentSnapshot()
    const seedSketchRequest = createSketchCommitRequest(initial.revisionId)
    const seedSketchCommit = await unwrapModelingResult(service.commitSketch(createServiceSketchCommitInput(seedSketchRequest)))

    assert(seedSketchCommit.revisionState.kind === 'accepted', 'Repository-backed seed sketch commit should be accepted.')

    const sketchSnapshot = await service.getCurrentDocumentSnapshot()
    const axisSketch = requirePrimarySketch(sketchSnapshot)
    const axisExtrude = await unwrapModelingResult(service.createFeature({
      baseRevisionId: sketchSnapshot.revisionId,
      definition: createExtrudeDefinition(axisSketch, 12),
    }))
    const axisBody = axisExtrude.changedTargets.find((target) => target.kind === 'body')

    assert(axisExtrude.revisionState.kind === 'accepted', 'Repository-backed extrude create should be accepted.')
    assert(axisBody?.kind === 'body', 'Repository-backed extrude create should produce a body target.')

    const revolveSketchRequest = createSketchCommitRequest(axisExtrude.revisionId, {
      sketchLabel: 'Repository Revolve Profile',
      plane: createStandardPlaneDefinition('xz'),
      definition: translateSeedDefinition(0, 0),
    })
    const revolveSketchCommit = await unwrapModelingResult(service.commitSketch(createServiceSketchCommitInput(revolveSketchRequest)))

    assert(revolveSketchCommit.revisionState.kind === 'accepted', 'Repository-backed second sketch commit should be accepted.')

    const preRevolveSnapshot = await service.getCurrentDocumentSnapshot()
    const revolveSketch = requireSketch(preRevolveSnapshot, revolveSketchCommit.sketchId)
    const axisEdgeId = await findPreviewableRevolveAxisEdge(
      adapter,
      preRevolveSnapshot.revisionId,
      revolveSketch,
      axisBody.bodyId,
    )
    const revolve = await unwrapModelingResult(service.createFeature({
      baseRevisionId: preRevolveSnapshot.revisionId,
      definition: createRevolveDefinition(revolveSketch, axisBody.bodyId, axisEdgeId),
    }))

    assert(revolve.revisionState.kind === 'accepted', 'Repository-backed revolve create should be accepted.')

    const rollback = await unwrapModelingResult(service.setFeatureCursor({
      baseRevisionId: revolve.revisionId,
      cursor: { kind: 'sketch', sketchId: revolveSketchCommit.sketchId },
    }))

    assert(rollback.revisionState.kind === 'accepted', 'Repository-backed cursor rollback should be accepted.')

    const persisted = documentRepository.savedDocuments.at(-1)
    assert(persisted, 'Repository-backed cursor rollback should persist an authored document.')
    assert(
      persisted.features.some((feature) => feature.featureId === revolve.featureId),
      'Persisted rolled-back authored document should retain the future revolve feature.',
    )
    assert(
      persisted.cursor.kind === 'sketch' && persisted.cursor.sketchId === revolveSketchCommit.sketchId,
      'Persisted rolled-back authored document should retain the sketch2 cursor.',
    )
    assert(
      persisted.historyOrder?.map((item) => item.kind === 'sketch' ? item.sketchId : item.featureId).join('>') ===
        `${seedSketchCommit.sketchId}>${axisExtrude.featureId}>${revolveSketchCommit.sketchId}>${revolve.featureId}`,
      'Persisted rolled-back authored document should keep sketch - extrude - sketch2 - revolve history order.',
    )

    const restoredService = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const restoreState = await restoredService.getHistoryRestoreState()
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot()
    const restoredHistory = restoredSnapshot.presentation.documentHistory.map((item) =>
      item.kind === 'sketch' ? item.sketchId : item.featureId,
    )
    const nextCursor = getNextDocumentHistoryCursor(restoredSnapshot)

    assert(restoreState.kind === 'restored', 'Fresh repository-backed service should restore the rolled-back document.')
    assert(
      restoredSnapshot.features.some((feature) => feature.featureId === revolve.featureId),
      'Restored rolled-back document should retain the future revolve feature.',
    )
    assert(
      restoredSnapshot.cursor.kind === 'sketch' && restoredSnapshot.cursor.sketchId === revolveSketchCommit.sketchId,
      'Restored rolled-back document should retain the sketch2 cursor.',
    )
    assert(
      restoredHistory.join('>') === `${seedSketchCommit.sketchId}>${axisExtrude.featureId}>${revolveSketchCommit.sketchId}>${revolve.featureId}`,
      'Restored rolled-back document should preserve sketch - extrude - sketch2 - revolve history order.',
    )
    assert(
      nextCursor?.kind === 'feature' && nextCursor.featureId === revolve.featureId,
      'Restored rolled-back document should move the next cursor forward to the existing revolve feature.',
    )
  }

  async function testSweepPreviewCreateAndUnsupportedCases() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before sweep coverage.')
    }

    const firstSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sweepSketch = requirePrimarySketch(firstSnapshot.snapshot)
    const pathBody = await createExtrudeBody(adapter, firstSnapshot.snapshot.revisionId, sweepSketch, 12)
    const pathEdgeId = await findPreviewableSweepPathEdge(
      adapter,
      pathBody.response.revisionId,
      sweepSketch,
      pathBody.bodyId,
    )
    const preview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: pathBody.response.revisionId,
      previewId: 'preview_sweep_edge_path',
      definition: createSweepDefinition(sweepSketch, pathBody.bodyId, pathEdgeId),
    })

    assert(preview.freshness.kind === 'fresh', 'Fresh sweep previews must report fresh freshness state.')
    assert(preview.render.records.length > 0, 'Edge-backed sweep preview must return transient renderables.')
    assertNoErrorDiagnostics(preview.diagnostics, 'Edge-backed sweep preview must not emit error diagnostics')

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: pathBody.response.revisionId,
      definition: createSweepDefinition(sweepSketch, pathBody.bodyId, pathEdgeId),
    })

    assert(created.revisionState.kind === 'accepted', 'Edge-backed sweep create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Edge-backed sweep create must rebuild.')
    assert(
      created.changedTargets.some((target) => target.kind === 'body'),
      'Edge-backed sweep create must report a produced body target.',
    )

    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const currentPathBody = requireBody(snapshot.snapshot, pathBody.bodyId)
    const guideEdgeId = currentPathBody.topology.edgeIds.find((edgeId) => edgeId !== pathEdgeId) ?? pathEdgeId
    const faceProfileId = currentPathBody.topology.faceIds[0]
    const region = sweepSketch.sketch.regions[0]
    assert(region, 'Committed sketch must expose a region for unsupported sweep coverage.')
    assert(faceProfileId, 'Sweep source body must expose a face for multi-profile sweep diagnostics.')
    const unsupportedMultiProfile = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      previewId: 'preview_sweep_unsupported_multi_profile',
      definition: {
        kind: 'sweep',
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: 'create',
          participants: [
            {
              role: 'profile',
              targets: [
                { kind: 'region', sketchId: sweepSketch.sketchId, regionId: region.regionId },
                { kind: 'face', bodyId: pathBody.bodyId, faceId: faceProfileId },
              ],
            },
            {
              role: 'path',
              targets: [{ kind: 'edge', bodyId: pathBody.bodyId, edgeId: pathEdgeId }],
            },
          ],
        },
      },
    })
    const unsupportedGuide = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      previewId: 'preview_sweep_unsupported_guide',
      definition: createSweepDefinition(sweepSketch, pathBody.bodyId, pathEdgeId, [
        { role: 'guideCurve', targets: [{ kind: 'edge', bodyId: pathBody.bodyId, edgeId: guideEdgeId }] },
      ]),
    })
    const unsupportedBoolean = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: {
        kind: 'sweep',
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: 'subtract',
          participants: [
            {
              role: 'profile',
              targets: [{ kind: 'region', sketchId: sweepSketch.sketchId, regionId: region.regionId }],
            },
            {
              role: 'path',
              targets: [{ kind: 'edge', bodyId: pathBody.bodyId, edgeId: pathEdgeId }],
            },
            { role: 'targetBody', targets: [{ kind: 'body', bodyId: pathBody.bodyId }] },
          ],
        },
      },
    })

    assert(
      unsupportedMultiProfile.diagnostics.some((diagnostic) => diagnostic.code === 'advanced-feature-unsupported-kernel-case'),
      'Multi-profile sweep previews should return an explicit unsupported-kernel diagnostic.',
    )
    assert(hasErrorDiagnostics(unsupportedGuide.diagnostics), 'Guide-curve sweep preview must emit explicit unsupported diagnostics.')
    assert(unsupportedBoolean.revisionState.kind === 'rejected', 'Boolean sweep create must reject unsupported composition explicitly.')
    assert(
      unsupportedBoolean.diagnostics.some((diagnostic) => diagnostic.detail?.kind === 'rebuildFailure'),
      'Unsupported sweep create rejection must surface structured diagnostics.',
    )
  }

  async function testLoftPreviewCreateAndUnsupportedCases() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before loft coverage.')
    }

    const firstSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const loftSketch = requirePrimarySketch(firstSnapshot.snapshot)
    const faceBody = await createExtrudeBody(adapter, firstSnapshot.snapshot.revisionId, loftSketch, 12)
    const planarFaceId = await findPreviewablePlanarFace(adapter, faceBody.response.revisionId, faceBody.bodyId)
    const facePlane = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: faceBody.response.revisionId,
      definition: createPlaneDefinitionFromFace(faceBody.bodyId, planarFaceId),
    })
    assert(facePlane.revisionState.kind === 'accepted', 'Face-backed plane creation must succeed before loft coverage.')
    const planeTarget = facePlane.changedTargets.find((target) => target.kind === 'construction')
    assert(planeTarget?.kind === 'construction', 'Face-backed plane creation must produce a construction target.')
    const planeSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const loftPlane = planeSnapshot.snapshot.constructions.find((entry) => entry.constructionId === planeTarget.constructionId)?.plane
    assert(loftPlane, 'Face-backed loft plane must be present in the current snapshot.')
    const upperSketchCommit = await commitOffsetSketch(adapter, planeSnapshot.snapshot.revisionId, {
      sketchLabel: 'loft_upper',
      offsetX: 0.15,
      offsetY: 0.15,
      plane: loftPlane,
    })
    assert(upperSketchCommit.revisionState.kind === 'accepted', 'Upper loft sketch must commit successfully.')
    const secondSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const upperSketch = requireSketch(secondSnapshot.snapshot, upperSketchCommit.sketchId)
    const upperRegion = upperSketch.sketch.regions[0]
    assert(upperRegion, 'Upper loft sketch must expose a profile region.')
    const preview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: secondSnapshot.snapshot.revisionId,
      previewId: 'preview_loft_region_profiles',
      definition: createLoftDefinition(loftSketch, {
        kind: 'region',
        sketchId: upperSketch.sketchId,
        regionId: upperRegion.regionId,
      }),
    })

    assert(preview.freshness.kind === 'fresh', 'Fresh loft previews must report fresh freshness state.')
    assertNoErrorDiagnostics(preview.diagnostics, 'Loft preview must not emit error diagnostics')

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: secondSnapshot.snapshot.revisionId,
      definition: createLoftDefinition(loftSketch, {
        kind: 'region',
        sketchId: upperSketch.sketchId,
        regionId: upperRegion.regionId,
      }),
    })

    assert(created.revisionState.kind === 'accepted', 'Loft create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Accepted loft create must rebuild.')
    assert(
      created.changedTargets.some((target) => target.kind === 'body'),
      'Loft create must report a produced body target.',
    )

    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const currentBody = requireBody(snapshot.snapshot, faceBody.bodyId)
    const guideEdgeId = currentBody.topology.edgeIds[0]
    const region = loftSketch.sketch.regions[0]
    assert(region, 'Committed sketch must expose a region for unsupported loft coverage.')
    const guidePreview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      previewId: 'preview_loft_supported_guide',
      definition: createLoftDefinition(loftSketch, {
        kind: 'region',
        sketchId: upperSketch.sketchId,
        regionId: upperRegion.regionId,
      }, [
        { role: 'guideCurve', targets: [{ kind: 'edge', bodyId: faceBody.bodyId, edgeId: guideEdgeId! }] },
      ]),
    })
    const unsupportedPathGuide = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      previewId: 'preview_loft_unsupported_path_guide',
      definition: createLoftDefinition(loftSketch, {
        kind: 'region',
        sketchId: upperSketch.sketchId,
        regionId: upperRegion.regionId,
      }, [
        { role: 'path', targets: [{ kind: 'edge', bodyId: faceBody.bodyId, edgeId: guideEdgeId! }] },
        { role: 'guideCurve', targets: [{ kind: 'edge', bodyId: faceBody.bodyId, edgeId: guideEdgeId! }] },
      ]),
    })
    const unsupportedBoolean = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: {
        kind: 'loft',
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: 'subtract',
          participants: [
            {
              role: 'profile',
              targets: [
                { kind: 'region', sketchId: loftSketch.sketchId, regionId: region.regionId },
                { kind: 'region', sketchId: upperSketch.sketchId, regionId: upperRegion.regionId },
              ],
            },
            { role: 'targetBody', targets: [{ kind: 'body', bodyId: faceBody.bodyId }] },
          ],
        },
      },
    })

    assertNoErrorDiagnostics(guidePreview.diagnostics, 'Guide-curve loft preview must not emit error diagnostics.')
    assert(hasErrorDiagnostics(unsupportedPathGuide.diagnostics), 'Path plus guide-curve loft preview must emit explicit unsupported diagnostics.')
    assert(unsupportedBoolean.revisionState.kind === 'rejected', 'Boolean loft create must reject unsupported composition explicitly.')
    assert(
      unsupportedBoolean.diagnostics.some((diagnostic) => diagnostic.detail?.kind === 'rebuildFailure'),
      'Unsupported loft create rejection must surface structured diagnostics.',
    )
  }

  async function testFilletCreateAndUpdateMutateBodyTopology() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before fillet coverage.')
    }

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const extrude = await createExtrudeBody(adapter, committedSnapshot.snapshot.revisionId, sketch, 12)
    const preFilletSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const preFilletSignature = committedBodySignature(preFilletSnapshot.snapshot, extrude.bodyId)
    const edgeId = await findPreviewableFilletEdge(adapter, extrude.bodyId)
    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      definition: createFilletDefinition(extrude.bodyId, edgeId, 0.5),
    })

    assert(created.revisionState.kind === 'accepted', 'Fillet create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Fillet create must rebuild.')

    const createdSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const createdSignature = committedBodySignature(createdSnapshot.snapshot, extrude.bodyId)

    assert(
      createdSignature !== preFilletSignature,
      'Fillet create must mutate the owning body topology in later snapshots.',
    )

    const updated = await adapter.updateFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      featureId: created.featureId,
      definition: createFilletDefinition(extrude.bodyId, edgeId, 1),
    })

    assert(updated.revisionState.kind === 'accepted', 'Fillet update must be accepted.')
    assert(updated.rebuildResult.kind === 'rebuilt', 'Fillet update must rebuild.')

    const updatedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })

    assert(
      committedBodySignature(updatedSnapshot.snapshot, extrude.bodyId) !== createdSignature,
      'Fillet update must rebuild the body topology for the new radius.',
    )
  }

  async function testChamferPreviewCreateAndUnsupportedCases() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before chamfer coverage.')
    }

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const extrude = await createExtrudeBody(adapter, committedSnapshot.snapshot.revisionId, sketch, 12)
    const preChamferSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const preChamferSignature = committedBodySignature(preChamferSnapshot.snapshot, extrude.bodyId)
    const edgeId = await findPreviewableChamferEdge(adapter, extrude.response.revisionId, extrude.bodyId)
    const preview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      previewId: 'preview_chamfer_edge',
      definition: createChamferDefinition(extrude.bodyId, edgeId, 0.05),
    })

    assert(preview.freshness.kind === 'fresh', 'Fresh chamfer previews must report fresh freshness state.')
    assert(preview.render.records.length > 0, 'Edge-backed chamfer preview must return transient renderables.')
    assert(
      !hasFeatureExecutionFailureDiagnostics(preview.diagnostics),
      'Edge-backed chamfer preview must not emit feature execution failure diagnostics.',
    )

    const unsupported = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      definition: createChamferDefinition(extrude.bodyId, edgeId, 0),
    })

    assert(unsupported.revisionState.kind === 'rejected', 'Invalid chamfer distance must reject explicitly.')
    assert(
      unsupported.diagnostics.some((diagnostic) => diagnostic.detail?.kind === 'rebuildFailure'),
      'Invalid chamfer rejection must surface structured rebuild diagnostics.',
    )

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      definition: createChamferDefinition(extrude.bodyId, edgeId, 0.05),
    })

    assert(created.revisionState.kind === 'accepted', 'Chamfer create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Chamfer create must rebuild.')
    assert(
      created.changedTargets.some((target) => target.kind === 'body'),
      'Chamfer create must report a produced body target.',
    )

    const createdSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    assert(
      committedBodySignature(createdSnapshot.snapshot, extrude.bodyId) !== preChamferSignature,
      'Chamfer create must mutate the owning body topology in later snapshots.',
    )
  }

  async function testChamferCreateKeepsHistoricalInvalidationsOutOfDocumentDiagnostics() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before chamfer invalidation coverage.')
    }

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const extrude = await createExtrudeBody(adapter, committedSnapshot.snapshot.revisionId, sketch, 12)
    const edgeId = await findPreviewableChamferEdge(adapter, extrude.response.revisionId, extrude.bodyId)
    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      definition: createChamferDefinition(extrude.bodyId, edgeId, 0.05),
    })

    assert(created.revisionState.kind === 'accepted', 'Chamfer create must be accepted for invalidation coverage.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Chamfer create must rebuild for invalidation coverage.')
    assert(
      !created.diagnostics.some((diagnostic) => diagnostic.code === 'occ-invalid-reference'),
      'Successful chamfer commits must not surface steady-state invalidated topology as operation diagnostics.',
    )

    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const invalidatedInputEdge = snapshot.snapshot.document.references.find((reference) =>
      reference.target.kind === 'edge'
      && reference.target.bodyId === extrude.bodyId
      && reference.target.edgeId === edgeId
      && reference.invalidation !== null,
    )

    assert(
      invalidatedInputEdge,
      'Chamfer snapshots must preserve invalidated input topology in reference records for downstream tooling.',
    )
    assert(
      !snapshot.snapshot.document.diagnostics.some((diagnostic) => diagnostic.code === 'occ-invalid-reference'),
      'Committed chamfers must not expose their own invalidated input topology as document diagnostics.',
    )

    const resolved = await adapter.resolveReference({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      target: { kind: 'edge', bodyId: extrude.bodyId, edgeId },
    })

    assert(
      resolved.resolution.invalidation?.target.kind === 'edge'
      && resolved.resolution.invalidation.target.bodyId === extrude.bodyId
      && resolved.resolution.invalidation.target.edgeId === edgeId,
      'Explicit lookup of a chamfer-consumed input edge must still return an invalidated edge resolution.',
    )
    assert(
      resolved.diagnostics.some((diagnostic) => diagnostic.code === 'occ-invalid-reference'),
      'Explicit lookup of a chamfer-consumed input edge must still emit invalid-reference diagnostics.',
    )
  }

  async function testShellPreviewCreateUpdateAndSnapshotRoundTrip() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before shell coverage.')
    }

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const extrude = await createExtrudeBody(adapter, committedSnapshot.snapshot.revisionId, sketch, 8)
    const extrudedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sourceBody = requireBody(extrudedSnapshot.snapshot, extrude.bodyId)
    const removableFaceId = sourceBody.topology.faceIds[0]

    if (!removableFaceId) {
      throw new Error('Extruded source body must expose at least one face for shell coverage.')
    }

    const preview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrudedSnapshot.snapshot.revisionId,
      previewId: 'preview_shell_1',
      definition: createShellDefinition(extrude.bodyId, removableFaceId, 0.75),
    })

    assert(preview.freshness.kind === 'fresh', 'Fresh shell previews must report fresh freshness state.')
    assert(preview.render.records.length > 0, 'Shell preview must return transient renderables.')
    assertNoErrorDiagnostics(preview.diagnostics, 'Shell preview must not emit error diagnostics.')

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrudedSnapshot.snapshot.revisionId,
      definition: createShellDefinition(extrude.bodyId, removableFaceId, 0.75),
    })

    assert(created.revisionState.kind === 'accepted', 'Shell create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Shell create must rebuild.')
    assert(
      created.changedTargets.some((target) => target.kind === 'body'),
      'Shell create must report a produced body target.',
    )

    const createdSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const createdFeature = createdSnapshot.snapshot.features.find((feature) => feature.featureId === created.featureId)
    assert(createdFeature?.definition.kind === 'shell', 'Shell create must serialize through feature snapshots with the shell contract kind.')

    const updated = await adapter.updateFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      featureId: created.featureId,
      definition: createShellDefinition(extrude.bodyId, removableFaceId, 1.25),
    })

    assert(updated.revisionState.kind === 'accepted', 'Shell update must be accepted.')
    assert(updated.rebuildResult.kind === 'rebuilt', 'Shell update must rebuild.')
  }

  async function testThickenPreviewCreateAndUnsupportedCases() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before thicken coverage.')
    }

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const extrude = await createExtrudeBody(adapter, committedSnapshot.snapshot.revisionId, sketch, 8)
    const planarFaceId = await findPreviewablePlanarFace(adapter, extrude.response.revisionId, extrude.bodyId)
    const preview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      previewId: 'preview_thicken_face',
      definition: createThickenDefinition(extrude.bodyId, planarFaceId, 0.75, 'oneSide'),
    })

    assert(preview.freshness.kind === 'fresh', 'Fresh thicken previews must report fresh freshness state.')
    assertNoErrorDiagnostics(preview.diagnostics, 'Face-backed thicken preview must not emit error diagnostics.')

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      definition: createThickenDefinition(extrude.bodyId, planarFaceId, 0.75, 'oneSide'),
    })

    assert(created.revisionState.kind === 'accepted', 'Thicken create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Thicken create must rebuild.')
    assert(
      created.changedTargets.some((target) => target.kind === 'body'),
      'Thicken create must report a produced body target.',
    )

    const unsupportedBoolean = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: {
        kind: 'thicken',
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: 'subtract',
          participants: [
            { role: 'face', targets: [{ kind: 'face', bodyId: extrude.bodyId, faceId: planarFaceId }] },
            { role: 'targetBody', targets: [{ kind: 'body', bodyId: extrude.bodyId }] },
          ],
          options: { thickness: 0.75, side: 'oneSide' },
        },
      },
    })

    assert(unsupportedBoolean.revisionState.kind === 'rejected', 'Boolean thicken create must reject unsupported composition explicitly.')
    assert(
      unsupportedBoolean.diagnostics.some((diagnostic) => diagnostic.detail?.kind === 'rebuildFailure'),
      'Unsupported thicken create rejection must surface structured diagnostics.',
    )
  }

  async function testSplitPreviewCreateAndUnsupportedCases() {
    const adapter = createAdapter()
    const firstSketchCommit = await commitSeedSketch(adapter)

    if (firstSketchCommit.revisionState.kind !== 'accepted') {
      throw new Error('Initial sketch commit must succeed before split coverage.')
    }

    const secondSketchCommit = await commitOffsetSketch(adapter, firstSketchCommit.revisionId, {
      sketchLabel: 'Split Tool',
      offsetX: 2,
      offsetY: 0,
    })
    assert(secondSketchCommit.revisionState.kind === 'accepted', 'Second sketch commit must be accepted for split coverage.')

    const sketchSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const firstSketch = requirePrimarySketch(sketchSnapshot.snapshot)
    const secondSketch = requireSketch(sketchSnapshot.snapshot, secondSketchCommit.sketchId)
    const targetBody = await createExtrudeBody(adapter, sketchSnapshot.snapshot.revisionId, firstSketch, 6)
    const toolBody = await createExtrudeBody(adapter, targetBody.response.revisionId, secondSketch, 6)

    const preview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: toolBody.response.revisionId,
      previewId: 'preview_split_body_tool',
      definition: createSplitDefinition(targetBody.bodyId, toolBody.bodyId),
    })

    assert(preview.freshness.kind === 'fresh', 'Fresh split previews must report fresh freshness state.')
    assertNoErrorDiagnostics(preview.diagnostics, 'Body-tool split preview must not emit error diagnostics.')

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: toolBody.response.revisionId,
      definition: createSplitDefinition(targetBody.bodyId, toolBody.bodyId),
    })

    assert(created.revisionState.kind === 'accepted', 'Split create must be accepted for the supported tool-body path.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Accepted split create must rebuild.')
    assert(
      created.changedTargets.filter((target) => target.kind === 'body').length >= 2,
      'Split create must report the produced replacement bodies.',
    )

    const after = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    assert(
      after.snapshot.bodies.every((body) => body.bodyId !== targetBody.bodyId),
      'Split create must replace the target body with new result bodies.',
    )
    assert(
      after.snapshot.bodies.some((body) => body.bodyId === toolBody.bodyId),
      'Split create must preserve the tool body in committed state.',
    )
    assert(
      after.snapshot.bodies.filter((body) => body.bodyId.startsWith('body_feature_split-')).length >= 2,
      'Split create must append replacement split result bodies.',
    )

    const unsupportedPlane = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: {
        kind: 'split',
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            { role: 'targetBody', targets: [{ kind: 'body', bodyId: toolBody.bodyId }] },
            { role: 'plane', targets: [{ kind: 'construction', constructionId: 'construction_plane-xy' }] },
          ],
        },
      },
    })

    assert(unsupportedPlane.revisionState.kind === 'rejected', 'Plane-based split create must reject unsupported composition explicitly.')
    assert(
      unsupportedPlane.diagnostics.some((diagnostic) => diagnostic.detail?.kind === 'rebuildFailure'),
      'Unsupported split create rejection must surface structured diagnostics.',
    )
  }

  async function testCombinePreviewCreateReplayAndValidation() {
    const store = createMemoryOperationHistoryStore()
    const service = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: store,
    })

    const firstRequest = createSketchCommitRequest('rev_0001', {
      sketchLabel: 'Combine Target',
    })
    const firstSketchCommit = await unwrapModelingResult(service.commitSketch({
      baseRevisionId: firstRequest.baseRevisionId,
      solverCorrelation: firstRequest.solverCorrelation,
      sketchId: firstRequest.sketchId,
      sketchLabel: firstRequest.sketchLabel,
      plane: firstRequest.plane,
      planeTarget: firstRequest.planeTarget,
      planeKey: firstRequest.planeKey,
      definition: firstRequest.definition,
    }))
    assert(firstSketchCommit.revisionState.kind === 'accepted', 'First combine sketch should commit before boolean coverage.')

    const secondRequest = createSketchCommitRequest(firstSketchCommit.revisionId, {
      sketchLabel: 'Combine Tool',
      definition: translateSeedDefinition(2, 0),
    })
    const secondSketchCommit = await unwrapModelingResult(service.commitSketch({
      baseRevisionId: secondRequest.baseRevisionId,
      solverCorrelation: secondRequest.solverCorrelation,
      sketchId: secondRequest.sketchId,
      sketchLabel: secondRequest.sketchLabel,
      plane: secondRequest.plane,
      planeTarget: secondRequest.planeTarget,
      planeKey: secondRequest.planeKey,
      definition: secondRequest.definition,
    }))
    assert(secondSketchCommit.revisionState.kind === 'accepted', 'Second combine sketch should commit before boolean coverage.')

    const thirdRequest = createSketchCommitRequest(secondSketchCommit.revisionId, {
      sketchLabel: 'Combine Disjoint Tool',
      definition: translateSeedDefinition(30, 0),
    })
    const thirdSketchCommit = await unwrapModelingResult(service.commitSketch({
      baseRevisionId: thirdRequest.baseRevisionId,
      solverCorrelation: thirdRequest.solverCorrelation,
      sketchId: thirdRequest.sketchId,
      sketchLabel: thirdRequest.sketchLabel,
      plane: thirdRequest.plane,
      planeTarget: thirdRequest.planeTarget,
      planeKey: thirdRequest.planeKey,
      definition: thirdRequest.definition,
    }))
    assert(thirdSketchCommit.revisionState.kind === 'accepted', 'Disjoint combine sketch should commit before empty-result coverage.')

    const sketchSnapshot = await service.getCurrentDocumentSnapshot()
    const firstSketch = requireSketch(sketchSnapshot, firstSketchCommit.sketchId)
    const secondSketch = requireSketch(sketchSnapshot, secondSketchCommit.sketchId)
    const thirdSketch = requireSketch(sketchSnapshot, thirdSketchCommit.sketchId)

    async function createServiceExtrudeBody(baseRevisionId: RevisionId, sketch: SketchSnapshotRecord, label: string) {
      const created = await unwrapModelingResult(service.createFeature({
        baseRevisionId,
        featureLabel: label,
        definition: createExtrudeDefinition(sketch, 6),
      }))
      const bodyTarget = created.changedTargets.find((target) => target.kind === 'body')

      assert(created.revisionState.kind === 'accepted', `${label} extrude should commit before combine coverage.`)
      assert(bodyTarget?.kind === 'body', `${label} extrude should report a produced body target.`)
      return { response: created, bodyId: bodyTarget.bodyId }
    }

    const targetBody = await createServiceExtrudeBody(sketchSnapshot.revisionId, firstSketch, 'Combine Target Body')
    const toolBody = await createServiceExtrudeBody(targetBody.response.revisionId, secondSketch, 'Combine Tool Body')
    const disjointToolBody = await createServiceExtrudeBody(toolBody.response.revisionId, thirdSketch, 'Combine Disjoint Tool Body')
    const combineDefinition = createCombineDefinition([targetBody.bodyId], [toolBody.bodyId], 'subtract')
    const beforePreview = await service.getCurrentDocumentSnapshot()
    const beforeTargetSignature = committedBodySignature(beforePreview, targetBody.bodyId)

    const preview = await service.evaluatePreview({
      baseRevisionId: disjointToolBody.response.revisionId,
      previewId: 'preview_combine_subtract',
      definition: combineDefinition,
    })
    const afterPreview = await service.getCurrentDocumentSnapshot()

    assert(preview.freshness.kind === 'fresh', 'Fresh combine previews must report fresh freshness state.')
    assertNoErrorDiagnostics(preview.diagnostics, 'Combine subtract preview must not emit error diagnostics.')
    assert(preview.renderables.length > 0, 'Combine subtract preview must return transient renderables.')
    assert(afterPreview.bodies.some((body) => body.bodyId === toolBody.bodyId), 'Combine preview must not mutate the committed tool body.')
    assert(
      committedBodySignature(afterPreview, targetBody.bodyId) === beforeTargetSignature,
      'Combine preview must leave committed target geometry unchanged.',
    )

    const created = await unwrapModelingResult(service.createFeature({
      baseRevisionId: disjointToolBody.response.revisionId,
      definition: combineDefinition,
    }))
    assert(created.revisionState.kind === 'accepted', 'Combine subtract create must be accepted for valid target/tool bodies.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Accepted combine create must rebuild.')
    assert(created.changedTargets.some((target) => target.kind === 'body' && target.bodyId === targetBody.bodyId), 'Combine create must report the surviving target body.')

    const after = await service.getCurrentDocumentSnapshot()
    const afterTargetSignature = committedBodySignature(after, targetBody.bodyId)
    const committedCombine = after.features.find((feature) => feature.featureId === created.featureId)
    assert(committedCombine?.definition.kind === 'combine', 'Committed combine feature should persist in the feature timeline.')
    assert(after.bodies.some((body) => body.bodyId === targetBody.bodyId), 'Combine create should preserve the target body id.')
    assert(after.bodies.every((body) => body.bodyId !== toolBody.bodyId), 'Combine create should remove the consumed tool body.')
    assert(after.bodies.some((body) => body.bodyId === disjointToolBody.bodyId), 'Combine create should preserve unrelated bodies.')
    assert(afterTargetSignature !== beforeTargetSignature, 'Combine create should change the surviving target body geometry.')

    const emptyIntersection = await expectModelingError(service.createFeature({
      baseRevisionId: created.revisionId,
      definition: createCombineDefinition([targetBody.bodyId], [disjointToolBody.bodyId], 'intersect'),
    }))
    assert(emptyIntersection.code === 'modeling/diagnostic', 'Combine empty intersections should reject instead of committing a no-op.')

    const afterRejected = await service.getCurrentDocumentSnapshot()
    assert(afterRejected.revisionId === after.revisionId, 'Rejected combine requests must not mutate committed document state.')

    const staleTool = await unwrapModelingResult(service.createFeature({
      baseRevisionId: afterRejected.revisionId,
      definition: createCombineDefinition([targetBody.bodyId], [toolBody.bodyId], 'add'),
    }))
    assert(
      staleTool.revisionState.kind === 'accepted' && staleTool.rebuildResult.kind === 'failed',
      'Combine with a consumed tool body should keep repairable authored history.',
    )
    assert(
      staleTool.diagnostics.some((diagnostic) => diagnostic.detail?.kind === 'invalidReference'),
      'Combine with a consumed tool body should surface repairable stale-reference diagnostics.',
    )

    const restoredService = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: store,
    })
    const restored = await restoredService.getCurrentDocumentSnapshot()
    const restoredCombine = restored.features.find((feature) => feature.featureId === created.featureId)

    assert(restoredCombine?.definition.kind === 'combine', 'Restored operation history should replay committed combine features.')
    assert(restored.bodies.some((body) => body.bodyId === targetBody.bodyId), 'Restored combine output should preserve the target body id.')
    assert(restored.bodies.every((body) => body.bodyId !== toolBody.bodyId), 'Restored combine output should keep the consumed tool body removed.')
    assert(
      committedBodySignature(restored, targetBody.bodyId) === afterTargetSignature,
      'Restored combine output should match the committed post-boolean target geometry.',
    )
  }

  async function testDeleteSolidPreviewCreateAndReferenceInvalidation() {
    const adapter = createAdapter()
    const firstSketchCommit = await commitSeedSketch(adapter)

    if (firstSketchCommit.revisionState.kind !== 'accepted') {
      throw new Error('Initial sketch commit must succeed before delete-solid coverage.')
    }

    const secondSketchCommit = await commitOffsetSketch(adapter, firstSketchCommit.revisionId, {
      sketchLabel: 'Delete Solid 2',
      offsetX: 20,
      offsetY: 0,
    })
    assert(secondSketchCommit.revisionState.kind === 'accepted', 'Second sketch commit must be accepted for delete-solid coverage.')

    const sketchSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const firstSketch = requirePrimarySketch(sketchSnapshot.snapshot)
    const secondSketch = requireSketch(sketchSnapshot.snapshot, secondSketchCommit.sketchId)
    const bodyA = await createExtrudeBody(adapter, sketchSnapshot.snapshot.revisionId, firstSketch, 6)
    const bodyB = await createExtrudeBody(adapter, bodyA.response.revisionId, secondSketch, 6)

    const preview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: bodyB.response.revisionId,
      previewId: 'preview_delete_solid_body',
      definition: createDeleteSolidDefinition([bodyA.bodyId]),
    })

    assert(preview.freshness.kind === 'fresh', 'Fresh delete-solid previews must report fresh freshness state.')
    assertNoErrorDiagnostics(preview.diagnostics, 'Delete-solid preview must not emit error diagnostics.')

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: bodyB.response.revisionId,
      definition: createDeleteSolidDefinition([bodyA.bodyId]),
    })

    assert(created.revisionState.kind === 'accepted', 'Delete-solid create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Accepted delete-solid create must rebuild.')

    const after = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    assert(after.snapshot.bodies.every((body) => body.bodyId !== bodyA.bodyId), 'Delete-solid create must remove the selected body from the committed snapshot.')
    assert(after.snapshot.bodies.some((body) => body.bodyId === bodyB.bodyId), 'Delete-solid create must preserve unselected bodies.')

    const resolved = await adapter.resolveReference({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      target: { kind: 'body', bodyId: bodyA.bodyId },
    })

    assert(
      resolved.resolution.invalidation?.reason === 'occ-topology-deleted' || resolved.resolution.invalidation?.reason === 'occ-reference-missing',
      'Delete-solid must invalidate removed body references explicitly after commit.',
    )
  }

  async function testMirrorPreviewCreateAndCopyBodies() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before mirror coverage.')
    }

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const extrude = await createExtrudeBody(adapter, committedSnapshot.snapshot.revisionId, sketch, 6)

    const preview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      previewId: 'preview_mirror_body',
      definition: createMirrorDefinition([extrude.bodyId], { kind: 'construction', constructionId: 'construction_plane-yz' }),
    })

    assert(preview.freshness.kind === 'fresh', 'Fresh mirror previews must report fresh freshness state.')
    assertNoErrorDiagnostics(preview.diagnostics, 'Mirror preview must not emit error diagnostics.')

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      definition: createMirrorDefinition([extrude.bodyId], { kind: 'construction', constructionId: 'construction_plane-yz' }),
    })

    assert(created.revisionState.kind === 'accepted', 'Mirror create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Accepted mirror create must rebuild.')

    const after = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    assert(after.snapshot.bodies.some((body) => body.bodyId === extrude.bodyId), 'Mirror create must preserve the source body in the committed snapshot.')
    assert(after.snapshot.bodies.length >= 2, 'Mirror create must append a mirrored result body to the committed snapshot.')
  }

  async function testTransformPreviewCreateAndReplaceBody() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before transform coverage.')
    }

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const extrude = await createExtrudeBody(adapter, committedSnapshot.snapshot.revisionId, sketch, 6)

    const preview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      previewId: 'preview_transform_body',
      definition: createTransformDefinition([extrude.bodyId], { kind: 'construction', constructionId: 'construction_plane-xy' }, 2),
    })

    assert(preview.freshness.kind === 'fresh', 'Fresh transform previews must report fresh freshness state.')
    assertNoErrorDiagnostics(preview.diagnostics, 'Transform preview must not emit error diagnostics.')

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.response.revisionId,
      definition: createTransformDefinition([extrude.bodyId], { kind: 'construction', constructionId: 'construction_plane-xy' }, 2),
    })

    assert(created.revisionState.kind === 'accepted', 'Transform create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Accepted transform create must rebuild.')

    const after = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    assert(after.snapshot.bodies.some((body) => body.bodyId === extrude.bodyId), 'Transform create must preserve the selected body id in the committed snapshot.')
  }

  async function testDeleteFeatureRebuildsSnapshotAndResolveReferenceInvalidatesMissingRefs() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before delete coverage.')
    }

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committedSnapshot.snapshot.revisionId,
      definition: createExtrudeDefinition(sketch, 12),
    })

    assert(created.revisionState.kind === 'accepted', 'Extrude create must be accepted.')
    assert(created.rebuildResult.kind === 'rebuilt', 'Accepted extrude create must rebuild.')

    const createdBodyTarget = created.changedTargets.find((target) => target.kind === 'body')

    if (!createdBodyTarget || createdBodyTarget.kind !== 'body') {
      throw new Error('Extrude create must report the created body as a changed target.')
    }

    const deleted = await adapter.deleteFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      featureId: created.featureId,
    })

    assert(deleted.revisionState.kind === 'accepted', 'Extrude delete must be accepted.')
    assert(deleted.rebuildResult.kind === 'rebuilt', 'Accepted feature deletes must rebuild the OCC snapshot.')
    assert(
      deleted.rebuildResult.invalidatedTargets.some(
        (target) => target.kind === 'body' && target.bodyId === createdBodyTarget.bodyId,
      ),
      'Deleting the extrude must report the removed body as invalidated.',
    )

    const deletedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })

    assert(
      deletedSnapshot.snapshot.features.every((feature) => feature.featureId !== created.featureId),
      'Deleted features must be removed from later snapshots.',
    )
    assert(
      deletedSnapshot.snapshot.bodies.every((body) => body.bodyId !== createdBodyTarget.bodyId),
      'Deleting a body-producing feature must rebuild later snapshots without the removed body.',
    )

    const resolved = await adapter.resolveReference({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      target: createdBodyTarget,
    })

    assert(
      resolved.resolution.invalidation?.target.kind === 'body'
      && resolved.resolution.invalidation.target.bodyId === createdBodyTarget.bodyId,
      'Deleted bodies must resolve as explicit invalidations instead of silently remapping.',
    )
    assert(resolved.diagnostics.length > 0, 'Invalidated reference resolution must emit machine-readable diagnostics.')
  }

  async function testReorderFeatureAndConflictHandling() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before reorder coverage.')
    }

    const firstPlane = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committed.revisionId,
      definition: createPlaneDefinitionFromConstruction('construction_plane-xy'),
    })
    const secondPlane = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: firstPlane.revisionId,
      definition: createPlaneDefinitionFromConstruction('construction_plane-yz'),
    })
    const reordered = await adapter.reorderFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: secondPlane.revisionId,
      featureId: secondPlane.featureId,
      beforeFeatureId: firstPlane.featureId,
    })

    assert(reordered.revisionState.kind === 'accepted', 'Feature reorder must be accepted.')
    assert(reordered.rebuildResult.kind === 'rebuilt', 'Accepted feature reorders must rebuild the OCC snapshot.')

    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const planeFeatureOrder = snapshot.snapshot.features
      .filter((feature) => feature.definition.kind === 'plane')
      .map((feature) => feature.featureId)

    assert(
      planeFeatureOrder[0] === secondPlane.featureId && planeFeatureOrder[1] === firstPlane.featureId,
      'Feature reorder must persist the new feature order in later snapshots.',
    )

    const documentHistoryReordered = await adapter.reorderDocumentHistory({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: reordered.revisionId,
      item: { kind: 'feature', featureId: firstPlane.featureId },
      beforeItem: { kind: 'sketch', sketchId: committed.sketchId },
    })

    assert(documentHistoryReordered.revisionState.kind === 'accepted', 'Mixed document history reorder must be accepted.')
    assert(documentHistoryReordered.rebuildResult.kind === 'rebuilt', 'Accepted document history reorders must rebuild the OCC snapshot.')

    const reorderedDocumentHistory = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    assert(
      reorderedDocumentHistory.snapshot.presentation.documentHistory[0]?.kind === 'feature'
        && reorderedDocumentHistory.snapshot.presentation.documentHistory[0].featureId === firstPlane.featureId,
      'Document history reorder must persist mixed feature/sketch order in later snapshots.',
    )
    assert(
      reorderedDocumentHistory.snapshot.features[0]?.featureId === firstPlane.featureId
        && reorderedDocumentHistory.snapshot.features[1]?.featureId === secondPlane.featureId,
      'Document history feature reorders must update OCC feature execution order.',
    )

    const missingAnchor = await adapter.reorderDocumentHistory({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: documentHistoryReordered.revisionId,
      item: { kind: 'feature', featureId: firstPlane.featureId },
      beforeItem: { kind: 'sketch', sketchId: 'sketch_missing' },
    })
    assert(missingAnchor.revisionState.kind === 'rejected', 'Missing document history anchors must reject.')

    const conflict = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committed.revisionId,
      definition: createPlaneDefinitionFromConstruction('construction_plane-xz'),
    })

    assert(conflict.revisionState.kind === 'conflict', 'Stale base revisions must return explicit conflicts.')
    assert(
      conflict.rebuildResult.kind === 'skipped' && conflict.rebuildResult.reasonCode === 'revisionConflict',
      'Conflicts must skip rebuilds explicitly.',
    )
  }

  async function testDocumentHistoryReorderRejectsFeatureBeforeSketchDependency() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before dependency-order reorder coverage.')
    }

    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = snapshot.snapshot.sketches.find((entry) => entry.sketchId === committed.sketchId)
    assert(sketch, 'Committed sketch snapshot must be available for dependency-order reorder coverage.')

    const extrude = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committed.revisionId,
      definition: createExtrudeDefinition(sketch, 12),
    })
    assert(extrude.revisionState.kind === 'accepted', 'Extrude create must be accepted before dependency-order reorder coverage.')

    const invalidReorder = await adapter.reorderDocumentHistory({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.revisionId,
      item: { kind: 'feature', featureId: extrude.featureId },
      beforeItem: { kind: 'sketch', sketchId: committed.sketchId },
    })

    assert(invalidReorder.revisionState.kind === 'rejected', 'Document history reorder must reject a feature before its sketch dependency.')
    assert(
      invalidReorder.diagnostics.some((diagnostic) => diagnostic.code === 'occ-document-history-dependency-order'),
      'Rejected dependency-order reorders must return a visible diagnostic.',
    )
  }

  async function testPreviewFreshness() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before preview coverage.')
    }

    const freshPreview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committed.revisionId,
      previewId: 'preview_plane_fresh',
      definition: createPlaneDefinitionFromConstruction('construction_plane-xy'),
    })

    assert(freshPreview.freshness.kind === 'fresh', 'Matching preview revisions must report fresh preview state.')
    assert(freshPreview.render.records.length > 0, 'Valid plane previews must return transient renderables.')

    const mutated = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committed.revisionId,
      definition: createPlaneDefinitionFromConstruction('construction_plane-yz'),
    })
    const stalePreview = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committed.revisionId,
      previewId: 'preview_plane_stale',
      definition: createPlaneDefinitionFromConstruction('construction_plane-xz'),
    })

    assert(mutated.revisionState.kind === 'accepted', 'Preview staleness coverage requires an intervening accepted mutation.')
    assert(stalePreview.freshness.kind === 'stale', 'Stale preview requests must report stale freshness.')
    assert(
      stalePreview.freshness.kind === 'stale' && stalePreview.freshness.currentRevisionId === stalePreview.revisionId,
      'Stale previews must report the observed current revision explicitly.',
    )
  }

  async function testConstructionPlaneSnapshotsSurfaceTheDocumentedGap() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before construction snapshot gap coverage.')
    }

    const created = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committed.revisionId,
      definition: createPlaneDefinitionFromConstruction('construction_plane-xy'),
    })

    assert(created.revisionState.kind === 'accepted', 'Plane feature create must succeed before inspecting snapshot gap diagnostics.')

    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const featureConstruction = snapshot.snapshot.constructions.find((construction) =>
      construction.ownerFeatureId === created.featureId,
    )

    assert(featureConstruction != null, 'Plane feature snapshots must include the produced construction row.')
    assert(
      !Object.prototype.hasOwnProperty.call(featureConstruction, 'frame'),
      'Construction snapshots must not smuggle internal plane geometry through the public contract.',
    )
    assert(
      snapshot.snapshot.diagnostics.some((diagnostic) =>
        diagnostic.code === OCC_CONTRACT_GAP_CODES.constructionPlaneGeometryUnavailable
        && diagnostic.target?.kind === 'construction'
        && diagnostic.target.constructionId === featureConstruction.constructionId,
      ),
      'Feature-authored construction snapshots must surface the documented reconstruction gap explicitly.',
    )
  }

  async function testCommitSketchRejectsUnknownExplicitSketchId() {
    const adapter = createAdapter()
    const seed = createSeedSketchCommitRequest()
    const rejected = await adapter.commitSketch({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_0001',
      solverCorrelation: createSolverCorrelation('request_commit_missing_sketch'),
      ...seed,
      sketchId: 'sketch_missing',
    })

    assert(rejected.revisionState.kind === 'rejected', 'Unknown explicit sketch IDs must reject instead of creating a new sketch.')
    assert(
      rejected.diagnostics.some((diagnostic) => diagnostic.code === 'occ-missing-sketch'),
      'Unknown explicit sketch IDs must report a specific missing-sketch diagnostic.',
    )
  }

  async function testProjectedGeometryRegionLoopsRejectAsUnsupported() {
    const adapter = createAdapter(() => new ProjectedRegionLoopSketchSolverAdapter())
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Projected-loop sketch commit must succeed before downstream unsupported-geometry coverage.')
    }

    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(snapshot.snapshot)
    const rejected = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: snapshot.snapshot.revisionId,
      definition: createExtrudeDefinition(sketch, 12),
    })

    assert(rejected.revisionState.kind === 'rejected', 'Projected-geometry region loops must reject downstream profile-based features.')
    assert(
      rejected.diagnostics.some((diagnostic) =>
        diagnostic.code === OCC_CONTRACT_GAP_CODES.projectedRegionGeometryUnavailable,
      ),
      'Projected-geometry loop rejection must surface the structured contract-gap diagnostic code.',
    )
  }

  async function testDownstreamInvalidReferencesRejectWithStructuredDiagnostics() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Seed sketch commit must succeed before downstream invalidation coverage.')
    }

    const committedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(committedSnapshot.snapshot)
    const extrude = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committedSnapshot.snapshot.revisionId,
      definition: createExtrudeDefinition(sketch, 12),
    })

    if (extrude.revisionState.kind !== 'accepted') {
      throw new Error('Extrude create must succeed before testing downstream invalidation handling.')
    }

    const bodyTarget = extrude.changedTargets.find((target) => target.kind === 'body')

    if (!bodyTarget || bodyTarget.kind !== 'body') {
      throw new Error('Extrude must produce a body target for downstream invalidation coverage.')
    }

    const deleted = await adapter.deleteFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: extrude.revisionId,
      featureId: extrude.featureId,
    })

    if (deleted.revisionState.kind !== 'accepted') {
      throw new Error('Extrude delete must succeed before testing stale downstream refs.')
    }

    const consumer = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: deleted.revisionId,
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{
            kind: 'region',
            sketchId: sketch.sketchId,
            regionId: sketch.sketch.regions[0]!.regionId,
          }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 6 },
          operation: 'join',
          booleanScope: { kind: 'targetBody', bodyId: bodyTarget.bodyId },
        },
      },
    })

    assert(consumer.revisionState.kind === 'accepted', 'Features referencing deleted body targets should keep repairable authored history.')
    assert(consumer.rebuildResult.kind === 'failed', 'Repairable downstream invalid body refs should report a failed partial rebuild.')
    assert(
      consumer.diagnostics.some((diagnostic) => diagnostic.detail?.kind === 'invalidReference'),
      'Downstream invalid body refs must surface structured invalidReference diagnostics.',
    )
    assert(
      consumer.rebuildResult.invalidatedTargets.length === 0,
      'Rejected rebuilds must not claim committed invalidated targets.',
    )
  }

  async function testMultiBodyBooleanPolicyJoinUsesFirstTargetIdentity() {
    const adapter = createAdapter()
    const firstSketchCommit = await commitSeedSketch(adapter)

    if (firstSketchCommit.revisionState.kind !== 'accepted') {
      throw new Error('Initial sketch commit must succeed before multi-body join coverage.')
    }

    const secondSketchCommit = await commitOffsetSketch(adapter, firstSketchCommit.revisionId, {
      sketchLabel: 'Sketch 2',
      offsetX: 4,
      offsetY: 0,
    })

    assert(secondSketchCommit.revisionState.kind === 'accepted', 'Second sketch commit must be accepted for multi-body join coverage.')

    const sketchSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const firstSketch = requirePrimarySketch(sketchSnapshot.snapshot)
    const secondSketch = requireSketch(sketchSnapshot.snapshot, secondSketchCommit.sketchId)
    const bodyA = await createExtrudeBody(adapter, sketchSnapshot.snapshot.revisionId, firstSketch, 6)
    const bodyB = await createExtrudeBody(adapter, bodyA.response.revisionId, secondSketch, 6)
    const beforeJoinSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const bodyABeforeSignature = committedBodySignature(beforeJoinSnapshot.snapshot, bodyA.bodyId)
    const bodyBBeforeSignature = committedBodySignature(beforeJoinSnapshot.snapshot, bodyB.bodyId)
    const region = firstSketch.sketch.regions[0]

    if (!region) {
      throw new Error('Expected the first sketch to expose a region for multi-body join coverage.')
    }

    const joined = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: bodyB.response.revisionId,
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{
            kind: 'region',
            sketchId: firstSketch.sketchId,
            regionId: region.regionId,
          }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
          operation: 'join',
          booleanScope: { kind: 'targetBodies', bodyIds: [bodyB.bodyId, bodyA.bodyId] },
        },
      },
    })

    assert(joined.revisionState.kind === 'accepted', 'Sequential multi-body joins should accept the documented policy input.')
    assert(joined.rebuildResult.kind === 'rebuilt', 'Accepted sequential multi-body joins must rebuild.')

    const afterJoinSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const joinedBodySignature = committedBodySignature(afterJoinSnapshot.snapshot, bodyB.bodyId)

    assert(
      afterJoinSnapshot.snapshot.bodies.some((body) => body.bodyId === bodyB.bodyId),
      'Sequential joins must preserve the first supplied target body id.',
    )
    assert(
      afterJoinSnapshot.snapshot.bodies.every((body) => body.bodyId !== bodyA.bodyId),
      'Sequential joins must collapse later supplied target bodies into the first target body row.',
    )
    assert(
      joinedBodySignature !== bodyBBeforeSignature,
      'Sequential joins must change the surviving first target body geometry/topology.',
    )
    assert(
      joinedBodySignature !== bodyABeforeSignature,
      'Sequential joins must produce a merged surviving body instead of leaving the removed later target unchanged.',
    )
  }

  async function testMultiBodyBooleanPolicyUsesPerTargetCutBehavior() {
    const adapter = createAdapter()
    const firstSketchCommit = await commitSeedSketch(adapter)

    if (firstSketchCommit.revisionState.kind !== 'accepted') {
      throw new Error('Initial sketch commit must succeed before multi-body cut coverage.')
    }

    const secondSketchCommit = await commitOffsetSketch(adapter, firstSketchCommit.revisionId, {
      sketchLabel: 'Sketch 2',
      offsetX: 20,
      offsetY: 0,
    })

    assert(secondSketchCommit.revisionState.kind === 'accepted', 'Second sketch commit must be accepted for multi-body cut coverage.')

    const sketchSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const firstSketch = requirePrimarySketch(sketchSnapshot.snapshot)
    const secondSketch = requireSketch(sketchSnapshot.snapshot, secondSketchCommit.sketchId)
    const bodyA = await createExtrudeBody(adapter, sketchSnapshot.snapshot.revisionId, firstSketch, 6)
    const bodyB = await createExtrudeBody(adapter, bodyA.response.revisionId, secondSketch, 6)
    const beforeCutSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const bodyABeforeSignature = topologySignature(requireBody(beforeCutSnapshot.snapshot, bodyA.bodyId))
    const bodyBBeforeGeometry = bodyRenderGeometryOnlySignature(beforeCutSnapshot.snapshot, bodyB.bodyId)
    const region = firstSketch.sketch.regions[0]

    if (!region) {
      throw new Error('Expected the first sketch to expose a region for multi-body cut coverage.')
    }

    const cut = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: bodyB.response.revisionId,
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{
            kind: 'region',
            sketchId: firstSketch.sketchId,
            regionId: region.regionId,
          }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
          operation: 'cut',
          booleanScope: { kind: 'targetBodies', bodyIds: [bodyA.bodyId, bodyB.bodyId] },
        },
      },
    })

    assert(cut.revisionState.kind === 'accepted', 'Multi-body cut should accept the documented per-target policy input.')
    assert(cut.rebuildResult.kind === 'rebuilt', 'Accepted multi-body cut must rebuild.')

    const afterCutSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const bodyAAfterCut = requireBody(afterCutSnapshot.snapshot, bodyA.bodyId)

    assert(
      topologySignature(bodyAAfterCut) !== bodyABeforeSignature,
      'Per-target multi-body cut must modify the overlapping target body.',
    )
    assert(
      bodyRenderGeometryOnlySignature(afterCutSnapshot.snapshot, bodyB.bodyId) === bodyBBeforeGeometry,
      'Per-target multi-body cut must preserve unaffected target body geometry exactly.',
    )
  }

  async function testMultiBodyBooleanPolicyIntersectDropsEmptyTargets() {
    const adapter = createAdapter()
    const firstSketchCommit = await commitSeedSketch(adapter)

    if (firstSketchCommit.revisionState.kind !== 'accepted') {
      throw new Error('Initial sketch commit must succeed before multi-body intersect coverage.')
    }

    const secondSketchCommit = await commitOffsetSketch(adapter, firstSketchCommit.revisionId, {
      sketchLabel: 'Sketch 2',
      offsetX: 20,
      offsetY: 0,
    })

    assert(secondSketchCommit.revisionState.kind === 'accepted', 'Second sketch commit must be accepted for multi-body intersect coverage.')

    const sketchSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const firstSketch = requirePrimarySketch(sketchSnapshot.snapshot)
    const secondSketch = requireSketch(sketchSnapshot.snapshot, secondSketchCommit.sketchId)
    const bodyA = await createExtrudeBody(adapter, sketchSnapshot.snapshot.revisionId, firstSketch, 6)
    const bodyB = await createExtrudeBody(adapter, bodyA.response.revisionId, secondSketch, 6)
    const beforeIntersectSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const bodyABeforeSignature = committedBodySignature(beforeIntersectSnapshot.snapshot, bodyA.bodyId)
    const bodyBBeforeSignature = committedBodySignature(beforeIntersectSnapshot.snapshot, bodyB.bodyId)
    const region = firstSketch.sketch.regions[0]

    if (!region) {
      throw new Error('Expected the first sketch to expose a region for multi-body intersect coverage.')
    }

    const intersected = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: bodyB.response.revisionId,
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{
            kind: 'region',
            sketchId: firstSketch.sketchId,
            regionId: region.regionId,
          }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
          operation: 'intersect',
          booleanScope: { kind: 'targetBodies', bodyIds: [bodyA.bodyId, bodyB.bodyId] },
        },
      },
    })

    assert(intersected.revisionState.kind === 'accepted', 'Per-target multi-body intersects should accept the documented policy input.')
    assert(intersected.rebuildResult.kind === 'rebuilt', 'Accepted per-target multi-body intersects must rebuild.')

    const afterIntersectSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const intersectedBodySignature = committedBodySignature(afterIntersectSnapshot.snapshot, bodyA.bodyId)

    assert(
      afterIntersectSnapshot.snapshot.bodies.some((body) => body.bodyId === bodyA.bodyId),
      'Per-target intersects must preserve the overlapping target body id.',
    )
    assert(
      afterIntersectSnapshot.snapshot.bodies.every((body) => body.bodyId !== bodyB.bodyId),
      'Per-target intersects must drop target bodies whose solid result is empty.',
    )
    assert(
      intersectedBodySignature !== bodyABeforeSignature,
      'Per-target intersects must change the surviving overlapping target body geometry/topology.',
    )
    assert(
      intersectedBodySignature !== bodyBBeforeSignature,
      'Per-target intersects must preserve the surviving target identity instead of reusing the removed empty target body.',
    )
  }

  async function testUnknownPrefixedRebuildErrorsFallbackToOccRebuildFailure() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)

    if (committed.revisionState.kind !== 'accepted') {
      throw new Error('Initial sketch commit must succeed before rebuild failure fallback coverage.')
    }

    const patched = adapter as unknown as {
      buildNextAuthoringState: (runtimeState: unknown, input: unknown) => unknown
    }
    const originalBuildNextAuthoringState = patched.buildNextAuthoringState
    patched.buildNextAuthoringState = () => {
      throw new Error('fake-code: preview boom')
    }

    try {
      const preview = await adapter.evaluatePreview({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace',
        baseRevisionId: committed.revisionId,
        previewId: 'preview_unknown_rebuild_prefix',
        definition: createPlaneDefinitionFromConstruction('construction_plane-xy'),
      })

      assert(
        preview.diagnostics.some((diagnostic) => diagnostic.code === 'occ-rebuild-failure'),
        'Unknown prefixed rebuild errors must downgrade to occ-rebuild-failure.',
      )
    } finally {
      patched.buildNextAuthoringState = originalBuildNextAuthoringState
    }
  }

  async function testProfileCollectionAdapterDiagnostics() {
    const adapter = createAdapter()
    const committed = await commitSeedSketch(adapter)
    assert(committed.revisionState.kind === 'accepted', 'Profile collection adapter diagnostics require a committed sketch.')

    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(snapshot.snapshot)
    const extrudeDefinition = createExtrudeDefinition(sketch, 4)
    assert(extrudeDefinition.kind === 'extrude', 'Test helper should build an extrude definition.')

    const single = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committed.revisionId,
      previewId: 'preview_single_profile_extrude',
      definition: extrudeDefinition,
    })
    assertNoErrorDiagnostics(single.diagnostics, 'Single-profile extrude previews should remain supported')

    const axisFeature = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committed.revisionId,
      definition: extrudeDefinition,
    })
    assert(axisFeature.revisionState.kind === 'accepted', 'Profile collection adapter diagnostics require an axis source body.')
    const axisSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const axisBodyTarget = axisFeature.changedTargets.find((target) => target.kind === 'body')
    assert(axisBodyTarget?.kind === 'body', 'Accepted axis source feature must produce a body target.')
    const axisBody = requireBody(axisSnapshot.snapshot, axisBodyTarget.bodyId)
    const axisEdgeId = axisBody.topology.edgeIds[0]
    assert(axisEdgeId, 'Axis source body must expose an edge for revolve diagnostics.')
    const revolveDefinition = createRevolveDefinition(sketch, axisBody.bodyId, axisEdgeId)
    assert(revolveDefinition.kind === 'revolve', 'Test helper should build a revolve definition.')

    const empty = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: axisFeature.revisionId,
      previewId: 'preview_empty_profile_extrude',
      definition: {
        ...extrudeDefinition,
        parameters: {
          ...extrudeDefinition.parameters,
          profiles: [],
        },
      } as never,
    })
    assert(hasErrorDiagnostics(empty.diagnostics), 'Empty profile arrays should return explicit adapter diagnostics.')

    const invalid = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: axisFeature.revisionId,
      previewId: 'preview_invalid_profile_extrude',
      definition: {
        ...extrudeDefinition,
        parameters: {
          ...extrudeDefinition.parameters,
          profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: 'region_missing' }],
        },
      } as never,
    })
    assert(hasErrorDiagnostics(invalid.diagnostics), 'Invalid profile references should return explicit adapter diagnostics.')

    const duplicate = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: axisFeature.revisionId,
      previewId: 'preview_duplicate_profile_extrude',
      definition: {
        ...extrudeDefinition,
        parameters: {
          ...extrudeDefinition.parameters,
          profiles: [extrudeDefinition.parameters.profiles[0], extrudeDefinition.parameters.profiles[0]],
        },
      },
    })
    assert(
      duplicate.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-profile-group'),
      'Duplicate profile groups should not be silently reduced by the OCC adapter.',
    )

    const emptyRevolve = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: axisFeature.revisionId,
      previewId: 'preview_empty_profile_revolve',
      definition: {
        ...revolveDefinition,
        parameters: {
          ...revolveDefinition.parameters,
          profiles: [],
        },
      } as never,
    })
    assert(hasErrorDiagnostics(emptyRevolve.diagnostics), 'Empty revolve profile arrays should return explicit adapter diagnostics.')

    const duplicateRevolve = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: axisFeature.revisionId,
      previewId: 'preview_duplicate_profile_revolve',
      definition: {
        ...revolveDefinition,
        parameters: {
          ...revolveDefinition.parameters,
          profiles: [revolveDefinition.parameters.profiles[0], revolveDefinition.parameters.profiles[0]],
        },
      },
    })
    assert(
      duplicateRevolve.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-profile-group'),
      'Duplicate revolve profile groups should not be silently reduced by the OCC adapter.',
    )

    const offsetSketchCommit = await commitOffsetSketch(adapter, axisFeature.revisionId, {
      sketchLabel: 'Second Profile',
      offsetX: 8,
      offsetY: 0,
    })
    assert(offsetSketchCommit.revisionState.kind === 'accepted', 'Second sketch commit should support multi-profile adapter coverage.')
    const multiSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const secondSketch = requireSketch(multiSnapshot.snapshot, offsetSketchCommit.sketchId)
    const secondRegion = secondSketch.sketch.regions[0]
    assert(secondRegion, 'Second sketch must expose a region for multi-profile adapter coverage.')

    const multiProfileDefinition = {
      ...extrudeDefinition,
      parameters: {
        ...extrudeDefinition.parameters,
        profiles: [
          extrudeDefinition.parameters.profiles[0],
          { kind: 'region', sketchId: secondSketch.sketchId, regionId: secondRegion.regionId },
        ],
      },
    } satisfies FeatureDefinition
    const service = createModelingService(adapter, { currentDocumentId: 'doc_workspace' })
    const multi = await adapter.evaluatePreview({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: offsetSketchCommit.revisionId,
      previewId: 'preview_multi_profile_extrude',
      definition: multiProfileDefinition,
    })
    const createdMulti = await unwrapModelingResult(service.createFeature({
      baseRevisionId: offsetSketchCommit.revisionId,
      definition: multiProfileDefinition,
    }))

    assertNoErrorDiagnostics(multi.diagnostics, 'Multi-profile extrude previews should be supported by the OCC adapter.')
    assert(multi.render.records.length > 0, 'Multi-profile extrude previews should return transient renderables.')
    assert(createdMulti.revisionState.kind === 'accepted', 'Multi-profile extrude creates should be accepted through the modeling service.')
    assert(
      createdMulti.changedTargets.filter((target) => target.kind === 'body').length === 2,
      'Multi-profile extrude creates should report every produced body target.',
    )
    const afterMulti = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const committedMulti = afterMulti.snapshot.features.find((feature) => feature.featureId === createdMulti.featureId)
    assert(committedMulti?.definition.kind === 'extrude', 'Multi-profile extrude creates should persist the committed feature.')
    assert(committedMulti.producedTargets.length === 2, 'Committed multi-profile extrude should persist both produced body targets.')
    assert(
      committedMulti.producedTargets.every((target) => target.kind === 'body' && afterMulti.snapshot.bodies.some((body) => body.bodyId === target.bodyId)),
      'Committed multi-profile extrude body targets should resolve to snapshot bodies.',
    )
    const serviceSnapshot = await service.getCurrentDocumentSnapshot()
    const serviceFeature = serviceSnapshot.features.find((feature) => feature.featureId === createdMulti.featureId)
    assert(serviceFeature?.definition.kind === 'extrude', 'Modeling service snapshots should expose committed multi-profile extrude features.')
    assert(serviceFeature.producedTargets.length === 2, 'Modeling service snapshots should expose both multi-profile extrude body targets.')
  }

  async function testRestoredYzMultiProfileExtrudePreservesBodiesAndRegions() {
    const store = createMemoryOperationHistoryStore()
    const adapter = createAdapter()
    const service = createModelingService(adapter, {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: store,
    })
    const yzPlane = createStandardPlaneDefinition('yz')
    const firstRequest = createSketchCommitRequest('rev_0001', {
      sketchLabel: 'YZ Profile A',
      plane: yzPlane,
    })
    const first = await unwrapModelingResult(service.commitSketch({
      baseRevisionId: firstRequest.baseRevisionId,
      solverCorrelation: firstRequest.solverCorrelation,
      sketchId: firstRequest.sketchId,
      sketchLabel: firstRequest.sketchLabel,
      plane: firstRequest.plane,
      planeTarget: firstRequest.planeTarget,
      planeKey: firstRequest.planeKey,
      definition: firstRequest.definition,
    }))
    assert(first.revisionState.kind === 'accepted', 'First YZ sketch should commit before restore coverage.')

    const secondRequest = createSketchCommitRequest(first.revisionId, {
      sketchLabel: 'YZ Profile B',
      plane: yzPlane,
      definition: translateSeedDefinition(14, 0),
    })
    const second = await unwrapModelingResult(service.commitSketch({
      baseRevisionId: secondRequest.baseRevisionId,
      solverCorrelation: secondRequest.solverCorrelation,
      sketchId: secondRequest.sketchId,
      sketchLabel: secondRequest.sketchLabel,
      plane: secondRequest.plane,
      planeTarget: secondRequest.planeTarget,
      planeKey: secondRequest.planeKey,
      definition: secondRequest.definition,
    }))
    assert(second.revisionState.kind === 'accepted', 'Second YZ sketch should commit before restore coverage.')

    const beforeExtrude = await service.getCurrentDocumentSnapshot()
    const firstSketch = beforeExtrude.sketches.find((sketch) => sketch.sketchId === first.sketchId)
    const secondSketch = beforeExtrude.sketches.find((sketch) => sketch.sketchId === second.sketchId)
    const firstRegion = firstSketch?.sketch.regions[0]
    const secondRegion = secondSketch?.sketch.regions[0]
    assert(firstSketch && firstRegion, 'First YZ sketch should expose a selectable region.')
    assert(secondSketch && secondRegion, 'Second YZ sketch should expose a selectable region.')

    const created = await unwrapModelingResult(service.createFeature({
      baseRevisionId: beforeExtrude.revisionId,
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [
            { kind: 'region', sketchId: firstSketch.sketchId, regionId: firstRegion.regionId },
            { kind: 'region', sketchId: secondSketch.sketchId, regionId: secondRegion.regionId },
          ],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 5 },
          operation: 'newBody',
          booleanScope: { kind: 'standalone' },
        },
      },
    }))
    assert(created.revisionState.kind === 'accepted', 'YZ multi-profile extrude should commit before restore coverage.')

    const preRefresh = await service.getCurrentDocumentSnapshot()
    assert(preRefresh.features.some((feature) => feature.featureId === created.featureId), 'Committed YZ multi-profile feature should be visible before refresh.')
    assert(preRefresh.bodies.length >= 2, 'Committed YZ multi-profile extrude should create bodies before refresh.')
    assert(
      preRefresh.render.records.some((record) => record.binding.target.kind === 'region' && record.binding.target.sketchId === secondSketch.sketchId),
      'Second YZ sketch region should remain renderable before refresh.',
    )

    const restoredService = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: store,
    })
    const restored = await restoredService.getCurrentDocumentSnapshot()
    const restoredFeature = restored.features.find((feature) => feature.featureId === created.featureId)

    assert(restoredFeature?.definition.kind === 'extrude', 'Restored YZ multi-profile feature should survive operation-history replay.')
    assert(restoredFeature.producedTargets.length === 2, 'Restored YZ multi-profile feature should preserve both body targets.')
    assert(restoredFeature.producedTargets.every((target) => target.kind === 'body' && restored.bodies.some((body) => body.bodyId === target.bodyId)), 'Restored YZ body targets should resolve to snapshot bodies.')
    assert(
      restored.render.records.some((record) => record.binding.target.kind === 'region' && record.binding.target.sketchId === secondSketch.sketchId),
      'Second YZ sketch region should remain renderable after refresh.',
    )
  }

  async function testRestoredOverlappingRectangleCircleSketchKeepsRegionsRenderable() {
    const history = {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: 'modeling-operation-history/v1alpha1',
      documentId: 'doc_workspace',
      entries: [
        {
          kind: 'commitSketch',
          payload: {
            sketchId: 'sketch_primary',
            sketchLabel: 'Sketch Draft',
            plane: {
              support: {
                kind: 'construction',
                constructionId: 'construction_plane-xy',
              },
              frame: {
                origin: [0, 0, 0],
                xAxis: [1, 0, 0],
                yAxis: [0, 1, 0],
                normal: [0, 0, 1],
                linearUnit: 'documentLength',
                handedness: 'rightHanded',
              },
              key: 'xy',
            },
            planeTarget: {
              kind: 'construction',
              constructionId: 'construction_plane-xy',
            },
            planeKey: 'xy',
            definition: {
              schemaVersion: 'sketch-definition/v1alpha1',
              referenceIds: [],
              references: [],
              pointIds: [
                'sketch_point_1_rect-bottom-left',
                'sketch_point_1_rect-bottom-right',
                'sketch_point_1_rect-top-right',
                'sketch_point_1_rect-top-left',
                'sketch_point_2_circle-center',
              ],
              points: [
                {
                  pointId: 'sketch_point_1_rect-bottom-left',
                  label: 'Rectangle 1 bottom left',
                  target: {
                    kind: 'sketchPoint',
                    sketchId: 'sketch_primary',
                    pointId: 'sketch_point_1_rect-bottom-left',
                  },
                  position: [-18.21739449786329, -2.09804353632479],
                  isConstruction: false,
                },
                {
                  pointId: 'sketch_point_1_rect-bottom-right',
                  label: 'Rectangle 1 bottom right',
                  target: {
                    kind: 'sketchPoint',
                    sketchId: 'sketch_primary',
                    pointId: 'sketch_point_1_rect-bottom-right',
                  },
                  position: [-12.020556223290626, -2.09804353632479],
                  isConstruction: false,
                },
                {
                  pointId: 'sketch_point_1_rect-top-right',
                  label: 'Rectangle 1 top right',
                  target: {
                    kind: 'sketchPoint',
                    sketchId: 'sketch_primary',
                    pointId: 'sketch_point_1_rect-top-right',
                  },
                  position: [-12.020556223290626, 5.219768295940183],
                  isConstruction: false,
                },
                {
                  pointId: 'sketch_point_1_rect-top-left',
                  label: 'Rectangle 1 top left',
                  target: {
                    kind: 'sketchPoint',
                    sketchId: 'sketch_primary',
                    pointId: 'sketch_point_1_rect-top-left',
                  },
                  position: [-18.21739449786329, 5.219768295940183],
                  isConstruction: false,
                },
                {
                  pointId: 'sketch_point_2_circle-center',
                  label: 'Circle 2 center',
                  target: {
                    kind: 'sketchPoint',
                    sketchId: 'sketch_primary',
                    pointId: 'sketch_point_2_circle-center',
                  },
                  position: [-15.495896768162432, 4.313959001068386],
                  isConstruction: false,
                },
              ],
              entityIds: [
                'sketch_entity_1_rect-bottom',
                'sketch_entity_1_rect-right',
                'sketch_entity_1_rect-top',
                'sketch_entity_1_rect-left',
                'sketch_entity_2_circle',
              ],
              entities: [
                {
                  kind: 'lineSegment',
                  entityId: 'sketch_entity_1_rect-bottom',
                  label: 'Rectangle 1 bottom',
                  target: {
                    kind: 'sketchEntity',
                    sketchId: 'sketch_primary',
                    entityId: 'sketch_entity_1_rect-bottom',
                  },
                  isConstruction: false,
                  startPointId: 'sketch_point_1_rect-bottom-left',
                  endPointId: 'sketch_point_1_rect-bottom-right',
                },
                {
                  kind: 'lineSegment',
                  entityId: 'sketch_entity_1_rect-right',
                  label: 'Rectangle 1 right',
                  target: {
                    kind: 'sketchEntity',
                    sketchId: 'sketch_primary',
                    entityId: 'sketch_entity_1_rect-right',
                  },
                  isConstruction: false,
                  startPointId: 'sketch_point_1_rect-bottom-right',
                  endPointId: 'sketch_point_1_rect-top-right',
                },
                {
                  kind: 'lineSegment',
                  entityId: 'sketch_entity_1_rect-top',
                  label: 'Rectangle 1 top',
                  target: {
                    kind: 'sketchEntity',
                    sketchId: 'sketch_primary',
                    entityId: 'sketch_entity_1_rect-top',
                  },
                  isConstruction: false,
                  startPointId: 'sketch_point_1_rect-top-right',
                  endPointId: 'sketch_point_1_rect-top-left',
                },
                {
                  kind: 'lineSegment',
                  entityId: 'sketch_entity_1_rect-left',
                  label: 'Rectangle 1 left',
                  target: {
                    kind: 'sketchEntity',
                    sketchId: 'sketch_primary',
                    entityId: 'sketch_entity_1_rect-left',
                  },
                  isConstruction: false,
                  startPointId: 'sketch_point_1_rect-top-left',
                  endPointId: 'sketch_point_1_rect-bottom-left',
                },
                {
                  kind: 'circle',
                  entityId: 'sketch_entity_2_circle',
                  label: 'Circle 2',
                  target: {
                    kind: 'sketchEntity',
                    sketchId: 'sketch_primary',
                    entityId: 'sketch_entity_2_circle',
                  },
                  isConstruction: false,
                  centerPointId: 'sketch_point_2_circle-center',
                  radius: 3.1230939897294947,
                },
              ],
              constraintIds: [
                'constraint_1_bottom-horizontal',
                'constraint_1_top-horizontal',
                'constraint_1_right-vertical',
                'constraint_1_left-vertical',
              ],
              constraints: [
                {
                  constraintId: 'constraint_1_bottom-horizontal',
                  kind: 'horizontal',
                  label: 'Rectangle 1 bottom horizontal',
                  entityId: 'sketch_entity_1_rect-bottom',
                },
                {
                  constraintId: 'constraint_1_top-horizontal',
                  kind: 'horizontal',
                  label: 'Rectangle 1 top horizontal',
                  entityId: 'sketch_entity_1_rect-top',
                },
                {
                  constraintId: 'constraint_1_right-vertical',
                  kind: 'vertical',
                  label: 'Rectangle 1 right vertical',
                  entityId: 'sketch_entity_1_rect-right',
                },
                {
                  constraintId: 'constraint_1_left-vertical',
                  kind: 'vertical',
                  label: 'Rectangle 1 left vertical',
                  entityId: 'sketch_entity_1_rect-left',
                },
              ],
              dimensionIds: [
                'dimension_1_width',
                'dimension_1_height',
                'dimension_2_radius',
              ],
              dimensions: [
                {
                  dimensionId: 'dimension_1_width',
                  kind: 'distance',
                  label: 'Rectangle 1 width',
                  axis: 'horizontal',
                  pointIds: [
                    'sketch_point_1_rect-bottom-left',
                    'sketch_point_1_rect-bottom-right',
                  ],
                  value: 6.196838274572663,
                },
                {
                  dimensionId: 'dimension_1_height',
                  kind: 'distance',
                  label: 'Rectangle 1 height',
                  axis: 'vertical',
                  pointIds: [
                    'sketch_point_1_rect-bottom-left',
                    'sketch_point_1_rect-top-left',
                  ],
                  value: 7.317811832264972,
                },
                {
                  dimensionId: 'dimension_2_radius',
                  kind: 'circleRadius',
                  label: 'Circle 2 radius',
                  entityId: 'sketch_entity_2_circle',
                  value: 3.1230939897294947,
                },
              ],
            },
          },
        },
      ],
    } satisfies ModelingOperationHistoryPayload
    const service = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(history),
    })

    const restoreState = await service.getHistoryRestoreState()
    assert(restoreState.kind === 'restored', 'Overlapping rectangle/circle history should restore without emptying the workspace.')
    assert(restoreState.entriesReplayed === 1, 'The minimal overlapping sketch history should replay its sketch entry.')

    const snapshot = await service.getCurrentDocumentSnapshot()
    const sketch = snapshot.sketches.find((entry) => entry.sketchId === 'sketch_primary')
    assert(sketch, 'Restored overlapping rectangle/circle sketch should exist in the snapshot.')
    assert(sketch.sketch.regions.length >= 2, 'Restored overlapping rectangle/circle sketch should expose multiple selectable regions.')

    const regionRenderRecords = snapshot.render.records.filter((record) => record.binding.semanticClass === 'region')
    assert(regionRenderRecords.length >= 2, 'Restored overlapping rectangle/circle regions should remain renderable after reload.')
    assert(snapshot.render.records.length > regionRenderRecords.length, 'Restored overlapping rectangle/circle snapshot should include visible sketch curves or points.')

    const selectionCatalog = buildSelectionTargetCatalog(snapshot)
    assert(
      sketch.sketch.regions.every((region) => selectionCatalog.selectableTargetKeys.includes(getOccDurableRefKey(region.target))),
      'Every restored overlapping rectangle/circle region should remain selectable after reload.',
    )

    const created = await unwrapModelingResult(service.createFeature({
      baseRevisionId: snapshot.revisionId,
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: sketch.sketch.regions.map((region) => ({
            kind: 'region' as const,
            sketchId: sketch.sketchId,
            regionId: region.regionId,
          })),
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 5 },
          operation: 'newBody',
          booleanScope: { kind: 'standalone' },
        },
      },
    }))
    assert(created.revisionState.kind === 'accepted', 'New-body extrude of every restored overlapping profile should commit.')

    const afterExtrude = await service.getCurrentDocumentSnapshot()
    const committed = afterExtrude.features.find((feature) => feature.featureId === created.featureId)
    assert(committed?.definition.kind === 'extrude', 'Committed overlapping multi-profile extrude should appear in the refreshed snapshot.')
    assert(committed.producedTargets.length === sketch.sketch.regions.length, 'Committed overlapping multi-profile extrude should produce one body target per selected profile.')
    assert(
      committed.producedTargets.every((target) => target.kind === 'body' && afterExtrude.bodies.some((body) => body.bodyId === target.bodyId)),
      'Committed overlapping multi-profile extrude targets should resolve to snapshot bodies.',
    )
  }

  async function testDocumentVariableExpressionsValidateBeforeOccMutation() {
    const adapter = createAdapter()
    const initial = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })

    const x = await adapter.addDocumentVariable({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: initial.snapshot.revisionId,
      variableId: 'variable_x',
      name: 'x',
      valueText: '50',
    })
    assert(x.revisionState.kind === 'accepted', 'OCC should accept valid variable literals.')

    const y = await adapter.addDocumentVariable({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: x.revisionId,
      variableId: 'variable_y',
      name: 'y',
      valueText: 'x + 50',
    })
    assert(y.revisionState.kind === 'accepted', 'OCC should accept dependent variable expressions.')

    const acceptedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    assert(
      acceptedSnapshot.snapshot.document.variables.some((variable) =>
        variable.variableId === 'variable_y' && variable.name === 'y' && variable.valueText === 'x + 50',
      ),
      'OCC should persist raw variable expression text.',
    )

    const rejected = await adapter.updateDocumentVariable({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: y.revisionId,
      variableId: 'variable_y',
      name: 'y',
      valueText: 'x + unknown',
    })
    assert(rejected.revisionState.kind === 'rejected', 'OCC should reject invalid variable expressions.')
    assert(
      rejected.diagnostics.some((diagnostic) => diagnostic.code === 'document-variable-unresolved-reference'),
      'OCC rejection should expose shared expression diagnostics.',
    )

    const rejectedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    assert(
      rejectedSnapshot.snapshot.document.variables.map((variable) => `${variable.variableId}:${variable.name}:${variable.valueText}`).join('|')
        === acceptedSnapshot.snapshot.document.variables.map((variable) => `${variable.variableId}:${variable.name}:${variable.valueText}`).join('|'),
      'OCC rejected variable expressions should leave authoring variables unchanged.',
    )
  }

  async function testAuthoredRestoreAppliesOnlyFeaturesThroughCursor() {
    const source = createAdapter()
    const committedSketch = await commitSeedSketch(source)
    assert(committedSketch.revisionState.kind === 'accepted', 'Seed sketch should commit before authored restore setup.')

    const sketchSnapshot = await source.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(sketchSnapshot.snapshot)
    const firstFeature = await source.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committedSketch.revisionId,
      definition: createExtrudeDefinition(sketch, 5),
    })
    assert(firstFeature.revisionState.kind === 'accepted', 'First restore setup feature should commit.')

    const secondSketch = await source.commitSketch(createSketchCommitRequest(firstFeature.revisionId, {
      sketchLabel: 'Future Restore Sketch',
      definition: translateSeedDefinition(16, 0),
    }))
    assert(secondSketch.revisionState.kind === 'accepted', 'Future restore setup sketch should commit.')

    const secondFeature = await source.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: secondSketch.revisionId,
      definition: createExtrudeDefinition(sketch, 8),
    })
    assert(secondFeature.revisionState.kind === 'accepted', 'Second restore setup feature should commit.')

    const fullSnapshot = await source.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const authoredDocument = createAuthoredModelDocumentFromSnapshot(fullSnapshot.snapshot)

    async function restore(cursor: typeof authoredDocument.cursor) {
      const target = createAdapter()
      await target.restoreAuthoredModelDocument({
        ...authoredDocument,
        cursor,
      })

      return (await target.getDocumentSnapshot({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace',
      })).snapshot
    }

    const emptyCursorSnapshot = await restore({ kind: 'empty' })
    assert(emptyCursorSnapshot.cursor.kind === 'empty', 'Restored empty cursor should remain empty.')
    assert(
      emptyCursorSnapshot.features.map((feature) => feature.featureId).join('|') === `${firstFeature.featureId}|${secondFeature.featureId}`,
      'Empty cursor restore should retain future authored feature records.',
    )
    assert(
      emptyCursorSnapshot.sketches.some((entry) => entry.sketchId === secondSketch.sketchId),
      'Empty cursor restore should retain future authored sketch records.',
    )
    assert(emptyCursorSnapshot.bodies.length === 0, 'Empty cursor restore should not expose downstream feature bodies.')
    assert(
      !emptyCursorSnapshot.render.records.some((record) =>
        'sketchId' in record.binding.target && record.binding.target.sketchId === secondSketch.sketchId,
      ),
      'Empty cursor restore should not expose future sketch renderables.',
    )

    const firstFeatureOnlySnapshot = await restore({ kind: 'feature', featureId: firstFeature.featureId })
    assert(
      firstFeatureOnlySnapshot.sketches.some((entry) => entry.sketchId === secondSketch.sketchId),
      'Feature cursor restore should retain future sketch records after the cursor.',
    )
    assert(
      !firstFeatureOnlySnapshot.render.records.some((record) =>
        'sketchId' in record.binding.target && record.binding.target.sketchId === secondSketch.sketchId,
      ),
      'Feature cursor restore should hide future sketch renderables after the cursor.',
    )
    assert(
      !firstFeatureOnlySnapshot.entities.some((entity) => entity.ownerSketchId === secondSketch.sketchId),
      'Feature cursor restore should hide future sketch selection entities after the cursor.',
    )
    assert(
      !firstFeatureOnlySnapshot.objects.some((object) => object.ownerSketchId === secondSketch.sketchId),
      'Feature cursor restore should hide future sketch object rows after the cursor.',
    )

    const sketchCursorSnapshot = await restore({ kind: 'sketch', sketchId: sketch.sketchId })
    assert(sketchCursorSnapshot.cursor.kind === 'sketch', 'Restored sketch cursor should remain on the sketch.')
    assert(
      sketchCursorSnapshot.features.map((feature) => feature.featureId).join('|') === `${firstFeature.featureId}|${secondFeature.featureId}`,
      'Sketch cursor restore should retain future authored feature records.',
    )
    assert(sketchCursorSnapshot.bodies.length === 0, 'Sketch cursor restore should not expose feature bodies after that sketch.')

    const firstFeatureCursorSnapshot = await restore({ kind: 'feature', featureId: firstFeature.featureId })
    assert(firstFeatureCursorSnapshot.cursor.kind === 'feature', 'Restored feature cursor should remain on the feature.')
    assert(
      firstFeatureCursorSnapshot.features.map((feature) => feature.featureId).join('|') === `${firstFeature.featureId}|${secondFeature.featureId}`,
      'Feature cursor restore should retain future authored feature records.',
    )
    assert(
      firstFeatureCursorSnapshot.bodies.every((body) => body.ownerFeatureId !== secondFeature.featureId),
      'Feature cursor restore should not expose bodies produced by later features.',
    )
  }

  async function testRepairableFeatureUpdateClearsFeatureDiagnostics() {
    const adapter = createAdapter()
    const committedSketch = await commitSeedSketch(adapter)
    assert(committedSketch.revisionState.kind === 'accepted', 'Seed sketch should commit before repair setup.')

    const sketchSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(sketchSnapshot.snapshot)
    const broken = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committedSketch.revisionId,
      featureLabel: 'Repairable Profile',
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{
            kind: 'region',
            sketchId: 'sketch_deleted' as SketchId,
            regionId: 'region_deleted' as RegionId,
          }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 4 },
          operation: 'newBody',
          booleanScope: { kind: 'standalone' },
        },
      },
    })
    assert(
      broken.revisionState.kind === 'accepted' && broken.rebuildResult.kind === 'failed',
      'Repairable feature setup should commit with failed rebuild diagnostics.',
    )
    assert(
      broken.diagnostics.some((diagnostic) => diagnostic.featureId === broken.featureId),
      'Repairable feature setup should expose a feature-scoped diagnostic.',
    )

    const repaired = await adapter.updateFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: broken.revisionId,
      featureId: broken.featureId,
      featureLabel: 'Repairable Profile',
      definition: createExtrudeDefinition(sketch, 4),
    })
    const repairedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })

    assert(repaired.revisionState.kind === 'accepted', 'Repair update should be accepted.')
    assert(repaired.rebuildResult.kind === 'rebuilt', 'Repair update should produce a successful rebuild.')
    assert(
      !repaired.diagnostics.some((diagnostic) => diagnostic.featureId === broken.featureId)
        && !repairedSnapshot.snapshot.diagnostics.some((diagnostic) => diagnostic.featureId === broken.featureId),
      'Repair update should clear stale feature-scoped diagnostics from the result and snapshot.',
    )
  }

  async function testFailedBooleanBlocksLaterConsumersOfSameBody() {
    const adapter = createAdapter()
    const committedSketch = await commitSeedSketch(adapter)
    assert(committedSketch.revisionState.kind === 'accepted', 'Seed sketch should commit before dependency setup.')

    const sketchSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(sketchSnapshot.snapshot)
    const base = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committedSketch.revisionId,
      featureLabel: 'Base Body',
      definition: createExtrudeDefinition(sketch, 5),
    })
    const baseBodyTarget = base.changedTargets.find((target) => target.kind === 'body')
    assert(baseBodyTarget?.kind === 'body', 'Dependency setup should create a base body target.')

    const brokenCut = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: base.revisionId,
      featureLabel: 'Broken Cut',
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{
            kind: 'region',
            sketchId: 'sketch_deleted' as SketchId,
            regionId: 'region_deleted' as RegionId,
          }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 2 },
          operation: 'cut',
          booleanScope: { kind: 'targetBody', bodyId: baseBodyTarget.bodyId },
        },
      },
    })
    assert(
      brokenCut.revisionState.kind === 'accepted' && brokenCut.rebuildResult.kind === 'failed',
      'Broken boolean setup should remain repairable authored history.',
    )

    const blockedJoin = await adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: brokenCut.revisionId,
      featureLabel: 'Blocked Join',
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [sketch.sketch.regions[0]!.target],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 2 },
          operation: 'join',
          booleanScope: { kind: 'targetBody', bodyId: baseBodyTarget.bodyId },
        },
      },
    })

    assert(
      blockedJoin.revisionState.kind === 'accepted' && blockedJoin.rebuildResult.kind === 'failed',
      'Later consumers of a failed body-modifying feature should commit only as blocked authored history.',
    )
    assert(
      blockedJoin.diagnostics.some((diagnostic) =>
        diagnostic.featureId === blockedJoin.featureId && diagnostic.code === 'feature-dependency-blocked',
      ),
      'Later consumers of the same modified body should be marked dependency-blocked.',
    )
  }

  async function testAuthoredRestoreSkipsBrokenProjectionFeaturesBeforeLaterSketches() {
    const source = createAdapter()
    const committedSketch = await commitSeedSketch(source)
    assert(committedSketch.revisionState.kind === 'accepted', 'Seed sketch should commit before projection restore setup.')

    const secondSketch = await commitOffsetSketch(source, committedSketch.revisionId, {
      sketchLabel: 'Sketch After Broken Feature',
      offsetX: 8,
      offsetY: 0,
    })
    assert(secondSketch.revisionState.kind === 'accepted', 'Second sketch should commit before projection restore setup.')

    const sourceSnapshot = (await source.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    const authoredDocument = createAuthoredModelDocumentFromSnapshot(sourceSnapshot)
    const brokenFeatureId = 'feature_restore-broken-profile' as FeatureId
    const repositoryDocument: AuthoredModelDocument = {
      ...authoredDocument,
      features: [{
        featureId: brokenFeatureId,
        label: 'Restore Broken Profile',
        definition: {
          kind: 'extrude',
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            profiles: [{
              kind: 'region',
              sketchId: 'sketch_deleted' as SketchId,
              regionId: 'region_deleted' as RegionId,
            }],
            startExtent: { kind: 'profilePlane' },
            endExtent: { kind: 'blind', direction: 'positive', distance: 4 },
            operation: 'newBody',
            booleanScope: { kind: 'standalone' },
          },
        },
      }],
      featureOrder: [brokenFeatureId],
      historyOrder: [
        { kind: 'sketch', sketchId: committedSketch.sketchId },
        { kind: 'feature', featureId: brokenFeatureId },
        { kind: 'sketch', sketchId: secondSketch.sketchId },
      ],
      cursor: { kind: 'sketch', sketchId: secondSketch.sketchId },
    }
    const target = createAdapter()
    await target.restoreAuthoredModelDocument(repositoryDocument)
    const restored = (await target.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot

    assert(
      restored.sketches.some((sketch) => sketch.sketchId === secondSketch.sketchId),
      'Authored restore should keep later sketches after a repairable broken feature.',
    )
    assert(
      restored.diagnostics.some((diagnostic) => diagnostic.featureId === brokenFeatureId),
      'Authored restore should still report the broken feature after skipping it for projection context.',
    )
  }

  async function testAuthoredRestoreReportsPartialFeatureErrorsWithoutDroppingHistory() {
    const source = createAdapter()
    const committedSketch = await commitSeedSketch(source)
    assert(committedSketch.revisionState.kind === 'accepted', 'Seed sketch should commit before partial restore setup.')

    const sketchSnapshot = await source.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(sketchSnapshot.snapshot)
    const safeFeature = await source.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committedSketch.revisionId,
      definition: createExtrudeDefinition(sketch, 5),
      featureLabel: 'Safe Extrude',
    })
    assert(safeFeature.revisionState.kind === 'accepted', 'Safe restore setup feature should commit.')

    const safeSnapshot = await source.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const authoredDocument = createAuthoredModelDocumentFromSnapshot(safeSnapshot.snapshot)
    const profile = sketch.sketch.regions[0]?.target
    assert(profile, 'Partial restore setup needs a valid authored profile.')

    const brokenProfileFeatureId = 'feature_broken-profile' as FeatureId
    const brokenBooleanFeatureId = 'feature_broken-boolean' as FeatureId
    const dependentFeatureId = 'feature_blocked-dependent' as FeatureId
    const missingProfile = {
      kind: 'region' as const,
      sketchId: 'sketch_deleted' as SketchId,
      regionId: 'region_deleted' as RegionId,
    }
    const brokenProfileDefinition: FeatureDefinition = {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [missingProfile],
        startExtent: { kind: 'profilePlane' },
        endExtent: { kind: 'blind', direction: 'positive', distance: 4 },
        operation: 'newBody',
        booleanScope: { kind: 'standalone' },
      },
    }
    const brokenBooleanDefinition: FeatureDefinition = {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [profile],
        startExtent: { kind: 'profilePlane' },
        endExtent: { kind: 'blind', direction: 'positive', distance: 2 },
        operation: 'join',
        booleanScope: { kind: 'targetBody', bodyId: 'body_deleted_boolean' as BodyId },
      },
    }
    const blockedDependentDefinition: FeatureDefinition = {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [profile],
        startExtent: { kind: 'profilePlane' },
        endExtent: { kind: 'blind', direction: 'positive', distance: 2 },
        operation: 'join',
        booleanScope: { kind: 'targetBody', bodyId: `body_${brokenProfileFeatureId}` as BodyId },
      },
    }
    const repositoryDocument: AuthoredModelDocument = {
      ...authoredDocument,
      features: [
        ...authoredDocument.features,
        {
          featureId: brokenProfileFeatureId,
          label: 'Broken Profile',
          definition: brokenProfileDefinition,
        },
        {
          featureId: brokenBooleanFeatureId,
          label: 'Broken Boolean',
          definition: brokenBooleanDefinition,
        },
        {
          featureId: dependentFeatureId,
          label: 'Blocked Join',
          definition: blockedDependentDefinition,
        },
      ],
      featureOrder: [
        ...authoredDocument.featureOrder,
        brokenProfileFeatureId,
        brokenBooleanFeatureId,
        dependentFeatureId,
      ],
      historyOrder: [
        ...(authoredDocument.historyOrder ?? []),
        { kind: 'feature', featureId: brokenProfileFeatureId },
        { kind: 'feature', featureId: brokenBooleanFeatureId },
        { kind: 'feature', featureId: dependentFeatureId },
      ],
      cursor: { kind: 'feature', featureId: dependentFeatureId },
    }
    const target = createAdapter()
    await target.restoreAuthoredModelDocument(repositoryDocument)
    const restored = (await target.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    const diagnosticsByFeatureId = new Map(
      restored.diagnostics
        .filter((diagnostic) => diagnostic.featureId)
        .map((diagnostic) => [diagnostic.featureId, diagnostic]),
    )
    const brokenProfileDiagnostic = diagnosticsByFeatureId.get(brokenProfileFeatureId)
    const brokenBooleanDiagnostic = diagnosticsByFeatureId.get(brokenBooleanFeatureId)
    const blockedDiagnostic = diagnosticsByFeatureId.get(dependentFeatureId)

    assert(
      restored.features.map((feature) => feature.featureId).join('|')
        === repositoryDocument.featureOrder.join('|'),
      'Partial restore should retain the complete authored feature history.',
    )
    assert(
      restored.render.records.some((record) => record.ownerFeatureId === safeFeature.featureId),
      'Partial restore should render safely evaluable earlier features.',
    )
    assert(
      restored.render.records.every((record) =>
        record.ownerFeatureId !== brokenProfileFeatureId
        && record.ownerFeatureId !== brokenBooleanFeatureId
        && record.ownerFeatureId !== dependentFeatureId,
      ),
      'Partial restore should not fabricate render records for failed or blocked features.',
    )
    assert(
      brokenProfileDiagnostic?.fieldId === 'profiles'
        && brokenBooleanDiagnostic?.fieldId === 'booleanScope',
      'Independent broken features should report separate authored fields in one pass.',
    )
    assert(
      blockedDiagnostic?.code === 'feature-dependency-blocked',
      'Features consuming a failed feature result should be reported as dependency-blocked.',
    )
    assert(
      brokenProfileDiagnostic?.detail?.kind === 'invalidReference'
        && brokenProfileDiagnostic.detail.reference.target.kind === 'region'
        && brokenProfileDiagnostic.detail.reference.target.regionId === 'region_deleted',
      'Raw invalid durable ids should remain structured debug context after restore.',
    )
    assert(
      !restored.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('region_deleted')
        || diagnostic.repairGuidance?.includes('region_deleted')
        || diagnostic.message.includes(brokenProfileFeatureId)
        || diagnostic.repairGuidance?.includes(brokenProfileFeatureId),
      ),
      'Partial restore user-facing diagnostics should avoid raw durable ids.',
    )
  }

  async function testOperationHistoryReplayKeepsPartialFeatureFailuresRepairable() {
    const store = createMemoryOperationHistoryStore()
    const service = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: store,
    })
    const initial = await service.getCurrentDocumentSnapshot()
    const sketch = await unwrapModelingResult(service.commitSketch(
      createServiceSketchCommitInput(createSketchCommitRequest(initial.revisionId)),
    ))
    assert(sketch.revisionState.kind === 'accepted', 'Replay setup sketch should commit.')

    const sketchSnapshot = await service.getCurrentDocumentSnapshot()
    const primarySketch = requirePrimarySketch(sketchSnapshot)
    const safeFeature = await unwrapModelingResult(service.createFeature({
      baseRevisionId: sketch.revisionId,
      definition: createExtrudeDefinition(primarySketch, 5),
      featureLabel: 'Replay Safe Extrude',
    }))
    assert(safeFeature.revisionState.kind === 'accepted', 'Replay setup safe feature should commit.')

    const profile = primarySketch.sketch.regions[0]?.target
    assert(profile, 'Replay setup needs a valid profile.')

    const brokenProfileFeature = await unwrapModelingResult(service.createFeature({
      baseRevisionId: safeFeature.revisionId,
      featureLabel: 'Replay Broken Profile',
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{
            kind: 'region',
            sketchId: 'sketch_deleted' as SketchId,
            regionId: 'region_deleted' as RegionId,
          }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 4 },
          operation: 'newBody',
          booleanScope: { kind: 'standalone' },
        },
      },
    }))
    assert(
      brokenProfileFeature.revisionState.kind === 'accepted'
        && brokenProfileFeature.rebuildResult.kind === 'failed',
      'Repairable replay setup feature errors should still commit authored history.',
    )

    const brokenBooleanFeature = await unwrapModelingResult(service.createFeature({
      baseRevisionId: brokenProfileFeature.revisionId,
      featureLabel: 'Replay Broken Boolean',
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [profile],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 2 },
          operation: 'join',
          booleanScope: { kind: 'targetBody', bodyId: 'body_deleted_boolean' as BodyId },
        },
      },
    }))
    assert(brokenBooleanFeature.revisionState.kind === 'accepted', 'Second independent repairable feature error should commit.')

    const blockedFeature = await unwrapModelingResult(service.createFeature({
      baseRevisionId: brokenBooleanFeature.revisionId,
      featureLabel: 'Replay Blocked Join',
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [profile],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 2 },
          operation: 'join',
          booleanScope: { kind: 'targetBody', bodyId: `body_${brokenProfileFeature.featureId}` as BodyId },
        },
      },
    }))
    assert(blockedFeature.revisionState.kind === 'accepted', 'Dependent blocked feature should commit authored history.')

    const finalHistory = store.savedPayloads.at(-1)
    assert(finalHistory, 'Partial feature commits should persist operation history.')

    const replayedService = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(finalHistory),
    })
    const restoreState = await replayedService.getHistoryRestoreState()
    const restoredSnapshot = await replayedService.getCurrentDocumentSnapshot()
    const diagnosticsByFeatureId = new Map(
      restoredSnapshot.diagnostics
        .filter((diagnostic) => diagnostic.featureId)
        .map((diagnostic) => [diagnostic.featureId, diagnostic]),
    )

    assert(restoreState.kind === 'restored', 'Operation history with repairable feature errors should replay.')
    assert(restoreState.entriesReplayed === finalHistory.entries.length, 'Replay should preserve every authored operation entry.')
    assert(
      restoredSnapshot.features.map((feature) => feature.label).join('|')
        === 'Replay Safe Extrude|Replay Broken Profile|Replay Broken Boolean|Replay Blocked Join',
      'Replay should preserve full authored feature history including failed and blocked features.',
    )
    assert(
      restoredSnapshot.render.records.some((record) => record.ownerFeatureId === safeFeature.featureId),
      'Replay should keep render records for safely rebuilt features.',
    )
    assert(
      diagnosticsByFeatureId.get(brokenProfileFeature.featureId)?.fieldId === 'profiles'
        && diagnosticsByFeatureId.get(brokenBooleanFeature.featureId)?.fieldId === 'booleanScope'
        && diagnosticsByFeatureId.get(blockedFeature.featureId)?.code === 'feature-dependency-blocked',
      'Replay should report multiple independent feature errors plus dependent blocked features.',
    )
  }

  async function testPendingRepositoryFallbackTailRestoresOnlyWithRepositoryBasisAfterSketchRecreation() {
    const store = createMemoryOperationHistoryStore()
    const documentRepository = createMemoryDocumentRepository()
    const mutate = documentRepository.mutate.bind(documentRepository)
    let mutateCount = 0
    let releaseBlockedWrites = () => {}
    const blockedWrites = new Promise<void>((resolve) => {
      releaseBlockedWrites = resolve
    })
    documentRepository.mutate = async (input) => {
      mutateCount += 1
      if (mutateCount >= 3) {
        await blockedWrites
      }

      return mutate(input)
    }

    async function waitFor(condition: () => boolean, message: string) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (condition()) {
          return
        }
        await Promise.resolve()
      }

      throw new Error(message)
    }

    const service = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: store,
      documentRepository,
      documentRepositoryPersistence: 'background',
    })
    const initial = await service.getCurrentDocumentSnapshot()
    const initialSketchRequest = createSketchCommitRequest(initial.revisionId)
    const committedSketch = await unwrapModelingResult(service.commitSketch(
      createServiceSketchCommitInput(initialSketchRequest),
    ))
    assert(committedSketch.revisionState.kind === 'accepted', 'Initial replay sketch should commit.')
    await waitFor(
      () => {
        const loaded = store.load()
        return documentRepository.savedDocuments.length === 1 && loaded.ok && loaded.payload === null
      },
      'Initial sketch repository write should clear the fallback history before the bug setup continues.',
    )

    const sketchSnapshot = await service.getCurrentDocumentSnapshot()
    const profileSketch = requirePrimarySketch(sketchSnapshot)
    const extrude = await unwrapModelingResult(service.createFeature({
      baseRevisionId: sketchSnapshot.revisionId,
      featureLabel: 'Replay Extrude After Deleted Sketch',
      definition: createExtrudeDefinition(profileSketch, 5),
    }))
    assert(extrude.revisionState.kind === 'accepted', 'Extrude should commit before deleting its sketch.')
    await waitFor(
      () => {
        const loaded = store.load()
        return documentRepository.savedDocuments.length === 2 && loaded.ok && loaded.payload === null
      },
      'Extrude repository write should clear the fallback history before the bug setup continues.',
    )

    const deletedSketch = await unwrapModelingResult(service.deleteTarget({
      baseRevisionId: extrude.revisionId,
      target: { kind: 'sketch', sketchId: committedSketch.sketchId },
    }))
    assert(
      deletedSketch.revisionState.kind === 'accepted' && deletedSketch.rebuildResult.kind === 'failed',
      'Deleting a sketch consumed by an extrude should keep the authored edit but report the expected rebuild error.',
    )

    const rollbackBeforeExtrude = await unwrapModelingResult(service.setFeatureCursor({
      baseRevisionId: deletedSketch.revisionId,
      cursor: { kind: 'empty' },
    }))
    assert(rollbackBeforeExtrude.revisionState.kind === 'accepted', 'Cursor should roll before the broken extrude.')

    const replacementSketchRequest = createSketchCommitRequest(rollbackBeforeExtrude.revisionId, {
      sketchLabel: 'Replay Replacement Sketch',
      definition: translateSeedDefinition(12, 0),
    })
    const replacementSketch = await unwrapModelingResult(service.commitSketch(
      createServiceSketchCommitInput(replacementSketchRequest),
    ))
    assert(replacementSketch.revisionState.kind === 'accepted', 'Replacement sketch should commit before the extrude.')

    const pendingHistory = store.load()
    assert(
      pendingHistory.ok
        && pendingHistory.payload
        && pendingHistory.payload.entries.map((entry) => entry.kind).join('|') === 'deleteTarget|setFeatureCursor|commitSketch',
      'Recreated-sketch setup should leave a repository fallback tail starting with the sketch deletion.',
    )
    const fallbackTail = structuredClone(pendingHistory.payload)
    const prefixDocument = documentRepository.savedDocuments.at(-1)
    assert(prefixDocument, 'Repository should contain the persisted sketch/extrude prefix.')
    releaseBlockedWrites()

    const impossibleOrderService = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository: createMemoryDocumentRepository([{
        ...prefixDocument,
        historyOrder: [
          { kind: 'feature', featureId: extrude.featureId },
          { kind: 'sketch', sketchId: committedSketch.sketchId },
        ],
        cursor: { kind: 'sketch', sketchId: committedSketch.sketchId },
      }]),
    })
    const impossibleOrderSnapshot = await impossibleOrderService.getCurrentDocumentSnapshot()
    assert(
      impossibleOrderSnapshot.diagnostics.some((diagnostic) => diagnostic.code === 'occ-document-history-dependency-order'),
      'Restored documents must report impossible feature-before-sketch dependency order.',
    )
    assert(
      !impossibleOrderSnapshot.render.records.some((record) => record.ownerFeatureId === extrude.featureId),
      'Restored impossible dependency order must not render the feature as valid geometry.',
    )

    const orphanedExtrudeDocument = {
      ...prefixDocument,
      sketches: prefixDocument.sketches.filter((sketch) => sketch.sketchId !== committedSketch.sketchId),
      historyOrder: prefixDocument.historyOrder.filter((item) =>
        item.kind !== 'sketch' || item.sketchId !== committedSketch.sketchId,
      ),
      cursor: { kind: 'empty' as const },
    }
    const repairMissingSketchTail = {
      ...createEmptyOperationHistory('doc_workspace' as DocumentId, ['stale-repository-head']),
      entries: [{
        kind: 'commitSketch' as const,
        payload: {
          sketchId: committedSketch.sketchId,
          sketchLabel: initialSketchRequest.sketchLabel,
          plane: initialSketchRequest.plane,
          planeTarget: initialSketchRequest.planeTarget,
          planeKey: initialSketchRequest.planeKey,
          definition: initialSketchRequest.definition,
        },
      }],
    }
    const restoredWithRepairableStaleHead = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(repairMissingSketchTail),
      documentRepository: createMemoryDocumentRepository([orphanedExtrudeDocument]),
    })
    const repairableStaleHeadState = await restoredWithRepairableStaleHead.getHistoryRestoreState()
    const repairableStaleHeadSnapshot = await restoredWithRepairableStaleHead.getCurrentDocumentSnapshot()

    assert(
      repairableStaleHeadState.kind === 'restored'
        && repairableStaleHeadState.entriesReplayed === repairMissingSketchTail.entries.length,
      'Fallback tails should repair restored repository documents missing sketch dependencies even when repository heads diverged.',
    )
    assert(
      repairableStaleHeadSnapshot.presentation.documentHistory.map((item) =>
        item.kind === 'sketch' ? item.sketchId : item.featureId,
      ).join('|') === `${committedSketch.sketchId}|${extrude.featureId}`,
      'Repair replay should restore the missing sketch before the extrude that consumes it.',
    )

    const restoredWithRepository = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(fallbackTail),
      documentRepository: createMemoryDocumentRepository([prefixDocument]),
    })
    const repositoryRestoreState = await restoredWithRepository.getHistoryRestoreState()
    const repositoryRestoredSnapshot = await restoredWithRepository.getCurrentDocumentSnapshot()

    assert(
      repositoryRestoreState.kind === 'restored'
        && repositoryRestoreState.entriesReplayed === fallbackTail.entries.length,
      'Repository-relative fallback tails should replay over their matching repository basis.',
    )
    assert(
      repositoryRestoredSnapshot.sketches.some((sketch) =>
        sketch.sketchId === replacementSketch.sketchId && sketch.label === 'Replay Replacement Sketch',
      ),
      'Replay should preserve the replacement sketch inserted before the extrude.',
    )
    assert(
      repositoryRestoredSnapshot.features.some((feature) => feature.featureId === extrude.featureId),
      'Replay should preserve the extrude after its consumed sketch is recreated before it.',
    )
    assert(
      repositoryRestoredSnapshot.presentation.documentHistory.map((item) =>
        item.kind === 'sketch' ? item.sketchId : item.featureId,
      ).join('|') === `${replacementSketch.sketchId}|${extrude.featureId}`,
      `Replay should restore the replacement sketch before the extrude that consumes it. Actual order: ${
        repositoryRestoredSnapshot.presentation.documentHistory.map((item) =>
          item.kind === 'sketch' ? item.sketchId : item.featureId,
        ).join('|')
      }; replacement sketch: ${replacementSketch.sketchId}.`,
    )
    assert(
      !repositoryRestoredSnapshot.diagnostics.some((diagnostic) => diagnostic.code === 'occ-document-history-dependency-order'),
      'A correctly ordered replacement sketch should not report document-history dependency diagnostics.',
    )

    const restoredWithoutRepository = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(fallbackTail),
    })
    const compatibilityRestoreState = await restoredWithoutRepository.getHistoryRestoreState()

    assert(
      compatibilityRestoreState.kind === 'empty' && compatibilityRestoreState.entriesReplayed === 0,
      'Repository-relative fallback tails should not replay against an empty compatibility-history seed.',
    )
  }

  async function testAuthoredRestoreProjectsSketchReferencesAgainstPriorFeatures() {
    const createReferenceSolver = () =>
      new SketchConstraintSolverAdapter({
        documentId: 'doc_workspace' as DocumentId,
        revisionId: null,
      })
    const source = createAdapter(createReferenceSolver)
    const committedSketch = await commitSeedSketch(source)
    assert(committedSketch.revisionState.kind === 'accepted', 'Seed sketch should commit before referenced restore setup.')

    const sketchSnapshot = await source.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const sketch = requirePrimarySketch(sketchSnapshot.snapshot)
    const feature = await source.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
      baseRevisionId: committedSketch.revisionId,
      definition: createExtrudeDefinition(sketch, 5),
    })
    assert(feature.revisionState.kind === 'accepted', 'Referenced restore setup feature should commit.')

    const featureSnapshot = await source.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const body = featureSnapshot.snapshot.bodies.find((entry) => entry.bodyId === 'body_feature_extrude-1')
    const vertexId = body?.topology.vertexIds[0]
    assert(vertexId, 'Committed extrude body should expose a durable vertex for sketch projection.')

    const sketchId = 'sketch_2' as SketchId
    const referenceId = 'ref_restore_vertex_center' as ReferenceId
    const centerPointId = 'sketch_point_restore_circle_center' as SketchPointId
    const circleEntityId = 'sketch_entity_restore_circle' as SketchEntityId
    const constraintId = 'constraint_restore_circle_center_projected_vertex' as ConstraintId
    const circleSketch = await source.commitSketch(createSketchCommitRequest(featureSnapshot.snapshot.revisionId, {
      sketchLabel: 'RestoreVertexCenterCircle',
      definition: {
        schemaVersion: 'sketch-definition/v1alpha1',
        referenceIds: [referenceId],
        references: [{
          referenceId,
          kind: 'modelReference',
          label: 'Referenced solid vertex',
          source: {
            kind: 'vertex',
            bodyId: 'body_feature_extrude-1' as BodyId,
            vertexId: vertexId as VertexId,
          },
          projectionMode: 'projectAlongPlaneNormal',
        }],
        pointIds: [centerPointId],
        points: [{
          pointId: centerPointId,
          label: 'Circle center',
          target: { kind: 'sketchPoint', sketchId, pointId: centerPointId },
          position: [0, 0],
          isConstruction: false,
        }],
        entityIds: [circleEntityId],
        entities: [{
          kind: 'circle',
          entityId: circleEntityId,
          label: 'Circle',
          target: { kind: 'sketchEntity', sketchId, entityId: circleEntityId },
          isConstruction: false,
          centerPointId,
          radius: 2,
        }],
        constraintIds: [constraintId],
        constraints: [{
          constraintId,
          kind: 'coincidentProjectedPoint',
          label: 'Circle center on vertex',
          point: { kind: 'localPoint', pointId: centerPointId },
          projectedPoint: {
            kind: 'projectedGeometry',
            reference: {
              kind: 'projectedPoint',
              referenceId,
              geometryId: `projected_geometry_${referenceId}_point` as ProjectedGeometryId,
            },
          },
        }],
        dimensionIds: [],
        dimensions: [],
      },
    }))
    assert(circleSketch.revisionState.kind === 'accepted', 'Referenced circle sketch should commit before authored restore.')

    const sourceSnapshot = await source.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })
    const target = createAdapter(createReferenceSolver)
    await target.restoreAuthoredModelDocument(createAuthoredModelDocumentFromSnapshot(sourceSnapshot.snapshot))
    const restored = (await target.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    const restoredSketch = restored.sketches.find((entry) => entry.sketchId === circleSketch.sketchId)
    const restoredProjection = restoredSketch?.sketch.projectedReferences?.find((entry) => entry.referenceId === referenceId)
    const restoredConstraint = restoredSketch?.sketch.solvedSnapshot.constraintStatuses.find((entry) => entry.constraintId === constraintId)

    assert(restoredSketch, 'Authored restore should keep the sketch that references a prior solid vertex.')
    assert(restoredProjection?.status === 'projected', 'Authored restore should project the solid vertex from prior feature context.')
    assert(restoredConstraint?.status === 'satisfied', 'Restored circle center constraint should remain solved against the projected vertex.')
  }

  async function testRepositoryRestoreConsumesWorkerNormalizedCollaborativeAuthoredDocumentBeforeOccRestore() {
    const seedSnapshot = (await createAdapter().getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    const authoredDocument = createAuthoredModelDocumentFromSnapshot(seedSnapshot)
    const invalidReferenceDefinition: FeatureDefinition = {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{ kind: 'region', sketchId: 'sketch_deleted', regionId: 'region_deleted' }],
        startExtent: { kind: 'profilePlane' },
        endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
        operation: 'newBody',
        booleanScope: { kind: 'standalone' },
      },
    }
    const repositoryDocument: AuthoredModelDocument = {
      ...authoredDocument,
      features: [{
        featureId: 'feature_invalid-ref' as AuthoredModelDocument['features'][number]['featureId'],
        label: 'Invalid Ref',
        definition: invalidReferenceDefinition,
      }],
      featureOrder: [
        'feature_missing' as AuthoredModelDocument['featureOrder'][number],
        'feature_invalid-ref' as AuthoredModelDocument['featureOrder'][number],
      ],
      cursor: {
        kind: 'feature',
        featureId: 'feature_deleted' as AuthoredModelDocument['features'][number]['featureId'],
      },
    }
    const normalizedRepositoryDocument = normalizeCollaborativeAuthoredModelDocument(repositoryDocument)
    const service = createModelingService(createAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository: createPermissiveRestoredRepository(
        normalizedRepositoryDocument.document,
        normalizedRepositoryDocument.diagnostics,
      ),
    })

    const restoreState = await service.getHistoryRestoreState()
    const snapshot = await service.getCurrentDocumentSnapshot()

    assert(restoreState.kind === 'restored', 'Collaborative repository documents should restore through the OCC adapter.')
    assert(snapshot.cursor.kind === 'empty', 'Missing repository cursors should normalize before OCC restore.')
    assert(
      snapshot.diagnostics.some((diagnostic) => diagnostic.code === COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.missingCursorTarget),
      'Missing cursor targets should surface as stable OCC snapshot diagnostics.',
    )
    assert(
      snapshot.diagnostics.some((diagnostic) => diagnostic.code === COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.invalidFeatureOrder),
      'Invalid merged feature order should surface as stable OCC snapshot diagnostics.',
    )
    assert(
      snapshot.diagnostics.some((diagnostic) => diagnostic.code === COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.invalidDurableReference),
      'Invalid durable references should surface as stable OCC snapshot diagnostics.',
    )
  }

  await testSnapshotFetchAndSketchCommit()
  await testPlaneFeatureCreateSupportsConstructionAndPlanarFaceReferences()
  await testExtrudePreviewCreateAndUpdateCommitGeometry()
  await testRevolvePreviewCreateAndConstructionAxisRejection()
  await testRepositoryRestorePreservesRolledBackFutureRevolve()
  await testSweepPreviewCreateAndUnsupportedCases()
  await testLoftPreviewCreateAndUnsupportedCases()
  await testFilletCreateAndUpdateMutateBodyTopology()
  await testChamferPreviewCreateAndUnsupportedCases()
  await testChamferCreateKeepsHistoricalInvalidationsOutOfDocumentDiagnostics()
  await testShellPreviewCreateUpdateAndSnapshotRoundTrip()
  await testThickenPreviewCreateAndUnsupportedCases()
  await testSplitPreviewCreateAndUnsupportedCases()
  await testCombinePreviewCreateReplayAndValidation()
  await testDeleteSolidPreviewCreateAndReferenceInvalidation()
  await testMirrorPreviewCreateAndCopyBodies()
  await testTransformPreviewCreateAndReplaceBody()
  await testDeleteFeatureRebuildsSnapshotAndResolveReferenceInvalidatesMissingRefs()
  await testReorderFeatureAndConflictHandling()
  await testDocumentHistoryReorderRejectsFeatureBeforeSketchDependency()
  await testPreviewFreshness()
  await testConstructionPlaneSnapshotsSurfaceTheDocumentedGap()
  await testCommitSketchRejectsUnknownExplicitSketchId()
  await testProjectedGeometryRegionLoopsRejectAsUnsupported()
  await testDownstreamInvalidReferencesRejectWithStructuredDiagnostics()
  await testMultiBodyBooleanPolicyJoinUsesFirstTargetIdentity()
  await testMultiBodyBooleanPolicyUsesPerTargetCutBehavior()
  await testMultiBodyBooleanPolicyIntersectDropsEmptyTargets()
  await testUnknownPrefixedRebuildErrorsFallbackToOccRebuildFailure()
  await testProfileCollectionAdapterDiagnostics()
  await testRestoredYzMultiProfileExtrudePreservesBodiesAndRegions()
  await testRestoredOverlappingRectangleCircleSketchKeepsRegionsRenderable()
  await testDocumentVariableExpressionsValidateBeforeOccMutation()
  await testAuthoredRestoreAppliesOnlyFeaturesThroughCursor()
  await testRepairableFeatureUpdateClearsFeatureDiagnostics()
  await testFailedBooleanBlocksLaterConsumersOfSameBody()
  await testAuthoredRestoreSkipsBrokenProjectionFeaturesBeforeLaterSketches()
  await testAuthoredRestoreReportsPartialFeatureErrorsWithoutDroppingHistory()
  await testOperationHistoryReplayKeepsPartialFeatureFailuresRepairable()
  await testPendingRepositoryFallbackTailRestoresOnlyWithRepositoryBasisAfterSketchRecreation()
  await testAuthoredRestoreProjectsSketchReferencesAgainstPriorFeatures()
  await testRepositoryRestoreConsumesWorkerNormalizedCollaborativeAuthoredDocumentBeforeOccRestore()
  await testOccGeometryExportsProduceRealPayloads()
  await testStepImportRestoresExactBodiesFromAssetBytes()
  await testStepFileImportServiceRefreshExposesNativeRenderRecords()
  await testPreparedStepImportShowsFacetedPresentationWhileBackgroundMaterializationIsPending()
  await testPreparedStepImportReportsTimeoutWhileKeepingFacetedPresentationVisible()
  await testMeshImportRestoresBakedBodiesFromGeneratedAssetBytes()
  await testCylinderMeshImportRecordsUnifiedSurfaceDiagnostics()
  await testFacetedMeshImportUsesBakedAssetRenderMesh()
  await testStlAndThreeMfExportImportPreservesVolume()
  await testStlAndThreeMfCurvedExportImportTracksTessellatedVolume()
  await testStepExportImportPreservesComplexFilletedChamferedVolume()
  await testStepImportReportsCorruptBrepData()
  await testStepImportReportsUnsupportedStepFiles()
  await testStepImportTransfersAssemblyRootWhenAggregateCountIsZero()
  await testStepImportRestoresMultipleSupportedSolids()
  await testStepImportReviewKeepsEmbeddedSolidsWithMissingReferences()
  await testStepImportRestoresSelectedSolidSubset()
  await testStepImportReportsStaleSelectedSolidKey()
  await testOccGeometryExportsRejectInvalidTargets()

  console.log('OCC phase 8 adapter tests passed.')
}, 120000)
