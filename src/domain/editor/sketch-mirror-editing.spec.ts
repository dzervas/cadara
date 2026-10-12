/**
 * T15d: either-side mirror editing in the sketch session. Logic lane; seam:
 * the sketch session's exported drag, tangent-action and edit-tool entry
 * points (`beginSketchGeometryDrag` … `finishSketchGeometryDrag`,
 * `cancelSketchGeometryDrag`, `selectSketchEditToolTarget`), on sessions
 * whose mirror is authored by the Mirror tool.
 */
import { describe, expect, test } from "vitest";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SketchDerivationDefinition,
} from "@/contracts/sketch/schema";
import { reconstructSplineAggregate } from "@/contracts/sketch/spline-geometry";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { offsetArrangementInput } from "@/contracts/sketch/region-extraction";
import {
  isOffsetPublicationSolveAccepted,
  nonAcceptedDerivedOutputs,
  publishSketchOffsets,
} from "@/contracts/sketch/offset-publication";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import {
  beginSketchGeometryDrag,
  beginSketchTool,
  cancelSketchGeometryDrag,
  computeSketchMirrorActionState,
  createNewSketchSession,
  deleteSelectedSketchGeometry,
  finishSketchGeometryDrag,
  isSketchMirrorReady,
  patchSketchEditToolValue,
  selectSketchEditToolTarget,
  updateSketchEditToolHover,
  updateSketchGeometryDrag,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  MIRROR_DATUM_AXIS_ORDER_MESSAGE,
  offsetEditInputGate,
} from "@/domain/editor/sketch-session/editing";
import {
  getEnterEvent,
  getEscapeEvent,
} from "@/domain/editor/workbench-interactions";
import { buildSketchVectorExportModelFromSnapshot } from "@/domain/export/sketch-vector-export-model";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/domain/modeling/neutral-curve-certification/query";
import {
  nonAcceptedOffsetFeatureInputMessage,
  nonAcceptedOffsetFeaturePointMessage,
} from "@/domain/modeling/sketch-feature-input";
import { nonAcceptedOutputProjectionMessage } from "@/domain/modeling/sketch-reference-projection";
import {
  appendDefinition,
  CONSTRAINED_DRAG_BLOCKED_MESSAGE,
  createSessionCommitFactories,
  getSketchSessionDisplayDefinition,
  rebuildSessionForDefinition,
} from "@/domain/editor/sketch-session/internals";
import { completeSketchEditQueriesForTest } from "@/domain/editor/state-machine-test-builder";
import { applyTangentAction } from "@/domain/editor/sketch-session/tangent-actions";
import { toggleSketchConstructionTarget } from "@/domain/editor/sketch-session/tools";
import { patchSketchStyleValue } from "@/domain/editor/sketch-session/styles";
import { createSketchDerivedTransformContribution } from "@/domain/sketch-editing/operations";
import {
  chainSession,
  eid,
  entityRef,
  entityTarget,
  handleRef,
  mirroredSession,
  pid,
  pointRef,
  seedDefinition,
  withDerived,
  type P,
} from "./sketch-mirror.fixtures";

const position = (session: SketchSessionState, pointId: SketchPointId) =>
  session.definition.points.find((entry) => entry.pointId === pointId)!
    .position;
/** R about the x axis (y = 0): the reflection every variant's axis keeps. */
const reflect = ([x, y]: P): P => [x, -y];
const distance = (first: P, second: P) =>
  Math.hypot(first[0] - second[0], first[1] - second[1]);
const expectBitwise = (actual: P, expected: P, message: string) =>
  expect(
    Object.is(actual[0], expected[0]) && Object.is(actual[1], expected[1]),
    `${message}: [${actual}] vs [${expected}]`,
  ).toBe(true);
const entity = (session: SketchSessionState, entityId: SketchEntityId) =>
  session.definition.entities.find((entry) => entry.entityId === entityId)!;

