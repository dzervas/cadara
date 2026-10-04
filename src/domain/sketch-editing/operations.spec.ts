import { describe, test, expect } from "vitest";

import type {
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import type { SketchPoint } from "@/contracts/modeling/schema";
import {
  evaluateSplineSpan,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import { nextUp } from "@/contracts/sketch/region-interval-geometry";
import { applySolvedSketchToDefinition } from "@/domain/editor/sketch-session/definition-patches";
import {
  FIXTURE_SKETCH_ID,
  makeSketchFixture,
  neutralSpan,
  projectedSpline,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  querySketchEditIntersections,
  type SketchEditIntersectionResult,
} from "@/contracts/sketch/edit-intersections";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import { isAcceptedConstraintStatus } from "@/contracts/sketch/schema";
import { createSessionCommitFactories } from "@/domain/editor/sketch-session/internals";
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
        definition,
        solvedSnapshot: solveSketchDefinitionCore({
          definition,
          tolerances: {
            coincidence: 1e-6,
            angleRadians: 1e-6,
            minimumSegmentLength: 1e-6,
          },
          modelingTolerance: 1e-3,
          partialSolvePolicy: "bestEffort",
        }).solvedSnapshot,
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
      expect(
        relationship.distance,
        "The right side should store a negative signed distance.",
      ).toBe(-1);
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

  const solve = (definition: SketchDefinition) =>
    solveSketchDefinitionCore({
      definition,
      tolerances: TOLERANCES,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    }).solvedSnapshot;
  const accepted = (definition: SketchDefinition) => {
    const solved = solve(definition);
    return (
      solved.status.solveState === "solved" &&
      solved.constraintStatuses.every((entry) =>
        isAcceptedConstraintStatus(entry.status),
      )
    );
  };
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
  async function intersections(definition: SketchDefinition, target: string) {
    const result = await querySketchEditIntersections(
      {
        definition,
        solvedSnapshot: solve(definition),
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
  ) {
    const mutation = createSketchTrimMutation({
      definition,
      targetEntityId: entity(target),
      intersections: result,
      solvedSnapshot: solve(definition),
      factories: createSessionCommitFactories(1, FIXTURE_SKETCH_ID as SketchId),
    });
    expect(mutation.message).toBeNull();
    return mutation.definition;
  }
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
    for (const [value, doubled] of [
      [2, 4],
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
      const after = apply(
        definition,
        "target",
        await intersections(resolved(definition), "target"),
      );
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
      ]);
      const numeric = resolved(after);
      expect(
        numeric.dimensions[0]?.kind === "diameter" &&
          numeric.dimensions[0].value,
        "the doubled value evaluates to twice the radius",
      ).toBe(4);
      expect(accepted(numeric), `${JSON.stringify(value)}: solves`).toBe(true);
      // The unconverted radius dimension on the arc does not (mutant oracle).
      expect(
        accepted({ ...numeric, dimensions: resolved(definition).dimensions }),
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
        definition,
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
  ) {
    const result = await querySketchEditIntersections(
      {
        definition,
        solvedSnapshot: solve(definition),
        projectedReferences: [],
        modelingTolerance: 1e-3,
        operation: {
          kind,
          targetEntityId: entity(target),
          boundaryEntityId: entity(boundary),
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
});
