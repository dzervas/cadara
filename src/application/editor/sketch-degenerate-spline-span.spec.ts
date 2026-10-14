/**
 * T17c3 (T17-21; issue 08 :107; specification "Minimum failure feedback").
 * Logic lane. Seams: the live solve and the sketch session's derived
 * validity / invalid feedback / display renderables, reached through the
 * authored-action owner around the real reducer on an entered session
 * (`createSketchActionOwnerFixture`), with the live region derivation run
 * by the real solver adapter; then Finish through the mock kernel → saved
 * record → JSON → reopen. Both reachable paths to a degenerate span are
 * covered (T17b0 P-9): the Coincident tool on two consecutive fit points,
 * and a fit point dragged onto its neighbour. The span stays authored; the
 * spline stays drawn (its fit points, invalid tint); the label-based text
 * explains it; the sketch's profiles are blocked (`unavailable`); Undo
 * restores the region. Merge still refuses (unchanged).
 */
import { describe, expect, test } from "vitest";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import type { SketchPointId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import type {
  SketchDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import {
  entityRef,
  eid as mirrorEid,
  entityTarget as mirrorEntityTarget,
  mirroredSession,
  pid as mirrorPid,
  pointRef,
  seedDefinition as mirrorSeedDefinition,
} from "@/domain/editor/sketch-mirror.fixtures";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import {
  acceptSketchDraw,
  beginSketchTool,
  clearActiveSketchTool,
  createNewSketchSession,
  createSketchSessionFromSnapshot,
  finalizeSketchDraw,
  getSketchSessionDisplayRenderables,
  getSketchSessionPreviewLabel,
  patchSketchEditToolValue,
  selectSketchEditTarget,
  selectSketchEditToolTarget,
  startSketchDraw,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  getSketchDegenerateSplineSpans,
  getSketchSessionInvalidFeedback,
  rebuildSessionForDefinition,
} from "@/domain/editor/sketch-session/internals";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/domain/editor/sketch-session/test-snap-scale";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { createSketchMergePointsMutation } from "@/domain/sketch-editing/merge-points";
import {
  createSketchActionOwnerFixture,
  drawnMixedOutlineSession,
  MIXED_OUTLINE,
} from "./sketch-action-owner.fixtures";

type P = readonly [number, number];
type Spline = Extract<SketchEntityDefinition, { kind: "spline" }>;

// Four fit points A → B → C → D, closed by a line D → A snapped onto the
// spline's ends: one region. C is dragged straight left onto B.
const A: P = [0.5, 0.25];
const B: P = [1, 1];
const C: P = [2, 1];
const D: P = [3, 0.125];

const TEXT =
  "Spline 1 has two consecutive fit points at the same place (Spline 1 point 2 and Spline 1 point 3); the sketch's profiles are blocked. Undo, or drag one of them apart (delete the Coincident between them first, if there is one).";

function loop(): SketchSessionState {
  let session = withSketchSnapScale(
    enterSketchSession(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  session = startSketchDraw(beginSketchTool(session, "spline"), A);
  for (const point of [B, C, D]) session = acceptSketchDraw(session, point);
  session = clearActiveSketchTool(finalizeSketchDraw(session));
  return clearActiveSketchTool(
    acceptSketchDraw(startSketchDraw(beginSketchTool(session, "line"), D), A),
  );
}

const splineOf = (definition: SketchDefinition) =>
  definition.entities.find(
    (entity): entity is Spline => entity.kind === "spline",
  )!;
const positionOf = (definition: SketchDefinition, pointId: string) =>
  definition.points.find((point) => point.pointId === pointId)!.position;
const fitPositions = (definition: SketchDefinition) =>
  splineOf(definition).pointOccurrences.map((occurrence) =>
    positionOf(definition, occurrence.pointId),
  );
/** The spline's renderable (none when it is not drawn). */
const splineRenderable = (session: SketchSessionState) =>
  getSketchSessionDisplayRenderables(session).find(
    (renderable) =>
      renderable.target?.kind === "sketchEntity" &&
      renderable.target.entityId === splineOf(session.definition).entityId,
  );
const world = ([x, y]: P) => [x, y, 0] as never;

async function drawn() {
  const f = await createSketchActionOwnerFixture(loop());
  const spline = splineOf(f.session.definition);
  expect(spline.pointOccurrences, "premise: four fit points").toHaveLength(4);
  expect(
    f.session.definition.entities.map((entity) => entity.kind),
    "premise: the spline and its closing line",
  ).toEqual(["spline", "lineSegment"]);
  expect(
    f.session.liveRegions.status,
    "premise: the loop is one current region",
  ).toBe("current");
  expect(f.session.liveRegions.regions).toHaveLength(1);
  expect(
    splineRenderable(f.session)?.regionValidity,
    "premise: drawn, not tinted",
  ).toBeUndefined();
  const [, b, c] = spline.pointOccurrences.map(
    (occurrence) => occurrence.pointId as SketchPointId,
  );
  return { f, b: b!, c: c!, before: f.session.definition };
}

/** Glides fit point 3 (at C) onto fit point 2 (at B) and releases. */
async function dragOntoB(
  f: Awaited<ReturnType<typeof drawn>>["f"],
  c: SketchPointId,
) {
  f.dispatch({
    type: "sketch.geometryDragStarted",
    target: pointRef(f.session, c),
    point: world(C),
  });
  for (let step = 1; step <= 4; step += 1)
    f.dispatch({
      type: "sketch.geometryDragMoved",
      point: world([
        C[0] + ((B[0] - C[0]) * step) / 4,
        C[1] + ((B[1] - C[1]) * step) / 4,
      ]),
    });
  f.dispatch({ type: "sketch.geometryDragEnded", point: world(B) });
  expect(
    f.session.validationMessage,
    "the release itself explains the blocked profiles",
  ).toBe(TEXT);
  // The viewport then selects the dragged point (as in the browser); the
  // explanation stays.
  f.dispatch({
    type: "viewport.selectionRequested",
    target: pointRef(f.session, c),
  });
  return f.settle();
}

/** Finish through the mock kernel (real solver adapter): the saved sketch. */
async function finish(definition: SketchDefinition) {
  const solverAdapter = new SketchConstraintSolverAdapter({
    revisionId: null,
    neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
  });
  const kernel = new MockKernelAdapter({ solverAdapter });
  const request = {
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  } as const;
  const before = await kernel.getDocumentSnapshot(request);
  const response = await kernel.commitSketch({
    ...request,
    baseRevisionId: before.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_degenerate_finish",
      projectionRequestId: "request_degenerate_finish:project",
      validationRequestId: "request_degenerate_finish:validate",
      solveRequestId: "request_degenerate_finish:solve",
      regionRequestId: "request_degenerate_finish:regions",
    },
    sketchId: null,
    sketchLabel: "Degenerate span",
    plane: before.snapshot.document.sketches[0]!.plane,
    definition,
  });
  const after = await kernel.getDocumentSnapshot(request);
  return after.snapshot.document.sketches.find(
    (sketch) => sketch.sketchId === response.sketchId,
  );
}

/** The degenerate state, whichever path reached it. */
function expectDegenerate(
  session: SketchSessionState,
  before: SketchDefinition,
) {
  const spline = splineOf(session.definition);
  expect(
    spline.pointOccurrences,
    "the span stays authored: no fit point merged, deleted or added",
  ).toEqual(splineOf(before).pointOccurrences);
  const [, b, c] = spline.pointOccurrences.map(
    (occurrence) => occurrence.pointId,
  );
  expect(
    positionOf(session.definition, c!),
    "no artificial separation: points 2 and 3 are at the same place",
  ).toEqual(positionOf(session.definition, b!));
  expect(session.liveRegions.status, "the sketch's profiles are blocked").toBe(
    "unavailable",
  );
  expect(session.validationMessage, "the shown status").toBe(TEXT);
  expect(getSketchSessionInvalidFeedback(session)).toBe(TEXT);
  expect(getSketchSessionPreviewLabel(session)).toBe(TEXT);
  const renderable = splineRenderable(session);
  expect(renderable, "the spline stays drawn").toBeDefined();
  expect(renderable!.regionValidity, "with the invalid tint").toBe("invalid");
  expect(
    renderable!.geometry.kind === "polyline"
      ? renderable!.geometry.points.map(([x, y]) => [x, y])
      : null,
    "drawn through its fit points (the reconstruction has no spans)",
  ).toEqual(fitPositions(session.definition).map(([x, y]) => [x, y]));
}

/** Undo restored the drawn loop: its region, no status, no tint. */
function expectRestored(session: SketchSessionState, before: SketchDefinition) {
  expect(session.definition.points).toEqual(before.points);
  expect(session.liveRegions.status).toBe("current");
  expect(session.liveRegions.regions, "the region is back").toHaveLength(1);
  expect(session.validationMessage).toBeNull();
  expect(splineRenderable(session)?.regionValidity).toBeUndefined();
}

describe("T17c3: a degenerate spline span is reported, drawn and blocks the profiles", () => {
  test("drag fit point 3 onto fit point 2: one 'Move Sketch Geometry'; the spline stays drawn (invalid tint), the label-based status is shown, live regions are unavailable; Undo restores the region, Redo the diagnostic", async () => {
    const { f, c, before } = await drawn();
    await dragOntoB(f, c);
    expect(f.undoLabels()).toEqual(["Move Sketch Geometry"]);
    expect(
      positionOf(f.session.definition, c),
      "premise: dropped exactly on point 2",
    ).toEqual(B);
    expectDegenerate(f.session, before);

    f.dispatch({ type: "history.undoRequested" });
    await f.settle();
    expectRestored(f.session, before);
    f.dispatch({ type: "history.redoRequested" });
    await f.settle();
    expectDegenerate(f.session, before);
  });

  test("Coincident on fit points 2 and 3: one 'Coincident' action; the same diagnostic, drawing and blocked profiles; Undo restores the region", async () => {
    const { f, b, c, before } = await drawn();
    f.dispatch({ type: "tool.activated", toolId: "constraintCoincident" });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, b),
    });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, c),
    });
    await f.settle();
    expect(f.undoLabels()).toEqual(["Coincident"]);
    expect(
      f.session.definition.constraints.map((constraint) => constraint.kind),
      "one Coincident authored",
    ).toEqual([...before.constraints.map((entry) => entry.kind), "coincident"]);
    expectDegenerate(f.session, before);

    f.dispatch({ type: "history.undoRequested" });
    await f.settle();
    expectRestored(f.session, before);
    expect(f.session.definition.constraints).toEqual(before.constraints);
    f.dispatch({ type: "history.redoRequested" });
    await f.settle();
    expectDegenerate(f.session, before);
  });

  test("Finish → saved record → JSON → reopen: no region is saved; the reopened sketch shows the same diagnostic (the solver's own error is label-based too), the spline drawn with the invalid tint", async () => {
    const { f, c } = await drawn();
    await dragOntoB(f, c);
    expect(f.session.validationMessage, "premise").toBe(TEXT);

    const saved = await finish(f.session.commitRequest!.definition);
    expect(saved, "Finish keeps the sketch").toBeDefined();
    expect(saved!.sketch.regions, "no region is offered").toEqual([]);

    const file = JSON.parse(JSON.stringify(saved)) as SketchSnapshotRecord;
    const reopened = enterSketchSession(
      createSketchSessionFromSnapshot(file, OCC_KERNEL_SETTINGS),
    );
    expect(
      splineOf(reopened.definition).pointOccurrences,
      "still four occurrences",
    ).toHaveLength(4);
    expect(
      reopened.liveSolve!.solvedSnapshot.diagnostics.find(
        (diagnostic) => diagnostic.code === "invalid-spline-coincident-points",
      )?.message,
      "the solver's own diagnostic names the spline and its points by label",
    ).toBe(TEXT);
    expect(reopened.liveRegions.status).toBe("unavailable");
    expect(getSketchSessionInvalidFeedback(reopened)).toBe(TEXT);
    expect(getSketchSessionPreviewLabel(reopened)).toBe(TEXT);
    expect(splineRenderable(reopened)?.regionValidity).toBe("invalid");
  });

  test("Merge Points still refuses consecutive fit points (unchanged): it never authors a degenerate span", async () => {
    const { f, b, c } = await drawn();
    const merge = (source: SketchPointId, destination: SketchPointId) =>
      createSketchMergePointsMutation({
        definition: f.session.definition,
        sourcePointId: source,
        destinationPointId: destination,
      });
    expect(merge(c, b)).toEqual({
      valid: false,
      message:
        "Spline 1 point 3 is an interior fit point of Spline 1; only the ends of an open spline can be merged.",
    });
  });
});

