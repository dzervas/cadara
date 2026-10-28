import { defaultEditorExtensionDependencies } from "@/composition/editor-extension-dependencies";
/**
 * T17-20 (T17k2; T17b0 P-8 S1; issue 09: history for a deleted shared
 * sketch cannot be applied). Logic lane; seam: the editor reducer
 * (`transitionEditorState`) on an entered published sketch, with the peer
 * delete arriving as the production peer refresh does (a reloaded document
 * snapshot without the sketch). The author is told by label, Finish is
 * refused (the notice is its text) (base: it committed and the kernel answered
 * "Sketch ‹id› does not resolve in the current OCC authoring state."), and
 * Discard (the command's cancel) leaves without publishing anything.
 */
import { expect, test } from "vitest";

import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import {
  getPeerDeletedSketchNotice,
  transitionEditorState,
  type EditorState,
} from "@/core/editor/state-machine";
import { enterSketchSessionState } from "@/core/editor/sketch-entry.fixtures";
import {
  createNewSketchSession,
  createSketchSessionFromSnapshot,
} from "@/core/editor/sketch-session";
import { createSeedDocumentSnapshot } from "@/application/modeling/modeling-test-fixtures";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";

async function editingPublishedSketch() {
  const snapshot = await createSeedDocumentSnapshot();
  const record = snapshot.document.sketches[0]!;
  const entered = enterSketchSessionState(
    createSketchSessionFromSnapshot(record, OCC_KERNEL_SETTINGS),
    {
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
    },
  );
  const state = { ...entered, snapshot };
  const peerDeleted = transitionEditorState(state, {
    type: "document.snapshotLoaded",
    snapshot: {
      ...snapshot,
      document: {
        ...snapshot.document,
        sketches: snapshot.document.sketches.filter(
          (sketch) => sketch.sketchId !== record.sketchId,
        ),
      },
    },
  }, defaultEditorExtensionDependencies);
  return { record, state, peerDeleted };
}

const finish = (state: EditorState) =>
  transitionEditorState(state, {
    type: "tool.activated",
    toolId: "finishSketch",
  }, defaultEditorExtensionDependencies);

test("a peer deleting the edited sketch shows a label-based notice; Finish is refused with it and publishes nothing", async () => {
  const { record, state, peerDeleted } = await editingPublishedSketch();
  expect(getPeerDeletedSketchNotice(state), "premise: still shared").toBe(null);
  expect(
    finish(state).effects.map((effect) => effect.type),
    "control: a Finish of the shared sketch publishes",
  ).toContain("sketch.commit");

  expect(peerDeleted.effects).toEqual([]);
  expect(peerDeleted.state.kind, "the author stays in the sketch").toBe(
    "editingSketch",
  );
  const notice = `‘${record.label}’ was deleted by another session; your changes can't be published.`;
  expect(getPeerDeletedSketchNotice(peerDeleted.state)).toBe(notice);
  expectNoInternalIds([notice], [record.sketchId]);

  for (const refused of [
    finish(peerDeleted.state),
    transitionEditorState(peerDeleted.state, {
      type: "command.commitRequested",
      commandSessionId:
        peerDeleted.state.kind === "editingSketch"
          ? peerDeleted.state.command.commandSessionId
          : ("" as never),
    }, defaultEditorExtensionDependencies),
  ]) {
    expect(refused.effects, "nothing is published").toEqual([]);
    expect(refused.state.kind).toBe("editingSketch");
    // Review R-1: the notice is the refusal's text; nothing is stored.
    expect(
      refused.state.kind === "editingSketch" &&
        refused.state.session.validationMessage,
    ).toBe(
      peerDeleted.state.kind === "editingSketch" &&
        peerDeleted.state.session.validationMessage,
    );
    expect(getPeerDeletedSketchNotice(refused.state)).toBe(notice);
    expect(
      refused.state.kind === "editingSketch" &&
        refused.state.session.definition,
      "the draft is kept",
    ).toEqual(
      peerDeleted.state.kind === "editingSketch" &&
        peerDeleted.state.session.definition,
    );
  }
});

// Review R-1: B undoes its delete while A is still inside (after a refused
// Finish): the notice goes, no "deleted" text is left anywhere, and Finish
// publishes again.
test("the peer restoring the sketch clears the deleted state; no stale text, Finish publishes", async () => {
  const { state, peerDeleted } = await editingPublishedSketch();
  const refused = finish(peerDeleted.state);
  expect(refused.effects, "premise: refused").toEqual([]);
  const restored = transitionEditorState(refused.state, {
    type: "document.snapshotLoaded",
    snapshot: state.snapshot!,
  }, defaultEditorExtensionDependencies);
  expect(getPeerDeletedSketchNotice(restored.state)).toBe(null);
  expect(
    String(
      restored.state.kind === "editingSketch" &&
        restored.state.session.validationMessage,
    ),
    "no stale deleted text",
  ).not.toMatch(/deleted by another session/);
  expect(finish(restored.state).effects.map((effect) => effect.type)).toContain(
    "sketch.commit",
  );
});

test("Discard changes and leave exits the deleted sketch without publishing", async () => {
  const { peerDeleted } = await editingPublishedSketch();
  if (peerDeleted.state.kind !== "editingSketch") throw new Error("premise");
  const left = transitionEditorState(peerDeleted.state, {
    type: "command.cancelled",
    commandSessionId: peerDeleted.state.command.commandSessionId,
  }, defaultEditorExtensionDependencies);
  expect(left.state.kind).toBe("idle");
  expect(left.state.mode).toBe("part");
  expect(left.effects.map((effect) => effect.type)).not.toContain(
    "sketch.commit",
  );
  expect(getPeerDeletedSketchNotice(left.state)).toBe(null);
});

test("a new sketch (never published) is not reported as deleted", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const entered = enterSketchSessionState(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
  expect(getPeerDeletedSketchNotice({ ...entered, snapshot })).toBe(null);
});
