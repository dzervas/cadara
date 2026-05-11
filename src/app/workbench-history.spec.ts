import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import { getDocumentHistoryOrderRestoreMoves } from "@/app/workbench/history/workbench-history";

test("src/app/workbench-history.spec.ts", () => {
  const a = { kind: "feature" as const, featureId: "feature_a" as const };
  const b = { kind: "feature" as const, featureId: "feature_b" as const };
  const c = { kind: "feature" as const, featureId: "feature_c" as const };
  const moves = getDocumentHistoryOrderRestoreMoves([a, b, c], [b, c, a]);

  expectTrue(
    moves?.length === 1,
    "Restoring a first-to-tail reorder should require one durable move.",
  );
  expectTrue(
    moves[0]?.item.kind === "feature" &&
      moves[0].item.featureId === "feature_a" &&
      moves[0].beforeItem === null,
    "Restoring a first-to-tail reorder should move the first item to the tail.",
  );

  const undoMoves = getDocumentHistoryOrderRestoreMoves([b, c, a], [a, b, c]);
  expectTrue(
    undoMoves?.length === 1,
    "Undoing a first-to-tail reorder should require one durable move.",
  );
  expectTrue(
    undoMoves[0]?.item.kind === "feature" &&
      undoMoves[0].item.featureId === "feature_a" &&
      undoMoves[0].beforeItem?.kind === "feature" &&
      undoMoves[0].beforeItem.featureId === "feature_b",
    "Undoing a first-to-tail reorder should move the tail item before the original head.",
  );

  expectTrue(
    getDocumentHistoryOrderRestoreMoves([a, b], [a, b, c]) === null,
    "Restore planning should reject orders with missing or extra history items.",
  );
});
