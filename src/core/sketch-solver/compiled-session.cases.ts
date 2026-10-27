import {
  compileSketchSolveProgram,
  isCompiledSketchSolveProgramCompatible,
} from "./compile-program";
import {
  solveSketchDefinitionCore,
  solveSketchDefinitionWithDraggedPointTarget,
} from "./solve-sketch";
import {
  assertClose,
  createIndependentLineComponentsDefinition,
  makeLine,
  makePoint,
  tolerances,
} from "./solver-basic.fixtures";
import { createCompiledSketchSolveSession } from "./start-session";
import { updateCompiledSketchSolveSession } from "./update-session";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { expect } from "vitest";

export async function testCompiledSolveProgramReuseAndInvalidation() {
    const definition = createIndependentLineComponentsDefinition();
    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const numericEdit: SketchDefinition = {
      ...definition,
      points: definition.points.map((point) =>
        point.pointId === "sketch_point_a"
          ? { ...point, position: [0.25, 0] as const }
          : point,
      ),
    };

    expect(
      program.components.length,
      "Compiled program should partition independent line components.",
    ).toBe(2);
    expect(
      isCompiledSketchSolveProgramCompatible(program, {
        definition: numericEdit,
        tolerances,
        modelingTolerance: 1e-3,
      }),
      "Compiled program should remain compatible across authored point numeric edits.",
    ).toBeTruthy();
    expect(
      isCompiledSketchSolveProgramCompatible(program, {
        definition,
        tolerances: { ...tolerances, coincidence: 1e-5 },
        modelingTolerance: 1e-3,
      }),
      "Compiled program should invalidate when tolerance policy changes.",
    ).toBeFalsy();
    expect(
      solveSketchDefinitionCore({
        definition,
        tolerances,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      }).status.solveState,
      "Full solve should route through the compiled-program path and remain solved.",
    ).toBe("solved");
  }

export async function testInteractiveSessionWarmStartStaleRejectionAndComponentIsolation() {
    const definition = createIndependentLineComponentsDefinition();
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_core_spec",
      program,
      priorSolvedSnapshot: solved.solvedSnapshot,
    });
    expect(
      session.warmStarted,
      "Interactive sessions should warm-start from compatible solved snapshots.",
    ).toBeTruthy();

    const result = updateCompiledSketchSolveSession(
      session,
      {
        kind: "sketchPoint",
        pointId: "sketch_point_b",
        position: [2, 0],
      },
      1e-4,
    );
    expect(
      result.kind,
      "Interactive update should accept a translatable constrained component.",
    ).toBe("solved");
    const points = new Map(
      result.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    assertClose(
      points.get("sketch_point_c")?.[0] ?? Number.NaN,
      10,
      1e-6,
      "Unaffected component point C should remain stable.",
    );
    assertClose(
      points.get("sketch_point_d")?.[0] ?? Number.NaN,
      11,
      1e-6,
      "Unaffected component point D should remain stable.",
    );

    session.disposed = true;
    const stale = updateCompiledSketchSolveSession(session, {
      kind: "sketchPoint",
      pointId: "sketch_point_b",
      position: [3, 0],
    });
    expect(
      stale.kind === "blocked" &&
        stale.reason === "staleSession" &&
        stale.diagnostics.some(
          (diagnostic) => diagnostic.code === "stale-interactive-solve-session",
        ),
      "Disposed interactive sessions should reject later updates with a stale-session diagnostic.",
    ).toBeTruthy();
  }