/** One completed gesture: press at `from`, glide in 5 frames to `to`, release. */
function drag(
  session: SketchSessionState,
  target: PrimitiveRef,
  from: P,
  to: P,
  options?: { exactZero?: boolean },
) {
  let next = beginSketchGeometryDrag(session, target, from);
  const started = next.activeDrag !== null;
  for (let step = 1; step <= 5; step += 1) {
    const t = step / 5;
    next = updateSketchGeometryDrag(
      next,
      [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
      step === 5 ? options : undefined,
    );
  }
  return { started, session: finishSketchGeometryDrag(next, to, options) };
}

const occurrence = (
  session: SketchSessionState,
  entityId: SketchEntityId,
  index: number,
) => {
  const spline = entity(session, entityId);
  if (spline.kind !== "spline") throw new Error("spline");
  return spline.pointOccurrences[index]!;
};

const intents = ["point", "body", "centre", "rim", "tangent", "zero"] as const;
type Intent = (typeof intents)[number];

/** The press/release pair and target of one intent on the copy (outputs of ab, c, s). */
function gesture(setup: ReturnType<typeof mirroredSession>, intent: Intent) {
  const { session, outputOf } = setup;
  const line = outputOf("ab");
  const circle = outputOf("c");
  const spline = outputOf("s");
  const ma = line.outputPointIds[0]!;
  const mb = line.outputPointIds[1]!;
  const mc = circle.outputPointIds[0]!;
  const ms1 = spline.outputPointIds[1]!;
  switch (intent) {
    case "point": {
      const from = position(session, ma);
      return {
        target: pointRef(session, ma),
        from,
        to: [from[0] + 0.3, from[1] - 0.4] as P,
      };
    }
    case "body": {
      const [a, b] = [position(session, ma), position(session, mb)];
      const from: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      return {
        target: entityRef(session, line.outputEntityId),
        from,
        to: [from[0] + 0.3, from[1] - 0.2] as P,
      };
    }
    case "centre": {
      const from = position(session, mc);
      return {
        target: pointRef(session, mc),
        from,
        to: [from[0] + 0.5, from[1] - 0.25] as P,
      };
    }
    case "rim": {
      const centre = position(session, mc);
      return {
        target: entityRef(session, circle.outputEntityId),
        from: [centre[0] + 1, centre[1]] as P,
        to: [centre[0] + 1.6, centre[1]] as P,
      };
    }
    case "tangent":
    case "zero": {
      const fit = position(session, ms1);
      const handle = occurrence(session, spline.outputEntityId, 1);
      if (handle.tangent.kind !== "authored") throw new Error("authored copy");
      const from: P = [
        fit[0] + handle.tangent.vector[0],
        fit[1] + handle.tangent.vector[1],
      ];
      return {
        target: handleRef(
          session,
          spline.outputEntityId,
          handle.occurrenceId,
          ms1,
        ),
        from,
        to: (intent === "zero" ? fit : [fit[0] + 1.5, fit[1] + 0.5]) as P,
        ...(intent === "zero" ? { options: { exactZero: true } } : {}),
      };
    }
  }
}

/** Every copy value equals the owner's reflection of its seed (y ↦ −y here). */
function expectCoherentCopy(
  session: SketchSessionState,
  outputOf: ReturnType<typeof mirroredSession>["outputOf"],
) {
  for (const seed of ["ab", "c", "s", "ar"]) {
    const output = outputOf(seed);
    output.seedPointIds.forEach((seedPointId, index) => {
      expect(
        distance(
          position(session, output.outputPointIds[index]!),
          reflect(position(session, seedPointId)),
        ),
        `copy point ${index} of ${seed} = R(seed point)`,
      ).toBeLessThanOrEqual(1e-12);
    });
  }
  const seedCircle = entity(session, eid("c"));
  const copyCircle = entity(session, outputOf("c").outputEntityId);
  if (seedCircle.kind !== "circle" || copyCircle.kind !== "circle")
    throw new Error("circle");
  expect(copyCircle.radius, "copy radius = seed radius").toBe(
    seedCircle.radius,
  );
  const seedSpline = entity(session, eid("s"));
  const copySpline = entity(session, outputOf("s").outputEntityId);
  if (seedSpline.kind !== "spline" || copySpline.kind !== "spline")
    throw new Error("spline");
  seedSpline.pointOccurrences.forEach((seedOccurrence, index) => {
    const copy = copySpline.pointOccurrences[index]!.tangent;
    expect(copy.kind, `copy tangent ${index} kind`).toBe(
      seedOccurrence.tangent.kind,
    );
    if (seedOccurrence.tangent.kind === "authored" && copy.kind === "authored")
      expect(
        distance(copy.vector, reflect(seedOccurrence.tangent.vector)),
        `copy tangent ${index} = Rv(seed tangent)`,
      ).toBeLessThanOrEqual(1e-12);
  });
}

/** The intent's dragged quantity on the copy after the gesture, and the request. */
function reached(
  session: SketchSessionState,
  setup: ReturnType<typeof mirroredSession>,
  intent: Intent,
  move: ReturnType<typeof gesture>,
): number {
  const { outputOf } = setup;
  switch (intent) {
    case "point":
      return distance(
        position(session, outputOf("ab").outputPointIds[0]!),
        move.to,
      );
    case "body": {
      const ma = position(session, outputOf("ab").outputPointIds[0]!);
      const before = position(setup.session, outputOf("ab").outputPointIds[0]!);
      return distance(
        [ma[0] - before[0], ma[1] - before[1]],
        [move.to[0] - move.from[0], move.to[1] - move.from[1]],
      );
    }
    case "centre":
      return distance(
        position(session, outputOf("c").outputPointIds[0]!),
        move.to,
      );
    case "rim": {
      const copy = entity(session, outputOf("c").outputEntityId);
      if (copy.kind !== "circle") throw new Error("circle");
      return Math.abs(copy.radius - 1.6);
    }
    case "tangent":
    case "zero": {
      const copy = occurrence(session, outputOf("s").outputEntityId, 1).tangent;
      if (copy.kind !== "authored") throw new Error("authored");
      const fit = position(session, outputOf("s").outputPointIds[1]!);
      return distance(copy.vector, [move.to[0] - fit[0], move.to[1] - fit[1]]);
    }
  }
}

test("probe 9a (red on base): with no constraints, dragging the copy's end moves its seed; nothing snaps back silently", () => {
  const setup = mirroredSession("free");
  const ma = setup.outputOf("ab").outputPointIds[0]!;
  const from = position(setup.session, ma);
  const to: P = [from[0] + 0.3, from[1] - 0.4];
  const { session } = drag(
    setup.session,
    pointRef(setup.session, ma),
    from,
    to,
  );
  expect(
    distance(position(session, ma), to),
    "the copy's end reaches the pointer",
  ).toBeLessThanOrEqual(1e-4);
  expect(
    distance(position(session, pid("a")), reflect(to)),
    "the seed end is its mirror image",
  ).toBeLessThanOrEqual(1e-4);
  expect(session.validationMessage).toBeNull();
});

describe("T15d D9′: every T12 intent on a mirror copy moves its seed reciprocally, the axis held", () => {
  for (const variant of ["free", "horizontalAxis", "datumAxis"] as const)
    for (const intent of intents)
      test(`${variant}: ${intent} on the copy`, () => {
        const setup = mirroredSession(variant);
        const move = gesture(setup, intent);
        const { started, session } = drag(
          setup.session,
          move.target,
          move.from,
          move.to,
          move.options,
        );
        expect(started, "the copy is a drag target (D9′)").toBe(true);
        expect(
          reached(session, setup, intent, move),
          "the copy follows the pointer",
        ).toBeLessThanOrEqual(1e-4);
        expectCoherentCopy(session, setup.outputOf);
        if (intent === "zero")
          for (const entityId of [
            eid("s"),
            setup.outputOf("s").outputEntityId,
          ]) {
            const tangent = occurrence(session, entityId, 1).tangent;
            expect(
              tangent.kind === "authored" &&
                tangent.vector[0] === 0 &&
                tangent.vector[1] === 0,
              `exact zero captured on ${entityId}`,
            ).toBe(true);
          }
        if (variant !== "datumAxis")
          for (const axisPoint of ["x0", "x1"])
            expectBitwise(
              position(session, pid(axisPoint)),
              position(setup.session, pid(axisPoint)),
              `axis ${axisPoint} held bitwise`,
            );
      });
});

test("fixed seed (Q2, constrained lag): dragging the copy moves nothing, keeps the axis, shows the constrained message and authors nothing", () => {
  const setup = mirroredSession("fixedSeed");
  const move = gesture(setup, "point");
  let next = beginSketchGeometryDrag(setup.session, move.target, move.from);
  expect(
    next.activeDrag,
    "the copy of a fixed seed is still a drag target",
  ).not.toBeNull();
  next = updateSketchGeometryDrag(next, move.to);
  expect(next.activeDrag?.feedback?.kind, "constrained cue at the copy").toBe(
    "constrained",
  );
  const done = finishSketchGeometryDrag(next, move.to);
  expect(done.definition, "nothing authored: the pre-drag definition").toBe(
    setup.session.definition,
  );
  expect(done.validationMessage).toBe(CONSTRAINED_DRAG_BLOCKED_MESSAGE);
});

describe("T15d T-12: tangent intents on a copy act on the seed occurrence", () => {
  test("grabbing a copy's automatic handle converts the seed occurrence to authored with Rv(visible copy vector); cancel restores both automatic", () => {
    const setup = mirroredSession("free");
    const copy = setup.outputOf("s");
    const copySpline = entity(setup.session, copy.outputEntityId);
    if (copySpline.kind !== "spline") throw new Error("spline");
    expect(occurrence(setup.session, copy.outputEntityId, 0).tangent.kind).toBe(
      "automatic",
    );
    expect(occurrence(setup.session, eid("s"), 0).tangent.kind).toBe(
      "automatic",
    );
    const reconstruction = reconstructSplineAggregate(
      copySpline,
      Object.fromEntries(
        setup.session.definition.points.map((entry) => [
          entry.pointId,
          entry.position,
        ]),
      ),
    );
    if (reconstruction.validity !== "valid") throw new Error("valid copy");
    const visible = reconstruction.handles[0]!;
    const fit = position(setup.session, copy.outputPointIds[0]!);
    const tip: P = [fit[0] + visible[0], fit[1] + visible[1]];
    const grabbed = beginSketchGeometryDrag(
      setup.session,
      handleRef(
        setup.session,
        copy.outputEntityId,
        copySpline.pointOccurrences[0]!.occurrenceId,
        copy.outputPointIds[0]!,
      ),
      tip,
    );
    expect(grabbed.activeDrag).not.toBeNull();
    const seedTangent = occurrence(grabbed, eid("s"), 0).tangent;
    expect(
      seedTangent.kind,
      "the seed occurrence (the authority) becomes authored",
    ).toBe("authored");
    if (seedTangent.kind !== "authored") return;
    expect(
      distance(seedTangent.vector, reflect(visible)),
      "with Rv(visible copy vector)",
    ).toBeLessThanOrEqual(1e-12);
    const copyTangent = occurrence(grabbed, copy.outputEntityId, 0).tangent;
    expect(
      copyTangent.kind,
      "the copy follows by the owner's structural sync",
    ).toBe("authored");
    if (copyTangent.kind === "authored")
      expect(
        distance(copyTangent.vector, visible),
        "the curve does not change at grab",
      ).toBeLessThanOrEqual(1e-12);
    const cancelled = cancelSketchGeometryDrag(grabbed);
    expect(
      cancelled.definition,
      "cancel restores the pre-drag definition",
    ).toBe(setup.session.definition);

    const dragged = drag(
      setup.session,
      handleRef(
        setup.session,
        copy.outputEntityId,
        copySpline.pointOccurrences[0]!.occurrenceId,
        copy.outputPointIds[0]!,
      ),
      tip,
      [tip[0] + 0.5, tip[1] - 0.5],
    ).session;
    const seedAfter = occurrence(dragged, eid("s"), 0).tangent;
    const copyAfter = occurrence(dragged, copy.outputEntityId, 0).tangent;
    expect(seedAfter.kind === "authored" && copyAfter.kind === "authored").toBe(
      true,
    );
    if (seedAfter.kind !== "authored" || copyAfter.kind !== "authored") return;
    expect(
      distance(copyAfter.vector, [visible[0] + 0.5, visible[1] - 0.5]),
      "the copy handle follows the pointer",
    ).toBeLessThanOrEqual(1e-4);
    expect(
      distance(seedAfter.vector, reflect(copyAfter.vector)),
      "the seed handle is its mirror image",
    ).toBeLessThanOrEqual(1e-12);
  });

  for (const intent of ["resetTangentToAutomatic", "setTangentToZero"] as const)
    test(`${intent} on the copy's handle acts on the seed occurrence and the copy follows (one definition change)`, () => {
      const setup = mirroredSession("free");
      const copy = setup.outputOf("s");
      const copyOccurrence = occurrence(setup.session, copy.outputEntityId, 1);
      const next = applyTangentAction(
        setup.session,
        [
          handleRef(
            setup.session,
            copy.outputEntityId,
            copyOccurrence.occurrenceId,
            copy.outputPointIds[1]!,
          ),
        ],
        intent,
      );
      expect(next.definition).not.toBe(setup.session.definition);
      for (const entityId of [eid("s"), copy.outputEntityId]) {
        const tangent = occurrence(next, entityId, 1).tangent;
        if (intent === "resetTangentToAutomatic")
          expect(tangent.kind, entityId).toBe("automatic");
        else
          expect(
            tangent.kind === "authored" &&
              tangent.vector[0] === 0 &&
              tangent.vector[1] === 0,
            `${entityId} exact zero`,
          ).toBe(true);
      }
      expectCoherentCopy(next, setup.outputOf);
    });
});

describe("T15d D9′: one-way outputs and failed mirrors' copies are not drag targets", () => {
  test("pattern and transform outputs (and their driven points) start no drag; the seed still does", () => {
    for (const operatorKind of ["linearPattern", "transform"] as const) {
      const base = rebuildSessionForDefinition(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
        { definition: seedDefinition() },
      );
      const contribution = createSketchDerivedTransformContribution({
        definition: base.definition,
        operatorKind,
        entityIds: [eid("ab")],
        value: 5,
        sequence: 30,
        factories: createSessionCommitFactories(30, "sketch_draft" as never),
        modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
      });
      expect(contribution.valid, contribution.message ?? "").toBe(true);
      const session = rebuildSessionForDefinition(base, {
        definition: appendDefinition(
          base.definition,
          contribution.contribution!,
        ),
      });
      const output = session.definition.derivedRelationships![0]!.outputs[0]!;
      const outputPoint = output.outputPointIds[0]!;
      for (const target of [
        pointRef(session, outputPoint),
        entityRef(session, output.outputEntityId),
      ])
        expect(
          beginSketchGeometryDrag(
            session,
            target,
            position(session, outputPoint),
          ).activeDrag,
          `${operatorKind} output ${target.kind} is one-way`,
        ).toBeNull();
      expect(
        beginSketchGeometryDrag(
          session,
          pointRef(session, pid("a")),
          position(session, pid("a")),
        ).activeDrag,
        "control: the seed is draggable",
      ).not.toBeNull();
    }
  });

  test("review A-1: a mirror copy of a pattern output (one-way upstream) starts no drag; the pattern's seed does", () => {
    const base = rebuildSessionForDefinition(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      { definition: seedDefinition() },
    );
    const contribution = createSketchDerivedTransformContribution({
      definition: base.definition,
      operatorKind: "linearPattern",
      entityIds: [eid("ab")],
      value: 5,
      sequence: 30,
      factories: createSessionCommitFactories(30, "sketch_draft" as never),
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    });
    expect(contribution.valid, contribution.message ?? "").toBe(true);
    const patterned = rebuildSessionForDefinition(base, {
      definition: appendDefinition(base.definition, contribution.contribution!),
    });
    const patternOutput =
      patterned.definition.derivedRelationships![0]!.outputs[0]!;
    let tool = beginSketchTool(patterned, "sketchMirror");
    tool = selectSketchEditToolTarget(
      tool,
      entityRef(tool, patternOutput.outputEntityId),
    );
    // T16d: the axis pick stages the mirror; the confirm authors it.
    const mirrored = patchSketchEditToolValue(
      selectSketchEditToolTarget(tool, entityRef(tool, eid("axis"))),
      { intent: "createMirror" },
    );
    const mirror = mirrored.definition.derivedRelationships!.find(
      (relationship) => relationship.kind === "mirror",
    )!;
    const session = { ...mirrored, activeTool: null, activeEditTool: null };
    const copy = mirror.outputs[0]!;
    const copyEnd = copy.outputPointIds[0]!;
    for (const target of [
      pointRef(session, copyEnd),
      entityRef(session, copy.outputEntityId),
    ])
      expect(
        beginSketchGeometryDrag(session, target, position(session, copyEnd))
          .activeDrag,
        `the copy ${target.kind} of a pattern output is one-way`,
      ).toBeNull();
    expect(
      beginSketchGeometryDrag(
        session,
        pointRef(session, pid("a")),
        position(session, pid("a")),
      ).activeDrag,
      "control: the pattern's seed is draggable",
    ).not.toBeNull();
  });

  test("a failed mirror's copy (G19 non-accepted) starts no drag; the healthy copy and the seed do", () => {
    const setup = mirroredSession("free");
    const ma = setup.outputOf("ab").outputPointIds[0]!;
    expect(
      beginSketchGeometryDrag(
        setup.session,
        pointRef(setup.session, ma),
        position(setup.session, ma),
      ).activeDrag,
      "control: the healthy copy is draggable",
    ).not.toBeNull();
    const withoutAxis = setup.session.definition.entities.filter(
      (candidate) => candidate.entityId !== eid("axis"),
    );
    const broken = rebuildSessionForDefinition(setup.session, {
      definition: {
        ...setup.session.definition,
        entityIds: withoutAxis.map((candidate) => candidate.entityId),
        entities: withoutAxis,
      },
    });
    expect(broken.liveSolve?.solvedSnapshot.failedDerivationIds).toEqual([
      setup.relationship.derivationId,
    ]);
    for (const target of [
      pointRef(broken, ma),
      entityRef(broken, setup.outputOf("ab").outputEntityId),
      entityRef(broken, setup.outputOf("c").outputEntityId),
    ])
      expect(
        beginSketchGeometryDrag(broken, target, position(broken, ma))
          .activeDrag,
        `failed copy ${target.kind} is not draggable`,
      ).toBeNull();
    expect(
      beginSketchGeometryDrag(
        broken,
        pointRef(broken, pid("a")),
        position(broken, pid("a")),
      ).activeDrag,
      "control: the seed stays draggable (repair)",
    ).not.toBeNull();
  });
});

describe("T15d T-11: topology edits on either side of a mirror are refused up front", () => {
  // T16a ([TECH] T16-3, review R-2): the texts name the mirror by label and
  // the way to the Mirror panel's Remove mirror from the armed tool.
  const message = (verb: string, label: string) =>
    `This shape is part of mirror ‘${label}’. To ${verb} it, press Esc, select it, then Mirror → Remove mirror.`;
  const mergeMessage = (point: string, relation: string, label: string) =>
    `${point} is ${relation} mirror ‘${label}’. To merge it, press Esc, select it, then Mirror → Remove mirror.`;

  for (const side of ["seed", "copy"] as const) {
    const pick = (setup: ReturnType<typeof mirroredSession>) =>
      side === "seed" ? eid("ab") : setup.outputOf("ab").outputEntityId;

    test(`Trim on the ${side}: refused at the click, no query, nothing written`, () => {
      const setup = mirroredSession("free");
      const tool = beginSketchTool(setup.session, "trim");
      const clicked = selectSketchEditToolTarget(
        tool,
        entityRef(tool, pick(setup)),
      );
      expect(clicked.validationMessage).toBe(
        message("trim", setup.relationship.label),
      );
      expect(clicked.definition).toBe(tool.definition);
      expect(clicked.activeEditTool?.editQuery?.inFlight ?? null).toBeNull();
      expect(clicked.activeEditTool?.editQuery?.queue ?? []).toEqual([]);
    });

    for (const [toolId, verb] of [
      ["sketchSplit", "split"],
      ["sketchExtend", "extend"],
    ] as const)
      test(`${verb} of the ${side}: refused at the target pick (T16a B7), the pick not kept, tool armed, no query, nothing written`, () => {
        const setup = mirroredSession("free");
        const tool = beginSketchTool(setup.session, toolId);
        const picked = selectSketchEditToolTarget(
          tool,
          entityRef(tool, pick(setup)),
        );
        expect(picked.validationMessage).toBe(
          message(verb, setup.relationship.label),
        );
        expect(picked.activeEditTool?.toolId, "the tool stays armed").toBe(
          toolId,
        );
        expect(picked.activeEditTool?.selectedTargets).toEqual([]);
        expect(picked.definition).toBe(setup.session.definition);
        expect(picked.activeEditTool?.editQuery ?? null).toBeNull();
        // The next pick starts a fresh target (the axis is no participant).
        const next = selectSketchEditToolTarget(
          picked,
          entityRef(tool, eid("axis")),
        );
        expect(next.activeEditTool?.selectedTargets).toEqual([
          entityRef(tool, eid("axis")),
        ]);
        expect(next.validationMessage).toBeNull();
      });

    for (const [toolId, verb] of [
      ["sketchFillet", "fillet"],
      ["sketchChamfer", "chamfer"],
    ] as const)
      test(`${verb} of the ${side}: refused at its pick, first or second (T16a review A-7), the pick not kept, tool armed, nothing written`, () => {
        const setup = mirroredSession("free");
        const tool = beginSketchTool(setup.session, toolId);
        const first = selectSketchEditToolTarget(
          tool,
          entityRef(tool, pick(setup)),
        );
        expect(first.validationMessage, "refused at the first pick").toBe(
          message(verb, setup.relationship.label),
        );
        expect(first.activeEditTool?.toolId).toBe(toolId);
        expect(first.activeEditTool?.selectedTargets).toEqual([]);
        expect(first.definition).toBe(setup.session.definition);
        const axis = selectSketchEditToolTarget(
          first,
          entityRef(tool, eid("axis")),
        );
        expect(axis.activeEditTool?.selectedTargets).toEqual([
          entityRef(tool, eid("axis")),
        ]);
        const second = selectSketchEditToolTarget(
          axis,
          entityRef(tool, pick(setup)),
        );
        expect(second.validationMessage, "refused at the second pick").toBe(
          message(verb, setup.relationship.label),
        );
        expect(
          second.activeEditTool?.selectedTargets,
          "the earlier pick stays, the refused one is not kept",
        ).toEqual([entityRef(tool, eid("axis"))]);
        expect(second.definition).toBe(setup.session.definition);
      });
  }

  test("Merge: a seed end is refused naming the mirror (after the R-4 pair rule); a copy's end names the mirror as driven", () => {
    const setup = mirroredSession("free");
    const label = setup.relationship.label;
    let tool = beginSketchTool(setup.session, "sketchMergePoints");
    tool = selectSketchEditToolTarget(tool, pointRef(tool, pid("a")));
    const paired = selectSketchEditToolTarget(tool, pointRef(tool, pid("u")));
    expect(paired.validationMessage).toBe(mergeMessage("a", "part of", label));
    expect(paired.definition).toBe(setup.session.definition);
    const reversed = selectSketchEditToolTarget(
      selectSketchEditToolTarget(
        beginSketchTool(setup.session, "sketchMergePoints"),
        pointRef(tool, pid("u")),
      ),
      pointRef(tool, pid("a")),
    );
    expect(reversed.validationMessage, "either order").toBe(
      mergeMessage("a", "part of", label),
    );
    const copyEnd = setup.outputOf("ab").outputPointIds[0]!;
    const copy = selectSketchEditToolTarget(
      beginSketchTool(setup.session, "sketchMergePoints"),
      pointRef(tool, copyEnd),
    );
    const copyLabel = setup.session.definition.points.find(
      (entry) => entry.pointId === copyEnd,
    )!.label;
    expect(copy.validationMessage).toBe(
      mergeMessage(copyLabel, "driven by", label),
    );
    expect(copy.definition).toBe(setup.session.definition);
  });
});

/** Bitwise equality (Object.is on every number, so ±0 differ). */
function bitwise(first: unknown, second: unknown): boolean {
  if (typeof first === "number" || typeof second === "number")
    return Object.is(first, second);
  if (Array.isArray(first) && Array.isArray(second))
    return (
      first.length === second.length &&
      first.every((entry, index) => bitwise(entry, second[index]))
    );
  if (
    first &&
    second &&
    typeof first === "object" &&
    typeof second === "object"
  ) {
    const keys = Object.keys(first as object);
    return (
      keys.length === Object.keys(second as object).length &&
      keys.every((key) =>
        bitwise(
          (first as Record<string, unknown>)[key],
          (second as Record<string, unknown>)[key],
        ),
      )
    );
  }
  return first === second;
}

/**
 * The stored copy values of every output: points, circle radius, arc sweep,
 * spline tangents (kinds and vectors), closure, policy, end-span lengths.
 */
function copyValues(
  definition: SketchDefinition,
  relationship: ReturnType<typeof mirroredSession>["relationship"],
) {
  return relationship.outputs.map((output) => {
    const copy = definition.entities.find(
      (entry) => entry.entityId === output.outputEntityId,
    )!;
    return {
      points: output.outputPointIds.map(
        (pointId) =>
          definition.points.find((entry) => entry.pointId === pointId)!
            .position,
      ),
      values:
        copy.kind === "circle"
          ? { radius: copy.radius }
          : copy.kind === "arc"
            ? { sweep: copy.sweepDirection }
            : copy.kind === "spline"
              ? {
                  tangents: copy.pointOccurrences.map((entry) => entry.tangent),
                  closure: copy.closure,
                  policy: copy.interpolationPolicy,
                  endSpans: copy.endSpanParameterLengths ?? null,
                }
              : {},
    };
  });
}

describe("T15d R-1b: forward evaluations are the identity on solved or created mirror copies", () => {
  function expectIdentity(
    session: SketchSessionState,
    relationship: ReturnType<typeof mirroredSession>["relationship"],
    label: string,
  ) {
    const stored = copyValues(session.definition, relationship);
    const forward = {
      evaluation: evaluateSketchDerivations({
        definition: session.definition,
        modelingTolerance: session.modelingTolerance,
      }).definition,
      display: getSketchSessionDisplayDefinition(session),
      commit: session.commitRequest!.definition,
    };
    for (const [name, definition] of Object.entries(forward))
      expect(
        bitwise(copyValues(definition, relationship), stored),
        `${label}: ${name} keeps the stored copies bitwise`,
      ).toBe(true);
  }

  test("created by the Mirror tool", () => {
    const setup = mirroredSession("free");
    expectIdentity(setup.session, setup.relationship, "creation");
  });

  for (const intent of intents)
    test(`after a solved ${intent} drag of the copy`, () => {
      const setup = mirroredSession("free");
      const move = gesture(setup, intent);
      const { session } = drag(
        setup.session,
        move.target,
        move.from,
        move.to,
        move.options,
      );
      expect(session.definition).not.toBe(setup.session.definition);
      expectIdentity(session, setup.relationship, intent);
    });

  test("a failed mirror keeps its stored copies (no unchanged point, no re-derivation)", () => {
    const setup = mirroredSession("free");
    const withoutAxis = setup.session.definition.entities.filter(
      (candidate) => candidate.entityId !== eid("axis"),
    );
    // The copy's end moved off its reflection: a held copy keeps it.
    const ma = setup.outputOf("ab").outputPointIds[0]!;
    const definition = {
      ...setup.session.definition,
      points: setup.session.definition.points.map((entry) =>
        entry.pointId === ma
          ? { ...entry, position: [7.25, -7.5] as const }
          : entry,
      ),
      entityIds: withoutAxis.map((candidate) => candidate.entityId),
      entities: withoutAxis,
    };
    const broken = rebuildSessionForDefinition(setup.session, { definition });
    expect(broken.liveSolve?.solvedSnapshot.failedDerivationIds).toEqual([
      setup.relationship.derivationId,
    ]);
    expect(position(broken, ma)).toEqual([7.25, -7.5]);
    expectIdentity(broken, setup.relationship, "failed");
  });
});

describe("T15d R-1c: authored mutations other than a solve keep copies coherent", () => {
  test("the construction toggle of a seed writes no seed or copy value", () => {
    const setup = mirroredSession("free");
    const picking = { ...setup.session, constructionTargetPicking: true };
    const toggled = toggleSketchConstructionTarget(
      picking,
      entityRef(picking, eid("ab")),
    );
    expect(entity(toggled, eid("ab")).isConstruction).toBe(true);
    expect(
      bitwise(
        copyValues(toggled.definition, setup.relationship),
        copyValues(setup.session.definition, setup.relationship),
      ),
    ).toBe(true);
    expect(toggled.definition.points).toEqual(setup.session.definition.points);
  });

  test("a stroke style patch on a copy writes no seed or copy value", () => {
    const setup = mirroredSession("free");
    const styled = patchSketchStyleValue(
      setup.session,
      [entityRef(setup.session, setup.outputOf("ab").outputEntityId)],
      {
        intent: "patchSketchStyle",
        field: "strokeColor",
        value: "#ff0000",
      },
    );
    expect(styled.definition).not.toBe(setup.session.definition);
    expect(
      bitwise(
        copyValues(styled.definition, setup.relationship),
        copyValues(setup.session.definition, setup.relationship),
      ),
    ).toBe(true);
    expect(styled.definition.points).toEqual(setup.session.definition.points);
  });
});

// T15d review RQ-1: T-12 through a mirror of a mirror. The tangent's
// authority is the root seed: a grab converts it with the vector carried
// back through both reflections, and Reset/Zero/exact zero on the second
// copy reach all three occurrences.
describe("T15d T-12 through a mirror chain (review RQ-1)", () => {
  const isExactZero = (tangent: { kind: string; vector?: readonly number[] }) =>
    tangent.kind === "authored" &&
    tangent.vector![0] === 0 &&
    tangent.vector![1] === 0;

  test("grabbing the second copy's automatic handle makes the root seed authored with Rv1∘Rv2(visible); both copies follow", () => {
    const { session, setup, secondOutputOf } = chainSession();
    const first = setup.outputOf("s").outputEntityId;
    const second = secondOutputOf(first);
    const copy = entity(session, second.outputEntityId);
    if (copy.kind !== "spline") throw new Error("spline");
    for (const entityId of [eid("s"), first, second.outputEntityId])
      expect(occurrence(session, entityId, 0).tangent.kind).toBe("automatic");
    const reconstruction = reconstructSplineAggregate(
      copy,
      Object.fromEntries(
        session.definition.points.map((entry) => [
          entry.pointId,
          entry.position,
        ]),
      ),
    );
    if (reconstruction.validity !== "valid") throw new Error("valid copy");
    const visible = reconstruction.handles[0]!;
    const fit = position(session, second.outputPointIds[0]!);
    const grabbed = beginSketchGeometryDrag(
      session,
      handleRef(
        session,
        second.outputEntityId,
        copy.pointOccurrences[0]!.occurrenceId,
        second.outputPointIds[0]!,
      ),
      [fit[0] + visible[0], fit[1] + visible[1]],
    );
    expect(grabbed.activeDrag).not.toBeNull();
    // (u, v) on the second copy → (−u, v) on the first → (−u, −v) on the seed.
    const expected: Record<string, P> = {
      [eid("s")]: [-visible[0], -visible[1]],
      [first]: [-visible[0], visible[1]],
      [second.outputEntityId]: visible,
    };
    for (const [entityId, vector] of Object.entries(expected)) {
      const tangent = occurrence(
        grabbed,
        entityId as SketchEntityId,
        0,
      ).tangent;
      expect(tangent.kind, `${entityId} authored`).toBe("authored");
      if (tangent.kind === "authored")
        expect(distance(tangent.vector, vector), entityId).toBeLessThanOrEqual(
          1e-12,
        );
    }
    expect(cancelSketchGeometryDrag(grabbed).definition).toBe(
      session.definition,
    );
  });

  for (const intent of ["resetTangentToAutomatic", "setTangentToZero"] as const)
    test(`${intent} on the second copy reaches the root seed and both copies`, () => {
      const { session, setup, secondOutputOf } = chainSession();
      const first = setup.outputOf("s").outputEntityId;
      const second = secondOutputOf(first);
      const target = occurrence(session, second.outputEntityId, 1);
      expect(target.tangent.kind, "premise: authored through the chain").toBe(
        "authored",
      );
      const next = applyTangentAction(
        session,
        [
          handleRef(
            session,
            second.outputEntityId,
            target.occurrenceId,
            second.outputPointIds[1]!,
          ),
        ],
        intent,
      );
      for (const entityId of [eid("s"), first, second.outputEntityId]) {
        const tangent = occurrence(next, entityId, 1).tangent;
        if (intent === "resetTangentToAutomatic")
          expect(tangent.kind, entityId).toBe("automatic");
        else expect(isExactZero(tangent), `${entityId} exact zero`).toBe(true);
      }
    });

  test("exact-zero capture on the second copy's handle is exact on all three occurrences", () => {
    const { session, setup, secondOutputOf } = chainSession();
    const first = setup.outputOf("s").outputEntityId;
    const second = secondOutputOf(first);
    const target = occurrence(session, second.outputEntityId, 1);
    if (target.tangent.kind !== "authored") throw new Error("authored");
    const fit = position(session, second.outputPointIds[1]!);
    const { started, session: done } = drag(
      session,
      handleRef(
        session,
        second.outputEntityId,
        target.occurrenceId,
        second.outputPointIds[1]!,
      ),
      [fit[0] + target.tangent.vector[0], fit[1] + target.tangent.vector[1]],
      fit,
      { exactZero: true },
    );
    expect(started).toBe(true);
    for (const entityId of [eid("s"), first, second.outputEntityId])
      expect(
        isExactZero(occurrence(done, entityId, 1).tangent),
        `${entityId} exact zero`,
      ).toBe(true);
  });
});

// T16b ([TECH] T16-5, plan review R-4/R-5; logic lane, seam: the owner's
// failure as carried by the session's live solve and shown as its
// validation message). One message per failed relationship, by label
// (never its id), reason-specific, naming only recovery commands that exist
// (Undo; for a mirror, removal from the Mirror panel; T16e (review R-5):
// replacing the mirror line or the original where that repairs it). Codes
// unchanged.
describe("T16b: failure messages name the relationship by label, say why and how to recover", () => {
  const MIRROR_TAIL =
    " Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, or remove the mirror from the Mirror panel.";
  const LINE_TAIL =
    " Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the mirror line, or remove the mirror from the Mirror panel.";
  const ORIGINAL_TAIL =
    " Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the original, or remove the mirror from the Mirror panel.";
  // T16e review A-7: replacing the looping line or original breaks a loop.
  const LOOP_TAIL =
    " Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the mirror line or the original, or remove the mirror from the Mirror panel.";
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
  const rebuild = (session: SketchSessionState, definition: SketchDefinition) =>
    rebuildSessionForDefinition(session, { definition });
  const without = (session: SketchSessionState, ids: readonly string[]) => {
    const entities = session.definition.entities.filter(
      (candidate) => !ids.includes(candidate.entityId),
    );
    return rebuild(session, {
      ...session.definition,
      entityIds: entities.map((candidate) => candidate.entityId),
      entities,
    });
  };
  /** The live solve's derived-failure errors, as [code, message]. */
  const failures = (session: SketchSessionState) =>
    session
      .liveSolve!.solvedSnapshot.diagnostics.filter((diagnostic) =>
        diagnostic.code.startsWith("derived-"),
      )
      .map((diagnostic) => [diagnostic.code, diagnostic.message]);

  test("every mirror failure reason: one message, the exact label-based text, no id, shown as the validation message", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const label = relationship.label;
    const copyLine = outputOf("ab").outputEntityId;
    const cases: [string, SketchSessionState, string, string, string][] = [
      [
        "axis missing",
        without(session, [eid("axis")]),
        "derived-mirror-axis-missing",
        `Mirror ‘${label}’ is broken: its mirror line was deleted.`,
        LINE_TAIL,
      ],
      [
        "axis degenerate",
        rebuild(session, {
          ...session.definition,
          points: session.definition.points.map((point) =>
            point.pointId === pid("x1")
              ? { ...point, position: [-2, 0] }
              : point,
          ),
        }),
        "derived-mirror-axis-degenerate",
        `Mirror ‘${label}’ is broken: its mirror line is shorter than the modeling tolerance.`,
        LINE_TAIL,
      ],
      [
        "seed missing",
        without(session, [eid("c")]),
        "derived-mirror-map-stale",
        `Mirror ‘${label}’ is broken: the original of ‘c mirror’ was deleted.`,
        ORIGINAL_TAIL,
      ],
      [
        "copy missing",
        without(session, [outputOf("c").outputEntityId]),
        "derived-mirror-map-stale",
        `Mirror ‘${label}’ is broken: a copy of ‘c’ was deleted.`,
        MIRROR_TAIL,
      ],
      [
        "geometry mismatch",
        rebuild(session, {
          ...session.definition,
          entities: session.definition.entities.map((candidate) =>
            candidate.entityId === copyLine && candidate.kind === "lineSegment"
              ? { ...candidate, endPointId: pid("u") }
              : candidate,
          ),
        }),
        "derived-mirror-map-stale",
        `Mirror ‘${label}’ is broken: its geometry no longer matches (copy ‘ab mirror’ of ‘ab’).`,
        MIRROR_TAIL,
      ],
      [
        "dependency loop",
        rebuild(session, {
          ...session.definition,
          derivedRelationships: [
            {
              ...relationship,
              mirrorReference: { kind: "lineEntity", entityId: copyLine },
            },
          ],
        }),
        "derived-relationship-dependency-unresolved",
        `Mirror ‘${label}’ depends on its own copies (a dependency loop).`,
        LOOP_TAIL,
      ],
    ];
    for (const [reason, broken, code, statement, tail] of cases) {
      const message = statement + tail;
      expect(failures(broken), reason).toEqual([[code, message]]);
      expect(message, `${reason}: no id`).not.toContain(
        relationship.derivationId,
      );
      expect(message, `${reason}: no UUID`).not.toMatch(UUID);
      expect(broken.validationMessage, reason).toBe(message);
    }
  });

  test("a chain: the mirror on the loop and the one downstream of it each get their own message", () => {
    const { session, setup, second } = chainSession();
    const firstCopyLine = setup.outputOf("ab").outputEntityId;
    const broken = rebuild(session, {
      ...session.definition,
      derivedRelationships: session.definition.derivedRelationships!.map(
        (candidate) =>
          candidate.derivationId === setup.relationship.derivationId
            ? {
                ...candidate,
                mirrorReference: {
                  kind: "lineEntity" as const,
                  entityId: firstCopyLine,
                },
              }
            : candidate,
      ),
    });
    expect(failures(broken)).toEqual([
      [
        "derived-relationship-dependency-unresolved",
        `Mirror ‘${setup.relationship.label}’ depends on its own copies (a dependency loop).${LOOP_TAIL}`,
      ],
      [
        "derived-relationship-dependency-unresolved",
        `Mirror ‘${second.label}’ depends on geometry made in a dependency loop.${MIRROR_TAIL}`,
      ],
    ]);
  });

  test("other kinds take their own noun and only Undo (no removal command exists for them); an offset's stays relationship-scoped", () => {
    const { session, outputOf } = mirroredSession("free");
    const pattern = withDerived(session, "linearPattern", [eid("u")], 91, 3);
    const offset = withDerived(
      pattern.session,
      "offset",
      [outputOf("ab").outputEntityId],
      92,
      0.5,
    );
    const selfReading = (
      relationship: SketchDerivationDefinition,
    ): SketchDerivationDefinition =>
      ({
        ...relationship,
        seedEntityIds: [relationship.outputs[0]!.outputEntityId],
        outputs: relationship.outputs.map((output, index) =>
          index === 0
            ? { ...output, seedEntityId: output.outputEntityId }
            : output,
        ),
      }) as SketchDerivationDefinition;
    const definition = {
      ...offset.session.definition,
      derivedRelationships: offset.session.definition.derivedRelationships!.map(
        (candidate) =>
          candidate.derivationId === pattern.relationship.derivationId ||
          candidate.derivationId === offset.relationship.derivationId
            ? selfReading(candidate)
            : candidate,
      ),
    };
    const evaluation = evaluateSketchDerivations({
      definition,
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    });
    expect(
      evaluation.derivedFailures.map((failure) => failure.diagnostic.message),
    ).toEqual([
      `Linear pattern ‘${pattern.relationship.label}’ depends on its own copies (a dependency loop). Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo to recover.`,
    ]);
    expect(
      evaluation.offsetFailures.map((failure) => failure.diagnostic.message),
    ).toEqual([
      `Offset ‘${offset.relationship.label}’ depends on its own offset curves (a dependency loop). Its offset curves stay where they were last solved and can't be used. Undo to recover.`,
    ]);
  });
});

