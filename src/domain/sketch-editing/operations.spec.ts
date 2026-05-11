import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import {
  createSketchChamferMutation,
  createSketchExtendMutation,
  createSketchFilletMutation,
  createSketchSlotContribution,
  createSketchSplitMutation,
  type SketchEditOperationFactories,
} from "@/domain/sketch-editing/operations";

test("src/domain/sketch-editing/operations.spec.ts", () => {
  function makePoint(pointId: string, label: string, position: SketchPoint) {
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
  ) {
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
  ) {
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
  ) {
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
    expectTrue(
      fillet.valid && fillet.definition,
      "Fillet should accept adjacent line segments.",
    );
    expectTrue(
      fillet.definition.entities.some((entity) => entity.kind === "arc"),
      "Fillet should add a durable arc.",
    );
    expectTrue(
      fillet.previewEntities.length > 0,
      "Fillet should expose preview geometry.",
    );

    const chamfer = createSketchChamferMutation({
      definition: createCornerDefinition(),
      entityIds: ["sketch_entity_ab", "sketch_entity_ac"] as SketchEntityId[],
      distance: 1,
      sequence: 10,
      factories: createFactories(),
    });
    expectTrue(
      chamfer.valid && chamfer.definition,
      "Chamfer should accept adjacent line segments.",
    );
    expectTrue(
      chamfer.definition.entities.length === 3,
      "Chamfer should preserve source lines and add one chamfer line.",
    );
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
    expectTrue(
      extended.valid && extended.definition,
      "Extend should accept a target line and boundary line.",
    );
    expectTrue(
      extended.definition.entities.length === extendDefinition.entities.length,
      "Extend should not add unrelated entities.",
    );
    expectTrue(
      extended.definition.points.some(
        (point) => point.position[0] === 3 && point.position[1] === 0,
      ),
      "Extend should add an endpoint at the boundary intersection.",
    );

    const split = createSketchSplitMutation({
      definition: createCrossingDefinition(),
      entityIds: ["sketch_entity_ab", "sketch_entity_cd"] as SketchEntityId[],
      sequence: 10,
      factories: createFactories(),
    });
    expectTrue(
      split.valid && split.definition,
      "Split should accept a target line and crossing boundary.",
    );
    expectTrue(
      split.definition.entities.length === 3,
      "Split should divide the selected line into two line entities.",
    );
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
    expectTrue(
      lineSlot.valid && lineSlot.contribution,
      "Slot should accept a line reference.",
    );
    expectTrue(
      lineSlot.contribution.entities.filter((entity) => entity.kind === "arc")
        .length === 2,
      "Line slot should add rounded end arcs.",
    );

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
    expectTrue(
      arcSlot.valid && arcSlot.contribution,
      "Slot should accept an arc reference.",
    );
    expectTrue(
      arcSlot.contribution.entities.some((entity) => entity.kind === "arc"),
      "Arc slot should create arc boundary geometry.",
    );

    const splineSlot = createSketchSlotContribution({
      definition: curveDefinition,
      entityIds: ["sketch_entity_spline"] as SketchEntityId[],
      width: 1,
      sequence: 10,
      factories: createFactories(),
    });
    expectTrue(
      splineSlot.valid && splineSlot.contribution,
      "Slot should accept a spline reference.",
    );
    expectTrue(
      splineSlot.contribution.entities.some(
        (entity) => entity.kind === "spline",
      ),
      "Spline slot should create spline boundary geometry.",
    );
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

    expectTrue(
      slot.valid && slot.contribution,
      "Slot should accept a closed line profile.",
    );
    expectTrue(
      slot.contribution.entities.length === 8,
      "Closed profile slot should create outer and inner line loops.",
    );
  }

  testFilletAndChamferMutateAdjacentLines();
  testExtendAndSplitMutateOnlySelectedLine();
  testSlotCreatesDurableGeometryForSupportedReferences();
  testSlotCreatesProfileOffsetsForClosedLineLoops();
});
