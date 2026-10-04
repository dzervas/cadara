import { describe, expect, test } from "vitest";

import { runEditorEffect } from "@/application/editor/effect-registry";
import { SketchRegionDerivationSupersededError } from "@/domain/solver/sketch-constraint-solver-adapter";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  selectSketchEditToolTarget,
  startSketchDraw,
  withLiveSolveBasis,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  editQueryStaleMessage,
  TRIM_STALE_MESSAGE,
} from "@/domain/editor/sketch-session/editing";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { querySketchEditIntersectionsForTest } from "@/domain/editor/state-machine-test-builder";
import type { SketchEntityId } from "@/contracts/shared/ids";
import { emitPendingSketchEditQuery } from "./effect-emitters";
import { transitionEditorState } from "./reducer-root";
import { initialEditorState } from "./state-creators";
import type {
  EditorEffect,
  EditorEffectRuntime,
  EditorEvent,
  SketchEditorState,
} from "./types";

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
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
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
    pendingImportRequestId: null,
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
    expect(result.session.validationMessage).toBe(TRIM_STALE_MESSAGE);
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
    // The x = 1 cutter is cut by nothing twice: its own Trim fails, in order.
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
    expect(afterSecond.session.validationMessage).toBe(
      "Trim needs two unambiguous intersections on the target curve.",
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
    expect(applied.session.validationMessage).toBe(TRIM_STALE_MESSAGE);
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
    expect(failed.session.validationMessage).toBe(
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
    let session = createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
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
    expect(result.session.validationMessage).toBe(editQueryStaleMessage(kind));
    expect(result.session.validationMessage).toMatch(
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
    expect(applied.session.validationMessage).toBe(editQueryStaleMessage(kind));
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
    expect(failed.session.validationMessage).toBe(
      `${kind === "extend" ? "Extend" : "Split"} failed: worker crashed`,
    );
    expect(failed.session.activeEditTool?.editQuery).toMatchObject({
      queue: [],
      inFlight: null,
    });
    expect(failed.pendingEditQueryRequest).toBeNull();
  });
});