// Review F-1: the promised recoveries work in a sketch with a constraint
// (here a Fix on point 1, besides the line's inferred one). Undo works in
// the session; after Finish → reopen (no Undo history) deleting the spline
// unblocks the sketch. Dragging one of the points apart (T17c5) has its own
// rows below.
describe("T17c3 review F-1: the promised recoveries work in a constrained sketch", () => {
  async function constrainedDegenerate(path: "drag" | "coincident") {
    const { f, b, c, before } = await drawn();
    const [a] = splineOf(before).pointOccurrences.map(
      (occurrence) => occurrence.pointId as SketchPointId,
    );
    f.dispatch({ type: "tool.activated", toolId: "constraintFix" });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, a!),
    });
    f.dispatch({ type: "sketch.activeToolCleared" });
    await f.settle();
    const fixed = f.session.definition;
    expect(
      fixed.constraints.map((constraint) => constraint.kind),
      "premise: a constrained sketch",
    ).toContain("fixPoint");
    if (path === "drag") await dragOntoB(f, c);
    else {
      f.dispatch({ type: "tool.activated", toolId: "constraintCoincident" });
      f.dispatch({
        type: "viewport.selectionRequested",
        target: pointRef(f.session, b),
      });
      f.dispatch({
        type: "viewport.selectionRequested",
        target: pointRef(f.session, c),
      });
      f.dispatch({ type: "sketch.activeToolCleared" });
      await f.settle();
    }
    expect(f.session.validationMessage, "premise: degenerate").toBe(TEXT);
    return { f, fixed };
  }

  for (const path of ["drag", "coincident"] as const) {
    test(`${path}: in the session, Undo restores the region`, async () => {
      const { f, fixed } = await constrainedDegenerate(path);
      f.dispatch({ type: "history.undoRequested" });
      await f.settle();
      expect(f.session.definition.points).toEqual(fixed.points);
      expect(f.session.definition.constraints).toEqual(fixed.constraints);
      expect(f.session.liveRegions.status).toBe("current");
      expect(f.session.liveRegions.regions).toHaveLength(1);
      expect(f.session.validationMessage).toBeNull();
    });

    test(`${path}: after Finish → reopen (no Undo history), deleting the spline is one 'Delete Sketch Item' and unblocks the sketch`, async () => {
      const { f, fixed } = await constrainedDegenerate(path);
      const saved = await finish(f.session.commitRequest!.definition);
      const file = JSON.parse(JSON.stringify(saved)) as SketchSnapshotRecord;
      const reopened = await createSketchActionOwnerFixture(
        createSketchSessionFromSnapshot(file, OCC_KERNEL_SETTINGS),
      );
      expect(reopened.undoLabels(), "no Undo history after reopen").toEqual([]);
      expect(reopened.session.liveRegions.status).toBe("unavailable");
      expect(getSketchSessionInvalidFeedback(reopened.session)).toBe(TEXT);
      const spline = splineOf(reopened.session.definition);
      reopened.dispatch({
        type: "viewport.selectionRequested",
        target: entityRef(reopened.session, spline.entityId),
      });
      reopened.dispatch({ type: "sketch.annotationDeleteRequested" });
      await reopened.settle();
      expect(reopened.undoLabels()).toEqual(["Delete Sketch Item"]);
      expect(
        reopened.session.definition.entities.map((entity) => entity.kind),
        "the spline is gone, the line stays",
      ).toEqual(["lineSegment"]);
      expect(
        reopened.session.definition.constraints.map((entry) => entry.kind),
        "the Fix stays",
      ).toContain("fixPoint");
      expect(fixed.constraints.length).toBeGreaterThan(0);
      expect(
        reopened.session.liveRegions.status,
        "the sketch is no longer blocked",
      ).toBe("current");
      expect(reopened.session.validationMessage).toBeNull();
      expect(getSketchSessionInvalidFeedback(reopened.session)).not.toBe(TEXT);
    });
  }
});