export async function testCompiledInteractiveDragKeepsInitiallyCoincidentPointsTogether() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 0, 0),
      ],
      entityIds: [],
      entities: [],
      constraintIds: ["constraint_ab_coincident"],
      constraints: [
        {
          constraintId: "constraint_ab_coincident",
          kind: "coincident",
          label: "A coincident B",
          pointIds: ["sketch_point_a", "sketch_point_b"],
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };
    const dragTarget = {
      kind: "sketchPoint",
      pointId: "sketch_point_a",
      position: [2, 3],
    } as const;

    const stateless = solveSketchDefinitionWithDraggedPointTarget({
      definition,
      dragTarget,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
      targetTolerance: 1e-4,
    });
    expect(
      stateless.kind,
      "Stateless dragged solve should accept initially coincident points.",
    ).toBe("solved");

    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_coincident_core_spec",
      program,
      priorSolvedSnapshot: solveSketchDefinitionCore({
        definition,
        tolerances,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      }).solvedSnapshot,
    });
    const compiled = updateCompiledSketchSolveSession(
      session,
      dragTarget,
      1e-4,
    );

    expect(
      compiled.kind,
      "Compiled interactive update should accept initially coincident points.",
    ).toBe("solved");
    const points = new Map(
      compiled.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    assertClose(
      points.get("sketch_point_a")?.[0] ?? Number.NaN,
      2,
      1e-4,
      "Dragged point A should reach the target x position.",
    );
    assertClose(
      points.get("sketch_point_a")?.[1] ?? Number.NaN,
      3,
      1e-4,
      "Dragged point A should reach the target y position.",
    );
    assertClose(
      points.get("sketch_point_b")?.[0] ?? Number.NaN,
      2,
      1e-4,
      "Coincident point B should move with A on x.",
    );
    assertClose(
      points.get("sketch_point_b")?.[1] ?? Number.NaN,
      3,
      1e-4,
      "Coincident point B should move with A on y.",
    );
  }

export async function testCompiledInteractiveDragTranslatesRigidRectangle() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 2, 0),
        makePoint("sketch_point_c", "C", 2, 3),
        makePoint("sketch_point_d", "D", 0, 3),
      ],
      entityIds: [
        "sketch_entity_line_a",
        "sketch_entity_line_b",
        "sketch_entity_line_c",
        "sketch_entity_line_d",
      ],
      entities: [
        makeLine(
          "sketch_entity_line_a",
          "A-B",
          "sketch_point_a",
          "sketch_point_b",
        ),
        makeLine(
          "sketch_entity_line_b",
          "B-C",
          "sketch_point_b",
          "sketch_point_c",
        ),
        makeLine(
          "sketch_entity_line_c",
          "C-D",
          "sketch_point_c",
          "sketch_point_d",
        ),
        makeLine(
          "sketch_entity_line_d",
          "D-A",
          "sketch_point_d",
          "sketch_point_a",
        ),
      ],
      constraintIds: [
        "constraint_horizontal_a",
        "constraint_horizontal_c",
        "constraint_vertical_b",
        "constraint_vertical_d",
      ],
      constraints: [
        {
          constraintId: "constraint_horizontal_a",
          kind: "horizontal",
          label: "Horizontal A",
          entityId: "sketch_entity_line_a",
        },
        {
          constraintId: "constraint_horizontal_c",
          kind: "horizontal",
          label: "Horizontal C",
          entityId: "sketch_entity_line_c",
        },
        {
          constraintId: "constraint_vertical_b",
          kind: "vertical",
          label: "Vertical B",
          entityId: "sketch_entity_line_b",
        },
        {
          constraintId: "constraint_vertical_d",
          kind: "vertical",
          label: "Vertical D",
          entityId: "sketch_entity_line_d",
        },
      ],
      dimensionIds: ["dimension_width", "dimension_height"],
      dimensions: [
        {
          dimensionId: "dimension_width",
          kind: "horizontalDistance",
          label: "Width",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: 2,
        },
        {
          dimensionId: "dimension_height",
          kind: "verticalDistance",
          label: "Height",
          pointIds: ["sketch_point_a", "sketch_point_d"],
          value: 3,
        },
      ],
    };
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_rectangle_translate_core_spec",
      program,
      priorSolvedSnapshot: solved.solvedSnapshot,
    });
    const result = updateCompiledSketchSolveSession(
      session,
      {
        kind: "sketchPoint",
        pointId: "sketch_point_b",
        position: [7, 11],
      },
      1e-4,
    );

    expect(
      result.kind,
      "Interactive update should accept rigid rectangle translation.",
    ).toBe("solved");
    const points = new Map(
      result.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    assertClose(
      points.get("sketch_point_a")?.[0] ?? Number.NaN,
      5,
      1e-4,
      "Point A should translate on x.",
    );
    assertClose(
      points.get("sketch_point_a")?.[1] ?? Number.NaN,
      11,
      1e-4,
      "Point A should translate on y.",
    );
    assertClose(
      points.get("sketch_point_b")?.[0] ?? Number.NaN,
      7,
      1e-4,
      "Point B should reach target x.",
    );
    assertClose(
      points.get("sketch_point_b")?.[1] ?? Number.NaN,
      11,
      1e-4,
      "Point B should reach target y.",
    );
    assertClose(
      points.get("sketch_point_c")?.[0] ?? Number.NaN,
      7,
      1e-4,
      "Point C should translate on x.",
    );
    assertClose(
      points.get("sketch_point_c")?.[1] ?? Number.NaN,
      14,
      1e-4,
      "Point C should translate on y.",
    );
    assertClose(
      points.get("sketch_point_d")?.[0] ?? Number.NaN,
      5,
      1e-4,
      "Point D should translate on x.",
    );
    assertClose(
      points.get("sketch_point_d")?.[1] ?? Number.NaN,
      14,
      1e-4,
      "Point D should translate on y.",
    );
  }

