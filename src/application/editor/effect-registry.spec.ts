import { test, expect } from "vitest";

import { ResultAsync, type AppError } from "@/contracts/errors";
import type { DocumentId, RequestId, RevisionId } from "@/contracts/shared/ids";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchGeometry,
  startSketchDraw,
} from "@/domain/editor/sketch-session";
import { createModelingServiceEditorEffectRuntime } from "./effect-registry";

test("commits the current authored sketch after deletion without resurrecting a history tail", async () => {
  function addLine(
    session: ReturnType<typeof createNewSketchSessionFromSupport>,
    start: readonly [number, number],
    end: readonly [number, number],
  ) {
    const withTool = beginSketchTool(session, "line");
    return acceptSketchDraw(startSketchDraw(withTool, start), end);
  }

  let session = createNewSketchSessionFromSupport({
    kind: "construction",
    constructionId: "construction_plane-xy",
  });
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
