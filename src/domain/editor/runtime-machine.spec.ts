import { test, expect } from "vitest";

import type {
  EditorEffectRuntime,
  EditorState,
} from "@/domain/editor/state-machine";
import {
  createEditorEventLoop,
  type EditorEventLoop,
} from "@/application/editor/editor-event-loop";
import { createTestErrorReporter } from "@/contracts/errors";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

test("src/domain/editor/runtime-machine.spec.ts", async () => {
  function waitForState(
    actor: EditorEventLoop,
    predicate: (state: EditorState) => boolean,
  ): Promise<EditorState> {
    const current = actor.getState();

    if (predicate(current)) {
      return Promise.resolve(current);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error("Timed out waiting for editor runtime state."));
      }, 2_000);
      const subscription = actor.subscribe(() => {
        const state = actor.getState();

        if (!predicate(state)) {
          return;
        }

        clearTimeout(timeoutId);
        subscription.unsubscribe();
        resolve(state);
      });
    });
  }

  const adapter = new MockKernelAdapter();
  const runtime: EditorEffectRuntime = {
    async getCurrentDocumentSnapshot() {
      return (
        await adapter.getDocumentSnapshot({
          contractVersion: "modeling-contract/v1alpha1",
          documentId: "doc_workspace",
        })
      ).snapshot;
    },
    async commitSketch() {
      return null;
    },
    async evaluatePreview() {
      throw new Error("Feature preview is not used by this test.");
    },
    async commitFeature() {
      throw new Error("Feature commit is not used by this test.");
    },
  };
  const actor = createEditorEventLoop(runtime);

  actor.start();

  try {
    await waitForState(actor, (state) => state.document.revisionId !== null);

    actor.dispatch({ type: "tool.activated", toolId: "sketch" });
    actor.dispatch({
      type: "viewport.selectionRequested",
      target: { kind: "construction", constructionId: "construction_plane-xy" },
    });
    await waitForState(actor, (state) => state.kind === "editingSketch");

    actor.dispatch({ type: "tool.activated", toolId: "line" });
    actor.dispatch({ type: "sketch.pointerReleased", point: [0, 0] });
    actor.dispatch({ type: "sketch.pointerReleased", point: [1, 0.3] });

    const beforeDrag = actor.getState();
    expect(beforeDrag.kind, "Expected active sketch session before drag.").toBe(
      "editingSketch",
    );
    const point = beforeDrag.session.definition.points[0];
    expect(
      point,
      "Expected a point to drag after drawing a line.",
    ).toBeTruthy();

    actor.dispatch({
      type: "sketch.geometryDragStarted",
      target: point.target,
      point: point.position,
    });
    actor.dispatch({ type: "sketch.geometryDragMoved", point: [2, 3] });
    actor.dispatch({ type: "sketch.geometryDragEnded", point: [2, 3] });

    const afterDrag = actor.getState();
    expect(
      afterDrag.kind,
      "Expected sketch session to remain active after drag.",
    ).toBe("editingSketch");

    const movedPoint = afterDrag.session.definition.points.find(
      (entry) => entry.pointId === point.pointId,
    );
    expect(
      movedPoint,
      "Expected dragged point to remain in the sketch definition.",
    ).toBeTruthy();
    expect(
      movedPoint.position[0],
      "Runtime should forward geometry drag move events to the editor reducer.",
    ).toBe(2);
    expect(
      movedPoint.position[1],
      "Runtime should forward geometry drag end events to the editor reducer.",
    ).toBe(3);
  } finally {
    actor.stop();
  }
});

test("src/domain/editor/runtime-machine.spec.ts reports escaped effect invocation failures", async () => {
  function waitForState(
    actor: EditorEventLoop,
    predicate: (state: EditorState) => boolean,
  ): Promise<EditorState> {
    const current = actor.getState();

    if (predicate(current)) {
      return Promise.resolve(current);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error("Timed out waiting for editor runtime state."));
      }, 2_000);
      const subscription = actor.subscribe(() => {
        const state = actor.getState();

        if (!predicate(state)) {
          return;
        }

        clearTimeout(timeoutId);
        subscription.unsubscribe();
        resolve(state);
      });
    });
  }

  const runtime: EditorEffectRuntime = {
    async getCurrentDocumentSnapshot() {
      throw new Error(
        "Snapshot fetch should be replaced by the rejected effect runner.",
      );
    },
    async commitSketch() {
      return null;
    },
    async evaluatePreview() {
      throw new Error("Feature preview is not used by this test.");
    },
    async commitFeature() {
      throw new Error("Feature commit is not used by this test.");
    },
  };
  const reporter = createTestErrorReporter();
  const actor = createEditorEventLoop(runtime, reporter, async () => {
    throw new Error("Actor invocation escaped.");
  });

  actor.start();

  try {
    const state = await waitForState(
      actor,
      (candidate) => candidate.pendingSnapshotRequestId === null,
    );

    expect(
      reporter.reports.length,
      "Escaped invocation failures should be reported.",
    ).toBe(1);
    expect(
      reporter.reports[0]?.error.code,
      "Escaped failures should use invocation failure codes.",
    ).toBe("editor/invocation-failed");
    expect(
      reporter.reports[0]?.metadata.source,
      "Escaped failures should identify the runtime source.",
    ).toBe("editor-runtime");
    expect(
      state.preview?.kind,
      "Escaped failures should become UI-visible editor failure state.",
    ).toBe("selection");
  } finally {
    actor.stop();
  }
});