// Review F-6: rows for the three surviving mutants.
describe("T17c3 review F-6: wrap span, conflict first, selection in a valid sketch", () => {
  test("a smooth closure's wrap span names the last and the first fit point", async () => {
    let session = withSketchSnapScale(
      enterSketchSession(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    );
    const end: P = [3, 0.25];
    session = startSketchDraw(beginSketchTool(session, "spline"), A);
    for (const point of [B, C, end]) session = acceptSketchDraw(session, point);
    const f = await createSketchActionOwnerFixture(
      clearActiveSketchTool(finalizeSketchDraw(session)),
    );
    const spline = splineOf(f.session.definition);
    f.dispatch({
      type: "viewport.selectionRequested",
      target: entityRef(f.session, spline.entityId),
    });
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "closeSpline" },
    });
    expect(splineOf(f.session.definition).closure, "premise").toBe("smooth");
    const last = spline.pointOccurrences[3]!.pointId as SketchPointId;
    f.dispatch({
      type: "sketch.geometryDragStarted",
      target: pointRef(f.session, last),
      point: world(end),
    });
    for (let step = 1; step <= 4; step += 1)
      f.dispatch({
        type: "sketch.geometryDragMoved",
        point: world([end[0] + ((A[0] - end[0]) * step) / 4, A[1]]),
      });
    f.dispatch({ type: "sketch.geometryDragEnded", point: world(A) });
    await f.settle();
    expect(positionOf(f.session.definition, last), "premise").toEqual(A);
    expect(f.session.validationMessage).toBe(
      "Spline 1 has two consecutive fit points at the same place (Spline 1 point 4 and Spline 1 point 1); the sketch's profiles are blocked. Undo, or drag one of them apart (delete the Coincident between them first, if there is one).",
    );
  });

  test("a conflict is explained before the degenerate span", async () => {
    const { f, c, before } = await drawn();
    await dragOntoB(f, c);
    const conflict = (id: string, position: P) => ({
      constraintId: `constraint_conflict_${id}`,
      kind: "fixPoint",
      label: `Conflicting fix ${id}`,
      pointId: splineOf(before).pointOccurrences[0]!.pointId,
      position,
    });
    const definition = {
      ...f.session.definition,
      constraintIds: [
        ...f.session.definition.constraintIds,
        "constraint_conflict_a",
        "constraint_conflict_b",
      ],
      constraints: [
        ...f.session.definition.constraints,
        conflict("a", A),
        conflict("b", [A[0], A[1] + 5]),
      ],
    } as SketchDefinition;
    const session = rebuildSessionForDefinition(f.session, { definition });
    expect(
      getSketchDegenerateSplineSpans(
        session.liveSolve!.definition,
        session.liveSolve!.solvedSnapshot,
      ),
      "premise: still a degenerate span",
    ).toHaveLength(1);
    expect(getSketchSessionInvalidFeedback(session)).toBe(
      "Conflicting fix a, Conflicting fix b conflict. The sketch is invalid; profiles from it are blocked. Change or delete one of them, or Undo.",
    );
  });

  test("selecting a point clears a message once the sketch is valid (the degenerate explanation is kept only while blocked)", async () => {
    const { f, c } = await drawn();
    const valid = selectSketchEditTarget(
      { ...f.session, validationMessage: "A transient message." },
      pointRef(f.session, c),
    );
    expect(valid.validationMessage).toBeNull();
    await dragOntoB(f, c);
    expect(
      selectSketchEditTarget(f.session, pointRef(f.session, c))
        .validationMessage,
    ).toBe(TEXT);
  });
});

