import { describe, expect, test } from "vitest";

import { createSketchActionOwnerFixture } from "@/application/editor/sketch-action-owner.fixtures";
import { prepareSketchIntersectionEdit } from "@/core/editor/sketch-session/edit-queries";
import { runEditorEffect } from "@/application/editor/effect-registry";
import { SketchRegionDerivationSupersededError } from "@/domain/solver/sketch-constraint-solver-adapter";
import { SketchRegionDerivationWorkerPool } from "@/domain/modeling/occ/sketch-derivation-worker-client";
import { FakeDerivationWorker } from "@/domain/modeling/occ/sketch-derivation-worker.fixtures";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  selectSketchEditToolTarget,
  startSketchDraw,
  withLiveSolveBasis,
  updateSketchPointer,
  updateSketchEditToolHover,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import {
  editQueryStaleMessage,
  TRIM_STALE_MESSAGE,
} from "@/core/editor/sketch-session/edit-queries";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import { querySketchEditIntersectionsForTest } from "@/domain/editor/state-machine-test-builder";
import type { SketchEntityId, SketchId } from "@/contracts/shared/ids";
import { emitPendingSketchEditQuery } from "./effect-emitters";
import { transitionEditorState } from "./reducer-root";
import { initialEditorState } from "./state-creators";
import type {
  EditorEffect,
  EditorEffectRuntime,
  EditorEvent,
  SketchEditorState,
} from "./types";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/core/editor/sketch-session/test-snap-scale";

// Logic lane (core seam): the Trim tool's exact edit query through the
// post-transition emitter, the effect executor and the result handlers
// (T10g-1, design §2.7 with review R-1/R-5, A-4).

type QueryEffect = Extract<
  EditorEffect,
  { type: "sketch.queryEditIntersections" }
>;

const draw = (
  session: SketchSessionState,
  start: [number, number],
  end: [number, number],
) =>
  acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "line"), start),
    end,
  );

