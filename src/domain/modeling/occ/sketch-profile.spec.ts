import { test, expect } from "vitest";
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  SKETCH_SCHEMA_VERSION,
  type RegionBoundarySegmentRecord,
  type RegionBoundarySource,
  type RegionRecord,
  type SketchDefinition,
  type SketchRecord,
} from "@/contracts/sketch/schema";
import {
  createSketchArrangementDeriver,
  declaredJoinClasses,
} from "@/contracts/sketch/region-extraction";
import {
  addRectangle,
  closedCurvesSignedArea,
  cubicOracle,
  FIXTURE_TOLERANCE,
  makeSketchFixture,
  type SketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import type {
  ConstructionId,
  ProjectedGeometryId,
  ReferenceId,
  RegionLoopId,
  RegionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import {
  buildRegionProfileFace,
  regionBoundaryBasisOfSketchRecord,
  releaseBuiltSketchProfileFace,
} from "@/domain/modeling/occ/sketch-profile";
import { resolveRegionBoundaryCurve } from "@/contracts/sketch/region-boundary-curves";
import { requireSketchRecord } from "@/contracts/sketch/runtime-schema";
import { getDefaultOpenCascadeInstance } from "@/domain/modeling/occ/runtime";

test("src/domain/modeling/occ/sketch-profile.spec.ts", async () => {
  function assertClose(
    actual: number,
    expected: number,
    tolerance: number,
    message: string,
  ) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}: expected ${expected}, got ${actual}.`);
    }
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

  function pointId(name: string) {
    return `sketch_point_${name}` as SketchPointId;
  }

  function entityId(name: string) {
    return `sketch_entity_${name}` as SketchEntityId;
  }

  function regionId(name: string) {
    return `region_${name}` as RegionId;
  }

  function loopId(name: string) {
    return `region_loop_${name}` as RegionLoopId;
  }

  function createSketchDefinition(
    sketchId: SketchId,
    points: Array<{ id: SketchPointId; position: readonly [number, number] }>,
    entities: SketchDefinition["entities"],
  ): SketchDefinition {
    return {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.id),
      points: points.map((point) => ({
        pointId: point.id,
        label: point.id,
        target: { kind: "sketchPoint", sketchId, pointId: point.id },
        position: point.position,
        isConstruction: false,
      })),
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
  }

  function withAuthoredReference(
    definition: SketchDefinition,
    referenceId: ReferenceId,
  ): SketchDefinition {
    return {
      ...definition,
      referenceIds: [...definition.referenceIds, referenceId],
      references: [
        ...definition.references,
        {
          referenceId,
          kind: "modelReference",
          label: "Projected profile",
          source: {
            kind: "edge",
            bodyId: "body_projected",
            edgeId: "edge_profile",
          },
          projectionMode: "projectAlongPlaneNormal",
        },
      ],
    };
  }

  function createSketchRecord(
    sketchId: SketchId,
    definition: SketchDefinition,
    solvedEntities: SketchRecord["solvedSnapshot"]["solvedEntities"],
    solvedPoints: SketchRecord["solvedSnapshot"]["solvedPoints"] = [],
    projectedReferences: ProjectedSketchReferenceRecord[] = [],
  ): SketchRecord {
    return {
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: sketchId,
      ownerBodyId: null,
      sketchId,
      label: sketchId,
      planeSupport: {
        kind: "construction",
        constructionId: "construction_plane-xy" as ConstructionId,
      },
      definition,
      solvedSnapshot: {
        schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
        status: {
          solveState: "solved",
          constraintState: "wellConstrained",
        },
        solvedEntities,
        solvedPoints,
        constraintStatuses: [],
        dimensionStatuses: [],
        diagnostics: [],
      },
      derivedValidity: { state: "current", diagnostics: [] },
      projectedReferences,
      regions: [],
    };
  }

  function createRegion(
    sketchId: SketchId,
    name: string,
    loops: RegionRecord["loops"],
  ): RegionRecord {
    return {
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: sketchId,
      ownerBodyId: null,
      regionId: regionId(name),
      signature: `hand-built ${name}`,
      label: name,
      target: {
        kind: "region",
        sketchId,
        regionId: regionId(name),
      },
      sourceSketch: {
        kind: "sketch",
        sketchId,
      },
      loops,
      isClosed: true,
    };
  }

  const deriver = createSketchArrangementDeriver(
    createCertifiedNeutralCurveQueryCapabilityForTest(),
  );

  /**
   * Profiles consume the arrangement owner's records (T09e cutover), held by
   * their sketch record: the record's own basis resolves them (T10c).
   */
  async function deriveRegions(sketch: SketchRecord) {
    const result = await deriver.derive({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: sketch.sketchId,
      definition: sketch.definition,
      solvedSnapshot: sketch.solvedSnapshot,
      projectedReferences: sketch.projectedReferences ?? [],
      modelingTolerance: 1e-3,
    });
    sketch.regions = result.regions;
    return result.regions;
  }

  function boundarySources(region: RegionRecord) {
    return [
      ...new Set(
        region.loops.flatMap((loop) =>
          loop.segments.map((segment) =>
            segment.branch.source.kind === "entity"
              ? segment.branch.source.entityId
              : `projected:${segment.branch.source.reference.geometryId}`,
          ),
        ),
      ),
    ].sort();
  }

  function regionBoundedBy(regions: readonly RegionRecord[], sources: string[]) {
    const expected = [...sources].sort();
    const matches = regions.filter(
      (region) =>
        JSON.stringify(boundarySources(region)) === JSON.stringify(expected),
    );
    expect(matches, `exactly one region is bounded by ${expected}`).toHaveLength(
      1,
    );
    return matches[0]!;
  }

  /** Loop records start at an arbitrary vertex; traversal order is cyclic. */
  function expectCyclic<T>(actual: readonly T[], expected: readonly T[], message: string) {
    const start = actual.indexOf(expected[0]!);
    expect(
      start >= 0
        ? [...actual.slice(start), ...actual.slice(0, start)]
        : actual,
      message,
    ).toEqual(expected);
  }

  /** A hand-built closed-branch record, for inputs the owner never publishes. */
  function closedBranchSegment(
    source: RegionBoundarySource,
  ): RegionBoundarySegmentRecord {
    return {
      branch: { source, spanId: "whole" },
      sourceParameterInterval: [0, 2 * Math.PI],
      traversalDirection: "forward",
      start: null,
      end: null,
      sourceSegmentOrdinal: 0,
    };
  }

  async function faceArea(face: object) {
    const oc = await getDefaultOpenCascadeInstance();
    const props = new oc.GProp_GProps_1();

    oc.BRepGProp.SurfaceProperties_1(
      face as InstanceType<typeof oc.TopoDS_Face>,
      props,
      false,
      false,
    );
    return props.Mass();
  }

  async function testRectangleProfileBuildsExpectedArea() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_phase3_rectangle" as SketchId;
    const points = [
      { id: pointId("bottom_left"), position: [0, 0] as const },
      { id: pointId("bottom_right"), position: [4, 0] as const },
      { id: pointId("top_right"), position: [4, 3] as const },
      { id: pointId("top_left"), position: [0, 3] as const },
    ];
    const definition = createSketchDefinition(sketchId, points, [
      {
        kind: "lineSegment",
        entityId: entityId("bottom"),
        label: "bottom",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("bottom"),
        },
        isConstruction: false,
        startPointId: pointId("bottom_left"),
        endPointId: pointId("bottom_right"),
      },
      {
        kind: "lineSegment",
        entityId: entityId("right"),
        label: "right",
        target: { kind: "sketchEntity", sketchId, entityId: entityId("right") },
        isConstruction: false,
        startPointId: pointId("bottom_right"),
        endPointId: pointId("top_right"),
      },
      {
        kind: "lineSegment",
        entityId: entityId("top"),
        label: "top",
        target: { kind: "sketchEntity", sketchId, entityId: entityId("top") },
        isConstruction: false,
        startPointId: pointId("top_right"),
        endPointId: pointId("top_left"),
      },
      {
        kind: "lineSegment",
        entityId: entityId("left"),
        label: "left",
        target: { kind: "sketchEntity", sketchId, entityId: entityId("left") },
        isConstruction: false,
        startPointId: pointId("top_left"),
        endPointId: pointId("bottom_left"),
      },
    ]);
    const sketch = createSketchRecord(sketchId, definition, [
      {
        kind: "lineSegment",
        entityId: entityId("bottom"),
        startPosition: [0, 0],
        endPosition: [4, 0],
      },
      {
        kind: "lineSegment",
        entityId: entityId("right"),
        startPosition: [4, 0],
        endPosition: [4, 3],
      },
      {
        kind: "lineSegment",
        entityId: entityId("top"),
        startPosition: [4, 3],
        endPosition: [0, 3],
      },
      {
        kind: "lineSegment",
        entityId: entityId("left"),
        startPosition: [0, 3],
        endPosition: [0, 0],
      },
    ]);
    const [region, ...others] = await deriveRegions(sketch);
    expect(others, "A rectangle derives exactly one region.").toEqual([]);

    const profile = buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region);
    assertClose(
      await faceArea(profile.face),
      12,
      1e-6,
      "Rectangle profile should build the expected area",
    );
    expectCyclic(
      [...profile.provenance.edges.keys()],
      [entityId("bottom"), entityId("right"), entityId("top"), entityId("left")],
      "Profile edges follow the counter-clockwise loop traversal.",
    );
    expectCyclic(
      [...profile.provenance.vertices.keys()],
      points.map((point) => point.id),
      "One provenance vertex per boundary vertex, keyed by its authored point.",
    );
    const bottomEdge = profile.provenance.edges.get(entityId("bottom"))!;
    const rightEdge = profile.provenance.edges.get(entityId("right"))!;
    const bottomRight = profile.provenance.vertices.get(
      pointId("bottom_right"),
    )!;
    const bottomLast = oc.TopExp.LastVertex(bottomEdge, true);
    const rightFirst = oc.TopExp.FirstVertex(rightEdge, true);
    try {
      expect(bottomLast.IsSame(bottomRight)).toBeTruthy();
      expect(rightFirst.IsSame(bottomRight)).toBeTruthy();
    } finally {
      bottomLast.delete();
      rightFirst.delete();
    }

    const diagonalId = entityId("diagonal_after_edit");
    const editedDefinition = createSketchDefinition(
      sketchId,
      points.slice(0, 3),
      [
        ...definition.entities.slice(0, 2),
        {
          kind: "lineSegment",
          entityId: diagonalId,
          label: "diagonal",
          target: { kind: "sketchEntity", sketchId, entityId: diagonalId },
          isConstruction: false,
          startPointId: pointId("top_right"),
          endPointId: pointId("bottom_left"),
        },
      ],
    );
    const editedSketch = createSketchRecord(sketchId, editedDefinition, [
      ...sketch.solvedSnapshot.solvedEntities.slice(0, 2),
      {
        kind: "lineSegment",
        entityId: diagonalId,
        startPosition: [4, 3],
        endPosition: [0, 0],
      },
    ]);
    const [editedRegion] = await deriveRegions(editedSketch);
    const editedProfile = buildRegionProfileFace(
      oc,
      { plane, sketch: editedSketch, modelingTolerance: 1e-3 },
      editedRegion,
    );
    expectCyclic(
      [...editedProfile.provenance.edges.keys()],
      [entityId("bottom"), entityId("right"), diagonalId],
      "The edited triangle's edges follow its loop traversal.",
    );
    expect(editedProfile.provenance.edges.has(entityId("top"))).toBeFalsy();
    expect(editedProfile.provenance.edges.has(entityId("left"))).toBeFalsy();
    expect(
      editedProfile.provenance.vertices.has(pointId("top_left")),
    ).toBeFalsy();
  }

  async function testCircleProfileUsesSolvedCenterOffset() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_phase3_circle" as SketchId;
    const points = [
      { id: pointId("circle_center"), position: [10, 20] as const },
    ];
    const definition = createSketchDefinition(sketchId, points, [
      {
        kind: "circle",
        entityId: entityId("circle"),
        label: "circle",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("circle"),
        },
        isConstruction: false,
        centerPointId: pointId("circle_center"),
        radius: 2,
      },
    ]);
    const sketch = createSketchRecord(sketchId, definition, [
      {
        kind: "circle",
        entityId: entityId("circle"),
        centerPosition: [10, 20],
        solvedRadius: 2,
      },
    ]);
    const [region] = await deriveRegions(sketch);

    const profile = buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region);
    assertClose(
      await faceArea(profile.face),
      Math.PI * 4,
      1e-5,
      "Circle profile should build with the solved center and radius",
    );
    expect([...profile.provenance.edges.keys()]).toEqual([
      entityId("circle"),
    ]);
    expect(
      profile.provenance.vertices.has(pointId("circle_center")),
      "A circle center is not a profile boundary vertex.",
    ).toBeFalsy();
  }

  async function testArcProfileRespectsReversedLoopTraversal() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_phase3_arc" as SketchId;
    const points = [
      { id: pointId("arc_center"), position: [0, 0] as const },
      { id: pointId("arc_left"), position: [-1, 0] as const },
      { id: pointId("arc_right"), position: [1, 0] as const },
    ];
    const definition = createSketchDefinition(sketchId, points, [
      {
        kind: "arc",
        entityId: entityId("upper_arc"),
        label: "upper arc",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("upper_arc"),
        },
        isConstruction: false,
        centerPointId: pointId("arc_center"),
        startPointId: pointId("arc_left"),
        endPointId: pointId("arc_right"),
        sweepDirection: "clockwise",
      },
      {
        kind: "lineSegment",
        entityId: entityId("diameter"),
        label: "diameter",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("diameter"),
        },
        isConstruction: false,
        startPointId: pointId("arc_left"),
        endPointId: pointId("arc_right"),
      },
    ]);
    const sketch = createSketchRecord(sketchId, definition, [
      {
        kind: "arc",
        entityId: entityId("upper_arc"),
        centerPosition: [0, 0],
        startPosition: [-1, 0],
        endPosition: [1, 0],
        sweepDirection: "clockwise",
      },
      {
        kind: "lineSegment",
        entityId: entityId("diameter"),
        startPosition: [-1, 0],
        endPosition: [1, 0],
      },
    ]);
    const [region, ...others] = await deriveRegions(sketch);
    expect(others, "An arc and its chord derive exactly one region.").toEqual([]);

    const profile = buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region);
    assertClose(
      await faceArea(profile.face),
      Math.PI / 2,
      1e-5,
      "Arc profile should support a clockwise arc as a reversed traversal of its counter-clockwise interval",
    );
    expect(
      region!.loops[0]!.segments.find(
        (segment) =>
          segment.branch.source.kind === "entity" &&
          segment.branch.source.entityId === entityId("upper_arc"),
      )?.traversalDirection,
      "The clockwise-authored arc left→right is the counter-clockwise interval right→left, which the counter-clockwise outer loop traverses forward.",
    ).toBe("forward");
    expectCyclic(
      [...profile.provenance.edges.keys()],
      [entityId("upper_arc"), entityId("diameter")],
      "Arc cap edges follow the loop traversal.",
    );
    expect([...profile.provenance.vertices.keys()].sort()).toEqual(
      [pointId("arc_left"), pointId("arc_right")].sort(),
    );
  }

  async function testInnerLoopHoleReducesFaceArea() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_phase3_hole" as SketchId;
    const points = [
      { id: pointId("outer_bl"), position: [0, 0] as const },
      { id: pointId("outer_br"), position: [6, 0] as const },
      { id: pointId("outer_tr"), position: [6, 6] as const },
      { id: pointId("outer_tl"), position: [0, 6] as const },
      { id: pointId("inner_bl"), position: [2, 2] as const },
      { id: pointId("inner_br"), position: [4, 2] as const },
      { id: pointId("inner_tr"), position: [4, 4] as const },
      { id: pointId("inner_tl"), position: [2, 4] as const },
    ];
    const outerNames = [
      "outer_bottom",
      "outer_right",
      "outer_top",
      "outer_left",
    ] as const;
    const innerNames = [
      "inner_bottom",
      "inner_right",
      "inner_top",
      "inner_left",
    ] as const;
    const definition = createSketchDefinition(sketchId, points, [
      {
        kind: "lineSegment",
        entityId: entityId(outerNames[0]),
        label: outerNames[0],
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(outerNames[0]),
        },
        isConstruction: false,
        startPointId: pointId("outer_bl"),
        endPointId: pointId("outer_br"),
      },
      {
        kind: "lineSegment",
        entityId: entityId(outerNames[1]),
        label: outerNames[1],
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(outerNames[1]),
        },
        isConstruction: false,
        startPointId: pointId("outer_br"),
        endPointId: pointId("outer_tr"),
      },
      {
        kind: "lineSegment",
        entityId: entityId(outerNames[2]),
        label: outerNames[2],
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(outerNames[2]),
        },
        isConstruction: false,
        startPointId: pointId("outer_tr"),
        endPointId: pointId("outer_tl"),
      },
      {
        kind: "lineSegment",
        entityId: entityId(outerNames[3]),
        label: outerNames[3],
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(outerNames[3]),
        },
        isConstruction: false,
        startPointId: pointId("outer_tl"),
        endPointId: pointId("outer_bl"),
      },
      {
        kind: "lineSegment",
        entityId: entityId(innerNames[0]),
        label: innerNames[0],
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(innerNames[0]),
        },
        isConstruction: false,
        startPointId: pointId("inner_bl"),
        endPointId: pointId("inner_br"),
      },
      {
        kind: "lineSegment",
        entityId: entityId(innerNames[1]),
        label: innerNames[1],
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(innerNames[1]),
        },
        isConstruction: false,
        startPointId: pointId("inner_br"),
        endPointId: pointId("inner_tr"),
      },
      {
        kind: "lineSegment",
        entityId: entityId(innerNames[2]),
        label: innerNames[2],
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(innerNames[2]),
        },
        isConstruction: false,
        startPointId: pointId("inner_tr"),
        endPointId: pointId("inner_tl"),
      },
      {
        kind: "lineSegment",
        entityId: entityId(innerNames[3]),
        label: innerNames[3],
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(innerNames[3]),
        },
        isConstruction: false,
        startPointId: pointId("inner_tl"),
        endPointId: pointId("inner_bl"),
      },
    ]);
    const sketch = createSketchRecord(sketchId, definition, [
      {
        kind: "lineSegment",
        entityId: entityId(outerNames[0]),
        startPosition: [0, 0],
        endPosition: [6, 0],
      },
      {
        kind: "lineSegment",
        entityId: entityId(outerNames[1]),
        startPosition: [6, 0],
        endPosition: [6, 6],
      },
      {
        kind: "lineSegment",
        entityId: entityId(outerNames[2]),
        startPosition: [6, 6],
        endPosition: [0, 6],
      },
      {
        kind: "lineSegment",
        entityId: entityId(outerNames[3]),
        startPosition: [0, 6],
        endPosition: [0, 0],
      },
      {
        kind: "lineSegment",
        entityId: entityId(innerNames[0]),
        startPosition: [2, 2],
        endPosition: [4, 2],
      },
      {
        kind: "lineSegment",
        entityId: entityId(innerNames[1]),
        startPosition: [4, 2],
        endPosition: [4, 4],
      },
      {
        kind: "lineSegment",
        entityId: entityId(innerNames[2]),
        startPosition: [4, 4],
        endPosition: [2, 4],
      },
      {
        kind: "lineSegment",
        entityId: entityId(innerNames[3]),
        startPosition: [2, 4],
        endPosition: [2, 2],
      },
    ]);
    const regions = await deriveRegions(sketch);
    expect(regions, "A square with a square hole derives two cells.").toHaveLength(2);
    const region = regions.find((candidate) =>
      candidate.loops.some((loop) => loop.role === "inner"),
    )!;

    const profile = buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region);
    assertClose(
      await faceArea(profile.face),
      32,
      1e-5,
      "Inner loops should subtract hole area from the outer face",
    );
  }

  async function testCircleNestedInRectangleBuildsBothCells() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_phase3_circle_cell" as SketchId;
    const points = [
      { id: pointId("outer_bl"), position: [0, 0] as const },
      { id: pointId("outer_br"), position: [6, 0] as const },
      { id: pointId("outer_tr"), position: [6, 6] as const },
      { id: pointId("outer_tl"), position: [0, 6] as const },
      { id: pointId("circle_center"), position: [3, 3] as const },
    ];
    const definition = createSketchDefinition(sketchId, points, [
      {
        kind: "lineSegment",
        entityId: entityId("outer_bottom"),
        label: "outer_bottom",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("outer_bottom"),
        },
        isConstruction: false,
        startPointId: pointId("outer_bl"),
        endPointId: pointId("outer_br"),
      },
      {
        kind: "lineSegment",
        entityId: entityId("outer_right"),
        label: "outer_right",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("outer_right"),
        },
        isConstruction: false,
        startPointId: pointId("outer_br"),
        endPointId: pointId("outer_tr"),
      },
      {
        kind: "lineSegment",
        entityId: entityId("outer_top"),
        label: "outer_top",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("outer_top"),
        },
        isConstruction: false,
        startPointId: pointId("outer_tr"),
        endPointId: pointId("outer_tl"),
      },
      {
        kind: "lineSegment",
        entityId: entityId("outer_left"),
        label: "outer_left",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("outer_left"),
        },
        isConstruction: false,
        startPointId: pointId("outer_tl"),
        endPointId: pointId("outer_bl"),
      },
      {
        kind: "circle",
        entityId: entityId("circle"),
        label: "circle",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("circle"),
        },
        isConstruction: false,
        centerPointId: pointId("circle_center"),
        radius: 1,
      },
    ]);
    const sketch = createSketchRecord(sketchId, definition, [
      {
        kind: "lineSegment",
        entityId: entityId("outer_bottom"),
        startPosition: [0, 0],
        endPosition: [6, 0],
      },
      {
        kind: "lineSegment",
        entityId: entityId("outer_right"),
        startPosition: [6, 0],
        endPosition: [6, 6],
      },
      {
        kind: "lineSegment",
        entityId: entityId("outer_top"),
        startPosition: [6, 6],
        endPosition: [0, 6],
      },
      {
        kind: "lineSegment",
        entityId: entityId("outer_left"),
        startPosition: [0, 6],
        endPosition: [0, 0],
      },
      {
        kind: "circle",
        entityId: entityId("circle"),
        centerPosition: [3, 3],
        solvedRadius: 1,
      },
    ]);
    const cells = await deriveRegions(sketch);
    expect(cells, "A circle inside a rectangle derives two cells.").toHaveLength(2);
    const outerCell = cells.find((cell) =>
      cell.loops.some((loop) => loop.role === "inner"),
    )!;
    const innerCell = regionBoundedBy(cells, [entityId("circle")]);

    const outerProfile = buildRegionProfileFace(
      oc,
      { plane, sketch, modelingTolerance: 1e-3 },
      outerCell,
    );
    const innerProfile = buildRegionProfileFace(
      oc,
      { plane, sketch, modelingTolerance: 1e-3 },
      innerCell,
    );

    assertClose(
      await faceArea(outerProfile.face),
      36 - Math.PI,
      1e-5,
      "Outer cell should subtract the circular inner loop",
    );
    assertClose(
      await faceArea(innerProfile.face),
      Math.PI,
      1e-5,
      "Inner circle cell should build as an independent profile",
    );
  }

  async function testProjectedLineProfileBuildsFromLiveProjection() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_projected_profile_line" as SketchId;
    const referenceId = "ref_projected_profile" as ReferenceId;
    const geometryId = "projected_geometry_left" as ProjectedGeometryId;
    const points = [
      { id: pointId("bottom_left"), position: [0, 0] as const },
      { id: pointId("bottom_right"), position: [4, 0] as const },
      { id: pointId("top_right"), position: [4, 3] as const },
      { id: pointId("top_left"), position: [0, 3] as const },
    ];
    const definition = withAuthoredReference(
      createSketchDefinition(sketchId, points, [
        {
          kind: "lineSegment",
          entityId: entityId("bottom"),
          label: "bottom",
          target: {
            kind: "sketchEntity",
            sketchId,
            entityId: entityId("bottom"),
          },
          isConstruction: false,
          startPointId: pointId("bottom_left"),
          endPointId: pointId("bottom_right"),
        },
        {
          kind: "lineSegment",
          entityId: entityId("right"),
          label: "right",
          target: {
            kind: "sketchEntity",
            sketchId,
            entityId: entityId("right"),
          },
          isConstruction: false,
          startPointId: pointId("bottom_right"),
          endPointId: pointId("top_right"),
        },
        {
          kind: "lineSegment",
          entityId: entityId("top"),
          label: "top",
          target: { kind: "sketchEntity", sketchId, entityId: entityId("top") },
          isConstruction: false,
          startPointId: pointId("top_right"),
          endPointId: pointId("top_left"),
        },
      ]),
      referenceId,
    );
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId,
        status: "projected",
        geometry: [
          {
            geometryId,
            kind: "lineSegment",
            startPosition: [0, 3],
            endPosition: [0, 0],
          },
        ],
        diagnostics: [],
      },
    ];
    const sketch = createSketchRecord(
      sketchId,
      definition,
      [
        {
          kind: "lineSegment",
          entityId: entityId("bottom"),
          startPosition: [0, 0],
          endPosition: [4, 0],
        },
        {
          kind: "lineSegment",
          entityId: entityId("right"),
          startPosition: [4, 0],
          endPosition: [4, 3],
        },
        {
          kind: "lineSegment",
          entityId: entityId("top"),
          startPosition: [4, 3],
          endPosition: [0, 3],
        },
      ],
      [],
      projectedReferences,
    );
    const [region, ...others] = await deriveRegions(sketch);
    expect(others, "The mixed local/projected loop derives one region.").toEqual([]);

    const profile = buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region);
    assertClose(
      await faceArea(profile.face),
      12,
      1e-5,
      "Projected line boundary should build from live projection data",
    );
    expect(
      sketch.definition.entities.length,
      "Projected profile reconstruction must not create copied sketch entities.",
    ).toBe(3);
    const projectedKey = `projected:${referenceId}/${geometryId}` as const;
    expect(profile.provenance.edges.has(projectedKey)).toBeTruthy();
    expect(profile.provenance.vertices.has(`${projectedKey}:start`)).toBeTruthy();
    expect(profile.provenance.vertices.has(`${projectedKey}:end`)).toBeTruthy();
  }

  async function testProjectedCircleProfileBuildsFromLiveProjection() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_projected_profile_circle" as SketchId;
    const referenceId = "ref_projected_profile" as ReferenceId;
    const geometryId = "projected_geometry_circle" as ProjectedGeometryId;
    const definition = withAuthoredReference(
      createSketchDefinition(sketchId, [], []),
      referenceId,
    );
    const sketch = createSketchRecord(
      sketchId,
      definition,
      [],
      [],
      [
        {
          referenceId,
          status: "projected",
          geometry: [
            {
              geometryId,
              kind: "circle",
              centerPosition: [0, 0],
              radius: 2,
            },
          ],
          diagnostics: [],
        },
      ],
    );
    const [region] = await deriveRegions(sketch);

    const profile = buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region);
    assertClose(
      await faceArea(profile.face),
      Math.PI * 4,
      1e-5,
      "Projected circle profile should build from live projection data",
    );
    expect(
      sketch.definition.points.length === 0 &&
        sketch.definition.entities.length === 0,
      "Projected circle profiles must not create sketch-owned geometry.",
    ).toBeTruthy();
  }

  async function testProjectedBoundaryInvalidationReportsStructuredCode() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_projected_profile_invalid" as SketchId;
    const referenceId = "ref_projected_profile" as ReferenceId;
    const geometryId = "projected_geometry_missing" as ProjectedGeometryId;
    const definition = withAuthoredReference(
      createSketchDefinition(sketchId, [], []),
      referenceId,
    );
    const sketch = createSketchRecord(sketchId, definition, []);
    const region = createRegion(sketchId, "projected_invalid", [
      {
        loopId: loopId("projected_invalid_outer"),
        role: "outer",
        orientation: "counterClockwise",
        segments: [
          closedBranchSegment({
            kind: "projectedGeometry",
            reference: { kind: "projectedCircle", referenceId, geometryId },
          }),
        ],
        boundaryPointIds: [],
        isClosed: true,
      },
    ]);

    let thrown: (Error & { code?: string }) | null = null;
    try {
      buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region);
    } catch (error) {
      thrown = error as Error & { code?: string };
    }

    expect(
      thrown?.code,
      "Missing live projection should report a machine-readable code.",
    ).toBe("occ-contract-gap-projected-region-loop");
    expect(
      thrown.message.includes("cannot be resolved from live projection data"),
      "Missing live projection should report explicit invalidation.",
    ).toBeTruthy();
  }

  async function testUnauthoredProjectedBoundaryInvalidatesEvenWithProjectionData() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_projected_profile_stale" as SketchId;
    const referenceId = "ref_stale_projection" as ReferenceId;
    const geometryId = "projected_geometry_stale" as ProjectedGeometryId;
    const definition = createSketchDefinition(sketchId, [], []);
    const sketch = createSketchRecord(
      sketchId,
      definition,
      [],
      [],
      [
        {
          referenceId,
          status: "projected",
          geometry: [
            {
              geometryId,
              kind: "circle",
              centerPosition: [0, 0],
              radius: 2,
            },
          ],
          diagnostics: [],
        },
      ],
    );
    const region = createRegion(sketchId, "projected_stale", [
      {
        loopId: loopId("projected_stale_outer"),
        role: "outer",
        orientation: "counterClockwise",
        segments: [
          closedBranchSegment({
            kind: "projectedGeometry",
            reference: { kind: "projectedCircle", referenceId, geometryId },
          }),
        ],
        boundaryPointIds: [],
        isClosed: true,
      },
    ]);

    let thrown: (Error & { code?: string }) | null = null;
    try {
      buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region);
    } catch (error) {
      thrown = error as Error & { code?: string };
    }

    expect(
      thrown?.code,
      "Unauthored projected boundaries should report a machine-readable invalidation code.",
    ).toBe("occ-contract-gap-projected-region-loop");
    expect(
      thrown.message.includes(
        "not backed by the current authored sketch references",
      ),
      "Stale projection data must not be treated as live authored geometry.",
    ).toBeTruthy();
    expect(
      definition.points.length === 0 && definition.entities.length === 0,
      "Rejected stale projection data must not be copied into sketch geometry.",
    ).toBeTruthy();
  }

  async function testEllipseBoundaryIsUnsupported() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_approximated_ellipse" as SketchId;
    const ellipseId = entityId("approximated_ellipse");
    const definition = createSketchDefinition(
      sketchId,
      [
        { id: pointId("ellipse_center"), position: [0, 0] },
        { id: pointId("ellipse_major"), position: [2, 0] },
      ],
      [
        {
          kind: "ellipse",
          entityId: ellipseId,
          label: "ellipse",
          target: { kind: "sketchEntity", sketchId, entityId: ellipseId },
          isConstruction: false,
          centerPointId: pointId("ellipse_center"),
          majorAxisPointId: pointId("ellipse_major"),
          minorRadius: 1,
        },
      ],
    );
    const sketch = createSketchRecord(sketchId, definition, [
      {
        kind: "ellipse",
        entityId: ellipseId,
        centerPosition: [0, 0],
        majorAxisEndpointPosition: [2, 0],
        minorRadius: 1,
      },
    ]);
    // U4: ellipses are unsupported region curves; there is no sampled
    // polyline profile any more.
    expect(
      await deriveRegions(sketch),
      "An ellipse derives no region (region-unsupported-curve).",
    ).toEqual([]);
    const region = createRegion(sketchId, "approximated_ellipse", [
      {
        loopId: loopId("approximated_ellipse_outer"),
        role: "outer",
        orientation: "counterClockwise",
        segments: [closedBranchSegment({ kind: "entity", entityId: ellipseId })],
        boundaryPointIds: [],
        isClosed: true,
      },
    ]);
    // Forged into the record, so the record's own basis reads it: the
    // arrangement has no neutral curve for an ellipse (T10c).
    sketch.regions = [region];
    expect(
      () => buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region),
      "The profile builder rejects an ellipse boundary explicitly, naming it.",
    ).toThrow(
      `profile-boundary-unsupported: the boundary segment on entity ${ellipseId} span whole has no neutral region curve form.`,
    );
  }

  async function testSplitCircleChordCellsBuildAsBoundedArcs() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_split_circle_chord" as SketchId;
    const center = pointId("center");
    const left = pointId("left");
    const right = pointId("right");
    const circle = entityId("circle");
    const chord = entityId("chord");
    const definition = createSketchDefinition(sketchId, [
      { id: center, position: [0, 0] }, { id: left, position: [-2, 0] }, { id: right, position: [2, 0] },
    ], [{
      kind: "circle", entityId: circle, label: "circle",
      target: { kind: "sketchEntity", sketchId, entityId: circle }, isConstruction: false,
      centerPointId: center, radius: 2,
    }, {
      kind: "lineSegment", entityId: chord, label: "chord",
      target: { kind: "sketchEntity", sketchId, entityId: chord }, isConstruction: false,
      startPointId: left, endPointId: right,
    }]);
    const sketch = createSketchRecord(sketchId, definition, [{
      kind: "circle", entityId: circle, centerPosition: [0, 0], solvedRadius: 2,
    }, {
      kind: "lineSegment", entityId: chord, startPosition: [-2, 0], endPosition: [2, 0],
    }]);
    const halves = await deriveRegions(sketch);
    expect(halves, "A circle split by its diameter derives two cells.").toHaveLength(2);
    const [top, bottom] = halves;
    assertClose(await faceArea(buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, top!).face), Math.PI * 2, 1e-5,
      "The upper split-circle cell must build as a bounded circle arc and chord.");
    assertClose(await faceArea(buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, bottom!).face), Math.PI * 2, 1e-5,
      "The lower split-circle cell must build as a bounded circle arc and chord.");
  }

  async function testRejectsMultipleOuterLoops() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_phase3_multiple_outer" as SketchId;
    const definition = createSketchDefinition(sketchId, [], []);
    const sketch = createSketchRecord(sketchId, definition, []);
    const outerLoop = {
      loopId: loopId("outer_a"),
      role: "outer" as const,
      orientation: "counterClockwise" as const,
      segments: [],
      boundaryPointIds: [],
      isClosed: true,
    };
    const region = createRegion(sketchId, "bad_region", [
      outerLoop,
      { ...outerLoop, loopId: loopId("outer_b") },
    ]);

    let thrownMessage: string | null = null;

    try {
      buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region);
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error);
    }

    expect(
      thrownMessage,
      "Malformed regions with multiple outer loops must be rejected explicitly.",
    ).toBe(`Region ${region.regionId} must contain exactly one outer loop.`);
  }

  async function testMixedTrimmedAndAuthoredLoopSharesCornerVertices() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_mixed_trimmed_authored" as SketchId;
    const points = [
      { id: pointId("mixed_bottom_left"), position: [0, 0] as const },
      { id: pointId("mixed_bottom_right"), position: [4, 0] as const },
      { id: pointId("mixed_top_right"), position: [4, 3] as const },
      { id: pointId("mixed_top_left"), position: [0, 3] as const },
      { id: pointId("mixed_right_rail_start"), position: [4, -2] as const },
      { id: pointId("mixed_right_rail_end"), position: [4, 5] as const },
      { id: pointId("mixed_left_rail_start"), position: [0, 5] as const },
      { id: pointId("mixed_left_rail_end"), position: [0, -2] as const },
    ];
    const definition = createSketchDefinition(sketchId, points, [
      {
        kind: "lineSegment",
        entityId: entityId("mixed_bottom"),
        label: "bottom",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("mixed_bottom"),
        },
        isConstruction: false,
        startPointId: pointId("mixed_bottom_left"),
        endPointId: pointId("mixed_bottom_right"),
      },
      {
        kind: "lineSegment",
        entityId: entityId("mixed_right_rail"),
        label: "right rail",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("mixed_right_rail"),
        },
        isConstruction: false,
        startPointId: pointId("mixed_right_rail_start"),
        endPointId: pointId("mixed_right_rail_end"),
      },
      {
        kind: "lineSegment",
        entityId: entityId("mixed_top"),
        label: "top",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("mixed_top"),
        },
        isConstruction: false,
        startPointId: pointId("mixed_top_right"),
        endPointId: pointId("mixed_top_left"),
      },
      {
        kind: "lineSegment",
        entityId: entityId("mixed_left_rail"),
        label: "left rail",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId("mixed_left_rail"),
        },
        isConstruction: false,
        startPointId: pointId("mixed_left_rail_start"),
        endPointId: pointId("mixed_left_rail_end"),
      },
    ]);
    const sketch = createSketchRecord(sketchId, definition, [
      {
        kind: "lineSegment",
        entityId: entityId("mixed_bottom"),
        startPosition: [0, 0],
        endPosition: [4, 0],
      },
      {
        kind: "lineSegment",
        entityId: entityId("mixed_right_rail"),
        startPosition: [4, -2],
        endPosition: [4, 5],
      },
      {
        kind: "lineSegment",
        entityId: entityId("mixed_top"),
        startPosition: [4, 3],
        endPosition: [0, 3],
      },
      {
        kind: "lineSegment",
        entityId: entityId("mixed_left_rail"),
        startPosition: [0, 5],
        endPosition: [0, -2],
      },
    ]);
    const [region, ...others] = await deriveRegions(sketch);
    expect(others, "The rails and chords bound exactly one cell.").toEqual([]);

    const profile = buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region);

    assertClose(
      await faceArea(profile.face),
      12,
      1e-5,
      "A loop mixing trimmed and authored segments must build its full area",
    );

    function collectFaceSubshapes(shapeEnum: number) {
      const explorer = new oc.TopExp_Explorer_2(
        profile.face,
        shapeEnum as never,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
      );
      const found: Array<{ IsSame(other: never): boolean }> = [];
      while (explorer.More()) {
        found.push(explorer.Current());
        explorer.Next();
      }
      return found;
    }

    const faceEdges = collectFaceSubshapes(
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as unknown as number,
    );
    const orphanedEdgeKeys = [...profile.provenance.edges.entries()]
      .filter(
        ([, edge]) => !faceEdges.some((faceEdge) => faceEdge.IsSame(edge as never)),
      )
      .map(([sourceKey]) => sourceKey);
    expect(
      orphanedEdgeKeys,
      "Provenance edges must stay subshapes of the built face so prism side-edge lineage resolves.",
    ).toEqual([]);

    const faceVertices = collectFaceSubshapes(
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX as unknown as number,
    );
    const orphanedVertexKeys = [...profile.provenance.vertices.entries()]
      .filter(
        ([, vertex]) =>
          !faceVertices.some((faceVertex) => faceVertex.IsSame(vertex as never)),
      )
      .map(([sourceKey]) => sourceKey);
    expect(
      orphanedVertexKeys,
      "Provenance vertices must stay subshapes of the built face so prism side-face lineage resolves.",
    ).toEqual([]);

    const distinctFaceVertices: Array<{ IsSame(other: never): boolean }> = [];
    for (const vertex of faceVertices) {
      if (!distinctFaceVertices.some((seen) => seen.IsSame(vertex as never))) {
        distinctFaceVertices.push(vertex);
      }
    }
    expect(
      distinctFaceVertices.length,
      "Corners shared between a trimmed and an authored segment must reuse one vertex, not two coincident ones.",
    ).toBe(4);
  }

  await testRectangleProfileBuildsExpectedArea();
  await testCircleProfileUsesSolvedCenterOffset();
  await testArcProfileRespectsReversedLoopTraversal();
  await testInnerLoopHoleReducesFaceArea();
  await testCircleNestedInRectangleBuildsBothCells();
  await testProjectedLineProfileBuildsFromLiveProjection();
  await testProjectedCircleProfileBuildsFromLiveProjection();
  await testProjectedBoundaryInvalidationReportsStructuredCode();
  await testUnauthoredProjectedBoundaryInvalidatesEvenWithProjectionData();
  await testEllipseBoundaryIsUnsupported();
  async function testMultiPieceSourceCurveKeysEachSplitSegmentDistinctly() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const sketchId = "sketch_multi_piece_band" as SketchId;
    const sqrt3 = Math.sqrt(3);
    const center = pointId("band_center");
    const topLeft = pointId("band_top_left");
    const topRight = pointId("band_top_right");
    const bottomLeft = pointId("band_bottom_left");
    const bottomRight = pointId("band_bottom_right");
    const circle = entityId("band_circle");
    const chordTop = entityId("band_chord_top");
    const chordBottom = entityId("band_chord_bottom");
    const definition = createSketchDefinition(sketchId, [
      { id: center, position: [0, 0] },
      // The chords cross the circle: an undeclared chord end exactly on the
      // circle is no join (no proximity closure, U2).
      { id: topLeft, position: [-3, 1] },
      { id: topRight, position: [3, 1] },
      { id: bottomLeft, position: [-3, -1] },
      { id: bottomRight, position: [3, -1] },
    ], [{
      kind: "circle", entityId: circle, label: "band circle",
      target: { kind: "sketchEntity", sketchId, entityId: circle }, isConstruction: false,
      centerPointId: center, radius: 2,
    }, {
      kind: "lineSegment", entityId: chordTop, label: "band chord top",
      target: { kind: "sketchEntity", sketchId, entityId: chordTop }, isConstruction: false,
      startPointId: topLeft, endPointId: topRight,
    }, {
      kind: "lineSegment", entityId: chordBottom, label: "band chord bottom",
      target: { kind: "sketchEntity", sketchId, entityId: chordBottom }, isConstruction: false,
      startPointId: bottomLeft, endPointId: bottomRight,
    }]);
    const sketch = createSketchRecord(sketchId, definition, [{
      kind: "circle", entityId: circle, centerPosition: [0, 0], solvedRadius: 2,
    }, {
      kind: "lineSegment", entityId: chordTop, startPosition: [-3, 1], endPosition: [3, 1],
    }, {
      kind: "lineSegment", entityId: chordBottom, startPosition: [-3, -1], endPosition: [3, -1],
    }]);
    const band = regionBoundedBy(await deriveRegions(sketch), [
      chordBottom,
      chordTop,
      circle,
    ]);
    const circleOrdinals = band.loops[0]!.segments
      .filter(
        (segment) =>
          segment.branch.source.kind === "entity" &&
          segment.branch.source.entityId === circle,
      )
      .map((segment) => segment.sourceSegmentOrdinal);
    expect(
      new Set(circleOrdinals).size,
      "The band uses two distinct split pieces of the circle.",
    ).toBe(2);
    const profile = buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, band);
    assertClose(
      await faceArea(profile.face),
      (4 * Math.PI) / 3 + 2 * sqrt3,
      1e-5,
      "The band between two chords must build from both split pieces of one circle.",
    );
    expect(
      [...profile.provenance.edges.keys()].sort(),
      "Each split piece of the circle must carry its own ordinal-keyed provenance edge.",
    ).toEqual(
      [
        chordBottom,
        chordTop,
        ...circleOrdinals.map((ordinal) => `${circle}#${ordinal}`),
      ].sort(),
    );

  }

  async function testClosedSplineBoundaryBuildsExactBezierEdges() {
    const oc = await getDefaultOpenCascadeInstance();
    const fixture = makeSketchFixture();
    fixture.point("s0", 0, 0);
    fixture.point("s1", 4, 0);
    fixture.point("s2", 4, 3);
    fixture.point("s3", 0, 3);
    fixture.spline("loop", ["s0", "s1", "s2", "s3"], "smooth");
    const input = fixture.build();
    const sketch = createSketchRecord(
      input.sketchId,
      input.definition,
      input.solvedSnapshot.solvedEntities,
      input.solvedSnapshot.solvedPoints,
    );
    const regions = await deriveRegions(sketch);
    expect(
      regions,
      "A closed spline derives one selectable region (U9).",
    ).toHaveLength(1);
    const [region] = regions;
    const profile = buildRegionProfileFace(
      oc,
      { plane: createSketchPlane(), sketch, modelingTolerance: 1e-3 },
      region!,
    );
    // Independent oracle (shared Gauss–Legendre Green fixture, exact for the
    // cubic integrand) on the solved spans at the records' own intervals.
    const solved = input.solvedSnapshot.solvedEntities[0]!;
    if (solved.kind !== "spline") throw new Error("premise: a solved spline");
    const loop = region!.loops[0]!;
    const oracle = closedCurvesSignedArea(
      loop.segments.map((segment) => {
        const span = solved.reconstruction.spans.find(
          (candidate) =>
            `${candidate.source.startOccurrenceId}>${candidate.source.endOccurrenceId}` ===
            segment.branch.spanId,
        )!;
        const [a, b] = segment.sourceParameterInterval;
        return segment.traversalDirection === "forward"
          ? cubicOracle(span.poles, span.interval, a, b)
          : cubicOracle(span.poles, span.interval, b, a);
      }),
    );
    expect(oracle, "premise: a counter-clockwise outer loop").toBeGreaterThan(1);
    const area = await faceArea(profile.face);
    expect(
      Math.abs(area - oracle) / oracle,
      `The spline face is exactly the spline (area ${area} vs oracle ${oracle}).`,
    ).toBeLessThanOrEqual(1e-9);
    await expectValidProfile(
      region!,
      profile,
      { area: oracle, perimeter: 14 },
      "closed spline",
    );
    expect(
      [...profile.provenance.edges.keys()].sort(),
      "Each spline span is its own exact edge, keyed by its span id.",
    ).toEqual(
      loop.segments
        .map((segment) => `${input.definition.entities[0]!.entityId}@${segment.branch.spanId}`)
        .sort(),
    );
    releaseBuiltSketchProfileFace(profile);
  }

  /** A sketch record carrying the fixture's solve, including its satisfied statuses. */
  function fixtureSketchRecord(fixture: SketchFixture): SketchRecord {
    const input = fixture.build();
    return {
      ...createSketchRecord(input.sketchId, input.definition, []),
      solvedSnapshot: input.solvedSnapshot,
      projectedReferences: input.projectedReferences,
    };
  }

  /**
   * OCC-seam checks for a profile built from owner records (review R1): a valid
   * face, one wire per loop, every loop vertex one `TopoDS_Vertex` shared by
   * exactly its two edges, and the area within τ·perimeter of the analytic area.
   */
  async function expectValidProfile(
    region: RegionRecord,
    profile: ReturnType<typeof buildRegionProfileFace>,
    expected: { area: number; perimeter: number },
    label: string,
  ) {
    const oc = await getDefaultOpenCascadeInstance();
    const analyzer = new oc.BRepCheck_Analyzer(profile.face, true, false);
    try {
      expect(
        analyzer.IsValid_2(),
        `${label}: BRepCheck_Analyzer accepts the face.`,
      ).toBe(true);
    } finally {
      analyzer.delete();
    }
    const children = (shape: object, kind: unknown) => {
      const explorer = new oc.TopExp_Explorer_2(
        shape as never,
        kind as never,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
      );
      const found: InstanceType<typeof oc.TopoDS_Shape>[] = [];
      while (explorer.More()) {
        found.push(explorer.Current());
        explorer.Next();
      }
      explorer.delete();
      return found;
    };
    const wires = children(profile.face, oc.TopAbs_ShapeEnum.TopAbs_WIRE);
    expect(wires, `${label}: one wire per region loop.`).toHaveLength(
      region.loops.length,
    );
    for (const [index, wire] of wires.entries()) {
      const edges = children(wire, oc.TopAbs_ShapeEnum.TopAbs_EDGE).map(
        (edge) => oc.TopoDS.Edge_1(edge),
      );
      const ends = edges.flatMap((edge) => [
        oc.TopExp.FirstVertex(edge, true),
        oc.TopExp.LastVertex(edge, true),
      ]);
      const groups: (typeof ends)[] = [];
      for (const end of ends) {
        const group = groups.find((candidate) => candidate[0]!.IsSame(end));
        if (group) group.push(end);
        else groups.push([end]);
      }
      expect(
        groups.map((group) => group.length),
        `${label}: every vertex of wire ${index} is one TopoDS_Vertex shared by exactly two edge ends.`,
      ).toEqual(edges.map(() => 2));
      for (const end of ends) end.delete();
      for (const edge of edges) edge.delete();
    }
    const faceVertices = children(
      profile.face,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    );
    expect(
      [...profile.provenance.vertices.entries()]
        .filter(
          ([, vertex]) =>
            !faceVertices.some((candidate) => candidate.IsSame(vertex)),
        )
        .map(([key]) => key),
      `${label}: every provenance vertex is a vertex of the face.`,
    ).toEqual([]);
    const area = await faceArea(profile.face);
    expect(
      Math.abs(area - expected.area),
      `${label}: area ${area} is within τ·perimeter of the analytic ${expected.area}.`,
    ).toBeLessThanOrEqual(FIXTURE_TOLERANCE * expected.perimeter);
  }

  async function testNonBitwiseDeclaredJoinsBuildValidFaces() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const build = async (fixture: SketchFixture) => {
      const sketch = fixtureSketchRecord(fixture);
      const regions = await deriveRegions(sketch);
      return {
        regions,
        profiles: regions.map((region) =>
          buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, region),
        ),
      };
    };

    // Coincident corners whose side-0 end carries a residual: a 1e-8 and a
    // 0.3·τ overshoot, and a 0.9·τ undershoot (owner rows in region-extraction).
    for (const offset of [
      1e-8,
      0.3 * FIXTURE_TOLERANCE,
      -0.9 * FIXTURE_TOLERANCE,
    ]) {
      const fixture = makeSketchFixture();
      addRectangle(fixture, "r", [0, 0, 10, 5], "coincident", offset);
      const { regions, profiles } = await build(fixture);
      expect(regions, `offset ${offset}: one region`).toHaveLength(1);
      const [profile] = profiles;
      await expectValidProfile(
        regions[0]!,
        profile!,
        { area: 50, perimeter: 30 },
        `coincident corner Δ=${offset}`,
      );
      const corner = profile!.provenance.vertices.get(pointId("r0e"));
      expect(
        corner &&
          profile!.provenance.vertices.get(pointId("r1s"))?.IsSame(corner),
        `Δ=${offset}: both joined corner points name one TopoDS_Vertex.`,
      ).toBe(true);
      for (const built of profiles) releaseBuiltSketchProfileFace(built);
    }

    // Rounded rectangle: line/arc joins, arcs built through the join vertices.
    const rounded = makeSketchFixture();
    const [w, h, r] = [10, 6, 1];
    for (const [name, x, y] of [
      ["a", r, 0],
      ["b", w - r, 0],
      ["c", w, r],
      ["d", w, h - r],
      ["e", w - r, h],
      ["f", r, h],
      ["g", 0, h - r],
      ["h", 0, r],
      ["k1", w - r, r],
      ["k2", w - r, h - r],
      ["k3", r, h - r],
      ["k4", r, r],
    ] as const)
      rounded.point(name, x, y);
    rounded.line("l1", "a", "b");
    rounded.arc("a1", "k1", "b", "c");
    rounded.line("l2", "c", "d");
    rounded.arc("a2", "k2", "d", "e");
    rounded.line("l3", "e", "f");
    rounded.arc("a3", "k3", "f", "g");
    rounded.line("l4", "g", "h");
    rounded.arc("a4", "k4", "h", "a");
    const roundedBuilt = await build(rounded);
    expect(roundedBuilt.regions).toHaveLength(1);
    await expectValidProfile(
      roundedBuilt.regions[0]!,
      roundedBuilt.profiles[0]!,
      {
        area: w * h - (4 - Math.PI) * r * r,
        perimeter: 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r,
      },
      "rounded rectangle",
    );
    for (const built of roundedBuilt.profiles)
      releaseBuiltSketchProfileFace(built);

    // T-junction on an arc: the stem end is declared on the arc at 30°, whose
    // binary64 representative is not bitwise on the circle.
    const onArc = makeSketchFixture();
    onArc.point("a", 0, -2);
    onArc.point("b", 0, 2);
    onArc.point("k", 0, 0);
    onArc.line("l", "b", "a");
    onArc.arc("arc", "k", "a", "b");
    onArc.point("m", 0, 0);
    onArc.point("q", 2 * Math.cos(Math.PI / 6), 2 * Math.sin(Math.PI / 6));
    onArc.line("stem", "m", "q");
    onArc.midpoint("m", "l");
    onArc.pointOnCurve("q", "arc");
    const arcBuilt = await build(onArc);
    expect(
      arcBuilt.regions,
      "the stem splits the D-shape into two cells",
    ).toHaveLength(2);
    const sectors = arcBuilt.profiles.map((profile, index) => ({
      profile,
      region: arcBuilt.regions[index]!,
    }));
    // Sectors of 120° and 60° of the radius-2 half disk.
    const expectedSectors = [(2 * Math.PI) / 3, Math.PI / 3].map((angle) => ({
      area: 2 * angle,
      perimeter: 2 + 2 + 2 * angle,
    }));
    const areas = await Promise.all(
      sectors.map(({ profile }) => faceArea(profile.face)),
    );
    for (const [index, { profile, region }] of sectors.entries()) {
      const expected =
        areas[index]! > Math.PI ? expectedSectors[0]! : expectedSectors[1]!;
      await expectValidProfile(
        region,
        profile,
        expected,
        `arc T-junction cell ${index}`,
      );
      const junction = profile.provenance.vertices.get(pointId("q"));
      expect(
        junction !== undefined,
        `arc T-junction cell ${index}: the declared stem end names the junction vertex.`,
      ).toBe(true);
    }
    for (const built of arcBuilt.profiles) releaseBuiltSketchProfileFace(built);
  }

  async function testPointTouchingLoopsBuildValidFaces() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    // A diamond hole whose bottom corner is declared on the square's bottom
    // side: the owner publishes outer and inner loops sharing that vertex.
    const fixture = makeSketchFixture();
    addRectangle(fixture, "r", [0, 0, 10, 10]);
    for (const [name, x, y] of [
      ["d0", 5, 0],
      ["d1", 7, 3],
      ["d2", 5, 6],
      ["d3", 3, 3],
    ] as const)
      fixture.point(name, x, y);
    for (let index = 0; index < 4; index += 1)
      fixture.line(`e${index}`, `d${index}`, `d${(index + 1) % 4}`);
    fixture.pointOnCurve("d0", "r_s0");
    const sketch = fixtureSketchRecord(fixture);
    const regions = await deriveRegions(sketch);
    const touching = regions.find((region) => region.loops.length === 2);
    const diamond = regions.find((region) => region.loops.length === 1);
    expect(
      touching && diamond,
      "the owner derives the touching band and the diamond",
    ).toBeTruthy();
    // T-4: one vertex resolver per face, so the loops share one
    // TopoDS_Vertex, and BRepCheck accepts the face.
    const band = buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, touching!);
    await expectValidProfile(
      touching!,
      band,
      { area: 100 - 12, perimeter: 40 + 4 * Math.hypot(2, 3) },
      "point-touching band",
    );
    expect(
      Math.abs((await faceArea(band.face)) - 88) / 88,
      "The band is the square minus the diamond.",
    ).toBeLessThanOrEqual(1e-9);
    const touch = band.provenance.vertices.get(pointId("d0"))!;
    const wireVertices = (wire: object) => {
      const explorer = new oc.TopExp_Explorer_2(
        wire as never,
        oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
      );
      let shared = false;
      while (explorer.More()) {
        const current = explorer.Current();
        shared ||= current.IsSame(touch);
        current.delete();
        explorer.Next();
      }
      explorer.delete();
      return shared;
    };
    const wires = new oc.TopExp_Explorer_2(
      band.face as never,
      oc.TopAbs_ShapeEnum.TopAbs_WIRE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    const sharing: boolean[] = [];
    while (wires.More()) {
      const wire = wires.Current();
      sharing.push(wireVertices(wire));
      wire.delete();
      wires.Next();
    }
    wires.delete();
    expect(
      sharing,
      "Both the outer and the inner wire pass through the one shared touch vertex.",
    ).toEqual([true, true]);
    releaseBuiltSketchProfileFace(band);
    const built = buildRegionProfileFace(oc, { plane, sketch, modelingTolerance: 1e-3 }, diamond!);
    await expectValidProfile(
      diamond!,
      built,
      { area: 12, perimeter: 4 * Math.hypot(2, 3) },
      "touching diamond",
    );
    releaseBuiltSketchProfileFace(built);

    // Exactly one null end is no full turn (review A3).
    const circle = makeSketchFixture();
    circle.point("c", 0, 0);
    circle.circle("disk", "c", 2);
    const circleSketch = fixtureSketchRecord(circle);
    const [disk] = await deriveRegions(circleSketch);
    const [segment] = disk!.loops[0]!.segments;
    const vertex = {
      kind: "declaredJoin" as const,
      key: "j[half-open]",
      pointIds: [],
      portPointId: null,
      position: [2, 0] as const,
      ballRadius: 0,
    };
    for (const halfOpen of [
      { ...segment!, start: null, end: vertex },
      { ...segment!, start: vertex, end: null },
    ]) {
      expect(
        () =>
          buildRegionProfileFace(
            oc,
            { plane, sketch: circleSketch, modelingTolerance: 1e-3 },
            {
              ...disk!,
              loops: [{ ...disk!.loops[0]!, segments: [halfOpen] }],
            },
          ),
        "A single boundary segment with exactly one null end is rejected, not built as a full circle.",
      ).toThrow(/does not close back onto its starting vertex/);
    }
  }

  /**
   * T10b review R-2 (T10c): the basis is the record's own (definition, solved
   * snapshot, projected references and regions held together). Records are
   * cloned whole, so after a structured clone and after a persistence round
   * trip the clone's regions resolve against the clone to the same curves
   * and build the same face; another record's region objects do not resolve;
   * a record that is not current fails closed.
   */
  async function testRegionBasisFollowsItsWholeSketchRecord() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createSketchPlane();
    const fixture = makeSketchFixture();
    fixture.point("A", 0, 0);
    fixture.point("B", 10, 0);
    fixture.point("K", 10, 3);
    fixture.point("C", 10, 6);
    fixture.point("D", 5, 8.5);
    fixture.point("E", 0, 6);
    fixture.line("base", "A", "B");
    fixture.arc("bulge", "K", "B", "C");
    fixture.spline("top", ["C", "D", "E"], "open");
    fixture.line("side", "E", "A");
    const original = fixtureSketchRecord(fixture);
    const [region] = await deriveRegions(original);
    expect(region, "premise: the mixed outline derives one region").toBeDefined();
    const basis = regionBoundaryBasisOfSketchRecord(original);
    expect(
      regionBoundaryBasisOfSketchRecord(original),
      "the basis is cached per record",
    ).toBe(basis);
    const curvesOf = (record: SketchRecord) => {
      const recordBasis = regionBoundaryBasisOfSketchRecord(record);
      return record.regions[0]!.loops.flatMap((loop) =>
        loop.segments.map((segment) =>
          resolveRegionBoundaryCurve(recordBasis, segment),
        ),
      );
    };
    const originalCurves = curvesOf(original);
    expect(
      originalCurves.every((curve) => curve.kind === "resolved"),
      "every segment of the record's region resolves",
    ).toBe(true);
    const originalProfile = buildRegionProfileFace(
      oc,
      { plane, sketch: original, modelingTolerance: 1e-3 },
      region!,
    );
    const originalArea = await faceArea(originalProfile.face);
    releaseBuiltSketchProfileFace(originalProfile);
    // The persistence boundary: JSON, then the strict sketch-record contract.
    const persisted = requireSketchRecord(JSON.parse(JSON.stringify(original)));
    for (const [label, copy] of [
      ["structured clone", structuredClone(original)],
      ["persistence round trip", persisted],
    ] as const) {
      expect(
        curvesOf(copy),
        `${label}: the copy's regions resolve to the original's curves`,
      ).toEqual(originalCurves);
      const built = buildRegionProfileFace(
        oc,
        { plane, sketch: copy, modelingTolerance: 1e-3 },
        copy.regions[0]!,
      );
      expect(
        await faceArea(built.face),
        `${label}: the copy builds the same face`,
      ).toBe(originalArea);
      releaseBuiltSketchProfileFace(built);
      expect(
        () =>
          buildRegionProfileFace(
            oc,
            { plane, sketch: copy, modelingTolerance: 1e-3 },
            region!,
          ),
        `${label}: the original record's region objects do not resolve against the copy`,
      ).toThrow(/^profile-boundary-unresolved: .* is not a record of this basis's regions\.$/);
    }
    for (const state of ["stale", "invalid"] as const) {
      const notCurrent: SketchRecord = {
        ...original,
        derivedValidity: { state, diagnostics: [] },
      };
      expect(
        () =>
          buildRegionProfileFace(
            oc,
            { plane, sketch: notCurrent, modelingTolerance: 1e-3 },
            region!,
          ),
        `a ${state} record fails closed`,
      ).toThrow(
        new RegExp(`^profile-boundary-unresolved: Sketch .* derived output is ${state}; `),
      );
    }
  }

  await testRegionBasisFollowsItsWholeSketchRecord();
  await testNonBitwiseDeclaredJoinsBuildValidFaces();
  await testPointTouchingLoopsBuildValidFaces();
  await testSplitCircleChordCellsBuildAsBoundedArcs();
  await testClosedSplineBoundaryBuildsExactBezierEdges();
  await testMultiPieceSourceCurveKeysEachSplitSegmentDistinctly();
  await testRejectsMultipleOuterLoops();
  await testMixedTrimmedAndAuthoredLoopSharesCornerVertices();

  console.log("OCC phase 3 sketch profile tests passed.");
});