// T16c ([TECH] T16-7, review A-4; logic lane). Geometry held by a broken
// relationship is worded by label at every non-acceptance site, with the
// kind-neutral code where the site is reachable (edit input, vector
// export); offset owners keep the offset text and code (pinned by the
// offset rows in `sketch-offset-live-cutover.spec.ts`). Seams: the session's
// edit tools, the export model and the mock adapter on a committed
// document, the publication helper, and the feature-input / projection
// text helpers by owner kind.
describe("T16c: a broken relationship's copies are named by label at every non-acceptance site", () => {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
  // T16e (review R-5): these rows' mirror lost its mirror line, so the text
  // names replacing it.
  const MIRROR_RECOVERY =
    "Fix it (Undo or replace the mirror line) or remove the mirror from the Mirror panel.";
  /** Every user text of these rows: exact, and neither an id nor a UUID. */
  const expectNoIds = (
    session: SketchSessionState,
    messages: readonly (string | null | undefined)[],
  ) => {
    const ids = [
      ...session.definition.entities.map((entity) => entity.entityId),
      ...session.definition.points.map((point) => point.pointId),
      ...(session.definition.derivedRelationships ?? []).map(
        (relationship) => relationship.derivationId,
      ),
    ];
    for (const message of messages) {
      expect(message, "a message").toEqual(expect.any(String));
      expect(message, `${message}: no UUID`).not.toMatch(UUID);
      for (const id of ids)
        expect(message!.includes(id), `${message}: names ${id}`).toBe(false);
    }
  };
  /** A free line x = 2 crossing the first copy `ab mirror` (y = −1.5) and the axis. */
  const withFreeLine = (session: SketchSessionState) => {
    const definition = session.definition;
    const point = (id: string, position: P) => ({
      pointId: pid(id),
      label: id,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_draft",
        pointId: pid(id),
      },
      position: [position[0], position[1]],
      isConstruction: false,
    });
    const points = [
      ...definition.points,
      point("f0", [2, -3]),
      point("f1", [2, 0.5]),
    ] as SketchDefinition["points"];
    const free = {
      kind: "lineSegment",
      entityId: eid("free"),
      label: "free",
      target: entityTarget("free"),
      isConstruction: false,
      startPointId: pid("f0"),
      endPointId: pid("f1"),
    } as SketchDefinition["entities"][number];
    return rebuildSessionForDefinition(session, {
      definition: {
        ...definition,
        pointIds: points.map((entry) => entry.pointId),
        points,
        entityIds: [...definition.entityIds, free.entityId],
        entities: [...definition.entities, free],
      },
    });
  };
  const deleteAxis = (session: SketchSessionState) =>
    deleteSelectedSketchGeometry(session, [entityRef(session, eid("axis"))]);
  /** Begins `toolId`, picks `entityIds` in order, sets `value` and commits. */
  const runEditTool = (
    session: SketchSessionState,
    toolId: Parameters<typeof beginSketchTool>[1],
    entityIds: readonly SketchEntityId[],
    value: number | null,
  ) => {
    let next = beginSketchTool(session, toolId);
    for (const entityId of entityIds)
      next = selectSketchEditToolTarget(next, {
        kind: "sketchEntity",
        sketchId: next.sketchId!,
        entityId,
      } as never);
    if (next.definition !== session.definition) return next;
    if (toolId === "offset") {
      next = patchSketchEditToolValue(next, { value });
      return patchSketchEditToolValue(next, { intent: "commitOffset" });
    }
    if (value !== null) next = patchSketchEditToolValue(next, { value });
    // T16d: the Mirror tool's confirm is its own intent.
    return patchSketchEditToolValue(next, {
      intent:
        toolId === "sketchMirror" ? "createMirror" : "commitSketchEditOperator",
    });
  };
  /** The mirror's axis deleted, with a free line and a pattern of the first copy. */
  function brokenMirror() {
    const { session, relationship, outputOf } = mirroredSession("free");
    const copy = outputOf("ab").outputEntityId;
    const pattern = withDerived(session, "linearPattern", [copy], 91, 2);
    const broken = deleteAxis(withFreeLine(pattern.session));
    expect(
      broken.liveSolve!.solvedSnapshot.failedDerivationIds,
      "premise: the mirror is held",
    ).toEqual([relationship.derivationId]);
    return {
      broken,
      relationship,
      outputOf,
      copy,
      patternCopy: pattern.relationship.outputs[0]!.outputEntityId,
    };
  }
  /** A real Finish of `definition` into a fresh mock document. */
  async function committed(definition: SketchDefinition) {
    const adapter = new MockKernelAdapter();
    const request = {
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    } as const;
    const before = await adapter.getDocumentSnapshot(request);
    const commit = await adapter.commitSketch({
      ...request,
      baseRevisionId: before.snapshot.document.revisionId,
      solverCorrelation: {
        requestId: "request_t16c",
        projectionRequestId: "request_t16c:project",
        validationRequestId: "request_t16c:validate",
        solveRequestId: "request_t16c:solve",
        regionRequestId: "request_t16c:regions",
      },
      sketchId: null,
      sketchLabel: "Broken mirror",
      plane: before.snapshot.document.sketches[0]!.plane,
      definition,
    });
    expect(commit.revisionState.kind, "premise: Finish accepted").toBe(
      "accepted",
    );
    const { snapshot } = await adapter.getDocumentSnapshot(request);
    const record = snapshot.document.sketches.find(
      (entry) => entry.sketchId === commit.sketchId,
    )!;
    return { adapter, request, snapshot, record };
  }

  test("edit input (red on base: offset text with ids): Offset, Mirror, Split and Fillet refuse the held copy, or a copy made from it, with edit-input-derived-failed and the mirror by label; nothing is authored", () => {
    const { broken, copy, patternCopy } = brokenMirror();
    const held = (subject: string, use: string) =>
      `edit-input-derived-failed: ${subject}, which is broken, so it can't be used as ${use}. ${MIRROR_RECOVERY}`;
    const copyOf = "‘ab mirror’ is a copy made by mirror ‘mirror 1’";
    const rows: [
      Parameters<typeof beginSketchTool>[1],
      SketchEntityId[],
      number | null,
      string,
    ][] = [
      ["offset", [copy], 0.1, held(copyOf, "an offset seed")],
      [
        "sketchMirror",
        [copy, eid("free")],
        null,
        held(copyOf, "a Sketch Mirror input"),
      ],
      // The copy as Split's boundary (as the target, T16a's participant
      // refusal comes first).
      [
        "sketchSplit",
        [eid("free"), copy],
        null,
        held(copyOf, "a Sketch Split input"),
      ],
      // A pattern copy of the held copy (G16‴ closure: owned by the mirror;
      // not a mirror participant, so no T16a refusal).
      [
        "sketchFillet",
        [patternCopy, eid("free")],
        0.1,
        held(
          "‘ab mirror linearPattern’ depends on mirror ‘mirror 1’",
          "a Sketch Fillet input",
        ),
      ],
    ];
    const messages = rows.map(([toolId, inputs, value, expected]) => {
      const result = runEditTool(broken, toolId, inputs, value);
      expect(result.validationMessage, toolId).toBe(expected);
      expect(result.definition, `${toolId} authors nothing`).toBe(
        broken.definition,
      );
      return result.validationMessage;
    });
    expectNoIds(broken, messages);
  });

  // T17d (B3, [TECH] A-5) supersedes the T16c per-copy export texts: the
  // sketch-wide gate refuses the whole sketch (the held copies' solved
  // snapshot is not current), with the mirror's own label-based message.
  test("vector export after Finish (red on base: sketch-vector-uncertified-offset with ids; T17d: the whole sketch is refused by the sketch-wide gate with sketch-vector-derived-failed and the mirror by label)", async () => {
    const { broken, relationship } = brokenMirror();
    const { snapshot, record } = await committed(broken.definition);
    expect(
      record.sketch.solvedSnapshot.failedDerivationIds,
      "premise: the saved record holds the mirror",
    ).toEqual([relationship.derivationId]);
    const exported = buildSketchVectorExportModelFromSnapshot(snapshot, {
      kind: "sketch",
      sketchId: record.sketchId,
    } as never);
    const expected =
      "Sketch ‘Broken mirror’ was not exported because it is invalid. Mirror ‘mirror 1’ is broken: its mirror line was deleted. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the mirror line, or remove the mirror from the Mirror panel.";
    expect(exported).toEqual({
      diagnostic: {
        code: "sketch-vector-derived-failed",
        severity: "error",
        message: expected,
        target: { kind: "sketch", sketchId: record.sketchId },
      },
    });
    expectNoIds(broken, [expected]);
  });

  test("mock feature pre-check order: a feature on a held copy is refused for the non-current sketch first, before the feature-input check (whose text names the mirror by label)", async () => {
    const { broken, copy } = brokenMirror();
    const { adapter, request, record } = await committed(broken.definition);
    expect(record.sketch.derivedValidity.state, "premise").toBe("invalid");
    const baseRevisionId = (await adapter.getDocumentSnapshot(request)).snapshot
      .document.revisionId;
    const response = await adapter.createFeature({
      ...request,
      baseRevisionId,
      definition: {
        kind: "extrude",
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          resultBodyType: "surface",
          profiles: [
            {
              kind: "sketchEntity",
              sketchId: record.sketchId,
              entityId: copy,
            },
          ],
          startExtent: { kind: "profilePlane" },
          extent: {
            mode: "oneSide",
            end: { kind: "blind", direction: "positive", distance: 2 },
          },
        },
      },
    } as never);
    expect(response.revisionState).toEqual({
      kind: "rejected",
      baseRevisionId,
      reasonCode: "mock-invalid-extrude",
    });
    expect(
      response.diagnostics.map((diagnostic) => [
        diagnostic.code,
        diagnostic.message,
      ]),
    ).toEqual([
      [
        "mock-invalid-extrude",
        "Features can consume sketch-derived inputs only when their owning sketch has current derived validity.",
      ],
    ]);
    // Had the order been the other way, this is the text it would show.
    expect(
      nonAcceptedOffsetFeatureInputMessage(record.sketch, copy, "a profile"),
    ).toBe(
      `‘ab mirror’ is a copy made by mirror ‘mirror 1’, which is broken, so it can't be used as a profile. ${MIRROR_RECOVERY}`,
    );
  });

  test("offset publication: an offset of a held copy is never published (the failed mirror's error makes the solve unaccepted); with that error forged away it fails derived-offset-seed-not-certified naming the mirror by label", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const copy = outputOf("ab").outputEntityId;
    const offset = withDerived(session, "offset", [copy], 92, 0.5);
    const capabilities = {
      query: createCertifiedNeutralCurveRequestQuery(),
      certifier: createCertifiedCubicTubeChain(),
    };
    // Reachability: the session's live solve with the axis deleted.
    const broken = deleteAxis(offset.session).liveSolve!;
    expect(broken.solvedSnapshot.failedDerivationIds).toEqual([
      relationship.derivationId,
    ]);
    expect(isOffsetPublicationSolveAccepted(broken.solvedSnapshot)).toBe(false);
    expect(
      publishSketchOffsets({
        definition: broken.definition,
        solvedSnapshot: broken.solvedSnapshot,
        modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
        capabilities,
      }),
      "nothing is published",
    ).toEqual([]);
    // The text path: the healthy solve, with the mirror forged failed and no
    // error (an invariant the snapshot validator enforces).
    const healthy = offset.session.liveSolve!;
    const publications = publishSketchOffsets({
      definition: healthy.definition,
      // T17d (B4): the reason travels with the failure, so it is forged too.
      solvedSnapshot: {
        ...healthy.solvedSnapshot,
        failedDerivationIds: [relationship.derivationId],
        failedDerivationReasons: {
          [relationship.derivationId]: ["axisMissing"],
        },
      },
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
      capabilities,
    });
    const message = `‘ab mirror’ is a copy made by mirror ‘mirror 1’, which is broken, so offset ‘${offset.relationship.label}’ can't be certified either. ${MIRROR_RECOVERY}`;
    expect(publications).toEqual([
      {
        derivationId: offset.relationship.derivationId,
        status: "failed",
        diagnostic: {
          code: "derived-offset-seed-not-certified",
          severity: "error",
          message,
          target: { kind: "entity", entityId: copy },
        },
      },
    ]);
    expectNoIds(offset.session, [message]);
    // Control: unforged, the offset certifies.
    expect(
      publishSketchOffsets({
        definition: healthy.definition,
        solvedSnapshot: healthy.solvedSnapshot,
        modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
        capabilities,
      }).map((publication) => publication.status),
    ).toEqual(["certified"]);
  });

  test("feature-input and projection text helpers by owner kind: a mirror's copy and driven point, a solved pattern loop (in the gate, A-3), an offset's output (offset text unchanged)", () => {
    const { broken, outputOf, copy } = brokenMirror();
    const live = broken.liveSolve!;
    const sketch = {
      definition: live.definition,
      solvedSnapshot: live.solvedSnapshot,
    };
    const mirrorPoint = outputOf("ab").outputPointIds[0]!;
    const owner = nonAcceptedDerivedOutputs(
      live.definition,
      live.solvedSnapshot,
    ).get(copy)!;
    const mirrorTexts = [
      nonAcceptedOffsetFeatureInputMessage(sketch, copy, "a revolve axis"),
      nonAcceptedOffsetFeaturePointMessage(
        sketch,
        mirrorPoint,
        "a hole location",
      ),
      nonAcceptedOutputProjectionMessage(live.definition, copy, owner),
    ];
    expect(mirrorTexts).toEqual([
      `‘ab mirror’ is a copy made by mirror ‘mirror 1’, which is broken, so it can't be used as a revolve axis. ${MIRROR_RECOVERY}`,
      `Point ‘mirror a’ belongs to a copy made by mirror ‘mirror 1’, which is broken, so it can't be used as a hole location. ${MIRROR_RECOVERY}`,
      `‘ab mirror’ is a copy made by mirror ‘mirror 1’, which is broken, so it is not projected. ${MIRROR_RECOVERY}`,
    ]);
    expectNoIds(broken, mirrorTexts);

    // A linear pattern whose first copy reads itself: unresolved, solved
    // into the gate (T16b review A-3), worded with its own noun and Undo.
    const { session } = mirroredSession("free");
    const pattern = withDerived(session, "linearPattern", [eid("u")], 91, 3);
    const loop = rebuildSessionForDefinition(pattern.session, {
      definition: {
        ...pattern.session.definition,
        derivedRelationships:
          pattern.session.definition.derivedRelationships!.map((candidate) =>
            candidate.derivationId === pattern.relationship.derivationId
              ? ({
                  ...candidate,
                  seedEntityIds: [candidate.outputs[0]!.outputEntityId],
                  outputs: candidate.outputs.map((output, index) =>
                    index === 0
                      ? { ...output, seedEntityId: output.outputEntityId }
                      : output,
                  ),
                } as SketchDerivationDefinition)
              : candidate,
          ),
      },
    });
    const loopSolve = loop.liveSolve!.solvedSnapshot;
    expect(loopSolve.failedDerivationIds, "the loop is in the gate").toEqual([
      pattern.relationship.derivationId,
    ]);
    expect(loop.liveRegions.status).toBe("unavailable");
    const patternCopy = pattern.relationship.outputs[0]!.outputEntityId;
    const patternOwner = nonAcceptedDerivedOutputs(
      loop.liveSolve!.definition,
      loopSolve,
    ).get(patternCopy)!;
    expect(patternOwner).toEqual({
      derivationId: pattern.relationship.derivationId,
      kind: "linearPattern",
      label: pattern.relationship.label,
      reason: "derivedFailed",
      // T17d (B4): the solve's reason, carried.
      failureReasons: ["dependencyLoop"],
    });
    const patternText = nonAcceptedOutputProjectionMessage(
      loop.liveSolve!.definition,
      patternCopy,
      patternOwner,
    );
    expect(patternText).toBe(
      `‘u linearPattern’ is a copy made by linear pattern ‘${pattern.relationship.label}’, which is broken, so it is not projected. Fix it (Undo).`,
    );
    expectNoIds(loop, [patternText]);

    // An offset owner gets the offset text (T17e: by label).
    const offsetOwner = {
      derivationId: "derivation_offset",
      kind: "offset",
      label: "offset",
      reason: "offsetNotCertified",
    } as const;
    expect(
      nonAcceptedOutputProjectionMessage(live.definition, copy, offsetOwner),
    ).toBe(
      // T17e (B2): an offset owner is worded by label too, never by id (no
      // offset relationship exists here, so the copy depends on it).
      "‘ab mirror’ depends on offset ‘offset’, which is not certified, so it is not projected. Fix it (Undo) or remove the offset from the Offset panel.",
    );
    expectNoIds(broken, [
      nonAcceptedOutputProjectionMessage(live.definition, copy, offsetOwner),
    ]);
  });

  test("region arrangement input (T16b review A-7): the held copies are excluded naming the broken mirror by label", () => {
    const { broken, relationship, patternCopy } = brokenMirror();
    const live = broken.liveSolve!;
    const excluded =
      offsetArrangementInput(live.definition, live.solvedSnapshot, [])
        .unpublishedOffsetOutputs ?? [];
    const reason = "mirror ‘mirror 1’ is broken (its copies are held)";
    expect(excluded).toEqual(
      [
        ...relationship.outputs.map((output) => output.outputEntityId),
        patternCopy,
      ].map((entityId) => ({
        entityId,
        derivationId: relationship.derivationId,
        reason,
      })),
    );
    expectNoIds(broken, [reason]);
  });

  test("derived-transform texts name the pattern by label; with a mirror and a pattern of one seed both broken, the validation message is the first error (the pattern's) and the Mirror panel still lists the broken mirror", () => {
    const { session, relationship } = mirroredSession("free");
    const pattern = withDerived(session, "linearPattern", [eid("ab")], 91, 3);
    const patternCopyLabel = pattern.session.definition.entities.find(
      (entity) =>
        entity.entityId === pattern.relationship.outputs[0]!.outputEntityId,
    )!.label;
    expect(patternCopyLabel, "premise").toBe("ab linearPattern");
    const seedDeleted = deleteSelectedSketchGeometry(pattern.session, [
      entityRef(pattern.session, eid("ab")),
    ]);
    const patternText = `Linear pattern ‘${pattern.relationship.label}’ is broken: the original of ‘ab linearPattern’ was deleted. Profiles from this sketch are blocked. Undo to recover.`;
    const mirrorText =
      "Mirror ‘mirror 1’ is broken: the original of ‘ab mirror’ was deleted. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the original, or remove the mirror from the Mirror panel.";
    expect(
      seedDeleted
        .liveSolve!.solvedSnapshot.diagnostics.filter(
          (diagnostic) => diagnostic.severity === "error",
        )
        .map((diagnostic) => [diagnostic.code, diagnostic.message]),
    ).toEqual([
      ["derived-transform-missing-seed", patternText],
      ["derived-mirror-map-stale", mirrorText],
    ]);
    expect(seedDeleted.validationMessage).toBe(patternText);
    expect(
      computeSketchMirrorActionState(seedDeleted, [])!.entries.map((entry) => [
        entry.derivationId,
        entry.brokenReason !== null,
      ]),
      "the broken mirror stays listed (and explained) in the Mirror panel",
    ).toEqual([[relationship.derivationId, true]]);

    // A deleted pattern copy, and a copy whose point map no longer matches.
    const copyId = pattern.relationship.outputs[0]!.outputEntityId;
    const copyDeleted = deleteSelectedSketchGeometry(pattern.session, [
      entityRef(pattern.session, copyId),
    ]);
    const mismatched = rebuildSessionForDefinition(pattern.session, {
      definition: {
        ...pattern.session.definition,
        derivedRelationships:
          pattern.session.definition.derivedRelationships!.map((candidate) =>
            candidate.derivationId === pattern.relationship.derivationId
              ? ({
                  ...candidate,
                  outputs: candidate.outputs.map((output) => ({
                    ...output,
                    outputPointIds: output.outputPointIds.slice(1),
                  })),
                } as SketchDerivationDefinition)
              : candidate,
          ),
      },
    });
    const texts = [copyDeleted.validationMessage, mismatched.validationMessage];
    const mismatchText = `Linear pattern ‘${pattern.relationship.label}’ is broken: its geometry no longer matches (copy ‘ab linearPattern’ of ‘ab’). Profiles from this sketch are blocked. Undo to recover.`;
    expect(texts).toEqual([
      `Linear pattern ‘${pattern.relationship.label}’ is broken: a copy of ‘ab’ was deleted. Profiles from this sketch are blocked. Undo to recover.`,
      mismatchText,
    ]);
    // Review R-1: a point map naming a missing output point (same lengths,
    // so the per-point `derived-transform-unsatisfied-point-map` branch).
    const unresolved = rebuildSessionForDefinition(pattern.session, {
      definition: {
        ...pattern.session.definition,
        derivedRelationships:
          pattern.session.definition.derivedRelationships!.map((candidate) =>
            candidate.derivationId === pattern.relationship.derivationId
              ? ({
                  ...candidate,
                  outputs: candidate.outputs.map((output) => ({
                    ...output,
                    outputPointIds: [
                      "sketch_point_missing" as SketchPointId,
                      ...output.outputPointIds.slice(1),
                    ],
                  })),
                } as SketchDerivationDefinition)
              : candidate,
          ),
      },
    });
    expect(
      unresolved
        .liveSolve!.solvedSnapshot.diagnostics.filter(
          (diagnostic) => diagnostic.severity === "error",
        )
        .map((diagnostic) => [diagnostic.code, diagnostic.message]),
    ).toEqual([["derived-transform-unsatisfied-point-map", mismatchText]]);
    expect(unresolved.validationMessage).toBe(mismatchText);
    expectNoIds(pattern.session, [
      patternText,
      mirrorText,
      ...texts,
      unresolved.validationMessage,
    ]);
  });
});

