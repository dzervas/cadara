import { useMemo } from "react";

import { createWorkbenchDocumentOwner } from "@/application/workbench/document-owner";
import { useEditorState } from "@/hooks/use-editor-state";
import { useModelingService } from "@/hooks/use-modeling-service";
import { useRuntimeExtensionRegistry } from "@/hooks/use-runtime-extension-registry";

export function useWorkbenchDocumentOwner() {
  const { machineState, dispatch } = useEditorState();
  const modelingService = useModelingService();
  const runtimeExtensionRegistries = useRuntimeExtensionRegistry();

  return useMemo(
    () =>
      createWorkbenchDocumentOwner({
        machineState,
        dispatch,
        modelingService,
        runtimeExtensionRegistries,
      }),
    [dispatch, machineState, modelingService, runtimeExtensionRegistries],
  );
}
