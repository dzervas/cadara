import { expect, test } from "vitest";

import { createNewSketchSession } from "@/core/editor/sketch-session";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { buildSelectionTargetCatalog } from "@/core/modeling/document-snapshot-view";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { transitionEditorState } from "./reducer-root";
import { initialEditorState } from "./state-creators";
import type { EditorEvent, EditorState } from "./types";

// T17o review fixes (specification "Minimum failure feedback"). Logic lane;
// seam: the editor reducer's failure events → `EditorState.failureNotice`,
// the one notice the workbench shows for a failed sketch open, feature edit
// or history move (a refusal, or an escaped error the loop also reported).
// Red on base: each failure reached only the debug preview label.

async function loaded() {
  const snapshot = await createSeedDocumentSnapshot();
  const state: EditorState = {
    ...initialEditorState,
    document: {
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
    },
    snapshot,
    selectionCatalog: buildSelectionTargetCatalog(snapshot),
  };
  return { snapshot, state };
}

const step = (state: EditorState, event: EditorEvent) =>
  transitionEditorState(state, event);

test("T17o review: a refused sketch open (and an escaped one) is a sketchOpen notice; dismiss and a later open clear it", async () => {
  const { state } = await loaded();
  const armed = step(state, { type: "tool.activated", toolId: "sketch" });
  const requested = step(armed.state, {
    type: "viewport.selectionRequested",
    target: { kind: "construction", constructionId: "construction_plane-xy" },
  });
  const effect = requested.effects[0]!;
  expect(effect.type, "premise").toBe("sketch.openSession");
  if (effect.type !== "sketch.openSession") return;
  const refusal =
    "Sketch requires an existing sketch, construction plane, or planar face selection.";
  const failed = step(requested.state, {
    type: "effect.sketchSessionOpenFailed",
    requestId: effect.requestId,
    documentId: effect.documentId,
    revisionId: effect.revisionId,
    commandSessionId: effect.commandSessionId,
    message: refusal,
  }).state;
  expect(failed.failureNotice).toEqual({
    kind: "sketchOpen",
    message: refusal,
  });
  expect(
    step(failed, { type: "failureNotice.dismissed" }).state.failureNotice,
  ).toBeNull();

  // A retry that opens clears it.
  const retried = step(failed, {
    type: "viewport.selectionRequested",
    target: { kind: "construction", constructionId: "construction_plane-xy" },
  });
  const retry = retried.effects[0]!;
  if (retry.type !== "sketch.openSession") throw new Error("premise");
  const opened = step(retried.state, {
    type: "effect.sketchSessionOpened",
    requestId: retry.requestId,
    documentId: retry.documentId,
    revisionId: retry.revisionId,
    commandSessionId: retry.commandSessionId,
    session: createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  }).state;
  expect(opened.kind).toBe("editingSketch");
  expect(
    opened.failureNotice,
    "an open clears the sketchOpen notice",
  ).toBeNull();
});

test("T17o review: a refused feature edit is a featureEdit notice", async () => {
  const { state } = await loaded();
  const command = {
    commandSessionId: "command_extrude-1",
    toolId: "extrude",
    phase: "armed",
  } as const;
  const selecting = {
    ...state,
    kind: "selectionCommand",
    command,
    pendingRequestId: "request_hydrate",
  } as unknown as EditorState;
  const message = "The feature to edit no longer exists in this document.";
  const failed = step(selecting, {
    type: "effect.featureSessionHydrationFailed",
    requestId: "request_hydrate",
    documentId: state.document.documentId,
    revisionId: state.document.revisionId,
    commandSessionId: command.commandSessionId,
    message,
  } as EditorEvent).state;
  expect(failed.failureNotice).toEqual({ kind: "featureEdit", message });
});

test("T17o review: a failed or refused history move is a historyMove notice; an accepted move clears it", async () => {
  const { snapshot, state } = await loaded();
  const moving = {
    ...state,
    pendingHistoryCursorRequestId: "request_cursor",
  } as unknown as EditorState;
  const base = {
    requestId: "request_cursor",
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
  } as const;
  const failed = step(moving, {
    ...base,
    type: "effect.documentCursorMoveFailed",
    message: "Cursor write failed.",
  } as EditorEvent).state;
  expect(failed.failureNotice).toEqual({
    kind: "historyMove",
    message: "Cursor write failed.",
  });

  const refused = step(moving, {
    ...base,
    type: "effect.documentCursorMoved",
    revisionId: snapshot.document.revisionId,
    accepted: false,
    diagnostics: [
      {
        code: "history-cursor-invalid",
        severity: "error",
        message: "That history step cannot be reached.",
        target: null,
        detail: null,
      },
    ],
  } as EditorEvent).state;
  expect(refused.failureNotice).toEqual({
    kind: "historyMove",
    message: "That history step cannot be reached.",
  });

  const accepted = step(
    {
      ...failed,
      pendingHistoryCursorRequestId: "request_cursor",
    } as EditorState,
    {
      ...base,
      type: "effect.documentCursorMoved",
      revisionId: snapshot.document.revisionId,
      accepted: true,
      snapshot,
      diagnostics: [],
    } as EditorEvent,
  ).state;
  expect(accepted.failureNotice, "an accepted move clears it").toBeNull();
});
