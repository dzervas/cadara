import { test, expect } from "vitest";

import { ResultAsync, type AppError } from "@/contracts/errors";
import type {
  ConstructionId,
  DocumentId,
  ReferenceId,
  RequestId,
  RevisionId,
} from "@/contracts/shared/ids";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchGeometry,
  getSketchSessionLiveRegionBasis,
  startSketchDraw,
} from "@/domain/editor/sketch-session";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import {
  createModelingServiceEditorEffectRuntime,
  runEditorEffect,
} from "./effect-registry";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { createRecordingNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import {
  SketchConstraintSolverAdapter,
  SketchRegionDerivationSupersededError,
} from "@/domain/solver/sketch-constraint-solver-adapter";
import { defaultSelectionFilter } from "@/core/editor/schema";
import { transitionEditorState } from "@/core/editor/state-machine/reducer-root";
import { initialEditorState } from "@/core/editor/state-machine/state-creators";
import type {
  EditorEffect,
  SketchEditorState,
} from "@/core/editor/state-machine/types";
import { withLiveSolveBasis } from "@/domain/editor/sketch-session";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";

test("commits the current authored sketch after deletion without resurrecting a history tail", async () => {
  function addLine(
    session: ReturnType<typeof createNewSketchSessionFromSupport>,
    start: readonly [number, number],
    end: readonly [number, number],
  ) {
    const withTool = beginSketchTool(session, "line");
    return acceptSketchDraw(startSketchDraw(withTool, start), end);
  }

  let session = createNewSketchSessionFromSupport(
    {
      kind: "construction",
      constructionId: "construction_plane-xy",
    },
    OCC_KERNEL_SETTINGS,
  );
  session = addLine(session, [0, 0], [1, 0]);
  session = addLine(session, [0, 1], [1, 1]);

  const deletedSession = deleteSelectedSketchGeometry(session, [
    session.definition.entities[0]!.target,
  ]);
  let committedEntityCount = 0;

  const runtime = createModelingServiceEditorEffectRuntime({
    async getCurrentDocumentSnapshot() {
      throw new Error("Snapshot fetch is not used by commit routing coverage.");
    },
    async projectSketchExternalReferences() {
      return { projectedReferences: [], diagnostics: [] };
    },
    sketchSolver: null,
    commitSketch(input) {
      committedEntityCount = input.definition.entityIds.length;
      return ResultAsync.fromPromise(
        Promise.resolve({
          revisionId: "rev_0002" as RevisionId,
          revisionState: { kind: "accepted" as const },
          diagnostics: [],
        }),
        (error) => error as AppError,
      );
    },
    evaluatePreview() {
      throw new Error(
        "Feature preview is not used by commit routing coverage.",
      );
    },
    createFeature() {
      throw new Error("Feature create is not used by commit routing coverage.");
    },
    updateFeature() {
      throw new Error("Feature update is not used by commit routing coverage.");
    },
    setFeatureCursor() {
      throw new Error("Feature cursor is not used by commit routing coverage.");
    },
  });

  expect(session.definition.entities).toHaveLength(2);
  expect(deletedSession.definition.entities).toHaveLength(1);

  const result = await runtime.commitSketch({
    requestId: "request_commit_full_sketch" as RequestId,
    baseRevisionId: "rev_0001" as RevisionId,
    baseRepositoryHeads: [],
    documentId: "doc_fixture" as DocumentId,
    commandSessionId: "command_sketch_fixture",
    session: deletedSession,
  });

  expect(
    result?.accepted,
    "Current authored sketch should commit through the modeling service.",
  ).toBeTruthy();
  expect(
    committedEntityCount,
    "Deleted geometry must stay absent from the published candidate.",
  ).toBe(1);
});

test("sketch reference projection uses the live session's document tolerance policy", async () => {
  const session = createNewSketchSessionFromSupport(
    { kind: "construction", constructionId: "construction_plane-xy" },
    {
      linearUnit: "millimeter",
      modelingTolerance: 0.02,
      angularToleranceRadians: 0.003,
    },
  );
  const referenced = {
    ...session,
    definition: {
      ...session.definition,
      referenceIds: ["reference_projection_policy" as ReferenceId],
      references: [
        {
          referenceId: "reference_projection_policy" as ReferenceId,
          kind: "constructionPlane" as const,
          label: "XZ",
          source: {
            kind: "construction" as const,
            constructionId: "construction_plane-xz" as ConstructionId,
          },
          projectionMode: "coplanar" as const,
        },
      ],
    },
  };
  const projectionTolerances: unknown[] = [];
  const unused = () => {
    throw new Error("Only reference projection is exercised here.");
  };
  const runtime = createModelingServiceEditorEffectRuntime({
    getCurrentDocumentSnapshot: unused,
    async projectSketchExternalReferences(input) {
      projectionTolerances.push(input.tolerances);
      return { projectedReferences: [], diagnostics: [] };
    },
    sketchSolver: null,
    commitSketch: unused,
    evaluatePreview: unused,
    createFeature: unused,
    updateFeature: unused,
    setFeatureCursor: unused,
  });

  await runtime.projectSketchReferences({
    requestId: "request_projection_policy" as RequestId,
    documentId: "doc_fixture" as DocumentId,
    baseRevisionId: "rev_0001" as RevisionId,
    session: referenced,
  });

  expect(
    projectionTolerances,
    "Live reference projection must use the session's document tolerance, like commit projection.",
  ).toEqual([
    { coincidence: 0.02, angleRadians: 0.003, minimumSegmentLength: 0.02 },
  ]);
});

test("live region derivation goes through the modeling service sketch solver boundary and completes as sketchRegionsDerived", async () => {
  let session = createNewSketchSessionFromSupport(
    { kind: "construction", constructionId: "construction_plane-xy" },
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [0, 0]),
    [2, 1],
  );
  const basis = getSketchSessionLiveRegionBasis(session);
  expect(basis, "An edited session carries a live solve basis.").toBeTruthy();
  const requests: unknown[] = [];
  const unused = () => {
    throw new Error("Only live region derivation is exercised here.");
  };
  const runtime = createModelingServiceEditorEffectRuntime({
    getCurrentDocumentSnapshot: unused,
    projectSketchExternalReferences: unused,
    sketchSolver: {
      async deriveSketchRegions(input) {
        requests.push(input);
        return { regions: [], diagnostics: [] };
      },
      createCommitCorrelation: unused,
      projectExternalReferences: unused,
    },
    commitSketch: unused,
    evaluatePreview: unused,
    createFeature: unused,
    updateFeature: unused,
    setFeatureCursor: unused,
  });

  const event = await runEditorEffect(
    {
      type: "sketch.deriveRegions",
      background: true,
      requestId: "request_live_regions-1" as RequestId,
      commandSessionId: "command_sketch-1",
      documentId: "doc_fixture" as DocumentId,
      baseRevisionId: "rev_0001" as RevisionId,
      generation: 7,
      basis: basis!,
    },
    runtime,
  );

  expect(requests).toEqual([
    {
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: "request_live_regions-1",
      documentId: "doc_fixture",
      revisionId: "rev_0001",
      sketchId: basis!.sketchId,
      definition: basis!.definition,
      solvedSnapshot: basis!.solvedSnapshot,
      projectedReferences: basis!.projectedReferences,
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    },
  ]);
  expect(event).toEqual({
    type: "effect.sketchRegionsDerived",
    requestId: "request_live_regions-1",
    documentId: "doc_fixture",
    commandSessionId: "command_sketch-1",
    baseRevisionId: "rev_0001",
    generation: 7,
    regions: [],
    diagnostics: [],
  });

  await expect(
    runEditorEffect(
      {
        type: "sketch.deriveRegions",
        background: true,
        requestId: "request_live_regions-2" as RequestId,
        commandSessionId: "command_sketch-1",
        documentId: "doc_fixture" as DocumentId,
        baseRevisionId: "rev_0001" as RevisionId,
        generation: 8,
        basis: basis!,
      },
      createModelingServiceEditorEffectRuntime({
        getCurrentDocumentSnapshot: unused,
        projectSketchExternalReferences: unused,
        sketchSolver: null,
        commitSketch: unused,
        evaluatePreview: unused,
        createFeature: unused,
        updateFeature: unused,
        setFeatureCursor: unused,
      }),
    ),
    "A missing solver rejects so the event loop reports it; it is never swallowed.",
  ).rejects.toThrow(
    "Live sketch regions require the modeling service sketch solver.",
  );
});