// T16d ([TECH] T16-8/T16-21, review R-1/A-2/A-11). Logic lane; seam: the
// sketch session's Mirror tool (`selectSketchEditToolTarget`,
// `updateSketchEditToolHover`, `patchSketchEditToolValue`) and the workbench
// Enter/Escape routes (`getEnterEvent`, `getEscapeEvent`). Every pick
// re-stages the preview (the last line or datum is the axis candidate, the
// earlier picks are seeds); only Confirm or Enter authors the mirror.
describe("T16d: Mirror creation preview, cancel and confirm", () => {
  type Draft = SketchSessionState["toolStagedEntities"][number];
  const datum = (datumId: "xAxis" | "yAxis") =>
    ({
      kind: "sketchDatumReference",
      sketchId: "sketch_draft",
      datumId,
      geometryKind: "lineSegment",
    }) as never;
  /**
   * The fixture's seeds plus a free line `de` (d (4, 6) → e (5, 8)) and,
   * with `tiny`, a line shorter than τ (which makes the sketch invalid).
   */
  function baseSession(tiny = false) {
    const definition = seedDefinition();
    const a = definition.points.find((entry) => entry.pointId === pid("a"))!;
    const ab = definition.entities.find(
      (entry) => entry.entityId === eid("ab"),
    )!;
    const at = (id: string, position: P) => ({
      ...a,
      pointId: pid(id),
      label: id,
      target: { ...a.target, pointId: pid(id) },
      position: [position[0], position[1]] as [number, number],
    });
    const lineOf = (id: string, start: string, end: string) => ({
      ...ab,
      entityId: eid(id),
      label: id,
      target: entityTarget(id),
      startPointId: pid(start),
      endPointId: pid(end),
    });
    const points = [
      at("d", [4, 6]),
      at("e", [5, 8]),
      ...(tiny ? [at("t0", [30, 9]), at("t1", [30.0005, 9])] : []),
    ];
    const entities = [
      lineOf("de", "d", "e"),
      ...(tiny ? [lineOf("tiny", "t0", "t1")] : []),
    ];
    return rebuildSessionForDefinition(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      {
        definition: {
          ...definition,
          pointIds: [
            ...definition.pointIds,
            ...points.map((entry) => entry.pointId),
          ],
          points: [...definition.points, ...points],
          entityIds: [
            ...definition.entityIds,
            ...entities.map((entry) => entry.entityId),
          ],
          entities: [...definition.entities, ...entities],
        } as SketchDefinition,
      },
    );
  }
  /** The Mirror tool armed on `base`, then each pick in order (sessions after each pick). */
  function picks(base: SketchSessionState, ...targets: unknown[]) {
    const sessions: SketchSessionState[] = [];
    let session = beginSketchTool(base, "sketchMirror");
    for (const target of targets) {
      session = selectSketchEditToolTarget(session, target as never);
      sessions.push(session);
    }
    return sessions;
  }
  const popup = (session: SketchSessionState) =>
    session.toolPresentation?.floatingInput ?? null;
  const prompt = (session: SketchSessionState) =>
    session.toolPresentation?.prompts[0]?.text;
  const enter = (session: SketchSessionState) =>
    getEnterEvent({ sketchSession: session });
  const escape = (session: SketchSessionState) =>
    getEscapeEvent({
      activeCommand: null,
      activeReferencePickerFieldId: null,
      selection: [],
      sketchSession: session,
    });
  const confirm = (session: SketchSessionState) =>
    patchSketchEditToolValue(session, { intent: "createMirror" });
  const mirrors = (session: SketchSessionState) =>
    (session.definition.derivedRelationships ?? []).filter(
      (relationship) => relationship.kind === "mirror",
    );
  /** Reflection of `point` about the line through `a` and `b`. */
  const reflectAbout = (point: P, a: P, b: P): P => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const;
    const along = (point[0] - a[0]) * u[0] + (point[1] - a[1]) * u[1];
    return [
      2 * (a[0] + along * u[0]) - point[0],
      2 * (a[1] + along * u[1]) - point[1],
    ];
  };
  const expectNear = (actual: P, expected: P, message: string) =>
    expect(distance(actual, expected), message).toBeLessThan(1e-9);
  /** The staged draft's defining points (circle: centre; line: ends). */
  const draftPoints = (draft: Draft): P[] =>
    draft.kind === "circle"
      ? [draft.center as P]
      : draft.kind === "line"
        ? [draft.start as P, draft.end as P]
        : [];
  const readyPopup = (readout: string) => ({
    id: "sketch-mirror-confirm",
    label: "Mirror",
    value: null,
    readout,
    confirmOnly: true,
    confirmLabel: "Mirror",
    cancelLabel: "Cancel",
    placement: "target",
    anchor: expect.objectContaining({
      kind: "sketchPoint",
      offset: { x: -110, y: 140 },
    }),
    submitAction: { type: "patch", patch: { intent: "createMirror" } },
    cancelAction: {
      type: "patch",
      patch: { intent: "cancelSketchEditOperator" },
    },
  });
  /** Nothing staged or offered: the refusal text, no popup, Enter and Confirm author nothing. */
  function expectRefusedAtPreview(
    base: SketchSessionState,
    session: SketchSessionState,
    message: string,
  ) {
    expect(session.validationMessage).toBe(message);
    expect(session.definition, "nothing authored").toBe(base.definition);
    expect(session.toolStagedEntities, "nothing staged").toEqual([]);
    expect(popup(session), "no confirm popup").toBeNull();
    expect(isSketchMirrorReady(session)).toBe(false);
    expect(enter(session), "Enter is not consumed").toBeNull();
    const confirmed = confirm(session);
    expect(confirmed.definition, "Confirm authors nothing").toBe(
      base.definition,
    );
    expect(confirmed.validationMessage).toBe(message);
  }

  test("R-1 [circle, line, axis] (red on base: the line pick committed 'circle about line'): every pick re-stages, nothing is authored before Confirm; Confirm is one mirror of both seeds; the tool stays armed", () => {
    const base = baseSession();
    const [first, second, third] = picks(
      base,
      entityTarget("c"),
      entityTarget("ab"),
      entityTarget("axis"),
    );
    for (const [label, session] of [
      ["circle", first!],
      ["circle, line", second!],
      ["circle, line, axis", third!],
    ] as const)
      expect(session.definition, `${label}: nothing authored`).toBe(
        base.definition,
      );
    expect(first!.toolStagedEntities).toEqual([]);
    expect(popup(first!)).toBeNull();

    // The line is the axis candidate: the circle's copy about ab is staged.
    expect(second!.validationMessage).toBeNull();
    expect(second!.toolStagedEntities.map((draft) => draft.kind)).toEqual([
      "circle",
    ]);
    expectNear(
      draftPoints(second!.toolStagedEntities[0]!)[0]!,
      reflectAbout([6, 3], [1, 1], [3, 2]),
      "the copy of c about ab",
    );
    expect(popup(second!)).toEqual(readyPopup("1 shape about ‘ab’"));
    expect(prompt(second!)).toBe(
      "Mirror 1 shape about ‘ab’ — Enter or Mirror to confirm",
    );
    expect(enter(second!)).toEqual({
      type: "sketch.toolPatched",
      patch: { intent: "createMirror" },
    });

    // The axis pick re-stages: ab is now a seed, the axis the candidate.
    expect(third!.toolStagedEntities.map((draft) => draft.kind)).toEqual([
      "circle",
      "line",
    ]);
    expect(third!.toolStagedEntities.flatMap(draftPoints)).toEqual([
      reflect([6, 3]),
      reflect([1, 1]),
      reflect([3, 2]),
    ]);
    expect(popup(third!)).toEqual(readyPopup("2 shapes about ‘axis’"));
    // Review A-11: below every curve (lowest: the circle copy, y = −4) and
    // centred under the copies (x 1…7), growing down from there.
    expect(popup(third!)!.anchor).toEqual({
      kind: "sketchPoint",
      point: [4, -4],
      offset: { x: -110, y: 140 },
    });
    // Hovering keeps the staged popup (the tool is still collecting picks).
    expect(
      popup(updateSketchEditToolHover(third!, entityTarget("u"))),
      "a hover keeps the popup",
    ).toEqual(popup(third!));

    const done = confirm(third!);
    expect(mirrors(done)).toHaveLength(1);
    const [mirror] = mirrors(done);
    if (mirror?.kind !== "mirror") throw new Error("mirror");
    expect(mirror.seedEntityIds).toEqual([eid("c"), eid("ab")]);
    expect(mirror.mirrorReference).toEqual({
      kind: "lineEntity",
      entityId: eid("axis"),
    });
    // The committed copies are the staged preview.
    const copyPoints = mirror.outputs.flatMap((output) => {
      const copy = entity(done, output.outputEntityId);
      return copy.kind === "circle"
        ? [position(done, copy.centerPointId) as P]
        : copy.kind === "lineSegment"
          ? [
              position(done, copy.startPointId) as P,
              position(done, copy.endPointId) as P,
            ]
          : [];
    });
    expect(copyPoints).toEqual(third!.toolStagedEntities.flatMap(draftPoints));
    expect(done.liveSolve?.accepted).toBe(true);
    // The tool stays armed with no picks; nothing is staged.
    expect(done.activeTool).toBe("sketchMirror");
    expect(done.activeEditTool?.selectedTargets).toEqual([]);
    expect(done.toolStagedEntities).toEqual([]);
    expect(done.validationMessage).toBeNull();
    expect(popup(done)).toBeNull();
    expect(enter(done)).toBeNull();
  });

  test("R-1 [line, line, axis] (red on base): two line seeds, one mirror after Confirm, none before", () => {
    const base = baseSession();
    const [first, second, third] = picks(
      base,
      entityTarget("ab"),
      entityTarget("de"),
      entityTarget("axis"),
    );
    for (const session of [first!, second!, third!])
      expect(session.definition).toBe(base.definition);
    expect(popup(second!)?.readout).toBe("1 shape about ‘de’");
    expect(second!.toolStagedEntities.flatMap(draftPoints)).toHaveLength(2);
    expectNear(
      draftPoints(second!.toolStagedEntities[0]!)[0]!,
      reflectAbout([1, 1], [4, 6], [5, 8]),
      "the copy of ab about de",
    );
    expect(popup(third!)?.readout).toBe("2 shapes about ‘axis’");
    expect(third!.toolStagedEntities.flatMap(draftPoints)).toEqual(
      [
        [1, 1],
        [3, 2],
        [4, 6],
        [5, 8],
      ].map((point) => reflect(point as unknown as P)),
    );
    const done = confirm(third!);
    expect(
      mirrors(done).map((mirror) =>
        mirror.kind === "mirror"
          ? [mirror.seedEntityIds, mirror.mirrorReference]
          : null,
      ),
    ).toEqual([
      [[eid("ab"), eid("de")], { kind: "lineEntity", entityId: eid("axis") }],
    ]);
  });

  test("re-staging: picking the axis candidate again drops it (the previous line becomes the candidate); picking a seed again drops its copy", () => {
    const base = baseSession();
    const [, , staged, axisOff, seedOff] = picks(
      base,
      entityTarget("c"),
      entityTarget("ab"),
      entityTarget("axis"),
      entityTarget("axis"),
      entityTarget("c"),
    );
    expect(popup(staged!)?.readout).toBe("2 shapes about ‘axis’");
    expect(popup(axisOff!)?.readout).toBe("1 shape about ‘ab’");
    expect(axisOff!.toolStagedEntities.map((draft) => draft.kind)).toEqual([
      "circle",
    ]);
    // Only ab is left: no seed, so nothing is staged.
    expectRefusedAtPreview(
      base,
      seedOff!,
      "Select seed sketch entities, then a mirror axis line or sketch axis.",
    );
  });

  test("Cancel and Escape drop the picks and author nothing; the tool stays armed; a second Escape exits", () => {
    const base = baseSession();
    const staged = picks(
      base,
      entityTarget("c"),
      entityTarget("ab"),
      entityTarget("axis"),
    ).at(-1)!;
    const escapeEvent = escape(staged);
    expect(escapeEvent, "Escape cancels the staged mirror").toEqual({
      type: "sketch.toolPatched",
      patch: { intent: "cancelSketchEditOperator" },
    });
    const viaPopup = patchSketchEditToolValue(
      staged,
      popup(staged)!.cancelAction.patch,
    );
    const viaEscape = patchSketchEditToolValue(
      staged,
      (escapeEvent as { patch: Record<string, unknown> }).patch,
    );
    for (const [label, cancelled] of [
      ["Cancel", viaPopup],
      ["Escape", viaEscape],
    ] as const) {
      expect(cancelled.definition, `${label}: nothing authored`).toBe(
        base.definition,
      );
      expect(cancelled.activeTool, `${label}: the tool stays armed`).toBe(
        "sketchMirror",
      );
      expect(cancelled.activeEditTool?.selectedTargets).toEqual([]);
      expect(cancelled.toolStagedEntities).toEqual([]);
      expect(cancelled.validationMessage).toBeNull();
      expect(popup(cancelled)).toBeNull();
      expect(enter(cancelled)).toBeNull();
      expect(escape(cancelled), `${label}: the next Escape exits`).toEqual({
        type: "sketch.activeToolCleared",
      });
    }
    // The picks restart from scratch: one pick stages nothing.
    const again = selectSketchEditToolTarget(
      viaPopup,
      entityTarget("ab") as never,
    );
    expect(again.toolStagedEntities).toEqual([]);
    expect(again.activeEditTool?.selectedTargets).toHaveLength(1);
  });

  test("review R-1: an origin or sketch-point pick on a staged mirror shows its refusal next to the unchanged popup (red on the first T16d tree: popup hidden while Enter still confirmed); a hover keeps it; Enter gives the same mirror", () => {
    const base = baseSession();
    const staged = picks(
      base,
      entityTarget("c"),
      entityTarget("ab"),
      entityTarget("axis"),
    ).at(-1)!;
    const unsupported =
      "Sketch mirror supports sketch entities and needs a line or sketch axis as the final mirror axis.";
    for (const [label, target] of [
      ["origin", datum("origin" as never)],
      [
        "sketch point",
        { kind: "sketchPoint", sketchId: "sketch_draft", pointId: pid("u") },
      ],
    ] as const) {
      const refused = selectSketchEditToolTarget(staged, target as never);
      expect(refused.validationMessage, label).toBe(unsupported);
      expect(refused.definition, `${label}: nothing authored`).toBe(
        base.definition,
      );
      expect(
        refused.activeEditTool?.selectedTargets,
        `${label}: the picks stay`,
      ).toEqual(staged.activeEditTool?.selectedTargets);
      expect(refused.toolStagedEntities, `${label}: still staged`).toBe(
        staged.toolStagedEntities,
      );
      expect(popup(refused), `${label}: the popup stays as it was`).toEqual(
        popup(staged),
      );
      expect(popup(refused)?.readout).toBe("2 shapes about ‘axis’");
      expect(
        refused.toolPresentation?.validation?.map((entry) => entry.message),
        `${label}: the refusal shows next to it`,
      ).toEqual([unsupported]);
      expect(
        popup(updateSketchEditToolHover(refused, entityTarget("u"))),
        `${label}: a hover keeps the popup`,
      ).toEqual(popup(staged));
      expect(enter(refused)).toEqual({
        type: "sketch.toolPatched",
        patch: { intent: "createMirror" },
      });
      /** Seeds, axis and copy positions of the confirmed mirrors (ids are fresh per commit). */
      const confirmed = (session: SketchSessionState) => {
        const done = confirm(session);
        return mirrors(done).map((mirror) =>
          mirror.kind === "mirror"
            ? [
                mirror.seedEntityIds,
                mirror.mirrorReference,
                mirror.outputs.map((output) =>
                  output.outputPointIds.map((pointId) =>
                    position(done, pointId),
                  ),
                ),
              ]
            : null,
        );
      };
      expect(
        confirmed(refused),
        `${label}: Enter/Confirm gives the same mirror as before the pick`,
      ).toEqual(confirmed(staged));
      expect(confirmed(refused)).toHaveLength(1);
    }
  });

  test("refusals at preview keep today's texts: a non-line last pick, an axis shorter than τ, a sketch axis picked before the seeds; a datum axis picked last stages and confirms", () => {
    const base = baseSession();
    expectRefusedAtPreview(
      base,
      picks(base, entityTarget("c"), entityTarget("ab"), entityTarget("s")).at(
        -1,
      )!,
      "Sketch mirror needs a line segment or a sketch axis as the final selected mirror axis.",
    );
    const withTiny = baseSession(true);
    expectRefusedAtPreview(
      withTiny,
      picks(withTiny, entityTarget("ab"), entityTarget("tiny")).at(-1)!,
      "The mirror axis is shorter than the modeling tolerance; pick a longer line or a sketch axis.",
    );
    expectRefusedAtPreview(
      base,
      picks(base, datum("xAxis"), entityTarget("ab")).at(-1)!,
      MIRROR_DATUM_AXIS_ORDER_MESSAGE,
    );
    const onDatum = picks(base, entityTarget("ab"), datum("xAxis")).at(-1)!;
    expect(onDatum.definition).toBe(base.definition);
    expect(popup(onDatum)?.readout).toBe("1 shape about the sketch X axis");
    expect(onDatum.toolStagedEntities.flatMap(draftPoints)).toEqual([
      reflect([1, 1]),
      reflect([3, 2]),
    ]);
    const done = confirm(onDatum);
    expect(
      mirrors(done).map((mirror) =>
        mirror.kind === "mirror" ? mirror.mirrorReference : null,
      ),
    ).toEqual([{ kind: "sketchDatum", datum: "xAxis" }]);
  });
});

