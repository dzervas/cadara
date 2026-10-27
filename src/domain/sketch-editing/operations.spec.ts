import { describe, test, expect } from "vitest";
import { createSketchActionOwnerFixture } from "@/application/editor/sketch-action-owner.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import { createSketchSessionFromSnapshot } from "@/domain/editor/sketch-session";
import { getSketchSessionDisplayRenderables } from "@/domain/editor/sketch-session/display";
import { updateSketchReferenceProjection } from "@/domain/editor/sketch-session/references";
import { createStandardPlaneDefinition, OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";

import type {
  NumericSketchDefinition,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import type { SketchPoint } from "@/contracts/modeling/schema";
import {
  evaluateSplineSpan,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import { nextUp } from "@/contracts/sketch/region-interval-geometry";
import { applySolvedSketchToDefinition } from "@/domain/editor/sketch-session/definition-patches";
import {
  FIXTURE_SKETCH_ID,
  closedCurvesSignedArea,
  literalResolvedDefinition,
  makeSketchFixture,
  neutralSpan,
  projectedSpline,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  querySketchEditIntersections,
  type SketchEditIntersectionResult,
} from "@/contracts/sketch/edit-intersections";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction";
import { solveSketchDefinitionCore } from "@/core/sketch-solver";
import { createArcEndpointDimensions } from "@/core/sketch-tools/constraints";
import { isAcceptedConstraintStatus } from "@/contracts/sketch/schema";
import { createSessionCommitFactories } from "@/domain/editor/sketch-session/tool-authoring";
import { describeSketchSessionUnsatisfiedRequirements } from "@/domain/editor/sketch-session/session-feedback";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { resolveSketchDimensionValues } from "@/domain/modeling/sketch-dimension-expressions";
import type { DimensionId, DocumentVariableId } from "@/contracts/shared/ids";
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import {
  createOffsetContribution,
  createSketchChamferMutation,
  createSketchExtendMutation,
  createSketchFilletMutation,
  createSketchDerivedTransformContribution,
  createSketchOffsetDerivationContribution,
  createSketchSlotContribution,
  createSketchSplitMutation,
  createSketchTrimMutation,
  offsetCurveDescriptorFromProjectedGeometry,
  PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE,
  SPLINE_SLOT_UNSUPPORTED_MESSAGE,
  splineTrimCutMismatchMessage,
  type SketchEditOperationFactories,
} from "@/domain/sketch-editing/operations";

test("src/domain/sketch-editing/operations.spec.ts", async () => {
  function makePoint(
    pointId: string,
    label: string,
    position: SketchPoint,
  ): SketchPointDefinition {
    return {
      pointId: pointId as SketchPointId,
      label,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_primary" as SketchId,
        pointId: pointId as SketchPointId,
      },
      position,
      isConstruction: false,
    };
  }

  function makeLine(
    entityId: string,
    label: string,
    startPointId: string,
    endPointId: string,
  ): SketchEntityDefinition {
    return {
      kind: "lineSegment" as const,
      entityId: entityId as SketchEntityId,
      label,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary" as SketchId,
        entityId: entityId as SketchEntityId,
      },
      isConstruction: false,
      startPointId: startPointId as SketchPointId,
      endPointId: endPointId as SketchPointId,
    };
  }

  function makeArc(
    entityId: string,
    label: string,
    centerPointId: string,
    startPointId: string,
    endPointId: string,
  ): SketchEntityDefinition {
    return {
      kind: "arc" as const,
      entityId: entityId as SketchEntityId,
      label,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary" as SketchId,
        entityId: entityId as SketchEntityId,
      },
      isConstruction: false,
      centerPointId: centerPointId as SketchPointId,
      startPointId: startPointId as SketchPointId,
      endPointId: endPointId as SketchPointId,
      sweepDirection: "counterClockwise" as const,
    };
  }

  function makeSpline(
    entityId: string,
    label: string,
    fitPointIds: readonly string[],
  ): SketchEntityDefinition {
    return {
      kind: "spline" as const,
      entityId: entityId as SketchEntityId,
      label,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary" as SketchId,
        entityId: entityId as SketchEntityId,
      },
      isConstruction: false,
      pointOccurrenceIds: fitPointIds.map((_, index) => `occ-${index}`),
      pointOccurrences: fitPointIds.map((pointId, index) => ({
        occurrenceId: `occ-${index}`,
        pointId: pointId as SketchPointId,
        tangent: { kind: "automatic" },
      })),
      closure: "open",
      interpolationPolicy: "centripetal-mean-arm-v1",
    };
  }

  function makeDefinition(
    points: SketchDefinition["points"],
    entities: SketchDefinition["entities"],
  ): SketchDefinition {
    return {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
  }

  function createFactories(): SketchEditOperationFactories {
    return {
      createPointId: (suffix) => `sketch_point_10_${suffix}` as SketchPointId,
      createPointEntity: (label, entityId, pointId) =>
        ({
          pointId,
          label,
          target: {
            kind: "sketchEntity",
            sketchId: "sketch_primary" as SketchId,
            entityId,
          },
          isConstruction: false,
        }) as SketchEntityDefinition,
      createEntityId: (suffix) =>
        `sketch_entity_10_${suffix}` as SketchEntityId,
      createConstraintId: (suffix) => `constraint_10_${suffix}` as const,
      createDimensionId: (suffix) => `dimension_10_${suffix}` as const,
      createPoint: (label, pointId, position) => ({
        pointId,
        label,
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary" as SketchId,
          pointId,
        },
        position,
        isConstruction: false,
      }),
      createLineEntity: (label, entityId, startPointId, endPointId) => ({
        kind: "lineSegment",
        entityId,
        label,
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary" as SketchId,
          entityId,
        },
        isConstruction: false,
        startPointId,
        endPointId,
      }),
      createCircleEntity: (label, entityId, centerPointId, radius) => ({
        kind: "circle",
        entityId,
        label,
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary" as SketchId,
          entityId,
        },
        isConstruction: false,
        centerPointId,
        radius,
      }),
      createArcEntity: (
        label,
        entityId,
        centerPointId,
        startPointId,
        endPointId,
        sweepDirection,
      ) => ({
        kind: "arc",
        entityId,
        label,
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary" as SketchId,
          entityId,
        },
        isConstruction: false,
        centerPointId,
        startPointId,
        endPointId,
        sweepDirection,
      }),
      createSplineEntity: (label, entityId, pointIds) => ({
        kind: "spline",
        entityId,
        label,
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary" as SketchId,
          entityId,
        },
        isConstruction: false,
        pointOccurrenceIds: pointIds.map(
          (_, index) => `${entityId}-occ-${index}`,
        ),
        pointOccurrences: pointIds.map((pointId, index) => ({
          occurrenceId: `${entityId}-occ-${index}`,
          pointId,
          tangent: { kind: "automatic" },
        })),
        closure: "open",
        interpolationPolicy: "centripetal-mean-arm-v1",
      }),
    };
  }

  function createCornerDefinition() {
    const points = [
      makePoint("sketch_point_a", "A", [0, 0]),
      makePoint("sketch_point_b", "B", [4, 0]),
      makePoint("sketch_point_c", "C", [0, 4]),
    ];
    return makeDefinition(points, [
      makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
      makeLine("sketch_entity_ac", "AC", "sketch_point_a", "sketch_point_c"),
    ]);
  }

  function createCrossingDefinition() {
    const points = [
      makePoint("sketch_point_a", "A", [0, 0]),
      makePoint("sketch_point_b", "B", [4, 0]),
      makePoint("sketch_point_c", "C", [2, -1]),
      makePoint("sketch_point_d", "D", [2, 1]),
    ];
    return makeDefinition(points, [
      makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
      makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
    ]);
  }

  function testFilletAndChamferMutateAdjacentLines() {
    const fillet = createSketchFilletMutation({
      definition: createCornerDefinition(),
      entityIds: ["sketch_entity_ab", "sketch_entity_ac"] as SketchEntityId[],
      radius: 1,
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      fillet.valid && fillet.definition,
      "Fillet should accept adjacent line segments.",
    ).toBeTruthy();
    expect(
      fillet.definition?.entities.some((entity) => entity.kind === "arc"),
      "Fillet should add a durable arc.",
    ).toBeTruthy();
    expect(
      fillet.previewEntities.length > 0,
      "Fillet should expose preview geometry.",
    ).toBeTruthy();

    const chamfer = createSketchChamferMutation({
      definition: createCornerDefinition(),
      entityIds: ["sketch_entity_ab", "sketch_entity_ac"] as SketchEntityId[],
      distance: 1,
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      chamfer.valid && chamfer.definition,
      "Chamfer should accept adjacent line segments.",
    ).toBeTruthy();
    expect(
      chamfer.definition?.entities.length,
      "Chamfer should preserve source lines and add one chamfer line.",
    ).toBe(3);
  }

  const solveLines = (definition: SketchDefinition) =>
    solveSketchDefinitionCore({
      definition: literalResolvedDefinition(definition),
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    }).solvedSnapshot;

  /**
   * T10g-2: the verified edit intersections of an Extend/Split of AB by CD
   * on the definition's accepted solve (the one contract function).
   */
  async function lineEditIntersections(
    definition: SketchDefinition,
    kind: "extend" | "split",
  ) {
    const result = await querySketchEditIntersections(
      {
        definition: literalResolvedDefinition(definition),
        solvedSnapshot: solveLines(definition),
        projectedReferences: [],
        modelingTolerance: 1e-3,
        operation: {
          kind,
          targetEntityId: "sketch_entity_ab" as SketchEntityId,
          boundaryEntityId: "sketch_entity_cd" as SketchEntityId,
        },
      },
      createCertifiedNeutralCurveQueryCapabilityForTest(),
    );
    if (result.kind !== "verified") throw new Error(result.message);
    return result;
  }

  async function testExtendAndSplitMutateOnlySelectedLine() {
    const extendDefinition = makeDefinition(
      [
        makePoint("sketch_point_a", "A", [0, 0]),
        makePoint("sketch_point_b", "B", [1, 0]),
        makePoint("sketch_point_c", "C", [3, -1]),
        makePoint("sketch_point_d", "D", [3, 1]),
      ],
      [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
      ],
    );
    const extended = createSketchExtendMutation({
      definition: extendDefinition,
      targetEntityId: "sketch_entity_ab" as SketchEntityId,
      intersections: await lineEditIntersections(extendDefinition, "extend"),
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      extended.changed && extended.definition,
      "Extend should accept a target line and boundary line.",
    ).toBeTruthy();
    expect(
      extended.definition.entities.length,
      "Extend should not add unrelated entities.",
    ).toBe(extendDefinition.entities.length);
    expect(
      extended.definition.points.some(
        (point) => point.position[0] === 3 && point.position[1] === 0,
      ),
      "Extend should add an endpoint at the boundary intersection.",
    ).toBeTruthy();
    expect(
      extended.definition.constraints.map((constraint) =>
        constraint.kind === "pointOnCurve"
          ? [constraint.curve.entityId, constraint.label]
          : constraint.kind,
      ),
      "Q1b: the extended end is tied onto the boundary line.",
    ).toEqual([["sketch_entity_cd", "AB extend end on CD"]]);

    const crossing = createCrossingDefinition();
    const split = createSketchSplitMutation({
      definition: crossing,
      targetEntityId: "sketch_entity_ab" as SketchEntityId,
      intersections: await lineEditIntersections(crossing, "split"),
      solvedSnapshot: solveLines(crossing),
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      split.changed && split.definition,
      "Split should accept a target line and crossing boundary.",
    ).toBeTruthy();
    expect(
      split.definition.entities.length,
      "Split should divide the selected line into two line entities.",
    ).toBe(3);
    expect(
      split.definition.constraints.map((constraint) =>
        constraint.kind === "pointOnCurve"
          ? [constraint.curve.entityId, constraint.label]
          : constraint.kind,
      ),
      "Q1b: the one split point is tied once onto the boundary.",
    ).toEqual([["sketch_entity_cd", "AB split on CD"]]);
  }

  function testSlotCreatesDurableGeometryForSupportedReferences() {
    const lineDefinition = makeDefinition(
      [
        makePoint("sketch_point_a", "A", [0, 0]),
        makePoint("sketch_point_b", "B", [4, 0]),
      ],
      [makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b")],
    );
    const lineSlot = createSketchSlotContribution({
      definition: lineDefinition,
      entityIds: ["sketch_entity_ab"] as SketchEntityId[],
      width: 2,
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      lineSlot.valid && lineSlot.contribution,
      "Slot should accept a line reference.",
    ).toBeTruthy();
    expect(
      lineSlot.contribution?.entities.filter((entity) => entity.kind === "arc")
        .length,
      "Line slot should add rounded end arcs.",
    ).toBe(2);

    const curveDefinition = makeDefinition(
      [
        makePoint("sketch_point_center", "Center", [0, 0]),
        makePoint("sketch_point_start", "Start", [2, 0]),
        makePoint("sketch_point_end", "End", [0, 2]),
        makePoint("sketch_point_s0", "S0", [0, 0]),
        makePoint("sketch_point_s1", "S1", [1, 2]),
        makePoint("sketch_point_s2", "S2", [2, 0]),
      ],
      [
        makeArc(
          "sketch_entity_arc",
          "Arc",
          "sketch_point_center",
          "sketch_point_start",
          "sketch_point_end",
        ),
        makeSpline("sketch_entity_spline", "Spline", [
          "sketch_point_s0",
          "sketch_point_s1",
          "sketch_point_s2",
        ]),
      ],
    );
    const arcSlot = createSketchSlotContribution({
      definition: curveDefinition,
      entityIds: ["sketch_entity_arc"] as SketchEntityId[],
      width: 1,
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      arcSlot.valid && arcSlot.contribution,
      "Slot should accept an arc reference.",
    ).toBeTruthy();
    expect(
      arcSlot.contribution?.entities.some((entity) => entity.kind === "arc"),
      "Arc slot should create arc boundary geometry.",
    ).toBeTruthy();

    const splineSlot = createSketchSlotContribution({
      definition: curveDefinition,
      entityIds: ["sketch_entity_spline"] as SketchEntityId[],
      width: 1,
      sequence: 10,
      factories: createFactories(),
    });
    // T10h (D6, user decision Q2 = S1): Slot along a spline is refused
    // explicitly, also before a width is set.
    expect(
      splineSlot,
      "Slot along a spline should be refused as not supported yet.",
    ).toMatchObject({
      valid: false,
      message: SPLINE_SLOT_UNSUPPORTED_MESSAGE,
      definition: null,
      contribution: null,
      previewEntities: [],
    });
    expect(
      createSketchSlotContribution({
        definition: curveDefinition,
        entityIds: ["sketch_entity_spline"] as SketchEntityId[],
        width: null,
        sequence: 10,
        factories: createFactories(),
      }).message,
      "The spline refusal comes before the width check.",
    ).toBe(SPLINE_SLOT_UNSUPPORTED_MESSAGE);
  }

  function testSlotCreatesProfileOffsetsForClosedLineLoops() {
    const definition = makeDefinition(
      [
        makePoint("sketch_point_a", "A", [0, 0]),
        makePoint("sketch_point_b", "B", [4, 0]),
        makePoint("sketch_point_c", "C", [4, 3]),
        makePoint("sketch_point_d", "D", [0, 3]),
      ],
      [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_da", "DA", "sketch_point_d", "sketch_point_a"),
      ],
    );
    const slot = createSketchSlotContribution({
      definition,
      entityIds: definition.entityIds,
      width: 1,
      sequence: 10,
      factories: createFactories(),
    });

    expect(
      slot.valid && slot.contribution,
      "Slot should accept a closed line profile.",
    ).toBeTruthy();
    expect(
      slot.contribution?.entities.length,
      "Closed profile slot should create outer and inner line loops.",
    ).toBe(8);
  }

  function expectPointCloseTo(
    actual: SketchPoint | undefined,
    expected: SketchPoint,
    label: string,
  ) {
    expect(actual, `${label} should exist.`).toBeTruthy();
    expect(actual![0], `${label} x`).toBeCloseTo(expected[0], 6);
    expect(actual![1], `${label} y`).toBeCloseTo(expected[1], 6);
  }

  function testOffsetCharacterizationSingleCurves() {
    // D6 static offset: one curve descriptor in (projected reference
    // geometry); sketch entities take the derivation path.
    const line = {
      kind: "lineSegment" as const,
      isConstruction: false,
      style: undefined,
      start: [0, 0] as SketchPoint,
      end: [4, 0] as SketchPoint,
    };
    const leftLine = createOffsetContribution({
      curve: line,
      distance: 1,
      side: "left",
      sequence: 10,
      factories: createFactories(),
    });
    expect(leftLine.valid, "Left line offset should be valid.").toBeTruthy();
    expectPointCloseTo(
      leftLine.contribution?.points[0]?.position,
      [0, 1],
      "Left line offset start",
    );
    expectPointCloseTo(
      leftLine.contribution?.points[1]?.position,
      [4, 1],
      "Left line offset end",
    );

    const rightLine = createOffsetContribution({
      curve: line,
      distance: 1,
      side: "right",
      sequence: 10,
      factories: createFactories(),
    });
    expectPointCloseTo(
      rightLine.contribution?.points[0]?.position,
      [0, -1],
      "Right line offset start",
    );

    const circle = {
      kind: "circle" as const,
      isConstruction: false,
      style: undefined,
      center: [1, 1] as SketchPoint,
      radius: 2,
    };
    const grownCircle = createOffsetContribution({
      curve: circle,
      distance: 0.5,
      side: "left",
      sequence: 10,
      factories: createFactories(),
    });
    const grownEntity = grownCircle.contribution?.entities[0];
    expect(
      grownEntity?.kind === "circle" && grownEntity.radius,
      "Left circle offset should grow the radius.",
    ).toBe(2.5);

    const collapsedCircle = createOffsetContribution({
      curve: circle,
      distance: 2,
      side: "right",
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      collapsedCircle.valid,
      "Circle offset collapsing the radius should be rejected.",
    ).toBeFalsy();

    const arc = {
      kind: "arc" as const,
      isConstruction: false,
      style: undefined,
      center: [0, 0] as SketchPoint,
      start: [2, 0] as SketchPoint,
      end: [0, 2] as SketchPoint,
      sweepDirection: "counterClockwise" as const,
    };
    const grownArc = createOffsetContribution({
      curve: arc,
      distance: 1,
      side: "left",
      sequence: 10,
      factories: createFactories(),
    });
    expect(grownArc.valid, "Left arc offset should be valid.").toBeTruthy();
    expectPointCloseTo(
      grownArc.contribution?.points[1]?.position,
      [3, 0],
      "Left arc offset start",
    );
    expectPointCloseTo(
      grownArc.contribution?.points[2]?.position,
      [0, 3],
      "Left arc offset end",
    );

    const collapsedArc = createOffsetContribution({
      curve: arc,
      distance: 2,
      side: "right",
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      collapsedArc.valid,
      "Arc offset collapsing the radius should be rejected.",
    ).toBeFalsy();

    const splineEntity = makeSpline("sketch_entity_spline", "Spline", [
      "sketch_point_s0",
      "sketch_point_s1",
      "sketch_point_s2",
    ]);
    if (splineEntity.kind !== "spline") throw new Error("spline");
    const splineOffset = createOffsetContribution({
      curve: {
        kind: "spline",
        isConstruction: false,
        style: undefined,
        geometry: {
          kind: "spans",
          spans: reconstructSplineAggregate(splineEntity, {
            sketch_point_s0: [0, 0],
            sketch_point_s1: [1, 2],
            sketch_point_s2: [2, 0],
          }).spans,
        },
        isClosed: false,
      },
      distance: 1,
      side: "left",
      sequence: 10,
      factories: createFactories(),
    });
    // T10h (D6, [TECH] T-10): a spline has no exact static offset.
    expect(
      splineOffset,
      "A static spline offset should be refused as not supported yet.",
    ).toEqual({
      valid: false,
      message: PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE,
      contribution: null,
      previewEntities: [],
    });
  }

  function testSlotOffsetCharacterization() {
    const lineDefinition = makeDefinition(
      [
        makePoint("sketch_point_a", "A", [0, 0]),
        makePoint("sketch_point_b", "B", [4, 0]),
      ],
      [makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b")],
    );
    const lineSlot = createSketchSlotContribution({
      definition: lineDefinition,
      entityIds: ["sketch_entity_ab"] as SketchEntityId[],
      width: 2,
      sequence: 10,
      factories: createFactories(),
    });
    expectPointCloseTo(
      lineSlot.contribution?.points[0]?.position,
      [0, 1],
      "Line slot left start",
    );
    expectPointCloseTo(
      lineSlot.contribution?.points[1]?.position,
      [4, 1],
      "Line slot left end",
    );
    expectPointCloseTo(
      lineSlot.contribution?.points[2]?.position,
      [4, -1],
      "Line slot right end",
    );
    expectPointCloseTo(
      lineSlot.contribution?.points[3]?.position,
      [0, -1],
      "Line slot right start",
    );

    const arcDefinition = makeDefinition(
      [
        makePoint("sketch_point_center", "Center", [0, 0]),
        makePoint("sketch_point_start", "Start", [2, 0]),
        makePoint("sketch_point_end", "End", [0, 2]),
      ],
      [
        makeArc(
          "sketch_entity_arc",
          "Arc",
          "sketch_point_center",
          "sketch_point_start",
          "sketch_point_end",
        ),
      ],
    );
    const arcSlot = createSketchSlotContribution({
      definition: arcDefinition,
      entityIds: ["sketch_entity_arc"] as SketchEntityId[],
      width: 1,
      sequence: 10,
      factories: createFactories(),
    });
    expectPointCloseTo(
      arcSlot.contribution?.points[0]?.position,
      [2.5, 0],
      "Arc slot outer start",
    );
    expectPointCloseTo(
      arcSlot.contribution?.points[1]?.position,
      [0, 2.5],
      "Arc slot outer end",
    );
    expectPointCloseTo(
      arcSlot.contribution?.points[2]?.position,
      [1.5, 0],
      "Arc slot inner start",
    );
    expectPointCloseTo(
      arcSlot.contribution?.points[3]?.position,
      [0, 1.5],
      "Arc slot inner end",
    );
  }

  function testOffsetDerivationValidationAndCommitPreparation() {
    const chainDefinition = makeDefinition(
      [
        makePoint("sketch_point_a", "A", [0, 0]),
        makePoint("sketch_point_b", "B", [4, 0]),
        makePoint("sketch_point_c", "C", [4, 4]),
        makePoint("sketch_point_far", "Far", [20, 20]),
        makePoint("sketch_point_far_end", "Far end", [24, 20]),
      ],
      [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine(
          "sketch_entity_far",
          "Far",
          "sketch_point_far",
          "sketch_point_far_end",
        ),
      ],
    );

    const emptySelection = createSketchOffsetDerivationContribution({
      definition: chainDefinition,
      entityIds: [],
      distance: 1,
      side: "left",
      sequence: 10,
      factories: createFactories(),
      modelingTolerance: 1e-3,
      documentVariables: [],
    });
    expect(
      emptySelection.valid,
      "Empty selections should be rejected before mutation.",
    ).toBeFalsy();
    expect(
      emptySelection.contribution,
      "Rejected offsets should not stage a contribution.",
    ).toBeNull();

    const disconnected = createSketchOffsetDerivationContribution({
      definition: chainDefinition,
      entityIds: ["sketch_entity_ab", "sketch_entity_far"] as SketchEntityId[],
      distance: 1,
      side: "left",
      sequence: 10,
      factories: createFactories(),
      modelingTolerance: 1e-3,
      documentVariables: [],
    });
    expect(
      disconnected.valid,
      "Disconnected selections should be rejected before mutation.",
    ).toBeFalsy();
    expect(
      disconnected.contribution,
      "Disconnected selections should not stage a contribution.",
    ).toBeNull();

    const missingEntity = createSketchOffsetDerivationContribution({
      definition: chainDefinition,
      entityIds: ["sketch_entity_missing"] as SketchEntityId[],
      distance: 1,
      side: "left",
      sequence: 10,
      factories: createFactories(),
      modelingTolerance: 1e-3,
      documentVariables: [],
    });
    expect(
      missingEntity.valid,
      "Unsupported or missing targets should be rejected before mutation.",
    ).toBeFalsy();

    const committed = createSketchOffsetDerivationContribution({
      definition: chainDefinition,
      entityIds: ["sketch_entity_ab", "sketch_entity_bc"] as SketchEntityId[],
      distance: 1,
      side: "right",
      sequence: 10,
      factories: createFactories(),
      modelingTolerance: 1e-3,
      documentVariables: [],
    });
    expect(
      committed.valid,
      "A connected chain should produce a valid derivation contribution.",
    ).toBeTruthy();
    const relationship = committed.contribution?.derivedRelationships?.[0];
    expect(
      relationship?.kind,
      "Offset commit should author an offset relationship.",
    ).toBe("offset");
    if (relationship?.kind === "offset") {
      expect(
        relationship.seedEntityIds,
        "The relationship should record the seed chain in traversal order.",
      ).toEqual(["sketch_entity_ab", "sketch_entity_bc"] as SketchEntityId[]);
      // T17p3: the Offset tool writes the authored wrapper, the only stored
      // representation of an offset distance (never a bare number).
      expect(
        relationship.distance,
        "The right side should store a negative signed distance as a literal authored value.",
      ).toEqual(createLiteralAuthoredValue(-1));
      expect(
        relationship.jointPolicy,
        "The relationship should record the joint policy.",
      ).toBe("trimExtendArcFallback");
      expect(
        relationship.jointOutputs.length,
        "The convex corner should record one stable joint identity.",
      ).toBe(1);
      expect(
        relationship.outputs.length,
        "Each seed segment should map to one stable output.",
      ).toBe(2);
    }
    expect(
      committed.contribution?.entities.filter((entity) => entity.kind === "arc")
        .length,
      "The convex corner should stage a joint arc entity.",
    ).toBe(1);
    expect(
      committed.previewEntities.length > 0,
      "A valid offset derivation should stage preview geometry.",
    ).toBeTruthy();
  }

  function testDerivedSplineFactoryPreservesCompleteAggregate() {
    const source = {
      ...makeSpline("sketch_entity_spline", "Spline", [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_a",
      ]),
      pointOccurrenceIds: ["source-a", "source-b", "source-alias"],
      pointOccurrences: [
        {
          occurrenceId: "source-a",
          pointId: "sketch_point_a" as SketchPointId,
          tangent: { kind: "authored" as const, vector: [1, 2] as const },
        },
        {
          occurrenceId: "source-b",
          pointId: "sketch_point_b" as SketchPointId,
          tangent: { kind: "authored" as const, vector: [0, 0] as const },
        },
        {
          occurrenceId: "source-alias",
          pointId: "sketch_point_a" as SketchPointId,
          tangent: { kind: "automatic" as const },
        },
      ],
      closure: "positional" as const,
    } as Extract<SketchEntityDefinition, { kind: "spline" }>;
    const definition = makeDefinition(
      [
        makePoint("sketch_point_a", "A", [1, 0]),
        makePoint("sketch_point_b", "B", [2, 1]),
        makePoint("sketch_point_axis_start", "Axis start", [0, -2]),
        makePoint("sketch_point_axis_end", "Axis end", [0, 2]),
      ],
      [
        source,
        makeLine(
          "sketch_entity_axis",
          "Axis",
          "sketch_point_axis_start",
          "sketch_point_axis_end",
        ),
      ],
    );
    const result = createSketchDerivedTransformContribution({
      definition,
      operatorKind: "mirror",
      entityIds: [
        "sketch_entity_spline",
        "sketch_entity_axis",
      ] as SketchEntityId[],
      value: null,
      sequence: 10,
      factories: createFactories(),
      modelingTolerance: 1e-3,
      documentVariables: [],
    });
    const output = result.contribution?.entities.find(
      (entity): entity is Extract<SketchEntityDefinition, { kind: "spline" }> =>
        entity.kind === "spline",
    );

    expect(result.valid).toBeTruthy();
    expect(output?.closure).toBe("positional");
    expect(output?.pointOccurrenceIds).not.toEqual(source.pointOccurrenceIds);
    expect(
      output?.pointOccurrences.map((occurrence) => occurrence.pointId),
    ).toEqual([
      "sketch_point_10_mirror-sketch_point_a",
      "sketch_point_10_mirror-sketch_point_b",
      "sketch_point_10_mirror-sketch_point_a",
    ]);
    expect(
      output?.pointOccurrences.map((occurrence) => occurrence.tangent),
    ).toEqual([
      { kind: "authored", vector: [-1, 2] },
      { kind: "authored", vector: [0, 0] },
      { kind: "automatic" },
    ]);
    expect(output && "endSpanParameterLengths" in output).toBe(false);

    // T10g option B: a trimmed seed's fixed end-span lengths reach the copy
    // (a mirror is an isometry, so unchanged).
    const trimmed = createSketchDerivedTransformContribution({
      definition: {
        ...definition,
        entities: definition.entities.map((entity) =>
          entity.entityId === source.entityId
            ? { ...source, endSpanParameterLengths: { start: 0.6, end: 0.9 } }
            : entity,
        ),
      },
      operatorKind: "mirror",
      entityIds: [
        "sketch_entity_spline",
        "sketch_entity_axis",
      ] as SketchEntityId[],
      value: null,
      sequence: 11,
      factories: createFactories(),
      modelingTolerance: 1e-3,
      documentVariables: [],
    });
    expect(trimmed.valid).toBeTruthy();
    expect(
      trimmed.contribution?.entities.find((entity) => entity.kind === "spline"),
    ).toMatchObject({ endSpanParameterLengths: { start: 0.6, end: 0.9 } });
  }

  // T08b-g7-F (issue 06, "preserve relationships that define a primitive";
  // sizing decision B): the authored records of one Fillet / Slot action.
  function testFilletAuthorsTangencyAndArcEndpointBinding() {
    const fillet = createSketchFilletMutation({
      definition: createCornerDefinition(),
      entityIds: ["sketch_entity_ab", "sketch_entity_ac"] as SketchEntityId[],
      radius: 1,
      sequence: 10,
      factories: createFactories(),
    });
    const definition = fillet.definition!;
    const arc = definition.entities.find((entity) => entity.kind === "arc");
    if (arc?.kind !== "arc") throw new Error("Fillet should add an arc.");
    const lineEnd = (entityId: string) => {
      const line = definition.entities.find(
        (entity) => entity.entityId === entityId,
      );
      if (line?.kind !== "lineSegment") throw new Error("not a line");
      return line.startPointId;
    };
    expect(
      [lineEnd("sketch_entity_ab"), lineEnd("sketch_entity_ac")],
      "premise: the arc starts on AB and ends on AC (the trimmed ends)",
    ).toEqual([arc.startPointId, arc.endPointId]);
    expect(
      definition.constraints,
      "Fillet authors one tangent constraint per trimmed line, arc first.",
    ).toEqual([
      {
        constraintId: "constraint_10_fillet-tangent-a",
        kind: "tangent",
        label: "Fillet 10 tangent A",
        entityIds: [arc.entityId, "sketch_entity_ab"],
        relation: "external",
      },
      {
        constraintId: "constraint_10_fillet-tangent-b",
        kind: "tangent",
        label: "Fillet 10 tangent B",
        entityIds: [arc.entityId, "sketch_entity_ac"],
        relation: "external",
      },
    ]);
    expect(
      definition.dimensions,
      "Fillet binds its arc to its end points as every arc tool does, and adds no radius dimension.",
    ).toEqual([
      {
        dimensionId: "dimension_10_fillet-arc-start",
        kind: "arcStartPointCoincident",
        label: "Fillet 10 start",
        entityId: arc.entityId,
        pointId: arc.startPointId,
      },
      {
        dimensionId: "dimension_10_fillet-arc-end",
        kind: "arcEndPointCoincident",
        label: "Fillet 10 end",
        entityId: arc.entityId,
        pointId: arc.endPointId,
      },
    ]);
    expect(definition.constraintIds).toEqual(
      definition.constraints.map((constraint) => constraint.constraintId),
    );
    expect(definition.dimensionIds).toEqual(
      definition.dimensions.map((dimension) => dimension.dimensionId),
    );
  }

  function testSlotAuthorsTangencyAndArcEndpointBinding() {
    const lineSlot = createSketchSlotContribution({
      definition: makeDefinition(
        [
          makePoint("sketch_point_a", "A", [0, 0]),
          makePoint("sketch_point_b", "B", [4, 0]),
        ],
        [
          makeLine(
            "sketch_entity_ab",
            "AB",
            "sketch_point_a",
            "sketch_point_b",
          ),
        ],
      ),
      entityIds: ["sketch_entity_ab"] as SketchEntityId[],
      width: 2,
      sequence: 10,
      factories: createFactories(),
    }).contribution!;
    const byId = new Map(
      lineSlot.entities.map((entity) => [entity.entityId, entity]),
    );
    const shape = (entityId: string) => {
      const entity = byId.get(entityId as SketchEntityId)!;
      return entity.kind === "arc"
        ? [entity.kind, entity.startPointId, entity.endPointId]
        : entity.kind === "lineSegment"
          ? [entity.kind, entity.startPointId, entity.endPointId]
          : [entity.kind];
    };
    expect(
      lineSlot.constraints?.map((constraint) =>
        constraint.kind === "tangent"
          ? [constraint.constraintId, ...constraint.entityIds]
          : [constraint.kind],
      ),
      "Line slot: each end arc is tangent to both side lines.",
    ).toEqual([
      [
        "constraint_10_slot-end-tangent-left",
        "sketch_entity_10_slot-end-arc",
        "sketch_entity_10_slot-left-line",
      ],
      [
        "constraint_10_slot-end-tangent-right",
        "sketch_entity_10_slot-end-arc",
        "sketch_entity_10_slot-right-line",
      ],
      [
        "constraint_10_slot-start-tangent-left",
        "sketch_entity_10_slot-start-arc",
        "sketch_entity_10_slot-left-line",
      ],
      [
        "constraint_10_slot-start-tangent-right",
        "sketch_entity_10_slot-start-arc",
        "sketch_entity_10_slot-right-line",
      ],
    ]);
    expect(
      lineSlot.dimensions?.map((dimension) =>
        dimension.kind === "arcStartPointCoincident" ||
        dimension.kind === "arcEndPointCoincident"
          ? [dimension.kind, dimension.entityId, dimension.pointId]
          : [dimension.kind],
      ),
      "Line slot: both end arcs are bound to their end points; no radius dimension.",
    ).toEqual(
      [
        "sketch_entity_10_slot-end-arc",
        "sketch_entity_10_slot-start-arc",
      ].flatMap((arcId) => {
        const [, start, end] = shape(arcId);
        return [
          ["arcStartPointCoincident", arcId, start],
          ["arcEndPointCoincident", arcId, end],
        ];
      }),
    );
    expect(
      new Set(lineSlot.dimensions?.map((dimension) => dimension.dimensionId))
        .size,
      "Slot dimension ids are unique.",
    ).toBe(4);

    const arcSlot = createSketchSlotContribution({
      definition: makeDefinition(
        [
          makePoint("sketch_point_center", "Center", [0, 0]),
          makePoint("sketch_point_start", "Start", [2, 0]),
          makePoint("sketch_point_end", "End", [0, 2]),
        ],
        [
          makeArc(
            "sketch_entity_arc",
            "Arc",
            "sketch_point_center",
            "sketch_point_start",
            "sketch_point_end",
          ),
        ],
      ),
      entityIds: ["sketch_entity_arc"] as SketchEntityId[],
      width: 1,
      sequence: 10,
      factories: createFactories(),
    }).contribution!;
    const arcs = arcSlot.entities.filter(
      (entity): entity is Extract<SketchEntityDefinition, { kind: "arc" }> =>
        entity.kind === "arc",
    );
    expect(
      arcSlot.constraints ?? [],
      "Arc slot: its caps are radial lines, so no arc rounds a line.",
    ).toEqual([]);
    expect(
      arcSlot.dimensions?.map((dimension) =>
        dimension.kind === "arcStartPointCoincident" ||
        dimension.kind === "arcEndPointCoincident"
          ? [dimension.kind, dimension.entityId, dimension.pointId]
          : [dimension.kind],
      ),
      "Arc slot: both side arcs are bound to their end points.",
    ).toEqual(
      arcs.flatMap((arc) => [
        ["arcStartPointCoincident", arc.entityId, arc.startPointId],
        ["arcEndPointCoincident", arc.entityId, arc.endPointId],
      ]),
    );
    expect(arcs).toHaveLength(2);
  }

  testFilletAndChamferMutateAdjacentLines();
  testFilletAuthorsTangencyAndArcEndpointBinding();
  testSlotAuthorsTangencyAndArcEndpointBinding();
  await testExtendAndSplitMutateOnlySelectedLine();
  testSlotCreatesDurableGeometryForSupportedReferences();
  testSlotCreatesProfileOffsetsForClosedLineLoops();
  testOffsetCharacterizationSingleCurves();
  testSlotOffsetCharacterization();
  testOffsetDerivationValidationAndCommitPreparation();
  testDerivedSplineFactoryPreservesCompleteAggregate();
});

// Lane: logic (docs/testing.md). Seam: the exported operations descriptor of
// projected geometry (T10f): a spline descriptor carries the exact spans (or
// the source samples that are the curve), not a sampled polyline.
test("projected spline descriptors carry their neutral spans or source samples", () => {
  const spans = [
    neutralSpan(
      [
        [0, 0],
        [1, 2],
        [3, 2],
        [4, 0],
      ],
      0,
      ["o0", "o1"],
      0,
    ),
  ];
  const descriptor = offsetCurveDescriptorFromProjectedGeometry(
    projectedSpline("projected_geometry_curve", spans),
  );
  expect(descriptor?.kind === "spline" && descriptor.geometry).toEqual({
    kind: "spans",
    spans,
  });
  expect(
    descriptor?.kind === "spline" &&
      descriptor.geometry.kind === "spans" &&
      descriptor.geometry.spans,
  ).toBe(spans);
  const points = [
    [0, 0],
    [1, 1],
    [2, 0],
  ] as const;
  const sampled = offsetCurveDescriptorFromProjectedGeometry({
    geometryId: "projected_geometry_samples",
    kind: "spline",
    representation: { kind: "sourceSamples", points, isClosed: true },
  });
  expect(sampled?.kind === "spline" && sampled.geometry).toEqual({
    kind: "samples",
    points,
  });
  expect(sampled?.kind === "spline" && sampled.isClosed).toBe(true);

  // T10h (D6, [TECH] T-10): no static offset of a projected spline, from
  // its spans or its source samples; nothing is previewed or authored.
  for (const curve of [descriptor!, sampled!]) {
    expect(
      createOffsetContribution({
        curve,
        distance: 0.5,
        side: "left",
        sequence: 1,
        factories: {} as never,
      }),
      `projected spline (${curve.kind === "spline" ? curve.geometry.kind : curve.kind}) offset is refused`,
    ).toEqual({
      valid: false,
      message: PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE,
      contribution: null,
      previewEntities: [],
    });
  }
});

// ---------------------------------------------------------------------------
// T10g-1: the exact Trim builder on verified edit intersections (logic lane:
// solve → `querySketchEditIntersections` → `createSketchTrimMutation` →
// solve → arrangement, every stage the production contract function).
// ---------------------------------------------------------------------------

describe("createSketchTrimMutation (T10g-1 exact Trim, Q1b ties, review R-3)", () => {
  const TOLERANCES = {
    coincidence: 1e-6,
    angleRadians: 1e-6,
    minimumSegmentLength: 1e-6,
  };
  const queries = createCertifiedNeutralCurveQueryCapabilityForTest();
  const deriver = createSketchArrangementDeriver(queries);
  const entity = (name: string) => `sketch_entity_${name}` as SketchEntityId;
  type P = readonly [number, number];

  // T17p2 (F-2): the solver and the edit queries consume the resolved
  // definition; these fixtures author literals (`literalResolvedDefinition`).
  const solveResolved = (definition: NumericSketchDefinition) =>
    solveSketchDefinitionCore({
      definition,
      tolerances: TOLERANCES,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    }).solvedSnapshot;
  const solve = (definition: SketchDefinition) =>
    solveResolved(literalResolvedDefinition(definition));
  const isAcceptedSolve = (solved: SolvedSketchSnapshot) =>
    solved.status.solveState === "solved" &&
    solved.constraintStatuses.every((entry) =>
      isAcceptedConstraintStatus(entry.status),
    );
  const accepted = (definition: SketchDefinition) =>
    isAcceptedSolve(solve(definition));
  async function regions(definition: SketchDefinition) {
    return (
      await deriver.derive({
        documentId: "doc_trim",
        revisionId: "rev_trim",
        sketchId: FIXTURE_SKETCH_ID,
        definition,
        solvedSnapshot: solve(definition),
        projectedReferences: [],
        modelingTolerance: 1e-3,
      })
    ).regions.length;
  }
  /**
   * OP9: the derived regions' areas (sorted), each from its one loop read back
   * as the solved lines and arcs (quadrature oracle), plus the diagnostics.
   */
  async function regionAreas(definition: SketchDefinition) {
    const solved = solve(definition);
    const derived = await deriver.derive({
      documentId: "doc_trim",
      revisionId: "rev_trim",
      sketchId: FIXTURE_SKETCH_ID,
      definition,
      solvedSnapshot: solved,
      projectedReferences: [],
      modelingTolerance: 1e-3,
    });
    const geometry = new Map(
      solved.solvedEntities.map((record) => [record.entityId, record]),
    );
    const areas = derived.regions
      .map((region) => {
        expect(region.loops).toHaveLength(1);
        return closedCurvesSignedArea(
          region.loops[0]!.segments.map((segment) => {
            const [lo, hi] = segment.sourceParameterInterval;
            const [from, to] =
              segment.traversalDirection === "forward" ? [lo, hi] : [hi, lo];
            const source = segment.branch.source;
            if (source.kind !== "entity") throw new Error("projected");
            const record = geometry.get(source.entityId)!;
            if (record.kind === "lineSegment") {
              const [p, q] = [record.startPosition, record.endPosition];
              return {
                point: (t: number): P => [
                  p[0] + t * (q[0] - p[0]),
                  p[1] + t * (q[1] - p[1]),
                ],
                derivative: (): P => [q[0] - p[0], q[1] - p[1]],
                from,
                to,
              };
            }
            if (record.kind !== "arc") throw new Error(record.kind);
            const c = record.centerPosition;
            const r = Math.hypot(
              record.startPosition[0] - c[0],
              record.startPosition[1] - c[1],
            );
            return {
              point: (t: number): P => [
                c[0] + r * Math.cos(t),
                c[1] + r * Math.sin(t),
              ],
              derivative: (t: number): P => [-r * Math.sin(t), r * Math.cos(t)],
              from,
              to,
            };
          }),
        );
      })
      .sort((l, r) => l - r);
    return { areas, diagnostics: JSON.stringify(derived.diagnostics) };
  }
  /** OP9 premise: each solved arc's support radius hypot(start − centre). */
  const arcRadii = (definition: SketchDefinition) =>
    solve(definition).solvedEntities.flatMap((record) =>
      record.kind === "arc"
        ? [
            Math.hypot(
              record.startPosition[0] - record.centerPosition[0],
              record.startPosition[1] - record.centerPosition[1],
            ),
          ]
        : [],
    );
  async function intersections(definition: SketchDefinition, target: string) {
    return resolvedIntersections(literalResolvedDefinition(definition), target);
  }
  async function resolvedIntersections(
    definition: NumericSketchDefinition,
    target: string,
  ) {
    const result = await querySketchEditIntersections(
      {
        definition,
        solvedSnapshot: solveResolved(definition),
        projectedReferences: [],
        modelingTolerance: 1e-3,
        operation: { kind: "trim", targetEntityId: entity(target) },
      },
      queries,
    );
    if (result.kind !== "verified") throw new Error(result.message);
    return result;
  }
  function apply(
    definition: SketchDefinition,
    target: string,
    result: Extract<SketchEditIntersectionResult, { kind: "verified" }>,
    solvedSnapshot = solve(definition),
  ) {
    const mutation = createSketchTrimMutation({
      definition,
      targetEntityId: entity(target),
      intersections: result,
      solvedSnapshot,
      factories: createSessionCommitFactories(1, FIXTURE_SKETCH_ID as SketchId),
    });
    expect(mutation.message).toBeNull();
    return mutation.definition;
  }
  // O14: click-side Trim is tested at the certified query → mutation seam,
  // with solved geometry as the oracle (not just the number of entities).
  async function pickedTrim(definition: SketchDefinition, pick: [number, number]) {
    const solvedSnapshot = solve(definition);
    const result = await querySketchEditIntersections({
      definition: literalResolvedDefinition(definition), solvedSnapshot,
      projectedReferences: [], modelingTolerance: 1e-3,
      operation: { kind: "trim", targetEntityId: entity("target"), pick },
    }, queries);
    if (result.kind !== "verified") throw Error(result.message);
    const mutation = createSketchTrimMutation({ definition, targetEntityId: entity("target"),
      intersections: result, solvedSnapshot,
      factories: createSessionCommitFactories(1, FIXTURE_SKETCH_ID as SketchId),
    });
    expect(mutation.changed).toBe(true);
    expect(mutation.message).toBeNull();
    return { after: mutation.definition, result, solvedSnapshot };
  }

  test("O14: the middle piece is bounded by adjacent crossings, not the first and last", async () => {
    const sketch = makeSketchFixture();
    sketch.point("a", 0, 0); sketch.point("b", 10, 0); sketch.line("target", "a", "b");
    for (const x of [2, 4, 6, 8]) {
      sketch.point(`a${x}`, x, -2); sketch.point(`b${x}`, x, 2); sketch.line(`v${x}`, `a${x}`, `b${x}`);
    }
    const { after } = await pickedTrim(sketch.definition(), [5, 0]);
    const pieces = solve(after).solvedEntities.filter(e => e.kind === "lineSegment" && e.startPosition[1] === 0 && e.endPosition[1] === 0);
    expect(pieces.map(e => e.kind === "lineSegment" && [e.startPosition, e.endPosition])).toEqual([
      [[0, 0], [4, 0]], [[6, 0], [10, 0]],
    ]);
  });

  test.each(["start", "end"] as const)("O14 S2.13: one spline crossing trims the clicked %s, preserving the retained shape", async side => {
    const sketch = makeSketchFixture();
    sketch.point("a", 0, 0); sketch.point("b", 2, 3); sketch.point("c", 4, 0);
    sketch.spline("target", ["a", "b", "c"], "open");
    sketch.point("va", 1, -2); sketch.point("vb", 1, 5); sketch.line("v", "va", "vb");
    const before = sketch.definition();
    const { after, result, solvedSnapshot } = await pickedTrim(before, side === "start" ? [0.2, 0.4] : [3, 2]);
    const spline = splineOf(after, "target");
    expect(after.entities.filter(e => e.kind === "spline")).toHaveLength(1);
    const points = spline.pointOccurrences.map(o => after.points.find(p => p.pointId === o.pointId)!.position);
    if (side === "start") {
      expect(points[0]).toEqual(result.cuts[0]!.position);
      expect(points.at(-1)).toEqual([4, 0]);
    } else {
      expect(points[0]).toEqual([0, 0]);
      expect(points.at(-1)).toEqual(result.cuts[0]!.position);
    }
    expect(reproductionError(before, solvedSnapshot, after, "target", side === "start" ? result.cuts[0]!.representative : 0)).toBeLessThan(4e-12);
    expect(accepted(after)).toBe(true);
  });

  test.each(["line", "circle", "smooth", "positional"] as const)("O14: an isolated %s is deleted", async kind => {
    const sketch = makeSketchFixture();
    sketch.point("a", 1, 0); sketch.point("b", 0, 1); sketch.point("c", -1, 0); sketch.point("d", 0, -1);
    if (kind === "line") sketch.line("target", "a", "b");
    else if (kind === "circle") sketch.circle("target", "b", 2);
    else sketch.spline("target", kind === "positional" ? ["a", "b", "c", "d", "a"] : ["a", "b", "c", "d"], kind);
    const { after } = await pickedTrim(sketch.definition(), [1, 0]);
    expect(after.entities).toEqual([]);
    expect(after.entityIds).toEqual([]);
  });

  test("O14: a circle's one contact deletes it; two contacts remove the clicked arc, including across the seam", async () => {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0); sketch.circle("target", "o", 2);
    sketch.point("a", 0, -3); sketch.point("b", 0, 3); sketch.line("v", "a", "b");
    for (const x of [-2, 2]) {
      const { after } = await pickedTrim(sketch.definition(), [x, 0]);
      const arc = solve(after).solvedEntities.find(e => e.entityId === entity("target"));
      expect(arc?.kind).toBe("arc");
      if (arc?.kind !== "arc") throw Error("missing arc");
      expect(arc.startPosition[1]).toBeCloseTo(x > 0 ? 2 : -2, 10);
      expect(arc.endPosition[1]).toBeCloseTo(x > 0 ? -2 : 2, 10);
      expect(accepted(after)).toBe(true);
    }
    const tangent = makeSketchFixture();
    tangent.point("o", 0, 0); tangent.circle("target", "o", 2);
    tangent.point("a", 2, -3); tangent.point("b", 2, 3); tangent.line("v", "a", "b");
    const { after } = await pickedTrim(tangent.definition(), [0, 2]);
    expect(after.entities.map(e => e.entityId)).toEqual([entity("v")]);
  });

  test.each(["smooth", "positional"] as const)("O14: a closed %s spline removes either clicked half, retaining its seam shape", async closure => {
    const sketch = makeSketchFixture();
    sketch.point("a", 2, 0); sketch.point("b", 0, 2); sketch.point("c", -2, 0); sketch.point("d", 0, -2);
    sketch.spline("target", closure === "positional" ? ["a", "b", "c", "d", "a"] : ["a", "b", "c", "d"], closure);
    sketch.point("va", -4, 0.3); sketch.point("vb", 4, 0.3); sketch.line("v", "va", "vb");
    for (const y of [-2, 2]) {
      const { after } = await pickedTrim(sketch.definition(), [0, y]);
      const records = solve(after).solvedEntities.filter(e => e.kind === "spline");
      expect(records).toHaveLength(closure === "positional" && y > 0 ? 2 : 1);
      for (const record of records) {
        if (record.kind !== "spline" || record.reconstruction.validity !== "valid") throw Error("invalid retained spline");
        const samples = record.reconstruction.spans.flatMap(span => Array.from({length: 17}, (_, i) => evaluateSplineSpan(span, {kind: "local", value: i / 16}).position));
        expect(samples.every(p => y > 0 ? p[1] <= 0.30000001 : p[1] >= 0.29999999)).toBe(true);
      }
      expect(accepted(after)).toBe(true);
    }
  });

  /** The largest solved-point move away from the authored positions. */
  const displacement = (definition: SketchDefinition) =>
    Math.max(
      ...solve(definition).solvedPoints.map((solved) => {
        const authored = definition.points.find(
          (candidate) => candidate.pointId === solved.pointId,
        )!.position;
        return Math.hypot(
          solved.solvedPosition[0] - authored[0],
          solved.solvedPosition[1] - authored[1],
        );
      }),
    );
  const trim = async (definition: SketchDefinition, target: string) =>
    apply(definition, target, await intersections(definition, target));
  const lineX = (a: P, b: P, c: P, d: P): [number, number] => {
    const r = [b[0] - a[0], b[1] - a[1]];
    const s = [d[0] - c[0], d[1] - c[1]];
    const den = r[0]! * s[1]! - r[1]! * s[0]!;
    const t = ((c[0] - a[0]) * s[1]! - (c[1] - a[1]) * s[0]!) / den;
    return [a[0] + t * r[0]!, a[1] + t * r[1]!];
  };

  test("positions are the cuts' evaluator positions; one tie per tied cutter; the original id keeps the first piece", async () => {
    const sketch = makeSketchFixture();
    sketch.point("t0", 0, 0);
    sketch.point("t1", 4, 0);
    sketch.line("target", "t0", "t1");
    for (const x of [1, 3]) {
      sketch.point(`c${x}a`, x, -1);
      sketch.point(`c${x}b`, x, 1);
      sketch.line(`c${x}`, `c${x}a`, `c${x}b`);
    }
    const definition = sketch.definition();
    const result = await intersections(definition, "target");
    const after = apply(definition, "target", result);
    const target = after.entities.find(
      (candidate) => candidate.entityId === entity("target"),
    );
    const piece = after.entities.at(-1);
    if (target?.kind !== "lineSegment" || piece?.kind !== "lineSegment")
      throw new Error("pieces");
    const at = (pointId: string) =>
      after.points.find((candidate) => candidate.pointId === pointId)!.position;
    expect(at(target.endPointId)).toEqual(result.cuts[0]!.position);
    expect(at(piece.startPointId)).toEqual(result.cuts[1]!.position);
    expect(piece.endPointId).toBe("sketch_point_t1");
    expect(
      after.constraints.map((constraint) =>
        constraint.kind === "pointOnCurve"
          ? [constraint.point.pointId, constraint.curve.entityId]
          : constraint.kind,
      ),
    ).toEqual([
      [target.endPointId, entity("c1")],
      [piece.startPointId, entity("c3")],
    ]);
    expect(after.constraintIds).toEqual(
      after.constraints.map((constraint) => constraint.constraintId),
    );
    expect(accepted(after)).toBe(true);
  });

  test("R-P3: the five T-junction apexes of the plan review each give one region after exact, tied Trims (the sampled Trim gave 0 in cases 2 and 3)", async () => {
    const counts: number[] = [];
    for (const apex of [
      [1, 3],
      [1.3, 2.71],
      [0.77, 3.141],
      [2.2, -2.9],
      [1.111, 1.777],
    ] as P[]) {
      const c0: P = [-1, -0.37];
      const c1: P = [4, 1.91];
      const side = Math.sign(
        (c1[0] - c0[0]) * (apex[1] - c0[1]) -
          (c1[1] - c0[1]) * (apex[0] - c0[0]),
      );
      const q = lineX(apex, [apex[0] + 2.3, apex[1] - 4.1], c0, c1);
      const s = lineX(apex, [apex[0] - 1.7, apex[1] - 3.3], c0, c1);
      const sketch = makeSketchFixture();
      // The probe's cutter support, extended so both feet (computed on the
      // support, as the sampled Trim placed them) lie inside the segment.
      sketch.point("c0", 2 * c0[0] - c1[0], 2 * c0[1] - c1[1]);
      sketch.point("c1", 2 * c1[0] - c0[0], 2 * c1[1] - c0[1]);
      sketch.line("cut", "c0", "c1");
      // A second line beyond `cut` (away from the apex) gives each spoke two cuts.
      const shift = -side * 1.2;
      sketch.point("d0", c0[0] - 10, c0[1] - 10 * 0.456 + shift);
      sketch.point("d1", c1[0] + 10, c1[1] + 10 * 0.456 + shift);
      sketch.line("far", "d0", "d1");
      sketch.point("r", ...apex);
      for (const [name, foot] of [
        ["a", q],
        ["b", s],
      ] as const) {
        sketch.point(
          `${name}End`,
          apex[0] + 4 * (foot[0] - apex[0]),
          apex[1] + 4 * (foot[1] - apex[1]),
        );
        sketch.line(name, "r", `${name}End`);
      }
      let definition = sketch.definition();
      definition = await trim(definition, "a");
      definition = await trim(definition, "b");
      counts.push(await regions(definition));
    }
    expect(counts).toEqual([1, 1, 1, 1, 1]);
  });

  test("P-g2 B (review R-3, closest point away from cuts): ties of a trimmed cutter's points move to the kept piece that holds them, so the triangle closes in all five cases", async () => {
    const counts: number[] = [];
    for (const apex of [
      [3.1, 3],
      [3.3, 2.71],
      [2.77, 3.141],
      [3.6, 2.2],
      [3.111, 2.777],
    ] as P[]) {
      const c0: P = [-1, -0.37];
      const cEnd: P = [6, 2.79];
      const sketch = makeSketchFixture();
      sketch.point("c0", ...c0);
      sketch.point("cEnd", ...cEnd);
      sketch.line("c", "c0", "cEnd");
      for (const [name, x] of [
        ["x", 0.2],
        ["y", 0.9],
      ] as const) {
        sketch.point(`${name}0`, x, -3);
        sketch.point(`${name}1`, x, 3);
        sketch.line(name, `${name}0`, `${name}1`);
      }
      const cutsOnly = sketch.definition();
      sketch.point("r", ...apex);
      sketch.point(
        "q",
        ...lineX(apex, [apex[0] + 2.3, apex[1] - 4.1], c0, cEnd),
      );
      sketch.point(
        "s",
        ...lineX(apex, [apex[0] - 1.7, apex[1] - 3.3], c0, cEnd),
      );
      sketch.line("a", "r", "q");
      sketch.line("b", "r", "s");
      const qTie = sketch.pointOnCurve("q", "c");
      const sTie = sketch.pointOnCurve("s", "c");
      const definition = sketch.definition();
      // The builder seam: c is cut at x and y only (the spokes' feet lie
      // beyond the last cut, away from every cut).
      const cuts = await intersections(cutsOnly, "c");
      const solved = solve(definition);
      const along = (name: string) => {
        const position = solved.solvedPoints.find(
          (point) => point.pointId === `sketch_point_${name}`,
        )!.solvedPosition;
        return (position[0] - c0[0]) / (cEnd[0] - c0[0]);
      };
      const after = apply(definition, "c", {
        ...cuts,
        incidences: [
          {
            constraintId: qTie,
            pointId: "sketch_point_q" as SketchPointId,
            parameter: along("q"),
            cut: null,
          },
          {
            constraintId: sTie,
            pointId: "sketch_point_s" as SketchPointId,
            parameter: along("s"),
            cut: null,
          },
        ],
      });
      const piece = after.entities.at(-1)!.entityId;
      expect(
        after.constraints
          .filter((constraint) =>
            [qTie, sTie].includes(constraint.constraintId),
          )
          .map((constraint) =>
            constraint.kind === "pointOnCurve"
              ? constraint.curve.entityId
              : null,
          ),
      ).toEqual([piece, piece]);
      counts.push(await regions(after));
    }
    expect(counts).toEqual([1, 1, 1, 1, 1]);
  });

  test("R-3 at c2: an arc's `pointOnCurve` whose declared join is the last cut moves to the new arc piece, so the bounded-sweep incidence stays satisfied", async () => {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0);
    sketch.point("a0", 2, 0);
    sketch.point("a1", -2, 0);
    sketch.arc("target", "o", "a0", "a1");
    sketch.point("x0", 1, -1);
    sketch.point("x1", 1, 3);
    sketch.line("cross", "x0", "x1");
    const foot: P = [
      2 * Math.cos((2 * Math.PI) / 3),
      2 * Math.sin((2 * Math.PI) / 3),
    ];
    sketch.point("r", -1, 3);
    sketch.point("f", ...foot);
    sketch.line("spoke", "r", "f");
    const tie = sketch.pointOnCurve("f", "target");
    const definition = sketch.definition();
    expect(accepted(definition), "premise: the tied spoke solves").toBe(true);
    const result = await intersections(definition, "target");
    expect(result.incidences).toEqual([
      expect.objectContaining({ constraintId: tie, cut: 1 }),
    ]);
    const after = apply(definition, "target", result);
    const piece = after.entities.at(-1)!;
    expect(piece.kind).toBe("arc");
    const moved = after.constraints.find(
      (constraint) => constraint.constraintId === tie,
    );
    expect(moved?.kind === "pointOnCurve" && moved.curve.entityId).toBe(
      piece.entityId,
    );
    expect(
      accepted(after),
      "every tie and the retargeted incidence are satisfied",
    ).toBe(true);
    expect(
      displacement(after),
      "satisfied where the Trim placed it: the solve moves nothing",
    ).toBeLessThan(1e-9);
    // Mutant oracle: left on the first arc piece (bounded sweep [0, π/3]),
    // the incidence is violated, so the solve has to drag geometry onto it.
    const unmoved = {
      ...after,
      constraints: after.constraints.map((constraint) =>
        constraint.constraintId === tie
          ? definition.constraints[0]!
          : constraint,
      ),
    };
    expect(
      !accepted(unmoved) || displacement(unmoved) > 1e-3,
      "left on the first piece the incidence is not satisfied in place",
    ).toBe(true);
  });

  test("R-3 at c2 on a circle: the incidence at the last cut stays on the (same-id) arc, which ends there, and is satisfied", async () => {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0);
    sketch.circle("target", "o", 2);
    sketch.point("x0", 1, -3);
    sketch.point("x1", 1, 3);
    sketch.line("cross", "x0", "x1");
    const angle = (7 * Math.PI) / 4;
    sketch.point("r", 3, -3);
    sketch.point("f", 2 * Math.cos(angle), 2 * Math.sin(angle));
    sketch.line("spoke", "r", "f");
    const tie = sketch.pointOnCurve("f", "target");
    const definition = sketch.definition();
    const result = await intersections(definition, "target");
    expect(result.cuts.at(-1)!.cutters).toEqual([
      {
        entityId: entity("spoke"),
        tie: { kind: "coincident", pointId: "sketch_point_f" },
      },
    ]);
    expect(result.incidences).toEqual([
      expect.objectContaining({
        constraintId: tie,
        cut: result.cuts.length - 1,
      }),
    ]);
    const after = apply(definition, "target", result);
    const arc = after.entities.find(
      (candidate) => candidate.entityId === entity("target"),
    );
    expect(arc?.kind).toBe("arc");
    expect(accepted(after)).toBe(true);
  });

  test("orchestrator 2026-10-04: a trimmed circle's `circleRadius` dimensions become same-id `diameter` dimensions of twice the value (number, literal, expression; placement kept), and the result solves", async () => {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0);
    sketch.circle("target", "o", 2);
    for (const x of [-1, 1]) {
      sketch.point(`x${x}a`, x, -3);
      sketch.point(`x${x}b`, x, 3);
      sketch.line(`x${x}`, `x${x}a`, `x${x}b`);
    }
    const placement = { kind: "dimensionLine" as const, offset: 0.5 };
    const radius = (dimensionId: string, value: unknown) => ({
      dimensionId: dimensionId as DimensionId,
      kind: "circleRadius" as const,
      label: `${dimensionId} label`,
      entityId: entity("target"),
      value,
      annotationPlacement: placement,
    });
    const base = sketch.definition();
    const variables = [
      {
        variableId: "variable_r" as DocumentVariableId,
        name: "r",
        valueText: "1 + 1",
      },
    ];
    // T17p2 (F-2): the bare-number case is deleted with the bare form.
    for (const [value, doubled] of [
      [
        { source: "literal", value: 2 },
        { source: "literal", value: 4 },
      ],
      [
        { source: "expression", valueText: "r" },
        { source: "expression", valueText: "2 * (r)" },
      ],
    ] as const) {
      const definition = {
        ...base,
        dimensionIds: ["dimension_radius" as DimensionId],
        dimensions: [radius("dimension_radius", value)],
      } as SketchDefinition;
      const resolved = (candidate: SketchDefinition) => {
        const result = resolveSketchDimensionValues({
          definition: candidate,
          variables,
        });
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        return result.definition;
      };
      // T17p2 (F-2): an expression value needs the variables to solve.
      const after = apply(
        definition,
        "target",
        await resolvedIntersections(resolved(definition), "target"),
        solveResolved(resolved(definition)),
      );
      const arc = after.entities.find(
        (candidate) => candidate.entityId === entity("target"),
      );
      if (arc?.kind !== "arc") throw new Error("arc");
      expect(after.dimensions).toEqual([
        {
          dimensionId: "dimension_radius",
          kind: "diameter",
          // Review A-3: a label that is not "… radius" is kept.
          label: "dimension_radius label",
          entityId: entity("target"),
          value: doubled,
          annotationPlacement: placement,
        },
        // T13l (P5): the arc gains its two endpoint bindings.
        expect.objectContaining({
          kind: "arcStartPointCoincident",
          entityId: arc.entityId,
          pointId: arc.startPointId,
        }),
        expect.objectContaining({
          kind: "arcEndPointCoincident",
          entityId: arc.entityId,
          pointId: arc.endPointId,
        }),
      ]);
      const numeric = resolved(after);
      expect(
        numeric.dimensions[0]?.kind === "diameter" &&
          numeric.dimensions[0].value,
        "the doubled value evaluates to twice the radius",
      ).toBe(4);
      expect(
        isAcceptedSolve(solveResolved(numeric)),
        `${JSON.stringify(value)}: solves`,
      ).toBe(true);
      // The unconverted radius dimension on the arc does not (mutant oracle).
      expect(
        isAcceptedSolve(
          solveResolved({
            ...numeric,
            dimensions: resolved(definition).dimensions,
          }),
        ),
      ).toBe(false);
    }
  });

  test("[TECH] 2026-10-04 seam: a circle cut along its x diameter keeps the arc from 0° (its first cut) to 180°, tied to the line, and the half disk is one region", async () => {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("target", "c", 1);
    sketch.point("a", -2, 0);
    sketch.point("b", 2, 0);
    sketch.line("h", "a", "b");
    const definition = sketch.definition();
    const after = await trim(definition, "target");
    const arc = after.entities.find(
      (candidate) => candidate.entityId === entity("target"),
    );
    if (arc?.kind !== "arc") throw new Error("arc");
    const at = (pointId: string) =>
      after.points.find((candidate) => candidate.pointId === pointId)!.position;
    expect(arc.sweepDirection).toBe("counterClockwise");
    expect(at(arc.startPointId)).toEqual([1, 0]);
    expect(at(arc.endPointId)[0]).toBeCloseTo(-1, 12);
    expect(
      after.constraints.map((constraint) =>
        constraint.kind === "pointOnCurve" ? constraint.curve.entityId : null,
      ),
    ).toEqual([entity("h"), entity("h")]);
    expect(accepted(after)).toBe(true);
    expect(await regions(after)).toBe(1);
  });

  test("[TECH] 2026-10-04 seam (the review's sketch): a spoke tied at 0° and a vertical line; Trim keeps 0°→270°, joined to the spoke, closing one region", async () => {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("target", "c", 1);
    sketch.point("q", 1, 0);
    sketch.point("r", 3, 0);
    sketch.line("spoke", "r", "q");
    sketch.pointOnCurve("q", "target");
    sketch.point("v0", 0, -2);
    sketch.point("v1", 0, 2);
    sketch.line("v", "v0", "v1");
    const after = await trim(sketch.definition(), "target");
    const arc = after.entities.find(
      (candidate) => candidate.entityId === entity("target"),
    );
    if (arc?.kind !== "arc") throw new Error("arc");
    const ties = after.constraints.slice(1);
    expect(
      ties.map((constraint) =>
        constraint.kind === "coincident"
          ? ["coincident", constraint.pointIds]
          : constraint.kind === "pointOnCurve"
            ? [
                "pointOnCurve",
                constraint.point.pointId,
                constraint.curve.entityId,
              ]
            : [constraint.kind],
      ),
    ).toEqual([
      ["coincident", [arc.startPointId, "sketch_point_q"]],
      ["pointOnCurve", arc.endPointId, entity("v")],
    ]);
    expect(accepted(after)).toBe(true);
    expect(await regions(after)).toBe(1);
  });

  test("Q-g1 (a) with g-0: spokes trimmed at a whole circle stay tied onto it and their sector still forms (2 regions, not 0)", async () => {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0);
    sketch.circle("ring", "o", 2);
    sketch.circle("guide", "o", 2.5, true);
    sketch.point("e", 3, 0);
    sketch.point("n", 0, 3);
    sketch.line("east", "o", "e");
    sketch.line("north", "o", "n");
    let definition = sketch.definition();
    definition = await trim(definition, "east");
    definition = await trim(definition, "north");
    expect(
      definition.constraints
        .filter((constraint) => constraint.kind === "pointOnCurve")
        .map((constraint) =>
          constraint.kind === "pointOnCurve" ? constraint.curve.entityId : null,
        ),
    ).toEqual([
      entity("ring"),
      entity("guide"),
      entity("ring"),
      entity("guide"),
    ]);
    expect(accepted(definition)).toBe(true);
    expect(await regions(definition)).toBe(2);
  });

  // ---------------------------------------------------------------------
  // T10g-3b: spline Trim (option B) on the same pipeline. The pieces are
  // compared with the original by owner evaluation (`evaluateSplineSpan`
  // on both reconstructions) at 65 parameters per piece span.
  // ---------------------------------------------------------------------
  type Spline = Extract<SketchEntityDefinition, { kind: "spline" }>;
  const splineOf = (definition: SketchDefinition, name: string) => {
    const found = definition.entities.find(
      (candidate) => candidate.entityId === entity(name),
    );
    if (found?.kind !== "spline") throw new Error(`${name} is no spline`);
    return found;
  };
  const trimFactories = () =>
    createSessionCommitFactories(1, FIXTURE_SKETCH_ID as SketchId);
  /** Solve once, query on that snapshot, build on it (the session's path). */
  async function trimSpline(definition: SketchDefinition, target = "target") {
    const solvedSnapshot = solve(definition);
    const result = await querySketchEditIntersections(
      {
        definition: literalResolvedDefinition(definition),
        solvedSnapshot,
        projectedReferences: [],
        modelingTolerance: 1e-3,
        operation: { kind: "trim", targetEntityId: entity(target) },
      },
      queries,
    );
    if (result.kind !== "verified") throw new Error(result.message);
    const mutation = createSketchTrimMutation({
      definition,
      targetEntityId: entity(target),
      intersections: result,
      solvedSnapshot,
      factories: trimFactories(),
    });
    expect(mutation.message).toBeNull();
    return { result, solvedSnapshot, after: mutation.definition };
  }
  /** New points of `after` (the cut points Q). */
  const newPoints = (before: SketchDefinition, after: SketchDefinition) =>
    after.points.filter(
      (candidate) => !before.pointIds.includes(candidate.pointId),
    );
  /**
   * The largest distance between piece `pieceName` of `after` (its kept
   * fit points at their solved positions, its new points as authored) and
   * the solved original, the piece's parameter t matching tFrom + t.
   */
  function reproductionError(
    before: SketchDefinition,
    solvedSnapshot: ReturnType<typeof solve>,
    after: SketchDefinition,
    pieceName: string,
    tFrom: number,
    /** The piece's own geometry (e.g. its re-solved record); default: rebuilt from `after`. */
    pieceGeometry?: ReturnType<typeof reconstructSplineAggregate>,
  ) {
    const record = solvedSnapshot.solvedEntities.find(
      (candidate) => candidate.entityId === entity("target"),
    );
    if (record?.kind !== "spline" || record.reconstruction.validity !== "valid")
      throw new Error("original");
    const original = record.reconstruction.spans;
    const positions = Object.fromEntries([
      ...solvedSnapshot.solvedPoints.map(
        (candidate) => [candidate.pointId, candidate.solvedPosition] as const,
      ),
      ...newPoints(before, after).map(
        (candidate) => [candidate.pointId, candidate.position] as const,
      ),
    ]) as Record<SketchPointId, SketchPoint>;
    const piece =
      pieceGeometry ??
      reconstructSplineAggregate(splineOf(after, pieceName), positions);
    if (piece.validity !== "valid") throw new Error("piece is invalid");
    let worst = 0;
    for (const span of piece.spans)
      for (let k = 0; k <= 64; k++) {
        const u = k / 64;
        const at = evaluateSplineSpan(span, { kind: "local", value: u });
        const t =
          tFrom + span.interval[0] + u * (span.interval[1] - span.interval[0]);
        const host =
          original.find((candidate) => t <= candidate.interval[1]) ??
          original.at(-1)!;
        const clamped = Math.min(
          Math.max(t, host.interval[0]),
          host.interval[1],
        );
        const expected = evaluateSplineSpan(host, {
          kind: "source",
          value: clamped,
        });
        worst = Math.max(
          worst,
          Math.hypot(
            at.position[0] - expected.position[0],
            at.position[1] - expected.position[1],
          ),
        );
      }
    return worst;
  }
  /** Ties authored by the Trim: [point, kind, curve or other point]. */
  const newTies = (before: SketchDefinition, after: SketchDefinition) =>
    after.constraints
      .filter(
        (constraint) => !before.constraintIds.includes(constraint.constraintId),
      )
      .map((constraint) =>
        constraint.kind === "pointOnCurve"
          ? [
              constraint.point.pointId,
              "pointOnCurve",
              constraint.curve.entityId,
            ]
          : constraint.kind === "coincident"
            ? [constraint.pointIds[0], "coincident", constraint.pointIds[1]]
            : [constraint.kind],
      );
  /** Points of `after` that no entity uses (Q-g2: left free). */
  const freePoints = (after: SketchDefinition) =>
    after.pointIds.filter(
      (pointId) =>
        !after.entities.some((candidate) =>
          JSON.stringify(candidate).includes(`"${pointId}"`),
        ),
    );
  /** Verticals x = at from y0 to y1. */
  const verticals = (
    sketch: ReturnType<typeof makeSketchFixture>,
    xs: readonly number[],
    y0 = -1,
    y1 = 4,
  ) =>
    xs.forEach((x, index) => {
      sketch.point(`v${index}a`, x, y0);
      sketch.point(`v${index}b`, x, y1);
      sketch.line(`v${index}`, `v${index}a`, `v${index}b`);
    });

  test("T10g-3b open spline: two splines (original id keeps [0, c₁], `trim-split` keeps [c₂, T] reusing the occurrence ids, construction and style copied); the kept sub-curves reproduce the original ≤ 1e-12·scale; Q = cut.position bitwise; ties; the removed fit point stays free", async () => {
    const sketch = makeSketchFixture();
    const fit: P[] = [
      [0, 0],
      [1, 2],
      [2, 2.5],
      [3, 2],
      [4, 0],
      [5, -1],
    ];
    fit.forEach((at, index) => sketch.point(`s${index}`, ...at));
    sketch.spline(
      "target",
      fit.map((_, index) => `s${index}`),
      "open",
      [undefined, undefined, undefined, undefined, [0.6, -0.9]] as never,
    );
    verticals(sketch, [1.5, 2.5]);
    const style = { strokeColor: "#ff0000", strokeWidth: 3 };
    const before = {
      ...sketch.definition(),
      entities: sketch
        .definition()
        .entities.map((candidate) =>
          candidate.entityId === entity("target")
            ? { ...candidate, isConstruction: true, style }
            : candidate,
        ),
    };
    const original = splineOf(before, "target");
    const { result, solvedSnapshot, after } = await trimSpline(before);
    const [c1, c2] = result.cuts as [
      (typeof result.cuts)[0],
      (typeof result.cuts)[0],
    ];
    expect([c1.knotOccurrenceIndex, c2.knotOccurrenceIndex]).toEqual([
      null,
      null,
    ]);
    const a = splineOf(after, "target");
    const pieceId = after.entityIds.at(-1)!;
    expect(pieceId).toMatch(/trim-split/);
    const b = after.entities.at(-1) as Spline;
    expect(b.kind).toBe("spline");
    expect([
      b.label,
      b.isConstruction,
      b.style,
      a.isConstruction,
      a.style,
    ]).toEqual(["target trimmed", true, style, true, style]);
    expect([a.closure, b.closure]).toEqual(["open", "open"]);
    const [q1, q2] = newPoints(before, after);
    expect(q1!.position, "Q₁ is the service's position bitwise").toEqual(
      c1.position,
    );
    expect(q2!.position, "Q₂ is the service's position bitwise").toEqual(
      c2.position,
    );
    const ids = original.pointOccurrenceIds;
    expect(a.pointOccurrenceIds.slice(0, 2)).toEqual(ids.slice(0, 2));
    expect(b.pointOccurrenceIds.slice(1)).toEqual(ids.slice(3));
    expect(
      [a.pointOccurrenceIds[2], b.pointOccurrenceIds[0]].every(
        (id) => !ids.includes(id!),
      ),
    ).toBe(true);
    expect(a.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
      "sketch_point_s0",
      "sketch_point_s1",
      q1!.pointId,
    ]);
    expect(b.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
      q2!.pointId,
      "sketch_point_s3",
      "sketch_point_s4",
      "sketch_point_s5",
    ]);
    expect(
      b.pointOccurrences[2]!.tangent,
      "an untouched authored tangent keeps its authored vector",
    ).toBe(original.pointOccurrences[4]!.tangent);
    expect(
      [
        a.pointOccurrences[1]!.tangent.kind,
        b.pointOccurrences[1]!.tangent.kind,
      ],
      "the neighbours of the cut spans are re-expressed (authored)",
    ).toEqual(["authored", "authored"]);
    expect(Object.keys(a.endSpanParameterLengths ?? {})).toEqual(["end"]);
    expect(Object.keys(b.endSpanParameterLengths ?? {})).toEqual(["start"]);
    const scale = 5;
    expect(
      reproductionError(before, solvedSnapshot, after, "target", 0),
    ).toBeLessThanOrEqual(1e-12 * scale);
    expect(
      reproductionError(
        before,
        solvedSnapshot,
        after,
        pieceId.replace("sketch_entity_", ""),
        c2.representative,
      ),
    ).toBeLessThanOrEqual(1e-12 * scale);
    expect(newTies(before, after)).toEqual([
      [q1!.pointId, "pointOnCurve", entity("v0")],
      [q2!.pointId, "pointOnCurve", entity("v1")],
    ]);
    expect(freePoints(after), "Q-g2: S2 stays, as a free point").toEqual([
      "sketch_point_s2",
    ]);
    expect(accepted(after)).toBe(true);
    expect(displacement(after)).toBeLessThan(1e-9);
  });

  test("T10g-3b closed splines: smooth and positional closures cut by y = 0.3 become one open spline (same id) over [c₁, c₂] that reproduces the original; with the line it forms one region", async () => {
    for (const closure of ["smooth", "positional"] as const) {
      const sketch = makeSketchFixture();
      sketch.point("p0", 1, 0);
      sketch.point("p1", 0, 1);
      sketch.point("p2", -1, 0);
      sketch.point("p3", 0, -1);
      sketch.spline(
        "target",
        closure === "smooth"
          ? ["p0", "p1", "p2", "p3"]
          : ["p0", "p1", "p2", "p3", "p0"],
        closure,
      );
      sketch.point("a", -2, 0.3);
      sketch.point("b", 2, 0.3);
      sketch.line("chord", "a", "b");
      const before = sketch.definition();
      const { result, solvedSnapshot, after } = await trimSpline(before);
      expect(after.entityIds, closure).toEqual(before.entityIds);
      const piece = splineOf(after, "target");
      const [q1, q2] = newPoints(before, after);
      expect(piece.closure).toBe("open");
      expect(piece.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
        q1!.pointId,
        "sketch_point_p1",
        q2!.pointId,
      ]);
      expect([q1!.position, q2!.position]).toEqual(
        result.cuts.map((cut) => cut.position),
      );
      expect(Object.keys(piece.endSpanParameterLengths ?? {})).toEqual([
        "start",
        "end",
      ]);
      expect(
        reproductionError(
          before,
          solvedSnapshot,
          after,
          "target",
          result.cuts[0]!.representative,
        ),
        closure,
      ).toBeLessThanOrEqual(1e-12);
      expect(newTies(before, after)).toEqual([
        [q1!.pointId, "pointOnCurve", entity("chord")],
        [q2!.pointId, "pointOnCurve", entity("chord")],
      ]);
      expect(freePoints(after).sort(), closure).toEqual([
        "sketch_point_p0",
        "sketch_point_p2",
        "sketch_point_p3",
      ]);
      expect(accepted(after), closure).toBe(true);
      expect(await regions(after), closure).toBe(1);
    }
  });

  test("T10g-3b closed seam (A-R2): a smooth or positional closure cut by y = 0 at its seam/corner knot and the opposite knot keeps [P₀, P₂] with no new point; the knots' fit points are tied; one region", async () => {
    for (const closure of ["smooth", "positional"] as const) {
      const sketch = makeSketchFixture();
      sketch.point("p0", 1, 0);
      sketch.point("p1", 0, 1);
      sketch.point("p2", -1, 0);
      sketch.point("p3", 0, -1);
      sketch.spline(
        "target",
        closure === "smooth"
          ? ["p0", "p1", "p2", "p3"]
          : ["p0", "p1", "p2", "p3", "p0"],
        closure,
      );
      sketch.point("a", -2, 0);
      sketch.point("b", 2, 0);
      sketch.line("axis", "a", "b");
      const before = sketch.definition();
      const { result, solvedSnapshot, after } = await trimSpline(before);
      expect(
        result.cuts.map((cut) => cut.knotOccurrenceIndex),
        closure,
      ).toEqual([0, 2]);
      expect(newPoints(before, after), "knot cuts add no point").toEqual([]);
      const piece = splineOf(after, "target");
      expect(piece.closure).toBe("open");
      expect(piece.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
        "sketch_point_p0",
        "sketch_point_p1",
        "sketch_point_p2",
      ]);
      expect(
        piece.endSpanParameterLengths,
        "knot cuts fix no span length",
      ).toBeUndefined();
      expect("endSpanParameterLengths" in piece).toBe(false);
      expect(
        reproductionError(before, solvedSnapshot, after, "target", 0),
        closure,
      ).toBeLessThanOrEqual(1e-12);
      expect(newTies(before, after)).toEqual([
        ["sketch_point_p0", "pointOnCurve", entity("axis")],
        ["sketch_point_p2", "pointOnCurve", entity("axis")],
      ]);
      expect(freePoints(after)).toEqual(["sketch_point_p3"]);
      expect(accepted(after), closure).toBe(true);
      expect(await regions(after), closure).toBe(1);
    }
  });

  test("T10g-3b knot cut (open): lines through two fit points keep [S₀, S₁] and [S₃, S₄] with no new point, tying S₁ and S₃; a cutter already joined at the knot (its end is S₁) adds no tie", async () => {
    const build = (joined: boolean) => {
      const sketch = makeSketchFixture();
      const fit: P[] = [
        [0, 0],
        [1, 1],
        [2, 0],
        [3, 1],
        [4, 0],
      ];
      fit.forEach((at, index) => sketch.point(`s${index}`, ...at));
      sketch.spline(
        "target",
        fit.map((_, index) => `s${index}`),
        "open",
      );
      if (joined) {
        sketch.point("k", 1, -1);
        sketch.line("spoke", "s1", "k");
      } else {
        sketch.point("k0", 1, -1);
        sketch.point("k1", 1, 2);
        sketch.line("spoke", "k0", "k1");
      }
      sketch.point("m0", 3, -1);
      sketch.point("m1", 3, 2);
      sketch.line("other", "m0", "m1");
      return sketch.definition();
    };
    for (const joined of [false, true]) {
      const before = build(joined);
      const { result, solvedSnapshot, after } = await trimSpline(before);
      expect(result.cuts.map((cut) => cut.knotOccurrenceIndex)).toEqual([1, 3]);
      expect(newPoints(before, after)).toEqual([]);
      const a = splineOf(after, "target");
      const b = after.entities.at(-1) as Spline;
      expect(a.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
        "sketch_point_s0",
        "sketch_point_s1",
      ]);
      expect(b.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
        "sketch_point_s3",
        "sketch_point_s4",
      ]);
      expect(
        reproductionError(before, solvedSnapshot, after, "target", 0),
      ).toBeLessThanOrEqual(4e-12);
      expect(newTies(before, after), `joined: ${joined}`).toEqual([
        ...(joined
          ? []
          : [["sketch_point_s1", "pointOnCurve", entity("spoke")]]),
        ["sketch_point_s3", "pointOnCurve", entity("other")],
      ]);
      expect(freePoints(after)).toEqual(["sketch_point_s2"]);
      expect(accepted(after)).toBe(true);
    }
  });

  test("T10g-3b R-3 on a spline: a `pointOnCurve` whose declared join is the last cut and one beyond it move to the new piece; one on the first piece stays; the result solves in place", async () => {
    const sketch = makeSketchFixture();
    const fit: P[] = [
      [0, 0],
      [1, 1.5],
      [2, 2],
      [3, 1.5],
      [4, 0],
    ];
    fit.forEach((at, index) => sketch.point(`s${index}`, ...at));
    sketch.spline(
      "target",
      fit.map((_, index) => `s${index}`),
      "open",
    );
    verticals(sketch, [1.5]);
    const geometry = reconstructSplineAggregate(
      splineOf(sketch.definition(), "target"),
      Object.fromEntries(
        sketch
          .definition()
          .points.map((candidate) => [candidate.pointId, candidate.position]),
      ),
    );
    if (geometry.validity !== "valid") throw new Error("spline");
    const at = (span: number, u: number) =>
      evaluateSplineSpan(geometry.spans[span]!, { kind: "local", value: u })
        .position;
    const foot = at(2, 0.4);
    sketch.point("f", ...foot);
    sketch.point("r", foot[0], 4);
    sketch.line("spoke", "r", "f");
    const footTie = sketch.pointOnCurve("f", "target");
    sketch.point("x", ...at(3, 0.5));
    const beyondTie = sketch.pointOnCurve("x", "target");
    sketch.point("y", ...at(0, 0.5));
    const firstTie = sketch.pointOnCurve("y", "target");
    const before = sketch.definition();
    expect(accepted(before), "premise: the incidences solve").toBe(true);
    const { result, after } = await trimSpline(before);
    expect(result.incidences).toEqual([
      expect.objectContaining({ constraintId: footTie, cut: 1 }),
      expect.objectContaining({ constraintId: beyondTie, cut: null }),
      expect.objectContaining({ constraintId: firstTie, cut: null }),
    ]);
    const curveOf = (constraintId: string) => {
      const found = after.constraints.find(
        (candidate) => candidate.constraintId === constraintId,
      );
      return found?.kind === "pointOnCurve" ? found.curve.entityId : null;
    };
    const piece = after.entityIds.at(-1)!;
    expect([curveOf(footTie), curveOf(beyondTie), curveOf(firstTie)]).toEqual([
      piece,
      piece,
      entity("target"),
    ]);
    expect(
      newTies(before, after).at(-1),
      "the spoke's end, tied onto the spline, is the last cut: Q₂ is tied coincident with it",
    ).toEqual([
      newPoints(before, after).at(-1)!.pointId,
      "coincident",
      "sketch_point_f",
    ]);
    expect(accepted(after)).toBe(true);
    expect(displacement(after)).toBeLessThan(1e-9);
  });

  test("T10g-3a review A-1: the pieces are built from the SOLVED input (a fit point the solve moved): Q = cut.position bitwise; an authored-position snapshot or a cut position 1 ulp off fails closed", async () => {
    const sketch = makeSketchFixture();
    sketch.point("s0", 0, 0);
    sketch.point("s1", 1, 1.5);
    sketch.point("s2", 2, 2.6);
    sketch.point("s3", 3, 1.5);
    sketch.point("s4", 4, 0);
    sketch.spline("target", ["s0", "s1", "s2", "s3", "s4"], "open", [
      undefined,
      [0.8, 0.9],
    ] as never);
    sketch.point("k", 2, 2);
    sketch.coincident("s2", "k");
    // A point off the curve held onto it: the solve also moves the spline's
    // authored handle (a solver unknown).
    sketch.point("x", 1, 1.6);
    sketch.pointOnCurve("x", "target");
    verticals(sketch, [1.5, 2.5]);
    const before = sketch.definition();
    const { result, solvedSnapshot, after } = await trimSpline(before);
    const moved = solvedSnapshot.solvedPoints.find(
      (candidate) => candidate.pointId === "sketch_point_s2",
    )!.solvedPosition;
    expect(
      Math.hypot(moved[0] - 2, moved[1] - 2.6),
      "premise: the solve moved S2 away from its authored position",
    ).toBeGreaterThan(1e-3);
    const record = solvedSnapshot.solvedEntities.find(
      (candidate) => candidate.entityId === entity("target"),
    );
    const handle =
      record?.kind === "spline" && record.reconstruction.validity === "valid"
        ? record.reconstruction.handles[1]!
        : null;
    expect(
      handle && Math.hypot(handle[0] - 0.8, handle[1] - 0.9),
      "premise: the solve moved S1's authored handle",
    ).toBeGreaterThan(1e-6);
    expect(newPoints(before, after).map((point) => point.position)).toEqual(
      result.cuts.map((cut) => cut.position),
    );
    expect(
      reproductionError(before, solvedSnapshot, after, "target", 0),
    ).toBeLessThanOrEqual(4e-12);
    const failed = (
      snapshot: typeof solvedSnapshot,
      intersections: typeof result,
    ) =>
      createSketchTrimMutation({
        definition: before,
        targetEntityId: entity("target"),
        intersections,
        solvedSnapshot: snapshot,
        factories: trimFactories(),
      });
    for (const mutation of [
      failed(sketch.build().solvedSnapshot, result),
      failed(solvedSnapshot, {
        ...result,
        cuts: [
          {
            ...result.cuts[0]!,
            position: [
              nextUp(result.cuts[0]!.position[0]),
              result.cuts[0]!.position[1],
            ],
          },
          result.cuts[1]!,
        ],
      }),
    ])
      expect(mutation).toEqual({
        changed: false,
        message: splineTrimCutMismatchMessage("target"),
        definition: before,
      });
  });

  test("T10g-3b review A-1: on the session's commit invariant (authored == solved, `applySolvedSketchToDefinition`), Trim then re-solve reproduces the pre-Trim solved curve ≤ 1e-12·scale, handles included (an untouched authored handle the solve had moved)", async () => {
    const sketch = makeSketchFixture();
    const fit: P[] = [
      [0, 0],
      [1, 1.5],
      [2, 2.6],
      [3, 1.5],
      [4, 0.5],
      [5, 0],
    ];
    fit.forEach((at, index) => sketch.point(`s${index}`, ...at));
    sketch.spline(
      "target",
      fit.map((_, index) => `s${index}`),
      "open",
      [
        undefined,
        [0.8, 0.9],
        undefined,
        undefined,
        undefined,
        [0.8, 0.3],
      ] as never,
    );
    sketch.point("k", 2, 2);
    sketch.coincident("s2", "k");
    // Points off the curve held onto it: the solve moves both authored
    // handles, S₅'s in the piece's untouched end span.
    sketch.point("x", 1, 1.6);
    sketch.pointOnCurve("x", "target");
    sketch.point("y", 4.6, 0.4);
    sketch.pointOnCurve("y", "target");
    verticals(sketch, [1.5, 2.5]);
    const authored = sketch.definition();
    const unreconciled = solve(authored);
    const handleOf = (snapshot: typeof unreconciled, index: number) => {
      const record = snapshot.solvedEntities.find(
        (candidate) => candidate.entityId === entity("target"),
      );
      return record?.kind === "spline" &&
        record.reconstruction.validity === "valid"
        ? record.reconstruction.handles[index]!
        : null;
    };
    const h5 = handleOf(unreconciled, 5)!;
    expect(
      Math.hypot(h5[0] - 0.8, h5[1] - 0.3),
      "premise: the solve moved S₅'s authored handle",
    ).toBeGreaterThan(1e-6);
    const before = applySolvedSketchToDefinition(authored, unreconciled, {
      modelingTolerance: 1e-3,
      documentVariables: [],
    });
    const { result, solvedSnapshot, after } = await trimSpline(before);
    const resolved = solve(after);
    expect(accepted(after)).toBe(true);
    const pieceId = after.entityIds.at(-1)!;
    const geometryOf = (entityId: string) => {
      const record = resolved.solvedEntities.find(
        (candidate) => candidate.entityId === entityId,
      );
      if (record?.kind !== "spline") throw new Error("re-solved piece");
      return record.reconstruction;
    };
    const scale = 5;
    for (const [name, id, tFrom] of [
      ["target", entity("target"), 0],
      [
        pieceId.replace("sketch_entity_", ""),
        pieceId,
        result.cuts[1]!.representative,
      ],
    ] as const)
      expect(
        reproductionError(
          before,
          solvedSnapshot,
          after,
          name,
          tFrom,
          geometryOf(id),
        ),
        `re-solved ${name}`,
      ).toBeLessThanOrEqual(1e-12 * scale);
  });

  test("T10g-3b: an open spline closed by a line, crossed by two lines: 3 regions before; after the tied Trim the two outer regions remain (2)", async () => {
    const sketch = makeSketchFixture();
    sketch.point("s0", 0, 0);
    sketch.point("s1", 2, 3);
    sketch.point("s2", 4, 0);
    sketch.spline("target", ["s0", "s1", "s2"], "open");
    sketch.line("base", "s0", "s2");
    verticals(sketch, [1, 3]);
    const before = sketch.definition();
    expect(await regions(before)).toBe(3);
    const { after } = await trimSpline(before);
    expect(accepted(after)).toBe(true);
    expect(await regions(after)).toBe(2);
  });

  // T10g-2: the exact Extend and Split builders on the same pipeline.
  async function lineEdit(
    definition: SketchDefinition,
    kind: "extend" | "split",
    target: string,
    boundary: string,
    /** T13m: Split's boundary click. */
    pick?: [number, number],
  ) {
    const result = await querySketchEditIntersections(
      {
        definition: literalResolvedDefinition(definition),
        solvedSnapshot: solve(definition),
        projectedReferences: [],
        modelingTolerance: 1e-3,
        operation: {
          kind,
          targetEntityId: entity(target),
          boundaryEntityId: entity(boundary),
          ...(kind === "split" && pick ? { pick } : {}),
        },
      },
      queries,
    );
    if (result.kind !== "verified") throw new Error(result.message);
    const build =
      kind === "extend"
        ? createSketchExtendMutation
        : createSketchSplitMutation;
    const mutation = build({
      definition,
      targetEntityId: entity(target),
      intersections: result,
      solvedSnapshot: solve(definition),
      sequence: 1,
      factories: createSessionCommitFactories(1, FIXTURE_SKETCH_ID as SketchId),
    });
    expect(mutation.message).toBeNull();
    return { result, after: mutation.definition };
  }
  const positionOf = (definition: SketchDefinition, pointId: string) =>
    definition.points.find((candidate) => candidate.pointId === pointId)!
      .position;

  test("Extend (T10g-2): the extended end becomes a new point at the cut's evaluator position, tied to the boundary; the other end and the old point stay; accepted", async () => {
    for (const [x, end] of [
      [3, "end"],
      [-2, "start"],
    ] as const) {
      const sketch = makeSketchFixture();
      sketch.point("t0", 0, 0);
      sketch.point("t1", 1, 0);
      sketch.line("target", "t0", "t1");
      sketch.point("b0", x, -1);
      sketch.point("b1", x, 1);
      sketch.line("boundary", "b0", "b1");
      const definition = sketch.definition();
      const { result, after } = await lineEdit(
        definition,
        "extend",
        "target",
        "boundary",
      );
      const line = after.entities.find(
        (candidate) => candidate.entityId === entity("target"),
      );
      if (line?.kind !== "lineSegment") throw new Error("line");
      const moved = end === "end" ? line.endPointId : line.startPointId;
      const kept = end === "end" ? line.startPointId : line.endPointId;
      expect(moved).toMatch(/extend-endpoint/);
      expect(positionOf(after, moved)).toEqual(result.cuts[0]!.position);
      expect(positionOf(after, moved)).toEqual([x, 0]);
      expect(kept).toBe(end === "end" ? "sketch_point_t0" : "sketch_point_t1");
      expect(after.pointIds).toContain(
        end === "end" ? "sketch_point_t1" : "sketch_point_t0",
      );
      expect(after.entities).toHaveLength(definition.entities.length);
      expect(
        after.constraints.map((constraint) =>
          constraint.kind === "pointOnCurve"
            ? [constraint.point.pointId, constraint.curve.entityId]
            : constraint.kind,
        ),
      ).toEqual([[moved, entity("boundary")]]);
      expect(accepted(after)).toBe(true);
      expect(displacement(after)).toBeLessThan(1e-12);
    }
  });

  test("Extend (T10g-2) closes a profile: extended to a boundary whose end point is on the extension, the new end is coincident with it (R-2) and the outline is one region", async () => {
    const sketch = makeSketchFixture();
    sketch.point("p0", 0, 0);
    sketch.point("p1", 4, 0);
    sketch.point("p2", 4, 3);
    sketch.point("p3", 0, 3);
    sketch.point("top", 1, 3);
    sketch.line("bottom", "p0", "p1");
    sketch.line("right", "p1", "p2");
    sketch.line("left", "p0", "p3");
    sketch.line("cap", "p2", "top");
    const definition = sketch.definition();
    expect(await regions(definition)).toBe(0);
    const { after } = await lineEdit(definition, "extend", "cap", "left");
    expect(
      after.constraints.map((constraint) =>
        constraint.kind === "coincident" ? constraint.pointIds[1] : null,
      ),
    ).toEqual(["sketch_point_p3"]);
    expect(accepted(after)).toBe(true);
    expect(await regions(after)).toBe(1);
  });

  test("Split (T10g-2): the original id keeps start→Q, a new piece Q→end shares Q, tied once; review R-3: a point at the cut stays on the earlier piece, one beyond moves to the new piece; accepted", async () => {
    const sketch = makeSketchFixture();
    sketch.point("t0", 0, 0);
    sketch.point("t1", 4, 0);
    sketch.line("target", "t0", "t1");
    sketch.point("b0", 2, -1);
    sketch.point("b1", 2, 1);
    sketch.line("boundary", "b0", "b1");
    // A T-junction at the cut and one beyond it, both on the target.
    sketch.point("j0", 2, 0);
    sketch.point("j1", 2, 2);
    sketch.line("junction", "j0", "j1");
    const atCut = sketch.pointOnCurve("j0", "target");
    sketch.point("k0", 3, 0);
    sketch.point("k1", 3, 2);
    sketch.line("beyond", "k0", "k1");
    const beyond = sketch.pointOnCurve("k0", "target");
    sketch.point("m0", 1, 0);
    sketch.point("m1", 1, 2);
    sketch.line("before", "m0", "m1");
    const before = sketch.pointOnCurve("m0", "target");
    const definition = sketch.definition();
    const { result, after } = await lineEdit(
      definition,
      "split",
      "target",
      "boundary",
    );
    const line = after.entities.find(
      (candidate) => candidate.entityId === entity("target"),
    );
    const piece = after.entities.at(-1);
    if (line?.kind !== "lineSegment" || piece?.kind !== "lineSegment")
      throw new Error("pieces");
    expect(line.startPointId).toBe("sketch_point_t0");
    expect(line.endPointId).toBe(piece.startPointId);
    expect(piece.endPointId).toBe("sketch_point_t1");
    expect(piece.entityId).toMatch(/split-line/);
    expect(positionOf(after, piece.startPointId)).toEqual(
      result.cuts[0]!.position,
    );
    expect(positionOf(after, piece.startPointId)).toEqual([2, 0]);
    const curveOf = (constraintId: string) => {
      const constraint = after.constraints.find(
        (candidate) => candidate.constraintId === constraintId,
      );
      return constraint?.kind === "pointOnCurve"
        ? constraint.curve.entityId
        : null;
    };
    expect(curveOf(atCut)).toBe(entity("target"));
    expect(curveOf(before)).toBe(entity("target"));
    expect(curveOf(beyond)).toBe(piece.entityId);
    expect(
      after.constraints
        .filter((constraint) => constraint.label.includes(" split on "))
        .map((constraint) =>
          constraint.kind === "pointOnCurve"
            ? [constraint.point.pointId, constraint.curve.entityId]
            : constraint.kind,
        ),
    ).toEqual([[piece.startPointId, entity("boundary")]]);
    expect(accepted(after)).toBe(true);
  });

  // ---------------------------------------------------------------------
  // T13l (D27; C1–C3): Trim/Split reference retargeting.
  // ---------------------------------------------------------------------

  /** Per arc, the largest gap between its solved ends and its end points. */
  const arcEndGaps = (definition: SketchDefinition) => {
    const solved = solve(definition);
    const at = (pointId: string) =>
      solved.solvedPoints.find((point) => point.pointId === pointId)!
        .solvedPosition;
    return Object.fromEntries(
      definition.entities.flatMap((candidate) => {
        if (candidate.kind !== "arc") return [];
        const arc = solved.solvedEntities.find(
          (entry) => entry.entityId === candidate.entityId,
        );
        if (arc?.kind !== "arc") throw new Error("solved arc");
        const gap = (a: readonly number[], b: readonly number[]) =>
          Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
        return [
          [
            candidate.entityId,
            Math.max(
              gap(arc.startPosition, at(candidate.startPointId)),
              gap(arc.endPosition, at(candidate.endPointId)),
            ),
          ],
        ];
      }),
    ) as Record<string, number>;
  };
  const withConstraints = (
    definition: SketchDefinition,
    constraints: SketchDefinition["constraints"],
  ): SketchDefinition => ({
    ...definition,
    constraintIds: [
      ...definition.constraintIds,
      ...constraints.map((constraint) => constraint.constraintId),
    ],
    constraints: [...definition.constraints, ...constraints],
  });
  const fixPoint = (pointId: string, position: P) =>
    ({
      constraintId: `constraint_fix_${pointId}`,
      kind: "fixPoint",
      label: `Fix ${pointId}`,
      pointId,
      position,
    }) as SketchDefinition["constraints"][number];
  const tangentsOf = (definition: SketchDefinition) =>
    Object.fromEntries(
      definition.constraints.flatMap((constraint) =>
        constraint.kind === "tangent"
          ? [[constraint.label, constraint.entityIds]]
          : [],
      ),
    );

  /**
   * A corner B(4,0)→A(0,0) and A→C(0,4) rounded by a radius-2 Fillet
   * (centre (2,2), tangent points tA = (2,0) on BA, tB = (0,2) on AC): the
   * Fillet's own arc, 2 tangents and 2 endpoint bindings.
   */
  function filletedCorner(
    extra?: (sketch: ReturnType<typeof makeSketchFixture>) => void,
  ) {
    const sketch = makeSketchFixture();
    sketch.point("b", 4, 0);
    sketch.point("a", 0, 0);
    sketch.point("c", 0, 4);
    sketch.line("ba", "b", "a");
    sketch.line("ac", "a", "c");
    extra?.(sketch);
    const fillet = createSketchFilletMutation({
      definition: sketch.definition(),
      entityIds: [entity("ba"), entity("ac")],
      radius: 2,
      sequence: 1,
      factories: createSessionCommitFactories(1, FIXTURE_SKETCH_ID as SketchId),
    });
    if (!fillet.definition) throw new Error(fillet.message ?? "fillet");
    const arc = fillet.definition.entities.find(
      (candidate) => candidate.kind === "arc",
    );
    if (arc?.kind !== "arc") throw new Error("fillet arc");
    return { definition: fillet.definition, arc };
  }

  test("T13l C2 (T08b-g7-F A3): trim a fillet arc: endpoint dims follow the new endpoints; solve stays solved/satisfied; each tangent is on the piece that touches its line", async () => {
    // Two short cutters cross the fillet arc at 240° (x = 1) and 210° (y = 1).
    const { definition, arc } = filletedCorner((sketch) => {
      sketch.point("v0", 1, -1);
      sketch.point("v1", 1, 0.9);
      sketch.line("v", "v0", "v1");
      sketch.point("h0", -1, 1);
      sketch.point("h1", 0.9, 1);
      sketch.line("h", "h0", "h1");
    });
    expect(
      definition.dimensions.map((dimension) => dimension.kind),
      "premise: the Fillet's two endpoint bindings",
    ).toEqual(["arcStartPointCoincident", "arcEndPointCoincident"]);
    expect(accepted(definition), "premise: the fillet solves").toBe(true);
    const result = await intersections(
      definition,
      arc.entityId.replace("sketch_entity_", ""),
    );
    expect(result.cuts).toHaveLength(2);
    const after = apply(
      definition,
      arc.entityId.replace("sketch_entity_", ""),
      result,
    );
    const kept = after.entities.find(
      (candidate) => candidate.entityId === arc.entityId,
    );
    const piece = after.entities.at(-1);
    if (kept?.kind !== "arc" || piece?.kind !== "arc") throw new Error("arcs");
    expect(kept.startPointId, "the original keeps tA").toBe(arc.startPointId);
    expect(piece.endPointId, "the piece keeps tB").toBe(arc.endPointId);
    const solved = solve(after);
    expect(solved.status.solveState).toBe("solved");
    expect(accepted(after), "every constraint is satisfied").toBe(true);
    expect(
      solved.dimensionStatuses.every((entry) => entry.status === "driving"),
      "every binding drives",
    ).toBe(true);
    expect(
      displacement(after),
      "satisfied where the Trim placed it: the solve moves nothing",
    ).toBeLessThan(1e-9);
    const gaps = arcEndGaps(after);
    expect(
      Math.max(gaps[kept.entityId]!, gaps[piece.entityId]!),
      "both arcs end at their own end points (base: the old end binding kept the trimmed arc spanning to tB)",
    ).toBeLessThan(1e-9);
    const [startBinding, endBinding] = definition.dimensions;
    expect(
      after.dimensions,
      "each arc is bound to its own end points; the original keeps its binding ids",
    ).toEqual([
      { ...startBinding, pointId: kept.startPointId },
      { ...endBinding, pointId: kept.endPointId },
      expect.objectContaining({
        kind: "arcStartPointCoincident",
        entityId: piece.entityId,
        pointId: piece.startPointId,
        label: `${piece.label} start`,
      }),
      expect.objectContaining({
        kind: "arcEndPointCoincident",
        entityId: piece.entityId,
        pointId: piece.endPointId,
        label: `${piece.label} end`,
      }),
    ]);
    expect(after.dimensionIds).toEqual(
      after.dimensions.map((dimension) => dimension.dimensionId),
    );
    expect(new Set(after.dimensionIds).size).toBe(4);
    expect(
      tangentsOf(after),
      "tangent A stays, tangent B follows tB's piece",
    ).toEqual({
      "Fillet 1 tangent A": [arc.entityId, entity("ba")],
      "Fillet 1 tangent B": [piece.entityId, entity("ac")],
    });
  });

  test("T13l P5: a circle trimmed to an arc is bound to its own end points, so it stays attached under a deforming edit (unbound it detaches by 0.77)", async () => {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0);
    sketch.circle("target", "o", 2);
    for (const x of [-1, 1]) {
      sketch.point(`x${x}a`, x, -3);
      sketch.point(`x${x}b`, x, 3);
      sketch.line(`x${x}`, `x${x}a`, `x${x}b`);
    }
    const after = await trim(sketch.definition(), "target");
    const arc = after.entities.find(
      (candidate) => candidate.entityId === entity("target"),
    );
    if (arc?.kind !== "arc") throw new Error("arc");
    expect(accepted(after)).toBe(true);
    // The edit: the centre held, the arc's start point dragged along its
    // cutter to (1, 2.5) (probe P5; a rigid translation hides the gap).
    const edited = withConstraints(after, [
      fixPoint("sketch_point_o", [0, 0]),
      fixPoint(arc.startPointId, [1, 2.5]),
    ]);
    expect(accepted(edited)).toBe(true);
    expect(arcEndGaps(edited)[arc.entityId]).toBeLessThan(1e-6);
    expect(after.dimensions).toEqual([
      expect.objectContaining({
        kind: "arcStartPointCoincident",
        entityId: arc.entityId,
        pointId: arc.startPointId,
        label: "target start",
      }),
      expect.objectContaining({
        kind: "arcEndPointCoincident",
        entityId: arc.entityId,
        pointId: arc.endPointId,
        label: "target end",
      }),
    ]);
  });

  test("T13l (C1 A-3, T13a A-1): the circle → arc rewrite relabels the Radius tool's 'Radius N'; other labels are kept; a reference radius stays a reference", async () => {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0);
    sketch.circle("target", "o", 2);
    for (const x of [-1, 1]) {
      sketch.point(`x${x}a`, x, -3);
      sketch.point(`x${x}b`, x, 3);
      sketch.line(`x${x}`, `x${x}a`, `x${x}b`);
    }
    const base = sketch.definition();
    // T17p2 (F-2): dimension values are authored wrappers.
    const literal = createLiteralAuthoredValue<number>;
    for (const [label, value, expected] of [
      ["Radius 7", 2, { label: "Diameter 7", value: literal(4) }],
      ["Radius 7 of hole", 2, { label: "Radius 7 of hole", value: literal(4) }],
      // Review A4: a user label ending in " radius" is left alone.
      ["Inner radius", 2, { label: "Inner radius", value: literal(4) }],
      ["Radius 12", undefined, { label: "Diameter 12", reference: true }],
    ] as const) {
      const radius = {
        dimensionId: "dimension_radius" as DimensionId,
        kind: "circleRadius" as const,
        label,
        entityId: entity("target"),
        ...(value === undefined
          ? { reference: true as const }
          : { value: literal(value) }),
      };
      const definition = {
        ...base,
        dimensionIds: [radius.dimensionId],
        dimensions: [radius],
      } as SketchDefinition;
      const after = await trim(definition, "target");
      expect(after.dimensions[0], label).toEqual({
        dimensionId: "dimension_radius",
        kind: "diameter",
        entityId: entity("target"),
        ...expected,
      });
      expect(accepted(after), `${label}: solves`).toBe(true);
    }
  });

  test("T13l (D27): dimensions stay on the original id through Trim; a resulting conflict is retained and explained, not deleted", async () => {
    const sketch = makeSketchFixture();
    sketch.point("t0", 0, 0);
    sketch.point("t1", 4, 0);
    sketch.line("target", "t0", "t1");
    for (const x of [1, 3]) {
      sketch.point(`c${x}a`, x, -1);
      sketch.point(`c${x}b`, x, 1);
      sketch.line(`c${x}`, `c${x}a`, `c${x}b`);
    }
    const length = sketch.lineLength("target", 4);
    const definition = withConstraints(sketch.definition(), [
      {
        constraintId: "constraint_horizontal",
        kind: "horizontal",
        label: "Horizontal 1",
        entityId: entity("target"),
      } as SketchDefinition["constraints"][number],
      fixPoint("sketch_point_t0", [0, 0]),
      fixPoint("sketch_point_c1a", [1, -1]),
      fixPoint("sketch_point_c1b", [1, 1]),
    ]);
    expect(accepted(definition), "premise: solves before the Trim").toBe(true);
    const after = await trim(definition, "target");
    expect(after.dimensions, "retained on the original id, unchanged").toEqual(
      definition.dimensions,
    );
    const solved = solve(after);
    expect(
      solved.dimensionStatuses.find((entry) => entry.dimensionId === length)
        ?.status,
      "the kept piece (length 1) conflicts with its length 4",
    ).toBe("unsatisfied");
    expect(
      solved.diagnostics.some(
        (diagnostic) =>
          diagnostic.target?.kind === "dimension" &&
          diagnostic.target.dimensionId === length,
      ),
      "the solve explains it per requirement (T13c D7)",
    ).toBe(true);
    expect(
      describeSketchSessionUnsatisfiedRequirements({
        definition: after,
        liveSolve: { solvedSnapshot: solved } as never,
      }),
      "the session explanation names it and blocks profiles",
    ).toMatch(
      new RegExp(
        `${length} \\(4 mm\\).* The sketch is invalid; profiles from it are blocked\\.`,
      ),
    );
  });

  test("T13l review A1: Split/Trim a line under a mid-line tangent arc: the tangent follows the piece its start point's `pointOnCurve` moved to; still tangent after the piece tilts", async () => {
    // The Tangent arc tool's shape when its first click is mid-line: a new
    // start point on the line (`pointOnCurve`), tangent to it, bound.
    const sketch = makeSketchFixture();
    sketch.point("l0", 0, 0);
    sketch.point("l1", 6, 0);
    sketch.line("line", "l0", "l1");
    sketch.point("ac", 3, 2);
    sketch.point("as", 3, 0);
    sketch.point("ae", 5, 2);
    sketch.arc("arc", "ac", "as", "ae");
    const onLine = sketch.pointOnCurve("as", "line");
    for (const x of [1, 2]) {
      sketch.point(`s${x}a`, x, -1);
      sketch.point(`s${x}b`, x, 1);
      sketch.line(`s${x}`, `s${x}a`, `s${x}b`);
    }
    const bindings = createArcEndpointDimensions({
      createDimensionId: (suffix) => `dimension_${suffix}` as DimensionId,
      labelPrefix: "arc",
      entityId: entity("arc"),
      startPointId: "sketch_point_as" as SketchPointId,
      endPointId: "sketch_point_ae" as SketchPointId,
    });
    const definition = withConstraints(
      {
        ...sketch.definition(),
        dimensionIds: bindings.map((dimension) => dimension.dimensionId),
        dimensions: bindings,
      },
      [
        {
          constraintId: "constraint_tangent",
          kind: "tangent",
          label: "Tangent 1",
          entityIds: [entity("arc"), entity("line")],
          relation: "external",
        } as SketchDefinition["constraints"][number],
      ],
    );
    expect(accepted(definition), "premise: the tangent arc solves").toBe(true);
    const curveOf = (after: SketchDefinition) => {
      const constraint = after.constraints.find(
        (candidate) => candidate.constraintId === onLine,
      );
      return constraint?.kind === "pointOnCurve"
        ? constraint.curve.entityId
        : null;
    };

    // Split at x = 1: the arc start lies on the tail Q → l1.
    const { after } = await lineEdit(definition, "split", "line", "s1");
    const tail = after.entities.at(-1)!;
    if (tail.kind !== "lineSegment") throw new Error("tail");
    expect(curveOf(after), "premise: R-3 moved the incidence").toBe(
      tail.entityId,
    );
    expect(tangentsOf(after)).toEqual({
      "Tangent 1": [entity("arc"), tail.entityId],
    });
    expect(accepted(after)).toBe(true);
    // Tilt the tail (its far end to (6, 1); head and boundary held).
    const tilted = withConstraints(after, [
      fixPoint("sketch_point_l0", [0, 0]),
      fixPoint("sketch_point_l1", [6, 1]),
      fixPoint("sketch_point_s1a", [1, -1]),
      fixPoint("sketch_point_s1b", [1, 1]),
    ]);
    const solved = solve(tilted);
    expect(solved.status.solveState).toBe("solved");
    const at = (pointId: string) =>
      solved.solvedPoints.find((point) => point.pointId === pointId)!
        .solvedPosition;
    const centre = at("sketch_point_ac");
    const start = at("sketch_point_as");
    const q = at(tail.startPointId);
    const end = at("sketch_point_l1");
    const radial = [start[0] - centre[0], start[1] - centre[1]] as const;
    const direction = [end[0] - q[0], end[1] - q[1]] as const;
    const radius = Math.hypot(...radial);
    const length = Math.hypot(...direction);
    expect(
      Math.abs(
        Math.abs(
          direction[0] * (centre[1] - q[1]) - direction[1] * (centre[0] - q[0]),
        ) /
          length -
          radius,
      ),
      "the tilted tail's line is at the arc's radius from its centre (tangent)",
    ).toBeLessThan(1e-5);
    // The contact may slide ±√(2rτ) along a tangent line, so the angle is
    // judged at that scale (base: cos 0.24, ~14° off the tail).
    expect(
      Math.abs(radial[0] * direction[0] + radial[1] * direction[1]) /
        radius /
        length,
      "the arc meets the tilted tail it sits on tangentially",
    ).toBeLessThan(1e-2);

    // Trim at x = 1 and 2: the arc start lies on the kept piece beyond.
    const trimmed = await trim(definition, "line");
    const piece = trimmed.entities.at(-1)!;
    expect(curveOf(trimmed)).toBe(piece.entityId);
    expect(tangentsOf(trimmed)).toEqual({
      "Tangent 1": [entity("arc"), piece.entityId],
    });
    expect(accepted(trimmed)).toBe(true);
  });

  test("T13l review A2: Trim of an arc keeps exactly the binding kinds it carried: start only → each piece a start binding; unbound → pieces unbound (T17 owns never-bound arcs)", async () => {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0);
    sketch.point("a0", 2, 0);
    sketch.point("a1", -2, 0);
    sketch.arc("target", "o", "a0", "a1");
    for (const x of [-1, 1]) {
      sketch.point(`x${x}a`, x, -1);
      sketch.point(`x${x}b`, x, 3);
      sketch.line(`x${x}`, `x${x}a`, `x${x}b`);
    }
    const unbound = sketch.definition();
    const [startBinding] = createArcEndpointDimensions({
      createDimensionId: (suffix) => `dimension_${suffix}` as DimensionId,
      labelPrefix: "target",
      entityId: entity("target"),
      startPointId: "sketch_point_a0" as SketchPointId,
      endPointId: "sketch_point_a1" as SketchPointId,
    });
    const startOnly = {
      ...unbound,
      dimensionIds: [startBinding!.dimensionId],
      dimensions: [startBinding!],
    };
    const after = await trim(startOnly, "target");
    const piece = after.entities.at(-1)!;
    if (piece.kind !== "arc") throw new Error("piece");
    expect(after.dimensions).toEqual([
      startBinding,
      expect.objectContaining({
        kind: "arcStartPointCoincident",
        entityId: piece.entityId,
        pointId: piece.startPointId,
      }),
    ]);
    expect(accepted(after)).toBe(true);
    const unboundAfter = await trim(unbound, "target");
    expect(unboundAfter.entities.at(-1)!.kind).toBe("arc");
    expect(unboundAfter.dimensions).toEqual([]);
    expect(unboundAfter.dimensionIds).toEqual([]);
  });

  test("T13l C3 (D27): Split of a filleted line moves the fillet tangent to the piece that touches the fillet (same id, or one satisfied coincident class); otherwise it stays", async () => {
    // Same id: BA is B(4,0) → tA after the Fillet; split at x = 3 the new
    // piece Q → tA touches the fillet arc.
    const { definition: filleted, arc } = filletedCorner((sketch) => {
      sketch.point("s0", 3, -1);
      sketch.point("s1", 3, 1);
      sketch.line("s", "s0", "s1");
    });
    const split = await lineEdit(filleted, "split", "ba", "s");
    const piece = split.after.entities.at(-1)!;
    expect(piece.entityId).toMatch(/split-line/);
    expect(tangentsOf(split.after)).toEqual({
      "Fillet 1 tangent A": [arc.entityId, piece.entityId],
      "Fillet 1 tangent B": [arc.entityId, entity("ac")],
    });
    expect(accepted(split.after)).toBe(true);
    expect(displacement(split.after)).toBeLessThan(1e-9);

    // AC is tB → C: split at y = 3 the original id keeps tB, so tangent B
    // stays.
    const { definition: filleted2 } = filletedCorner((sketch) => {
      sketch.point("s0", -1, 3);
      sketch.point("s1", 1, 3);
      sketch.line("s", "s0", "s1");
    });
    const stays = await lineEdit(filleted2, "split", "ac", "s");
    expect(tangentsOf(stays.after)).toEqual(tangentsOf(filleted2));

    // A satisfied coincident class: the line ends at p, the arc starts at a
    // distinct q, coincident(p, q); split at x = 3 the piece Q → p touches.
    const sketch = makeSketchFixture();
    sketch.point("l0", 4, 0);
    sketch.point("p", 2, 0);
    sketch.line("line", "l0", "p");
    sketch.point("o", 2, 2);
    sketch.point("q", 2, 0);
    sketch.point("r", 0, 2);
    sketch.arc("arc", "o", "q", "r", "clockwise");
    sketch.coincident("p", "q");
    sketch.point("s0", 3, -1);
    sketch.point("s1", 3, 1);
    sketch.line("s", "s0", "s1");
    const joined = withConstraints(sketch.definition(), [
      {
        constraintId: "constraint_tangent",
        kind: "tangent",
        label: "Tangent 1",
        entityIds: [entity("line"), entity("arc")],
        relation: "external",
      } as SketchDefinition["constraints"][number],
    ]);
    expect(accepted(joined), "premise: the coincident is satisfied").toBe(true);
    const classSplit = await lineEdit(joined, "split", "line", "s");
    expect(tangentsOf(classSplit.after)).toEqual({
      "Tangent 1": [classSplit.after.entities.at(-1)!.entityId, entity("arc")],
    });
    expect(accepted(classSplit.after)).toBe(true);

    // Both pieces touch the partner (it spans both ends of the target):
    // ambiguous, so the tangent stays on the original id.
    const both = makeSketchFixture();
    both.point("p", 2, 0);
    both.point("p2", -2, 0);
    both.line("line", "p", "p2");
    both.point("o", 0, 0);
    both.arc("arc", "o", "p", "p2");
    both.point("s0", 1, -1);
    both.point("s1", 1, 1);
    both.line("s", "s0", "s1");
    const spanned = withConstraints(both.definition(), [
      {
        constraintId: "constraint_tangent",
        kind: "tangent",
        label: "Tangent 1",
        entityIds: [entity("line"), entity("arc")],
        relation: "external",
      } as SketchDefinition["constraints"][number],
    ]);
    const bothSplit = await lineEdit(spanned, "split", "line", "s");
    expect(bothSplit.after.entities.at(-1)!.entityId).toMatch(/split-line/);
    expect(tangentsOf(bothSplit.after)).toEqual({
      "Tangent 1": [entity("line"), entity("arc")],
    });
  });

  // ---------------------------------------------------------------------
  // T13m (user decision Q1): Split of arc, circle and spline targets.
  // ---------------------------------------------------------------------

  /** The upper half of the circle r = 2 at the origin, (2,0) → (−2,0) ccw (or reversed, cw). */
  function upperArc(
    sweep: "counterClockwise" | "clockwise" = "counterClockwise",
  ) {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0);
    sketch.point("a", 2, 0);
    sketch.point("b", -2, 0);
    if (sweep === "counterClockwise") sketch.arc("target", "o", "a", "b");
    else sketch.arc("target", "o", "b", "a", "clockwise");
    return sketch;
  }
  /** The ties Split authored: [point, kind, curve or other point]. */
  const splitTies = (before: SketchDefinition, after: SketchDefinition) =>
    newTies(before, after);
  const entityOf = (definition: SketchDefinition, entityId: string) =>
    definition.entities.find((candidate) => candidate.entityId === entityId);

  test("T13m: Split an arc by a line, an arc, a circle and a spline: the original id keeps start→Q, a new `split-arc` (same centre and sweep) runs Q→end, sharing Q = cut.position, tied once; solved in place", async () => {
    const boundaries: [
      string,
      (sketch: ReturnType<typeof makeSketchFixture>) => void,
    ][] = [
      [
        "line",
        (sketch) => {
          sketch.point("b0", 1, 0.5);
          sketch.point("b1", 1, 3);
          sketch.line("boundary", "b0", "b1");
        },
      ],
      [
        "arc",
        (sketch) => {
          sketch.point("c", 0, 2);
          sketch.point("c0", 0, 1);
          sketch.point("c1", 1, 2);
          sketch.arc("boundary", "c", "c0", "c1");
        },
      ],
      [
        "circle",
        (sketch) => {
          sketch.point("c", 2, 2);
          sketch.circle("boundary", "c", 2);
        },
      ],
      [
        "spline",
        (sketch) => {
          sketch.point("s0", 0.5, 1);
          sketch.point("s1", 1.5, 1.6);
          sketch.point("s2", 2.5, 3);
          sketch.spline("boundary", ["s0", "s1", "s2"], "open");
        },
      ],
    ];
    for (const [kind, add] of boundaries) {
      const sketch = upperArc();
      add(sketch);
      const before = sketch.definition();
      const { result, after } = await lineEdit(
        before,
        "split",
        "target",
        "boundary",
      );
      const kept = entityOf(after, entity("target"));
      const piece = after.entities.at(-1);
      if (kept?.kind !== "arc" || piece?.kind !== "arc")
        throw new Error(`${kind}: arcs`);
      expect(piece.entityId, kind).toMatch(/split-arc/);
      expect(piece.label, kind).toBe("target split");
      expect(
        [
          kept.startPointId,
          kept.endPointId,
          piece.startPointId,
          piece.endPointId,
        ],
        kind,
      ).toEqual([
        "sketch_point_a",
        piece.startPointId,
        kept.endPointId,
        "sketch_point_b",
      ]);
      expect([piece.centerPointId, piece.sweepDirection], kind).toEqual([
        "sketch_point_o",
        "counterClockwise",
      ]);
      expect(positionOf(after, piece.startPointId), kind).toEqual(
        result.cuts[0]!.position,
      );
      expect(splitTies(before, after), kind).toEqual([
        [piece.startPointId, "pointOnCurve", entity("boundary")],
      ]);
      expect(accepted(after), `${kind}: accepted`).toBe(true);
      expect(displacement(after), kind).toBeLessThan(1e-9);
      const gaps = arcEndGaps(after);
      expect(
        Math.max(gaps[kept.entityId]!, gaps[piece.entityId]!),
        `${kind}: each arc ends at its own end points`,
      ).toBeLessThan(1e-9);
    }
  });

  test("T13m: the boundary click picks the crossing (a line crossed twice by a circle: click near (3,0) → Q = (3,0); no click → (1,0))", async () => {
    const sketch = makeSketchFixture();
    sketch.point("t0", 0, 0);
    sketch.point("t1", 4, 0);
    sketch.line("target", "t0", "t1");
    sketch.point("c", 2, 0);
    sketch.circle("boundary", "c", 1);
    const before = sketch.definition();
    for (const [pick, x] of [
      [[2.9, 0.7], 3],
      [undefined, 1],
    ] as const) {
      const { after } = await lineEdit(
        before,
        "split",
        "target",
        "boundary",
        pick ? [pick[0], pick[1]] : undefined,
      );
      const piece = after.entities.at(-1);
      if (piece?.kind !== "lineSegment") throw new Error("line piece");
      expect(positionOf(after, piece.startPointId)).toEqual([x, 0]);
      expect(accepted(after)).toBe(true);
    }
  });

  test("T13m R-3 on a clockwise arc: a `pointOnCurve` beyond the cut along the traversal moves to the new piece; one before stays; accepted", async () => {
    const sketch = upperArc("clockwise");
    sketch.point("b0", 1, 0.5);
    sketch.point("b1", 1, 3);
    sketch.line("boundary", "b0", "b1");
    // (−2,0) → (2,0) clockwise over the top: 120° comes before the cut at
    // 60° (x = 1), 30° after it.
    sketch.point("early", -1, Math.sqrt(3));
    const early = sketch.pointOnCurve("early", "target");
    sketch.point("late", Math.sqrt(3), 1);
    const late = sketch.pointOnCurve("late", "target");
    const before = sketch.definition();
    expect(accepted(before), "premise").toBe(true);
    const { after } = await lineEdit(before, "split", "target", "boundary");
    const piece = after.entities.at(-1)!;
    const curveOf = (constraintId: string) => {
      const constraint = after.constraints.find(
        (candidate) => candidate.constraintId === constraintId,
      );
      return constraint?.kind === "pointOnCurve"
        ? constraint.curve.entityId
        : null;
    };
    expect(curveOf(early)).toBe(entity("target"));
    expect(curveOf(late)).toBe(piece.entityId);
    expect(accepted(after)).toBe(true);
    expect(displacement(after)).toBeLessThan(1e-6);
  });

  test("T13m D27 on an arc: Split of a fillet arc: endpoint bindings rebuilt per piece, the tangent follows the piece touching its line, a diameter stays on the original id; solved in place", async () => {
    const { definition: filleted, arc } = filletedCorner((sketch) => {
      sketch.point("v0", 1, -1);
      sketch.point("v1", 1, 0.9);
      sketch.line("v", "v0", "v1");
    });
    const diameter = {
      dimensionId: "dimension_diameter" as DimensionId,
      kind: "diameter" as const,
      label: "Diameter 1",
      entityId: arc.entityId,
      value: createLiteralAuthoredValue(4),
    };
    const definition = {
      ...filleted,
      dimensionIds: [...filleted.dimensionIds, diameter.dimensionId],
      dimensions: [...filleted.dimensions, diameter],
    } as SketchDefinition;
    expect(accepted(definition), "premise").toBe(true);
    const { after } = await lineEdit(
      definition,
      "split",
      arc.entityId.replace("sketch_entity_", ""),
      "v",
    );
    const kept = entityOf(after, arc.entityId);
    const piece = after.entities.at(-1);
    if (kept?.kind !== "arc" || piece?.kind !== "arc") throw new Error("arcs");
    expect(kept.startPointId, "the original keeps tA").toBe(arc.startPointId);
    expect(piece.endPointId, "the piece keeps tB").toBe(arc.endPointId);
    const [startBinding, endBinding] = filleted.dimensions;
    expect(after.dimensions).toEqual([
      { ...startBinding, pointId: kept.startPointId },
      { ...endBinding, pointId: kept.endPointId },
      diameter,
      expect.objectContaining({
        kind: "arcStartPointCoincident",
        entityId: piece.entityId,
        pointId: piece.startPointId,
        label: `${piece.label} start`,
      }),
      expect.objectContaining({
        kind: "arcEndPointCoincident",
        entityId: piece.entityId,
        pointId: piece.endPointId,
        label: `${piece.label} end`,
      }),
    ]);
    expect(after.dimensionIds).toEqual(
      after.dimensions.map((dimension) => dimension.dimensionId),
    );
    expect(tangentsOf(after)).toEqual({
      "Fillet 1 tangent A": [arc.entityId, entity("ba")],
      "Fillet 1 tangent B": [piece.entityId, entity("ac")],
    });
    const solved = solve(after);
    expect(solved.status.solveState).toBe("solved");
    expect(accepted(after)).toBe(true);
    expect(displacement(after)).toBeLessThan(1e-9);
    const gaps = arcEndGaps(after);
    expect(Math.max(gaps[kept.entityId]!, gaps[piece.entityId]!)).toBeLessThan(
      1e-9,
    );
  });

  test("T13m + OP9: a half disk whose arc is Split keeps its region (area 2π): the two co-circular arcs' shared end certifies as a declared join; a split line in the same profile keeps it too", async () => {
    const disk = upperArc();
    disk.line("diameter", "a", "b");
    disk.point("v0", 1, 0.5);
    disk.point("v1", 1, 3);
    disk.line("boundary", "v0", "v1");
    const before = disk.definition();
    expect(await regions(before)).toBe(1);
    const { after } = await lineEdit(before, "split", "target", "boundary");
    expect(accepted(after)).toBe(true);
    // OP9 premise: both arcs' supports are bitwise the same circle (before
    // OP9 this was `region-join-uncertain … coincident-circle-supports`).
    expect(arcRadii(after)).toEqual([2, 2]);
    const { areas, diagnostics } = await regionAreas(after);
    expect(areas).toHaveLength(1);
    expect(areas[0]).toBeCloseTo(2 * Math.PI, 9);
    expect(diagnostics).not.toContain("region-join-uncertain");
    expect(diagnostics).not.toContain("coincident-circle-supports");
    // The same profile with its diameter split instead keeps its region.
    const spoke = upperArc();
    spoke.line("diameter", "a", "b");
    spoke.point("s0", 1, -1);
    spoke.point("s1", 1, 0.5);
    spoke.line("boundary", "s0", "s1");
    const split = await lineEdit(
      spoke.definition(),
      "split",
      "diameter",
      "boundary",
    );
    expect(await regions(split.after)).toBe(1);
  });

  test("T13m circle crossed twice: the original id becomes the ccw arc Q₁→Q₂, a new `split-arc` the ccw arc Q₂→Q₁; both bound to their ends; radius → diameter; R-3 by angle; solved in place; OP9: both regions kept with their segment areas", async () => {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0);
    sketch.circle("target", "o", 2);
    sketch.point("b0", -3, 1);
    sketch.point("b1", 3, 1);
    sketch.line("boundary", "b0", "b1");
    sketch.point("top", 0, 2);
    const top = sketch.pointOnCurve("top", "target");
    sketch.point("bottom", 0, -2);
    const bottom = sketch.pointOnCurve("bottom", "target");
    const radius = {
      dimensionId: "dimension_radius" as DimensionId,
      kind: "circleRadius" as const,
      label: "Radius 7",
      entityId: entity("target"),
      value: createLiteralAuthoredValue(2),
    };
    const before = {
      ...sketch.definition(),
      dimensionIds: [radius.dimensionId],
      dimensions: [radius],
    } as SketchDefinition;
    expect(accepted(before), "premise").toBe(true);
    const regionsBefore = await regions(before);
    const { result, after } = await lineEdit(
      before,
      "split",
      "target",
      "boundary",
    );
    expect(result.cuts).toHaveLength(2);
    const kept = entityOf(after, entity("target"));
    const piece = after.entities.at(-1);
    if (kept?.kind !== "arc" || piece?.kind !== "arc") throw new Error("arcs");
    expect(piece.entityId).toMatch(/split-arc/);
    expect([kept.sweepDirection, piece.sweepDirection]).toEqual([
      "counterClockwise",
      "counterClockwise",
    ]);
    expect([piece.startPointId, piece.endPointId]).toEqual([
      kept.endPointId,
      kept.startPointId,
    ]);
    expect(positionOf(after, kept.startPointId)).toEqual(
      result.cuts[0]!.position,
    );
    expect(positionOf(after, kept.endPointId)).toEqual(
      result.cuts[1]!.position,
    );
    expect(positionOf(after, kept.startPointId)[0]).toBeGreaterThan(0);
    expect(splitTies(before, after)).toEqual([
      [kept.startPointId, "pointOnCurve", entity("boundary")],
      [kept.endPointId, "pointOnCurve", entity("boundary")],
    ]);
    const curveOf = (constraintId: string) => {
      const constraint = after.constraints.find(
        (candidate) => candidate.constraintId === constraintId,
      );
      return constraint?.kind === "pointOnCurve"
        ? constraint.curve.entityId
        : null;
    };
    expect(curveOf(top)).toBe(entity("target"));
    expect(curveOf(bottom)).toBe(piece.entityId);
    expect(after.dimensions).toEqual([
      {
        dimensionId: "dimension_radius",
        kind: "diameter",
        label: "Diameter 7",
        entityId: entity("target"),
        value: createLiteralAuthoredValue(4),
      },
      ...[kept, piece].flatMap((arc) => [
        expect.objectContaining({
          kind: "arcStartPointCoincident",
          entityId: arc.entityId,
          pointId: arc.startPointId,
        }),
        expect.objectContaining({
          kind: "arcEndPointCoincident",
          entityId: arc.entityId,
          pointId: arc.endPointId,
        }),
      ]),
    ]);
    expect(accepted(after)).toBe(true);
    expect(displacement(after)).toBeLessThan(1e-9);
    const gaps = arcEndGaps(after);
    expect(Math.max(gaps[kept.entityId]!, gaps[piece.entityId]!)).toBeLessThan(
      1e-9,
    );
    // OP9 (was the T13m known limit): the two co-circular arcs, joined at
    // both cuts, certify; the chord y = 1 splits the disk r = 2 into the
    // segment of angle 2π/3 and the rest.
    expect(regionsBefore).toBe(2);
    expect(arcRadii(after), "premise: one bitwise support").toEqual([2, 2]);
    const { areas, diagnostics } = await regionAreas(after);
    const minor = 2 * ((2 * Math.PI) / 3 - Math.sin((2 * Math.PI) / 3));
    expect(areas).toHaveLength(2);
    expect(areas[0]).toBeCloseTo(minor, 9);
    expect(areas[1]).toBeCloseTo(4 * Math.PI - minor, 9);
    expect(diagnostics).not.toContain("region-join-uncertain");
    expect(diagnostics).not.toContain("coincident-circle-supports");
  });

  test("OP9 (review R-2): a circle Split by one line and both arcs Split by a second line crossing it off-centre gives four pieces of one circle and four regions with closed-form areas", async () => {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0);
    sketch.circle("target", "o", 2);
    // Lines chosen (OP9-evidence/four-piece-search) so all four pieces'
    // support radii round to exactly 2: the co-circular path.
    const l1: [P, P] = [
      [-3, 0.75],
      [3, 0.75],
    ];
    const l2: [P, P] = [
      [-0.4, -3],
      [-0.4, 3],
    ];
    sketch.point("l1a", ...l1[0]);
    sketch.point("l1b", ...l1[1]);
    sketch.line("boundary", "l1a", "l1b");
    sketch.point("l2a", ...l2[0]);
    sketch.point("l2b", ...l2[1]);
    sketch.line("second", "l2a", "l2b");
    let definition = sketch.definition();
    expect(await regions(definition), "before").toBe(4);
    ({ after: definition } = await lineEdit(
      definition,
      "split",
      "target",
      "boundary",
    ));
    const piece = definition.entities.at(-1)!.entityId;
    for (const target of [entity("target"), piece]) {
      ({ after: definition } = await lineEdit(
        definition,
        "split",
        target.replace("sketch_entity_", ""),
        "second",
      ));
    }
    expect(accepted(definition)).toBe(true);
    const radii = arcRadii(definition);
    expect(radii, "four arcs").toHaveLength(4);
    expect(
      radii.every((radius) => radius === 2),
      `premise: one bitwise support (${radii.join(", ")})`,
    ).toBe(true);
    const { areas, diagnostics } = await regionAreas(definition);
    expect(diagnostics).not.toContain("region-join-uncertain");
    expect(diagnostics).not.toContain("coincident-circle-supports");
    // Closed form from the cut angles: each region is the segment of its arc
    // plus the triangle (X, arc start, arc end), X the lines' crossing.
    const x = lineX(l1[0], l1[1], l2[0], l2[1]);
    const solved = solve(definition);
    const cuts = solved.solvedEntities
      .flatMap((record) =>
        record.kind === "arc" ? [record.startPosition] : [],
      )
      .map((point) => Math.atan2(point[1], point[0]))
      .sort((l, r) => l - r);
    const expected = cuts
      .map((theta, index) => {
        const next =
          index === cuts.length - 1 ? cuts[0]! + 2 * Math.PI : cuts[index + 1]!;
        const [p, q] = [theta, next].map(
          (angle): P => [2 * Math.cos(angle), 2 * Math.sin(angle)],
        );
        const phi = next - theta;
        return (
          2 * (phi - Math.sin(phi)) +
          ((p![0] - x[0]) * (q![1] - x[1]) - (p![1] - x[1]) * (q![0] - x[0])) /
            2
        );
      })
      .sort((l, r) => l - r);
    expect(areas).toHaveLength(4);
    areas.forEach((area, index) =>
      expect(area, "area vs closed form").toBeCloseTo(expected[index]!, 9),
    );
  }, 120_000);

  test("T13m open spline by a line: the original id keeps [S₀, Q], a new `split-spline` keeps [Q, end] (reusing the occurrence ids), sharing Q = cut.position bitwise; both reproduce the original ≤ 1e-12·scale; tied once; R-3; no fit point freed; solved in place", async () => {
    const sketch = makeSketchFixture();
    const fit: P[] = [
      [0, 0],
      [1, 2],
      [2, 2.5],
      [3, 2],
      [4, 0],
      [5, -1],
    ];
    fit.forEach((at, index) => sketch.point(`s${index}`, ...at));
    sketch.spline(
      "target",
      fit.map((_, index) => `s${index}`),
      "open",
      [undefined, undefined, undefined, undefined, [0.6, -0.9]] as never,
    );
    sketch.point("b0", 2.5, -1);
    sketch.point("b1", 2.5, 4);
    sketch.line("boundary", "b0", "b1");
    sketch.point("k0", 4, 0);
    sketch.point("k1", 4, 3);
    sketch.line("beyond", "k0", "k1");
    const beyond = sketch.pointOnCurve("k0", "target");
    const before = sketch.definition();
    expect(accepted(before), "premise").toBe(true);
    const solvedSnapshot = solve(before);
    const original = splineOf(before, "target");
    const { result, after } = await lineEdit(
      before,
      "split",
      "target",
      "boundary",
    );
    const [cut] = result.cuts;
    expect(cut!.knotOccurrenceIndex).toBeNull();
    const a = splineOf(after, "target");
    const pieceId = after.entityIds.at(-1)!;
    expect(pieceId).toMatch(/split-spline/);
    const b = after.entities.at(-1) as Spline;
    expect([b.label, a.closure, b.closure]).toEqual([
      "target split",
      "open",
      "open",
    ]);
    const [q] = newPoints(before, after);
    expect(newPoints(before, after)).toHaveLength(1);
    expect(q!.position, "Q is the service's position bitwise").toEqual(
      cut!.position,
    );
    expect(a.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
      "sketch_point_s0",
      "sketch_point_s1",
      "sketch_point_s2",
      q!.pointId,
    ]);
    expect(b.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
      q!.pointId,
      "sketch_point_s3",
      "sketch_point_s4",
      "sketch_point_s5",
    ]);
    expect(b.pointOccurrenceIds.slice(1)).toEqual(
      original.pointOccurrenceIds.slice(3),
    );
    expect(
      b.pointOccurrences[2]!.tangent,
      "an untouched authored tangent keeps its authored vector",
    ).toBe(original.pointOccurrences[4]!.tangent);
    const scale = 5;
    expect(
      reproductionError(before, solvedSnapshot, after, "target", 0),
    ).toBeLessThanOrEqual(1e-12 * scale);
    expect(
      reproductionError(
        before,
        solvedSnapshot,
        after,
        pieceId.replace("sketch_entity_", ""),
        cut!.representative,
      ),
    ).toBeLessThanOrEqual(1e-12 * scale);
    expect(splitTies(before, after)).toEqual([
      [q!.pointId, "pointOnCurve", entity("boundary")],
    ]);
    const moved = after.constraints.find(
      (constraint) => constraint.constraintId === beyond,
    );
    expect(
      moved?.kind === "pointOnCurve" ? moved.curve.entityId : null,
      "R-3: a point beyond the cut moves to the new piece",
    ).toBe(pieceId);
    expect(freePoints(after)).toEqual([]);
    expect(accepted(after)).toBe(true);
    expect(displacement(after)).toBeLessThan(1e-9);
  });

  test("T13m open spline by a spline: two splines sharing Q = cut.position, tied once to the boundary spline; solved in place", async () => {
    const sketch = makeSketchFixture();
    sketch.point("s0", 0, 0);
    sketch.point("s1", 2, 3);
    sketch.point("s2", 4, 0);
    sketch.spline("target", ["s0", "s1", "s2"], "open");
    sketch.point("w0", 0, 2);
    sketch.point("w1", 2, 1);
    sketch.point("w2", 3, 4);
    sketch.spline("boundary", ["w0", "w1", "w2"], "open");
    const before = sketch.definition();
    const { result, after } = await lineEdit(
      before,
      "split",
      "target",
      "boundary",
    );
    const [q] = newPoints(before, after);
    expect(q!.position).toEqual(result.cuts[0]!.position);
    const a = splineOf(after, "target");
    const b = after.entities.at(-1) as Spline;
    expect(a.pointOccurrences.at(-1)!.pointId).toBe(q!.pointId);
    expect(b.pointOccurrences[0]!.pointId).toBe(q!.pointId);
    expect(splitTies(before, after)).toEqual([
      [q!.pointId, "pointOnCurve", entity("boundary")],
    ]);
    expect(accepted(after)).toBe(true);
    expect(displacement(after)).toBeLessThan(1e-9);
    // Spline pairs are certified slowly (T13i: 1.3–10 s per pair).
  }, 120_000);

  test("T13m closed splines by y = 0.3: a smooth loop becomes one open spline (same id) Q → … → Q′ around the whole loop, both ends tied, reproducing it; a positional loop becomes two splines meeting at Q and at the corner; solved in place", async () => {
    for (const closure of ["smooth", "positional"] as const) {
      const sketch = makeSketchFixture();
      sketch.point("p0", 1, 0);
      sketch.point("p1", 0, 1);
      sketch.point("p2", -1, 0);
      sketch.point("p3", 0, -1);
      sketch.spline(
        "target",
        closure === "smooth"
          ? ["p0", "p1", "p2", "p3"]
          : ["p0", "p1", "p2", "p3", "p0"],
        closure,
      );
      sketch.point("a", -2, 0.3);
      sketch.point("b", 2, 0.3);
      sketch.line("chord", "a", "b");
      const before = sketch.definition();
      const solvedSnapshot = solve(before);
      const { result, after } = await lineEdit(
        before,
        "split",
        "target",
        "chord",
      );
      const [cut] = result.cuts;
      expect(
        cut!.position[0],
        `${closure}: first in traversal`,
      ).toBeGreaterThan(0);
      const added = newPoints(before, after);
      expect(freePoints(after), closure).toEqual([]);
      expect(accepted(after), `${closure}: accepted`).toBe(true);
      expect(displacement(after), closure).toBeLessThan(1e-9);
      if (closure === "smooth") {
        expect(after.entityIds).toEqual(before.entityIds);
        const loop = splineOf(after, "target");
        const [q, qEnd] = added;
        expect(added).toHaveLength(2);
        expect([q!.position, qEnd!.position]).toEqual([
          cut!.position,
          cut!.position,
        ]);
        expect(loop.closure).toBe("open");
        expect(loop.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
          q!.pointId,
          "sketch_point_p1",
          "sketch_point_p2",
          "sketch_point_p3",
          "sketch_point_p0",
          qEnd!.pointId,
        ]);
        expect(new Set(loop.pointOccurrenceIds).size).toBe(6);
        expect(splitTies(before, after)).toEqual([
          [q!.pointId, "pointOnCurve", entity("chord")],
          [qEnd!.pointId, "pointOnCurve", entity("chord")],
        ]);
        // The piece vs the original loop at (c + t) mod period.
        const record = solvedSnapshot.solvedEntities.find(
          (candidate) => candidate.entityId === entity("target"),
        );
        if (
          record?.kind !== "spline" ||
          record.reconstruction.validity !== "valid"
        )
          throw new Error("original");
        const spans = record.reconstruction.spans;
        const period = spans.at(-1)!.interval[1];
        const positions = Object.fromEntries([
          ...solvedSnapshot.solvedPoints.map(
            (entry) => [entry.pointId, entry.solvedPosition] as const,
          ),
          ...added.map((entry) => [entry.pointId, entry.position] as const),
        ]) as Record<SketchPointId, SketchPoint>;
        const piece = reconstructSplineAggregate(loop, positions);
        if (piece.validity !== "valid") throw new Error("piece");
        let worst = 0;
        for (const span of piece.spans)
          for (let k = 0; k <= 64; k++) {
            const u = k / 64;
            const unrolled =
              cut!.representative +
              span.interval[0] +
              u * (span.interval[1] - span.interval[0]);
            const t = Math.min(
              period,
              unrolled >= period ? unrolled - period : unrolled,
            );
            const host = spans.find((entry) => t <= entry.interval[1])!;
            const expected = evaluateSplineSpan(host, {
              kind: "source",
              value: Math.max(t, host.interval[0]),
            }).position;
            const at = evaluateSplineSpan(span, {
              kind: "local",
              value: u,
            }).position;
            worst = Math.max(
              worst,
              Math.hypot(at[0] - expected[0], at[1] - expected[1]),
            );
          }
        expect(
          worst,
          "the open loop reproduces the closed one",
        ).toBeLessThanOrEqual(1e-12);
      } else {
        const [q] = added;
        expect(added).toHaveLength(1);
        const first = splineOf(after, "target");
        const second = after.entities.at(-1) as Spline;
        expect(second.entityId).toMatch(/split-spline/);
        expect(first.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
          "sketch_point_p0",
          q!.pointId,
        ]);
        expect(second.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
          q!.pointId,
          "sketch_point_p1",
          "sketch_point_p2",
          "sketch_point_p3",
          "sketch_point_p0",
        ]);
        expect(splitTies(before, after)).toEqual([
          [q!.pointId, "pointOnCurve", entity("chord")],
        ]);
      }
    }
  });

  test("T13m smooth loop cut at a knot (y = 0 through the seam p0): the loop opens at p0 — it starts on p0 and ends on a new point at p0's position, both tied; solved in place", async () => {
    const sketch = makeSketchFixture();
    sketch.point("p0", 1, 0);
    sketch.point("p1", 0, 1);
    sketch.point("p2", -1, 0);
    sketch.point("p3", 0, -1);
    sketch.spline("target", ["p0", "p1", "p2", "p3"], "smooth");
    sketch.point("a", 0.5, 0);
    sketch.point("b", 2, 0);
    sketch.line("ray", "a", "b");
    const before = sketch.definition();
    const { result, after } = await lineEdit(before, "split", "target", "ray");
    expect(result.cuts[0]!.knotOccurrenceIndex).toBe(0);
    const added = newPoints(before, after);
    expect(added).toHaveLength(1);
    const [end] = added;
    expect(end!.position).toEqual(positionOf(before, "sketch_point_p0"));
    const loop = splineOf(after, "target");
    expect(loop.closure).toBe("open");
    expect(loop.pointOccurrences.map(({ pointId }) => pointId)).toEqual([
      "sketch_point_p0",
      "sketch_point_p1",
      "sketch_point_p2",
      "sketch_point_p3",
      end!.pointId,
    ]);
    expect(new Set(loop.pointOccurrenceIds).size).toBe(5);
    expect(loop.endSpanParameterLengths).toBeUndefined();
    expect(splitTies(before, after)).toEqual([
      ["sketch_point_p0", "pointOnCurve", entity("ray")],
      [end!.pointId, "pointOnCurve", entity("ray")],
    ]);
    expect(accepted(after)).toBe(true);
    expect(displacement(after)).toBeLessThan(1e-9);
  });
});