// Seam: live region requests carry the session's document tolerance through
// the modeling-service solver boundary unchanged, down to every query.
test("two documents with different tolerances reach the live region queries with their own modelingTolerance", async () => {
  for (const modelingTolerance of [
    OCC_KERNEL_SETTINGS.modelingTolerance,
    0.02,
  ]) {
    const recording = createRecordingNeutralCurveQueryCapabilityForTest();
    const solver = new SketchConstraintSolverAdapter({
      documentId: "doc_fixture" as DocumentId,
      revisionId: null,
      neutralCurveQueries: recording.capability,
    });
    const unused = () => {
      throw new Error("Only live region derivation is exercised here.");
    };
    const runtime = createModelingServiceEditorEffectRuntime({
      getCurrentDocumentSnapshot: unused,
      projectSketchExternalReferences: unused,
      sketchSolver: {
        deriveSketchRegions: (input) =>
          solver.deriveSketchRegions({
            ...input,
            contractVersion: "modeling-contract/v1alpha1",
          }),
        createCommitCorrelation: unused,
        projectExternalReferences: unused,
      },
      commitSketch: unused,
      evaluatePreview: unused,
      createFeature: unused,
      updateFeature: unused,
      setFeatureCursor: unused,
    });
    const session = acceptSketchDraw(
      startSketchDraw(
        beginSketchTool(
          createNewSketchSessionFromSupport(
            { kind: "construction", constructionId: "construction_plane-xy" },
            { ...OCC_KERNEL_SETTINGS, modelingTolerance },
          ),
          "rectangle",
        ),
        [0, 0],
      ),
      [2, 1],
    );
    const event = await runEditorEffect(
      {
        type: "sketch.deriveRegions",
        background: true,
        requestId: "request_live_regions_tolerance" as RequestId,
        commandSessionId: "command_sketch-1",
        documentId: "doc_fixture" as DocumentId,
        baseRevisionId: "rev_0001" as RevisionId,
        generation: 1,
        basis: getSketchSessionLiveRegionBasis(session)!,
      },
      runtime,
    );
    expect(
      event.type === "effect.sketchRegionsDerived" && event.regions.length,
      "The drawn rectangle derives one live region.",
    ).toBe(1);
    expect(
      recording.modelingTolerances.length,
      "Live derivation reaches the injected queries.",
    ).toBeGreaterThan(0);
    expect(
      new Set(recording.modelingTolerances),
      `Every live query carries the document tolerance ${modelingTolerance} unchanged.`,
    ).toEqual(new Set([modelingTolerance]));
  }
});

