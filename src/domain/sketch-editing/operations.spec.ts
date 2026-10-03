import { test, expect } from "vitest";

import type {
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import type { SketchPoint } from "@/contracts/modeling/schema";
import {
  reconstructSplineAggregate,
  tessellateCubicSpans,
} from "@/contracts/sketch/spline-geometry";
import {
  neutralSpan,
  projectedSpline,
} from "@/contracts/sketch/region-extraction.fixtures";
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
  offsetCurveDescriptorFromProjectedGeometry,
  type SketchEditOperationFactories,
} from "@/domain/sketch-editing/operations";

test("src/domain/sketch-editing/operations.spec.ts", () => {
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

  function testExtendAndSplitMutateOnlySelectedLine() {
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
      entityIds: ["sketch_entity_ab", "sketch_entity_cd"] as SketchEntityId[],
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      extended.valid && extended.definition,
      "Extend should accept a target line and boundary line.",
    ).toBeTruthy();
    expect(
      extended.definition?.entities.length,
      "Extend should not add unrelated entities.",
    ).toBe(extendDefinition.entities.length);
    expect(
      extended.definition?.points.some(
        (point) => point.position[0] === 3 && point.position[1] === 0,
      ),
      "Extend should add an endpoint at the boundary intersection.",
    ).toBeTruthy();

    const split = createSketchSplitMutation({
      definition: createCrossingDefinition(),
      entityIds: ["sketch_entity_ab", "sketch_entity_cd"] as SketchEntityId[],
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      split.valid && split.definition,
      "Split should accept a target line and crossing boundary.",
    ).toBeTruthy();
    expect(
      split.definition?.entities.length,
      "Split should divide the selected line into two line entities.",
    ).toBe(3);
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
    expect(
      splineSlot.valid && splineSlot.contribution,
      "Slot should accept a spline reference.",
    ).toBeTruthy();
    expect(
      splineSlot.contribution?.entities.some(
        (entity) => entity.kind === "spline",
      ),
      "Spline slot should create spline boundary geometry.",
    ).toBeTruthy();
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
    expect(splineOffset.valid, "Spline offset should be valid.").toBeTruthy();
    const offsetPoints = splineOffset.contribution?.points ?? [];
    expect(
      offsetPoints.length,
      "Spline offset should consume the owner-sampled complete cubic spans.",
    ).toBeGreaterThan(3);
    expect(offsetPoints[0]!.position[0]).toBeLessThan(0);
    expect(offsetPoints[0]!.position[1]).toBeGreaterThan(0);
    expect(offsetPoints.at(-1)!.position[0]).toBeGreaterThan(2);
    expect(offsetPoints.at(-1)!.position[1]).toBeGreaterThan(0);
    expect(
      Math.max(...offsetPoints.map((point) => point.position[1])),
    ).toBeGreaterThan(2);
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
  testExtendAndSplitMutateOnlySelectedLine();
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

  // The static D6 offset reads the spans' display polyline (until T10h):
  // the same points the one tessellator draws for the spans.
  const offset = createOffsetContribution({
    curve: descriptor!,
    distance: 0.5,
    side: "left",
    sequence: 1,
    factories: {
      createPointId: (suffix) => `point_${suffix}` as SketchPointId,
      createEntityId: (suffix) => `entity_${suffix}` as SketchEntityId,
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
      createSplineEntity: (label, entityId) =>
        ({ kind: "spline", label, entityId }) as never,
    } as never,
  });
  expect(offset.contribution?.points).toHaveLength(
    tessellateCubicSpans(spans).length,
  );
});
