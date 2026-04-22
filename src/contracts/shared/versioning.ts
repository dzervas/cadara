/**
 * Top-level protocol version shared across the current modeling boundary.
 * This is echoed on requests and responses so callers can reject unsupported
 * protocol families before attempting to interpret payload fields.
 */
export type ContractVersion = 'modeling-contract/v1alpha1'

/**
 * Document snapshot payload schema version.
 * This version applies only to `DocumentSnapshot` payload structure.
 */
export type SnapshotSchemaVersion = 'document-snapshot/v1alpha1'

/**
 * Modeling operation-history payload schema version.
 * This version applies only to durable operation-log documents.
 */
export type OperationHistorySchemaVersion = 'modeling-operation-history/v1alpha1'

/**
 * Authored model document payload schema version.
 * This version applies only to the local-first persisted authored CAD state.
 */
export type AuthoredModelDocumentSchemaVersion = 'authored-model-document/v1alpha1'

/**
 * Versioned schema for immutable geometry asset manifest records.
 */
export type GeometryAssetSchemaVersion = 'geometry-asset/v1alpha1'

/**
 * Versioned schema for the authored document geometry asset manifest.
 */
export type GeometryAssetManifestSchemaVersion = 'geometry-asset-manifest/v1alpha1'

/**
 * Versioned schema for extrude feature definitions.
 */
export type ExtrudeFeatureSchemaVersion = 'feature-type/extrude/v1alpha1'

/**
 * Versioned schema for fillet feature definitions.
 */
export type FilletFeatureSchemaVersion = 'feature-type/fillet/v1alpha1'

/**
 * Versioned schema for plane feature definitions.
 */
export type PlaneFeatureSchemaVersion = 'feature-type/plane/v1alpha1'

/**
 * Versioned schema for revolve feature definitions.
 */
export type RevolveFeatureSchemaVersion = 'feature-type/revolve/v1alpha1'

/**
 * Versioned schema for shell feature definitions.
 */
export type ShellFeatureSchemaVersion = 'feature-type/shell/v1alpha1'

/**
 * Closed union of all feature-definition schema versions.
 */
export type FeatureTypeVersion =
  | ExtrudeFeatureSchemaVersion
  | FilletFeatureSchemaVersion
  | PlaneFeatureSchemaVersion
  | RevolveFeatureSchemaVersion
  | ShellFeatureSchemaVersion

/**
 * Legacy generic feature-definition schema version retained for transitional callers.
 */
export type LegacyFeatureTypeVersion = 'feature-type/v1alpha1'

/**
 * Render export payload schema version.
 * This version applies only to renderer-neutral render export payloads.
 */
export type RenderExportSchemaVersion = 'render-export/v1alpha1'

/**
 * Current protocol version literal.
 */
export const CONTRACT_VERSION: ContractVersion = 'modeling-contract/v1alpha1'

/**
 * Current document snapshot schema version literal.
 */
export const SNAPSHOT_SCHEMA_VERSION: SnapshotSchemaVersion = 'document-snapshot/v1alpha1'

/**
 * Current modeling operation-history schema version literal.
 */
export const OPERATION_HISTORY_SCHEMA_VERSION: OperationHistorySchemaVersion = 'modeling-operation-history/v1alpha1'

/**
 * Current authored model document schema version literal.
 */
export const AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION: AuthoredModelDocumentSchemaVersion = 'authored-model-document/v1alpha1'

/**
 * Current immutable geometry asset record schema version literal.
 */
export const GEOMETRY_ASSET_SCHEMA_VERSION: GeometryAssetSchemaVersion = 'geometry-asset/v1alpha1'

/**
 * Current authored geometry asset manifest schema version literal.
 */
export const GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION: GeometryAssetManifestSchemaVersion = 'geometry-asset-manifest/v1alpha1'

/**
 * Current extrude feature schema version literal.
 */
export const EXTRUDE_FEATURE_SCHEMA_VERSION: ExtrudeFeatureSchemaVersion = 'feature-type/extrude/v1alpha1'

/**
 * Current fillet feature schema version literal.
 */
export const FILLET_FEATURE_SCHEMA_VERSION: FilletFeatureSchemaVersion = 'feature-type/fillet/v1alpha1'

/**
 * Current plane feature schema version literal.
 */
export const PLANE_FEATURE_SCHEMA_VERSION: PlaneFeatureSchemaVersion = 'feature-type/plane/v1alpha1'

/**
 * Current revolve feature schema version literal.
 */
export const REVOLVE_FEATURE_SCHEMA_VERSION: RevolveFeatureSchemaVersion = 'feature-type/revolve/v1alpha1'

/**
 * Current shell feature schema version literal.
 */
export const SHELL_FEATURE_SCHEMA_VERSION: ShellFeatureSchemaVersion = 'feature-type/shell/v1alpha1'

/**
 * Legacy alias retained for older callers that still import one generic
 * feature-type constant. New code should use the per-feature constants above.
 */
export const FEATURE_TYPE_VERSION: LegacyFeatureTypeVersion = 'feature-type/v1alpha1'

/**
 * Current render export schema version literal.
 */
export const RENDER_EXPORT_SCHEMA_VERSION: RenderExportSchemaVersion = 'render-export/v1alpha1'
