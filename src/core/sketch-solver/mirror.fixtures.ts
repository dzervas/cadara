import { compileSketchSolveProgram } from "./compile-program";
import { sketchDraggedPointHasFreeDof } from "./free-dof";
import { solveSketchDefinitionCore } from "./solve-sketch";
import { startCompiledSketchSolveSession } from "./start-session";
import { updateCompiledSketchSolveSession } from "./update-session";
import type {
  ConstraintId,
  DimensionId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import {
  deriveSketchValidity,
  getConsumableSketchRegions,
} from "@/contracts/sketch/derived-validity";
import type {
  NumericSketchDefinition as SketchDefinition,
  NumericSketchDerivationDefinition as SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";

export const TAU = 1e-3;

/** Production tolerances: minimumSegmentLength = τ (review R-5). */
export const DOCUMENT_TOLERANCES = createDocumentSolverTolerances({
  modelingTolerance: TAU,
  angularToleranceRadians: 1e-6,
});

/**
 * Mechanism tolerances (minimumSegmentLength 1e-6 < τ): the band where a
 * mirror axis shorter than τ is not yet a degenerate line (A2), so the
 * mirror's own failure is observed alone. Production cannot reach it.
 */
export const MECHANISM_TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
} as const;

export type P = readonly [number, number];

export const pid = (id: string) => `sketch_point_${id}` as SketchPointId;

export const eid = (id: string) => `sketch_entity_${id}` as SketchEntityId;

export const target = (id: string) => ({
  kind: "sketchEntity" as const,
  sketchId: "sketch_primary" as const,
  entityId: eid(id),
});

export function point(id: string, position: P): SketchPointDefinition {
  return {
    pointId: pid(id),
    label: id,
    target: {
      kind: "sketchPoint",
      sketchId: "sketch_primary",
      pointId: pid(id),
    },
    position: [position[0], position[1]],
    isConstruction: false,
  } as SketchPointDefinition;
}

export function line(id: string, a: string, b: string): SketchEntityDefinition {
  return {
    kind: "lineSegment",
    entityId: eid(id),
    label: id,
    target: target(id),
    isConstruction: false,
    startPointId: pid(a),
    endPointId: pid(b),
  } as SketchEntityDefinition;
}

export function pointEntity(id: string, p: string): SketchEntityDefinition {
  return {
    kind: "point",
    entityId: eid(id),
    label: id,
    target: target(id),
    isConstruction: false,
    pointId: pid(p),
  } as SketchEntityDefinition;
}

export function circle(id: string, c: string, radius: number): SketchEntityDefinition {
  return {
    kind: "circle",
    entityId: eid(id),
    label: id,
    target: target(id),
    isConstruction: false,
    centerPointId: pid(c),
    radius,
  } as SketchEntityDefinition;
}

export function arc(
  id: string,
  c: string,
  s: string,
  e: string,
  sweepDirection: "clockwise" | "counterClockwise",
): SketchEntityDefinition {
  return {
    kind: "arc",
    entityId: eid(id),
    label: id,
    target: target(id),
    isConstruction: false,
    centerPointId: pid(c),
    startPointId: pid(s),
    endPointId: pid(e),
    sweepDirection,
  } as SketchEntityDefinition;
}

export type OutputSpec = readonly [
  string,
  string,
  readonly string[],
  readonly string[],
];

export function output([seed, out, seedPoints, outputPoints]: OutputSpec) {
  return {
    seedEntityId: eid(seed),
    outputEntityId: eid(out),
    instanceIndex: 1,
    seedPointIds: seedPoints.map(pid),
    outputPointIds: outputPoints.map(pid),
  };
}

export function mirror(
  id: string,
  axis: string | { datum: "xAxis" | "yAxis" },
  outputs: readonly OutputSpec[],
): SketchDerivationDefinition {
  return {
    kind: "mirror",
    derivationId: id,
    label: id,
    seedEntityIds: [...new Set(outputs.map(([seed]) => eid(seed)))],
    mirrorReference:
      typeof axis === "string"
        ? { kind: "lineEntity", entityId: eid(axis) }
        : { kind: "sketchDatum", datum: axis.datum },
    outputs: outputs.map(output),
  } as SketchDerivationDefinition;
}

export function sketch(input: {
  points: readonly SketchPointDefinition[];
  entities: readonly SketchEntityDefinition[];
  relationships?: readonly SketchDerivationDefinition[];
  constraints?: readonly unknown[];
  dimensions?: readonly unknown[];
}): SketchDefinition {
  const constraints = (input.constraints ??
    []) as SketchDefinition["constraints"];
  const dimensions = (input.dimensions ?? []) as SketchDefinition["dimensions"];
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: input.points.map((entry) => entry.pointId),
    points: [...input.points],
    entityIds: input.entities.map((entry) => entry.entityId),
    entities: [...input.entities],
    constraintIds: constraints.map((entry) => entry.constraintId),
    constraints,
    dimensionIds: dimensions.map((entry) => entry.dimensionId),
    dimensions,
    derivedRelationships: [...(input.relationships ?? [])],
  } as SketchDefinition;
}

