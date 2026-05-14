import { test, expect } from "vitest";
import type {
  FeatureBooleanScope,
  RevolveAxisRef,
} from "@/contracts/modeling/schema";
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  SKETCH_SCHEMA_VERSION,
  type RegionBoundarySegmentRecord,
  type RegionRecord,
  type SketchDefinition,
  type SketchRecord,
} from "@/contracts/sketch/schema";
import type { ConstructionId } from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
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
} from "@/domain/modeling/occ/implementation-policy";
import { buildRegionProfileFace } from "@/domain/modeling/occ/sketch-profile";

test("src/domain/modeling/occ/implementation-policy.spec.ts", async () => {
  function testConstructionBackedRevolveAxesAreExplicitlyRejected() {
    const constructionAxis: RevolveAxisRef = {
      kind: "construction",
      constructionId: "construction_plane-xy",
    };
    const edgeAxis: RevolveAxisRef = {
      kind: "edge",
      bodyId: "body_seed",
      edgeId: "edge_axis",
    };

    expect(
      isConstructionBackedRevolveAxisSupported(constructionAxis),
      "Phase 0 policy must reject construction-backed revolve axes instead of inventing axis semantics from planes.",
    ).toBeFalsy();
    expect(
      isConstructionBackedRevolveAxisSupported(edgeAxis),
      "Phase 0 policy must preserve explicit edge-backed revolve axes.",
    ).toBeTruthy();
    expect(
      getConstructionBackedRevolveAxisRejectionReason().includes(
        "public construction contract currently exposes only planes",
      ),
      "Construction-axis rejection reason must explain the underlying contract gap.",
    ).toBeTruthy();
    expect(
      OCC_CONTRACT_GAP_CODES.constructionRevolveAxisUnsupported,
      "Construction-axis contract-gap code must remain stable for downstream diagnostics.",
    ).toBe("occ-contract-gap-revolve-construction-axis");
  }

  function testProjectedRegionLoopsRequireLiveProjectionData() {
    const entitySource: RegionBoundarySegmentRecord["source"] = {
      kind: "entity",
      entityId: "sketch_entity_profile",
    };
    const projectedSource: RegionBoundarySegmentRecord["source"] = {
      kind: "projectedGeometry",
      reference: {
        referenceId: "ref_model_edge",
        geometryId: "projected_geometry_edge",
      },
    };

    expect(
      isProjectedRegionSegmentSourceSupported(entitySource),
      "Phase 0 policy must continue to allow entity-backed region loops.",
    ).toBeTruthy();
    expect(
      isProjectedRegionSegmentSourceSupported(projectedSource),
      "Projected-geometry region loop sources are supported when backed by live projection data.",
    ).toBeTruthy();
    expect(
      getProjectedRegionLoopRejectionReason().includes(
        "active solver-owned projection data",
      ),
      "Projected-geometry rejection reason must explain that live projection data is required.",
    ).toBeTruthy();
    expect(
      getProjectedRegionLoopRejectionMessage(projectedSource).includes(
        "projected_geometry_edge",
      ),
      "Projected-geometry rejection messaging must preserve the failing projected geometry ID.",
    ).toBeTruthy();
    expect(
      createProjectedRegionLoopRejection(projectedSource).code,
      "Projected-region rejection payloads must reuse the stable contract-gap code.",
    ).toBe(OCC_CONTRACT_GAP_CODES.projectedRegionGeometryUnavailable);
    expect(
      createProjectedRegionLoopRejection(projectedSource).reasonCode,
      "Projected-region rejection payloads must expose a stable machine-readable reason code.",
    ).toBe("missingLiveProjectedGeometry");
    expect(
      OCC_CONTRACT_GAP_CODES.projectedRegionGeometryUnavailable,
      "Projected-region contract-gap code must remain stable for downstream diagnostics.",
    ).toBe("occ-contract-gap-projected-region-loop");
  }

  function testMultiBodyBooleanPolicyIsWrittenAndOperationSpecific() {
    const orderedTargets: FeatureBooleanScope = {
      kind: "targetBodies",
      bodyIds: ["body_a", "body_b", "body_c"],
    };

    expect(
      getMultiBodyBooleanPolicy("join", orderedTargets)?.application,
      "Join policy must preserve the documented sequential application behavior for ordered targetBodies input.",
    ).toBe("sequential");
    expect(
      getMultiBodyBooleanPolicy("join", orderedTargets)?.kernelOperation,
      "Join policy must explicitly use fuse semantics.",
    ).toBe("fuse");
    expect(
      getMultiBodyBooleanPolicy("join", orderedTargets)?.preservesSuppliedOrder,
      "Join policy must preserve caller order rather than inheriting OCC defaults silently.",
    ).toBeTruthy();
    expect(
      getMultiBodyBooleanPolicy("join", orderedTargets)?.precombineTargets,
      "Join policy must not pre-combine the selected target bodies before sequential application.",
    ).toBeFalsy();
    expect(
      getMultiBodyBooleanPolicy("cut", orderedTargets)?.application,
      "Cut policy must stay explicitly per-target-body.",
    ).toBe("perTarget");
    expect(
      getMultiBodyBooleanPolicy("cut", orderedTargets)?.kernelOperation,
      "Cut policy must explicitly use subtraction semantics.",
    ).toBe("cut");
    expect(
      getMultiBodyBooleanPolicy("cut", orderedTargets)?.precombineTargets,
      "Cut policy must not pre-combine target bodies together.",
    ).toBeFalsy();
    expect(
      getMultiBodyBooleanPolicy("intersect", orderedTargets)?.application,
      "Intersect policy must stay explicitly per-target-body.",
    ).toBe("perTarget");
    expect(
      getMultiBodyBooleanPolicy("intersect", orderedTargets)?.kernelOperation,
      "Intersect policy must explicitly use per-target intersection semantics.",
    ).toBe("intersect");
    expect(
      getMultiBodyBooleanPolicy("intersect", orderedTargets)?.precombineTargets,
      "Intersect policy must not invent an up-front target merge before each per-body intersection.",
    ).toBeFalsy();
    expect(
      OCC_MULTI_BODY_BOOLEAN_POLICIES.join.targetSelection,
      "Structured join policy must keep ordered target-bodies semantics machine-readable.",
    ).toBe("orderedTargetBodies");
    expect(
      getMultiBodyBooleanPolicy("newBody", orderedTargets),
      "New-body operations must not claim a multi-body boolean policy.",
    ).toBe(null);
    expect(
      getMultiBodyBooleanPolicy("join", { kind: "standalone" }),
      "Single-body and standalone scopes must not be misclassified as multi-body policy decisions.",
    ).toBe(null);
  }

  function testImplementationNotesCapturePhase0RedLines() {
    expect(
      OCC_PHASE0_IMPLEMENTATION_NOTES.contractGaps.constructionSnapshots.includes(
        "not the explicit plane frame required",
      ),
      "Phase 0 notes must record that construction snapshots lack reconstructible plane geometry.",
    ).toBeTruthy();
    expect(
      OCC_PHASE0_IMPLEMENTATION_NOTES.contractGaps.constructionSnapshots.includes(
        "must keep feature-authored plane geometry internally",
      ),
      "Phase 0 notes must freeze the requirement to keep construction-plane geometry internally in the OCC adapter.",
    ).toBeTruthy();
    expect(
      OCC_PHASE0_IMPLEMENTATION_NOTES.contractGaps.constructionSnapshots.includes(
        "must not change the public contract",
      ),
      "Phase 0 notes must freeze the requirement not to change the contract to work around the construction-plane gap.",
    ).toBeTruthy();
    expect(
      OCC_PHASE0_IMPLEMENTATION_NOTES.contractGaps.constructionSnapshots.includes(
        "must not treat public construction snapshots as independently reconstructible",
      ),
      "Phase 0 notes must state that public construction snapshots alone are insufficient reconstruction inputs.",
    ).toBeTruthy();
    expect(
      OCC_PHASE0_IMPLEMENTATION_NOTES.solverBoundary.includes(
        "remain owned by the SketchSolverAdapter boundary",
      ),
      "Phase 0 notes must preserve the solver/kernel split explicitly.",
    ).toBeTruthy();
    expect(
      OCC_CONTRACT_GAP_CODES.constructionPlaneGeometryUnavailable,
      "Construction-plane geometry contract-gap code must remain stable for downstream diagnostics.",
    ).toBe("occ-contract-gap-construction-plane-geometry");
  }

  function createSketchPlane(): SketchPlaneDefinition {
    return {
      support: {
        kind: "construction",
        constructionId: "construction_plane-xy" as ConstructionId,
      },
      frame: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
        linearUnit: "documentLength",
        handedness: "rightHanded",
      },
      key: "xy",
    };
  }

  function createEmptySketchDefinition(): SketchDefinition {
    return {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: ["ref_model_edge"],
      references: [
        {
          referenceId: "ref_model_edge",
          kind: "modelReference",
          label: "Model edge",
          source: { kind: "edge", bodyId: "body_model", edgeId: "edge_model" },
          projectionMode: "projectAlongPlaneNormal",
        },
      ],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
  }

  function createProjectedRegionLoopSegment(): Extract<
    RegionBoundarySegmentRecord["source"],
    { kind: "projectedGeometry" }
  > {
    return {
      kind: "projectedGeometry",
      reference: {
        referenceId: "ref_model_edge",
        geometryId: "projected_geometry_edge",
      },
    };
  }

  function createMinimalSketchRecord(): SketchRecord {
    const planeSupport = {
      kind: "construction" as const,
      constructionId: "construction_plane-xy" as ConstructionId,
    };

    return {
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_phase0",
      ownerBodyId: null,
      sketchId: "sketch_phase0",
      label: "Phase 0 Sketch",
      planeSupport,
      definition: createEmptySketchDefinition(),
      solvedSnapshot: {
        schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
        status: {
          solveState: "solved",
          constraintState: "wellConstrained",
        },
        solvedEntities: [],
        solvedPoints: [],
        constraintStatuses: [],
        dimensionStatuses: [],
        diagnostics: [],
      },
      regions: [],
    };
  }

  function createProjectedGeometryRegion(): RegionRecord {
    return {
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_phase0",
      ownerBodyId: null,
      regionId: "region_phase0",
      label: "Projected Region",
      target: {
        kind: "region",
        sketchId: "sketch_phase0",
        regionId: "region_phase0",
      },
      sourceSketch: {
        kind: "sketch",
        sketchId: "sketch_phase0",
      },
      loops: [
        {
          loopId: "region_loop_phase0",
          role: "outer",
          orientation: "counterClockwise",
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
    };
  }

  function createSketchProfileOcStub() {
    return {
      gp_Pnt_3: function GpPnt3(this: Record<string, never>) {},
      gp_Dir_4: function GpDir4(this: Record<string, never>) {},
      gp_Ax3_3: function GpAx3_3(this: { Ax2(): object }) {
        this.Ax2 = () => ({});
      },
      gp_Pln_2: function GpPln2(this: Record<string, never>) {},
      BRepBuilderAPI_MakeWire_1: function MakeWire(this: {
        IsDone(): boolean;
        Wire(): object;
      }) {
        this.IsDone = () => true;
        this.Wire = () => ({});
      },
    } as unknown as OpenCascadeInstance;
  }

  function testSketchProfileBuildRejectsUnresolvedProjectedGeometryAtIntegrationPoint() {
    const projectedSource = createProjectedRegionLoopSegment();
    const region = createProjectedGeometryRegion();
    const sketch = createMinimalSketchRecord();
    const plane = createSketchPlane();
    const oc = createSketchProfileOcStub();

    let thrownMessage: string | null = null;

    try {
      buildRegionProfileFace(oc, { plane, sketch }, region);
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error);
    }

    expect(
      thrownMessage,
      "The actual OCC profile-building path must reject unresolved projected-geometry loops with the shared message.",
    ).toBe(createProjectedRegionLoopRejection(projectedSource).message);
  }

  testConstructionBackedRevolveAxesAreExplicitlyRejected();
  testProjectedRegionLoopsRequireLiveProjectionData();
  testMultiBodyBooleanPolicyIsWrittenAndOperationSpecific();
  testImplementationNotesCapturePhase0RedLines();
  testSketchProfileBuildRejectsUnresolvedProjectedGeometryAtIntegrationPoint();
});