test("src/domain/editor/runtime-machine.spec.ts forwards selection clear events", async () => {
  function waitForState(
    actor: EditorEventLoop,
    predicate: (state: EditorState) => boolean,
  ): Promise<EditorState> {
    const current = actor.getState();

    if (predicate(current)) {
      return Promise.resolve(current);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error("Timed out waiting for editor runtime state."));
      }, 2_000);
      const subscription = actor.subscribe(() => {
        const state = actor.getState();

        if (!predicate(state)) {
          return;
        }

        clearTimeout(timeoutId);
        subscription.unsubscribe();
        resolve(state);
      });
    });
  }

  const adapter = new MockKernelAdapter();
  const runtime: EditorEffectRuntime = {
    async getCurrentDocumentSnapshot() {
      return (
        await adapter.getDocumentSnapshot({
          contractVersion: "modeling-contract/v1alpha1",
          documentId: "doc_workspace",
        })
      ).snapshot;
    },
    async commitSketch() {
      return null;
    },
    async evaluatePreview() {
      throw new Error("Feature preview is not used by this test.");
    },
    async commitFeature() {
      throw new Error("Feature commit is not used by this test.");
    },
  };
  const actor = createEditorEventLoop(runtime);

  actor.start();

  try {
    await waitForState(actor, (state) => state.document.revisionId !== null);

    actor.dispatch({
      type: "viewport.selectionRequested",
      target: { kind: "construction", constructionId: "construction_plane-xy" },
    });
    await waitForState(actor, (state) => state.selection.length === 1);

    actor.dispatch({ type: "selection.cleared" });
    const cleared = await waitForState(
      actor,
      (state) => state.selection.length === 0,
    );

    expect(
      cleared.hoverTarget,
      "Runtime should forward selection clear events to the editor reducer.",
    ).toBe(null);
  } finally {
    actor.stop();
  }
});

test("src/domain/editor/runtime-machine.spec.ts forwards direct snapshot load events", async () => {
  function waitForState(
    actor: EditorEventLoop,
    predicate: (state: EditorState) => boolean,
  ): Promise<EditorState> {
    const current = actor.getState();

    if (predicate(current)) {
      return Promise.resolve(current);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error("Timed out waiting for editor runtime state."));
      }, 2_000);
      const subscription = actor.subscribe(() => {
        const state = actor.getState();

        if (!predicate(state)) {
          return;
        }

        clearTimeout(timeoutId);
        subscription.unsubscribe();
        resolve(state);
      });
    });
  }

  const adapter = new MockKernelAdapter();
  const runtime: EditorEffectRuntime = {
    async getCurrentDocumentSnapshot() {
      return (
        await adapter.getDocumentSnapshot({
          contractVersion: "modeling-contract/v1alpha1",
          documentId: "doc_workspace",
        })
      ).snapshot;
    },
    async commitSketch() {
      return null;
    },
    async evaluatePreview() {
      throw new Error("Feature preview is not used by this test.");
    },
    async commitFeature() {
      throw new Error("Feature commit is not used by this test.");
    },
  };
  const actor = createEditorEventLoop(runtime);

  actor.start();

  try {
    await waitForState(actor, (state) => state.document.revisionId !== null);

    const importedSnapshot = structuredClone(
      await runtime.getCurrentDocumentSnapshot(),
    );
    importedSnapshot.document.revisionId = "rev_imported";
    importedSnapshot.document.revisionId = "rev_imported";

    actor.dispatch({
      type: "document.snapshotLoaded",
      snapshot: importedSnapshot,
    });
    const loaded = await waitForState(
      actor,
      (state) => state.document.revisionId === "rev_imported",
    );

    expect(
      loaded.snapshot?.document.revisionId,
      "Runtime should forward direct snapshot loads to the editor reducer.",
    ).toBe("rev_imported");
    expect(
      loaded.selectionCatalog,
      "Direct snapshot loads should rebuild the selection catalog.",
    ).not.toBe(null);
  } finally {
    actor.stop();
  }
});

