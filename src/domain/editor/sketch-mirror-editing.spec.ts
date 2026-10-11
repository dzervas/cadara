/**
 * T15d: either-side mirror editing in the sketch session. Logic lane; seam:
 * the sketch session's exported drag, tangent-action and edit-tool entry
 * points (`beginSketchGeometryDrag` … `finishSketchGeometryDrag`,
 * `cancelSketchGeometryDrag`, `selectSketchEditToolTarget`), on sessions
 * whose mirror is authored by the Mirror tool.
 */
import { describe, expect, test } from "vitest";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { reconstructSplineAggregate } from "@/contracts/sketch/spline-geometry";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  beginSketchGeometryDrag,
  beginSketchTool,
  cancelSketchGeometryDrag,
  createNewSketchSession,
  finishSketchGeometryDrag,
  selectSketchEditToolTarget,
  updateSketchGeometryDrag,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  appendDefinition,
  CONSTRAINED_DRAG_BLOCKED_MESSAGE,
  createSessionCommitFactories,
  getSketchSessionDisplayDefinition,
  rebuildSessionForDefinition,
} from "@/domain/editor/sketch-session/internals";
import { applyTangentAction } from "@/domain/editor/sketch-session/tangent-actions";
import { toggleSketchConstructionTarget } from "@/domain/editor/sketch-session/tools";
import { patchSketchStyleValue } from "@/domain/editor/sketch-session/styles";
import { createSketchDerivedTransformContribution } from "@/domain/sketch-editing/operations";
import {
  chainSession,
  eid,
  entityRef,
  handleRef,
  mirroredSession,
  pid,
  pointRef,
  seedDefinition,
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
    const mirrored = selectSketchEditToolTarget(
      tool,
      entityRef(tool, eid("axis")),
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
