/**
 * T15d shared fixture for the mirror editing seam (sketch session and the
 * authored-action owner): seeds above the x axis, mirrored by the Mirror
 * tool about a construction line (or the X datum), with drag-target refs.
 */
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  beginSketchTool,
  createNewSketchSession,
  selectSketchEditToolTarget,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  appendDefinition,
  createSessionCommitFactories,
  getSessionSketchId,
  rebuildSessionForDefinition,
} from "@/domain/editor/sketch-session/internals";
import {
  createSketchDerivedTransformContribution,
  createSketchOffsetDerivationContribution,
  type SketchEditOperationResult,
} from "@/domain/sketch-editing/operations";

export type P = readonly [number, number];
export const pid = (id: string) => `sketch_point_${id}` as SketchPointId;
export const eid = (id: string) => `sketch_entity_${id}` as SketchEntityId;
const SKETCH = "sketch_draft";
const point = (id: string, position: P, isConstruction = false) =>
  ({
    pointId: pid(id),
    label: id,
    target: { kind: "sketchPoint", sketchId: SKETCH, pointId: pid(id) },
    position: [position[0], position[1]],
    isConstruction,
  }) as SketchPointDefinition;
export const entityTarget = (id: string) => ({
  kind: "sketchEntity" as const,
  sketchId: SKETCH,
  entityId: eid(id),
});
const line = (id: string, a: string, b: string, isConstruction = false) =>
  ({
    kind: "lineSegment",
    entityId: eid(id),
    label: id,
    target: entityTarget(id),
    isConstruction,
    startPointId: pid(a),
    endPointId: pid(b),
  }) as SketchEntityDefinition;

/**
 * Seeds above the axis y = 0: line ab, circle c (r = 1), spline s whose
 * middle occurrence is authored [1, 0.5] (its ends automatic), and the
 * construction axis x0–x1.
 */
export function seedDefinition(
  constraints: readonly ConstraintDefinition[] = [],
): SketchDefinition {
  const points = [
    point("a", [1, 1]),
    point("b", [3, 2]),
    point("c", [6, 3]),
    point("s0", [9, 1]),
    point("s1", [10, 3]),
    point("s2", [12, 2]),
    point("x0", [-2, 0], true),
    point("x1", [20, 0], true),
    point("u", [15, 5]),
    point("rc", [16, 2]),
    point("rs", [17, 2]),
    point("re", [16, 3]),
  ];
  const entities = [
    line("ab", "a", "b"),
    {
      kind: "circle",
      entityId: eid("c"),
      label: "c",
      target: entityTarget("c"),
      isConstruction: false,
      centerPointId: pid("c"),
      radius: 1,
    } as SketchEntityDefinition,
    {
      kind: "spline",
      entityId: eid("s"),
      label: "s",
      target: entityTarget("s"),
      isConstruction: false,
      closure: "open",
      interpolationPolicy: "centripetal-mean-arm-v1",
      pointOccurrenceIds: ["occ0", "occ1", "occ2"],
      pointOccurrences: [
        {
          occurrenceId: "occ0",
          pointId: pid("s0"),
          tangent: { kind: "automatic" },
        },
        {
          occurrenceId: "occ1",
          pointId: pid("s1"),
          tangent: { kind: "authored", vector: [1, 0.5] },
        },
        {
          occurrenceId: "occ2",
          pointId: pid("s2"),
          tangent: { kind: "automatic" },
        },
      ],
    } as SketchEntityDefinition,
    {
      kind: "arc",
      entityId: eid("ar"),
      label: "ar",
      target: entityTarget("ar"),
      isConstruction: false,
      centerPointId: pid("rc"),
      startPointId: pid("rs"),
      endPointId: pid("re"),
      sweepDirection: "counterClockwise",
    } as SketchEntityDefinition,
    line("axis", "x0", "x1", true),
    {
      kind: "point",
      entityId: eid("u"),
      label: "u",
      target: entityTarget("u"),
      isConstruction: false,
      pointId: pid("u"),
    } as SketchEntityDefinition,
  ];
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: entities.map((entry) => entry.entityId),
    entities,
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints: [...constraints],
    dimensionIds: [],
    dimensions: [],
  } as SketchDefinition;
}

