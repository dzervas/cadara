import { describe, expect, test, vi } from "vitest";

import { buildSelectionTargetCatalog } from "@/domain/modeling/document-snapshot-view";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { createReferenceImageOperation } from "@/domain/reference-image/operations";
import { REFERENCE_IMAGE_CALIBRATION_MODE_ID } from "@/domain/reference-image-calibration/mode/shared";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import { transitionEditorState } from "./reducer-root";
import { initialEditorState } from "./state-creators";
import type {
  EditorEffect,
  EditorTransitionResult,
  SelectionCommandEditorState,
  SketchEditorState,
} from "./types";

// Logic lane (core seam): every production sketch entry establishes a live
// solve basis and requests reference projection (T11a, A3; review R-5).

/** Counts synchronous sketch solves (the entry's cost, review R-5). */
const solveCount = vi.hoisted(() => ({ value: 0 }));
vi.mock("@/contracts/sketch/solver-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/contracts/sketch/solver-core")>();
  return {
    ...actual,
    solveSketchDefinitionCore: (
      ...args: Parameters<typeof actual.solveSketchDefinitionCore>
    ) => {
      solveCount.value += 1;
      return actual.solveSketchDefinitionCore(...args);
    },
  };
});

async function seedSketchCommand(withReference = true) {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  if (!withReference) {
    sketch.sketch.definition.references = [];
    sketch.sketch.definition.referenceIds = [];
  }
  const operation = createReferenceImageOperation({
    sequence: 1,
    sketchId: sketch.sketchId,
    payload: {
      mediaType: "image/png",
      pixelWidth: 4,
      pixelHeight: 2,
      base64Data: "cG5n",
    },
  });
  sketch.sketch.definition.referenceImages = [operation];
  expect(
    sketch.sketch.definition.references.length > 0,
    "premise: whether the seed sketch has a reference to project",
  ).toBe(withReference);
  const state: SelectionCommandEditorState = {
    ...initialEditorState,
    kind: "selectionCommand",
    mode: "part",
    document: {
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
    },
    snapshot,
    selection: [{ kind: "sketch", sketchId: sketch.sketchId }],
    selectionCatalog: buildSelectionTargetCatalog(snapshot),
    command: {
      commandSessionId: "command_t11a",
      toolId: "sketch",
      phase: "collecting",
    },
    pendingRequestId: null,
  };
  return { state, operation };
}

function editingSketch(result: EditorTransitionResult) {
  expect(result.state.kind).toBe("editingSketch");
  return result.state as SketchEditorState;
}

function projectionRequests(effects: readonly EditorEffect[]) {
  return effects.filter((effect) => effect.type === "sketch.projectReferences");
}

/** Basis now, projection requested, the opening round derives that basis. */
function expectEntryBasis(result: EditorTransitionResult, label: string) {
  const state = editingSketch(result);
  const { session } = state;
  expect(session.liveSolve, `${label}: a live solve basis`).not.toBe(null);
  expect(
    session.liveSolve!.sourceDefinition,
    `${label}: the basis is of the opened definition`,
  ).toBe(session.definition);
  expect(session.liveSolve!.accepted, label).toBe(true);
  expect(session.liveRegions.status, `${label}: the round is pending`).toBe(
    "pending",
  );
  if (session.definition.references.length > 0) {
    const [projection] = projectionRequests(result.effects);
    expect(
      projectionRequests(result.effects),
      `${label}: one reference projection request`,
    ).toHaveLength(1);
    expect(
      projection,
      `${label}: the projection request is the pending one`,
    ).toMatchObject({
      requestId: state.pendingProjectionRequestId,
      commandSessionId: state.command.commandSessionId,
    });
  } else {
    expect(
      projectionRequests(result.effects),
      `${label}: nothing to project`,
    ).toEqual([]);
  }
  expect(
    result.effects.find((effect) => effect.type === "sketch.deriveRegions"),
    `${label}: the opening round derives the basis, with no edit`,
  ).toMatchObject({
    requestId: state.pendingRegionRequest?.requestId,
    generation: session.liveRegions.generation,
    basis: { definition: session.liveSolve!.definition },
  });
  return state;
}