// T17c5 (issue 08 :107, recovery by editing): in a constrained sketch whose
// only error is the degenerate span, dragging one of the two fit points
// apart is one "Move Sketch Geometry" that makes the span valid again, in
// the session and after Finish → reopen. A Coincident between them keeps
// them together (the drag is refused) until it is deleted. A drag that
// keeps them together, and every other drag-start refusal, are unchanged.
describe("T17c5: dragging one of the coincident fit points apart recovers the span", () => {
  type Fixture = Awaited<ReturnType<typeof createSketchActionOwnerFixture>>;

  /** Fix on fit point 1, then the degenerate span by `path`; optionally Finish → JSON → reopen. */
  async function degenerate(
    path: "drag" | "coincident",
    where: "session" | "reopened",
  ) {
    const { f, b, c, before } = await drawn();
    const [a, , , d] = splineOf(before).pointOccurrences.map(
      (occurrence) => occurrence.pointId as SketchPointId,
    );
    f.dispatch({ type: "tool.activated", toolId: "constraintFix" });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, a!),
    });
    f.dispatch({ type: "sketch.activeToolCleared" });
    await f.settle();
    if (path === "drag") await dragOntoB(f, c);
    else {
      f.dispatch({ type: "tool.activated", toolId: "constraintCoincident" });
      f.dispatch({
        type: "viewport.selectionRequested",
        target: pointRef(f.session, b),
      });
      f.dispatch({
        type: "viewport.selectionRequested",
        target: pointRef(f.session, c),
      });
      f.dispatch({ type: "sketch.activeToolCleared" });
      await f.settle();
    }
    expect(f.session.validationMessage, "premise: degenerate").toBe(TEXT);
    if (where === "session") return { f, b, c, d: d! };
    const saved = await finish(f.session.commitRequest!.definition);
    const file = JSON.parse(JSON.stringify(saved)) as SketchSnapshotRecord;
    const reopened = await createSketchActionOwnerFixture(
      createSketchSessionFromSnapshot(file, OCC_KERNEL_SETTINGS),
    );
    expect(reopened.undoLabels(), "premise: no Undo history").toEqual([]);
    expect(getSketchSessionInvalidFeedback(reopened.session)).toBe(TEXT);
    return { f: reopened, b, c, d: d! };
  }

  /** Glides `pointId` from where it is to `to` and releases; the viewport then selects it. */
  async function glide(f: Fixture, pointId: SketchPointId, to: P) {
    const from = positionOf(f.session.definition, pointId);
    f.dispatch({
      type: "sketch.geometryDragStarted",
      target: pointRef(f.session, pointId),
      point: world(from as unknown as P),
    });
    for (let step = 1; step <= 4; step += 1)
      f.dispatch({
        type: "sketch.geometryDragMoved",
        point: world([
          from[0] + ((to[0] - from[0]) * step) / 4,
          from[1] + ((to[1] - from[1]) * step) / 4,
        ]),
      });
    f.dispatch({ type: "sketch.geometryDragEnded", point: world(to) });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, pointId),
    });
    await f.settle();
  }

  /** The drag left the sketch exactly as it was: no action, same definition, same status. */
  function expectUnchanged(
    f: Fixture,
    labels: readonly string[],
    definition: SketchDefinition,
  ) {
    expect(f.undoLabels(), "no action").toEqual(labels);
    expect(f.session.definition, "the sketch is exactly as before").toEqual(
      definition,
    );
    expect(f.session.liveRegions.status).toBe("unavailable");
    expect(getSketchSessionInvalidFeedback(f.session)).toBe(TEXT);
  }

  /** Fit point `c` dragged to C: one action, the span valid, profiles back, no message. */
  function expectRecovered(
    f: Fixture,
    labels: readonly string[],
    b: SketchPointId,
    c: SketchPointId,
    before: SketchDefinition,
  ) {
    expect(f.undoLabels(), "one 'Move Sketch Geometry'").toEqual([
      ...labels,
      "Move Sketch Geometry",
    ]);
    expect(
      splineOf(f.session.definition).pointOccurrences,
      "the spline's authored occurrences are unchanged",
    ).toEqual(splineOf(before).pointOccurrences);
    expect(
      positionOf(f.session.definition, b),
      "the other fit point did not move (nothing separates them automatically)",
    ).toEqual(positionOf(before, b));
    const moved = positionOf(f.session.definition, c);
    expect(
      moved[0],
      "the dragged fit point is where it was dropped",
    ).toBeCloseTo(C[0], 9);
    expect(moved[1]).toBeCloseTo(C[1], 9);
    expect(
      getSketchDegenerateSplineSpans(
        f.session.liveSolve!.definition,
        f.session.liveSolve!.solvedSnapshot,
      ),
      "the span is no longer degenerate",
    ).toEqual([]);
    expect(f.session.liveRegions.status, "profiles are back").toBe("current");
    expect(f.session.liveRegions.regions).toHaveLength(1);
    expect(f.session.validationMessage, "the message is gone").toBeNull();
    expect(getSketchSessionInvalidFeedback(f.session)).toBeNull();
    expect(
      splineRenderable(f.session)?.regionValidity,
      "no tint",
    ).toBeUndefined();
  }

  for (const where of ["session", "reopened"] as const) {
    test(`fit point dragged onto its neighbour, ${where}: dragging it apart is one 'Move Sketch Geometry'; the span is valid, regions current, the message gone`, async () => {
      const { f, b, c } = await degenerate("drag", where);
      const labels = f.undoLabels();
      const before = f.session.definition;
      await glide(f, c, C);
      expectRecovered(f, labels, b, c, before);
      if (where === "session") {
        f.dispatch({ type: "history.undoRequested" });
        await f.settle();
        expectUnchanged(f, labels, before);
      }
    });

    test(`Coincident on the two fit points, ${where}: the drag keeps them together (refused, nothing changes); after deleting the Coincident, dragging one apart recovers the span`, async () => {
      const { f, b, c } = await degenerate("coincident", where);
      const held = f.session.definition;
      const heldLabels = f.undoLabels();
      await glide(f, c, C);
      expectUnchanged(f, heldLabels, held);

      const coincident = held.constraints.find(
        (constraint) => constraint.kind === "coincident",
      )!;
      f.dispatch({
        type: "viewport.selectionRequested",
        target: {
          kind: "constraint",
          sketchId: f.session.sketchId ?? "sketch_draft",
          constraintId: coincident.constraintId,
        } as never,
      });
      f.dispatch({ type: "sketch.annotationDeleteRequested" });
      await f.settle();
      expect(f.undoLabels(), "premise: the Coincident deleted").toEqual([
        ...heldLabels,
        "Delete Sketch Item",
      ]);
      expect(
        positionOf(f.session.definition, c),
        "premise: still together",
      ).toEqual(positionOf(f.session.definition, b));
      expect(f.session.liveRegions.status, "premise: still blocked").toBe(
        "unavailable",
      );

      const labels = f.undoLabels();
      const before = f.session.definition;
      await glide(f, c, C);
      expectRecovered(f, labels, b, c, before);
    });
  }

  test("a drag that keeps them together stays blocked: fit point 3 is also Fixed, so dragging it moves nothing and the sketch stays exactly as invalid; dragging fit point 2 apart then recovers", async () => {
    const { f, b, c } = await degenerate("drag", "session");
    f.dispatch({ type: "tool.activated", toolId: "constraintFix" });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, c),
    });
    f.dispatch({ type: "sketch.activeToolCleared" });
    await f.settle();
    const fixed = f.session.definition;
    const labels = f.undoLabels();
    expect(labels.at(-1), "premise").toBe("Fix Geometry");
    await glide(f, c, C);
    expectUnchanged(f, labels, fixed);

    // Fit point 2 is free: dragging it to C separates them.
    await glide(f, b, C);
    expect(f.undoLabels()).toEqual([...labels, "Move Sketch Geometry"]);
    expect(positionOf(f.session.definition, c)).toEqual(positionOf(fixed, c));
    expect(f.session.liveRegions.status).toBe("current");
    expect(f.session.validationMessage).toBeNull();
  });

  test("every other drag-start refusal is unchanged: dragging another point, or with a conflict besides the span", async () => {
    const { f, c, d } = await degenerate("drag", "reopened");
    const definition = f.session.definition;
    f.dispatch({
      type: "sketch.geometryDragStarted",
      target: pointRef(f.session, d),
      point: world(D),
    });
    expect(
      f.session.activeDrag,
      "another point: refused at the start",
    ).toBeNull();
    expect(f.session.validationMessage).toBe(
      `Geometry can't be dragged until the sketch solves: ${TEXT}`,
    );
    await glide(f, d, [3, 1]);
    expectUnchanged(f, [], definition);

    // Two conflicting Fixes besides the span: dragging fit point 3 is refused.
    const conflict = (id: string, position: P) => ({
      constraintId: `constraint_conflict_${id}`,
      kind: "fixPoint",
      label: `Conflicting fix ${id}`,
      pointId: splineOf(definition).pointOccurrences[0]!.pointId,
      position,
    });
    const conflicting = rebuildSessionForDefinition(f.session, {
      definition: {
        ...definition,
        constraintIds: [
          ...definition.constraintIds,
          "constraint_conflict_a",
          "constraint_conflict_b",
        ],
        constraints: [
          ...definition.constraints,
          conflict("a", A),
          conflict("b", [A[0], A[1] + 5]),
        ],
      } as SketchDefinition,
    });
    const g = await createSketchActionOwnerFixture(conflicting);
    g.dispatch({
      type: "sketch.geometryDragStarted",
      target: pointRef(g.session, c),
      point: world(B),
    });
    expect(g.session.activeDrag, "a conflict: refused at the start").toBeNull();
    // Review A-4: the conflict is explained first (the T17c3 feedback order).
    expect(g.session.validationMessage).toBe(
      "Geometry can't be dragged until the sketch solves: Fix 3, Conflicting fix a, Conflicting fix b conflict. The sketch is invalid; profiles from it are blocked. Change or delete one of them, or Undo.",
    );
  });
});

