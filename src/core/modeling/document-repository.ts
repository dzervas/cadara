import type { DocumentRepository, GeometryAssetDocumentRepository, LocalFileSyncDocumentRepository } from "@/contracts/modeling/document-repository";

export function isGeometryAssetDocumentRepository(
  repository: DocumentRepository | null | undefined,
): repository is GeometryAssetDocumentRepository {
  return Boolean(repository && "getGeometryAssetBytes" in repository);
}

export function isLocalFileSyncDocumentRepository(
  repository: DocumentRepository | null | undefined,
): repository is LocalFileSyncDocumentRepository {
  return Boolean(repository && "bindLocalFile" in repository);
}
