import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import type { ReferenceImagePayload } from "@/contracts/reference-image/schema";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import { createAppEditorEffectRuntime } from "./create-app-editor-effect-runtime";

async function expectRejects(
  action: () => Promise<unknown>,
  pattern: RegExp,
  message: string,
) {
  try {
    await action();
  } catch (error) {
    expectTrue(error instanceof Error && pattern.test(error.message), message);
    return;
  }

  throw new Error(message);
}

function makeModelingService(
  snapshot: Awaited<ReturnType<typeof createSeedDocumentSnapshot>>,
): ModelingService {
  return {
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
  } as unknown as ModelingService;
}

test("create-app-editor-effect-runtime.ts maps cancelled sketch image imports back to the base revision without reopening the sketch", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const session = openSketchSessionFromSelection(
    [{ kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId }],
    snapshot,
  );

  expectTrue(
    session,
    "Seed snapshot should expose a sketch session for image-import runtime coverage.",
  );

  const runtime = createAppEditorEffectRuntime(makeModelingService(snapshot), {
    async runSketchImageImportFlow() {
      return { kind: "cancelled" };
    },
  });
  const result = await runtime.importSketchReferenceImages?.({
    requestId: "request_sketch-import-1",
    documentId: snapshot.document.documentId,
    commandSessionId: "command_sketch-1",
    baseRevisionId: snapshot.document.revisionId,
    baseRepositoryHeads: ["head_1"],
    session,
    payloads: [
      {
        mediaType: "image/png",
        base64Data: "cG5n",
        pixelWidth: 32,
        pixelHeight: 24,
        fileName: "reference.png",
      },
    ],
  });

  expectTrue(
    result?.status === "cancelled" &&
      result.revisionId === snapshot.document.revisionId,
    "Cancelled reference-image imports should resolve through the cancelled result seam pinned to the original base revision.",
  );
});

test("create-app-editor-effect-runtime.ts rethrows failed import-flow results and reports reopen failures after a commit", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const session = openSketchSessionFromSelection(
    [{ kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId }],
    snapshot,
  );

  expectTrue(
    session,
    "Seed snapshot should expose a sketch session for image-import runtime failure coverage.",
  );

  const failingRuntime = createAppEditorEffectRuntime(
    makeModelingService(snapshot),
    {
      async runSketchImageImportFlow() {
        return {
          kind: "failed",
          message: "Reference-image selection failed.",
        };
      },
    },
  );
  const reopenFailureRuntime = createAppEditorEffectRuntime(
    makeModelingService(snapshot),
    {
      async runSketchImageImportFlow() {
        return {
          kind: "committed",
          payloads: [
            {
              mediaType: "image/png",
              base64Data: "cG5n",
              pixelWidth: 64,
              pixelHeight: 48,
              fileName: "reference.png",
            },
          ],
          sketchId: snapshot.document.sketches[0]!.sketchId,
          snapshot,
          commitResult: {
            revisionId: snapshot.document.revisionId,
            sketchId: snapshot.document.sketches[0]!.sketchId,
            revisionState: { kind: "accepted" },
            rebuildResult: "reused",
            changedTargets: [],
            diagnostics: [],
          },
          reopenRequest: {
            type: "authoring.reopenRequested",
            target: {
              kind: "sketch",
              sketchId: snapshot.document.sketches[0]!.sketchId,
            },
            toolId: "sketch",
          },
        };
      },
      openSketchSessionFromSelection() {
        return null;
      },
    },
  );

  await expectRejects(
    () =>
      failingRuntime.importSketchReferenceImages?.({
        requestId: "request_sketch-import-failed",
        documentId: snapshot.document.documentId,
        commandSessionId: "command_sketch-1",
        baseRevisionId: snapshot.document.revisionId,
        session,
        payloads: [],
      }),
    /Reference-image selection failed\./,
    "Failed import-flow results should rethrow their user-facing message.",
  );
  await expectRejects(
    () =>
      reopenFailureRuntime.importSketchReferenceImages?.({
        requestId: "request_sketch-import-reopen",
        documentId: snapshot.document.documentId,
        commandSessionId: "command_sketch-1",
        baseRevisionId: snapshot.document.revisionId,
        session,
        payloads: [],
      }),
    /could not be reopened/,
    "Committed imports should throw when the runtime cannot reopen the imported sketch session.",
  );
});

test("create-app-editor-effect-runtime.ts routes reference-image replacement special-mode effects through the injected picker seam", async () => {
  const pickedImage: ReferenceImagePayload = {
    mediaType: "image/png",
    base64Data: "cG5n",
    pixelWidth: 320,
    pixelHeight: 200,
    fileName: "replacement.png",
  };
  const runtime = createAppEditorEffectRuntime(
    makeModelingService(await createSeedDocumentSnapshot()),
    {
      async pickReferenceImagePayload() {
        return pickedImage;
      },
    },
  );
  const result = await runtime.runSketchSpecialModeEffect?.({
    requestId: "request_special-mode-1",
    documentId: "doc_fixture",
    commandSessionId: "command_sketch-1",
    baseRevisionId: "rev_fixture",
    modeId: "reference-image-calibration",
    effectId: "replace-image",
    kind: "reference-image-replace-image",
    payload: {},
  });

  expectTrue(
    result?.effectId === "replace-image" &&
      result.payload.image === pickedImage,
    "Reference-image replacement special-mode effects should resolve by attaching the picked image payload to the effect result.",
  );
});
