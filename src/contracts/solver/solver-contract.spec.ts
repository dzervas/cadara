import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import {
  SOLVER_SCHEMA_VERSION,
  type ProjectSketchExternalReferencesRequest,
  type ResolveSketchReferenceRequest,
  type SolveSketchRequest,
  type StartInteractiveSketchSolveSessionRequest,
  type ValidateSketchRequest,
} from './schema'
import {
  disposeInteractiveSketchSolveSessionRequestSchema,
  finalizeInteractiveSketchSolveSessionRequestSchema,
  solveSketchRequestSchema,
  startInteractiveSketchSolveSessionRequestSchema,
  updateInteractiveSketchSolveSessionRequestSchema,
} from './runtime-schema'
import {
  DEFAULT_MOCK_SKETCH_PLANE_FRAME,
  DEFAULT_MOCK_SOLVER_TOLERANCES,
  MockSketchSolverAdapter,
} from '@/domain/solver/mock-sketch-solver-adapter'
import { SketchConstraintSolverAdapter } from '@/domain/solver/sketch-constraint-solver-adapter'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import type { SketchDefinition } from '@/contracts/sketch/schema'

test('src/contracts/solver/solver-contract.spec.ts', async () => {  const sketchDefinition: SketchDefinition = {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: ['ref_model_edge_1'],
    references: [
      {
        referenceId: 'ref_model_edge_1',
        kind: 'modelReference',
        label: 'Seed edge',
        source: { kind: 'edge', bodyId: 'body_seed', edgeId: 'edge_seed_1' },
        projectionMode: 'projectAlongPlaneNormal',
      },
    ],
    pointIds: [
      'sketch_point_a',
      'sketch_point_b',
      'sketch_point_c',
      'sketch_point_d',
    ],
    points: [
      {
        pointId: 'sketch_point_a',
        label: 'A',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_a' },
        position: [-2, -1],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_b',
        label: 'B',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_b' },
        position: [2, -1],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_c',
        label: 'C',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_c' },
        position: [2, 1],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_d',
        label: 'D',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_d' },
        position: [-2, 1],
        isConstruction: false,
      },
    ],
    entityIds: [
      'sketch_entity_bottom',
      'sketch_entity_right',
      'sketch_entity_top',
      'sketch_entity_left',
    ],
    entities: [
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_bottom',
        label: 'Bottom',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_bottom' },
        isConstruction: false,
        startPointId: 'sketch_point_a',
        endPointId: 'sketch_point_b',
      },
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_right',
        label: 'Right',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_right' },
        isConstruction: false,
        startPointId: 'sketch_point_b',
        endPointId: 'sketch_point_c',
      },
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_top',
        label: 'Top',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_top' },
        isConstruction: false,
        startPointId: 'sketch_point_c',
        endPointId: 'sketch_point_d',
      },
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_left',
        label: 'Left',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_left' },
        isConstruction: false,
        startPointId: 'sketch_point_d',
        endPointId: 'sketch_point_a',
      },
    ],
    constraintIds: ['constraint_bottom_horizontal'],
    constraints: [
      {
        constraintId: 'constraint_bottom_horizontal',
        kind: 'horizontal',
        label: 'Bottom horizontal',
        entityId: 'sketch_entity_bottom',
      },
    ],
    dimensionIds: ['dimension_width'],
    dimensions: [
      {
        dimensionId: 'dimension_width',
        kind: 'distance',
        label: 'Width',
        axis: 'horizontal',
        pointIds: ['sketch_point_a', 'sketch_point_b'],
        value: 4,
      },
    ],
  }

  function createProjectRequest(): ProjectSketchExternalReferencesRequest {
    return {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: 'request_project_1',
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      plane: DEFAULT_MOCK_SKETCH_PLANE_FRAME,
      tolerances: DEFAULT_MOCK_SOLVER_TOLERANCES,
      references: sketchDefinition.references.map((reference) => ({
        referenceId: reference.referenceId,
        reference,
      })),
    }
  }

  function createValidateRequest(): ValidateSketchRequest {
    return {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: 'request_validate_1',
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      plane: DEFAULT_MOCK_SKETCH_PLANE_FRAME,
      tolerances: DEFAULT_MOCK_SOLVER_TOLERANCES,
      definition: sketchDefinition,
      projectedReferences: [],
    }
  }

  function createSolveRequest(projectedReferences: Awaited<ReturnType<SketchConstraintSolverAdapter['projectExternalReferences']>>['projectedReferences']): SolveSketchRequest {
    return {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: 'request_solve_1',
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      plane: DEFAULT_MOCK_SKETCH_PLANE_FRAME,
      tolerances: DEFAULT_MOCK_SOLVER_TOLERANCES,
      partialSolvePolicy: 'bestEffort',
      definition: sketchDefinition,
      projectedReferences,
    }
  }

  async function testProjectionAndSolveFlow() {
    const adapter = new SketchConstraintSolverAdapter()
    const projection = await adapter.projectExternalReferences(createProjectRequest())

    expectTrue(projection.requestId === 'request_project_1', 'Projection must echo the originating request ID.')
    expectTrue(projection.projectedReferences.length === sketchDefinition.references.length, 'Projection should return one record per authored external reference.')
    expectTrue(
      projection.projectedReferences.every((reference) =>
        reference.status === 'unsupportedSource'
        && reference.geometry.length === 0
        && reference.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-model-reference-source'),
      ),
      'Projection must report unresolved model sources as unsupported instead of fabricating geometry.',
    )

    const validation = await adapter.validateSketch({
      ...createValidateRequest(),
      projectedReferences: projection.projectedReferences,
    })
    expectTrue(validation.isValid, 'Well-formed sketch definition should validate successfully.')

    const solved = await adapter.solveSketch(createSolveRequest(projection.projectedReferences))
    expectTrue(
      solved.status.solveState === 'solved' && solved.status.constraintState === 'wellConstrained',
      'Solve should return a machine-readable solved and constrained status.',
    )
    expectTrue(solved.solvedSnapshot.solvedEntities.length === 4, 'Solve should return solved entity geometry.')
    expectTrue(!solved.regionResult, 'Normal solve responses should not derive regions unless the caller requests them.')
    expectTrue(solveSketchRequestSchema.safeParse(createSolveRequest(projection.projectedReferences)).success, 'Solve request runtime schema should accept solve-without-regions requests.')

    const solvedWithRegions = await adapter.solveSketch({
      ...createSolveRequest(projection.projectedReferences),
      requestId: 'request_solve_with_regions_1',
      includeRegions: true,
    })
    expectTrue(solvedWithRegions.regionResult?.regions.length === 1, 'Caller-selected solve region extraction should return regions explicitly.')
    expectTrue(
      solvedWithRegions.diagnostics.length === solved.diagnostics.length,
      'Caller-selected region extraction diagnostics should stay scoped to the region result.',
    )

    const regions = await adapter.deriveSketchRegions({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: 'request_regions_1',
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition: sketchDefinition,
      solvedSnapshot: solved.solvedSnapshot,
      projectedReferences: projection.projectedReferences,
    })

    expectTrue(regions.regions.length === 1, 'Region derivation should return an explicit derived region.')

    const resolutionRequest: ResolveSketchReferenceRequest = {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: 'request_resolve_1',
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      target: { kind: 'region', sketchId: 'sketch_primary', regionId: regions.regions[0]!.regionId },
      definition: sketchDefinition,
      solvedSnapshot: solved.solvedSnapshot,
      regions: regions.regions,
    }

    const resolution = await adapter.resolveSketchReference(resolutionRequest)
    expectTrue('kind' in resolution.resolution.target && resolution.resolution.target.kind === 'region', 'Solver reference resolution should be explicit for derived regions.')
    expectTrue(resolution.resolution.isValid, 'Derived regions returned by the solver should resolve as valid.')

    const projectedResolution = await adapter.resolveSketchReference({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: 'request_resolve_projected_1',
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      target: {
        referenceId: 'ref_model_edge_1',
        geometryId: 'projected_geometry_ref_model_edge_1_0',
      },
      definition: sketchDefinition,
      solvedSnapshot: solved.solvedSnapshot,
      regions: regions.regions,
    })

    expectTrue(
      'geometryId' in projectedResolution.resolution.target,
      'Projected-geometry resolution should preserve the explicit projected target.',
    )
    expectTrue(
      projectedResolution.resolution.isValid,
      'Projected geometry targets should resolve when their authored reference still exists.',
    )
  }

  async function testInteractiveSolveLifecycleIsExplicit() {
    const adapter = new SketchConstraintSolverAdapter({ revisionId: null })
    const projection = await adapter.projectExternalReferences(createProjectRequest())
    const solved = await adapter.solveSketch(createSolveRequest(projection.projectedReferences))
    const startRequest: StartInteractiveSketchSolveSessionRequest = {
      ...createSolveRequest(projection.projectedReferences),
      requestId: 'request_interactive_start_1',
      priorSolvedSnapshot: solved.solvedSnapshot,
    }
    const startParse = startInteractiveSketchSolveSessionRequestSchema.safeParse(startRequest)
    expectTrue(startParse.success, 'Interactive session start request should validate at the contract boundary.')
    expectTrue(
      !startInteractiveSketchSolveSessionRequestSchema.safeParse({ ...startRequest, plane: undefined }).success,
      'Interactive session start request should require the sketch plane at the runtime boundary.',
    )

    const started = await adapter.startInteractiveSolveSession(startRequest)
    expectTrue(started.sessionId.startsWith('interactive_sketch_solve_'), 'Interactive start should return an opaque session id.')
    expectTrue(started.programId.startsWith('compiled_sketch_solve_'), 'Interactive start should expose the compiled solve basis id.')
    expectTrue(started.warmStarted, 'Interactive start should warm-start from the compatible solved snapshot.')

    const updateRequest = {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: 'request_interactive_update_1',
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      sessionId: started.sessionId,
      dragTarget: {
        kind: 'sketchPoint' as const,
        pointId: 'sketch_point_b' as const,
        position: [2, -1] as const,
      },
    }
    expectTrue(updateInteractiveSketchSolveSessionRequestSchema.safeParse(updateRequest).success, 'Interactive update request should validate at the contract boundary.')
    expectTrue(
      !updateInteractiveSketchSolveSessionRequestSchema.safeParse({
        ...updateRequest,
        dragTarget: { kind: 'sketchPoint', pointId: 'not_a_point', position: [2, -1] },
      }).success,
      'Interactive update request should validate the dragged point target shape.',
    )

    const staleBasis = await adapter.updateInteractiveSolveSession({
      ...updateRequest,
      requestId: 'request_interactive_update_stale_basis_1',
      revisionId: 'rev_0002',
    })
    expectTrue(
      staleBasis.result.kind === 'blocked'
      && staleBasis.result.reason === 'staleRevision'
      && staleBasis.result.diagnostics.some((diagnostic) => diagnostic.code === 'stale-interactive-solve-session-basis'),
      'Interactive updates with a mismatched request basis should be rejected without mutating the active session.',
    )

    const updated = await adapter.updateInteractiveSolveSession(updateRequest)
    expectTrue(updated.result.kind === 'accepted', 'Compatible interactive drag updates should return an accepted frame.')

    const finalizeRequest = {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: 'request_interactive_finalize_1',
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      sessionId: started.sessionId,
    }
    expectTrue(finalizeInteractiveSketchSolveSessionRequestSchema.safeParse(finalizeRequest).success, 'Interactive finalize request should validate at the contract boundary.')
    const finalized = await adapter.finalizeInteractiveSolveSession(finalizeRequest)
    expectTrue(finalized.solvedSnapshot !== null, 'Interactive finalize should return the latest accepted solved state.')

    const stale = await adapter.updateInteractiveSolveSession({
      ...updateRequest,
      requestId: 'request_interactive_update_stale_1',
    })
    expectTrue(
      stale.result.kind === 'blocked' && stale.result.reason === 'staleSession',
      'Updating a finalized session should return a stale-session result.',
    )

    const disposeRequest = {
      ...finalizeRequest,
      requestId: 'request_interactive_dispose_1',
      sessionId: 'interactive_sketch_solve_unknown' as const,
    }
    expectTrue(disposeInteractiveSketchSolveSessionRequestSchema.safeParse(disposeRequest).success, 'Interactive dispose request should validate at the contract boundary.')
    const disposed = await adapter.disposeInteractiveSolveSession(disposeRequest)
    expectTrue(!disposed.disposed && disposed.diagnostics.some((diagnostic) => diagnostic.code === 'stale-interactive-solve-session'), 'Disposing an unknown session should report a stale-session diagnostic.')
  }

  async function testRevisionDiagnosticsAreExplicit() {
    const adapter = new SketchConstraintSolverAdapter()
    let didThrow = false
    try {
      await adapter.validateSketch({
        ...createValidateRequest(),
        requestId: 'request_validate_stale',
        revisionId: 'rev_stale',
        projectedReferences: [],
      })
    } catch (error) {
      didThrow = error instanceof Error && error.message.includes('rev_stale')
    }

    expectTrue(didThrow, 'Stale revision validation must reject the request instead of returning authoritative output.')
  }

  async function testMockProjectionDoesNotFabricateExternalGeometry() {
    const adapter = new MockSketchSolverAdapter()
    const projection = await adapter.projectExternalReferences(createProjectRequest())

    expectTrue(
      projection.projectedReferences.every((reference) =>
        reference.status === 'unsupportedSource'
        && reference.geometry.length === 0
        && reference.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-model-reference-source'),
      ),
      'Mock projection must report unresolved external sources instead of returning placeholder geometry.',
    )
  }

  async function testVersioningAndIdBijectionAreEnforced() {
    const adapter = new SketchConstraintSolverAdapter()
    let versionRejected = false

    try {
      await adapter.projectExternalReferences({
        ...createProjectRequest(),
        solverSchemaVersion: 'sketch-solver/v0' as never,
      })
    } catch (error) {
      versionRejected = error instanceof Error && error.message.includes('Unsupported solver schema version')
    }

    expectTrue(versionRejected, 'Solver must reject unsupported solver schema versions.')

    const projected = await adapter.projectExternalReferences(createProjectRequest())
    const invalid = await adapter.validateSketch({
      ...createValidateRequest(),
      projectedReferences: projected.projectedReferences,
      definition: {
        ...sketchDefinition,
        pointIds: [...sketchDefinition.pointIds, 'sketch_point_missing'],
      },
    })

    expectTrue(
      invalid.diagnostics.some((diagnostic) => diagnostic.code === 'point-missing-from-records'),
      'Validation must reject ID arrays that reference records that do not exist.',
    )
  }

  await testProjectionAndSolveFlow()
  await testRevisionDiagnosticsAreExplicit()
  await testMockProjectionDoesNotFabricateExternalGeometry()
  await testVersioningAndIdBijectionAreEnforced()
  await testInteractiveSolveLifecycleIsExplicit()
})
