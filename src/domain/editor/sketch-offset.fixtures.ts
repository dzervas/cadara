/**
 * T17c shared fixture for the offset removal seam (sketch session, the
 * authored-action owner, the Offset panel): entered sessions (T17-10′
 * builder) holding one offset authored by the production Offset builder
 * over a line chain, a spline, or a line + spline chain.
 */
import type { SketchEntityId } from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import {
  createNewSketchSession,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  appendDefinition,
  rebuildSessionForDefinition,
} from "@/domain/editor/sketch-session/definition-authoring";
import { createSessionCommitFactories } from "@/domain/editor/sketch-session/tool-authoring";
import { createSketchOffsetDerivationContribution } from "@/core/sketch-editing/operations";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import { eid, entityTarget, pid } from "@/domain/editor/sketch-mirror.fixtures";

const SKETCH = "sketch_draft";
const point = (id: string, position: readonly [number, number]) =>
  ({
    pointId: pid(id),
    label: id,
    target: { kind: "sketchPoint", sketchId: SKETCH, pointId: pid(id) },
    position: [position[0], position[1]],
    isConstruction: false,
  }) as SketchPointDefinition;
const line = (id: string, a: string, b: string) =>
  ({
    kind: "lineSegment",
    entityId: eid(id),
    label: id,
    target: entityTarget(id),
    isConstruction: false,
    startPointId: pid(a),
    endPointId: pid(b),
  }) as SketchEntityDefinition;

/**
 * Lines `l1` p0(0,0)→p1(4,0) and `l2` p1→p2(4,3) (a left turn at p1), the
 * spline `s` p2→(6,4)→(8,3) continuing the chain, the free line `free`
 * f0(10,0)→f1(12,0), the circle `c` (centre k(16,4), r = 1) and the
 * construction axis `axis` x0(-5,-5)→x1(20,-5).
 */
export function offsetSeedDefinition(): SketchDefinition {
  const points = [
    point("p0", [0, 0]),
    point("p1", [4, 0]),
    point("p2", [4, 3]),
    point("q1", [6, 4]),
    point("q2", [8, 3]),
    point("f0", [10, 0]),
    point("f1", [12, 0]),
    point("k", [16, 4]),
    { ...point("x0", [-5, -5]), isConstruction: true },
    { ...point("x1", [20, -5]), isConstruction: true },
  ];
  const entities = [
    line("l1", "p0", "p1"),
    line("l2", "p1", "p2"),
    {
      kind: "spline",
      entityId: eid("s"),
      label: "s",
      target: entityTarget("s"),
      isConstruction: false,
      closure: "open",
      interpolationPolicy: "centripetal-mean-arm-v1",
      pointOccurrenceIds: ["o0", "o1", "o2"],
      pointOccurrences: [
        {
          occurrenceId: "o0",
          pointId: pid("p2"),
          tangent: { kind: "automatic" },
        },
        {
          occurrenceId: "o1",
          pointId: pid("q1"),
          tangent: { kind: "automatic" },
        },
        {
          occurrenceId: "o2",
          pointId: pid("q2"),
          tangent: { kind: "automatic" },
        },
      ],
    } as SketchEntityDefinition,
    line("free", "f0", "f1"),
    {
      kind: "circle",
      entityId: eid("c"),
      label: "c",
      target: entityTarget("c"),
      isConstruction: false,
      centerPointId: pid("k"),
      radius: 1,
    } as SketchEntityDefinition,
    { ...line("axis", "x0", "x1"), isConstruction: true },
  ];
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: entities.map((entry) => entry.entityId),
    entities,
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  } as SketchDefinition;
}

/**
 * Appends one offset of `seeds` authored by the production Offset builder
 * (`side`, `distance`) and rebuilds the live solve. Returns the session
 * and the new relationship.
 */
export function withOffset(
  session: SketchSessionState,
  seeds: readonly SketchEntityId[],
  sequence: number,
  side: "left" | "right" = "left",
  distance = 0.5,
) {
  const result = createSketchOffsetDerivationContribution({
    definition: session.definition,
    entityIds: seeds,
    distance,
    side,
    sequence,
    factories: createSessionCommitFactories(sequence, SKETCH as never),
    modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    documentVariables: session.documentVariables,
  });
  if (!result.valid || !result.contribution)
    throw new Error(result.message ?? "offset");
  const next = rebuildSessionForDefinition(session, {
    definition: appendDefinition(session.definition, result.contribution),
  });
  const relationship = next.definition.derivedRelationships!.at(-1)!;
  if (relationship.kind !== "offset") throw new Error("offset");
  return { session: next, relationship };
}

/** The entered seed session (no relationship yet). */
export const offsetSeedSession = (
  definition: SketchDefinition = offsetSeedDefinition(),
) =>
  enterSketchSession(
    rebuildSessionForDefinition(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      { definition },
    ),
  );

export type OffsetVariant =
  /** l1 + l2 to the inside of the turn: one trim joint (a shared corner point). */
  | "lineTrim"
  /** l1 + l2 to the outside of the turn: a joint arc between the two outputs. */
  | "lineArcJoint"
  /** the spline alone: one shell with two terminal driven points. */
  | "spline"
  /** l2 + s to the inside of the turn: a line output and a shell sharing their trimmed joint point. */
  | "lineSpline"
  /** l2 + s to the outside of the turn: a joint arc between a line output and a shell. */
  | "lineSplineArcJoint"
  /** `free` alone: a single line output. */
  | "singleLine"
  /** `c` alone: a concentric output circle. */
  | "circle";

const VARIANTS: Record<
  OffsetVariant,
  { seeds: readonly string[]; side: "left" | "right" }
> = {
  lineTrim: { seeds: ["l1", "l2"], side: "left" },
  lineArcJoint: { seeds: ["l1", "l2"], side: "right" },
  spline: { seeds: ["s"], side: "left" },
  lineSpline: { seeds: ["l2", "s"], side: "right" },
  lineSplineArcJoint: { seeds: ["l2", "s"], side: "left" },
  singleLine: { seeds: ["free"], side: "left" },
  circle: { seeds: ["c"], side: "left" },
};

/** An entered session with one offset of `variant`. */
export function offsetSession(variant: OffsetVariant) {
  const { seeds, side } = VARIANTS[variant];
  return withOffset(offsetSeedSession(), seeds.map(eid), 90, side);
}