// Seam: a live derivation superseded by a newer request for its document (the
// dedicated derivation worker terminates it) completes as the standard
// failure event, which the reducer discards because the newer request owns
// the pending slot; any other rejection still reaches error reporting.
test("a superseded live derivation completes as a stale failure event; real errors still reject", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  const opened = openSketchSessionFromSelection(
    [{ kind: "sketch", sketchId: sketch.sketchId }],
    snapshot,
  )!;
  const session = withLiveSolveBasis(opened, opened.definition);
  const sessionState = (commandSessionId: string): SketchEditorState => ({
    ...initialEditorState,
    document: {
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
    },
    snapshot,
    kind: "editingSketch",
    mode: "sketch",
    command: { commandSessionId, toolId: "sketch", phase: "editing" },
    session,
    selection: [{ kind: "sketch", sketchId: sketch.sketchId }],
    selectionFilter: defaultSelectionFilter,
    pendingCommitRequestId: null,
    pendingProjectionRequestId: null,
    pendingImportRequestId: null,
    pendingRegionRequest: null,
  });
  const deriveEffect = (state: SketchEditorState) => {
    const result = transitionEditorState(state, {
      type: "document.refreshRequested",
    });
    const effect = result.effects.find(
      (
        candidate,
      ): candidate is Extract<EditorEffect, { type: "sketch.deriveRegions" }> =>
        candidate.type === "sketch.deriveRegions",
    )!;
    return { state: result.state as SketchEditorState, effect };
  };
  // The old command session's request is still running when the sketch is
  // re-entered; the new session's request supersedes it in the pool.
  const old = deriveEffect(sessionState("command_sketch-1"));
  const current = deriveEffect(sessionState("command_sketch-2"));
  const unused = () => {
    throw new Error("Only live region derivation is exercised here.");
  };
  const runtimeRejecting = (error: Error) =>
    createModelingServiceEditorEffectRuntime({
      getCurrentDocumentSnapshot: unused,
      projectSketchExternalReferences: unused,
      sketchSolver: {
        async deriveSketchRegions() {
          throw error;
        },
        createCommitCorrelation: unused,
        projectExternalReferences: unused,
      },
      commitSketch: unused,
      evaluatePreview: unused,
      createFeature: unused,
      updateFeature: unused,
      setFeatureCursor: unused,
    });
  const request = (requestId: string) =>
    ({
      contractVersion: "modeling-contract/v1alpha1",
      requestId,
      documentId: old.effect.documentId,
    }) as never;
  const superseded = new SketchRegionDerivationSupersededError(
    request(old.effect.requestId),
    request(current.effect.requestId),
  );

  const event = await runEditorEffect(old.effect, runtimeRejecting(superseded));
  expect(
    event,
    "The superseded request completes as its own standard failure event.",
  ).toMatchObject({
    type: "effect.sketchRegionDerivationFailed",
    requestId: old.effect.requestId,
    commandSessionId: "command_sketch-1",
    generation: old.effect.generation,
  });
  const after = transitionEditorState(current.state, event);
  const afterState = after.state as SketchEditorState;
  expect(
    afterState.pendingRegionRequest,
    "The newer request keeps the pending slot.",
  ).toEqual(current.state.pendingRegionRequest);
  expect(
    afterState.session.liveRegions,
    "The superseded failure never marks the current session's regions failed.",
  ).toBe(current.state.session.liveRegions);
  expect(after.effects, "Nothing is re-emitted.").toEqual([]);

  await expect(
    runEditorEffect(
      current.effect,
      runtimeRejecting(new Error("worker derivation failed")),
    ),
    "Any other rejection still reaches the event loop's error reporting.",
  ).rejects.toThrow("worker derivation failed");
});
