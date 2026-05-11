import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import { defaultSelectionFilter } from "@/core/editor/schema";
import type { SketchSpecialModeDefinition } from "@/core/sketch-special-modes/schema";
import { createSketchSpecialModeRegistry } from "@/core/sketch-special-modes/registry";
import { createFeatureEditSession } from "@/domain/editor/feature-editing";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { initialEditorState } from "./state-creators";
import type {
  EditorState,
  FeatureEditorState,
  SketchEditorState,
} from "./types";
import {
  emitDocumentCursorMove,
  emitFeatureCommit,
  emitFeaturePreview,
  emitSketchReferenceImageImportWithPayloads,
  emitSketchSpecialModeEffect,
  getSnapshotMutationBasis,
} from "./effect-emitters";

function makeLoadedState(
  snapshot: Awaited<ReturnType<typeof createSeedDocumentSnapshot>>,
): EditorState {
  return {
    ...initialEditorState,
    document: {
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
    },
    snapshot,
  };
}

function makeFeatureState(
  snapshot: Awaited<ReturnType<typeof createSeedDocumentSnapshot>>,
  session = createFeatureEditSession({ featureType: "extrude" }),
): FeatureEditorState {
  return {
    ...makeLoadedState(snapshot),
    kind: "editingFeature",
    command: {
      commandSessionId: "command_feature-1",
      toolId: "extrude",
      phase: "editing",
    },
    session,
    activeReferencePickerFieldId: null,
    pendingPreviewRequestId: null,
    pendingCommitRequestId: null,
  };
}

function makeSketchState(
  snapshot: Awaited<ReturnType<typeof createSeedDocumentSnapshot>>,
  session: NonNullable<ReturnType<typeof openSketchSessionFromSelection>>,
): SketchEditorState {
  return {
    ...makeLoadedState(snapshot),
    kind: "editingSketch",
    mode: "sketch",
    command: {
      commandSessionId: "command_sketch-1",
      toolId: "sketch",
      phase: "editing",
    },
    session,
    selection: [{ kind: "sketch", sketchId: session.sketchId! }],
    selectionFilter: defaultSelectionFilter,
    pendingCommitRequestId: null,
    pendingProjectionRequestId: null,
    pendingImportRequestId: null,
  };
}

test("effect-emitters.ts derives snapshot mutation bases with and without repository heads", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const loadedState = makeLoadedState({
    ...snapshot,
    provenance: {
      repositoryHeads: ["head_1", "head_2"],
      repositorySource: "local",
    },
  });

  const matchingBasis = getSnapshotMutationBasis(loadedState);
  const staleSnapshotBasis = getSnapshotMutationBasis({
    ...loadedState,
    snapshot: {
      ...loadedState.snapshot!,
      revisionId: "rev_stale",
      document: {
        ...loadedState.snapshot!.document,
        revisionId: "rev_stale",
      },
    },
  });

  expectTrue(
    matchingBasis?.baseRevisionId === snapshot.document.revisionId &&
      JSON.stringify(matchingBasis.baseRepositoryHeads) ===
        JSON.stringify(["head_1", "head_2"]),
    "Matching loaded snapshots should carry repository heads into mutation bases.",
  );
  expectTrue(
    staleSnapshotBasis?.baseRevisionId === snapshot.document.revisionId &&
      staleSnapshotBasis.baseRepositoryHeads === undefined,
    "Stale snapshots should fall back to a revision-only mutation basis.",
  );
});

test("effect-emitters.ts suppresses history cursor moves while another document refresh is pending and emits them with repository context otherwise", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const loadedState = makeLoadedState({
    ...snapshot,
    provenance: {
      repositoryHeads: ["head_1"],
      repositorySource: "local",
    },
  });

  const suppressed = emitDocumentCursorMove(
    {
      ...loadedState,
      pendingSnapshotRequestId: "request_snapshot-pending",
    },
    { kind: "feature", featureId: snapshot.document.features[0]!.featureId },
    true,
  );
  const emitted = emitDocumentCursorMove(
    loadedState,
    { kind: "feature", featureId: snapshot.document.features[0]!.featureId },
    false,
  );

  expectTrue(
    suppressed.effects.length === 0 && suppressed.state === suppressed.state,
    "Document cursor moves should not enqueue another history mutation while a refresh is already pending.",
  );
  expectTrue(
    emitted.effects[0]?.type === "document.moveHistoryCursor" &&
      emitted.effects[0].mutationBasis.baseRepositoryHeads?.[0] === "head_1" &&
      emitted.state.pendingHistoryCursorRequestId ===
        emitted.effects[0].requestId,
    "Document cursor moves should preserve repository-head freshness and track the pending request id when they are emitted.",
  );
});

