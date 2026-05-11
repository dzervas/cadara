import type {
  DocumentVariableId,
  FeatureId,
  GeometryAssetId,
  SketchId,
} from "@/contracts/shared/ids";

export type ImportBindingEntityId =
  | FeatureId
  | SketchId
  | DocumentVariableId
  | GeometryAssetId;

/**
 * Workspace-level store for browser-local capabilities. This lives outside the
 * document JSON, consistent with local-file-system-document-sync.
 */
export interface ImportBindingStore {
  getLocalFileHandle(
    entityId: ImportBindingEntityId,
  ): Promise<FileSystemFileHandle | null>;
  setLocalFileHandle(
    entityId: ImportBindingEntityId,
    handle: FileSystemFileHandle,
  ): Promise<void>;
  clearLocalFileHandle(entityId: ImportBindingEntityId): Promise<void>;
}