describe("O27 corner replacement", () => {
  const cornerId = "sketch_point_a" as SketchPointId;
  const lineIds = ["sketch_entity_ab", "sketch_entity_ac"] as SketchEntityId[];
  function corner() {
    const fixture = makeSketchFixture();
    fixture.point("a", 0, 0);
    fixture.point("b", 4, 0);
    fixture.point("c", 0, 4);
    fixture.line("ab", "a", "b");
    fixture.line("ac", "a", "c");
    return fixture;
  }
  function wrapper(definition: SketchDefinition) {
    const factories = createSessionCommitFactories(
      1,
      FIXTURE_SKETCH_ID as SketchId,
    );
    const entity = factories.createPointEntity(
      "Corner",
      factories.createEntityId("corner"),
      cornerId,
    );
    definition.entityIds.push(entity.entityId);
    definition.entities.push(entity);
    return entity;
  }
  for (const kind of ["fillet", "chamfer"] as const) {
    function mutate(definition: SketchDefinition) {
      const common = {
        definition,
        entityIds: lineIds,
        sequence: 2,
        factories: createSessionCommitFactories(
          2,
          FIXTURE_SKETCH_ID as SketchId,
        ),
      };
      const result =
        kind === "fillet"
          ? createSketchFilletMutation({ ...common, radius: 1 })
          : createSketchChamferMutation({ ...common, distance: 1 });
      expect(result.valid).toBe(true);
      return result;
    }
    test(`${kind} preview hides the discarded marker; cancel and undo restore it`, async () => {
      const fixture = corner();
      const session = updateSketchReferenceProjection(
        createSketchSessionFromSnapshot(
          sketchSnapshotRecordForTest(
            fixture.build(),
            [],
            createStandardPlaneDefinition("xy"),
          ),
          OCC_KERNEL_SETTINGS,
        ),
        [],
        [],
      );
      const owner = await createSketchActionOwnerFixture(session);
      const original = structuredClone(owner.session.definition);
      const marker = () =>
        getSketchSessionDisplayRenderables(owner.session).some(
          (r) =>
            r.target?.kind === "sketchPoint" && r.target.pointId === cornerId,
        );
      expect(marker()).toBe(true); // Warm the stable-display cache before staging.
      owner.dispatch({
        type: "tool.activated",
        toolId: kind === "fillet" ? "sketchFillet" : "sketchChamfer",
      });
      const stage = () => {
        for (const entityId of lineIds)
          owner.dispatch({
            type: "viewport.selectionRequested",
            target: {
              kind: "sketchEntity",
              sketchId: owner.session.sketchId as SketchId,
              entityId,
            },
          });
        owner.dispatch({ type: "sketch.toolPatched", patch: { value: "1" } });
      };
      stage();
      expect(owner.session.toolStagedEntities.length).toBeGreaterThan(0);
      expect(marker()).toBe(false);
      expect(owner.session.definition).toEqual(original);
      owner.dispatch({
        type: "sketch.toolPatched",
        patch: { intent: "cancelSketchEditOperator" },
      });
      expect(marker()).toBe(true);
      stage();
      owner.dispatch({
        type: "sketch.toolPatched",
        patch: { intent: "commitSketchEditOperator" },
      });
      expect(owner.session.definition.pointIds).not.toContain(cornerId);
      expect(marker()).toBe(false);
      expect(owner.undoLabels()).toHaveLength(1);
      owner.dispatch({ type: "history.undoRequested" });
      expect(owner.session.definition).toEqual(original);
      expect(marker()).toBe(true);
      owner.dispatch({ type: "history.redoRequested" });
      expect(owner.session.definition.pointIds).not.toContain(cornerId);
      expect(marker()).toBe(false);
    });
    test(`${kind} reconciles both coincident endpoint records with unique virtual-sharp identities`, () => {
      const fixture = makeSketchFixture();
      fixture.point("a", 0, 0);
      const secondId = fixture.point("a2", 0, 0);
      fixture.point("b", 4, 0);
      fixture.point("c", 0, 4);
      fixture.line("ab", "a", "b");
      fixture.line("ac", "a2", "c");
      fixture.coincident("a", "a2");
      const after = mutate(fixture.definition()).definition!;
      for (const pointId of [cornerId, secondId]) {
        expect(
          after.points.find((p) => p.pointId === pointId)?.isConstruction,
        ).toBe(true);
        expect(
          after.entities.filter(
            (e) => e.kind === "point" && e.pointId === pointId,
          ),
        ).toHaveLength(1);
        expect(
          after.constraints.filter(
            (c) =>
              c.kind === "collinear" &&
              c.target.kind === "localPoint" &&
              c.target.pointId === pointId,
          ),
        ).toHaveLength(2);
      }
      expect(new Set(after.entityIds).size).toBe(after.entityIds.length);
      expect(new Set(after.constraintIds).size).toBe(
        after.constraintIds.length,
      );
    });
    for (const wrapped of [false, true]) {
      test(`${kind} removes an unreferenced corner${wrapped ? " and its point entity" : ""}`, () => {
        const before = corner().definition();
        const entity = wrapped ? wrapper(before) : null;
        const original = structuredClone(before);
        const result = mutate(before);
        expect(result.definition!.pointIds).not.toContain(cornerId);
        expect(
          result.definition!.points.some((p) => p.pointId === cornerId),
        ).toBe(false);
        if (entity)
          expect(result.definition!.entityIds).not.toContain(entity.entityId);
        expect(before).toEqual(original); // History must retain the entire pre-edit corner graph.
        for (const preview of result.previewEntities) {
          if (preview.kind === "line") {
            expect(preview.start).not.toEqual([0, 0]);
            expect(preview.end).not.toEqual([0, 0]);
          }
        }
      });
    }
    for (const reference of [
      "dimension",
      "third line",
      "constraint",
      "derived point",
      "derived wrapper",
      "styled wrapper",
    ] as const) {
      test(`${kind} retains a virtual sharp referenced by a ${reference}`, () => {
        const fixture = corner();
        if (reference === "third line") {
          fixture.point("d", -3, -3);
          fixture.line("ad", "a", "d");
        }
        const before = fixture.definition();
        const pointEntity =
          reference === "derived wrapper" || reference === "styled wrapper"
            ? wrapper(before)
            : null;
        if (reference === "styled wrapper") {
          before.styles = [
            {
              styleId: "corner-style" as NonNullable<
                SketchDefinition["styles"]
              >[number]["styleId"],
              label: "Corner style",
              target: { kind: "entity", entityId: pointEntity!.entityId },
              fill: { kind: "none" },
              stroke: {
                color: "#ffffff",
                opacity: 1,
                width: 1,
                lineCap: "round",
                lineJoin: "round",
                miterLimit: 4,
              },
            },
          ];
          before.styleIds = before.styles.map((s) => s.styleId);
        }
        if (reference === "dimension") {
          before.dimensions.push({
            kind: "distance",
            dimensionId: "dimension_corner" as DimensionId,
            label: "Corner to B",
            axis: "horizontal",
            pointIds: [cornerId, "sketch_point_b" as SketchPointId],
            value: createLiteralAuthoredValue(4),
          });
          before.dimensionIds.push(before.dimensions[0]!.dimensionId);
        }
        if (reference === "constraint") {
          const constraint = {
            kind: "fixPoint" as const,
            constraintId: createSessionCommitFactories(
              1,
              FIXTURE_SKETCH_ID as SketchId,
            ).createConstraintId("corner"),
            label: "Fixed corner",
            pointId: cornerId,
            position: [0, 0] as const,
          };
          before.constraints.push(constraint);
          before.constraintIds.push(constraint.constraintId);
        }
        if (reference === "derived point" || reference === "derived wrapper") {
          before.derivedRelationships = [
            {
              kind: "transform",
              derivationId: "corner-owner",
              label: "Corner owner",
              origin: [0, 0],
              translation: [1, 1],
              rotationRadians: 0,
              scale: 1,
              seedEntityIds: pointEntity ? [pointEntity.entityId] : [],
              outputs: pointEntity
                ? []
                : [
                    {
                      seedEntityId: lineIds[0]!,
                      outputEntityId: "derived_line" as SketchEntityId,
                      instanceIndex: 1,
                      seedPointIds: [cornerId],
                      outputPointIds: [],
                    },
                  ],
            },
          ];
        }
        const after = mutate(before).definition!;
        expect(after.pointIds).toContain(cornerId);
        expect(
          after.points.find((p) => p.pointId === cornerId)?.isConstruction,
        ).toBe(true);
        const virtual = after.entities.filter(
          (e) => e.kind === "point" && e.pointId === cornerId,
        );
        expect(virtual).toHaveLength(1);
        expect(virtual[0]).toMatchObject({
          isConstruction: true,
          label: `${kind === "fillet" ? "Fillet" : "Chamfer"} 2 virtual sharp`,
        });
        if (pointEntity)
          expect(virtual[0]!.entityId).toBe(pointEntity.entityId);
        const ties = after.constraints.filter(
          (c) =>
            c.kind === "collinear" &&
            c.target.kind === "localPoint" &&
            c.target.pointId === cornerId,
        );
        expect(ties).toHaveLength(2);
        expect(
          ties.map((c) => c.kind === "collinear" && c.line.entityId),
        ).toEqual(lineIds);
        expect(after.dimensions).toEqual(
          expect.arrayContaining(before.dimensions),
        );
        expect(after.constraints).toEqual(
          expect.arrayContaining(before.constraints),
        );
        if (
          reference === "derived point" ||
          reference === "derived wrapper" ||
          reference === "styled wrapper"
        )
          return;
        // Start the sharp off its intersection: merely keeping a disconnected point must not pass.
        const displaced = {
          ...after,
          points: after.points.map((p) =>
            p.pointId === cornerId
              ? { ...p, position: [-0.2, -0.3] as const }
              : p,
          ),
        };
        const solved = solveSketchDefinitionCore({
          definition: literalResolvedDefinition(displaced),
          tolerances: {
            coincidence: 1e-6,
            angleRadians: 1e-6,
            minimumSegmentLength: 1e-6,
          },
          modelingTolerance: 1e-3,
          partialSolvePolicy: "bestEffort",
        }).solvedSnapshot;
        expect(solved.status.solveState).toBe("solved");
        expect(
          solved.constraintStatuses.every((s) =>
            isAcceptedConstraintStatus(s.status),
          ),
        ).toBe(true);
        expect(
          solved.dimensionStatuses.every((s) => s.status === "driving"),
        ).toBe(true);
        if (reference === "dimension") {
          expect(
            solved.dimensionStatuses.find(
              (s) => s.dimensionId === "dimension_corner",
            )?.solvedValue,
          ).toBeCloseTo(4, 5);
        }
        const sharp = solved.solvedPoints.find(
          (p) => p.pointId === cornerId,
        )!.solvedPosition;
        for (const id of lineIds) {
          const line = after.entities.find((e) => e.entityId === id)!;
          if (line.kind !== "lineSegment")
            throw new Error("Expected trimmed line");
          const at = (id: SketchPointId) =>
            solved.solvedPoints.find((p) => p.pointId === id)!.solvedPosition;
          const start = at(line.startPointId),
            end = at(line.endPointId);
          const residual =
            (sharp[0] - start[0]) * (end[1] - start[1]) -
            (sharp[1] - start[1]) * (end[0] - start[0]);
          expect(Math.abs(residual)).toBeLessThan(1e-5);
        }
      });
    }
  }
});
