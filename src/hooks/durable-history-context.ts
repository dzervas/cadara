import { createContext } from "react";

import type { DurableHistoryService } from "@/application/workbench/durable-history";

export const DurableHistoryContext =
  createContext<DurableHistoryService | null>(null);