const fix = (id: string, position: P): ConstraintDefinition => ({
  constraintId: `constraint_fix_${id}` as never,
  kind: "fixPoint",
  label: `Fix ${id}`,
  pointId: pid(id),
  position,
});

export type MirrorVariant =
  | "free"
  | "horizontalAxis"
  | "datumAxis"
  | "fixedSeed";

/** The seeds mirrored by the Mirror tool about the line axis (or the X datum). */
export function mirroredSession(variant: MirrorVariant = "free") {
  const constraints: ConstraintDefinition[] =
    variant === "horizontalAxis"
      ? [
          {
            constraintId: "constraint_axis_horizontal" as never,
            kind: "horizontal",
            label: "Axis horizontal",
            entityId: eid("axis"),
          },
        ]
      : variant === "fixedSeed"
        ? [
            fix("a", [1, 1]),
            fix("b", [3, 2]),
            fix("c", [6, 3]),
            fix("s0", [9, 1]),
            fix("s1", [10, 3]),
            fix("s2", [12, 2]),
            fix("rc", [16, 2]),
            fix("rs", [17, 2]),
            fix("re", [16, 3]),
          ]
        : [];
  const base = rebuildSessionForDefinition(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
    { definition: seedDefinition(constraints) },
  );
  let tool = beginSketchTool(base, "sketchMirror");
  for (const seed of ["ab", "c", "s", "ar"])
    tool = selectSketchEditToolTarget(tool, entityTarget(seed) as never);
  const session = selectSketchEditToolTarget(
    tool,
    (variant === "datumAxis"
      ? {
          kind: "sketchDatumReference",
          sketchId: SKETCH,
          datumId: "xAxis",
          geometryKind: "lineSegment",
        }
      : entityTarget("axis")) as never,
  );
  const relationship = session.definition.derivedRelationships!.find(
    (candidate) => candidate.kind === "mirror",
  )!;
  if (relationship.kind !== "mirror") throw new Error("mirror");
  const outputOf = (seed: string) =>
    relationship.outputs.find((output) => output.seedEntityId === eid(seed))!;
  return {
    session: { ...session, activeTool: null, activeEditTool: null },
    relationship,
    outputOf,
  };
}

export const pointRef = (session: SketchSessionState, pointId: SketchPointId) =>
  ({
    kind: "sketchPoint",
    sketchId: getSessionSketchId(session),
    pointId,
  }) as PrimitiveRef;
export const entityRef = (
  session: SketchSessionState,
  entityId: SketchEntityId,
) =>
  ({
    kind: "sketchEntity",
    sketchId: getSessionSketchId(session),
    entityId,
  }) as PrimitiveRef;
export const handleRef = (
  session: SketchSessionState,
  entityId: SketchEntityId,
  occurrenceId: string,
  pointId: SketchPointId,
) =>
  ({
    kind: "sketchTangentHandle",
    sketchId: getSessionSketchId(session),
    entityId,
    occurrenceId,
    pointId,
  }) as PrimitiveRef;

/**
 * D9′ targets of every derived kind on top of the mirrored seeds: a linear
 * pattern and a transform of `ab`, an offset relationship whose output
 * line, joint arc and shell (with their driven points) are records only,
 * a second mirror whose seed is that offset output line (a G19 copy:
 * non-accepted while the offset is not certified), and (review A-1) a
 * mirror of the pattern output and a mirror of that copy. The resolver reads only
 * the relationship records, so the extra outputs need no geometry.
 */