// T10d: open-profile chaining reads the arrangement's own declared-join
// classes. Every published declared-join vertex names exactly the sketch
// points of one `declaredJoinClasses` class (satisfied coincident and shared
// ids join; an unsatisfied coincident does not).
test("declaredJoinClasses are the region output's declared-join classes", async () => {
  const deriver = createSketchArrangementDeriver(
    createCertifiedNeutralCurveQueryCapabilityForTest(),
  );
  const fixture = makeSketchFixture();
  fixture.point("a", 0, 0);
  fixture.point("b", 4, 0);
  fixture.point("b2", 4, 0.0003);
  fixture.point("c", 2, 3);
  fixture.point("c2", 2.0002, 3);
  fixture.point("q", 9, 9);
  fixture.point("q2", 9, 9);
  fixture.line("ab", "a", "b");
  fixture.line("bc", "b2", "c");
  fixture.line("ca", "c2", "a");
  fixture.coincident("b", "b2");
  fixture.coincident("c", "c2");
  const unsatisfied = fixture.coincident("q", "q2");
  const input = fixture.build();
  const solvedSnapshot = {
    ...input.solvedSnapshot,
    constraintStatuses: input.solvedSnapshot.constraintStatuses.map((entry) =>
      entry.constraintId === unsatisfied
        ? { ...entry, status: "unsatisfied" as const }
        : entry,
    ),
  };
  // Any unsatisfied constraint makes regions unavailable, so the regions are
  // derived from the all-satisfied solve and the q pair is checked on classes.
  const { regions } = await deriver.derive(input);
  expect(regions, "premise: the declared triangle derives").toHaveLength(1);
  const classes = declaredJoinClasses(input.definition, input.solvedSnapshot);
  const members = (root: string) =>
    input.definition.points
      .map((point) => point.pointId)
      .filter((pointId) => classes.find(pointId) === root)
      .sort();
  const joins = regions[0]!.loops
    .flatMap((loop) => loop.segments.map((segment) => segment.start))
    .filter((vertex) => vertex?.kind === "declaredJoin");
  expect(joins, "premise: three declared corners").toHaveLength(3);
  for (const join of joins) {
    if (join?.kind !== "declaredJoin") continue;
    expect(
      join.pointIds,
      `corner ${join.key} names exactly one declaredJoinClasses class`,
    ).toEqual(members(classes.find(join.pointIds[0]!)));
  }
  expect(classes.find("sketch_point_b"), "a satisfied coincident joins").toBe(
    classes.find("sketch_point_b2"),
  );
  expect(
    classes.find("sketch_point_q"),
    "premise: the satisfied q coincident joins",
  ).toBe(classes.find("sketch_point_q2"));
  const withUnsatisfied = declaredJoinClasses(input.definition, solvedSnapshot);
  expect(
    withUnsatisfied.find("sketch_point_q"),
    "an unsatisfied coincident does not join (bitwise-equal points)",
  ).not.toBe(withUnsatisfied.find("sketch_point_q2"));
});