// Review R-1: a derived copy (mirror, linear/circular pattern, transform) of
// the seed spline has the same degenerate span, driven by the same two seed
// fit points. The copy's span is part of the same recovery: dragging a seed
// fit point apart separates both, in one "Move Sketch Geometry", in the
// session and after Finish → reopen.
describe("T17c5 review R-1: a spline with derived copies recovers by dragging a seed fit point apart", () => {
  type Fixture = Awaited<ReturnType<typeof createSketchActionOwnerFixture>>;
  const s1 = mirrorPid("s1");
  const s2 = mirrorPid("s2");

  /** The seed spline s0 → s1 → s2 and its copies, made degenerate by a Coincident on s1, s2 that is then deleted. */
  async function degenerateCopies(
    session: SketchSessionState,
    where: "session" | "reopened",
    joinCopy = false,
  ) {
    let f = await createSketchActionOwnerFixture(session);
    const regions = f.session.liveRegions.regions.length;
    // A Fix on s0: a constrained sketch, so no drag takes the unconstrained
    // fast path (a mirror always solves; a pattern or transform alone would not).
    f.dispatch({ type: "tool.activated", toolId: "constraintFix" });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, mirrorPid("s0")),
    });
    f.dispatch({ type: "sketch.activeToolCleared" });
    await f.settle();
    expect(
      f.session.definition.constraints.map((constraint) => constraint.kind),
      "premise: constrained",
    ).toContain("fixPoint");
    f.dispatch({ type: "tool.activated", toolId: "constraintCoincident" });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, s1),
    });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, s2),
    });
    f.dispatch({ type: "sketch.activeToolCleared" });
    await f.settle();
    const coincident = f.session.definition.constraints.find(
      (constraint) => constraint.kind === "coincident",
    )!;
    f.dispatch({
      type: "viewport.selectionRequested",
      target: {
        kind: "constraint",
        sketchId: f.session.sketchId ?? "sketch_draft",
        constraintId: coincident.constraintId,
      } as never,
    });
    f.dispatch({ type: "sketch.annotationDeleteRequested" });
    await f.settle();
    if (joinCopy) {
      // Review RR-1: a Coincident on the copy's own two span points.
      const output = f.session.definition
        .derivedRelationships!.flatMap((relationship) => relationship.outputs)
        .find((entry) => entry.seedEntityId === mirrorEid("s"))!;
      const copyOf = (seed: SketchPointId) =>
        output.outputPointIds[output.seedPointIds.indexOf(seed)]!;
      f.dispatch({ type: "tool.activated", toolId: "constraintCoincident" });
      for (const seed of [s1, s2])
        f.dispatch({
          type: "viewport.selectionRequested",
          target: pointRef(f.session, copyOf(seed)),
        });
      f.dispatch({ type: "sketch.activeToolCleared" });
      await f.settle();
      expect(
        f.session.definition.constraints.filter(
          (constraint) =>
            constraint.kind === "coincident" &&
            constraint.pointIds.includes(copyOf(s1)) &&
            constraint.pointIds.includes(copyOf(s2)),
        ),
        "premise: the copy's two span points are joined by a Coincident",
      ).toHaveLength(1);
    }
    if (where === "reopened") {
      const saved = await finish(f.session.commitRequest!.definition);
      const file = JSON.parse(JSON.stringify(saved)) as SketchSnapshotRecord;
      f = await createSketchActionOwnerFixture(
        createSketchSessionFromSnapshot(file, OCC_KERNEL_SETTINGS),
      );
    }
    const spans = getSketchDegenerateSplineSpans(
      f.session.liveSolve!.definition,
      f.session.liveSolve!.solvedSnapshot,
    );
    expect(
      new Set(spans.map((span) => span.spline.entityId)).size,
      "premise: the seed and its copy are degenerate",
    ).toBeGreaterThanOrEqual(2);
    expect(f.session.liveRegions.status, "premise: blocked").toBe(
      "unavailable",
    );
    return { f, regions };
  }

  async function glideApart(f: Fixture) {
    const from = positionOf(f.session.definition, s2);
    const to: P = [12, 2];
    f.dispatch({
      type: "sketch.geometryDragStarted",
      target: pointRef(f.session, s2),
      point: world(from as unknown as P),
    });
    for (let step = 1; step <= 4; step += 1)
      f.dispatch({
        type: "sketch.geometryDragMoved",
        point: world([
          from[0] + ((to[0] - from[0]) * step) / 4,
          from[1] + ((to[1] - from[1]) * step) / 4,
        ]),
      });
    f.dispatch({ type: "sketch.geometryDragEnded", point: world(to) });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, s2),
    });
    await f.settle();
  }

  function expectRecovered(
    f: Fixture,
    labels: readonly string[],
    regions: number,
  ) {
    expect(f.undoLabels(), "one 'Move Sketch Geometry'").toEqual([
      ...labels,
      "Move Sketch Geometry",
    ]);
    expect(
      getSketchDegenerateSplineSpans(
        f.session.liveSolve!.definition,
        f.session.liveSolve!.solvedSnapshot,
      ),
      "neither the seed nor its copies are degenerate",
    ).toEqual([]);
    expect(f.session.liveRegions.status).toBe("current");
    expect(f.session.liveRegions.regions).toHaveLength(regions);
    expect(f.session.validationMessage).toBeNull();
  }

  for (const where of ["session", "reopened"] as const)
    test(`mirror, ${where}: dragging seed fit point s2 apart recovers the seed and the mirrored copy`, async () => {
      const { f, regions } = await degenerateCopies(
        mirroredSession("free").session,
        where,
      );
      const labels = f.undoLabels();
      await glideApart(f);
      expectRecovered(f, labels, regions);
    });

  /** The seed sketch with one pattern or transform copy of spline s. */
  function copied(
    toolId: "sketchLinearPattern" | "sketchCircularPattern" | "sketchTransform",
  ) {
    const base = mirroredSession("free").session;
    const seedOnly = rebuildSessionForDefinition(base, {
      definition: mirrorSeedDefinition([]),
    });
    let tool = beginSketchTool(seedOnly, toolId);
    tool = selectSketchEditToolTarget(tool, mirrorEntityTarget("s") as never);
    tool = patchSketchEditToolValue(tool, {
      value: toolId === "sketchCircularPattern" ? Math.PI / 2 : 20,
    });
    tool = patchSketchEditToolValue(tool, {
      intent: "commitSketchEditOperator",
    });
    expect(
      tool.definition.derivedRelationships?.map((entry) => entry.kind),
      "premise: one copy relationship",
    ).toHaveLength(1);
    return { ...tool, activeTool: null, activeEditTool: null };
  }

  for (const toolId of [
    "sketchLinearPattern",
    "sketchCircularPattern",
    "sketchTransform",
  ] as const)
    for (const where of ["session", "reopened"] as const)
      test(`${toolId}, ${where}: dragging seed fit point s2 apart recovers the seed and its copy`, async () => {
        const { f, regions } = await degenerateCopies(copied(toolId), where);
        const labels = f.undoLabels();
        await glideApart(f);
        expectRecovered(f, labels, regions);
      });

  // Review RR-1: a join on the copy's own span ends holds the copy span
  // together through the derivation (within the solve's tolerance), so the
  // drag keeps today's refusal, as for a join on the seed's ends.
  for (const [name, make] of [
    ["mirror", () => mirroredSession("free").session],
    ["sketchLinearPattern", () => copied("sketchLinearPattern")],
  ] as const)
    for (const where of ["session", "reopened"] as const)
      test(`${name}, ${where}: a Coincident on the copy's two span points keeps the refusal (nothing moves, no action)`, async () => {
        const { f } = await degenerateCopies(make(), where, true);
        const labels = f.undoLabels();
        const definition = f.session.definition;
        await glideApart(f);
        expect(f.undoLabels(), "no action").toEqual(labels);
        expect(f.session.definition, "nothing moved").toEqual(definition);
        expect(f.session.liveRegions.status).toBe("unavailable");
      });
});