export const lineLength = (id: string, entity: string, value: number) => ({
  dimensionId: `dimension_${id}` as DimensionId,
  kind: "lineLength",
  label: id,
  entityId: eid(entity),
  value,
});

export const horizontal = (id: string, entity: string) => ({
  constraintId: `constraint_${id}` as ConstraintId,
  kind: "horizontal",
  label: id,
  entityId: eid(entity),
});

export const solve = (
  definition: SketchDefinition,
  tolerances: typeof DOCUMENT_TOLERANCES = DOCUMENT_TOLERANCES,
) =>
  solveSketchDefinitionCore({
    definition,
    tolerances,
    modelingTolerance: TAU,
    partialSolvePolicy: "bestEffort",
  });

export const solvedPoint = (snapshot: SolvedSketchSnapshot, id: string) =>
  snapshot.solvedPoints.find((entry) => entry.pointId === pid(id))!
    .solvedPosition;

export const evaluatedPoint = (definition: SketchDefinition, id: string) =>
  definition.points.find((entry) => entry.pointId === pid(id))!.position;

export const reflectY0 = (p: SketchPoint2D): SketchPoint2D => [p[0], -p[1]];

export const errorCodes = (snapshot: SolvedSketchSnapshot) =>
  snapshot.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);

export const profileGate = (snapshot: SolvedSketchSnapshot) => {
  const validity = deriveSketchValidity({ solvedSnapshot: snapshot });
  return {
    validity: validity.state,
    consumable: getConsumableSketchRegions({
      derivedValidity: validity,
      regions: [{} as never],
    }).length,
  };
};

/**
 * Seeds: line ab and circle c above the axis x0–x1 (y = 0); outputs mab and
 * mc stored stale; unrelated line u (free).
 */
export function lineAndCircle(axis: "x0-x1" | "missing" | "short" | "zero" = "x0-x1") {
  const axisEnd: P =
    axis === "short" ? [-1 + 5e-4, 0] : axis === "zero" ? [-1, 0] : [6, 0];
  return {
    points: [
      point("a", [1, 1]),
      point("b", [3, 2]),
      point("c", [2, 3]),
      point("x0", [-1, 0]),
      point("x1", axisEnd),
      point("ma", [7, 7]),
      point("mb", [8, 8]),
      point("mc", [9, 9]),
      point("u0", [10, 10]),
      point("u1", [12, 11]),
    ],
    entities: [
      line("ab", "a", "b"),
      circle("c", "c", 1),
      ...(axis === "missing" ? [] : [line("axis", "x0", "x1")]),
      line("mab", "ma", "mb"),
      circle("mc", "mc", 1),
      line("u", "u0", "u1"),
    ],
    relationships: [
      mirror("m", "axis", [
        ["ab", "mab", ["a", "b"], ["ma", "mb"]],
        ["c", "mc", ["c"], ["mc"]],
      ]),
    ],
  };
}

// ---------------------------------------------------------------------------
// T15c: axis preference and driven exact reach. Logic lane; seams: the
// compiled solve session (drag frames, DOF probe) and the batch solve.

export const RELEASE_TOLERANCE = 1e-4;

export const at = (snapshot: SolvedSketchSnapshot, ids: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, solvedPoint(snapshot, id)]));

export const distance = (left: SketchPoint2D, right: SketchPoint2D) =>
  Math.hypot(right[0] - left[0], right[1] - left[1]);

/** R(p) across the line through `start` and `end`. */
export const reflectAcross = (
  p: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
): SketchPoint2D => {
  const d = [end[0] - start[0], end[1] - start[1]] as const;
  const t =
    ((p[0] - start[0]) * d[0] + (p[1] - start[1]) * d[1]) /
    (d[0] * d[0] + d[1] * d[1]);
  return [2 * (start[0] + t * d[0]) - p[0], 2 * (start[1] + t * d[1]) - p[1]];
};

export const fixPoint = (id: string, p: string, position: P) => ({
  constraintId: `constraint_${id}` as ConstraintId,
  kind: "fixPoint",
  label: id,
  pointId: pid(p),
  position: [position[0], position[1]],
});

export const coincident = (id: string, first: string, second: string) => ({
  constraintId: `constraint_${id}` as ConstraintId,
  kind: "coincident",
  label: id,
  pointIds: [pid(first), pid(second)],
});

export const pointDistance = (
  id: string,
  first: string,
  second: string,
  value: number,
) => ({
  dimensionId: `dimension_${id}` as DimensionId,
  kind: "distance",
  axis: "aligned",
  label: id,
  pointIds: [pid(first), pid(second)],
  value,
});

export function startSession(definition: SketchDefinition) {
  const started = startCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_t15c",
    program: compileSketchSolveProgram({
      definition,
      tolerances: DOCUMENT_TOLERANCES,
      modelingTolerance: TAU,
      partialSolvePolicy: "failOnConflict",
    }),
  });
  if (started.kind !== "started")
    throw new Error(`session did not start: ${started.diagnostic?.code}`);
  return started.session;
}

