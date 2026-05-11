import { DurableHistoryContext } from "@/hooks/durable-history-context";
import { createRequiredContextHook } from "@/hooks/create-required-context-hook";

export const useDurableHistory = createRequiredContextHook(
  DurableHistoryContext,
  "useDurableHistory",
  "DurableHistoryProvider",
);