// T16e (review R-5; logic lane, seam: the edit-input gate's text for a
// broken mirror's held copy, `brokenDerivedInputMessage` through
// `offsetEditInputGate`). The recovery names the replacement that repairs
// the mirror: its line (missing or too short), its original (deleted), or
// none (a deleted copy, a dependency loop: Undo or removal).
describe("T16e: the failed-copy input text names the repair that fits the failure", () => {
  test("line missing / too short → replace the mirror line; original deleted → replace the original; on a loop → either (review A-7); copy deleted → Undo or remove", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const rebuild = (definition: SketchDefinition) =>
      rebuildSessionForDefinition(session, { definition });
    const without = (ids: readonly string[]) => {
      const entities = session.definition.entities.filter(
        (entity) => !ids.includes(entity.entityId),
      );
      return rebuild({
        ...session.definition,
        entityIds: entities.map((entity) => entity.entityId),
        entities,
      });
    };
    const held = outputOf("ab").outputEntityId;
    const cases: [string, SketchSessionState, string][] = [
      [
        "line missing",
        without([eid("axis")]),
        "Fix it (Undo or replace the mirror line)",
      ],
      [
        "line too short",
        rebuild({
          ...session.definition,
          points: session.definition.points.map((point) =>
            point.pointId === pid("x1")
              ? { ...point, position: [-2, 0] }
              : point,
          ),
        }),
        "Fix it (Undo or replace the mirror line)",
      ],
      [
        "original deleted",
        without([eid("c")]),
        "Fix it (Undo or replace the original)",
      ],
      // T17d (B4, T16e review A-6): the reasons travel with the failure, so
      // the double fault names both repairs (red on base: the input text
      // inferred "replace the original" alone by elimination).
      [
        "line too short and original deleted",
        rebuild({
          ...without([eid("c")]).definition,
          points: session.definition.points.map((point) =>
            point.pointId === pid("x1")
              ? { ...point, position: [-2, 0] }
              : point,
          ),
        }),
        "Fix it (Undo or replace the mirror line and the original)",
      ],
      [
        "copy deleted",
        without([outputOf("c").outputEntityId]),
        "Fix it (Undo)",
      ],
      [
        "dependency loop",
        rebuild({
          ...session.definition,
          derivedRelationships: [
            {
              ...relationship,
              mirrorReference: { kind: "lineEntity", entityId: held },
            },
          ],
        }),
        "Fix it (Undo or replace the mirror line or the original)",
      ],
    ];
    for (const [name, broken, recovery] of cases) {
      expect(
        broken.liveSolve!.solvedSnapshot.failedDerivationIds,
        `${name}: premise`,
      ).toEqual([relationship.derivationId]);
      expect(
        offsetEditInputGate(broken, [held], "a fillet input")?.message,
        name,
      ).toBe(
        `edit-input-derived-failed: ‘ab mirror’ is a copy made by mirror ‘mirror 1’, which is broken, so it can't be used as a fillet input. ${recovery} or remove the mirror from the Mirror panel.`,
      );
    }
  });
});

