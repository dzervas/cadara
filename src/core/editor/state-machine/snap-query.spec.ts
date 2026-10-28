import { describe, expect, test } from "vitest";

import { runEditorEffect } from "@/application/editor/effect-registry";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { SketchEntityId } from "@/contracts/shared/ids";
import { querySketchEditIntersections } from "@/contracts/sketch/edit-intersections";
import type { SketchToolId } from "@/core/sketch-tools/definition";
import { getSketchToolDefinition } from "@/core/sketch-tools/registry";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  finalizeSketchDraw,
  startSketchDraw,
  updateSketchPointer,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/core/editor/sketch-session/test-snap-scale";
import { querySketchSnapIntersectionsForTest } from "@/application/editor/state-machine-test-builder";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { emitPendingSketchSnapQuery } from "./effect-emitters";
import { transitionEditorState } from "./reducer-root";
import { initialEditorState } from "./state-creators";
import type {
  EditorEffect,
  EditorEffectRuntime,
  SketchEditorState,
} from "./types";

// Logic lane (core seam): T13i (D24 with T13 review R-3), spline
// intersection snaps through the post-transition emitter, the effect
// executor and the result handlers, read back through the session's draw
// API: what the hover shows (`toolPresentation` overlays) and what the
// click commits (the definition).

type SnapEffect = Extract<
  EditorEffect,
  { type: "sketch.querySnapIntersections" }
>;
type Click = readonly [number, number];

const runtime = {
  querySketchSnapIntersections: querySketchSnapIntersectionsForTest,
} as EditorEffectRuntime;

/** Draws `clicks` free (no snap scale yet); a fit-point tool is finalized. */
function drawFree(
  session: SketchSessionState,
  toolId: SketchToolId,
  clicks: Click[],
) {
  let current = beginSketchTool(session, toolId);
  clicks.forEach((click, index) => {
    current =
      index === 0
        ? startSketchDraw(current, [...click])
        : acceptSketchDraw(current, [...click]);
  });
  return typeof getSketchToolDefinition(toolId).lifecycle === "object"
    ? finalizeSketchDraw(current)
    : current;
}

