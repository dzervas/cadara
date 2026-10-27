import { test, expect } from "vitest";

import {
  createModelingServiceEditorEffectRuntime,
  runEditorEffect,
} from "@/application/editor/effect-registry";
import {
  createAppError,
  err,
  ResultAsync,
  type AppError,
  type AppErrorContextEntry,
} from "@/contracts/errors";
import type {
  EditorEffect,
  EditorEffectRuntime,
} from "@/core/editor/state-machine";
import { createFeatureEditSession } from "@/core/editor/feature-editing";
import {
  createEditorEffectFailureEvent,
  hydrateFeatureSessionFromSnapshot,
} from "@/core/editor/state-machine";
import {
  applySelectionToSketchPlaneEditSession,
  hydrateSketchPlaneEditSession,
} from "@/domain/editor/sketch-plane-editing";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";

const unusedRuntime: EditorEffectRuntime = {
  async getCurrentDocumentSnapshot() {
    throw new Error("Unexpected snapshot query.");
  },
  async commitSketch() {
    throw new Error("Unexpected sketch commit.");
  },
  async commitSketchPlane() {
    throw new Error("Unexpected sketch-plane commit.");
  },
  async projectSketchReferences() {
    throw new Error("Unexpected sketch projection.");
  },
  async evaluatePreview() {
    throw new Error("Unexpected feature preview.");
  },
  async commitFeature() {
    throw new Error("Unexpected feature commit.");
  },
};

function resolved<T>(value: T) {
  return ResultAsync.fromSafePromise(Promise.resolve(value));
}

function rejected(error: AppError) {
  return new ResultAsync<never, AppError>(Promise.resolve(err(error)));
}