export function derivedTargetsDefinition() {
  const { session, relationship, outputOf } = mirroredSession("free");
  const ids = {
    patternLine: eid("pattern_line"),
    patternPoint: pid("pattern_a"),
    transformLine: eid("transform_line"),
    transformPoint: pid("transform_a"),
    offsetLine: eid("offset_line"),
    offsetPoint: pid("offset_a"),
    jointArc: eid("offset_joint"),
    jointCentre: pid("offset_joint_c"),
    shell: eid("offset_shell"),
    shellEnd: pid("offset_shell_end"),
    offsetCopy: eid("offset_copy"),
    offsetCopyPoint: pid("offset_copy_a"),
    offsetDerivationId: "derivation_offset",
    offsetCopyDerivationId: "derivation_offset_copy",
    patternCopy: eid("pattern_copy"),
    patternCopyPoint: pid("pattern_copy_a"),
    patternCopyOfCopyPoint: pid("pattern_copy_copy_a"),
  };
  const copyOf = (
    seedEntityId: SketchEntityId,
    outputEntityId: SketchEntityId,
    outputPointIds: SketchPointId[],
  ) => ({
    seedEntityId,
    outputEntityId,
    instanceIndex: 1,
    seedPointIds: [pid("a"), pid("b")],
    outputPointIds,
  });
  const definition: SketchDefinition = {
    ...session.definition,
    derivedRelationships: [
      ...session.definition.derivedRelationships!,
      {
        derivationId: "derivation_pattern",
        kind: "linearPattern",
        label: "pattern",
        seedEntityIds: [eid("ab")],
        vector: [0, 5],
        instanceCount: 2,
        outputs: [
          copyOf(eid("ab"), ids.patternLine, [
            ids.patternPoint,
            pid("pattern_b"),
          ]),
        ],
      },
      {
        derivationId: "derivation_transform",
        kind: "transform",
        label: "transform",
        seedEntityIds: [eid("ab")],
        origin: [0, 0],
        translation: [0, 5],
        rotationRadians: 0,
        scale: 1,
        outputs: [
          copyOf(eid("ab"), ids.transformLine, [
            ids.transformPoint,
            pid("transform_b"),
          ]),
        ],
      } as never,
      {
        derivationId: ids.offsetDerivationId,
        kind: "offset",
        label: "offset",
        seedEntityIds: [eid("ab"), eid("s")],
        distance: 0.5,
        jointPolicy: "arc",
        outputs: [
          copyOf(eid("ab"), ids.offsetLine, [ids.offsetPoint, pid("offset_b")]),
        ],
        jointOutputs: [
          {
            firstSeedEntityId: eid("ab"),
            secondSeedEntityId: eid("s"),
            outputEntityId: ids.jointArc,
            centerPointId: ids.jointCentre,
            startPointId: pid("offset_b"),
            endPointId: pid("offset_joint_e"),
          },
        ],
        piecewiseCubicOutputs: [
          {
            seedEntityId: eid("s"),
            outputEntityId: ids.shell,
            startPointId: pid("offset_joint_e"),
            endPointId: ids.shellEnd,
            spans: [],
          },
        ],
      } as never,
      {
        derivationId: ids.offsetCopyDerivationId,
        kind: "mirror",
        label: "offset copy",
        seedEntityIds: [ids.offsetLine],
        mirrorReference: { kind: "lineEntity", entityId: eid("axis") },
        outputs: [
          {
            seedEntityId: ids.offsetLine,
            outputEntityId: ids.offsetCopy,
            instanceIndex: 1,
            seedPointIds: [ids.offsetPoint, pid("offset_b")],
            outputPointIds: [ids.offsetCopyPoint, pid("offset_copy_b")],
          },
        ],
      },
      // Review A-1: a mirror of the pattern output, and a mirror of that copy.
      {
        derivationId: "derivation_pattern_copy",
        kind: "mirror",
        label: "pattern copy",
        seedEntityIds: [ids.patternLine],
        mirrorReference: { kind: "lineEntity", entityId: eid("axis") },
        outputs: [
          {
            seedEntityId: ids.patternLine,
            outputEntityId: ids.patternCopy,
            instanceIndex: 1,
            seedPointIds: [ids.patternPoint, pid("pattern_b")],
            outputPointIds: [ids.patternCopyPoint, pid("pattern_copy_b")],
          },
        ],
      },
      {
        derivationId: "derivation_pattern_copy_copy",
        kind: "mirror",
        label: "pattern copy copy",
        seedEntityIds: [ids.patternCopy],
        mirrorReference: { kind: "sketchDatum", datum: "yAxis" },
        outputs: [
          {
            seedEntityId: ids.patternCopy,
            outputEntityId: eid("pattern_copy_copy"),
            instanceIndex: 1,
            seedPointIds: [ids.patternCopyPoint, pid("pattern_copy_b")],
            outputPointIds: [
              ids.patternCopyOfCopyPoint,
              pid("pattern_copy_copy_b"),
            ],
          },
        ],
      },
    ],
  };
  return { session, relationship, outputOf, definition, ids };
}

