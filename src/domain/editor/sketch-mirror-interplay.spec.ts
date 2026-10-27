/**
 * T15e: mirror interplay under drags. Logic lane; seam: the sketch session's
 * exported drag entry points (`beginSketchGeometryDrag` …
 * `finishSketchGeometryDrag`) on sessions whose relationships are authored
 * by the production operation builders (shared fixture
 * `sketch-mirror.fixtures.ts`). Each row drags through the coupled solve with
 * axis preference (T15c) and checks the D9′ / review A-1 drag rules
 * (one-way outputs and mirror copies of one-way outputs start no drag).
 *
 * Already pinned elsewhere (not repeated here): evaluation/solve order of
 * chains, pattern-of-mirror, offset-of-mirror and mirror-of-offset (MO1);
 * axis = an offset output line under drags (AX17, AX18); a two-mirror chain
 * drag at the compiled-session seam (AX8); construction output points at
 * creation (MC2); a diameter on a pattern of a mirrored circle (Q1b);
 * G19 acceptance of a mirror copy of an offset output (G16‴ closure row).
 */
import { describe, expect, test } from "vitest";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import { publishSketchOffsets } from "@/contracts/sketch/offset-publication";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  beginSketchGeometryDrag,
  finishSketchGeometryDrag,
  publishSketchLiveRegions,
  updateSketchGeometryDrag,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { createCertifiedCubicTubeChain } from "@/core/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/core/modeling/neutral-curve-certification/query";
import {
  chainSession,
  eid,
  entityRef,
  mirroredSession,
  pid,
  pointRef,
  withDerived,
  type P,
} from "./sketch-mirror.fixtures";

const position = (session: SketchSessionState, pointId: SketchPointId) =>
  session.definition.points.find((entry) => entry.pointId === pointId)!
    .position;
const distance = (first: P, second: P) =>
  Math.hypot(first[0] - second[0], first[1] - second[1]);
const minus = (first: P, second: P): P => [
  first[0] - second[0],
  first[1] - second[1],
];
/** R about the first mirror's axis y = 0 (the fixture's construction line). */
const reflectX = ([x, y]: P): P => [x, -y];
/** R about the chain's second axis x = 30. */
const reflectV = ([x, y]: P): P => [60 - x, y];
const expectBitwise = (actual: P, expected: P, message: string) =>
  expect(
    Object.is(actual[0], expected[0]) && Object.is(actual[1], expected[1]),
    `${message}: [${actual}] vs [${expected}]`,
  ).toBe(true);
const expectAxesHeld = (
  before: SketchSessionState,
  after: SketchSessionState,
  axisPoints: readonly string[],
) => {
  for (const axisPoint of axisPoints)
    expectBitwise(
      position(after, pid(axisPoint)),
      position(before, pid(axisPoint)),
      `axis point ${axisPoint} held bitwise`,
    );
};
/**
 * The live round's offset publication (the real certifier), applied to the
 * live solve as the editor loop does; regions are not under test here.
 */
function certified(session: SketchSessionState) {
  const live = session.liveSolve!;
  const publications = publishSketchOffsets({
    definition: live.definition,
    solvedSnapshot: live.solvedSnapshot,
    modelingTolerance: session.modelingTolerance,
    capabilities: {
      query: createCertifiedNeutralCurveRequestQuery(),
      certifier: createCertifiedCubicTubeChain(),
    },
  });
  const next = publishSketchLiveRegions(
    session,
    session.liveRegions.regions,
    [],
    publications,
  );
  expect(
    next.liveSolve!.solvedSnapshot.certifiedOffsetDerivationIds?.length,
    "premise: every offset is certified",
  ).toBe(
    session.definition.derivedRelationships!.filter(
      (relationship) => relationship.kind === "offset",
    ).length,
  );
  return next;
}
const startsDrag = (session: SketchSessionState, target: PrimitiveRef, at: P) =>
  beginSketchGeometryDrag(session, target, at).activeDrag !== null;

/** One completed gesture: press at `from`, glide in 5 frames to `to`, release. */
function drag(
  session: SketchSessionState,
  target: PrimitiveRef,
  from: P,
  to: P,
) {
  let next = beginSketchGeometryDrag(session, target, from);
  expect(next.activeDrag, "the gesture starts a drag").not.toBeNull();
  for (let step = 1; step <= 5; step += 1) {
    const t = step / 5;
    next = updateSketchGeometryDrag(next, [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
    ]);
  }
  const done = finishSketchGeometryDrag(next, to);
  expect(done.definition, "the drag authored a change").not.toBe(
    session.definition,
  );
  expect(done.validationMessage).toBeNull();
  return done;
}

