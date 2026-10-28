import type { LocalFileBindingMetadata } from "@/contracts/modeling/local-file-binding";
import type { LocalFileSystemFileHandle } from "@/contracts/modeling/local-file-system-access";
import type { DocumentId } from "@/contracts/shared/ids";

export function createLocalFileBindingMetadata(
  documentId: DocumentId,
  handle: Pick<LocalFileSystemFileHandle, "name">,
  now = new Date(),
): LocalFileBindingMetadata {
  return {
    documentId,
    fileName: handle.name,
    storedAt: now.toISOString(),
  };
}
