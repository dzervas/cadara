import { describe, expect, test } from "vitest";
import type { SketchPointId } from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  NumericSketchDefinition as SketchDefinition,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import { compileSketchSolveProgram } from "./compile-program";
import { startCompiledSketchSolveSession } from "./start-session";
import { updateCompiledSketchSolveSession } from "./update-session";
import {
  FIXTURE_TOLERANCE,
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
// T17c5 (issue 08 :107), logic lane, solver-core drag-session seam
// (`compileSketchSolveProgram` with the dragged point,
// `startCompiledSketchSolveSession`, `updateCompiledSketchSolveSession`):
// a drag of one of two coincident consecutive fit points may start from the
// degenerate span when it is the sketch's only error, and only frames that
// separate them are accepted. A declared join between them (the C4 join
// classes: a Coincident or a chain of them, a Coincident of each to one
// datum or projected point, a shared id), a requirement on the spline
// itself, or a drag of another point keeps today's refusal.

/** The kernel seed's document tolerances. */
const TOLERANCES = {
  coincidence: 1e-3,
  angleRadians: 1e-4,
  minimumSegmentLength: 1e-3,
};
const SPAN_CODE = "invalid-spline-coincident-points";

/** Spline a → b → c → d with b and c at one place, plus a dimensioned line d → e. */
function degenerate(
  extra?: (fixture: ReturnType<typeof makeSketchFixture>) => void,
) {
  const fixture = makeSketchFixture();
  fixture.point("a", 0, 0);
  fixture.point("b", 1, 1);
  fixture.point("c", 1, 1);
  fixture.point("d", 3, 0);
  fixture.point("e", 3, -1);
  fixture.spline("s", ["a", "b", "c", "d"], "open");
  fixture.line("l", "d", "e");
  fixture.lineLength("l", 1);
  extra?.(fixture);
  // T17p2 (F-2): the solver consumes the resolved definition.
  return literalResolvedDefinition(fixture.definition());
}

const id = (name: string) => `sketch_point_${name}` as SketchPointId;

function start(
  definition: SketchDefinition,
  dragged?: string,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
) {
  return startCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_t17c5",
    program: compileSketchSolveProgram({
      definition,
      projectedReferences,
      tolerances: TOLERANCES,
      modelingTolerance: FIXTURE_TOLERANCE,
      partialSolvePolicy: "failOnConflict",
      degenerateSplineSpanDragPointId: dragged ? id(dragged) : undefined,
    }),
  });
}

const positionIn = (
  snapshot: {
    solvedPoints: readonly {
      pointId: string;
      solvedPosition: readonly number[];
    }[];
  },
  name: string,
) =>
  snapshot.solvedPoints.find((point) => point.pointId === id(name))!
    .solvedPosition;

