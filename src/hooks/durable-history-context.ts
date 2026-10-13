import { createContext } from "react";

import type { DurableHistoryService } from "@/application/history/durable-history";

export const DurableHistoryContext =
  createContext<DurableHistoryService | null>(null);