/** A horizontal target (0,0)→(4,0) crossed by vertical lines at x = 1 and 3. */
async function trimState() {
  let session = withSketchSnapScale(
    enterSketchSession(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  session = draw(session, [0, 0], [4, 0]);
  const target = session.definition.entities[0]!.entityId;
  session = draw(session, [1, -1], [1, 1]);
  session = draw(session, [3, -1], [3, 1]);
  const state: SketchEditorState = {
    ...initialEditorState,
    kind: "editingSketch",
    mode: "sketch",
    snapshot: await createSeedDocumentSnapshot(),
    document: { documentId: "doc_workspace", revisionId: "rev_1" },
    command: {
      commandSessionId: "command_trim",
      toolId: "sketch",
      phase: "editing",
    },
    session: beginSketchTool(session, "trim"),
    pendingCommitRequestId: null,
    pendingProjectionRequestId: null,
    pendingRegionRequest: null,
  };
  return { state, target };
}

function click(state: SketchEditorState, entityId: SketchEntityId) {
  const session = selectSketchEditToolTarget(state.session, {
    kind: "sketchEntity",
    sketchId: state.session.actionContextId,
    entityId,
  });
  return emitPendingSketchEditQuery({
    state: { ...state, session },
    effects: [],
  });
}

function queryEffects(effects: readonly EditorEffect[]) {
  return effects.filter(
    (effect): effect is QueryEffect =>
      effect.type === "sketch.queryEditIntersections",
  );
}

const runtime = {
  querySketchEditIntersections: querySketchEditIntersectionsForTest,
} as EditorEffectRuntime;

async function answer(state: SketchEditorState, effect: QueryEffect) {
  return transitionEditorState(state, await runEditorEffect(effect, runtime));
}

const sketchState = (result: { state: unknown }) => {
  const state = result.state as SketchEditorState;
  expect(state.kind).toBe("editingSketch");
  return state;
};

describe("T10g-1 Trim edit query (editor loop)", () => {
  test("O14: one Undo restores an end trim and Redo restores the clicked removal", async () => {
    const { state, target } = await trimState();
    const f = await createSketchActionOwnerFixture(state.session);
    const before = f.session.definition;
    const basis = prepareSketchIntersectionEdit(f.session, {kind: "trim", targetEntityId: target, pick: [0.5, 0]});
    if ("message" in basis) throw Error(basis.message);
    f.dispatch({ type: "sketch.intersectionEditCompleted", basis,
      result: await querySketchEditIntersectionsForTest({ requestId: "request_trim_undo",
        documentId: f.state.document.documentId!, baseRevisionId: f.state.document.revisionId!,
        sketchId: f.session.sketchId ?? ("sketch_draft" as SketchId), input: basis.input }) });
    const after = f.session.definition;
    const line = after.entities.find(e => e.entityId === target);
    expect(line?.kind === "lineSegment" && after.points.find(p => p.pointId === line.startPointId)?.position).toEqual([1, 0]);
    expect(f.undoLabels()).toHaveLength(1);
    f.dispatch({ type: "history.undoRequested" });
    expect(f.session.definition).toEqual(before);
    f.dispatch({ type: "history.redoRequested" });
    expect(f.session.definition).toEqual(after);
  });

  test("O14: hover stages the clicked end, moving picks the other piece, and click authors only that piece", async () => {
    const { state, target } = await trimState();
    const ref = { kind: "sketchEntity" as const, sketchId: state.session.actionContextId, entityId: target };
    let session = updateSketchEditToolHover(updateSketchPointer(state.session, [0.5, 0]), ref);
    let emitted = emitPendingSketchEditQuery({ state: { ...state, session }, effects: [] });
    const first = queryEffects(emitted.effects)[0]!;
    expect(first.input.operation).toMatchObject({ pick: [0.5, 0] });
    const previewed = sketchState(await answer(sketchState(emitted), first));
    expect(previewed.session.definition).toBe(state.session.definition);
    const preview = previewed.session.toolStagedEntities[0];
    expect(preview?.kind).toBe("spline");
    if (preview?.kind !== "spline") throw Error("missing trim preview");
    expect(preview.points[0]).toEqual([0, 0]);
    expect(preview.points.at(-1)).toEqual([1, 0]);
    session = updateSketchPointer(previewed.session, [3.5, 0]);
    emitted = emitPendingSketchEditQuery({ state: { ...previewed, session }, effects: [] });
    const moved = queryEffects(emitted.effects)[0]!;
    const right = sketchState(await answer(sketchState(emitted), moved));
    const rightPreview = right.session.toolStagedEntities[0];
    expect(rightPreview?.kind === "spline" && rightPreview.points[0]).toEqual([3, 0]);
    expect(rightPreview?.kind === "spline" && rightPreview.points.at(-1)).toEqual([4, 0]);
    const clicked = click(right, target);
    const applied = sketchState(await answer(sketchState(clicked), queryEffects(clicked.effects)[0]!));
    const record = applied.session.liveSolve!.solvedSnapshot.solvedEntities.find(e => e.entityId === target);
    expect(record).toMatchObject({ kind: "lineSegment", startPosition: [0, 0], endPosition: [3, 0] });
    expect(applied.session.toolStagedEntities).toEqual([]);
    const left = updateSketchEditToolHover(right.session, null);
    expect(left.toolStagedEntities).toEqual([]);
  });

  test("b3k.29: an overdue hover timer cannot supersede the newer Trim click; gliding while clicks wait emits no hover query", async () => {
    const { state, target } = await trimState();
    const ref = {
      kind: "sketchEntity" as const,
      sketchId: state.session.actionContextId,
      entityId: target,
    };
    const workers: FakeDerivationWorker[] = [];
    const timers: { run: () => void; cancelled: boolean }[] = [];
    let clock = 0;
    const pool = new SketchRegionDerivationWorkerPool({
      createWorker: () => {
        const worker = new FakeDerivationWorker();
        workers.push(worker);
        return worker;
      },
      minimumSupersedeAgeMs: 250,
      now: () => clock,
      schedule: (run) => {
        const timer = { run, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    });
    const workerRuntime = {
      querySketchEditIntersections: async (input) =>
        (
          await pool.querySketchEditIntersections({
            contractVersion: CONTRACT_VERSION,
            solverSchemaVersion: SOLVER_SCHEMA_VERSION,
            requestId: input.requestId,
            documentId: input.documentId,
            revisionId: input.baseRevisionId,
            sketchId: input.sketchId,
            ...input.input,
          })
        ).result,
    } satisfies Pick<EditorEffectRuntime, "querySketchEditIntersections">;
    const pending: Promise<EditorEvent>[] = [];
    const execute = (effect: QueryEffect) => {
      const promise = runEditorEffect(
        effect,
        workerRuntime as EditorEffectRuntime,
      );
      pending.push(promise);
      return promise;
    };
    try {
      const hovered = emitPendingSketchEditQuery({
        state: {
          ...state,
          session: updateSketchEditToolHover(
            updateSketchPointer(state.session, [0.5, 0]),
            ref,
          ),
        },
        effects: [],
      });
      const firstHover = queryEffects(hovered.effects)[0]!;
      const firstDone = execute(firstHover);
      clock = 100;
      const moved = emitPendingSketchEditQuery({
        state: {
          ...sketchState(hovered),
          session: updateSketchPointer(sketchState(hovered).session, [0.4, 0]),
        },
        effects: [],
      });
      const waitingHover = queryEffects(moved.effects)[0]!;
      const waitingDone = execute(waitingHover);
      expect(workers).toHaveLength(1);
      expect(timers).toHaveLength(1);

      // The main thread can process the press after the guard age but before
      // the due timer gets its turn. The older hover is still waiting here.
      clock = 250;
      const clicked = click(sketchState(moved), target);
      const clickEffect = queryEffects(clicked.effects)[0]!;
      const clickedDone = execute(clickEffect);
      expect(workers).toHaveLength(2);
      const cutter = state.session.definition.entities[1]!.entityId;
      const queued = click(sketchState(clicked), cutter);
      expect(queryEffects(queued.effects)).toEqual([]);
      const gliding = emitPendingSketchEditQuery({
        state: {
          ...sketchState(queued),
          session: updateSketchEditToolHover(
            updateSketchPointer(sketchState(queued).session, [3.5, 0]),
            ref,
          ),
        },
        effects: [],
      });
      expect(queryEffects(gliding.effects)).toEqual([]);
      expect(
        sketchState(gliding).session.activeEditTool?.editQuery?.queue.map(
          (entry) => entry.preview ?? false,
        ),
      ).toEqual([false, false]);
      for (const timer of timers) if (!timer.cancelled) timer.run();
      const result = await querySketchEditIntersectionsForTest({
        requestId: clickEffect.requestId,
        documentId: clickEffect.documentId,
        baseRevisionId: clickEffect.baseRevisionId,
        sketchId: clickEffect.sketchId,
        input: clickEffect.input,
      });
      workers[1]!.respond({
        contractVersion: CONTRACT_VERSION,
        solverSchemaVersion: SOLVER_SCHEMA_VERSION,
        requestId: clickEffect.requestId,
        documentId: clickEffect.documentId,
        revisionId: clickEffect.baseRevisionId,
        sketchId: clickEffect.sketchId,
        result,
      });
      const appliedTransition = transitionEditorState(
        sketchState(gliding),
        await clickedDone,
      );
      const applied = sketchState(appliedTransition);
      expect(applied.session.validationMessage).toBeNull();
      expect(
        applied.session.liveSolve!.solvedSnapshot.solvedEntities.find(
          (entity) => entity.entityId === target,
        ),
      ).toMatchObject({
        kind: "lineSegment",
        startPosition: [1, 0],
        endPosition: [4, 0],
      });
      expect(
        queryEffects(appliedTransition.effects)[0]?.input.operation
          .targetEntityId,
      ).toBe(cutter);
      for (const late of [await waitingDone, await firstDone]) {
        const ignored = sketchState(transitionEditorState(applied, late));
        expect(ignored.session).toBe(applied.session);
        expect(ignored.pendingEditQueryRequest).toBe(
          applied.pendingEditQueryRequest,
        );
      }
    } finally {
      pool.dispose();
      await Promise.allSettled(pending);
    }
  });

  test("a click emits one background query (idempotent) and authors nothing; its result applies once; a result of another request is dropped", async () => {
    const { state, target } = await trimState();
    const clicked = click(state, target);
    const [effect] = queryEffects(clicked.effects);
    expect(queryEffects(clicked.effects)).toHaveLength(1);
    expect(effect).toMatchObject({
      background: true,
      queryId: expect.stringMatching(/^trim-query-/),
      input: { operation: { kind: "trim", targetEntityId: target } },
    });
    expect(
      queryEffects(emitPendingSketchEditQuery(clicked).effects),
      "Idempotent: one request per in-flight query.",
    ).toHaveLength(1);
    const pending = sketchState(clicked);
    expect(pending.session.definition).toBe(state.session.definition);
    const event = await runEditorEffect(effect!, runtime);
    const other = sketchState(
      transitionEditorState(pending, {
        ...event,
        requestId: "request_other",
      } as EditorEvent),
    );
    expect(other.session, "A result for another request is dropped.").toBe(
      pending.session,
    );
    expect(other.pendingEditQueryRequest).toBe(pending.pendingEditQueryRequest);
    const applied = sketchState(transitionEditorState(pending, event));
    expect(applied.pendingEditQueryRequest).toBeNull();
    expect(applied.session.definition.entities).toHaveLength(4);
    expect(applied.session.validationMessage).toBeNull();
    expect(applied.session.activeEditTool?.editQuery).toMatchObject({
      queue: [],
      inFlight: null,
    });
  });

  test("the definition changes while the query is in flight: the result is discarded with the stale message", async () => {
    const { state, target } = await trimState();
    const clicked = click(state, target);
    const [effect] = queryEffects(clicked.effects);
    const pending = sketchState(clicked);
    const changed = draw(pending.session, [10, 10], [11, 10]);
    const edited = {
      ...pending,
      session: { ...changed, activeEditTool: pending.session.activeEditTool },
    };
    const transition = await answer(edited, effect!);
    const result = sketchState(transition);
    expect(result.session.definition).toBe(changed.definition);
    expect(result.session.toolPresentation?.validation?.[0]?.message).toBe(TRIM_STALE_MESSAGE);
    expect(result.session.activeEditTool?.editQuery).toMatchObject({
      queue: [],
      inFlight: null,
    });
    expect(queryEffects(transition.effects)).toEqual([]);
  });

  test("A-4: every generation-only change (same definition) re-queries; the result for the current solve applies", async () => {
    const { state, target } = await trimState();
    let current = click(state, target);
    let [effect] = queryEffects(current.effects);
    for (let round = 0; round < 2; round += 1) {
      const pending = sketchState(current);
      const resolved = {
        ...pending,
        session: withLiveSolveBasis(
          pending.session,
          pending.session.definition,
        ),
      };
      const previous = effect!.queryId;
      current = await answer(resolved, effect!);
      const requeried = sketchState(current);
      expect(requeried.session.definition).toBe(state.session.definition);
      [effect] = queryEffects(current.effects);
      expect(effect?.queryId, `round ${round}: a new query`).toMatch(
        /^trim-query-/,
      );
      expect(effect?.queryId).not.toBe(previous);
      expect(effect?.input.solvedSnapshot).toBe(
        resolved.session.liveSolve!.solvedSnapshot,
      );
    }
    const applied = sketchState(await answer(sketchState(current), effect!));
    expect(applied.session.definition.entities).toHaveLength(4);
  });

  test("FIFO queue: a second click while the first is in flight waits, then is queried and applied in order", async () => {
    const { state, target } = await trimState();
    const first = click(state, target);
    const [firstEffect] = queryEffects(first.effects);
    // The x = 1 cutter has a single crossing: its end trim follows in order.
    const cutter = state.session.definition.entities[1]!.entityId;
    const second = click(sketchState(first), cutter);
    expect(queryEffects(second.effects)).toEqual([]);
    expect(
      sketchState(second).session.activeEditTool?.editQuery?.queue.map(
        (entry) => entry.targetEntityId,
      ),
    ).toEqual([target, cutter]);
    const afterFirst = await answer(sketchState(second), firstEffect!);
    expect(sketchState(afterFirst).session.definition.entities).toHaveLength(4);
    const [secondEffect] = queryEffects(afterFirst.effects);
    expect(secondEffect?.input.operation.targetEntityId).toBe(cutter);
    const afterSecond = sketchState(
      await answer(sketchState(afterFirst), secondEffect!),
    );
    expect(afterSecond.session.validationMessage).toBeNull();
    expect(afterSecond.session.definition.entities.find(e => e.entityId === cutter)).not.toEqual(
      state.session.definition.entities.find(e => e.entityId === cutter),
    );
  });

  test("review R-5: a queued click whose target an earlier applied Trim changed is dropped with the stale message, not re-queried", async () => {
    const { state, target } = await trimState();
    const first = click(state, target);
    const [effect] = queryEffects(first.effects);
    const second = click(sketchState(first), target);
    const result = await answer(sketchState(second), effect!);
    const applied = sketchState(result);
    expect(applied.session.definition.entities).toHaveLength(4);
    expect(applied.session.toolPresentation?.validation?.[0]?.message).toBe(TRIM_STALE_MESSAGE);
    expect(applied.session.activeEditTool?.editQuery?.queue).toEqual([]);
    expect(queryEffects(result.effects)).toEqual([]);
  });

  test("Esc and a tool switch cancel: the late result applies nothing and clears the request", async () => {
    const { state, target } = await trimState();
    for (const event of [
      { type: "sketch.activeToolCleared" },
      { type: "tool.activated", toolId: "line" },
    ] as EditorEvent[]) {
      const clicked = click(state, target);
      const [effect] = queryEffects(clicked.effects);
      const cancelled = sketchState(
        transitionEditorState(sketchState(clicked), event),
      );
      expect(cancelled.session.activeEditTool?.editQuery).toBeUndefined();
      const late = sketchState(await answer(cancelled, effect!));
      expect(late.session.definition).toBe(cancelled.session.definition);
      expect(late.pendingEditQueryRequest).toBeNull();
    }
  });

  test("review R-1: after Esc and a new Trim, a second click gets its own query and the cancelled click's late result is dropped (before or after that click)", async () => {
    const base = await trimState();
    // B: a second horizontal line, also cut by both verticals.
    const withB = draw(
      draw(base.state.session, [10, 10], [11, 10]),
      [0, 0.5],
      [4, 0.5],
    );
    const b = withB.definition.entities.at(-1)!.entityId;
    const state: SketchEditorState = {
      ...base.state,
      session: beginSketchTool(withB, "trim"),
    };
    for (const lateFirst of [false, true]) {
      const clickedA = click(state, base.target);
      const [effectA] = queryEffects(clickedA.effects);
      const cancelled = sketchState(
        transitionEditorState(sketchState(clickedA), {
          type: "sketch.activeToolCleared",
        }),
      );
      expect(cancelled.pendingEditQueryRequest, "Esc forgets the request").toBe(
        null,
      );
      let reopened: SketchEditorState = {
        ...cancelled,
        session: beginSketchTool(cancelled.session, "trim"),
      };
      if (lateFirst) reopened = sketchState(await answer(reopened, effectA!));
      expect(reopened.session.definition).toBe(state.session.definition);
      const clickedB = click(reopened, b);
      const [effectB] = queryEffects(clickedB.effects);
      expect(effectB, "B's own query is emitted").toBeDefined();
      expect(effectB!.queryId).not.toBe(effectA!.queryId);
      expect(effectB!.input.operation.targetEntityId).toBe(b);
      let after = sketchState(clickedB);
      if (!lateFirst) {
        after = sketchState(await answer(after, effectA!));
        expect(
          after.session.definition,
          "A's late result applies nothing",
        ).toBe(state.session.definition);
      }
      const applied = sketchState(await answer(after, effectB!));
      const trimmedB = applied.session.definition.entities.find(
        (entity) => entity.entityId === b,
      );
      const original = state.session.definition.entities.find(
        (entity) => entity.entityId === base.target,
      );
      expect(
        applied.session.definition.entities.find(
          (entity) => entity.entityId === base.target,
        ),
        "A is untouched",
      ).toBe(original);
      expect(trimmedB).not.toBe(
        state.session.definition.entities.find(
          (entity) => entity.entityId === b,
        ),
      );
      if (trimmedB?.kind !== "lineSegment") throw new Error("line");
      const end = applied.session.definition.points.find(
        (point) => point.pointId === trimmedB.endPointId,
      )!.position;
      expect(end[0], "B is cut where the verticals cross it").toBeCloseTo(
        1,
        12,
      );
      expect(end[1]).toBeCloseTo(0.5, 12);
    }
  });

  test("a real query failure propagates from the executor (never silenced); its failure event applies nothing and is shown; a supersession is dropped as stale", async () => {
    const { state, target } = await trimState();
    const clicked = click(state, target);
    const [effect] = queryEffects(clicked.effects);
    const failure = new Error("worker crashed");
    await expect(
      runEditorEffect(effect!, {
        querySketchEditIntersections: async () => {
          throw failure;
        },
      } as unknown as EditorEffectRuntime),
    ).rejects.toBe(failure);
    const failed = sketchState(
      transitionEditorState(sketchState(clicked), {
        type: "effect.sketchEditIntersectionsQueryFailed",
        requestId: effect!.requestId,
        documentId: effect!.documentId,
        commandSessionId: effect!.commandSessionId,
        baseRevisionId: effect!.baseRevisionId,
        queryId: effect!.queryId,
        message: "worker crashed",
      }),
    );
    expect(failed.session.definition).toBe(state.session.definition);
    expect(failed.session.toolPresentation?.validation?.[0]?.message).toBe(
      "Trim failed: worker crashed",
    );
    const superseded = await runEditorEffect(effect!, {
      querySketchEditIntersections: async () => {
        throw new SketchRegionDerivationSupersededError(
          { requestId: effect!.requestId, documentId: effect!.documentId },
          { requestId: "request_newer", documentId: effect!.documentId },
        );
      },
    } as unknown as EditorEffectRuntime);
    expect(superseded.type).toBe("effect.sketchEditIntersectionsQueryFailed");
    const newer = {
      ...sketchState(clicked),
      pendingEditQueryRequest: {
        requestId: "request_newer" as never,
        queryId: effect!.queryId,
      },
    };
    const dropped = sketchState(transitionEditorState(newer, superseded));
    expect(dropped.session).toBe(newer.session);
    expect(dropped.pendingEditQueryRequest).toBe(newer.pendingEditQueryRequest);
  });
});

// T10g-2: Extend and Split run through the same flow (one completed
// selection = one queued click; stale, queue and cancel as for Trim).
describe.each([
  ["sketchExtend", "extend", 1, 3],
  ["sketchSplit", "split", 4, 2],
] as const)("T10g-2 %s edit query (editor loop)", (toolId, kind, length, x) => {
  /** Targets T1 (0,0)→(length,0) and T2 (0,2)→(length,2); boundary B x = `x`, y ∈ [−1, 3]. */
  async function lineEditState() {
    const { state } = await trimState();
    let session = withSketchSnapScale(
      enterSketchSession(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    );
    session = draw(session, [0, 0], [length, 0]);
    session = draw(session, [0, 2], [length, 2]);
    session = draw(session, [x, -1], [x, 3]);
    const [first, second, boundary] = session.definition.entities.map(
      (entity) => entity.entityId,
    ) as [SketchEntityId, SketchEntityId, SketchEntityId];
    return {
      state: { ...state, session: beginSketchTool(session, toolId) },
      first,
      second,
      boundary,
    };
  }
  /** Selects target then boundary (a complete selection) and emits. */
  function select(
    state: SketchEditorState,
    target: SketchEntityId,
    boundary: SketchEntityId,
  ) {
    const once = click(state, target);
    return click(sketchState(once), boundary);
  }
  /** The new end point the applied edit authored on `target`. */
  function editedAt(state: SketchEditorState, target: SketchEntityId) {
    const line = state.session.definition.entities.find(
      (entity) => entity.entityId === target,
    );
    if (line?.kind !== "lineSegment") throw new Error("line");
    // Extend moves the end; Split ends the original id at the split point.
    return state.session.definition.points.find(
      (point) => point.pointId === line.endPointId,
    )!.position;
  }

  test("a complete selection emits one background query and authors nothing (the selection restarts); its result applies once; a result of another request is dropped", async () => {
    const { state, first, boundary } = await lineEditState();
    const half = click(state, first);
    expect(
      queryEffects(half.effects),
      "half a selection queries nothing",
    ).toEqual([]);
    const selected = select(state, first, boundary);
    const [effect] = queryEffects(selected.effects);
    expect(queryEffects(selected.effects)).toHaveLength(1);
    expect(effect).toMatchObject({
      background: true,
      queryId: expect.stringMatching(new RegExp(`^${kind}-query-`)),
      input: {
        operation: { kind, targetEntityId: first, boundaryEntityId: boundary },
      },
    });
    expect(
      queryEffects(emitPendingSketchEditQuery(selected).effects),
    ).toHaveLength(1);
    const pending = sketchState(selected);
    expect(pending.session.definition).toBe(state.session.definition);
    expect(pending.session.activeEditTool?.selectedTargets).toEqual([]);
    const event = await runEditorEffect(effect!, runtime);
    const other = sketchState(
      transitionEditorState(pending, {
        ...event,
        requestId: "request_other",
      } as EditorEvent),
    );
    expect(other.session).toBe(pending.session);
    const applied = sketchState(transitionEditorState(pending, event));
    expect(applied.pendingEditQueryRequest).toBeNull();
    expect(applied.session.validationMessage).toBeNull();
    expect(applied.session.definition.entities).toHaveLength(
      kind === "split" ? 4 : 3,
    );
    expect(editedAt(applied, first)).toEqual([x, 0]);
    expect(applied.session.activeEditTool?.editQuery).toMatchObject({
      queue: [],
      inFlight: null,
    });
  });

  test("the definition changes while the query is in flight: the result is discarded with the stale message", async () => {
    const { state, first, boundary } = await lineEditState();
    const selected = select(state, first, boundary);
    const [effect] = queryEffects(selected.effects);
    const pending = sketchState(selected);
    const changed = draw(pending.session, [10, 10], [11, 10]);
    const transition = await answer(
      {
        ...pending,
        session: { ...changed, activeEditTool: pending.session.activeEditTool },
      },
      effect!,
    );
    const result = sketchState(transition);
    expect(result.session.definition).toBe(changed.definition);
    expect(result.session.toolPresentation?.validation?.[0]?.message).toBe(editQueryStaleMessage(kind));
    expect(result.session.toolPresentation?.validation?.[0]?.message).toMatch(
      kind === "extend" ? /^Extend was not applied/ : /^Split was not applied/,
    );
    expect(queryEffects(transition.effects)).toEqual([]);
  });

  test("FIFO queue: a second selection while the first is in flight waits, then is queried and applied in order", async () => {
    const { state, first, second, boundary } = await lineEditState();
    const one = select(state, first, boundary);
    const [firstEffect] = queryEffects(one.effects);
    const two = select(sketchState(one), second, boundary);
    expect(queryEffects(two.effects)).toEqual([]);
    expect(
      sketchState(two).session.activeEditTool?.editQuery?.queue.map((entry) => [
        entry.targetEntityId,
        entry.boundary?.entityId,
      ]),
    ).toEqual([
      [first, boundary],
      [second, boundary],
    ]);
    const afterFirst = await answer(sketchState(two), firstEffect!);
    expect(editedAt(sketchState(afterFirst), first)).toEqual([x, 0]);
    const [secondEffect] = queryEffects(afterFirst.effects);
    expect(secondEffect?.input.operation.targetEntityId).toBe(second);
    const afterSecond = sketchState(
      await answer(sketchState(afterFirst), secondEffect!),
    );
    expect(editedAt(afterSecond, second)).toEqual([x, 2]);
    expect(afterSecond.session.validationMessage).toBeNull();
  });

  test("review R-5: a queued selection whose boundary an earlier applied edit changed is dropped with the stale message, not queried", async () => {
    const { state, first, boundary } = await lineEditState();
    const one = select(state, first, boundary);
    const [effect] = queryEffects(one.effects);
    // The second click's boundary is the first edit's target.
    const two = select(sketchState(one), boundary, first);
    const result = await answer(sketchState(two), effect!);
    const applied = sketchState(result);
    expect(editedAt(applied, first)).toEqual([x, 0]);
    expect(applied.session.toolPresentation?.validation?.[0]?.message).toBe(editQueryStaleMessage(kind));
    expect(applied.session.activeEditTool?.editQuery?.queue).toEqual([]);
    expect(queryEffects(result.effects)).toEqual([]);
  });

  test("Esc and a tool switch cancel: the late result applies nothing and clears the request", async () => {
    const { state, first, boundary } = await lineEditState();
    for (const event of [
      { type: "sketch.activeToolCleared" },
      { type: "tool.activated", toolId: "line" },
    ] as EditorEvent[]) {
      const selected = select(state, first, boundary);
      const [effect] = queryEffects(selected.effects);
      const cancelled = sketchState(
        transitionEditorState(sketchState(selected), event),
      );
      expect(cancelled.session.activeEditTool?.editQuery).toBeUndefined();
      expect(cancelled.pendingEditQueryRequest).toBeNull();
      const late = sketchState(await answer(cancelled, effect!));
      expect(late.session.definition).toBe(cancelled.session.definition);
    }
  });

  test("review A-3/A-4: every generation-only change (same definition) re-queries; the result for the current solve applies", async () => {
    const { state, first, boundary } = await lineEditState();
    let current = select(state, first, boundary);
    let [effect] = queryEffects(current.effects);
    for (let round = 0; round < 2; round += 1) {
      const pending = sketchState(current);
      const resolved = {
        ...pending,
        session: withLiveSolveBasis(
          pending.session,
          pending.session.definition,
        ),
      };
      const previous = effect!.queryId;
      current = await answer(resolved, effect!);
      expect(sketchState(current).session.definition).toBe(
        state.session.definition,
      );
      [effect] = queryEffects(current.effects);
      expect(effect?.queryId).toMatch(new RegExp(`^${kind}-query-`));
      expect(effect?.queryId).not.toBe(previous);
      expect(effect?.input.solvedSnapshot).toBe(
        resolved.session.liveSolve!.solvedSnapshot,
      );
    }
    const applied = sketchState(await answer(sketchState(current), effect!));
    expect(editedAt(applied, first)).toEqual([x, 0]);
  });

  test("review A-3: a real query failure applies nothing and is shown as the tool's failure", async () => {
    const { state, first, boundary } = await lineEditState();
    const selected = select(state, first, boundary);
    const [effect] = queryEffects(selected.effects);
    const failed = sketchState(
      transitionEditorState(sketchState(selected), {
        type: "effect.sketchEditIntersectionsQueryFailed",
        requestId: effect!.requestId,
        documentId: effect!.documentId,
        commandSessionId: effect!.commandSessionId,
        baseRevisionId: effect!.baseRevisionId,
        queryId: effect!.queryId,
        message: "worker crashed",
      }),
    );
    expect(failed.session.definition).toBe(state.session.definition);
    expect(failed.session.toolPresentation?.validation?.[0]?.message).toBe(
      `${kind === "extend" ? "Extend" : "Split"} failed: worker crashed`,
    );
    expect(failed.session.activeEditTool?.editQuery).toMatchObject({
      queue: [],
      inFlight: null,
    });
    expect(failed.pendingEditQueryRequest).toBeNull();
  });
});