describe("T11a sketch entry establishes a live solve basis", () => {
  test("reference-image import from the sketch selection command: basis, projection request and the import effect", async () => {
    const { state } = await seedSketchCommand();
    const result = transitionEditorState(state, {
      type: "sketch.referenceImagePayloadsPicked",
      payloads: [
        {
          mediaType: "image/png",
          fileName: "reference.png",
          pixelWidth: 640,
          pixelHeight: 480,
          base64Data: "cG5n",
        },
      ],
    });
    const entered = expectEntryBasis(result, "import bypass");
    expect(
      result.effects.map((effect) => effect.type),
      "The projection request is merged with the import effect.",
    ).toEqual([
      "sketch.projectReferences",
      "sketch.importReferenceImages",
      "sketch.deriveRegions",
    ]);
    expect(entered.pendingImportRequestId).toBe(result.effects[1]!.requestId);
    expect(entered.pendingImportRequestId).not.toBe(
      entered.pendingProjectionRequestId,
    );
  });

  test("reference-image import cancelled from the sketch selection command: basis and projection request, message kept", async () => {
    const { state } = await seedSketchCommand();
    const result = transitionEditorState(state, {
      type: "sketch.referenceImagePayloadsPicked",
      payloads: null,
      message: "No image selected.",
    });
    const entered = expectEntryBasis(result, "cancelled import bypass");
    expect(entered.session.validationMessage).toBe("No image selected.");
    expect(entered.preview?.label).toBe("No image selected.");
  });

  test("special mode from the sketch selection command: basis and projection request merged with the forwarded mode entry", async () => {
    const { state, operation } = await seedSketchCommand();
    const result = transitionEditorState(state, {
      type: "sketch.specialModeEntered",
      modeId: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
      operationId: operation.operationId,
    });
    const entered = expectEntryBasis(result, "special-mode bypass");
    expect(
      entered.session.activeSpecialMode?.modeId,
      "the forwarded event entered the mode",
    ).toBe(REFERENCE_IMAGE_CALIBRATION_MODE_ID);
    expect(result.effects.map((effect) => effect.type)).toEqual([
      "sketch.projectReferences",
      "sketch.deriveRegions",
    ]);
  });

  test("normal open without references solves once (no second solve for the basis)", async () => {
    const { state } = await seedSketchCommand(false);
    const session = openSketchSessionFromSelection(
      state.selection.slice(),
      state.snapshot!,
    )!;
    solveCount.value = 0;
    const opened = transitionEditorState(
      { ...state, pendingRequestId: "request_open" },
      {
        type: "effect.sketchSessionOpened",
        requestId: "request_open",
        documentId: state.document.documentId!,
        revisionId: state.document.revisionId!,
        commandSessionId: state.command.commandSessionId,
        session,
      },
    );
    expect(solveCount.value, "one synchronous solve on open").toBe(1);
    expectEntryBasis(opened, "normal open without references");
  });

  test("normal open, then projection failure: the entry basis is kept (no re-solve, no new round) and its round still publishes", async () => {
    const { state } = await seedSketchCommand();
    const session = openSketchSessionFromSelection(
      state.selection.slice(),
      state.snapshot!,
    )!;
    expect(session.liveSolve, "premise: a raw opened session").toBe(null);
    const openedResult = transitionEditorState(
      { ...state, pendingRequestId: "request_open" },
      {
        type: "effect.sketchSessionOpened",
        requestId: "request_open",
        documentId: state.document.documentId!,
        revisionId: state.document.revisionId!,
        commandSessionId: state.command.commandSessionId,
        session,
      },
    );
    const opened = expectEntryBasis(openedResult, "normal open");
    expect(opened.session.definition, "opening authors nothing").toBe(
      session.definition,
    );

    const failedResult = transitionEditorState(opened, {
      type: "effect.sketchReferenceProjectionFailed",
      requestId: opened.pendingProjectionRequestId!,
      documentId: opened.document.documentId!,
      commandSessionId: opened.command.commandSessionId,
      baseRevisionId: opened.document.revisionId!,
      message: "Reference projection failed.",
    });
    const failed = editingSketch(failedResult);
    expect(failed.pendingProjectionRequestId).toBe(null);
    expect(failed.session.validationMessage).toBe(
      "Reference projection failed.",
    );
    expect(
      failed.session.liveSolve,
      "the entry basis (same projections) is kept",
    ).toBe(opened.session.liveSolve);
    expect(failed.session.liveRegions.generation).toBe(
      opened.session.liveRegions.generation,
    );
    expect(failedResult.effects, "no new derivation round").toEqual([]);
    expect(failed.pendingRegionRequest).toEqual(opened.pendingRegionRequest);

    // The entry round's result is current and publishes.
    const entryRequest = opened.pendingRegionRequest!;
    const published = editingSketch(
      transitionEditorState(failed, {
        type: "effect.sketchRegionsDerived",
        requestId: entryRequest.requestId,
        documentId: failed.document.documentId!,
        commandSessionId: failed.command.commandSessionId,
        baseRevisionId: failed.document.revisionId!,
        generation: entryRequest.generation,
        regions: [],
        diagnostics: [],
        offsetPublications: [],
      }),
    );
    expect(published.session.liveRegions.status).toBe("current");
    expect(published.pendingRegionRequest).toBe(null);
  });

  test("import completion replaces the session with a raw reopened one: it is based at once, its projection is requested and its round derives", async () => {
    const { state } = await seedSketchCommand();
    const entered = editingSketch(
      transitionEditorState(state, {
        type: "sketch.referenceImagePayloadsPicked",
        payloads: [
          {
            mediaType: "image/png",
            fileName: "reference.png",
            pixelWidth: 4,
            pixelHeight: 2,
            base64Data: "cG5n",
          },
        ],
      }),
    );
    // What the app runtime returns after the import commit.
    const raw = openSketchSessionFromSelection(
      state.selection.slice(),
      state.snapshot!,
    )!;
    expect(raw.liveSolve, "premise: a raw reopened session").toBe(null);
    const result = transitionEditorState(entered, {
      type: "effect.sketchReferenceImageImportCompleted",
      requestId: entered.pendingImportRequestId!,
      documentId: entered.document.documentId!,
      commandSessionId: entered.command.commandSessionId,
      baseRevisionId: entered.document.revisionId!,
      status: "committed",
      revisionId: entered.document.revisionId!,
      snapshot: state.snapshot!,
      selectionCatalog: state.selectionCatalog,
      session: raw,
      importedCount: 1,
    });
    const completed = expectEntryBasis(result, "import completion");
    expect(completed.session.liveSolve!.sourceDefinition).toBe(raw.definition);
    expect(result.effects.map((effect) => effect.type)).toEqual([
      "sketch.projectReferences",
      "sketch.deriveRegions",
    ]);
    expect(
      (projectionRequests(result.effects)[0] as { session: unknown }).session,
      "the projection effect carries the based session",
    ).toBe(completed.session);
  });

  test("an in-session reference pick keeps its own basis: the projection request carries the state's session, no extra generation", async () => {
    const { state } = await seedSketchCommand();
    const session = openSketchSessionFromSelection(
      state.selection.slice(),
      state.snapshot!,
    )!;
    const opened = editingSketch(
      transitionEditorState(
        { ...state, pendingRequestId: "request_open" },
        {
          type: "effect.sketchSessionOpened",
          requestId: "request_open",
          documentId: state.document.documentId!,
          revisionId: state.document.revisionId!,
          commandSessionId: state.command.commandSessionId,
          session,
        },
      ),
    );
    const picking = editingSketch(
      transitionEditorState(
        { ...opened, pendingProjectionRequestId: null },
        { type: "tool.activated", toolId: "projectReference" },
      ),
    );
    expect(picking.session.referenceTargetPicking, "premise").toBe(true);
    const result = transitionEditorState(picking, {
      type: "viewport.selectionRequested",
      target: { kind: "edge", bodyId: "body_part-1", edgeId: "edge_outer-0" },
    });
    const picked = editingSketch(result);
    expect(
      picked.session.definition.references.length,
      "premise: the pick authored a reference",
    ).toBe(session.definition.references.length + 1);
    const requests = projectionRequests(result.effects);
    expect(requests).toHaveLength(1);
    expect(
      (requests[0] as { session: unknown }).session,
      "the projection request carries the state's session as is",
    ).toBe(picked.session);
    expect(
      picked.session.liveRegions.generation,
      "only the pick's own basis bumps the generation",
    ).toBe(picking.session.liveRegions.generation + 1);
  });
});