describe("T17c5: a drag session recovering a degenerate spline span", () => {
  test("dragging fit point c starts from the degenerate span; the frame that moves it apart is accepted and the spline is valid, fit point b unmoved", () => {
    const started = start(degenerate(), "c");
    expect(started.kind, "the session starts").toBe("started");
    if (started.kind !== "started") return;
    const startSpline =
      started.session.lastAcceptedSnapshot.solvedEntities.find(
        (entity) => entity.kind === "spline",
      );
    expect(
      startSpline?.kind === "spline" && startSpline.reconstruction.validity,
      "the start is still degenerate",
    ).toBe("invalid");
    expect(
      started.session.lastAcceptedSnapshot.status.solveState,
      "the start snapshot is not a solved state",
    ).toBe("failed");

    const frame = updateCompiledSketchSolveSession(
      started.session,
      { kind: "sketchPoint", pointId: id("c"), position: [2, 1] },
      1e-4,
    );
    expect(frame.kind).toBe("solved");
    const solved = frame.solvedSnapshot!;
    const spline = solved.solvedEntities.find(
      (entity) => entity.kind === "spline",
    );
    expect(spline?.kind === "spline" && spline.reconstruction.validity).toBe(
      "valid",
    );
    expect(solved.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    expect(solved.status.solveState).toBe("solved");
    expect(positionIn(solved, "b")).toEqual([1, 1]);
    expect(positionIn(solved, "c")[0]).toBeCloseTo(2, 9);
  });

  test("a frame that keeps them together is not accepted (no invalid frame is solved)", () => {
    const started = start(degenerate(), "c");
    expect(started.kind).toBe("started");
    if (started.kind !== "started") return;
    const frame = updateCompiledSketchSolveSession(
      started.session,
      { kind: "sketchPoint", pointId: id("c"), position: [1, 1] },
      1e-4,
    );
    expect(frame.kind, "c stays on b: blocked").toBe("blocked");
    expect(
      frame.diagnostics.map((diagnostic) => diagnostic.code),
      "because of the span",
    ).toContain(SPAN_CODE);
  });

  test("the other drag-start refusals stay: no dragged point, another point, a Coincident between them, a requirement on the spline", () => {
    const refusal = (definition: SketchDefinition, dragged?: string) => {
      const started = start(definition, dragged);
      return started.kind === "unacceptable"
        ? started.diagnostic?.code
        : started.kind;
    };
    expect(refusal(degenerate()), "no dragged point (e.g. a body drag)").toBe(
      SPAN_CODE,
    );
    expect(
      refusal(degenerate(), "a"),
      "a point that is not an end of the span",
    ).toBe(SPAN_CODE);
    expect(
      refusal(
        degenerate((fixture) => fixture.coincident("b", "c")),
        "c",
      ),
      "a Coincident keeps them together",
    ).toBe(SPAN_CODE);
    expect(
      refusal(
        degenerate((fixture) => {
          fixture.point("x", 1, 0);
          fixture.coincident("b", "x");
          fixture.coincident("x", "c");
        }),
        "c",
      ),
      "a chain of Coincidents keeps them together too",
    ).toBe(SPAN_CODE);
    expect(
      refusal(
        degenerate((fixture) => {
          fixture.point("p", 2, 0.5);
          fixture.pointOnCurve("p", "s");
        }),
        "c",
      ),
      "a point on the degenerate spline cannot be satisfied: not the only error",
    ).not.toBe("started");
    expect(
      refusal(
        degenerate((fixture) => {
          fixture.point("f", 5, 5);
          fixture.point("g", 5, 5);
          fixture.line("short", "f", "g");
        }),
        "c",
      ),
      "another authored error (a zero-length line): not the only error",
    ).toBe(SPAN_CODE);
  });
});

// Review R-2: every C4 declared-join class between the two ends keeps them
// together (a solve holds such a pair only within its tolerance).
describe("T17c5 review R-2: a declared join between the two fit points keeps the refusal", () => {
  /** b and c at the origin (a moved off it), each of `names` joined to `target`. */
  function joinedTo(
    target: Extract<
      ConstraintDefinition,
      { kind: "coincidentProjectedPoint" }
    >["projectedPoint"],
    names: readonly string[] = ["b", "c"],
  ) {
    const definition = degenerate((fixture) => {
      fixture.move("a", -1, 0.5);
      fixture.move("b", 0, 0);
      fixture.move("c", 0, 0);
    });
    const constraints = names.map(
      (name) =>
        ({
          constraintId: `constraint_join_${name}`,
          kind: "coincidentProjectedPoint",
          label: `Join ${name}`,
          point: { kind: "localPoint", pointId: id(name) },
          projectedPoint: target,
        }) as ConstraintDefinition,
    );
    return {
      ...definition,
      constraintIds: [
        ...definition.constraintIds,
        ...constraints.map((constraint) => constraint.constraintId),
      ],
      constraints: [...definition.constraints, ...constraints],
    };
  }
  const refusal = (
    definition: SketchDefinition,
    dragged: string,
    projected: readonly ProjectedSketchReferenceRecord[] = [],
  ) => {
    const started = start(definition, dragged, projected);
    return started.kind === "unacceptable"
      ? started.diagnostic?.code
      : started.kind;
  };

  test("both coincident with the origin datum", () => {
    const origin = { kind: "sketchDatum", datum: "origin" } as const;
    expect(refusal(joinedTo(origin), "c")).toBe(SPAN_CODE);
    expect(
      refusal(joinedTo(origin, ["c"]), "b"),
      "control: only c on the origin, b dragged",
    ).toBe("started");
  });

  test("both coincident with one projected point", () => {
    const fixture = makeSketchFixture();
    const referenceId = fixture.project("vertex", [
      { geometryId: "vertex_point", kind: "point", position: [0, 0] },
    ] as never);
    const projected = fixture.build().projectedReferences;
    const vertex = {
      kind: "projectedGeometry",
      reference: {
        kind: "projectedPoint",
        referenceId,
        geometryId: "vertex_point",
      },
    } as never;
    const withReference = (definition: SketchDefinition) => ({
      ...definition,
      referenceIds: fixture.definition().referenceIds,
      references: fixture.definition().references,
    });
    expect(refusal(withReference(joinedTo(vertex)), "c", projected)).toBe(
      SPAN_CODE,
    );
    expect(
      refusal(withReference(joinedTo(vertex, ["c"])), "b", projected),
      "control: only c on the vertex, b dragged",
    ).toBe("started");
  });

  test("one shared point used for both fit points", () => {
    const fixture = makeSketchFixture();
    fixture.point("a", 0, 0);
    fixture.point("b", 1, 1);
    fixture.point("d", 3, 0);
    fixture.point("e", 3, -1);
    fixture.spline("s", ["a", "b", "b", "d"], "open");
    fixture.line("l", "d", "e");
    fixture.lineLength("l", 1);
    expect(refusal(literalResolvedDefinition(fixture.definition()), "b")).toBe(
      SPAN_CODE,
    );
  });
});
