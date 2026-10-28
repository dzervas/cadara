import { test, expect } from "vitest";

import type { SketchDefinition } from "@/contracts/sketch/schema";
import {
  resolveHandleFromTarget,
  resolveSketchDragIntent,
} from "@/core/editor/sketch-session/drag-intent";
import type { PrimitiveRef } from "@/core/editor/schema";
import { derivedTargetsDefinition, pid } from "@/core/editor/sketch-mirror.fixtures";

// Lane: logic (docs/testing.md). Seam: the deterministic per-handle drag intent
// contract in src/core/editor/sketch-session/drag-intent.ts. These tests prove
// the sketch-drag-semantics guarantee that the drag intent is decided by the
// grabbed handle (point vs entity body vs rim vs center), not by solver luck.
test("src/core/editor/sketch-drag-intent.spec.ts", () => {
  function point(pointId: string, x: number, y: number) {
    return {
      pointId: pointId as `sketch_point_${string}`,
      label: pointId,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: pointId as `sketch_point_${string}`,
      } as const,
      position: [x, y] as const,
      isConstruction: false,
    };
  }

  const definition: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: ["sketch_point_start", "sketch_point_end", "sketch_point_center", "sketch_point_arc_center"],
    points: [
      point("sketch_point_start", 0, 0),
      point("sketch_point_end", 4, 0),
      point("sketch_point_center", 2, 2),
      point("sketch_point_arc_center", 2, 0),
    ],
    entityIds: ["sketch_entity_line", "sketch_entity_circle", "sketch_entity_arc"],
    entities: [
      {
        kind: "lineSegment",
        entityId: "sketch_entity_line",
        label: "Line",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "sketch_entity_line",
        } as const,
        isConstruction: false,
        startPointId: "sketch_point_start",
        endPointId: "sketch_point_end",
      },
      {
        kind: "circle",
        entityId: "sketch_entity_circle",
        label: "Circle",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "sketch_entity_circle",
        } as const,
        isConstruction: false,
        centerPointId: "sketch_point_center",
        radius: 3,
      },
      {
        kind: "arc",
        entityId: "sketch_entity_arc",
        label: "Arc",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "sketch_entity_arc",
        } as const,
        isConstruction: false,
        centerPointId: "sketch_point_arc_center",
        startPointId: "sketch_point_start",
        endPointId: "sketch_point_end",
        sweepDirection: "counterClockwise",
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };

  function testPointHandleTargetsOnlyThatPoint() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "point",
      pointId: "sketch_point_end",
    });
    expect(intent, "Point handle should resolve an intent.").toEqual({
      kind: "point",
      pointId: "sketch_point_end",
    });
  }

  function testEntityBodyHandleTranslatesAllDefiningPoints() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "entityBody",
      entityId: "sketch_entity_line",
    });
    expect(
      intent?.kind,
      "Entity-body handle should request a translation intent.",
    ).toBe("translate");
    expect(
      intent?.kind === "translate" ? [...intent.pointIds] : [],
      "Entity-body drag should translate every defining point of the line.",
    ).toEqual(["sketch_point_start", "sketch_point_end"]);
  }

  function testCircleRimHandleTargetsRadiusNotCenter() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "rim",
      entityId: "sketch_entity_circle",
    });
    expect(intent, "Circle rim handle should resolve a radius intent.").toEqual({
      kind: "radius",
      entityId: "sketch_entity_circle",
    });
  }

  function testCircleCenterHandleTranslatesCenter() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "center",
      entityId: "sketch_entity_circle",
    });
    expect(
      intent?.kind === "translate" ? [...intent.pointIds] : null,
      "Circle center handle should translate the center point.",
    ).toEqual(["sketch_point_center"]);
  }

  function testArcCenterHandleTranslatesWholeArc() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "center",
      entityId: "sketch_entity_arc",
    });
    expect(
      intent?.kind === "translate" ? [...intent.pointIds] : null,
      "Arc center handle must translate every defining point of the arc (center alone would deform it).",
    ).toEqual(["sketch_point_arc_center", "sketch_point_start", "sketch_point_end"]);
  }

  function testRimHandleOnNonRadialEntityIsRejected() {
    const intent = resolveSketchDragIntent(definition, {
      kind: "rim",
      entityId: "sketch_entity_line",
    });
    expect(
      intent,
      "A rim handle is only meaningful for circles and arcs.",
    ).toBe(null);
  }

  testPointHandleTargetsOnlyThatPoint();
  testEntityBodyHandleTranslatesAllDefiningPoints();
  testCircleRimHandleTargetsRadiusNotCenter();
  testCircleCenterHandleTranslatesCenter();
  testArcCenterHandleTranslatesWholeArc();
  testRimHandleOnNonRadialEntityIsRejected();
});

