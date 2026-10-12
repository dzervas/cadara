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
import { entityRef, pointRef } from "@/domain/editor/sketch-mirror.fixtures";
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
  selectSketchEditTarget,
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
import { createSketchActionOwnerFixture } from "./sketch-action-owner.fixtures";

type P = readonly [number, number];
type Spline = Extract<SketchEntityDefinition, { kind: "spline" }>;

// Four fit points A → B → C → D, closed by a line D → A snapped onto the
// spline's ends: one region. C is dragged straight left onto B.
const A: P = [0.5, 0.25];
const B: P = [1, 1];
const C: P = [2, 1];
const D: P = [3, 0.125];

const TEXT =
  "Spline 1 has two consecutive fit points at the same place (Spline 1 point 2 and Spline 1 point 3); the sketch's profiles are blocked. Undo, or delete the spline and draw it again.";

function loop(): SketchSessionState {
  let session = withSketchSnapScale(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
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

// Review F-1: the text promises only what works in a sketch with a
// constraint (here a Fix on point 1, besides the line's inferred one).
// Dragging the points apart is refused there (the drag solve compiles the
// authored definition, which is invalid), and removing the Coincident leaves
// them together, so neither is promised. Undo works in the session; after
// Finish → reopen (no Undo history) deleting the spline unblocks the sketch.
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
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
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
      "Spline 1 has two consecutive fit points at the same place (Spline 1 point 4 and Spline 1 point 1); the sketch's profiles are blocked. Undo, or delete the spline and draw it again.",
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
