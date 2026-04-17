import { test } from 'bun:test'
import {
  SOLVER_SCHEMA_VERSION,
  type ProjectSketchExternalReferencesRequest,
  type ResolveSketchReferenceRequest,
  type SolveSketchRequest,
  type ValidateSketchRequest,
} from './schema'
import {
  DEFAULT_MOCK_SKETCH_PLANE_FRAME,
  DEFAULT_MOCK_SOLVER_TOLERANCES,
  MockSketchSolverAdapter,
} from '@/domain/solver/mock-sketch-solver-adapter'
import { SketchConstraintSolverAdapter } from '@/domain/solver/sketch-constraint-solver-adapter'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import type { SketchDefinition } from '@/contracts/sketch/schema'

test('src/contracts/solver/solver-contract.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const sketchDefinition: SketchDefinition = {
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
      incrementalEdit: null,
    }
  }

  async function testProjectionAndSolveFlow() {
    const adapter = new SketchConstraintSolverAdapter()
    const projection = await adapter.projectExternalReferences(createProjectRequest())

    assert(projection.requestId === 'request_project_1', 'Projection must echo the originating request ID.')
    assert(projection.projectedReferences.length === sketchDefinition.references.length, 'Projection should return one record per authored external reference.')
    assert(
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
    assert(validation.isValid, 'Well-formed sketch definition should validate successfully.')

    const solved = await adapter.solveSketch(createSolveRequest(projection.projectedReferences))
    assert(
      solved.status.solveState === 'solved' && solved.status.constraintState === 'wellConstrained',
      'Solve should return a machine-readable solved and constrained status.',
    )
    assert(solved.solvedSnapshot.solvedEntities.length === 4, 'Solve should return solved entity geometry.')

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

    assert(regions.regions.length === 1, 'Region derivation should return an explicit derived region.')

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
    assert('kind' in resolution.resolution.target && resolution.resolution.target.kind === 'region', 'Solver reference resolution should be explicit for derived regions.')
    assert(resolution.resolution.isValid, 'Derived regions returned by the solver should resolve as valid.')

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

    assert(
      'geometryId' in projectedResolution.resolution.target,
      'Projected-geometry resolution should preserve the explicit projected target.',
    )
    assert(
      projectedResolution.resolution.isValid,
      'Projected geometry targets should resolve when their authored reference still exists.',
    )
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

    assert(didThrow, 'Stale revision validation must reject the request instead of returning authoritative output.')
  }

  async function testMockProjectionDoesNotFabricateExternalGeometry() {
    const adapter = new MockSketchSolverAdapter()
    const projection = await adapter.projectExternalReferences(createProjectRequest())

    assert(
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

    assert(versionRejected, 'Solver must reject unsupported solver schema versions.')

    const projected = await adapter.projectExternalReferences(createProjectRequest())
    const invalid = await adapter.validateSketch({
      ...createValidateRequest(),
      projectedReferences: projected.projectedReferences,
      definition: {
        ...sketchDefinition,
        pointIds: [...sketchDefinition.pointIds, 'sketch_point_missing'],
      },
    })

    assert(
      invalid.diagnostics.some((diagnostic) => diagnostic.code === 'point-missing-from-records'),
      'Validation must reject ID arrays that reference records that do not exist.',
    )
  }

  await testProjectionAndSolveFlow()
  await testRevisionDiagnosticsAreExplicit()
  await testMockProjectionDoesNotFabricateExternalGeometry()
  await testVersioningAndIdBijectionAreEnforced()
})