// T12b: intent mapping rows for tangent handle and non-draggable targets.
test("T12b: tangent handle, spline body, arc rim, and non-draggable intent mapping", () => {
  function point(pointId: string, x: number, y: number) {
    return {
      pointId: pointId as `sketch_point_${string}`,
      label: pointId,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: pointId as `sketch_point_${string}`,
      } as const,
      position: [x, y] as const,
      isConstruction: false,
    };
  }

  const splineDefinition: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_c"],
    points: [point("sketch_point_a", 0, 0), point("sketch_point_b", 2, 3), point("sketch_point_c", 5, 0)],
    entityIds: ["sketch_entity_spline", "sketch_entity_derived"],
    entities: [
      {
        kind: "spline",
        entityId: "sketch_entity_spline",
        label: "Spline",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "sketch_entity_spline",
        } as const,
        isConstruction: false,
        closure: "open",
        interpolationPolicy: "centripetal-mean-arm-v1",
        pointOccurrenceIds: ["occ_a", "occ_b", "occ_c"],
        pointOccurrences: [
          {
            occurrenceId: "occ_a",
            pointId: "sketch_point_a",
            tangent: { kind: "authored" as const, vector: [1, 0] as const },
          },
          {
            occurrenceId: "occ_b",
            pointId: "sketch_point_b",
            tangent: { kind: "automatic" as const },
          },
          {
            occurrenceId: "occ_c",
            pointId: "sketch_point_c",
            tangent: { kind: "authored" as const, vector: [0, -1] as const },
          },
        ],
      },
      {
        kind: "derivedPiecewiseCubic",
        entityId: "sketch_entity_derived",
        label: "Derived",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "sketch_entity_derived",
        } as const,
        isConstruction: false,
        derivationId: "rel_offset",
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };

  function testTangentHandleOnAuthoredTangentResolvesToTangentVectorIntent() {
    const intent = resolveSketchDragIntent(splineDefinition, {
      kind: "tangentHandle",
      entityId: "sketch_entity_spline",
      occurrenceId: "occ_a",
      pointId: "sketch_point_a",
    });
    expect(
      intent,
      "Tangent handle on authored tangent should resolve a tangentVector intent.",
    ).toEqual({
      kind: "tangentVector",
      entityId: "sketch_entity_spline",
      occurrenceId: "occ_a",
      pointId: "sketch_point_a",
    });
  }

  function testTangentHandleOnAutomaticTangentStillResolves() {
    // The intent resolver does not distinguish automatic vs authored;
    // the conversion to authored happens at drag start.
    const intent = resolveSketchDragIntent(splineDefinition, {
      kind: "tangentHandle",
      entityId: "sketch_entity_spline",
      occurrenceId: "occ_b",
      pointId: "sketch_point_b",
    });
    expect(
      intent,
      "Tangent handle on automatic tangent should still resolve a tangentVector intent.",
    ).toEqual({
      kind: "tangentVector",
      entityId: "sketch_entity_spline",
      occurrenceId: "occ_b",
      pointId: "sketch_point_b",
    });
  }

  function testTangentHandleOnNonSplineEntityIsRejected() {
    const intent = resolveSketchDragIntent(splineDefinition, {
      kind: "tangentHandle",
      entityId: "sketch_entity_derived",
      occurrenceId: "occ_a",
      pointId: "sketch_point_a",
    });
    expect(
      intent,
      "Tangent handle is only meaningful for spline entities.",
    ).toBe(null);
  }

  function testSplineBodyHandleTranslatesAllFitPoints() {
    const intent = resolveSketchDragIntent(splineDefinition, {
      kind: "entityBody",
      entityId: "sketch_entity_spline",
    });
    expect(
      intent?.kind,
      "Spline body handle should request a translation intent.",
    ).toBe("translate");
    expect(
      intent?.kind === "translate" ? [...intent.pointIds] : [],
      "Spline body drag should translate every fit point.",
    ).toEqual(["sketch_point_a", "sketch_point_b", "sketch_point_c"]);
  }

  function testDerivedEntityBodyReturnsNull() {
    const intent = resolveSketchDragIntent(splineDefinition, {
      kind: "entityBody",
      entityId: "sketch_entity_derived",
    });
    expect(
      intent,
      "Derived entity (offset output) has no defining points and should not be draggable.",
    ).toBe(null);
  }

  function testArcRimHandleTargetsRadius() {
    // Use the original definition which has an arc.
    const arcDef: SketchDefinition = {
      ...splineDefinition,
      entityIds: ["sketch_entity_arc"],
      entities: [
        {
          kind: "arc",
          entityId: "sketch_entity_arc",
          label: "Arc",
          target: {
            kind: "sketchEntity",
            sketchId: "sketch_primary",
            entityId: "sketch_entity_arc",
          } as const,
          isConstruction: false,
          centerPointId: "sketch_point_b",
          startPointId: "sketch_point_a",
          endPointId: "sketch_point_c",
          sweepDirection: "counterClockwise",
        },
      ],
    };
    const intent = resolveSketchDragIntent(arcDef, {
      kind: "rim",
      entityId: "sketch_entity_arc",
    });
    expect(
      intent,
      "Arc rim handle should resolve a radius intent.",
    ).toEqual({ kind: "radius", entityId: "sketch_entity_arc" });
  }

  testTangentHandleOnAuthoredTangentResolvesToTangentVectorIntent();
  testTangentHandleOnAutomaticTangentStillResolves();
  testTangentHandleOnNonSplineEntityIsRejected();
  testSplineBodyHandleTranslatesAllFitPoints();
  testDerivedEntityBodyReturnsNull();
  testArcRimHandleTargetsRadius();
});

