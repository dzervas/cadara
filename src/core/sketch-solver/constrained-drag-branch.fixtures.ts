import type { SketchPointId } from "@/contracts/shared/ids";
import type {
  NumericSketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { compileSketchSolveProgram } from "./compile-program";
import type { SketchDragStep } from "./solve-types";
import { startCompiledSketchSolveSession } from "./start-session";
import type { SketchCompiledSolveSession } from "./system-types";
import { updateCompiledSketchSolveSession } from "./update-session";

// Drag gestures at the compiled drag session seam (the session an editor
// geometry drag drives: previews with no reach tolerance, resumed while
// pending, and a release with the editor's 1e-4), for the constrained drag
// step's branch rule. The sketches are the sketch tools' rounded rectangle
// (2 × 1, fillets 0.2) and slot (centre line 4, width 2), written out as
// definitions in the tools' entity order.

export type Point = readonly [number, number];
export const TAU = 1e-3;
export const pid = (name: string) => `sketch_point_${name}` as SketchPointId;
const eid = (name: string) => `sketch_entity_${name}` as const;

function definitionOf(input: {
  points: Record<string, Point>;
  /** In the sketch tools' order (it orders the solve's variables and rows). */
  entities: Record<
    string,
    | ["line", start: string, end: string]
    | [
        "arc",
        center: string,
        start: string,
        end: string,
        sweep: "clockwise" | "counterClockwise",
      ]
  >;
  tangents: [arc: string, line: string][];
  horizontal?: string[];
  vertical?: string[];
  fixed?: string[];
  diameters?: Record<string, number>;
}): NumericSketchDefinition {
  const points = Object.entries(input.points).map(([name, position]) => ({
    pointId: pid(name),
    label: name,
    target: {
      kind: "sketchPoint" as const,
      sketchId: "sketch_primary" as const,
      pointId: pid(name),
    },
    position,
    isConstruction: false,
  }));
  const target = (name: string) => ({
    kind: "sketchEntity" as const,
    sketchId: "sketch_primary" as const,
    entityId: eid(name),
  });
  const entities = Object.entries(input.entities).map(([name, entity]) =>
    entity[0] === "line"
      ? {
          kind: "lineSegment" as const,
          entityId: eid(name),
          label: name,
          target: target(name),
          isConstruction: false,
          startPointId: pid(entity[1]),
          endPointId: pid(entity[2]),
        }
      : {
          kind: "arc" as const,
          entityId: eid(name),
          label: name,
          target: target(name),
          isConstruction: false,
          centerPointId: pid(entity[1]),
          startPointId: pid(entity[2]),
          endPointId: pid(entity[3]),
          sweepDirection: entity[4],
        },
  );
  const constraints = [
    ...(input.horizontal ?? []).map((line) => ({
      constraintId: `constraint_${line}_horizontal` as const,
      kind: "horizontal" as const,
      label: `${line} horizontal`,
      entityId: eid(line),
    })),
    ...(input.vertical ?? []).map((line) => ({
      constraintId: `constraint_${line}_vertical` as const,
      kind: "vertical" as const,
      label: `${line} vertical`,
      entityId: eid(line),
    })),
    ...input.tangents.map(([arc, line]) => ({
      constraintId: `constraint_${arc}_${line}_tangent` as const,
      kind: "tangent" as const,
      label: `${arc} tangent ${line}`,
      entityIds: [eid(arc), eid(line)] as const,
      relation: "external" as const,
    })),
    ...(input.fixed ?? []).map((name) => ({
      constraintId: `constraint_${name}_fix` as const,
      kind: "fixPoint" as const,
      label: `${name} fixed`,
      pointId: pid(name),
      position: input.points[name]!,
    })),
  ];
  const dimensions = [
    ...Object.entries(input.entities).flatMap(([name, [kind, , start, end]]) =>
      kind === "line"
        ? []
        : [
            {
              dimensionId: `dimension_${name}_start` as const,
              kind: "arcStartPointCoincident" as const,
              label: `${name} start`,
              entityId: eid(name),
              pointId: pid(start),
            },
            {
              dimensionId: `dimension_${name}_end` as const,
              kind: "arcEndPointCoincident" as const,
              label: `${name} end`,
              entityId: eid(name),
              pointId: pid(end),
            },
          ],
    ),
    ...Object.entries(input.diameters ?? {}).map(([arc, value]) => ({
      dimensionId: `dimension_${arc}_diameter` as const,
      kind: "diameter" as const,
      label: `${arc} diameter`,
      entityId: eid(arc),
      value,
    })),
  ];
  return {
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
}

/**
 * The Fillet tool's 2 × 1 rounded rectangle (radius 0.2) with its
 * bottom-left corner at `origin`, optionally with every point of its upper
 * half fixed.
 */
export function roundedRectangle(fixUpperHalf = false, origin: Point = [0, 0]) {
  const local: Record<string, Point> = {
    c1: [1.8, 0.2],
    a1: [1.8, 0],
    b1: [2, 0.2],
    c2: [1.8, 0.8],
    a2: [2, 0.8],
    b2: [1.8, 1],
    c3: [0.2, 0.8],
    a3: [0.2, 1],
    b3: [0, 0.8],
    c4: [0.2, 0.2],
    a4: [0, 0.2],
    b4: [0.2, 0],
  };
  const points = Object.fromEntries(
    Object.entries(local).map(([name, [x, y]]) => [
      name,
      [origin[0] + x, origin[1] + y] as const,
    ]),
  );
  return definitionOf({
    points,
    entities: {
      bottom: ["line", "b4", "a1"],
      right: ["line", "b1", "a2"],
      top: ["line", "b2", "a3"],
      left: ["line", "b3", "a4"],
      fillet1: ["arc", "c1", "a1", "b1", "counterClockwise"],
      fillet2: ["arc", "c2", "a2", "b2", "counterClockwise"],
      fillet3: ["arc", "c3", "a3", "b3", "counterClockwise"],
      fillet4: ["arc", "c4", "a4", "b4", "counterClockwise"],
    },
    tangents: [
      ["fillet1", "bottom"],
      ["fillet1", "right"],
      ["fillet2", "right"],
      ["fillet2", "top"],
      ["fillet3", "top"],
      ["fillet3", "left"],
      ["fillet4", "left"],
      ["fillet4", "bottom"],
    ],
    horizontal: ["bottom", "top"],
    vertical: ["right", "left"],
    fixed: fixUpperHalf
      ? Object.keys(local).filter((name) => local[name]![1] >= 0.5)
      : [],
  });
}

/** The Slot tool's slot around the centre line (0,0)–(4,0), width 2: arc centres at the line's ends. */
export function slot() {
  return definitionOf({
    points: {
      s: [0, 0],
      e: [4, 0],
      ls: [0, 1],
      le: [4, 1],
      re: [4, -1],
      rs: [0, -1],
    },
    entities: {
      centre: ["line", "s", "e"],
      left: ["line", "ls", "le"],
      endArc: ["arc", "e", "le", "re", "clockwise"],
      right: ["line", "re", "rs"],
      startArc: ["arc", "s", "rs", "ls", "clockwise"],
    },
    tangents: [
      ["endArc", "left"],
      ["endArc", "right"],
      ["startArc", "left"],
      ["startArc", "right"],
    ],
  });
}

/**
 * A lower semicircle of diameter 1 around (1, 0.5), tangent to the fixed
 * line (0,0)–(2,0) from above. Its centre's only same-branch positions are
 * on y = 0.5; the mirrored branch (below the line) reaches y = −0.5.
 */
export function tangentArc() {
  const points: Record<string, Point> = {
    a: [0, 0],
    b: [2, 0],
    c: [1, 0.5],
    s: [0.5, 0.5],
    e: [1.5, 0.5],
  };
  return definitionOf({
    points,
    entities: {
      line: ["line", "a", "b"],
      arc: ["arc", "c", "s", "e", "counterClockwise"],
    },
    tangents: [["arc", "line"]],
    fixed: ["a", "b"],
    diameters: { arc: 1 },
  });
}

export function dragSession(
  definition: NumericSketchDefinition,
  dragStep: SketchDragStep,
) {
  const started = startCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_constrained_drag_branch",
    program: compileSketchSolveProgram({
      definition,
      tolerances: {
        coincidence: 1e-3,
        angleRadians: 1e-4,
        minimumSegmentLength: 1e-3,
      },
      modelingTolerance: TAU,
      partialSolvePolicy: "failOnConflict",
      dragStep,
    }),
  });
  if (started.kind !== "started") throw new Error("premise: the sketch solves");
  return started.session;
}

