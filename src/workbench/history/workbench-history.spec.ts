import { test, expect } from "vitest";

import { getDocumentHistoryOrderRestoreMoves } from "@/workbench/history/workbench-history";

test("src/workbench/history/workbench-history.spec.ts", () => {
  const a = { kind: "feature" as const, featureId: "feature_a" as const };
  const b = { kind: "feature" as const, featureId: "feature_b" as const };
  const c = { kind: "feature" as const, featureId: "feature_c" as const };
  const moves = getDocumentHistoryOrderRestoreMoves([a, b, c], [b, c, a]);

  expect(
    moves?.length,
    "Restoring a first-to-tail reorder should require one durable move.",
  ).toBe(1);
  expect(
    moves[0]?.item.kind === "feature" &&
      moves[0].item.featureId === "feature_a" &&
      moves[0].beforeItem === null,
    "Restoring a first-to-tail reorder should move the first item to the tail.",
  ).toBeTruthy();

  const undoMoves = getDocumentHistoryOrderRestoreMoves([b, c, a], [a, b, c]);
  expect(
    undoMoves?.length,
    "Undoing a first-to-tail reorder should require one durable move.",
  ).toBe(1);
  expect(
    undoMoves[0]?.item.kind === "feature" &&
      undoMoves[0].item.featureId === "feature_a" &&
      undoMoves[0].beforeItem?.kind === "feature" &&
      undoMoves[0].beforeItem.featureId === "feature_b",
    "Undoing a first-to-tail reorder should move the tail item before the original head.",
  ).toBeTruthy();

  expect(
    getDocumentHistoryOrderRestoreMoves([a, b], [a, b, c]),
    "Restore planning should reject orders with missing or extra history items.",
  ).toBe(null);
});