test("editor effect runtime covers snapshot, sketch-open, and feature-hydration contracts", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const feature = snapshot.document.features[0]!;
  const sketch = snapshot.document.sketches[0]!;
  const snapshotEffect: EditorEffect = {
    type: "document.fetchSnapshot",
    requestId: "request_editor_snapshot" as EditorEffect["requestId"],
    documentId: snapshot.document.documentId,
    revisionId: snapshot.document.revisionId,
    commandSessionId: null,
    preserveRenderRecordsOnFeatureDiagnostics: true,
  };

  const loaded = await runEditorEffect(snapshotEffect, {
    ...unusedRuntime,
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
  } satisfies EditorEffectRuntime);
  expect(
    loaded.type,
    "Snapshot fetch effects should resolve through the snapshot-loaded event seam.",
  ).toBe("effect.snapshotLoaded");
  expect(
    loaded.type === "effect.snapshotLoaded" &&
      loaded.payload.snapshot === snapshot &&
      loaded.payload.documentId === snapshot.document.documentId &&
      loaded.payload.revisionId === snapshot.document.revisionId &&
      loaded.payload.preserveRenderRecordsOnFeatureDiagnostics === true &&
      loaded.payload.selectionCatalog.selectableTargetKeys.length > 0,
    "Successful snapshot fetches should hand off the loaded snapshot and derived selection catalog.",
  ).toBeTruthy();

  // T17o (T17c3 route): the executor no longer catches a failed fetch; it
  // reaches the event loop's error reporting, which maps it to the typed
  // failure event (`effect.snapshotFailed`, ids and message preserved).
  const failure = await runEditorEffect(snapshotEffect, {
    ...unusedRuntime,
    async getCurrentDocumentSnapshot() {
      throw new Error("Repository offline.");
    },
  } satisfies EditorEffectRuntime).then(
    () => null,
    (error: unknown) => error,
  );
  expect(
    failure instanceof Error && failure.message,
    "Snapshot fetch failures should escape the executor to the event loop's error reporting.",
  ).toBe("Repository offline.");
  const failed = createEditorEffectFailureEvent(
    snapshotEffect,
    failure,
    "Editor runtime invocation failed.",
  );
  expect(
    failed.type,
    "Snapshot fetch failures should re-enter the state machine as typed failure events.",
  ).toBe("effect.snapshotFailed");
  expect(
    failed.type === "effect.snapshotFailed" &&
      failed.requestId === snapshotEffect.requestId &&
      failed.documentId === snapshotEffect.documentId &&
      failed.error === "Repository offline.",
    "Snapshot fetch failures should preserve correlation ids and normalized error messages.",
  ).toBeTruthy();

  const openEffect: EditorEffect = {
    type: "sketch.openSession",
    requestId: "request_editor_open_sketch" as EditorEffect["requestId"],
    commandSessionId: "command_open_sketch",
    selection: [{ kind: "sketch", sketchId: sketch.sketchId }],
    documentId: snapshot.document.documentId,
    revisionId: snapshot.document.revisionId,
  };
  const opened = await runEditorEffect(openEffect, {
    ...unusedRuntime,
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
  } satisfies EditorEffectRuntime);
  expect(
    opened.type,
    "Supported sketch-open selections should create a sketch session event.",
  ).toBe("effect.sketchSessionOpened");
  expect(
    opened.type === "effect.sketchSessionOpened" &&
      opened.session.sketchId === sketch.sketchId,
    "Sketch-open success should return the reopened sketch session.",
  ).toBeTruthy();

  const unsupportedSelection = await runEditorEffect(
    {
      ...openEffect,
      selection: [
        { kind: "body", bodyId: snapshot.document.bodies[0]!.bodyId },
      ],
    },
    {
      ...unusedRuntime,
      async getCurrentDocumentSnapshot() {
        return snapshot;
      },
    } satisfies EditorEffectRuntime,
  );
  expect(
    unsupportedSelection.type === "effect.sketchSessionOpenFailed" &&
      unsupportedSelection.message.includes(
        "existing sketch, construction plane, or planar face",
      ),
    "Unsupported sketch-open selections should surface the user-facing guidance message.",
  ).toBeTruthy();

  const hydrateEffect: EditorEffect = {
    type: "feature.hydrateFromSelection",
    requestId: "request_editor_hydrate_feature" as EditorEffect["requestId"],
    commandSessionId:
      "command_hydrate_feature",
    documentId: snapshot.document.documentId,
    revisionId: snapshot.document.revisionId,
    selectedFeatureId: feature.featureId,
  };
  const hydrated = await runEditorEffect(hydrateEffect, {
    ...unusedRuntime,
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
  } satisfies EditorEffectRuntime);
  expect(
    hydrated.type,
    "Editable features should hydrate into feature sessions.",
  ).toBe("effect.featureSessionHydrated");
  expect(
    hydrated.type === "effect.featureSessionHydrated" &&
      hydrated.session.featureId === feature.featureId,
    "Feature hydration should return the selected feature session.",
  ).toBeTruthy();

  const hydrateMissing = await runEditorEffect(
    {
      ...hydrateEffect,
      selectedFeatureId: "feature_missing" as typeof feature.featureId,
    },
    {
      ...unusedRuntime,
      async getCurrentDocumentSnapshot() {
        return snapshot;
      },
    } satisfies EditorEffectRuntime,
  );
  // T17k2 (T17e review A-8): no internal id in the message.
  expect(
    hydrateMissing.type === "effect.featureSessionHydrationFailed" &&
      hydrateMissing.message,
    "Missing feature hydration should fail saying the feature is gone.",
  ).toBe("The feature to edit no longer exists in this document.");
});

// T17o review fixes. Logic lane; seam: the effect executor. A sketch open,
// feature hydration or history move that throws is no longer caught into its
// failure event (which nothing reported): it escapes to the event loop's
// error reporting, which maps it to the same typed event. Red on base: each
// resolved to its failure event.
test("T17o review: thrown sketch-open, feature-hydration and history-move failures escape the executor", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const failing = {
    ...unusedRuntime,
    async getCurrentDocumentSnapshot() {
      throw new Error("Repository offline.");
    },
    async setDocumentCursor() {
      throw new Error("Cursor write failed.");
    },
  } satisfies EditorEffectRuntime;
  const base = {
    documentId: snapshot.document.documentId,
    commandSessionId: "command_t17o" as const,
  };
  const effects: [EditorEffect, string][] = [
    [
      {
        ...base,
        type: "sketch.openSession",
        requestId: "request_t17o_open" as EditorEffect["requestId"],
        revisionId: snapshot.document.revisionId,
        selection: [
          { kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId },
        ],
      } satisfies EditorEffect,
      "Repository offline.",
    ],
    [
      {
        ...base,
        type: "feature.hydrateFromSelection",
        requestId: "request_t17o_hydrate" as EditorEffect["requestId"],
        revisionId: snapshot.document.revisionId,
        selectedFeatureId: snapshot.document.features[0]!.featureId,
      } satisfies EditorEffect,
      "Repository offline.",
    ],
    [
      {
        type: "document.moveHistoryCursor",
        requestId: "request_t17o_cursor" as EditorEffect["requestId"],
        documentId: snapshot.document.documentId,
        baseRevisionId: snapshot.document.revisionId,
        mutationBasis: {
          baseRevisionId: snapshot.document.revisionId,
          baseRepositoryHeads: undefined,
        },
        cursor: snapshot.document.cursor,
        transient: false,
      } satisfies EditorEffect,
      "Cursor write failed.",
    ],
  ];
  for (const [effect, message] of effects) {
    const failure = await runEditorEffect(effect, failing).then(
      () => null,
      (error: unknown) => error,
    );
    expect(
      failure instanceof Error && failure.message,
      `${effect.type} failures escape to the event loop's error reporting`,
    ).toBe(message);
  }
});