/** One pointer move: a preview frame, resumed while its budget leaves it pending. */
export function preview(
  session: SketchCompiledSolveSession,
  pointId: SketchPointId,
  position: Point,
) {
  const target = { kind: "sketchPoint" as const, pointId, position };
  let result = updateCompiledSketchSolveSession(session, target, null);
  for (
    let resumes = 0;
    result.kind === "pending" && resumes < 400;
    resumes += 1
  )
    result = updateCompiledSketchSolveSession(session, target, null);
  return result;
}

export function release(
  session: SketchCompiledSolveSession,
  pointId: SketchPointId,
  position: Point,
) {
  return updateCompiledSketchSolveSession(
    session,
    { kind: "sketchPoint", pointId, position },
    1e-4,
  );
}

/**
 * One pointer move of a translation drag (the editor's drag of an arc's
 * centre moves it with the arc's ends): the goal puts `pointIds[0]` at
 * `position`, sent as the delta from its accepted position; a resume adds
 * nothing (the editor's pending goal is unchanged), and a release
 * (`tolerance` 1e-4) is one call.
 */
export function translate(
  session: SketchCompiledSolveSession,
  pointIds: readonly SketchPointId[],
  position: Point,
  tolerance: number | null = null,
) {
  const accepted = positionOf(session.lastAcceptedSnapshot, pointIds[0]!);
  const goal = (delta: Point) =>
    updateCompiledSketchSolveSession(
      session,
      { kind: "sketchTranslate", pointIds, delta },
      tolerance,
    );
  let result = goal([position[0] - accepted[0], position[1] - accepted[1]]);
  for (
    let resumes = 0;
    result.kind === "pending" && resumes < 400;
    resumes += 1
  )
    result = goal([0, 0]);
  return result;
}