export type T15cSession = ReturnType<typeof startSession>;

/** One editor point drag: a preview frame, then the release frame (d1). */
export function dragPoint(session: T15cSession, id: string, position: SketchPoint2D) {
  const preview = updateCompiledSketchSolveSession(
    session,
    { kind: "sketchPoint", pointId: pid(id), position },
    null,
  );
  const release = updateCompiledSketchSolveSession(
    session,
    { kind: "sketchPoint", pointId: pid(id), position },
    RELEASE_TOLERANCE,
  );
  return { preview, release, snapshot: release.solvedSnapshot! };
}

/** The line-and-circle mirror (axis x0–x1 on y = 0, free) with `extra` requirements. */
export function freeAxis(constraints: unknown[] = [], dimensions: unknown[] = []) {
  return sketch({
    ...lineAndCircle(),
    constraints: [horizontal("u_h", "u"), ...constraints],
    dimensions,
  });
}

export const AXIS = ["x0", "x1"] as const;

// T15c review fixes (R-1, R-2, R-3).

/** Seed end b tied to axis end x1 by a coincident constraint (not a shared point). */
export function coincidentAxisEnd() {
  return sketch({
    points: [
      point("a", [1, 1]),
      point("b", [6, 0]),
      point("x0", [-1, 0]),
      point("x1", [6, 0]),
      point("ma", [0, 0]),
      point("mb", [0, 0]),
    ],
    entities: [
      line("ab", "a", "b"),
      line("axis", "x0", "x1"),
      line("mab", "ma", "mb"),
    ],
    relationships: [
      mirror("m", "axis", [["ab", "mab", ["a", "b"], ["ma", "mb"]]]),
    ],
    constraints: [coincident("bx1", "b", "x1")],
  });
}

/** Axis O = offset(S, 1) of a free line S; L mirrored across O (and S itself too when `alsoMirrorS`). */
export function derivedOffsetAxis(alsoMirrorS: boolean) {
  return sketch({
    points: [
      point("a", [0, 0]),
      point("b", [6, 0]),
      point("o0", [9, 9]),
      point("o1", [9, 9]),
      point("c", [1, 3]),
      point("d", [3, 4]),
      point("mc", [0, 0]),
      point("md", [0, 0]),
      point("ms0", [0, 0]),
      point("ms1", [0, 0]),
    ],
    entities: [
      line("S", "a", "b"),
      line("O", "o0", "o1"),
      line("L", "c", "d"),
      line("ML", "mc", "md"),
      ...(alsoMirrorS ? [line("MS", "ms0", "ms1")] : []),
    ],
    relationships: [
      {
        kind: "offset",
        derivationId: "o",
        label: "o",
        seedEntityIds: [eid("S")],
        distance: 1,
        jointPolicy: "trimExtendArcFallback",
        jointOutputs: [],
        piecewiseCubicOutputs: [],
        outputs: [output(["S", "O", ["a", "b"], ["o0", "o1"]])],
      } as SketchDerivationDefinition,
      mirror("m", "O", [
        ["L", "ML", ["c", "d"], ["mc", "md"]],
        ...(alsoMirrorS
          ? ([["S", "MS", ["a", "b"], ["ms0", "ms1"]]] as const)
          : []),
      ]),
    ],
  });
}

/** Axis S′ = the mirror copy of S across A; L mirrored across S′. */
export function derivedMirrorAxis() {
  return sketch({
    points: [
      point("a", [0, 2]),
      point("b", [6, 3]),
      point("x0", [-1, 0]),
      point("x1", [8, 0]),
      point("s0", [0, 0]),
      point("s1", [0, 0]),
      point("c", [1, -5]),
      point("d", [3, -6]),
      point("mc", [0, 0]),
      point("md", [0, 0]),
    ],
    entities: [
      line("S", "a", "b"),
      line("axis", "x0", "x1"),
      line("SP", "s0", "s1"),
      line("L", "c", "d"),
      line("ML", "mc", "md"),
    ],
    relationships: [
      mirror("m1", "axis", [["S", "SP", ["a", "b"], ["s0", "s1"]]]),
      mirror("m2", "SP", [["L", "ML", ["c", "d"], ["mc", "md"]]]),
    ],
  });
}

/** A drag by `delta` of `id`: how far the preview and the release moved it, and its free DOF. */
export function dragBy(definition: SketchDefinition, id: string, delta: P) {
  const session = startSession(definition);
  const start = session.lastAcceptedSnapshot;
  const from = solvedPoint(start, id);
  const cursor: SketchPoint2D = [from[0] + delta[0], from[1] + delta[1]];
  const { preview, release, snapshot } = dragPoint(session, id, cursor);
  return {
    start,
    snapshot,
    kinds: [preview.kind, release.kind],
    previewLag: distance(solvedPoint(preview.solvedSnapshot!, id), cursor),
    releaseLag: distance(solvedPoint(snapshot, id), cursor),
    freeDof: sketchDraggedPointHasFreeDof(session, pid(id)),
  };
}