/** Spline (0,0)→(2,3)→(4,0) and the given other curve, Line armed. */
async function stateWith(
  other: (session: SketchSessionState) => SketchSessionState,
) {
  let session = enterSketchSession(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
  session = drawFree(session, "spline", [
    [0, 0],
    [2, 3],
    [4, 0],
  ]);
  session = other(session);
  const state: SketchEditorState = {
    ...initialEditorState,
    kind: "editingSketch",
    mode: "sketch",
    snapshot: await createSeedDocumentSnapshot(),
    document: { documentId: "doc_workspace", revisionId: "rev_1" },
    command: {
      commandSessionId: "command_snap",
      toolId: "sketch",
      phase: "editing",
    },
    session: withSketchSnapScale(
      beginSketchTool(session, "line"),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    ),
    pendingCommitRequestId: null,
    pendingProjectionRequestId: null,
    pendingRegionRequest: null,
  };
  return state;
}

const verticalLine = (session: SketchSessionState) =>
  drawFree(session, "line", [
    [1, -1],
    [1, 4],
  ]);

function snapEffects(effects: readonly EditorEffect[]) {
  return effects.filter(
    (effect): effect is SnapEffect =>
      effect.type === "sketch.querySnapIntersections",
  );
}

function emit(state: SketchEditorState) {
  const result = emitPendingSketchSnapQuery({ state, effects: [] });
  return {
    state: result.state as SketchEditorState,
    effects: snapEffects(result.effects),
  };
}

async function answer(state: SketchEditorState, effect: SnapEffect) {
  const result = transitionEditorState(
    state,
    await runEditorEffect(effect, runtime),
  );
  return result.state as SketchEditorState;
}

const entityOf = (session: SketchSessionState, kind: string) =>
  session.definition.entities.filter((entity) => entity.kind === kind);

/** The service's own `intersect` cuts on `targetEntityId`, on the live basis. */
async function serviceCuts(
  session: SketchSessionState,
  targetEntityId: SketchEntityId,
) {
  const liveSolve = session.liveSolve!;
  const result = await querySketchEditIntersections(
    {
      definition: liveSolve.definition,
      solvedSnapshot: liveSolve.solvedSnapshot,
      projectedReferences: liveSolve.projectedReferences,
      modelingTolerance: session.modelingTolerance,
      operation: { kind: "intersect", targetEntityId },
    },
    createCertifiedNeutralCurveQueryCapabilityForTest(),
  );
  if (result.kind !== "verified") throw new Error(JSON.stringify(result));
  return result.cuts;
}

/** What the viewport shows at the pointer: glyph kind, label and the inferred detail. */
function shown(session: SketchSessionState) {
  const overlays = session.toolPresentation?.overlays ?? [];
  const glyph = overlays.find((overlay) => overlay.id === "active-snap");
  const preview = overlays.find(
    (overlay) => overlay.id === "active-snap-inferred-constraint",
  );
  return {
    candidateKind: glyph?.kind === "snapIndicator" ? glyph.candidateKind : null,
    detail: preview?.kind === "constraintPreview" ? preview.detail : null,
  };
}

/** The relations a Line started at `start` authored on its start point. */
function lineStartRelations(
  before: SketchSessionState,
  start: SketchPoint,
  end: SketchPoint,
) {
  const after = acceptSketchDraw(startSketchDraw(before, start), end);
  const line = after.definition.entities.find(
    (entity) =>
      entity.kind === "lineSegment" &&
      !before.definition.entities.some(
        (old) => old.entityId === entity.entityId,
      ),
  );
  if (line?.kind !== "lineSegment") throw new Error("no new line");
  const oldIds = new Set(
    before.definition.constraints.map(({ constraintId }) => constraintId),
  );
  return after.definition.constraints
    .filter(({ constraintId }) => !oldIds.has(constraintId))
    .map((constraint) =>
      constraint.kind === "pointOnCurve" &&
      constraint.point.pointId === line.startPointId
        ? `pointOnCurve:${constraint.curve.entityId}`
        : constraint.kind,
    )
    .sort();
}

/**
 * Hover near the first service cut on the spline: the shown candidate is
 * the intersection at the cut's exact position, its text names both
 * curves, and the click authors exactly those two `pointOnCurve`.
 */
async function expectCrossingRow(
  other: (session: SketchSessionState) => SketchSessionState,
  otherKind: string,
) {
  const state = await stateWith(other);
  const [spline] = entityOf(state.session, "spline");
  const otherCurve = entityOf(state.session, otherKind).at(-1)!;
  const emitted = emit(state);
  expect(emitted.effects).toHaveLength(1);
  const ready = await answer(emitted.state, emitted.effects[0]!);
  const [cut] = (await serviceCuts(ready.session, spline!.entityId)).filter(
    (candidate) =>
      candidate.cutters.some(
        (cutter) => cutter.entityId === otherCurve.entityId,
      ),
  );
  expect(
    cut,
    `the service cuts the spline with the ${otherKind}`,
  ).toBeDefined();
  const near: SketchPoint = [cut!.position[0] + 0.01, cut!.position[1] - 0.01];
  const hovered = updateSketchPointer(ready.session, near);
  expect(hovered.activeInference?.candidate?.kind).toBe("intersection");
  expect(
    hovered.activeInference?.position,
    "the placement is the service's exact cut position (bitwise)",
  ).toEqual(cut!.position);
  const named = [`On ${spline!.label}`, `On ${otherCurve.label}`].sort();
  expect(shown(hovered).candidateKind).toBe("intersection");
  expect(shown(hovered).detail?.split(", ").sort()).toEqual(named);
  expect(
    lineStartRelations(hovered, near, [near[0] + 3, near[1] + 5]),
    "the click commits the two shown pointOnCurve",
  ).toEqual(
    [
      `pointOnCurve:${spline!.entityId}`,
      `pointOnCurve:${otherCurve.entityId}`,
    ].sort(),
  );
  return ready;
}

describe("T13i spline intersection snaps (editor loop)", () => {
  test("one background query per accepted basis on the snapQuery effect (idempotent); while pending no spline intersection is offered", async () => {
    const state = await stateWith(verticalLine);
    const [spline] = entityOf(state.session, "spline");
    const emitted = emit(state);
    expect(emitted.effects).toHaveLength(1);
    expect(emitted.effects[0]).toMatchObject({
      type: "sketch.querySnapIntersections",
      background: true,
      queryId: expect.stringMatching(/^snap-query-/),
      input: {
        targetEntityIds: [spline!.entityId],
        solvedSnapshot: state.session.liveSolve!.solvedSnapshot,
      },
    });
    expect(emitted.state.session.snapIntersections).toMatchObject({
      status: "pending",
      solvedSnapshot: state.session.liveSolve!.solvedSnapshot,
    });
    expect(
      emit(emitted.state).effects,
      "Idempotent: the same basis is not queried again.",
    ).toEqual([]);
    expect(emit(emitted.state).state).toBe(emitted.state);

    const [cut] = await serviceCuts(state.session, spline!.entityId);
    const pending = updateSketchPointer(emitted.state.session, [
      cut!.position[0] + 0.01,
      cut!.position[1] - 0.01,
    ]);
    expect(
      pending.activeInference?.candidate?.kind,
      "pending: no spline intersection (no approximation)",
    ).not.toBe("intersection");
    expect(shown(pending).candidateKind).not.toBe("intersection");

    // The result arrives while the pointer rests on the crossing: the
    // preview is recomputed without pointer motion.
    const ready = await answer(
      { ...emitted.state, session: pending },
      emitted.effects[0]!,
    );
    expect(ready.pendingSnapQueryRequest).toBeNull();
    expect(ready.session.snapIntersections?.status).toBe("ready");
    expect(ready.session.activeInference?.candidate?.kind).toBe("intersection");
    expect(ready.session.activeInference?.position).toEqual(cut!.position);
    expect(shown(ready.session).candidateKind).toBe("intersection");
    expect(emit(ready).effects, "a ready basis is not queried again").toEqual(
      [],
    );
  });

  test("spline × line: the candidate is the exact cut; the shown two pointOnCurve are committed", async () => {
    await expectCrossingRow(verticalLine, "lineSegment");
  });

  test("spline × arc: the candidate is the exact cut; the shown two pointOnCurve are committed", async () => {
    await expectCrossingRow(
      (session) =>
        drawFree(session, "threePointArc", [
          [-1, 1],
          [5, 1],
          [2, -0.5],
        ]),
      "arc",
    );
  });

  test("spline × spline: the candidate is the exact cut (each crossing offered once); the shown two pointOnCurve are committed", async () => {
    // A flat spline crossing the arch twice (a cheap certified pair).
    const flatSpline = (session: SketchSessionState) =>
      drawFree(session, "spline", [
        [-1, 1],
        [2, 1.2],
        [5, 1],
      ]);
    const ready = await expectCrossingRow(flatSpline, "spline");
    const splines = entityOf(ready.session, "spline");
    expect(
      [...ready.session.snapIntersections!.input!.targetEntityIds].sort(),
      "both splines are targets",
    ).toEqual(splines.map(({ entityId }) => entityId).sort());
    const intersections = ready.session.snapIntersections!.intersections;
    expect(intersections, "two crossings, each offered once").toHaveLength(2);
    expect(
      intersections.every(
        ({ sources }) =>
          new Set(
            sources.map((source) =>
              source.kind === "localEntity" ? source.entityId : null,
            ),
          ).size === 2,
      ),
    ).toBe(true);
  }, 60_000);

  test("review A-3: spline × line crossings are offered first; spline × spline follows in a second stage on the snapQuery lane", async () => {
    const state = await stateWith((session) =>
      drawFree(
        drawFree(session, "spline", [
          [-1, 1],
          [2, 1.2],
          [5, 1],
        ]),
        "line",
        [
          [2.5, -1],
          [2.5, 4],
        ],
      ),
    );
    const [arch, flat] = entityOf(state.session, "spline");
    const [line] = entityOf(state.session, "lineSegment");
    const first = emit(state);
    expect(first.effects).toHaveLength(1);
    expect(first.effects[0]!.input).toMatchObject({ cutters: "curves" });
    expect([...first.effects[0]!.input.targetEntityIds].sort()).toEqual(
      [arch!.entityId, flat!.entityId].sort(),
    );

    // The answer's own transition issues the next stage (post-transition hook).
    const stagedResult = transitionEditorState(
      first.state,
      await runEditorEffect(first.effects[0]!, runtime),
    );
    const staged = stagedResult.state as SketchEditorState;
    const secondEffects = snapEffects(stagedResult.effects);
    const offered = (session: SketchSessionState) =>
      session.snapIntersections!.intersections.map(({ sources }) =>
        sources
          .map((source) =>
            source.kind === "localEntity" ? source.entityId : null,
          )
          .sort()
          .join("×"),
      );
    expect(staged.session.snapIntersections?.status).toBe("pending");
    expect(
      offered(staged.session).sort(),
      "the line's crossings are offered while spline × spline is pending",
    ).toEqual(
      [
        [arch!.entityId, line!.entityId].sort().join("×"),
        [flat!.entityId, line!.entityId].sort().join("×"),
      ].sort(),
    );
    const [lineCut] = (
      await serviceCuts(staged.session, arch!.entityId)
    ).filter((cut) => cut.cutters.some((c) => c.entityId === line!.entityId));
    expect(
      updateSketchPointer(staged.session, [
        lineCut!.position[0] + 0.01,
        lineCut!.position[1] - 0.01,
      ]).activeInference?.position,
    ).toEqual(lineCut!.position);

    expect(secondEffects).toHaveLength(1);
    expect(secondEffects[0]!.input).toMatchObject({ cutters: "splines" });
    expect(staged.pendingSnapQueryRequest?.queryId).toBe(
      secondEffects[0]!.queryId,
    );
    expect(emit(staged).effects, "issued once").toEqual([]);
    const ready = await answer(staged, secondEffects[0]!);
    expect(ready.session.snapIntersections?.status).toBe("ready");
    const pair = [arch!.entityId, flat!.entityId].sort().join("×");
    expect(
      offered(ready.session).filter((key) => key === pair),
      "then the two spline crossings",
    ).toHaveLength(2);
    expect(emit(ready).effects).toEqual([]);
  }, 60_000);

  test("a new basis issues a new query; the old basis's result is dropped and its candidates are no longer offered", async () => {
    const state = await stateWith(verticalLine);
    const first = emit(state);
    const ready = await answer(first.state, first.effects[0]!);
    expect(ready.session.snapIntersections?.intersections).toHaveLength(1);

    // A committed line elsewhere is a new accepted basis.
    const edited = {
      ...ready,
      session: beginSketchTool(
        drawFree(ready.session, "line", [
          [10, 10],
          [11, 10],
        ]),
        "line",
      ),
    };
    const second = emit(edited);
    expect(second.effects).toHaveLength(1);
    expect(second.effects[0]!.queryId).not.toBe(first.effects[0]!.queryId);
    const [cut] = await serviceCuts(
      edited.session,
      entityOf(state.session, "spline")[0]!.entityId,
    );
    const hover = updateSketchPointer(second.state.session, [
      cut!.position[0] + 0.01,
      cut!.position[1] - 0.01,
    ]);
    expect(
      hover.activeInference?.candidate?.kind,
      "pending for the new basis: the old basis's crossing is not offered",
    ).not.toBe("intersection");

    // The superseded first query's result (or a late duplicate) is dropped.
    const late = transitionEditorState(
      second.state,
      await runEditorEffect(first.effects[0]!, runtime),
    ).state as SketchEditorState;
    expect(late.session.snapIntersections).toBe(
      second.state.session.snapIntersections,
    );
    expect(late.pendingSnapQueryRequest).toBe(
      second.state.pendingSnapQueryRequest,
    );
    const current = await answer(second.state, second.effects[0]!);
    expect(current.session.snapIntersections?.status).toBe("ready");
    expect(
      updateSketchPointer(current.session, [
        cut!.position[0] + 0.01,
        cut!.position[1] - 0.01,
      ]).activeInference?.candidate?.kind,
    ).toBe("intersection");
  });

  test("a cache is served only for its own basis: a session whose live solve moved does not offer the old crossing", async () => {
    const state = await stateWith(verticalLine);
    const emitted = emit(state);
    const ready = await answer(emitted.state, emitted.effects[0]!);
    const [old] = ready.session.snapIntersections!.intersections;
    expect(old).toBeDefined();
    // The same sketch with the line at x = 3 instead (another basis), still
    // carrying the first basis's ready cache (e.g. restored session state).
    const moved = await stateWith((session) =>
      drawFree(session, "line", [
        [3, -1],
        [3, 4],
      ]),
    );
    const carried = {
      ...moved.session,
      snapIntersections: ready.session.snapIntersections,
    };
    const hover = updateSketchPointer(carried, [
      old!.point[0] + 0.01,
      old!.point[1] - 0.01,
    ]);
    expect(hover.activeInference?.candidate?.kind).not.toBe("intersection");
    expect(
      emit({ ...moved, session: carried }).effects,
      "the carried cache's basis is stale: the current basis is queried",
    ).toHaveLength(1);
  });

  test("a crossing exactly at a fit point is an endpoint contact (the fit point), not offered as an intersection", async () => {
    const state = await stateWith((session) =>
      drawFree(
        drawFree(session, "line", [
          [2, -1],
          [2, 5],
        ]),
        "line",
        [
          [3, -2],
          [3, 0],
        ],
      ),
    );
    // Line 2 crosses the spline exactly at its fit point (2, 3); Line 3's
    // box meets the spline's but it does not reach the curve.
    const emitted = emit(state);
    const ready = await answer(emitted.state, emitted.effects[0]!);
    const [spline] = entityOf(state.session, "spline");
    const cuts = await serviceCuts(ready.session, spline!.entityId);
    expect(cuts.map((cut) => cut.knotOccurrenceIndex)).toEqual([1]);
    expect(ready.session.snapIntersections?.intersections).toEqual([]);
  });

  test("no spline box meets another curve: no request, an empty ready cache", async () => {
    const state = await stateWith((session) =>
      drawFree(session, "line", [
        [10, 10],
        [11, 10],
      ]),
    );
    const emitted = emit(state);
    expect(emitted.effects).toEqual([]);
    expect(emitted.state.session.snapIntersections).toMatchObject({
      status: "ready",
      input: null,
      intersections: [],
    });
  });

  test("a failed query offers nothing for its basis and is not retried", async () => {
    const state = await stateWith(verticalLine);
    const emitted = emit(state);
    const effect = emitted.effects[0]!;
    const failed = transitionEditorState(emitted.state, {
      type: "effect.sketchSnapIntersectionsQueryFailed",
      requestId: effect.requestId,
      documentId: effect.documentId,
      commandSessionId: effect.commandSessionId,
      baseRevisionId: effect.baseRevisionId,
      queryId: effect.queryId,
      message: "worker failed",
    }).state as SketchEditorState;
    expect(failed.session.snapIntersections?.status).toBe("failed");
    expect(failed.pendingSnapQueryRequest).toBeNull();
    expect(emit(failed).effects).toEqual([]);
  });
});
