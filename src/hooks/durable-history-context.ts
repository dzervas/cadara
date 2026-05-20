import { createContext } from "react";

import type { DurableHistoryService } from "@/workbench/history/durable-history";

export const DurableHistoryContext =
  createContext<DurableHistoryService | null>(null);