type Output = {
  seedPointIds: readonly SketchPointId[];
  outputPointIds: readonly SketchPointId[];
};
/** Every copy point of `output` is `reflect` of its seed point (≤ 1e-12). */
const expectReflected = (
  session: SketchSessionState,
  output: Output,
  reflect: (point: P) => P,
  message: string,
) =>
  output.seedPointIds.forEach((seedPointId, index) =>
    expect(
      distance(
        position(session, output.outputPointIds[index]!),
        reflect(position(session, seedPointId)),
      ),
      `${message}: point ${index}`,
    ).toBeLessThanOrEqual(1e-12),
  );

/** A single-line offset output: each end is its seed end moved by d along one unit normal. */
function expectLineOffset(
  session: SketchSessionState,
  output: Output,
  d: number,
  message: string,
) {
  const [s0, s1] = output.seedPointIds.map((id) => position(session, id));
  const [o0, o1] = output.outputPointIds.map((id) => position(session, id));
  const direction = minus(s1!, s0!);
  for (const [seedEnd, outputEnd] of [
    [s0!, o0!],
    [s1!, o1!],
  ] as const) {
    const shift = minus(outputEnd, seedEnd);
    expect(Math.hypot(...shift), `${message}: shift length`).toBeCloseTo(d, 9);
    expect(
      Math.abs(shift[0] * direction[0] + shift[1] * direction[1]) /
        Math.hypot(...direction),
      `${message}: shift ⟂ seed line`,
    ).toBeLessThan(1e-9);
  }
}