test("editor effect runtime maps preview, commit, and sketch projection outcomes", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const featureSession = hydrateFeatureSessionFromSnapshot(
    snapshot,
    snapshot.document.features[0]!.featureId,
  );
  const sketchSession = openSketchSessionFromSelection(
    [{ kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId }],
    snapshot,
  );

  expect(
    featureSession,
    "Seed snapshot should expose an editable feature for preview and commit coverage.",
  ).toBeTruthy();
  expect(
    sketchSession,
    "Seed snapshot should expose a sketch session for sketch effect coverage.",
  ).toBeTruthy();
  if (!featureSession || !sketchSession)
    throw new Error("Expected editable feature and sketch fixtures.");

  const previewEffect: EditorEffect = {
    type: "feature.evaluatePreview",
    requestId: "request_editor_preview" as EditorEffect["requestId"],
    commandSessionId: "command_preview",
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    featureSession,
  };
  const preview = await runEditorEffect(previewEffect, {
    ...unusedRuntime,
    async evaluatePreview() {
      return {
        revisionId: "rev_preview" as typeof snapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      };
    },
  } satisfies EditorEffectRuntime);
  expect(
    preview.type,
    "Feature preview should complete through the preview-completed event seam.",
  ).toBe("effect.featurePreviewCompleted");
  expect(
    preview.type === "effect.featurePreviewCompleted" &&
      preview.revisionId === "rev_preview" &&
      preview.baseRevisionId === snapshot.document.revisionId &&
      preview.stale === false,
    "Feature preview success should preserve the returned preview revision and stale flag.",
  ).toBeTruthy();

  const previewFailure = await runEditorEffect(previewEffect, {
    ...unusedRuntime,
    async evaluatePreview() {
      throw new Error("Preview kernel unavailable.");
    },
  } satisfies EditorEffectRuntime);
  expect(
    previewFailure.type === "effect.featurePreviewFailed" &&
      previewFailure.message === "Preview kernel unavailable.",
    "Feature preview failures should normalize into preview-failed events.",
  ).toBeTruthy();

  const errorContext: AppErrorContextEntry[] = [
    { key: "revisionState", value: "conflict" },
  ];
  const commitEffect: EditorEffect = {
    type: "feature.commit",
    requestId: "request_editor_commit_feature" as EditorEffect["requestId"],
    commandSessionId:
      "command_commit_feature",
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    mutationBasis: {
      baseRevisionId: snapshot.document.revisionId,
      baseRepositoryHeads: ["head_feature_1"],
    },
    featureSession,
  };
  const committed = await runEditorEffect(commitEffect, {
    ...unusedRuntime,
    async commitFeature() {
      return {
        revisionId: "rev_feature_commit" as typeof snapshot.document.revisionId,
        featureId: featureSession.featureId!,
        accepted: false,
        diagnostics: [],
        actualRevisionId:
          "rev_feature_actual" as typeof snapshot.document.revisionId,
        errorContext,
      };
    },
  } satisfies EditorEffectRuntime);
  expect(
    committed.type,
    "Feature commit should complete through the feature-committed event seam.",
  ).toBe("effect.featureCommitted");
  expect(
    committed.type === "effect.featureCommitted" &&
      committed.accepted === false &&
      committed.actualRevisionId === "rev_feature_actual" &&
      committed.errorContext === errorContext,
    "Feature commit should preserve accepted/conflict metadata from the runtime.",
  ).toBeTruthy();

  const sketchCommitEffect: EditorEffect = {
    type: "sketch.commit",
    requestId: "request_editor_commit_sketch" as EditorEffect["requestId"],
    commandSessionId:
      "command_commit_sketch",
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    mutationBasis: {
      baseRevisionId: snapshot.document.revisionId,
      baseRepositoryHeads: ["head_sketch_1"],
    },
    session: sketchSession,
  };
  const noopSketchCommit = await runEditorEffect(sketchCommitEffect, {
    ...unusedRuntime,
    async commitSketch() {
      return null;
    },
  } satisfies EditorEffectRuntime);
  expect(
    noopSketchCommit.type,
    "Sketch commit should still complete when the runtime reports no mutation.",
  ).toBe("effect.sketchCommitted");
  expect(
    noopSketchCommit.type === "effect.sketchCommitted" &&
      noopSketchCommit.revisionId === snapshot.document.revisionId &&
      noopSketchCommit.accepted === true &&
      noopSketchCommit.diagnostics.length === 0,
    "No-op sketch commits should map to an accepted event pinned to the base revision.",
  ).toBeTruthy();

  const sketchPlaneSession = hydrateSketchPlaneEditSession(
    snapshot,
    sketchSession.sketchId!,
  );
  expect(
    sketchPlaneSession,
    "Seed snapshot should expose a sketch-plane edit session for effect coverage.",
  ).toBeTruthy();

  const sketchPlaneCommit = sketchPlaneSession
    ? await runEditorEffect(
        {
          type: "sketchPlane.commit",
          requestId:
            "request_editor_commit_sketch_plane" as EditorEffect["requestId"],
          commandSessionId:
            "command_commit_sketch_plane",
          documentId: snapshot.document.documentId,
          baseRevisionId: snapshot.document.revisionId,
          mutationBasis: {
            baseRevisionId: snapshot.document.revisionId,
            baseRepositoryHeads: ["head_sketch_plane_1"],
          },
          session: applySelectionToSketchPlaneEditSession(
            sketchPlaneSession,
            { kind: "construction", constructionId: "construction_plane-yz" },
            snapshot,
          ),
        },
        {
          ...unusedRuntime,
          async commitSketchPlane() {
            return {
              revisionId:
                "rev_sketch_plane_commit" as typeof snapshot.document.revisionId,
              accepted: true,
              diagnostics: [],
            };
          },
        } satisfies EditorEffectRuntime,
      )
    : null;
  expect(
    sketchPlaneCommit?.type,
    "Sketch-plane commits should resolve through the sketch-plane committed event seam.",
  ).toBe("effect.sketchPlaneCommitted");
  expect(
    sketchPlaneCommit?.type === "effect.sketchPlaneCommitted" &&
      sketchPlaneCommit.revisionId === "rev_sketch_plane_commit" &&
      sketchPlaneCommit.accepted === true,
    "Sketch-plane commit effects should preserve the accepted revision returned by the runtime.",
  ).toBeTruthy();

  const projected = await runEditorEffect(
    {
      type: "sketch.projectReferences",
      requestId: "request_editor_project_refs" as EditorEffect["requestId"],
      commandSessionId:
        "command_project_refs",
      documentId: snapshot.document.documentId,
      baseRevisionId: snapshot.document.revisionId,
      session: sketchSession,
    },
    {
      ...unusedRuntime,
      async projectSketchReferences() {
        return {
          projectedReferences: [],
          diagnostics: [],
        };
      },
    } satisfies EditorEffectRuntime,
  );
  expect(
    projected.type,
    "Sketch reference projection should complete through the projected event seam.",
  ).toBe("effect.sketchReferencesProjected");
  expect(
    projected.type === "effect.sketchReferencesProjected" &&
      projected.projectedReferences.length === 0 &&
      projected.baseRevisionId === snapshot.document.revisionId,
    "Projected reference results should preserve the returned references and base revision.",
  ).toBeTruthy();
});