// T16g B8 (T15 close-out audit §3.1, CA-2; T15c review R-1b). Logic lane;
// seam: the session's drag entry points on a mirror authored by the Mirror
// tool. The original line e–x1 ends on the mirror line's own end x1, so its
// copy's end sits on x1 too (x1 lies on the mirror line). Dragging that copy
// end requests the mirror line's end: the line moves with it (T15c P6
// "does not move" is superseded). Dragging the copy's other end keeps the
// line bitwise (the axis preference).
describe("T16g B8: the copy of an original's end that is the mirror line's own end", () => {
  const reflectAbout = (p: P, a: P, b: P): P => {
    const d = [b[0] - a[0], b[1] - a[1]] as const;
    const t =
      ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) /
      (d[0] * d[0] + d[1] * d[1]);
    return [2 * (a[0] + t * d[0]) - p[0], 2 * (a[1] + t * d[1]) - p[1]];
  };
  function sharedAxisEnd() {
    const base = seedDefinition();
    const e = {
      pointId: pid("e"),
      label: "e",
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_draft",
        pointId: pid("e"),
      },
      position: [24, 4],
      isConstruction: false,
    } as SketchDefinition["points"][number];
    const ex = {
      kind: "lineSegment",
      entityId: eid("ex"),
      label: "ex",
      target: entityTarget("ex"),
      isConstruction: false,
      startPointId: pid("e"),
      endPointId: pid("x1"),
    } as SketchDefinition["entities"][number];
    const drawn = rebuildSessionForDefinition(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      {
        definition: {
          ...base,
          pointIds: [...base.pointIds, e.pointId],
          points: [...base.points, e],
          entityIds: [...base.entityIds, ex.entityId],
          entities: [...base.entities, ex],
        },
      },
    );
    let tool = beginSketchTool(drawn, "sketchMirror");
    for (const id of ["ex", "axis"])
      tool = selectSketchEditToolTarget(tool, entityTarget(id) as never);
    const mirrored = patchSketchEditToolValue(tool, { intent: "createMirror" });
    const relationship = mirrored.definition.derivedRelationships!.find(
      (candidate) => candidate.kind === "mirror",
    )!;
    const [me, mx] = relationship.outputs[0]!.outputPointIds as [
      SketchPointId,
      SketchPointId,
    ];
    const session = { ...mirrored, activeTool: null, activeEditTool: null };
    expect(
      distance(position(session, mx), position(session, pid("x1"))),
      "premise: the copy's end sits on the mirror line's end",
    ).toBeLessThanOrEqual(1e-12);
    return { session, me, mx };
  }

  test("dragging the copy end on the mirror line's end moves that end with it (no constrained cue): the line's other end and the original's other end stay bitwise; the copy is the original's image about the moved line", () => {
    const { session, me, mx } = sharedAxisEnd();
    const from = position(session, mx);
    const to: P = [from[0], from[1] + 1];
    let next = beginSketchGeometryDrag(session, pointRef(session, mx), from);
    expect(next.activeDrag, "the copy end is a drag target").not.toBeNull();
    for (let step = 1; step <= 5; step += 1) {
      next = updateSketchGeometryDrag(next, [from[0], from[1] + step / 5]);
      expect(
        next.activeDrag?.feedback?.kind,
        `frame ${step}: not the constrained cue (the line is free to follow)`,
      ).not.toBe("constrained");
    }
    const done = finishSketchGeometryDrag(next, to);
    expect(done.validationMessage).toBeNull();
    expect(
      distance(position(done, pid("x1")), to),
      "the mirror line's end follows the copy end",
    ).toBeLessThanOrEqual(1e-4);
    expect(
      distance(position(done, mx), to),
      "the copy end reaches the pointer",
    ).toBeLessThanOrEqual(1e-4);
    expectBitwise(
      position(done, pid("x0")),
      position(session, pid("x0")),
      "the mirror line's other end stays",
    );
    expectBitwise(
      position(done, pid("e")),
      position(session, pid("e")),
      "the original's other end stays",
    );
    expect(
      distance(
        position(done, me),
        reflectAbout(
          position(done, pid("e")),
          position(done, pid("x0")),
          position(done, pid("x1")),
        ),
      ),
      "the copy's other end is the original's image about the moved line",
    ).toBeLessThanOrEqual(1e-9);
  });

  test("control: dragging the copy's other end keeps the mirror line bitwise and moves the original's end as its image", () => {
    const { session, me } = sharedAxisEnd();
    const from = position(session, me);
    const to: P = [from[0] + 0.3, from[1] - 0.4];
    const { started, session: done } = drag(
      session,
      pointRef(session, me),
      from,
      to,
    );
    expect(started).toBe(true);
    for (const axisPoint of ["x0", "x1"])
      expectBitwise(
        position(done, pid(axisPoint)),
        position(session, pid(axisPoint)),
        `mirror line ${axisPoint} held bitwise`,
      );
    expect(distance(position(done, me), to)).toBeLessThanOrEqual(1e-4);
    expect(
      distance(position(done, pid("e")), reflect(to)),
      "the original's end is the copy end's image",
    ).toBeLessThanOrEqual(1e-4);
  });
});