describe("T15e interplay: offsets, chains and patterns around a mirror, under drags with axis preference", () => {
  test("offset of a mirror output: dragging the copy moves its seed as the mirror image, the offset of the copy follows, the axis stays; the offset output starts no drag", () => {
    const setup = mirroredSession("free");
    const copyLine = setup.outputOf("ab");
    const { session, relationship: offset } = withDerived(
      setup.session,
      "offset",
      [copyLine.outputEntityId],
      70,
      0.5,
    );
    const offsetOutput = offset.outputs[0]!;
    expectLineOffset(session, offsetOutput, 0.5, "premise");
    const ma = copyLine.outputPointIds[0]!;
    const from = position(session, ma);
    const to: P = [from[0] + 0.3, from[1] - 0.4];

    const after = drag(session, pointRef(session, ma), from, to);
    expect(
      distance(position(after, ma), to),
      "the copy end reaches the pointer",
    ).toBeLessThanOrEqual(1e-4);
    expectReflected(after, copyLine, reflectX, "the copy is R(seed)");
    expectLineOffset(after, offsetOutput, 0.5, "the offset follows the copy");
    expectAxesHeld(session, after, ["x0", "x1"]);
    // D9′: the offset's output line and its points are one-way outputs.
    expect(
      startsDrag(
        after,
        entityRef(after, offsetOutput.outputEntityId),
        position(after, offsetOutput.outputPointIds[0]!),
      ),
      "the offset output line starts no drag",
    ).toBe(false);
    expect(
      startsDrag(
        after,
        pointRef(after, offsetOutput.outputPointIds[0]!),
        position(after, offsetOutput.outputPointIds[0]!),
      ),
      "the offset output point starts no drag",
    ).toBe(false);
  });

  test("mirror of an offset line output and of an offset arc output: dragging the offset seeds moves the offsets and their copies (R of the offset outputs), the axis stays; the copies start no drag (A-1)", () => {
    const setup = mirroredSession("free");
    const lineOffset = withDerived(
      setup.session,
      "offset",
      [eid("ab")],
      70,
      0.5,
    );
    const arcOffset = withDerived(
      lineOffset.session,
      "offset",
      [eid("ar")],
      71,
      0.25,
    );
    const offsetLine = lineOffset.relationship.outputs[0]!;
    const offsetArc = arcOffset.relationship.outputs[0]!;
    const { session, relationship: mirror } = withDerived(
      arcOffset.session,
      "mirror",
      [offsetLine.outputEntityId, offsetArc.outputEntityId, eid("axis")],
      72,
    );
    const copyOf = (seed: SketchEntityId) =>
      mirror.outputs.find((output) => output.seedEntityId === seed)!;
    expectReflected(
      session,
      copyOf(offsetLine.outputEntityId),
      reflectX,
      "premise line",
    );
    expectReflected(
      session,
      copyOf(offsetArc.outputEntityId),
      reflectX,
      "premise arc",
    );

    // The line offset's seed end, then the arc offset's seed centre.
    const fromA = position(session, pid("a"));
    const afterLine = drag(session, pointRef(session, pid("a")), fromA, [
      fromA[0] - 0.3,
      fromA[1] + 0.4,
    ]);
    const fromC = position(afterLine, pid("rc"));
    const after = drag(afterLine, pointRef(afterLine, pid("rc")), fromC, [
      fromC[0] + 0.5,
      fromC[1] + 0.3,
    ]);
    expect(
      distance(position(after, pid("rc")), [fromC[0] + 0.5, fromC[1] + 0.3]),
      "the arc centre reaches the pointer",
    ).toBeLessThanOrEqual(1e-4);
    expect(
      distance(
        position(after, offsetArc.outputPointIds[0]!),
        position(after, pid("rc")),
      ),
      "the offset arc keeps the seed's centre",
    ).toBeLessThanOrEqual(1e-12);
    expectLineOffset(
      after,
      offsetLine,
      0.5,
      "the line offset follows its seed",
    );
    expectReflected(
      after,
      copyOf(offsetLine.outputEntityId),
      reflectX,
      "the line offset's copy",
    );
    expectReflected(
      after,
      copyOf(offsetArc.outputEntityId),
      reflectX,
      "the arc offset's copy",
    );
    expectReflected(
      after,
      setup.outputOf("ab"),
      reflectX,
      "the seeds' own copies",
    );
    expectAxesHeld(session, after, ["x0", "x1"]);
    // Review A-1: a mirror copy of a one-way output is not a drag target,
    // also once its offset is certified (so not merely G19 non-accepted).
    const live = certified(after);
    for (const output of mirror.outputs)
      expect(
        startsDrag(
          live,
          pointRef(live, output.outputPointIds[0]!),
          position(live, output.outputPointIds[0]!),
        ),
        `the copy of ${output.seedEntityId} starts no drag`,
      ).toBe(false);
    expect(
      startsDrag(live, pointRef(live, pid("a")), position(live, pid("a"))),
      "control: the root seed still starts a drag",
    ).toBe(true);
  });

  test("two-mirror chain: dragging the last copy's end moves only the root seed (R1∘R2 of the pointer); both axes stay bitwise; the first copy follows", () => {
    const { session, setup, secondOutputOf } = chainSession();
    const firstCopy = setup.outputOf("ab");
    const lastCopy = secondOutputOf(firstCopy.outputEntityId);
    const last = lastCopy.outputPointIds[0]!;
    const from = position(session, last);
    const to: P = [from[0] - 0.4, from[1] + 0.3];

    const after = drag(session, pointRef(session, last), from, to);
    expect(
      distance(position(after, last), to),
      "the last copy's end reaches the pointer",
    ).toBeLessThanOrEqual(1e-4);
    expect(
      distance(position(after, pid("a")), reflectX(reflectV(to))),
      "the root seed end is R1∘R2 of the pointer",
    ).toBeLessThanOrEqual(1e-4);
    expectReflected(after, firstCopy, reflectX, "first copy = R1(seed)");
    expectReflected(after, lastCopy, reflectV, "last copy = R2(first copy)");
    expectAxesHeld(session, after, ["x0", "x1", "v0", "v1"]);
    expectBitwise(
      position(after, pid("b")),
      position(session, pid("b")),
      "the other seed end stays",
    );
  });

  test("pattern of a mirror output: dragging the copy moves its seed as the mirror image and the pattern instance keeps its offset from the copy; the axis stays; the pattern instance starts no drag", () => {
    const setup = mirroredSession("free");
    const copyLine = setup.outputOf("ab");
    const { session, relationship: pattern } = withDerived(
      setup.session,
      "linearPattern",
      [copyLine.outputEntityId],
      70,
      4,
    );
    const instance = pattern.outputs[0]!;
    const shift = minus(
      position(session, instance.outputPointIds[0]!),
      position(session, instance.seedPointIds[0]!),
    );
    expect(
      Math.hypot(...shift),
      "premise: the instance is shifted",
    ).toBeGreaterThan(1);
    const ma = copyLine.outputPointIds[0]!;
    const from = position(session, ma);
    const to: P = [from[0] + 0.3, from[1] - 0.4];

    const after = drag(session, pointRef(session, ma), from, to);
    expect(
      distance(position(after, ma), to),
      "the copy end reaches the pointer",
    ).toBeLessThanOrEqual(1e-4);
    expectReflected(after, copyLine, reflectX, "the copy is R(seed)");
    instance.seedPointIds.forEach((seedPointId, index) =>
      expect(
        distance(
          minus(
            position(after, instance.outputPointIds[index]!),
            position(after, seedPointId),
          ),
          shift,
        ),
        `pattern instance point ${index} = copy point + the pattern shift`,
      ).toBeLessThanOrEqual(1e-12),
    );
    expectAxesHeld(session, after, ["x0", "x1"]);
    expect(
      startsDrag(
        after,
        pointRef(after, instance.outputPointIds[0]!),
        position(after, instance.outputPointIds[0]!),
      ),
      "the pattern instance's point starts no drag (D9′)",
    ).toBe(false);
  });
});