test("effect-emitters.ts turns missing feature inputs into diagnostics instead of effect requests", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const previewResult = emitFeaturePreview(makeFeatureState(snapshot));
  const commitResult = emitFeatureCommit(makeFeatureState(snapshot));

  expectTrue(
    previewResult.effects.length === 0 &&
      previewResult.state.kind === "editingFeature" &&
      previewResult.state.session.status === "idle" &&
      previewResult.state.session.diagnostics.length > 0,
    "Feature preview should stay synchronous and surface missing-input diagnostics when the feature definition cannot be built.",
  );
  expectTrue(
    commitResult.effects.length === 0 &&
      commitResult.state.kind === "editingFeature" &&
      commitResult.state.session.status === "idle" &&
      commitResult.state.session.diagnostics.length > 0,
    "Feature commit should surface commit-time missing-input diagnostics instead of issuing an invalid mutation request.",
  );
});

test("effect-emitters.ts guards feature preview when no document revision is loaded", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const result = emitFeaturePreview({
    ...makeFeatureState(snapshot),
    document: {
      documentId: snapshot.document.documentId,
      revisionId: null,
    },
  });

  expectTrue(
    result.effects.length === 0 && result.state.document.revisionId === null,
    "Feature preview should not issue an effect before the editor has a loaded document revision.",
  );
});

test("effect-emitters.ts emits reference-image imports only when the sketch edit session has a valid mutation basis and payloads", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const session = openSketchSessionFromSelection(
    [{ kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId }],
    snapshot,
  );

  expectTrue(
    session,
    "Seed snapshot should expose a sketch session for sketch effect coverage.",
  );

  const state = makeSketchState(snapshot, session);
  const suppressed = emitSketchReferenceImageImportWithPayloads(state, []);
  const emitted = emitSketchReferenceImageImportWithPayloads(state, [
    {
      mediaType: "image/png",
      base64Data: "cG5n",
      pixelWidth: 32,
      pixelHeight: 24,
      fileName: "reference.png",
    },
  ]);

  expectTrue(
    suppressed.effects.length === 0,
    "Reference-image import should be suppressed when no payloads were chosen.",
  );
  expectTrue(
    emitted.effects[0]?.type === "sketch.importReferenceImages" &&
      emitted.effects[0].payloads.length === 1 &&
      emitted.state.pendingImportRequestId === emitted.effects[0].requestId,
    "Reference-image import should emit the dedicated sketch import effect and track the in-flight request id.",
  );
});

test("effect-emitters.ts restores editing state when a sketch special-mode effect cannot run and emits the effect when the pending request matches", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const session = openSketchSessionFromSelection(
    [{ kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId }],
    snapshot,
  );

  expectTrue(
    session,
    "Seed snapshot should expose a sketch session for special-mode effect coverage.",
  );

  const specialModeDefinition = {
    id: "fixture.special-mode",
    label: "Fixture special mode",
    enter: () => ({ state: {} }),
    selection: {
      label: "Fixture mode selection",
      description: "Select the active fixture target.",
      allowedKinds: ["sketchOperation"],
    },
    buildPanel: () => null,
    buildViewport: () => null,
  } satisfies SketchSpecialModeDefinition;
  const dependencies = {
    importProviders: {} as never,
    sketchSpecialModes: createSketchSpecialModeRegistry([
      specialModeDefinition,
    ]),
  };
  const requestId = "request_sketch-special-1" as const;
  const sessionWithMode = {
    ...session,
    activeSpecialMode: {
      modeId: specialModeDefinition.id,
      operationTarget: {
        kind: "sketchOperation" as const,
        sketchId: session.sketchId!,
        operationId: "sketch_operation_fixture",
      },
      state: {},
      generation: 1,
      hoverTarget: null,
      selectedTarget: null,
      activeDragHandle: null,
      pendingEffect: {
        requestId,
        generation: 1,
        effect: {
          effectId: "replace-image",
          kind: "reference-image-replace-image",
          payload: {},
        },
      },
      pendingExit: false,
    },
  };
  const state = makeSketchState(snapshot, sessionWithMode);
  const fallback = emitSketchSpecialModeEffect(
    state,
    sessionWithMode,
    "request_sketch-special-other",
    dependencies,
  );
  const emitted = emitSketchSpecialModeEffect(
    state,
    sessionWithMode,
    requestId,
    dependencies,
  );

  expectTrue(
    fallback.effects.length === 0 &&
      fallback.state.kind === "editingSketch" &&
      fallback.state.command.phase === "editing" &&
      fallback.state.selectionFilter?.label === "Fixture mode selection",
    "Special-mode effect requests with the wrong pending request id should stay in editing mode and keep the mode-specific selection contract.",
  );
  expectTrue(
    emitted.effects[0]?.type === "sketch.specialModeEffect" &&
      emitted.effects[0].effectId === "replace-image" &&
      emitted.state.command.phase === "awaitingEffect" &&
      emitted.state.preview?.label === "Running replace-image",
    "Matching special-mode requests should emit the special-mode effect seam and move the command into the awaiting-effect phase.",
  );
});
