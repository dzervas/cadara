import { useMemo } from "react";

import { createWorkbenchDocumentOwner } from "@/workbench/document/document-owner";
import { useEditorState } from "@/hooks/use-editor-state";
import { useModelingService } from "@/hooks/use-modeling-service";
import { useRuntimeExtensionRegistry } from "@/hooks/use-runtime-extension-registry";
import { getBrowserGeometryAssetComposition } from "@/infrastructure/modeling/browser-geometry-asset-store";

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
        geometryAssetStore: getBrowserGeometryAssetComposition().assetStore,
      }),
    [dispatch, machineState, modelingService, runtimeExtensionRegistries],
  );
}
