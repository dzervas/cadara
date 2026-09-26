import {
  useLayoutEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
} from "react";

import type { WorkbenchCommandHandlers } from "@/hooks/workbench-command-context";
import { WorkbenchCommandContext } from "@/hooks/workbench-command-context";

interface WorkbenchCommandProviderProps extends PropsWithChildren {
  handlers: WorkbenchCommandHandlers;
}

/**
 * Provides a context value with a stable identity whose handlers always call
 * the latest committed `handlers`. The workbench recreates its handlers on
 * every editor render; forwarding through a ref keeps them fresh without
 * re-rendering every command consumer (toolbar buttons) on each state change.
 */
export function WorkbenchCommandProvider({
  children,
  handlers,
}: WorkbenchCommandProviderProps) {
  const handlersRef = useRef(handlers);

  useLayoutEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const value = useMemo<WorkbenchCommandHandlers>(
    () => ({
      activateTool: (toolId, metadata) =>
        handlersRef.current.activateTool(toolId, metadata),
      requestUndo: () => handlersRef.current.requestUndo(),
      requestRedo: () => handlersRef.current.requestRedo(),
      requestPartImport: () => handlersRef.current.requestPartImport(),
    }),
    [],
  );

  return (
    <WorkbenchCommandContext.Provider value={value}>
      {children}
    </WorkbenchCommandContext.Provider>
  );
}