test("src/domain/editor/runtime-machine.spec.ts forwards connected sketch selection events", async () => {
  function waitForState(
    actor: EditorEventLoop,
    predicate: (state: EditorState) => boolean,
  ): Promise<EditorState> {
    const current = actor.getState();

    if (predicate(current)) {
      return Promise.resolve(current);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error("Timed out waiting for editor runtime state."));
      }, 2_000);
      const subscription = actor.subscribe(() => {
        const state = actor.getState();

        if (!predicate(state)) {
          return;
        }

        clearTimeout(timeoutId);
        subscription.unsubscribe();
        resolve(state);
      });
    });
  }

  const adapter = new MockKernelAdapter();
  const runtime: EditorEffectRuntime = {
    async getCurrentDocumentSnapshot() {
      return (
        await adapter.getDocumentSnapshot({
          contractVersion: "modeling-contract/v1alpha1",
          documentId: "doc_workspace",
        })
      ).snapshot;
    },
    async commitSketch() {
      return null;
    },
    async evaluatePreview() {
      throw new Error("Feature preview is not used by this test.");
    },
    async commitFeature() {
      throw new Error("Feature commit is not used by this test.");
    },
  };
  const actor = createEditorEventLoop(runtime);

  actor.start();

  try {
    await waitForState(actor, (state) => state.document.revisionId !== null);

    actor.dispatch({ type: "tool.activated", toolId: "sketch" });
    actor.dispatch({
      type: "viewport.selectionRequested",
      target: { kind: "construction", constructionId: "construction_plane-xy" },
    });
    await waitForState(actor, (state) => state.kind === "editingSketch");

    actor.dispatch({ type: "tool.activated", toolId: "rectangle" });
    actor.dispatch({ type: "sketch.pointerReleased", point: [0, 0] });
    actor.dispatch({ type: "sketch.pointerReleased", point: [4, 3] });

    const rectangleState = await waitForState(
      actor,
      (state) =>
        state.kind === "editingSketch" &&
        state.session.definition.entities.length === 4,
    );
    expect(
      rectangleState.kind,
      "Expected sketch session after rectangle creation.",
    ).toBe("editingSketch");
    const rectangleEdge = rectangleState.session.definition.entities[0]?.target;
    expect(rectangleEdge?.kind, "Expected a selectable rectangle edge.").toBe(
      "sketchEntity",
    );

    actor.dispatch({
      type: "sketch.connectedSelectionRequested",
      target: rectangleEdge,
    });
    const connected = await waitForState(
      actor,
      (state) => state.selection.length === 4,
    );

    expect(
      connected.selection.every((target) => target.kind === "sketchEntity"),
      "Runtime should forward connected sketch selection events to the editor reducer.",
    ).toBeTruthy();
  } finally {
    actor.stop();
  }
});

test("src/domain/editor/runtime-machine.spec.ts forwards active section offset updates", async () => {
  function waitForState(
    actor: EditorEventLoop,
    predicate: (state: EditorState) => boolean,
  ): Promise<EditorState> {
    const current = actor.getState();

    if (predicate(current)) {
      return Promise.resolve(current);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error("Timed out waiting for editor runtime state."));
      }, 2_000);
      const subscription = actor.subscribe(() => {
        const state = actor.getState();

        if (!predicate(state)) {
          return;
        }

        clearTimeout(timeoutId);
        subscription.unsubscribe();
        resolve(state);
      });
    });
  }

  const adapter = new MockKernelAdapter();
  const runtime: EditorEffectRuntime = {
    async getCurrentDocumentSnapshot() {
      return (
        await adapter.getDocumentSnapshot({
          contractVersion: "modeling-contract/v1alpha1",
          documentId: "doc_workspace",
        })
      ).snapshot;
    },
    async commitSketch() {
      return null;
    },
    async evaluatePreview() {
      throw new Error("Feature preview is not used by this test.");
    },
    async commitFeature() {
      throw new Error("Feature commit is not used by this test.");
    },
  };
  const actor = createEditorEventLoop(runtime);

  actor.start();

  try {
    await waitForState(actor, (state) => state.document.revisionId !== null);

    actor.dispatch({ type: "tool.activated", toolId: "sectionView" });
    actor.dispatch({
      type: "viewport.selectionRequested",
      target: { kind: "construction", constructionId: "construction_plane-xy" },
      cameraPosition: [0, 0, 20],
    });

    const selected = await waitForState(
      actor,
      (state) => state.kind === "inspectingSection",
    );
    expect(
      selected.kind,
      "Expected an active section after picking a valid section seed.",
    ).toBe("inspectingSection");

    actor.dispatch({
      type: "section.offsetUpdated",
      commandSessionId: selected.command.commandSessionId,
      offset: 6,
    });

    const moved = await waitForState(
      actor,
      (state) =>
        state.kind === "inspectingSection" && state.section.offset === 6,
    );

    expect(
      moved.kind,
      "Section offset forwarding should keep the section workflow active.",
    ).toBe("inspectingSection");
    expect(
      moved.section.offset,
      "Runtime should forward section offset updates to the editor reducer.",
    ).toBe(6);
  } finally {
    actor.stop();
  }
});