export async function testDefaultSolveRecoversFromStalledImportedProfile() {
    const pointTuples = [
      ["sketch_point_a", 1, 0],
      ["sketch_point_b", 1, 1],
      ["sketch_point_c", 6, 1],
      ["sketch_point_d", 6, 0],
      ["sketch_point_e", 9, 0],
      ["sketch_point_f", 9, 4],
      ["sketch_point_g", -9, 4],
      ["sketch_point_h", -9, 0],
      ["sketch_point_mid", 0, 4],
    ] as const;
    const lineTuples = [
      ["sketch_entity_ab", "sketch_point_a", "sketch_point_b"],
      ["sketch_entity_bc", "sketch_point_b", "sketch_point_c"],
      ["sketch_entity_cd", "sketch_point_c", "sketch_point_d"],
      ["sketch_entity_de", "sketch_point_d", "sketch_point_e"],
      ["sketch_entity_ef", "sketch_point_e", "sketch_point_f"],
      ["sketch_entity_fg", "sketch_point_f", "sketch_point_g"],
      ["sketch_entity_gh", "sketch_point_g", "sketch_point_h"],
      ["sketch_entity_ha", "sketch_point_h", "sketch_point_a"],
    ] as const;
    const points = pointTuples.map(([id, x, y]) => makePoint(id, id, x, y));
    const entities = lineTuples.map(([id, start, end]) =>
      makeLine(id, id, start, end),
    );
    const constraints: SketchDefinition["constraints"] = [
      ...[0, 2, 4, 6].map((index) => ({
        constraintId: `constraint_vertical_${index}` as `constraint_${string}`,
        kind: "vertical" as const,
        label: `Vertical ${index}`,
        entityId: entities[index]!.entityId,
      })),
      ...[1, 3, 5, 7].map((index) => ({
        constraintId:
          `constraint_horizontal_${index}` as `constraint_${string}`,
        kind: "horizontal" as const,
        label: `Horizontal ${index}`,
        entityId: entities[index]!.entityId,
      })),
      {
        constraintId: "constraint_midpoint",
        kind: "midpoint",
        label: "Midpoint",
        point: { kind: "localPoint", pointId: points[8]!.pointId },
        line: { kind: "localEntity", entityId: entities[5]!.entityId },
      },
      {
        constraintId: "constraint_anchor",
        kind: "fixPoint",
        label: "Imported source anchor",
        pointId: points[0]!.pointId,
        position: [1, 0],
      },
    ];
    const dimensions: SketchDefinition["dimensions"] = [
      ["dimension_width", 1, 5],
      ["dimension_height", 2, 1],
      ["dimension_wall", 3, 3],
      ["dimension_variable_span", 7, 11],
    ].map(([id, entityIndex, value]) => ({
      dimensionId: id as `dimension_${string}`,
      kind: "lineLength" as const,
      label: String(id),
      entityId: entities[Number(entityIndex)]!.entityId,
      value: Number(value),
    }));
    dimensions.push({
      dimensionId: "dimension_wall_distance",
      kind: "lineDistance",
      label: "Wall distance",
      lines: [
        { kind: "localEntity", entityId: entities[1]!.entityId },
        { kind: "localEntity", entityId: entities[5]!.entityId },
      ],
      value: 3,
    });
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
      dimensions,
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const solvedPoints = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );

    expect(
      solved.status.solveState,
      "The default solver should recover when its BFGS pass stalls on a satisfiable imported profile.",
    ).toBe("solved");
    for (const [index, line] of entities.entries()) {
      const start = solvedPoints.get(line.startPointId)!;
      const end = solvedPoints.get(line.endPointId)!;
      const axisDelta =
        index % 2 === 0
          ? Math.abs(start[0] - end[0])
          : Math.abs(start[1] - end[1]);
      expect(
        axisDelta,
        `Solved imported profile line ${index} should not render crooked.`,
      ).toBeLessThan(1e-6);
    }
  }
