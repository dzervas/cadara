import type { tags } from "typia";

/**
 * SHA-256 content fingerprint for resolved import payloads and persisted bindings.
 */
export type ImportSourceFingerprint = string &
  tags.Pattern<"^sha256:[a-f0-9]{64}$">;

/**
 * Absolute URL accepted at import boundaries before transport-specific policy
 * invariants narrow the protocol set.
 */
export type ImportSourceUrl = string & tags.Format<"url">;

export interface LocalFileImportSource {
  kind: "localFile";
  fileName: string;
  pathHint?: string;
}

export interface UrlImportSource {
  kind: "url";
  url: ImportSourceUrl;
}

export interface CloudObjectImportSource {
  kind: "cloudObject";
  service: string;
  objectId: string;
  versionId?: string;
}

export type ImportSource =
  | LocalFileImportSource
  | UrlImportSource
  | CloudObjectImportSource;

/**
 * The orchestrator resolves transport before providers see the source.
 */
export interface ResolvedImportSource {
  /**
   * Human-readable source name providers can use for labels without re-parsing
   * transport-specific origin metadata.
   */
  name: string;
  origin: ImportSource;
  mediaType: string | null;
  bytes: Uint8Array;
  fingerprint: ImportSourceFingerprint;
}
