import { useMemo } from "react";
import type { PropsWithChildren } from "react";

import type { DurableHistoryService } from "@/application/workbench/durable-history";
import { DurableHistoryContext } from "@/hooks/durable-history-context";

interface DurableHistoryProviderProps extends PropsWithChildren {
  durableHistory: DurableHistoryService;
}

export function DurableHistoryProvider({
  durableHistory,
  children,
}: DurableHistoryProviderProps) {
  const value = useMemo(() => durableHistory, [durableHistory]);
  return (
    <DurableHistoryContext.Provider value={value}>
      {children}
    </DurableHistoryContext.Provider>
  );
}
