import type { ImportSourceFingerprint } from "@/contracts/import/source";
import type { ImportContractSchemaVersion } from "@/contracts/shared/versioning";

/**
 * Intentional v1 minimum. Additional policies such as auto-refresh can extend
 * this union without reshaping the persisted binding contract.
 */
export type ImportRefreshPolicy = "manual";

interface ImportBindingBase {
  schemaVersion: ImportContractSchemaVersion;
  fingerprint: ImportSourceFingerprint;
  refreshPolicy: ImportRefreshPolicy;
}

/**
 * Stored on entity provenance, not in a separate manifest.
 */
export interface LocalFileImportBinding extends ImportBindingBase {
  kind: "localFile";
  fileName: string;
  pathHint?: string;
}

/**
 * Stored on entity provenance, not in a separate manifest.
 */
export interface UrlImportBinding extends ImportBindingBase {
  kind: "url";
  url: string;
}

/**
 * Stored on entity provenance, not in a separate manifest.
 */
export interface CloudObjectImportBinding extends ImportBindingBase {
  kind: "cloudObject";
  service: string;
  objectId: string;
  versionId?: string;
}

export type ImportBinding =
  | LocalFileImportBinding
  | UrlImportBinding
  | CloudObjectImportBinding;