// T17c6 (D-3; T17i review §4): in a constrained sketch the release frame's
// exact-reach step (T13a2 d1) runs for any nonzero lag, so a reachable drop
// lands exactly at the cursor. Before, it ran only when the lag exceeded
// the 1e-4 reach tolerance, and a fit point dropped on its neighbour on a
// drawn outline (inferred coincidences) landed ~1e-9 away: no degenerate
// span, no status, the region gone silently. An unreachable drop keeps the
// accepted lagging frame (the pin is rejected by the frame acceptance).
describe("T17c6 D-3: a release in a constrained sketch reaches the cursor exactly when it can", () => {
  const { L0, F2 } = MIXED_OUTLINE;
  const MIXED_TEXT =
    "Spline 3 has two consecutive fit points at the same place (Spline 3 point 2 and Spline 3 point 3); the sketch's profiles are blocked. Undo, or drag one of them apart (delete the Coincident between them first, if there is one).";

  async function mixedOutline() {
    const f = await createSketchActionOwnerFixture(drawnMixedOutlineSession());
    expect(
      f.session.definition.entities.map((entity) => entity.kind),
      "premise: a line, an arc and a spline",
    ).toEqual(["lineSegment", "arc", "spline"]);
    expect(
      f.session.definition.constraints.map((constraint) => constraint.kind),
      "premise: a constrained sketch (inferred, as drawn in the browser)",
    ).toContain("coincident");
    expect(f.session.liveRegions.status, "premise: one region").toBe("current");
    expect(f.session.liveRegions.regions).toHaveLength(1);
    const [, f2, f3] = splineOf(f.session.definition).pointOccurrences.map(
      (occurrence) => occurrence.pointId as SketchPointId,
    );
    return { f, f2: f2!, f3: f3!, before: f.session.definition };
  }

  /** Glides `pointId` in 8 frames to `to` and releases there. */
  function glideTo(
    f: Awaited<ReturnType<typeof createSketchActionOwnerFixture>>,
    pointId: SketchPointId,
    to: P,
  ) {
    const from = positionOf(f.session.definition, pointId);
    f.dispatch({
      type: "sketch.geometryDragStarted",
      target: pointRef(f.session, pointId),
      point: world(from as unknown as P),
    });
    for (let step = 1; step <= 8; step += 1)
      f.dispatch({
        type: "sketch.geometryDragMoved",
        point: world([
          from[0] + ((to[0] - from[0]) * step) / 8,
          from[1] + ((to[1] - from[1]) * step) / 8,
        ]),
      });
    f.dispatch({ type: "sketch.geometryDragEnded", point: world(to) });
    return f.settle();
  }

  test("fit point 3 dropped on fit point 2: exactly on it, one 'Move Sketch Geometry', the label-based degenerate status, profiles blocked, the spline drawn tinted; Undo restores the drawn outline exactly, Redo the exact drop", async () => {
    const { f, f2, f3, before } = await mixedOutline();
    await glideTo(f, f3, F2);
    expect(f.undoLabels()).toEqual(["Move Sketch Geometry"]);
    const dropped = f.session.definition;
    expect(
      positionOf(dropped, f3),
      "the dropped fit point is exactly on its neighbour",
    ).toEqual(positionOf(dropped, f2));
    expect(positionOf(dropped, f2), "the neighbour did not move").toEqual(
      positionOf(before, f2),
    );
    expect(f.session.liveRegions.status, "the profiles are blocked").toBe(
      "unavailable",
    );
    expect(f.session.validationMessage, "the shown status").toBe(MIXED_TEXT);
    expect(getSketchSessionInvalidFeedback(f.session)).toBe(MIXED_TEXT);
    expect(
      splineRenderable(f.session)?.regionValidity,
      "the spline stays drawn, tinted",
    ).toBe("invalid");

    f.dispatch({ type: "history.undoRequested" });
    await f.settle();
    expect(f.session.definition.points, "Undo is exact").toEqual(before.points);
    expect(f.session.liveRegions.status).toBe("current");
    expect(f.session.liveRegions.regions).toHaveLength(1);
    expect(f.session.validationMessage).toBeNull();
    f.dispatch({ type: "history.redoRequested" });
    await f.settle();
    expect(f.session.definition.points, "Redo is exact").toEqual(
      dropped.points,
    );
    expect(getSketchSessionInvalidFeedback(f.session)).toBe(MIXED_TEXT);
  });

  test("a reachable drop elsewhere lands exactly at the cursor; the region stays", async () => {
    const { f, f3 } = await mixedOutline();
    const to: P = [3.0137, 3.9071];
    await glideTo(f, f3, to);
    expect(f.undoLabels()).toEqual(["Move Sketch Geometry"]);
    expect(
      positionOf(f.session.definition, f3),
      "exactly where it was dropped",
    ).toEqual(to);
    expect(f.session.liveRegions.status).toBe("current");
    expect(f.session.liveRegions.regions).toHaveLength(1);
    expect(f.session.validationMessage).toBeNull();
  });

  test("an unreachable drop keeps the accepted lagging frame: the line's end, with its start Fixed and the line Horizontal, slides along the line and stays off the cursor", async () => {
    const { f } = await mixedOutline();
    const line = f.session.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    ) as Extract<SketchEntityDefinition, { kind: "lineSegment" }>;
    expect(
      f.session.definition.constraints.map((constraint) => constraint.kind),
      "premise: the line is Horizontal",
    ).toContain("horizontal");
    f.dispatch({ type: "tool.activated", toolId: "constraintFix" });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, line.startPointId),
    });
    f.dispatch({ type: "sketch.activeToolCleared" });
    await f.settle();
    const labels = f.undoLabels();
    expect(labels.at(-1), "premise").toBe("Fix Geometry");
    const to: P = [5.9, 0.8];
    await glideTo(f, line.endPointId, to);
    expect(f.undoLabels(), "one action").toEqual([
      ...labels,
      "Move Sketch Geometry",
    ]);
    const end = positionOf(f.session.definition, line.endPointId);
    expect(
      Math.abs(end[1] - L0[1]),
      "the end stays on the Horizontal through the Fixed start",
    ).toBeLessThan(1e-6);
    expect(
      Math.abs(end[0] - to[0]),
      "it follows the cursor along the line",
    ).toBeLessThan(1e-3);
    expect(
      Math.hypot(end[0] - to[0], end[1] - to[1]),
      "not pinned at the unreachable cursor",
    ).toBeGreaterThan(0.4);
    expect(f.session.liveRegions.status).toBe("current");
    expect(f.session.validationMessage).toBeNull();
  });
});
