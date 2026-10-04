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
import { TRIM_STALE_MESSAGE } from "@/domain/editor/sketch-session/editing";
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
