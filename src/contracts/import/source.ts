/**
 * SHA-256 content fingerprint for resolved import payloads and persisted bindings.
 */
export type ImportSourceFingerprint = `sha256:${string}`

export interface LocalFileImportSource {
  kind: 'localFile'
  fileName: string
  pathHint?: string
}

export interface UrlImportSource {
  kind: 'url'
  url: string
}

export interface CloudObjectImportSource {
  kind: 'cloudObject'
  service: string
  objectId: string
  versionId?: string
}

export type ImportSource =
  | LocalFileImportSource
  | UrlImportSource
  | CloudObjectImportSource

/**
 * The orchestrator resolves transport before providers see the source.
 */
export interface ResolvedImportSource {
  /**
   * Human-readable source name providers can use for labels without re-parsing
   * transport-specific origin metadata.
   */
  name: string
  origin: ImportSource
  mediaType: string | null
  bytes: Uint8Array
  fingerprint: ImportSourceFingerprint
}