// T12c: D10 handle resolution from PrimitiveRef + definition.
test("T12c D10: resolveHandleFromTarget maps PrimitiveRef to the correct handle", () => {
  function point(pointId: string, x: number, y: number) {
    return {
      pointId: pointId as `sketch_point_${string}`,
      label: pointId,
      target: {
        kind: "sketchPoint" as const,
        sketchId: "sketch_primary" as `sketch_${string}`,
        pointId: pointId as `sketch_point_${string}`,
      },
      position: [x, y] as const,
      isConstruction: false,
    };
  }

  const definition: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: ["sketch_point_start", "sketch_point_end", "sketch_point_center", "sketch_point_shared"],
    points: [
      point("sketch_point_start", 0, 0),
      point("sketch_point_end", 4, 0),
      point("sketch_point_center", 2, 2),
      point("sketch_point_shared", 5, 5),
    ],
    entityIds: ["sketch_entity_line", "sketch_entity_circle", "sketch_entity_arc", "sketch_entity_derived"],
    entities: [
      {
        kind: "lineSegment",
        entityId: "sketch_entity_line",
        label: "Line",
        target: {
          kind: "sketchEntity" as const,
          sketchId: "sketch_primary" as `sketch_${string}`,
          entityId: "sketch_entity_line",
        },
        isConstruction: false,
        startPointId: "sketch_point_start",
        endPointId: "sketch_point_end",
      },
      {
        kind: "circle",
        entityId: "sketch_entity_circle",
        label: "Circle",
        target: {
          kind: "sketchEntity" as const,
          sketchId: "sketch_primary" as `sketch_${string}`,
          entityId: "sketch_entity_circle",
        },
        isConstruction: false,
        centerPointId: "sketch_point_center",
        radius: 3,
      },
      {
        kind: "arc",
        entityId: "sketch_entity_arc",
        label: "Arc",
        target: {
          kind: "sketchEntity" as const,
          sketchId: "sketch_primary" as `sketch_${string}`,
          entityId: "sketch_entity_arc",
        },
        isConstruction: false,
        centerPointId: "sketch_point_center",
        startPointId: "sketch_point_start",
        endPointId: "sketch_point_end",
        sweepDirection: "counterClockwise" as const,
      },
      {
        kind: "derivedPiecewiseCubic",
        entityId: "sketch_entity_derived",
        label: "Derived",
        target: {
          kind: "sketchEntity" as const,
          sketchId: "sketch_primary" as `sketch_${string}`,
          entityId: "sketch_entity_derived",
        },
        isConstruction: false,
        derivationId: "rel_offset",
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };

  // Line body → entityBody
  function testLineBodyResolvesToEntityBody() {
    const handle = resolveHandleFromTarget(definition, {
      kind: "sketchEntity",
      sketchId: "sketch_primary" as `sketch_${string}`,
      entityId: "sketch_entity_line",
    }, null);
    expect(
      handle,
      "Line entity target should resolve to entityBody handle.",
    ).toEqual({ kind: "entityBody", entityId: "sketch_entity_line" });
  }

  // Circle body → rim
  function testCircleBodyResolvesToRim() {
    const handle = resolveHandleFromTarget(definition, {
      kind: "sketchEntity",
      sketchId: "sketch_primary" as `sketch_${string}`,
      entityId: "sketch_entity_circle",
    }, null);
    expect(
      handle,
      "Circle entity target should resolve to rim handle.",
    ).toEqual({ kind: "rim", entityId: "sketch_entity_circle" });
  }

  // Arc body → rim
  function testArcBodyResolvesToRim() {
    const handle = resolveHandleFromTarget(definition, {
      kind: "sketchEntity",
      sketchId: "sketch_primary" as `sketch_${string}`,
      entityId: "sketch_entity_arc",
    }, null);
    expect(
      handle,
      "Arc entity target should resolve to rim handle.",
    ).toEqual({ kind: "rim", entityId: "sketch_entity_arc" });
  }

  // Centre of exactly one circle → center
  function testCentreOfOneCircleResolvesToCenter() {
    const handle = resolveHandleFromTarget(definition, {
      kind: "sketchPoint",
      sketchId: "sketch_primary" as `sketch_${string}`,
      pointId: "sketch_point_center",
    }, null);
    // p_center is the centre of both e_circle and e_arc, so it should NOT
    // resolve to center — it should be a plain point.
    expect(
      handle,
      "A point that is centre of two entities should be a plain point handle.",
    ).toEqual({ kind: "point", pointId: "sketch_point_center" });
  }

  // Centre of exactly one circle → center (test with only one)
  function testExclusiveCentreResolvesToCenter() {
    const singleCircleDef: SketchDefinition = {
      ...definition,
      entityIds: ["sketch_entity_circle"],
      entities: [definition.entities[1]!],
    };
    const handle = resolveHandleFromTarget(singleCircleDef, {
      kind: "sketchPoint",
      sketchId: "sketch_primary" as `sketch_${string}`,
      pointId: "sketch_point_center",
    }, null);
    expect(
      handle,
      "Centre of exactly one circle should resolve to center handle.",
    ).toEqual({ kind: "center", entityId: "sketch_entity_circle" });
  }

  // Non-centre sketch point → point
  function testNonCentrePointResolvesToPoint() {
    const handle = resolveHandleFromTarget(definition, {
      kind: "sketchPoint",
      sketchId: "sketch_primary" as `sketch_${string}`,
      pointId: "sketch_point_start",
    }, null);
    expect(
      handle,
      "Non-centre sketch point should resolve to point handle.",
    ).toEqual({ kind: "point", pointId: "sketch_point_start" });
  }

  // Derived entity → null (D9 refusal)
  function testDerivedEntityReturnsNull() {
    const handle = resolveHandleFromTarget(definition, {
      kind: "sketchEntity",
      sketchId: "sketch_primary" as `sketch_${string}`,
      entityId: "sketch_entity_derived",
    }, null);
    expect(
      handle,
      "Derived entity (offset output) should not be draggable.",
    ).toBe(null);
  }

  // Non-sketch target → null
  function testNonSketchTargetReturnsNull() {
    const handle = resolveHandleFromTarget(definition, {
      kind: "feature",
      featureId: "feature_1",
    }, null);
    expect(
      handle,
      "Non-sketch targets should not be draggable.",
    ).toBe(null);
  }

  // Construction line → entityBody (construction follows same rules)
  function testConstructionCurveIsDraggable() {
    const constructionDef: SketchDefinition = {
      ...definition,
      entityIds: ["sketch_entity_construction_line"],
      entities: [
        {
          kind: "lineSegment",
          entityId: "sketch_entity_construction_line",
          label: "Construction Line",
          target: {
            kind: "sketchEntity" as const,
            sketchId: "sketch_primary" as `sketch_${string}`,
            entityId: "sketch_entity_construction_line",
          },
          isConstruction: true,
          startPointId: "sketch_point_start",
          endPointId: "sketch_point_end",
        },
      ],
    };
    const handle = resolveHandleFromTarget(constructionDef, {
      kind: "sketchEntity",
      sketchId: "sketch_primary" as `sketch_${string}`,
      entityId: "sketch_entity_construction_line",
    }, null);
    expect(
      handle,
      "Construction line should resolve to entityBody handle.",
    ).toEqual({ kind: "entityBody", entityId: "sketch_entity_construction_line" });
  }

  // A-2: D9 refusal rows for every non-draggable PrimitiveRef kind.
  function testD9RefusalsForEveryKind() {
    // Every D9 non-draggable PrimitiveRef kind.
    const nonDraggableTargets: import("@/core/editor/schema").PrimitiveRef[] = [
      // Durable refs not in {sketchPoint, sketchEntity}:
      { kind: "feature", featureId: "feature_1" as `feature_${string}` },
      { kind: "body", bodyId: "body_1" as `body_${string}` },
      {
        kind: "face",
        bodyId: "body_1" as `body_${string}`,
        faceId: "face_1" as `face_${string}`,
      },
      {
        kind: "edge",
        bodyId: "body_1" as `body_${string}`,
        edgeId: "edge_1" as `edge_${string}`,
      },
      {
        kind: "vertex",
        bodyId: "body_1" as `body_${string}`,
        vertexId: "vertex_1" as `vertex_${string}`,
      },
      { kind: "sketch", sketchId: "sketch_1" as `sketch_${string}` },
      {
        kind: "sketchOperation",
        sketchId: "sketch_1" as `sketch_${string}`,
        operationId:
          "sketch_operation_1",
      },
      {
        kind: "constraint",
        sketchId: "sketch_1" as `sketch_${string}`,
        constraintId: "constraint_1" as `constraint_${string}`,
      },
      {
        kind: "dimension",
        sketchId: "sketch_1" as `sketch_${string}`,
        dimensionId: "dimension_1" as `dimension_${string}`,
      },
      {
        kind: "construction",
        constructionId: "construction_1" as `construction_${string}`,
      },
      {
        kind: "region",
        regionId: "region_1" as `region_${string}`,
        sketchId: "sketch_1" as `sketch_${string}`,
      },
      // Non-durable refs:
      {
        kind: "projectedReferenceGeometry",
        referenceId: "ref_1" as `ref_${string}`,
        geometryId: "projected_geometry_1",
        geometryKind: "lineSegment" as const,
      },
      {
        kind: "sketchExternalReference",
        referenceId: "ref_2" as `ref_${string}`,
      },
      {
        kind: "sketchDatumReference",
        sketchId: "sketch_1" as `sketch_${string}`,
        datumId: "origin" as const,
        geometryKind: "point" as const,
      },
    ];
    for (const target of nonDraggableTargets) {
      const handle = resolveHandleFromTarget(definition, target, null);
      expect(
        handle,
        `D9: ${target.kind} target should not be draggable.`,
      ).toBe(null);
    }
  }

  // T12d: sketchTangentHandle PrimitiveRef → tangentHandle drag handle.
  function testSketchTangentHandleRefResolvesToTangentHandle() {
    // Add a spline entity to the definition.
    const splineDef: SketchDefinition = {
      ...definition,
      pointIds: [...definition.pointIds, "sketch_point_0", "sketch_point_1", "sketch_point_2"],
      points: [
        ...definition.points,
        {
          pointId: "sketch_point_0",
          label: "sp_0",
          target: {
            kind: "sketchPoint" as const,
            sketchId: "sketch_primary" as `sketch_${string}`,
            pointId: "sketch_point_0",
          },
          position: [0, 3] as const,
          isConstruction: false,
        },
        {
          pointId: "sketch_point_1",
          label: "sp_1",
          target: {
            kind: "sketchPoint" as const,
            sketchId: "sketch_primary" as `sketch_${string}`,
            pointId: "sketch_point_1",
          },
          position: [2, 6] as const,
          isConstruction: false,
        },
        {
          pointId: "sketch_point_2",
          label: "sp_2",
          target: {
            kind: "sketchPoint" as const,
            sketchId: "sketch_primary" as `sketch_${string}`,
            pointId: "sketch_point_2",
          },
          position: [5, 3] as const,
          isConstruction: false,
        },
      ],
      entityIds: [...definition.entityIds, "sketch_entity_spline"],
      entities: [
        ...definition.entities,
        {
          kind: "spline",
          entityId: "sketch_entity_spline",
          label: "Spline",
          target: {
            kind: "sketchEntity" as const,
            sketchId: "sketch_primary" as `sketch_${string}`,
            entityId: "sketch_entity_spline",
          },
          isConstruction: false,
          closure: "open",
          interpolationPolicy: "centripetal-mean-arm-v1",
          pointOccurrenceIds: ["occ_0", "occ_1", "occ_2"],
          pointOccurrences: [
            {
              occurrenceId: "occ_0",
              pointId: "sketch_point_0",
              tangent: { kind: "automatic" as const },
            },
            {
              occurrenceId: "occ_1",
              pointId: "sketch_point_1",
              tangent: {
                kind: "authored" as const,
                vector: [1, 0] as const,
              },
            },
            {
              occurrenceId: "occ_2",
              pointId: "sketch_point_2",
              tangent: { kind: "automatic" as const },
            },
          ],
        },
      ],
    };
    const handle = resolveHandleFromTarget(splineDef, {
      kind: "sketchTangentHandle",
      sketchId: "sketch_primary" as `sketch_${string}`,
      entityId: "sketch_entity_spline",
      occurrenceId: "occ_1",
      pointId: "sketch_point_1",
    }, null);
    expect(
      handle,
      "T12d: sketchTangentHandle PrimitiveRef should resolve to tangentHandle.",
    ).toEqual({
      kind: "tangentHandle",
      entityId: "sketch_entity_spline",
      occurrenceId: "occ_1",
      pointId: "sketch_point_1",
    });
  }

  testLineBodyResolvesToEntityBody();
  testCircleBodyResolvesToRim();
  testArcBodyResolvesToRim();
  testCentreOfOneCircleResolvesToCenter();
  testExclusiveCentreResolvesToCenter();
  testNonCentrePointResolvesToPoint();
  testDerivedEntityReturnsNull();
  testNonSketchTargetReturnsNull();
  testConstructionCurveIsDraggable();
  testD9RefusalsForEveryKind();
  testSketchTangentHandleRefResolvesToTangentHandle();
});

// T15d D9′ ([TECH] T-10, review A-2; logic lane, seam: the pure handle
// resolver `resolveHandleFromTarget`). Mirror outputs resolve like authored
// geometry; pattern, transform and offset outputs and their driven points
// are one-way; a failed mirror's copy and a copy of a non-accepted offset
// output (G19) are not drag targets.
test("T15d D9′: mirror copies resolve to handles; one-way outputs and G19 non-accepted copies do not", () => {
  const { definition, outputOf, relationship, ids } =
    derivedTargetsDefinition();
  const point = (pointId: string) =>
    ({
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId,
    }) as PrimitiveRef;
  const entity = (entityId: string) =>
    ({
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId,
    }) as PrimitiveRef;
  const line = outputOf("ab");
  const circle = outputOf("c");
  const spline = outputOf("s");
  const splineCopy = definition.entities.find(
    (candidate) => candidate.entityId === spline.outputEntityId,
  );
  if (splineCopy?.kind !== "spline") throw new Error("spline copy");
  const copyHandle = {
    kind: "sketchTangentHandle",
    sketchId: "sketch_draft",
    entityId: spline.outputEntityId,
    occurrenceId: splineCopy.pointOccurrences[1]!.occurrenceId,
    pointId: spline.outputPointIds[1]!,
  } as PrimitiveRef;
  // An accepted solve: the offset certified, no failed mirror.
  const accepted = {
    solvedEntities: [],
    certifiedOffsetDerivationIds: [ids.offsetDerivationId],
  };
  expect(
    resolveHandleFromTarget(
      definition,
      point(line.outputPointIds[0]!),
      accepted,
    ),
  ).toEqual({
    kind: "point",
    pointId: line.outputPointIds[0],
  });
  expect(
    resolveHandleFromTarget(definition, entity(line.outputEntityId), accepted),
  ).toEqual({
    kind: "entityBody",
    entityId: line.outputEntityId,
  });
  expect(
    resolveHandleFromTarget(
      definition,
      entity(circle.outputEntityId),
      accepted,
    ),
  ).toEqual({
    kind: "rim",
    entityId: circle.outputEntityId,
  });
  expect(
    resolveHandleFromTarget(
      definition,
      point(circle.outputPointIds[0]!),
      accepted,
    ),
  ).toEqual({
    kind: "center",
    entityId: circle.outputEntityId,
  });
  expect(resolveHandleFromTarget(definition, copyHandle, accepted)?.kind).toBe(
    "tangentHandle",
  );
  // Review A-1 (decided; re-pin, was: a copy of a certified offset output is
  // draggable): the mirror image of a one-way output is one-way too, even
  // when the offset is certified, and through a mirror chain.
  for (const target of [
    point(ids.offsetCopyPoint),
    point(ids.patternCopyPoint),
    entity(ids.patternCopy),
    point(ids.patternCopyOfCopyPoint),
  ])
    expect(
      resolveHandleFromTarget(definition, target, accepted),
      `a mirror copy of a one-way output ${JSON.stringify(target)}`,
    ).toBeNull();

  for (const target of [
    entity(ids.patternLine),
    point(ids.patternPoint),
    entity(ids.transformLine),
    point(ids.transformPoint),
    entity(ids.offsetLine),
    point(ids.offsetPoint),
    entity(ids.jointArc),
    point(ids.jointCentre),
    entity(ids.shell),
    point(ids.shellEnd),
  ])
    expect(
      resolveHandleFromTarget(definition, target, accepted),
      `one-way output ${JSON.stringify(target)}`,
    ).toBeNull();

  // The offset not certified (no solve, or an uncertified one): its mirror
  // copy is G19 non-accepted.
  for (const acceptance of [null, { solvedEntities: [] }])
    expect(
      resolveHandleFromTarget(
        definition,
        point(ids.offsetCopyPoint),
        acceptance,
      ),
      "a copy of a non-accepted offset output",
    ).toBeNull();
  // The mirror failed (held copies).
  const failed = {
    ...accepted,
    failedDerivationIds: [relationship.derivationId],
  };
  for (const target of [
    point(line.outputPointIds[0]!),
    entity(line.outputEntityId),
    entity(circle.outputEntityId),
    point(circle.outputPointIds[0]!),
    copyHandle,
  ])
    expect(
      resolveHandleFromTarget(definition, target, failed),
      `a failed mirror's copy ${JSON.stringify(target)}`,
    ).toBeNull();
  expect(
    resolveHandleFromTarget(definition, point(pid("a")), failed),
    "control: the seed stays draggable",
  ).toEqual({ kind: "point", pointId: pid("a") });
});