// T16g B20 ([TECH] T16-15). Logic lane; seam: the session's Split and Trim
// tools with their exact intersection query answered by the one contract
// function (`completeSketchEditQueriesForTest`), then the live solve. Edits
// of the mirror line itself are not refused: the line keeps its id on the
// piece from its start, a collinear piece, so the mirror (which depends on
// the infinite line only) stays healthy and the copies do not move. A cut
// that would leave a piece shorter than τ is refused by the tool before any
// write, so a too-short mirror line is never produced by Trim or Split.
describe("T16g B20: Split and Trim of the mirror line itself", () => {
  /** Short vertical cutters crossing the mirror line (y = 0) at `xs`. */
  const withCutters = (session: SketchSessionState, xs: readonly number[]) => {
    const definition = session.definition;
    const points = xs.flatMap((x, index) =>
      (
        [
          ["lo", -0.5],
          ["hi", 0.5],
        ] as const
      ).map(([tag, y]) => ({
        pointId: pid(`k${index}${tag}`),
        label: `k${index}${tag}`,
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_draft",
          pointId: pid(`k${index}${tag}`),
        },
        position: [x, y],
        isConstruction: false,
      })),
    ) as SketchDefinition["points"];
    const entities = xs.map((_, index) => ({
      kind: "lineSegment",
      entityId: eid(`k${index}`),
      label: `k${index}`,
      target: entityTarget(`k${index}`),
      isConstruction: false,
      startPointId: pid(`k${index}lo`),
      endPointId: pid(`k${index}hi`),
    })) as SketchDefinition["entities"];
    return rebuildSessionForDefinition(session, {
      definition: {
        ...definition,
        pointIds: [...definition.pointIds, ...points.map((p) => p.pointId)],
        points: [...definition.points, ...points],
        entityIds: [
          ...definition.entityIds,
          ...entities.map((e) => e.entityId),
        ],
        entities: [...definition.entities, ...entities],
      },
    });
  };
  /** Split (target, then the first cutter as boundary) or Trim of the mirror line. */
  async function editAxis(tool: "sketchSplit" | "trim", xs: number[]) {
    const setup = mirroredSession("free");
    const session = withCutters(setup.session, xs);
    let next = beginSketchTool(session, tool);
    next = selectSketchEditToolTarget(next, entityRef(next, eid("axis")));
    if (tool === "sketchSplit")
      next = selectSketchEditToolTarget(next, entityRef(next, eid("k0")));
    expect(
      next.validationMessage,
      "the mirror line is not refused as a mirror participant",
    ).toBeNull();
    expect(
      next.activeEditTool?.editQuery?.inFlight?.input.operation.targetEntityId,
      "the edit is queried",
    ).toBe(eid("axis"));
    return {
      setup,
      session,
      done: await completeSketchEditQueriesForTest(next),
    };
  }
  const copyPositions = (
    session: SketchSessionState,
    relationship: ReturnType<typeof mirroredSession>["relationship"],
  ) =>
    relationship.outputs.flatMap((output) =>
      output.outputPointIds.map((pointId) => position(session, pointId)),
    );
  const axisEnds = (session: SketchSessionState) => {
    const axis = entity(session, eid("axis"));
    if (axis.kind !== "lineSegment") throw new Error("line");
    return [axis.startPointId, axis.endPointId].map((pointId) =>
      position(session, pointId),
    );
  };

  for (const [tool, xs, keptEnd] of [
    ["sketchSplit", [18], 18],
    ["trim", [17, 18], 17],
    // The shortest piece the tools allow next to τ = 0.001: 2τ.
    ["sketchSplit", [-2 + 2e-3], -2 + 2e-3],
  ] as const)
    test(`${tool} at x = ${xs.join(", ")}: applied; the mirror line keeps its id on the piece from its start (to x = ${keptEnd}); the mirror stays healthy and its copies do not move`, async () => {
      const { setup, session, done } = await editAxis(tool, [...xs]);
      expect(done.validationMessage).toBeNull();
      expect(done.definition, "the edit is authored").not.toBe(
        session.definition,
      );
      const ends = axisEnds(done);
      expect(ends[0], "the mirror line's start stays").toEqual([-2, 0]);
      expect(ends[1]![0]).toBeCloseTo(keptEnd, 9);
      expect(ends[1]![1]).toBeCloseTo(0, 9);
      expect(
        done.definition.derivedRelationships,
        "the mirror record is unchanged (same line id)",
      ).toEqual(session.definition.derivedRelationships);
      const solved = done.liveSolve!.solvedSnapshot;
      expect(solved.failedDerivationIds ?? []).toEqual([]);
      expect(solved.diagnostics.filter((d) => d.severity === "error")).toEqual(
        [],
      );
      const before = copyPositions(session, setup.relationship);
      copyPositions(done, setup.relationship).forEach((copy, index) =>
        expect(
          distance(copy, before[index]!),
          `copy point ${index} did not move`,
        ).toBeLessThanOrEqual(1e-12),
      );
    });

  for (const [tool, xs, refusal] of [
    [
      "trim",
      [-2 + 5e-4, 18],
      "Trim would leave a piece of axis shorter than the modeling tolerance (0.001). Nothing was changed.",
    ],
    [
      "sketchSplit",
      [-2 + 5e-4],
      "Sketch split needs a boundary crossing inside the selected curve.",
    ],
  ] as const)
    test(`${tool} leaving a piece shorter than τ is refused before any write (so -axis-degenerate never comes from it); the mirror stays healthy`, async () => {
      const { session, done } = await editAxis(tool, [...xs]);
      expect(done.validationMessage).toBe(refusal);
      expect(done.definition, "nothing written").toBe(session.definition);
      expect(axisEnds(done)).toEqual([
        [-2, 0],
        [20, 0],
      ]);
      expect(done.liveSolve!.solvedSnapshot.failedDerivationIds ?? []).toEqual(
        [],
      );
    });
});