export const positionOf = (
  snapshot: SolvedSketchSnapshot,
  pointId: SketchPointId,
) =>
  snapshot.solvedPoints.find((point) => point.pointId === pointId)!
    .solvedPosition;

/** For each line↔arc tangency: the signed distance from the line to the arc's centre (its side and radius). */
export function tangentSides(session: SketchCompiledSolveSession) {
  const { definition } = session.program;
  const snapshot = session.lastAcceptedSnapshot;
  return definition.constraints.flatMap((constraint) => {
    if (constraint.kind !== "tangent") return [];
    const [arc, line] = constraint.entityIds.map(
      (id) => definition.entities.find((entity) => entity.entityId === id)!,
    );
    if (arc?.kind !== "arc" || line?.kind !== "lineSegment") return [];
    const [a, b, c] = [
      line.startPointId,
      line.endPointId,
      arc.centerPointId,
    ].map((id) => positionOf(snapshot, id));
    return [
      ((b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0])) /
        Math.hypot(b![0] - a![0], b![1] - a![1]),
    ];
  });
}

/** Whether every tangency keeps its side and at least τ of radius relative to `start`. */
export function onBranch(sides: readonly number[], start: readonly number[]) {
  return sides.every(
    (side, index) =>
      Math.sign(side) === Math.sign(start[index]!) && Math.abs(side) >= TAU,
  );
}

export const R1_GRABBED = pid("b4");
export const r1Cursor = (step: number): Point => [
  0.2 + step / 16,
  (0.6 * step) / 16,
];
export const forcedCursor = (step: number): Point => [0.2, step / 16];
export const OUT_AND_BACK = [
  ...Array.from({ length: 16 }, (_, index) => index + 1),
  ...Array.from({ length: 16 }, (_, index) => 15 - index),
];
