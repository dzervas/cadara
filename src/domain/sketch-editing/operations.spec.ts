import { test, expect } from "vitest";

import type {
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import type { SketchPoint } from "@/contracts/modeling/schema";
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
  createSketchOffsetDerivationContribution,
  createSketchSlotContribution,
  createSketchSplitMutation,
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
      fitPointIds: fitPointIds.map((pointId) => pointId as SketchPointId),
      degree: 2 as const,
    };
  }

  function makeDefinition(
    points: SketchDefinition["points"],
    entities: SketchDefinition["entities"],
  ): SketchDefinition {
    return {
      schemaVersion: "sketch-definition/v1alpha1",
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
      createSplineEntity: (label, entityId, fitPointIds) => ({
        kind: "spline",
        entityId,
        label,
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary" as SketchId,
          entityId,
        },
        isConstruction: false,
        fitPointIds,
        degree: 2,
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
    const lineDefinition = makeDefinition(
      [
        makePoint("sketch_point_a", "A", [0, 0]),
        makePoint("sketch_point_b", "B", [4, 0]),
      ],
      [makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b")],
    );
    const leftLine = createOffsetContribution({
      definition: lineDefinition,
      entityIds: ["sketch_entity_ab"] as SketchEntityId[],
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
      definition: lineDefinition,
      entityIds: ["sketch_entity_ab"] as SketchEntityId[],
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

    const circleDefinition = makeDefinition(
      [makePoint("sketch_point_center", "Center", [1, 1])],
      [
        {
          kind: "circle",
          entityId: "sketch_entity_circle" as SketchEntityId,
          label: "Circle",
          target: {
            kind: "sketchEntity",
            sketchId: "sketch_primary" as SketchId,
            entityId: "sketch_entity_circle" as SketchEntityId,
          },
          isConstruction: false,
          centerPointId: "sketch_point_center" as SketchPointId,
          radius: 2,
        },
      ],
    );
    const grownCircle = createOffsetContribution({
      definition: circleDefinition,
      entityIds: ["sketch_entity_circle"] as SketchEntityId[],
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
      definition: circleDefinition,
      entityIds: ["sketch_entity_circle"] as SketchEntityId[],
      distance: 2,
      side: "right",
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      collapsedCircle.valid,
      "Circle offset collapsing the radius should be rejected.",
    ).toBeFalsy();

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
    const grownArc = createOffsetContribution({
      definition: arcDefinition,
      entityIds: ["sketch_entity_arc"] as SketchEntityId[],
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
      definition: arcDefinition,
      entityIds: ["sketch_entity_arc"] as SketchEntityId[],
      distance: 2,
      side: "right",
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      collapsedArc.valid,
      "Arc offset collapsing the radius should be rejected.",
    ).toBeFalsy();

    const splineDefinition = makeDefinition(
      [
        makePoint("sketch_point_s0", "S0", [0, 0]),
        makePoint("sketch_point_s1", "S1", [1, 2]),
        makePoint("sketch_point_s2", "S2", [2, 0]),
      ],
      [
        makeSpline("sketch_entity_spline", "Spline", [
          "sketch_point_s0",
          "sketch_point_s1",
          "sketch_point_s2",
        ]),
      ],
    );
    const splineOffset = createOffsetContribution({
      definition: splineDefinition,
      entityIds: ["sketch_entity_spline"] as SketchEntityId[],
      distance: 1,
      side: "left",
      sequence: 10,
      factories: createFactories(),
    });
    expect(splineOffset.valid, "Spline offset should be valid.").toBeTruthy();
    const sqrt5 = Math.sqrt(5);
    expectPointCloseTo(
      splineOffset.contribution?.points[0]?.position,
      [-2 / sqrt5, 1 / sqrt5],
      "Spline offset first point",
    );
    expectPointCloseTo(
      splineOffset.contribution?.points[1]?.position,
      [1, 3],
      "Spline offset middle point",
    );
    expectPointCloseTo(
      splineOffset.contribution?.points[2]?.position,
      [2 + 2 / sqrt5, 1 / sqrt5],
      "Spline offset last point",
    );
  }

  function testOffsetCharacterizationChains() {
    const openChain = makeDefinition(
      [
        makePoint("sketch_point_a", "A", [0, 0]),
        makePoint("sketch_point_b", "B", [4, 0]),
        makePoint("sketch_point_c", "C", [4, 4]),
      ],
      [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
      ],
    );
    const openOffset = createOffsetContribution({
      definition: openChain,
      entityIds: ["sketch_entity_ab", "sketch_entity_bc"] as SketchEntityId[],
      distance: 1,
      side: "left",
      sequence: 10,
      factories: createFactories(),
    });
    expect(openOffset.valid, "Open chain offset should be valid.").toBeTruthy();
    expect(
      openOffset.contribution?.entities.length,
      "Open two-line chain offset should keep two line entities.",
    ).toBe(2);
    expectPointCloseTo(
      openOffset.contribution?.points[0]?.position,
      [0, 1],
      "Open chain offset start",
    );
    expectPointCloseTo(
      openOffset.contribution?.points[1]?.position,
      [3, 1],
      "Open chain offset corner",
    );
    expectPointCloseTo(
      openOffset.contribution?.points[2]?.position,
      [3, 4],
      "Open chain offset end",
    );

    const closedChain = makeDefinition(
      [
        makePoint("sketch_point_a", "A", [0, 0]),
        makePoint("sketch_point_b", "B", [4, 0]),
        makePoint("sketch_point_c", "C", [4, 4]),
        makePoint("sketch_point_d", "D", [0, 4]),
      ],
      [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_da", "DA", "sketch_point_d", "sketch_point_a"),
      ],
    );
    const closedOffset = createOffsetContribution({
      definition: closedChain,
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_da",
      ] as SketchEntityId[],
      distance: 1,
      side: "left",
      sequence: 10,
      factories: createFactories(),
    });
    expect(
      closedOffset.valid,
      "Closed loop offset should be valid.",
    ).toBeTruthy();
    expect(
      closedOffset.contribution?.entities.length,
      "Closed square loop offset should keep four line entities.",
    ).toBe(4);
    const closedPositions = closedOffset.contribution?.points.map(
      (point) => point.position,
    );
    expect(
      closedPositions?.some(
        (position) =>
          Math.abs(position[0] - -1) < 1e-6 && Math.abs(position[1] - -1) < 1e-6,
      ),
      "Left offset of a counter-clockwise loop should expand outward.",
    ).toBeTruthy();
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
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_far",
      ] as SketchEntityId[],
      distance: 1,
      side: "left",
      sequence: 10,
      factories: createFactories(),
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
      committed.contribution?.entities.filter(
        (entity) => entity.kind === "arc",
      ).length,
      "The convex corner should stage a joint arc entity.",
    ).toBe(1);
    expect(
      committed.previewEntities.length > 0,
      "A valid offset derivation should stage preview geometry.",
    ).toBeTruthy();
  }

  testFilletAndChamferMutateAdjacentLines();
  testExtendAndSplitMutateOnlySelectedLine();
  testSlotCreatesDurableGeometryForSupportedReferences();
  testSlotCreatesProfileOffsetsForClosedLineLoops();
  testOffsetCharacterizationSingleCurves();
  testOffsetCharacterizationChains();
  testSlotOffsetCharacterization();
  testOffsetDerivationValidationAndCommitPreparation();
});