test("editor effect runtime covers special modes and history cursor movement", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketchSession = openSketchSessionFromSelection(
    [{ kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId }],
    snapshot,
  );

  expect(
    sketchSession,
    "Seed snapshot should expose a sketch session for import and cursor coverage.",
  ).toBeTruthy();

  const specialModeEffect: EditorEffect = {
    type: "sketch.specialModeEffect",
    requestId: "request_editor_special_mode" as EditorEffect["requestId"],
    commandSessionId:
      "command_special_mode",
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    modeId: "reference-image-calibration",
    effectId: "effect_calibrate",
    kind: "measure",
    payload: { targetId: "image_1" },
  };
  const specialMode = await runEditorEffect(specialModeEffect, {
    ...unusedRuntime,
    async runSketchSpecialModeEffect(input) {
      return {
        effectId: input.effectId,
        payload: { measuredLength: 42 },
      };
    },
  } satisfies EditorEffectRuntime);
  expect(
    specialMode.type,
    "Special sketch mode effects should map to completed events.",
  ).toBe("effect.sketchSpecialModeEffectCompleted");
  expect(
    specialMode.type === "effect.sketchSpecialModeEffectCompleted" &&
      specialMode.payload.measuredLength === 42,
    "Special sketch mode success should preserve the returned payload.",
  ).toBeTruthy();

  const cursorEffect: EditorEffect = {
    type: "document.moveHistoryCursor",
    requestId: "request_editor_cursor" as EditorEffect["requestId"],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    mutationBasis: {
      baseRevisionId: snapshot.document.revisionId,
      baseRepositoryHeads: ["head_cursor_1"],
    },
    cursor: snapshot.document.cursor,
    transient: true,
  };
  const moved = await runEditorEffect(cursorEffect, {
    ...unusedRuntime,
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
    async setDocumentCursor() {
      return {
        revisionId: "rev_cursor_moved" as typeof snapshot.document.revisionId,
        accepted: true,
        diagnostics: [],
      };
    },
  } satisfies EditorEffectRuntime);
  expect(
    moved.type,
    "History cursor moves should complete through the cursor-moved event seam.",
  ).toBe("effect.documentCursorMoved");
  expect(
    moved.type === "effect.documentCursorMoved" &&
      moved.accepted === true &&
      moved.snapshot === snapshot,
    "Accepted history cursor moves should refresh and include the next snapshot.",
  ).toBeTruthy();

  const rejectedMove = await runEditorEffect(cursorEffect, {
    ...unusedRuntime,
    async setDocumentCursor() {
      return {
        revisionId:
          "rev_cursor_conflict" as typeof snapshot.document.revisionId,
        accepted: false,
        diagnostics: [],
        actualRevisionId:
          "rev_cursor_actual" as typeof snapshot.document.revisionId,
      };
    },
  } satisfies EditorEffectRuntime);
  expect(
    rejectedMove.type === "effect.documentCursorMoved" &&
      rejectedMove.accepted === false &&
      rejectedMove.snapshot === undefined &&
      rejectedMove.actualRevisionId === "rev_cursor_actual",
    "Rejected history cursor moves should preserve conflict metadata without fetching a refreshed snapshot.",
  ).toBeTruthy();
});

