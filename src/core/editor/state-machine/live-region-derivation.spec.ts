import { test, expect } from "vitest";

import { defaultSelectionFilter } from "@/core/editor/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { ConstraintId } from "@/contracts/shared/ids";
import {
  getSketchSessionDerivedValidity,
  getSketchSessionDisplayRenderables,
  getSketchSessionPreviewLabel,
  withLiveSolveBasis,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { emitPendingSketchRegionDerivation } from "./effect-emitters";
import { transitionEditorState } from "./reducer-root";
import { initialEditorState } from "./state-creators";
import type { EditorEffect, EditorEvent, SketchEditorState } from "./types";

type DeriveRegionsEffect = Extract<
  EditorEffect,
  { type: "sketch.deriveRegions" }
>;

async function makeSketchState() {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  const session = openSketchSessionFromSelection(
    [{ kind: "sketch", sketchId: sketch.sketchId }],
    snapshot,
  );
  if (!session) throw new Error("Seed sketch must open a session.");
  const state: SketchEditorState = {
    ...initialEditorState,
    document: {
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
    },
    snapshot,
    kind: "editingSketch",
    mode: "sketch",
    command: {
      commandSessionId: "command_sketch-1",
      toolId: "sketch",
      phase: "editing",
    },
    session,
    selection: [{ kind: "sketch", sketchId: sketch.sketchId }],
    selectionFilter: defaultSelectionFilter,
    pendingCommitRequestId: null,
    pendingProjectionRequestId: null,
    pendingImportRequestId: null,
    pendingRegionRequest: null,
  };
  return { snapshot, sketch, state };
}

function withSession(
  state: SketchEditorState,
  session: SketchSessionState,
): SketchEditorState {
  return { ...state, session };
}

function withConflictingFixPoints(definition: SketchDefinition) {
  const pointId = definition.points[0]!.pointId;
  const ids = [
    "constraint_conflict_a",
    "constraint_conflict_b",
  ] as ConstraintId[];
  return {
    ...definition,
    constraintIds: [...definition.constraintIds, ...ids],
    constraints: [
      ...definition.constraints,
      {
        constraintId: ids[0]!,
        kind: "fixPoint" as const,
        label: "Conflict A",
        pointId,
        position: [0, 0] as const,
      },
      {
        constraintId: ids[1]!,
        kind: "fixPoint" as const,
        label: "Conflict B",
        pointId,
        position: [100, 0] as const,
      },
    ],
  } satisfies SketchDefinition;
}

function derivedEvent(
  effect: DeriveRegionsEffect,
  regions: SketchSessionState["liveRegions"]["regions"],
): EditorEvent {
  return {
    type: "effect.sketchRegionsDerived",
    requestId: effect.requestId,
    documentId: effect.documentId,
    commandSessionId: effect.commandSessionId,
    baseRevisionId: effect.baseRevisionId,
    generation: effect.generation,
    regions,
    diagnostics: [],
  };
}

function onlyDeriveEffect(effects: readonly EditorEffect[]) {
  const derive = effects.filter(
    (effect): effect is DeriveRegionsEffect =>
      effect.type === "sketch.deriveRegions",
  );
  expect(derive, "Expected exactly one live region derivation.").toHaveLength(
    1,
  );
  return derive[0]!;
}

test("the post-transition hook emits one background derivation for a pending accepted basis and is idempotent", async () => {
  const { state } = await makeSketchState();
  const pending = withSession(
    state,
    withLiveSolveBasis(state.session, state.session.definition),
  );
  expect(pending.session.liveRegions.status).toBe("pending");

  const emitted = emitPendingSketchRegionDerivation({
    state: pending,
    effects: [],
  });
  const effect = onlyDeriveEffect(emitted.effects);
  expect(effect).toMatchObject({
    background: true,
    commandSessionId: "command_sketch-1",
    documentId: state.document.documentId,
    baseRevisionId: state.document.revisionId,
    generation: pending.session.liveRegions.generation,
  });
  expect(
    effect.basis.solvedSnapshot,
    "The basis must be the session's synchronous live solve.",
  ).toBe(pending.session.liveSolve!.solvedSnapshot);
  expect(
    effect.basis.modelingTolerance,
    "The basis carries the document modeling tolerance.",
  ).toBe(state.snapshot!.document.settings.modelingTolerance);
  expect(
    emitted.state.kind === "editingSketch" &&
      emitted.state.pendingRegionRequest,
  ).toEqual({
    requestId: effect.requestId,
    generation: effect.generation,
  });

  expect(
    emitPendingSketchRegionDerivation(emitted).effects,
    "A request in flight must suppress a second emission.",
  ).toHaveLength(1);
});

test("the hook never emits while a drag is active or when the solve is not accepted", async () => {
  const { state } = await makeSketchState();
  const pending = withLiveSolveBasis(state.session, state.session.definition);
  const dragging = withSession(state, {
    ...pending,
    activeDrag: {
      target: state.session.definition.points[0]!.target,
      startPoint: [0, 0],
      currentPoint: [1, 0],
      status: "dragging",
      message: null,
      interactiveSolveSession: null,
    },
  });
  expect(
    emitPendingSketchRegionDerivation({ state: dragging, effects: [] }).effects,
    "Drags stay stale until completion.",
  ).toEqual([]);

  const conflicting = withConflictingFixPoints(state.session.definition);
  const notAccepted = withSession(
    state,
    withLiveSolveBasis(
      { ...state.session, definition: conflicting },
      conflicting,
    ),
  );
  expect(notAccepted.session.liveRegions.status).toBe("unavailable");
  expect(
    emitPendingSketchRegionDerivation({ state: notAccepted, effects: [] })
      .effects,
  ).toEqual([]);
});

test("a not-accepted solve retains the last accepted regions as invalid, non-selectable display", async () => {
  const { sketch, state } = await makeSketchState();
  expect(state.session.liveRegions.regions).toHaveLength(1);
  const conflicting = withConflictingFixPoints(state.session.definition);
  const session = withLiveSolveBasis(
    { ...state.session, definition: conflicting },
    conflicting,
  );

  expect(
    session.liveRegions.regions,
    "The last accepted regions stay for display (U10 amendment).",
  ).toBe(state.session.liveRegions.regions);
  expect(session.liveRegions.regions[0]?.regionId).toBe(
    sketch.sketch.regions[0]?.regionId,
  );
  const validity = getSketchSessionDerivedValidity(session);
  expect(validity.state).toBe("invalid");
  expect(
    validity.diagnostics.some(
      (diagnostic) => diagnostic.code === "regions-unavailable",
    ),
  ).toBe(true);
  const regionRenderables = getSketchSessionDisplayRenderables(session).filter(
    (renderable) => renderable.semanticClass === "region",
  );
  expect(regionRenderables).toHaveLength(1);
  expect(
    regionRenderables[0],
    "Retained regions are never selectable and are marked invalid for the red tint.",
  ).toMatchObject({ target: null, regionValidity: "invalid" });
});

test("publication applies only the pending request of the same command session at the current generation", async () => {
  const { sketch, state } = await makeSketchState();
  const first = transitionEditorState(
    withSession(
      state,
      withLiveSolveBasis(state.session, state.session.definition),
    ),
    { type: "document.refreshRequested" },
  );
  const firstEffect = onlyDeriveEffect(first.effects);
  const inFlight = first.state as SketchEditorState;
  const published = structuredClone(sketch.sketch.regions);

  expect(
    transitionEditorState(inFlight, {
      ...derivedEvent(firstEffect, published),
      requestId: "request_other-1",
    } as EditorEvent).state,
    "A result for another request is ignored.",
  ).toBe(inFlight);
  expect(
    transitionEditorState(inFlight, {
      ...derivedEvent(firstEffect, published),
      commandSessionId: "command_other-1",
    } as EditorEvent).state,
    "A result for another command session is ignored.",
  ).toBe(inFlight);

  const applied = transitionEditorState(
    inFlight,
    derivedEvent(firstEffect, published),
  );
  const appliedState = applied.state as SketchEditorState;
  expect(appliedState.pendingRegionRequest).toBe(null);
  expect(appliedState.session.liveRegions.status).toBe("current");
  expect(appliedState.session.liveRegions.regions).toBe(published);
  expect(getSketchSessionDerivedValidity(appliedState.session).state).toBe(
    "current",
  );
  expect(applied.effects, "Nothing is left to derive.").toEqual([]);
});

test("a stale generation is discarded and the hook re-emits for the latest basis", async () => {
  const { sketch, state } = await makeSketchState();
  const first = transitionEditorState(
    withSession(
      state,
      withLiveSolveBasis(state.session, state.session.definition),
    ),
    { type: "document.refreshRequested" },
  );
  const firstEffect = onlyDeriveEffect(first.effects);
  const inFlight = first.state as SketchEditorState;
  const previousRegions = inFlight.session.liveRegions.regions;

  const edited = withSession(
    inFlight,
    withLiveSolveBasis(
      withLiveSolveBasis(inFlight.session, inFlight.session.definition),
      inFlight.session.definition,
    ),
  );
  expect(
    emitPendingSketchRegionDerivation({ state: edited, effects: [] }).effects,
    "At most one derivation is in flight while newer bases coalesce.",
  ).toEqual([]);

  const discarded = transitionEditorState(
    edited,
    derivedEvent(firstEffect, structuredClone(sketch.sketch.regions)),
  );
  const discardedState = discarded.state as SketchEditorState;
  expect(discardedState.session.liveRegions.status).toBe("pending");
  expect(
    discardedState.session.liveRegions.regions,
    "Stale output never replaces the displayed regions.",
  ).toBe(previousRegions);
  const latest = onlyDeriveEffect(discarded.effects);
  expect(latest.generation).toBe(edited.session.liveRegions.generation);
  expect(latest.generation).toBe(firstEffect.generation + 2);
  expect(discardedState.pendingRegionRequest?.requestId).toBe(latest.requestId);
});

test("a failed derivation marks live regions failed with a diagnostic and keeps them as invalid display", async () => {
  const { state } = await makeSketchState();
  const first = transitionEditorState(
    withSession(
      state,
      withLiveSolveBasis(state.session, state.session.definition),
    ),
    { type: "document.refreshRequested" },
  );
  const effect = onlyDeriveEffect(first.effects);
  const inFlight = first.state as SketchEditorState;

  const failed = transitionEditorState(inFlight, {
    type: "effect.sketchRegionDerivationFailed",
    requestId: effect.requestId,
    documentId: effect.documentId,
    commandSessionId: effect.commandSessionId,
    baseRevisionId: effect.baseRevisionId,
    generation: effect.generation,
    message: "Region derivation exploded.",
  });
  const failedState = failed.state as SketchEditorState;
  expect(failedState.pendingRegionRequest).toBe(null);
  expect(failedState.session.liveRegions.status).toBe("failed");
  expect(failedState.session.liveRegions.regions).toBe(
    inFlight.session.liveRegions.regions,
  );
  const validity = getSketchSessionDerivedValidity(failedState.session);
  expect(validity.state).toBe("invalid");
  expect(validity.diagnostics).toContainEqual({
    code: "regions-derivation-failed",
    severity: "error",
    message: "Region derivation exploded.",
    target: null,
  });
  expect(failed.effects, "Failures are not retried.").toEqual([]);
});

test("an accepted edit after an unavailable or failed state drops the stale synthetic diagnostics", async () => {
  const { state } = await makeSketchState();
  const definition = state.session.definition;
  const cleanPending = withLiveSolveBasis(state.session, definition);
  const cleanLabel = getSketchSessionPreviewLabel(cleanPending);
  const syntheticCodes = ["regions-unavailable", "regions-derivation-failed"];

  function expectClean(session: SketchSessionState, from: string) {
    expect(session.liveRegions.status).toBe("pending");
    const validity = getSketchSessionDerivedValidity(session);
    expect(validity.state).toBe("stale");
    expect(
      validity.diagnostics.filter((diagnostic) =>
        syntheticCodes.includes(diagnostic.code),
      ),
      `An accepted edit after ${from} must not keep the old diagnostic.`,
    ).toEqual([]);
    expect(getSketchSessionPreviewLabel(session)).toBe(cleanLabel);
  }

  const conflicting = withConflictingFixPoints(definition);
  const unavailable = withLiveSolveBasis(
    { ...state.session, definition: conflicting },
    conflicting,
  );
  expect(unavailable.liveRegions.status).toBe("unavailable");
  expect(getSketchSessionPreviewLabel(unavailable)).not.toBe(cleanLabel);
  expectClean(
    withLiveSolveBasis({ ...unavailable, definition }, definition),
    "unavailable",
  );

  const first = transitionEditorState(withSession(state, cleanPending), {
    type: "document.refreshRequested",
  });
  const effect = onlyDeriveEffect(first.effects);
  const failedSession = (
    transitionEditorState(first.state, {
      type: "effect.sketchRegionDerivationFailed",
      requestId: effect.requestId,
      documentId: effect.documentId,
      commandSessionId: effect.commandSessionId,
      baseRevisionId: effect.baseRevisionId,
      generation: effect.generation,
      message: "Region derivation exploded.",
    }).state as SketchEditorState
  ).session;
  expect(failedSession.liveRegions.status).toBe("failed");
  expect(getSketchSessionPreviewLabel(failedSession)).toBe(
    "Region derivation exploded.",
  );
  expectClean(withLiveSolveBasis(failedSession, definition), "failed");
});
