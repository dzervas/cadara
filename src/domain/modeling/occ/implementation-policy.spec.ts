import { test } from 'bun:test'
import type { FeatureBooleanScope, RevolveAxisRef } from '@/contracts/modeling/schema'
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  SKETCH_SCHEMA_VERSION,
  type RegionBoundarySegmentRecord,
  type RegionRecord,
  type SketchDefinition,
  type SketchRecord,
} from '@/contracts/sketch/schema'
import type { ConstructionId } from '@/contracts/shared/ids'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  OCC_CONTRACT_GAP_CODES,
  OCC_MULTI_BODY_BOOLEAN_POLICIES,
  OCC_PHASE0_IMPLEMENTATION_NOTES,
  createProjectedRegionLoopRejection,
  getConstructionBackedRevolveAxisRejectionReason,
  getMultiBodyBooleanPolicy,
  getProjectedRegionLoopRejectionMessage,
  getProjectedRegionLoopRejectionReason,
  isConstructionBackedRevolveAxisSupported,
  isProjectedRegionSegmentSourceSupported,
} from '@/domain/modeling/occ/implementation-policy'
import { buildRegionProfileFace } from '@/domain/modeling/occ/sketch-profile'

test('src/domain/modeling/occ/implementation-policy.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function testConstructionBackedRevolveAxesAreExplicitlyRejected() {
    const constructionAxis: RevolveAxisRef = {
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    }
    const edgeAxis: RevolveAxisRef = {
      kind: 'edge',
      bodyId: 'body_seed',
      edgeId: 'edge_axis',
    }

    assert(
      !isConstructionBackedRevolveAxisSupported(constructionAxis),
      'Phase 0 policy must reject construction-backed revolve axes instead of inventing axis semantics from planes.',
    )
    assert(
      isConstructionBackedRevolveAxisSupported(edgeAxis),
      'Phase 0 policy must preserve explicit edge-backed revolve axes.',
    )
    assert(
      getConstructionBackedRevolveAxisRejectionReason().includes("public construction contract currently exposes only planes"),
      'Construction-axis rejection reason must explain the underlying contract gap.',
    )
    assert(
      OCC_CONTRACT_GAP_CODES.constructionRevolveAxisUnsupported === 'occ-contract-gap-revolve-construction-axis',
      'Construction-axis contract-gap code must remain stable for downstream diagnostics.',
    )
  }

  function testProjectedRegionLoopsAreOnlySupportedForEntitySegments() {
    const entitySource: RegionBoundarySegmentRecord['source'] = {
      kind: 'entity',
      entityId: 'sketch_entity_profile',
    }
    const projectedSource: RegionBoundarySegmentRecord['source'] = {
      kind: 'projectedGeometry',
      reference: {
        referenceId: 'ref_model_edge',
        geometryId: 'projected_geometry_edge',
      },
    }

    assert(
      isProjectedRegionSegmentSourceSupported(entitySource),
      'Phase 0 policy must continue to allow entity-backed region loops.',
    )
    assert(
      !isProjectedRegionSegmentSourceSupported(projectedSource),
      'Phase 0 policy must reject projected-geometry region loops until committed sketch payloads carry reconstructible geometry.',
    )
    assert(
      getProjectedRegionLoopRejectionReason().includes('committed SketchRecord payloads do not persist the projected geometry curves'),
      'Projected-geometry rejection reason must explain the missing committed geometry payload.',
    )
    assert(
      getProjectedRegionLoopRejectionMessage(projectedSource).includes('projected_geometry_edge'),
      'Projected-geometry rejection messaging must preserve the failing projected geometry ID.',
    )
    assert(
      createProjectedRegionLoopRejection(projectedSource).code === OCC_CONTRACT_GAP_CODES.projectedRegionGeometryUnavailable,
      'Projected-region rejection payloads must reuse the stable contract-gap code.',
    )
    assert(
      createProjectedRegionLoopRejection(projectedSource).reasonCode === 'missingProjectedGeometryInCommittedSketch',
      'Projected-region rejection payloads must expose a stable machine-readable reason code.',
    )
    assert(
      OCC_CONTRACT_GAP_CODES.projectedRegionGeometryUnavailable === 'occ-contract-gap-projected-region-loop',
      'Projected-region contract-gap code must remain stable for downstream diagnostics.',
    )
  }

  function testMultiBodyBooleanPolicyIsWrittenAndOperationSpecific() {
    const orderedTargets: FeatureBooleanScope = {
      kind: 'targetBodies',
      bodyIds: ['body_a', 'body_b', 'body_c'],
    }

    assert(
      getMultiBodyBooleanPolicy('join', orderedTargets)?.application === 'sequential',
      'Join policy must preserve the documented sequential application behavior for ordered targetBodies input.',
    )
    assert(
      getMultiBodyBooleanPolicy('join', orderedTargets)?.kernelOperation === 'fuse',
      'Join policy must explicitly use fuse semantics.',
    )
    assert(
      getMultiBodyBooleanPolicy('join', orderedTargets)?.preservesSuppliedOrder === true,
      'Join policy must preserve caller order rather than inheriting OCC defaults silently.',
    )
    assert(
      getMultiBodyBooleanPolicy('join', orderedTargets)?.precombineTargets === false,
      'Join policy must not pre-combine the selected target bodies before sequential application.',
    )
    assert(
      getMultiBodyBooleanPolicy('cut', orderedTargets)?.application === 'perTarget',
      'Cut policy must stay explicitly per-target-body.',
    )
    assert(
      getMultiBodyBooleanPolicy('cut', orderedTargets)?.kernelOperation === 'cut',
      'Cut policy must explicitly use subtraction semantics.',
    )
    assert(
      getMultiBodyBooleanPolicy('cut', orderedTargets)?.precombineTargets === false,
      'Cut policy must not pre-combine target bodies together.',
    )
    assert(
      getMultiBodyBooleanPolicy('intersect', orderedTargets)?.application === 'perTarget',
      'Intersect policy must stay explicitly per-target-body.',
    )
    assert(
      getMultiBodyBooleanPolicy('intersect', orderedTargets)?.kernelOperation === 'intersect',
      'Intersect policy must explicitly use per-target intersection semantics.',
    )
    assert(
      getMultiBodyBooleanPolicy('intersect', orderedTargets)?.precombineTargets === false,
      'Intersect policy must not invent an up-front target merge before each per-body intersection.',
    )
    assert(
      OCC_MULTI_BODY_BOOLEAN_POLICIES.join.targetSelection === 'orderedTargetBodies',
      'Structured join policy must keep ordered target-bodies semantics machine-readable.',
    )
    assert(
      getMultiBodyBooleanPolicy('newBody', orderedTargets) === null,
      'New-body operations must not claim a multi-body boolean policy.',
    )
    assert(
      getMultiBodyBooleanPolicy('join', { kind: 'standalone' }) === null,
      'Single-body and standalone scopes must not be misclassified as multi-body policy decisions.',
    )
  }

  function testImplementationNotesCapturePhase0RedLines() {
    assert(
      OCC_PHASE0_IMPLEMENTATION_NOTES.contractGaps.constructionSnapshots.includes('not the explicit plane frame required'),
      'Phase 0 notes must record that construction snapshots lack reconstructible plane geometry.',
    )
    assert(
      OCC_PHASE0_IMPLEMENTATION_NOTES.contractGaps.constructionSnapshots.includes('must keep feature-authored plane geometry internally'),
      'Phase 0 notes must freeze the requirement to keep construction-plane geometry internally in the OCC adapter.',
    )
    assert(
      OCC_PHASE0_IMPLEMENTATION_NOTES.contractGaps.constructionSnapshots.includes('must not change the public contract'),
      'Phase 0 notes must freeze the requirement not to change the contract to work around the construction-plane gap.',
    )
    assert(
      OCC_PHASE0_IMPLEMENTATION_NOTES.contractGaps.constructionSnapshots.includes('must not treat public construction snapshots as independently reconstructible'),
      'Phase 0 notes must state that public construction snapshots alone are insufficient reconstruction inputs.',
    )
    assert(
      OCC_PHASE0_IMPLEMENTATION_NOTES.solverBoundary.includes('remain owned by the SketchSolverAdapter boundary'),
      'Phase 0 notes must preserve the solver/kernel split explicitly.',
    )
    assert(
      OCC_CONTRACT_GAP_CODES.constructionPlaneGeometryUnavailable === 'occ-contract-gap-construction-plane-geometry',
      'Construction-plane geometry contract-gap code must remain stable for downstream diagnostics.',
    )
  }

  function createSketchPlane(): SketchPlaneDefinition {
    return {
      support: {
        kind: 'construction',
        constructionId: 'construction_plane-xy' as ConstructionId,
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
    }
  }

  function createEmptySketchDefinition(): SketchDefinition {
    return {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
  }

  function createProjectedRegionLoopSegment(): Extract<RegionBoundarySegmentRecord['source'], { kind: 'projectedGeometry' }> {
    return {
      kind: 'projectedGeometry',
      reference: {
        referenceId: 'ref_model_edge',
        geometryId: 'projected_geometry_edge',
      },
    }
  }

  function createMinimalSketchRecord(): SketchRecord {
    const planeSupport = {
      kind: 'construction' as const,
      constructionId: 'construction_plane-xy' as ConstructionId,
    }

    return {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_phase0',
      ownerBodyId: null,
      sketchId: 'sketch_phase0',
      label: 'Phase 0 Sketch',
      planeSupport,
      definition: createEmptySketchDefinition(),
      solvedSnapshot: {
        schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
        status: {
          solveState: 'solved',
          constraintState: 'wellConstrained',
        },
        solvedEntities: [],
        solvedPoints: [],
        constraintStatuses: [],
        dimensionStatuses: [],
        diagnostics: [],
      },
      regions: [],
    }
  }

  function createProjectedGeometryRegion(): RegionRecord {
    return {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_phase0',
      ownerBodyId: null,
      regionId: 'region_phase0',
      label: 'Projected Region',
      target: {
        kind: 'region',
        sketchId: 'sketch_phase0',
        regionId: 'region_phase0',
      },
      sourceSketch: {
        kind: 'sketch',
        sketchId: 'sketch_phase0',
      },
      loops: [
        {
          loopId: 'region_loop_phase0',
          role: 'outer',
          orientation: 'counterClockwise',
          segments: [
            {
              source: createProjectedRegionLoopSegment(),
              startPointId: null,
              endPointId: null,
            },
          ],
          boundaryPointIds: [],
          isClosed: true,
        },
      ],
      isClosed: true,
    }
  }

  function createSketchProfileOcStub() {
    return {
      gp_Pnt_3: function GpPnt3(this: Record<string, never>) {},
      gp_Dir_4: function GpDir4(this: Record<string, never>) {},
      gp_Ax3_3: function GpAx3_3(this: { Ax2(): object }) {
        this.Ax2 = () => ({})
      },
      gp_Pln_2: function GpPln2(this: Record<string, never>) {},
      BRepBuilderAPI_MakeWire_1: function MakeWire(this: { IsDone(): boolean; Wire(): object }) {
        this.IsDone = () => true
        this.Wire = () => ({})
      },
    } as unknown as OpenCascadeInstance
  }

  function testSketchProfileBuildRejectsProjectedGeometryAtIntegrationPoint() {
    const projectedSource = createProjectedRegionLoopSegment()
    const region = createProjectedGeometryRegion()
    const sketch = createMinimalSketchRecord()
    const plane = createSketchPlane()
    const oc = createSketchProfileOcStub()

    let thrownMessage: string | null = null

    try {
      buildRegionProfileFace(oc, { plane, sketch }, region)
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error)
    }

    assert(
      thrownMessage === createProjectedRegionLoopRejection(projectedSource).message,
      'The actual OCC profile-building path must reject projected-geometry loops with the shared Phase 0 message.',
    )
  }

  testConstructionBackedRevolveAxesAreExplicitlyRejected()
  testProjectedRegionLoopsAreOnlySupportedForEntitySegments()
  testMultiBodyBooleanPolicyIsWrittenAndOperationSpecific()
  testImplementationNotesCapturePhase0RedLines()
  testSketchProfileBuildRejectsProjectedGeometryAtIntegrationPoint()
})