test("modeling-service effect runtime adapts sketch, feature, projection, and cursor contracts", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const hydratedFeatureSession = hydrateFeatureSessionFromSnapshot(
    snapshot,
    snapshot.document.features[0]!.featureId,
  );
  const planeCreateSession = createFeatureEditSession({
    featureType: "plane",
    selectedTarget: {
      kind: "construction",
      constructionId: snapshot.document.constructions[0]!.constructionId,
    },
  });
  const incompleteFeatureSession = createFeatureEditSession({
    featureType: "extrude",
  });
  const sketchSession = openSketchSessionFromSelection(
    [{ kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId }],
    snapshot,
  );
  const sketchPlaneSession = hydrateSketchPlaneEditSession(
    snapshot,
    snapshot.document.sketches[0]!.sketchId,
  );

  expect(
    hydratedFeatureSession,
    "Seed snapshot should expose an editable feature for runtime adapter coverage.",
  ).toBeTruthy();
  expect(
    sketchSession,
    "Seed snapshot should expose a sketch session for runtime adapter coverage.",
  ).toBeTruthy();
  expect(
    sketchPlaneSession,
    "Seed snapshot should expose a sketch-plane edit session for runtime adapter coverage.",
  ).toBeTruthy();
  if (!hydratedFeatureSession || !sketchSession)
    throw new Error("Expected editable feature and sketch fixtures.");

  const commitCalls: Array<{
    sketchLabel: string;
    sketchId: string | null;
    planeConstructionId: string | null;
    planeKind: string;
    baseRepositoryHeads?: readonly string[];
  }> = [];
  const createFeatureCalls: Array<{
    definitionKind: string;
    baseRepositoryHeads?: readonly string[];
  }> = [];
  const updateFeatureCalls: Array<{
    featureId: string;
    definitionKind: string;
  }> = [];
  const cursorCalls: Array<{ persistHistory: boolean | undefined }> = [];
  const projectionCalls: Array<{ sketchId: string; referenceCount: number }> =
    [];
  const runtime = createModelingServiceEditorEffectRuntime({
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
    commitSketch(input) {
      commitCalls.push({
        sketchLabel: input.sketchLabel,
        sketchId: input.sketchId,
        planeConstructionId:
          input.plane.support.kind === "construction"
            ? input.plane.support.constructionId
            : null,
        planeKind: input.plane.support.kind,
        baseRepositoryHeads: input.baseRepositoryHeads,
      });
      return resolved({
        revisionId: "rev_runtime_sketch" as typeof snapshot.document.revisionId,
        sketchId: input.sketchId ?? "sketch_runtime_created",
        revisionState: { kind: "accepted" as const },
        diagnostics: [],
      });
    },
    async projectSketchExternalReferences(input) {
      projectionCalls.push({
        sketchId: input.sketchId,
        referenceCount: input.references.length,
      });
      return {
        projectedReferences: [],
        diagnostics: [],
      };
    },
    sketchSolver: null,
    async evaluatePreview(input) {
      return {
        revisionId:
          `${input.previewId}_rev` as typeof snapshot.document.revisionId,
        stale: true,
        diagnostics: [],
        renderables: [],
      };
    },
    createFeature(input) {
      createFeatureCalls.push({
        definitionKind: input.definition.kind,
        baseRepositoryHeads: input.baseRepositoryHeads,
      });
      return resolved({
        revisionId:
          "rev_feature_created" as typeof snapshot.document.revisionId,
        featureId:
          "feature_plane_created" as (typeof snapshot.document.features)[number]["featureId"],
        revisionState: { kind: "accepted" as const },
        diagnostics: [],
      });
    },
    updateFeature(input) {
      updateFeatureCalls.push({
        featureId: input.featureId,
        definitionKind: input.definition.kind,
      });
      return resolved({
        revisionId:
          "rev_feature_updated" as typeof snapshot.document.revisionId,
        featureId: input.featureId,
        revisionState: { kind: "accepted" as const },
        diagnostics: [],
      });
    },
    setFeatureCursor(input) {
      cursorCalls.push({ persistHistory: input.persistHistory });
      return resolved({
        revisionId: "rev_cursor_runtime" as typeof snapshot.document.revisionId,
        revisionState: { kind: "accepted" as const },
        diagnostics: [],
      });
    },
  });

  const committedSketch = await runtime.commitSketch({
    requestId: "request_runtime_sketch" as EditorEffect["requestId"],
    baseRevisionId: snapshot.document.revisionId,
    baseRepositoryHeads: ["head_runtime_sketch"],
    session: sketchSession,
  });
  expect(
    committedSketch?.accepted === true &&
      committedSketch.revisionId === "rev_runtime_sketch" &&
      commitCalls[0]?.sketchId === sketchSession.sketchId &&
      commitCalls[0]?.sketchLabel === sketchSession.sketchLabel &&
      commitCalls[0]?.planeKind === "construction" &&
      commitCalls[0]?.baseRepositoryHeads?.[0] === "head_runtime_sketch",
    "Sketch commit runtime adaptation should forward commit defaults and accepted results.",
  ).toBeTruthy();

  const committedSketchPlane = sketchPlaneSession
    ? await runtime.commitSketchPlane({
        requestId: "request_runtime_sketch_plane" as EditorEffect["requestId"],
        baseRevisionId: snapshot.document.revisionId,
        baseRepositoryHeads: ["head_runtime_sketch_plane"],
        session: applySelectionToSketchPlaneEditSession(
          sketchPlaneSession,
          { kind: "construction", constructionId: "construction_plane-yz" },
          snapshot,
        ),
      })
    : null;
  expect(
    committedSketchPlane?.accepted === true &&
      committedSketchPlane.revisionId === "rev_runtime_sketch" &&
      commitCalls[1]?.sketchId === sketchSession.sketchId &&
      commitCalls[1]?.planeConstructionId === "construction_plane-yz" &&
      commitCalls[1]?.baseRepositoryHeads?.[0] === "head_runtime_sketch_plane",
    "Sketch-plane runtime adaptation should recommit the sketch through commitSketch with the newly selected support plane.",
  ).toBeTruthy();

  const noReferenceProjection = await runtime.projectSketchReferences({
    requestId: "request_runtime_projection_empty" as EditorEffect["requestId"],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    session: {
      ...sketchSession,
      definition: {
        ...sketchSession.definition,
        referenceIds: [],
        references: [],
      },
    },
  });
  expect(
    noReferenceProjection.projectedReferences.length === 0 &&
      projectionCalls.length === 0,
    "Sketch projection should short-circuit when the sketch has no external references.",
  ).toBeTruthy();

  const projected = await runtime.projectSketchReferences({
    requestId: "request_runtime_projection" as EditorEffect["requestId"],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    session: sketchSession,
  });
  expect(
    projected.projectedReferences.length === 0 &&
      projectionCalls[0]?.sketchId === sketchSession.sketchId &&
      projectionCalls[0]?.referenceCount ===
        sketchSession.definition.references.length,
    "Sketch projection should forward authored references and sketch identity to the modeling service.",
  ).toBeTruthy();

  const preview = await runtime.evaluatePreview({
    baseRevisionId: snapshot.document.revisionId,
    featureSession: hydratedFeatureSession,
  });
  expect(
    preview.revisionId === `${hydratedFeatureSession.previewId}_rev` &&
      preview.stale === true,
    "Preview adaptation should forward the built definition and map the preview payload.",
  ).toBeTruthy();

  const createdFeature = await runtime.commitFeature({
    baseRevisionId: snapshot.document.revisionId,
    baseRepositoryHeads: ["head_feature_create"],
    featureSession: planeCreateSession,
  });
  const updatedFeature = await runtime.commitFeature({
    baseRevisionId: snapshot.document.revisionId,
    baseRepositoryHeads: ["head_feature_edit"],
    featureSession: hydratedFeatureSession,
  });
  expect(
    createdFeature.accepted === true &&
      createdFeature.featureId === "feature_plane_created" &&
      createFeatureCalls[0]?.definitionKind === "plane" &&
      createFeatureCalls[0]?.baseRepositoryHeads?.[0] === "head_feature_create",
    "Create-mode feature commits should route through createFeature with the built definition.",
  ).toBeTruthy();
  expect(
    updatedFeature.accepted === true &&
      updatedFeature.featureId === hydratedFeatureSession.featureId &&
      updateFeatureCalls[0]?.featureId === hydratedFeatureSession.featureId &&
      updateFeatureCalls[0]?.definitionKind ===
        hydratedFeatureSession.featureType,
    "Edit-mode feature commits should route through updateFeature with the hydrated feature id and definition.",
  ).toBeTruthy();

  if (!runtime.setDocumentCursor) throw new Error("Expected cursor runtime.");
  const movedCursor = await runtime.setDocumentCursor({
    baseRevisionId: snapshot.document.revisionId,
    baseRepositoryHeads: ["head_cursor_runtime"],
    cursor: snapshot.document.cursor,
    transient: true,
  });
  expect(
    movedCursor.accepted === true &&
      movedCursor.revisionId === "rev_cursor_runtime" &&
      cursorCalls[0]?.persistHistory === false,
    "Transient cursor moves should disable persisted history while preserving accepted cursor results.",
  ).toBeTruthy();

  let specialModeMessage: string | null = null;
  try {
    await runtime.runSketchSpecialModeEffect?.({
      requestId: "request_runtime_special_mode" as EditorEffect["requestId"],
      documentId: snapshot.document.documentId,
      commandSessionId:
        "command_runtime_special_mode",
      baseRevisionId: snapshot.document.revisionId,
      modeId: "reference-image-calibration",
      effectId: "effect_runtime_special_mode",
      kind: "measure",
      payload: {},
    });
  } catch (error: unknown) {
    specialModeMessage = error instanceof Error ? error.message : String(error);
  }
  expect(
    specialModeMessage,
    "Runtime adapter should surface the default special-mode registration error.",
  ).toBe("No sketch special mode runtime has been registered.");

  const errorRuntime = createModelingServiceEditorEffectRuntime({
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
    commitSketch() {
      return resolved({
        revisionId: snapshot.document.revisionId,
        sketchId: snapshot.document.sketches[0]!.sketchId,
        revisionState: { kind: "accepted" as const },
        diagnostics: [],
      });
    },
    async projectSketchExternalReferences() {
      return {
        projectedReferences: [],
        diagnostics: [],
      };
    },
    sketchSolver: null,
    async evaluatePreview() {
      return {
        revisionId: snapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      };
    },
    createFeature() {
      return resolved({
        revisionId: snapshot.document.revisionId,
        featureId:
          "feature_create_ok" as (typeof snapshot.document.features)[number]["featureId"],
        revisionState: { kind: "accepted" as const },
        diagnostics: [],
      });
    },
    updateFeature() {
      return resolved({
        revisionId: snapshot.document.revisionId,
        featureId: hydratedFeatureSession.featureId!,
        revisionState: { kind: "accepted" as const },
        diagnostics: [],
      });
    },
    setFeatureCursor() {
      return resolved({
        revisionId: snapshot.document.revisionId,
        revisionState: { kind: "accepted" as const },
        diagnostics: [],
      });
    },
  });

  let incompletePreviewMessage: string | null = null;
  try {
    await errorRuntime.evaluatePreview({
      baseRevisionId: snapshot.document.revisionId,
      featureSession: incompleteFeatureSession,
    });
  } catch (error: unknown) {
    incompletePreviewMessage =
      error instanceof Error ? error.message : String(error);
  }
  expect(
    incompletePreviewMessage,
    "Preview adaptation should reject incomplete drafts before reaching the modeling service.",
  ).toBe("Feature preview failed because the draft is incomplete.");

  let incompleteCommitMessage: string | null = null;
  try {
    await errorRuntime.commitFeature({
      baseRevisionId: snapshot.document.revisionId,
      featureSession: incompleteFeatureSession,
    });
  } catch (error: unknown) {
    incompleteCommitMessage =
      error instanceof Error ? error.message : String(error);
  }
  expect(
    incompleteCommitMessage,
    "Feature commit adaptation should reject incomplete drafts before reaching the modeling service.",
  ).toBe("Feature commit failed because the draft is incomplete.");

  const rejectedRuntime = createModelingServiceEditorEffectRuntime({
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
    commitSketch() {
      return rejected(
        createAppError({
          code: "modeling/revision-rejected",
          message: "conflict",
          context: [{ key: "actualRevisionId", value: "rev_sketch_actual" }],
        }),
      );
    },
    async projectSketchExternalReferences() {
      return {
        projectedReferences: [],
        diagnostics: [],
      };
    },
    sketchSolver: null,
    async evaluatePreview() {
      return {
        revisionId: snapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      };
    },
    createFeature() {
      return resolved({
        revisionId: snapshot.document.revisionId,
        featureId:
          "feature_create_ok" as (typeof snapshot.document.features)[number]["featureId"],
        revisionState: { kind: "accepted" as const },
        diagnostics: [],
      });
    },
    updateFeature() {
      return rejected(
        createAppError({
          code: "modeling/diagnostic",
          message: "Feature conflict.",
          context: [{ key: "actualRevisionId", value: "rev_feature_actual" }],
        }),
      );
    },
    setFeatureCursor() {
      return rejected(
        createAppError({
          code: "modeling/revision-rejected",
          message: "Cursor conflict.",
          context: [{ key: "actualRevisionId", value: "rev_cursor_actual" }],
        }),
      );
    },
  });

  const rejectedFeature = await rejectedRuntime.commitFeature({
    baseRevisionId: snapshot.document.revisionId,
    featureSession: hydratedFeatureSession,
  });
  const rejectedSketchPlane = sketchPlaneSession
    ? await rejectedRuntime.commitSketchPlane({
        requestId:
          "request_runtime_sketch_plane_rejected" as EditorEffect["requestId"],
        baseRevisionId: snapshot.document.revisionId,
        session: applySelectionToSketchPlaneEditSession(
          sketchPlaneSession,
          { kind: "construction", constructionId: "construction_plane-yz" },
          snapshot,
        ),
      })
    : null;
  if (!rejectedRuntime.setDocumentCursor)
    throw new Error("Expected cursor runtime.");
  const rejectedCursor = await rejectedRuntime.setDocumentCursor({
    baseRevisionId: snapshot.document.revisionId,
    cursor: snapshot.document.cursor,
  });
  expect(
    rejectedFeature.accepted === false &&
      rejectedFeature.actualRevisionId === "rev_feature_actual" &&
      rejectedFeature.diagnostics[0]?.message === "Feature conflict.",
    "Feature commit adapter should map modeling mutation errors into rejected feature results.",
  ).toBeTruthy();
  expect(
    rejectedCursor.accepted === false &&
      rejectedCursor.actualRevisionId === "rev_cursor_actual" &&
      rejectedCursor.diagnostics[0]?.message === "Cursor conflict.",
    "Cursor adapter should map modeling mutation errors into rejected cursor results.",
  ).toBeTruthy();
  expect(
    rejectedSketchPlane?.accepted === false &&
      rejectedSketchPlane.actualRevisionId === "rev_sketch_actual" &&
      rejectedSketchPlane.diagnostics[0]?.message === "conflict",
    "Sketch-plane runtime adaptation should reuse the sketch mutation error mapping path.",
  ).toBeTruthy();
});
