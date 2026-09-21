import { expect, test } from "vitest";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchGeometry,
  getSketchHistoryItems,
  startSketchDraw,
} from "./sketch-session";

test("sketch contents reflect current authored records rather than a replay cursor", () => {
  let session = createNewSketchSessionFromSupport({
    kind: "construction",
    constructionId: "construction_plane-xy",
  });
  for (const y of [0, 1])
    session = acceptSketchDraw(
      startSketchDraw(beginSketchTool(session, "line"), [0, y]),
      [1, y],
    );
  expect(
    getSketchHistoryItems(session.definition).filter(
      (item) => item.kind === "entity",
    ),
  ).toHaveLength(2);
  const first = session.definition.entities[0]!;
  const deleted = deleteSelectedSketchGeometry(session, [first.target]);
  expect(
    getSketchHistoryItems(deleted.definition).some(
      (item) => item.id === first.entityId,
    ),
  ).toBe(false);
  expect(
    getSketchHistoryItems(deleted.definition).filter(
      (item) => item.kind === "entity",
    ),
  ).toHaveLength(1);
  expect(session.definition.entities).toHaveLength(2);
  expect(deleted).not.toHaveProperty("historyOperations");
  expect(deleted).not.toHaveProperty("historyCursor");
  expect(deleted).not.toHaveProperty("fullDefinition");
});
