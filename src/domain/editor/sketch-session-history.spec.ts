import { test, expect } from "vitest";

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
  expect(
    fullItems.length,
    "Sketch history should include one row per authored operation.",
  ).toBe(2);
  expect(
    fullItems.every((item) => item.kind === "operation"),
    "Sketch history should render operation rows only.",
  ).toBeTruthy();
  expect(
    getSketchHistoryCursorIndex(fullItems, session.historyCursor),
    "Sketch cursor should advance to the newest operation.",
  ).toBe(1);
  expect(
    getPreviousSketchHistoryCursor(session)?.kind === "item" &&
      getPreviousSketchHistoryCursor(session)?.itemId === fullItems[0]?.id,
    "Previous sketch cursor should step back one operation.",
  ).toBeTruthy();
  expect(
    getNextSketchHistoryCursor(session),
    "Next sketch cursor should be unavailable at the tail.",
  ).toBe(null);

  const rolledBack = moveSketchHistoryCursor(
    session,
    getSketchHistoryCursorForIndex(fullItems, 0),
  );
  expect(
    rolledBack.definition.entityIds.length,
    "Rolling back should filter displayed sketch entities after the cursor.",
  ).toBe(1);
  expect(
    session.fullDefinition.entityIds.length,
    "Rolling back must not mutate the prior full draft definition.",
  ).toBe(2);
  expect(
    getPreviousSketchHistoryCursor(rolledBack)?.kind,
    "Previous sketch cursor should move to the before-first position.",
  ).toBe("empty");
  expect(
    getNextSketchHistoryCursor(rolledBack)?.kind === "item" &&
      getNextSketchHistoryCursor(rolledBack)?.itemId === fullItems[1]?.id,
    "Next sketch cursor should step toward after-cursor authored items.",
  ).toBeTruthy();

  const beforeFirst = moveSketchHistoryCursor(session, { kind: "empty" });
  expect(
    getPreviousSketchHistoryCursor(beforeFirst),
    "Undo should be unavailable before the first sketch item.",
  ).toBe(null);
  expect(
    getNextSketchHistoryCursor(beforeFirst)?.kind === "item" &&
      getNextSketchHistoryCursor(beforeFirst)?.itemId === fullItems[0]?.id,
    "Redo should be available from the before-first sketch cursor position.",
  ).toBeTruthy();

  const inserted = addLine(rolledBack, [0, 2], [1, 2]);
  const insertedItems = getSketchHistoryItems(inserted.fullDefinition);
  expect(
    inserted.fullDefinition.entityIds.length,
    "Inserting after a rolled-back cursor should replace after-cursor sketch items.",
  ).toBe(2);
  expect(
    inserted.definition.entityIds.length,
    "Displayed sketch definition should include the inserted tail item.",
  ).toBe(2);
  expect(
    getSketchHistoryCursorIndex(insertedItems, inserted.historyCursor),
    "Sketch cursor should advance to the newly inserted item.",
  ).toBe(insertedItems.length - 1);

  const cursorRepair = deleteSketchHistoryOperation(session, fullItems[1]!.id);
  expect(
    cursorRepair.fullDefinition.authoringOperations?.length,
    "Deleting a history row should remove the targeted authored operation.",
  ).toBe(1);
  expect(
    cursorRepair.historyCursor.kind === "item" &&
      cursorRepair.historyCursor.itemId === fullItems[0]!.id,
    "Deleting the current history row should repair the cursor to the nearest surviving predecessor.",
  ).toBeTruthy();
  expect(
    cursorRepair.fullDefinition.authoringOperations?.every(
      (operation) => operation.kind !== "delete",
    ),
    "Deleting an authored row from history should not append a replacement delete operation.",
  ).toBeTruthy();

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
  expect(
    singleRowId,
    "Single-row history delete fixture should create one authored operation.",
  ).toBeTruthy();
  const emptied = deleteSketchHistoryOperation(singleRowWithLine, singleRowId);
  expect(
    emptied.historyCursor.kind,
    "Deleting the last history row should repair the cursor to the empty position.",
  ).toBe("empty");
  expect(
    emptied.definition.entityIds.length,
    "Deleting the final history row should clear the rebuilt sketch graph.",
  ).toBe(0);

  const deleteFixture = addLine(
    createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    }),
    [0, 0],
    [3, 0],
  );
  const deletedEntityId = deleteFixture.definition.entityIds[0];
  expect(
    deletedEntityId,
    "Delete-row fixture should expose one authored entity.",
  ).toBeTruthy();
  const withDeleteRow = deleteSelectedSketchGeometry(deleteFixture, [
    {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: deletedEntityId,
    },
  ]);
  const deleteRowId =
    withDeleteRow.fullDefinition.authoringOperations?.at(-1)?.operationId;
  expect(
    deleteRowId,
    "Live deletion should append a durable delete row before it can be removed from history.",
  ).toBeTruthy();
  const restored = deleteSketchHistoryOperation(withDeleteRow, deleteRowId);
  expect(
    restored.fullDefinition.authoringOperations?.every(
      (operation) => operation.kind !== "delete",
    ),
    "Deleting an existing delete row from history should remove that row instead of appending another delete row.",
  ).toBeTruthy();
  expect(
    restored.definition.entityIds.includes(deletedEntityId),
    "Deleting a delete row from history should restore the geometry it had removed.",
  ).toBeTruthy();
});
