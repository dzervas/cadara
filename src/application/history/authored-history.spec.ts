import { expect, test, vi } from "vitest";
import { createAuthoredHistoryOperation } from "./authored-history";

test("an empty private sketch history never compensates the shared document", async () => {
  const undo = vi.fn();
  const handoff = vi.fn();
  const privateHistory = vi.fn(async () => {});
  const operation = createAuthoredHistoryOperation({
    documentHistory: { undo, redo: vi.fn(), getAvailability: vi.fn() },
    getContext: () => ({ kind: "sketch" }),
    privateHistory,
    handoff,
  });
  expect(
    await operation.execute({ direction: "undo", commandId: "undo-empty" }),
  ).toEqual({ context: "sketch" });
  expect(privateHistory).toHaveBeenCalledWith({
    direction: "undo",
    commandId: "undo-empty",
  });
  expect(undo).not.toHaveBeenCalled();
  expect(handoff).not.toHaveBeenCalled();
});