/**
 * T15e interplay: appends one more derived relationship, authored by the
 * production operation builders (offset: `side` left, `value` = distance;
 * mirror: the last entity is the axis; linear pattern: `value` = spacing),
 * and rebuilds the session's live solve. Returns the session and the new
 * relationship.
 */
export function withDerived(
  session: SketchSessionState,
  operatorKind: "offset" | "mirror" | "linearPattern",
  entityIds: readonly SketchEntityId[],
  sequence: number,
  value: number | null = null,
) {
  const factories = createSessionCommitFactories(sequence, SKETCH as never);
  const modelingTolerance = OCC_KERNEL_SETTINGS.modelingTolerance;
  const result: SketchEditOperationResult =
    operatorKind === "offset"
      ? createSketchOffsetDerivationContribution({
          definition: session.definition,
          entityIds,
          distance: value,
          side: "left",
          sequence,
          factories,
          modelingTolerance,
        })
      : createSketchDerivedTransformContribution({
          definition: session.definition,
          operatorKind,
          entityIds,
          value,
          sequence,
          factories,
          modelingTolerance,
        });
  if (!result.valid || !result.contribution)
    throw new Error(result.message ?? operatorKind);
  const next = rebuildSessionForDefinition(session, {
    definition: appendDefinition(session.definition, result.contribution),
  });
  return {
    session: next,
    relationship: next.definition.derivedRelationships!.at(-1)!,
  };
}

/**
 * T15d review RQ-1: a mirror of a mirror. The first copies of the spline
 * `s` and the line `ab` (about y = 0) are mirrored again about the vertical
 * construction line x = 30 (`axis2`): root seed (x, y) → first copy
 * (x, −y) → second copy (60 − x, −y); a vector (u, v) → (u, −v) → (−u, −v).
 */
export function chainSession() {
  const setup = mirroredSession("free");
  const base = setup.session.definition;
  const axisPoints = [
    point("v0", [30, -10], true),
    point("v1", [30, 10], true),
  ];
  const withAxis: SketchDefinition = {
    ...base,
    pointIds: [...base.pointIds, ...axisPoints.map((entry) => entry.pointId)],
    points: [...base.points, ...axisPoints],
    entityIds: [...base.entityIds, eid("axis2")],
    entities: [...base.entities, line("axis2", "v0", "v1", true)],
  };
  const withAxisSession = rebuildSessionForDefinition(setup.session, {
    definition: withAxis,
  });
  const contribution = createSketchDerivedTransformContribution({
    definition: withAxisSession.definition,
    operatorKind: "mirror",
    entityIds: [
      setup.outputOf("s").outputEntityId,
      setup.outputOf("ab").outputEntityId,
      eid("axis2"),
    ],
    value: null,
    sequence: 60,
    factories: createSessionCommitFactories(60, SKETCH as never),
    modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
  });
  if (!contribution.valid || !contribution.contribution)
    throw new Error(contribution.message ?? "second mirror");
  const session = rebuildSessionForDefinition(withAxisSession, {
    definition: appendDefinition(
      withAxisSession.definition,
      contribution.contribution,
    ),
  });
  const second = session.definition.derivedRelationships!.filter(
    (relationship) => relationship.kind === "mirror",
  )[1]!;
  /** The second copy's output record of a first copy. */
  const secondOutputOf = (firstCopy: SketchEntityId) =>
    second.outputs.find((output) => output.seedEntityId === firstCopy)!;
  return { session, setup, second, secondOutputOf };
}
