import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchGeometry,
  deleteSketchHistoryOperation,
  getSketchHistoryCursorForIndex,
  getSketchHistoryCursorIndex,
  getSketchHistoryItems,
  getNextSketchHistoryCursor,
  getPreviousSketchHistoryCursor,
  moveSketchHistoryCursor,
  startSketchDraw,
} from "@/domain/editor/sketch-session";

test("src/domain/editor/sketch-session-history.spec.ts", () => {
  function addLine(
    session: ReturnType<typeof createNewSketchSessionFromSupport>,
    start: readonly [number, number],
    end: readonly [number, number],
  ) {
    const withTool = beginSketchTool(session, "line");
    const started = startSketchDraw(withTool, start);
    return acceptSketchDraw(started, end);
  }

  let session = createNewSketchSessionFromSupport({
    kind: "construction",
    constructionId: "construction_plane-xy",
  });
  session = addLine(session, [0, 0], [1, 0]);
  session = addLine(session, [0, 1], [1, 1]);

  const fullItems = getSketchHistoryItems(session.fullDefinition);
  expectTrue(
    fullItems.length === 2,
    "Sketch history should include one row per authored operation.",
  );
  expectTrue(
    fullItems.every((item) => item.kind === "operation"),
    "Sketch history should render operation rows only.",
  );
  expectTrue(
    getSketchHistoryCursorIndex(fullItems, session.historyCursor) === 1,
    "Sketch cursor should advance to the newest operation.",
  );
  expectTrue(
    getPreviousSketchHistoryCursor(session)?.kind === "item" &&
      getPreviousSketchHistoryCursor(session)?.itemId === fullItems[0]?.id,
    "Previous sketch cursor should step back one operation.",
  );
  expectTrue(
    getNextSketchHistoryCursor(session) === null,
    "Next sketch cursor should be unavailable at the tail.",
  );

  const rolledBack = moveSketchHistoryCursor(
    session,
    getSketchHistoryCursorForIndex(fullItems, 0),
  );
  expectTrue(
    rolledBack.definition.entityIds.length === 1,
    "Rolling back should filter displayed sketch entities after the cursor.",
  );
  expectTrue(
    session.fullDefinition.entityIds.length === 2,
    "Rolling back must not mutate the prior full draft definition.",
  );
  expectTrue(
    getPreviousSketchHistoryCursor(rolledBack)?.kind === "empty",
    "Previous sketch cursor should move to the before-first position.",
  );
  expectTrue(
    getNextSketchHistoryCursor(rolledBack)?.kind === "item" &&
      getNextSketchHistoryCursor(rolledBack)?.itemId === fullItems[1]?.id,
    "Next sketch cursor should step toward after-cursor authored items.",
  );

  const beforeFirst = moveSketchHistoryCursor(session, { kind: "empty" });
  expectTrue(
    getPreviousSketchHistoryCursor(beforeFirst) === null,
    "Undo should be unavailable before the first sketch item.",
  );
  expectTrue(
    getNextSketchHistoryCursor(beforeFirst)?.kind === "item" &&
      getNextSketchHistoryCursor(beforeFirst)?.itemId === fullItems[0]?.id,
    "Redo should be available from the before-first sketch cursor position.",
  );

  const inserted = addLine(rolledBack, [0, 2], [1, 2]);
  const insertedItems = getSketchHistoryItems(inserted.fullDefinition);
  expectTrue(
    inserted.fullDefinition.entityIds.length === 2,
    "Inserting after a rolled-back cursor should replace after-cursor sketch items.",
  );
  expectTrue(
    inserted.definition.entityIds.length === 2,
    "Displayed sketch definition should include the inserted tail item.",
  );
  expectTrue(
    getSketchHistoryCursorIndex(insertedItems, inserted.historyCursor) ===
      insertedItems.length - 1,
    "Sketch cursor should advance to the newly inserted item.",
  );

  const cursorRepair = deleteSketchHistoryOperation(session, fullItems[1]!.id);
  expectTrue(
    cursorRepair.fullDefinition.authoringOperations?.length === 1,
    "Deleting a history row should remove the targeted authored operation.",
  );
  expectTrue(
    cursorRepair.historyCursor.kind === "item" &&
      cursorRepair.historyCursor.itemId === fullItems[0]!.id,
    "Deleting the current history row should repair the cursor to the nearest surviving predecessor.",
  );
  expectTrue(
    cursorRepair.fullDefinition.authoringOperations?.every(
      (operation) => operation.kind !== "delete",
    ),
    "Deleting an authored row from history should not append a replacement delete operation.",
  );

  const singleRowWithLine = addLine(
    createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    }),
    [0, 0],
    [2, 0],
  );
  const singleRowId =
    singleRowWithLine.fullDefinition.authoringOperations?.[0]?.operationId;
  expectTrue(
    singleRowId,
    "Single-row history delete fixture should create one authored operation.",
  );
  const emptied = deleteSketchHistoryOperation(singleRowWithLine, singleRowId);
  expectTrue(
    emptied.historyCursor.kind === "empty",
    "Deleting the last history row should repair the cursor to the empty position.",
  );
  expectTrue(
    emptied.definition.entityIds.length === 0,
    "Deleting the final history row should clear the rebuilt sketch graph.",
  );

  const deleteFixture = addLine(
    createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    }),
    [0, 0],
    [3, 0],
  );
  const deletedEntityId = deleteFixture.definition.entityIds[0];
  expectTrue(
    deletedEntityId,
    "Delete-row fixture should expose one authored entity.",
  );
  const withDeleteRow = deleteSelectedSketchGeometry(deleteFixture, [
    {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: deletedEntityId,
    },
  ]);
  const deleteRowId =
    withDeleteRow.fullDefinition.authoringOperations?.at(-1)?.operationId;
  expectTrue(
    deleteRowId,
    "Live deletion should append a durable delete row before it can be removed from history.",
  );
  const restored = deleteSketchHistoryOperation(withDeleteRow, deleteRowId);
  expectTrue(
    restored.fullDefinition.authoringOperations?.every(
      (operation) => operation.kind !== "delete",
    ),
    "Deleting an existing delete row from history should remove that row instead of appending another delete row.",
  );
  expectTrue(
    restored.definition.entityIds.includes(deletedEntityId),
    "Deleting a delete row from history should restore the geometry it had removed.",
  );
});
