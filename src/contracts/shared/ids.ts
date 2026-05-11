/**
 * Durable document identifier owned by the modeling backend.
 * Stable across revisions for the lifetime of the document.
 */
export type DocumentId = `doc_${string}`;

/**
 * Durable document variable identifier owned by the modeling backend.
 */
export type DocumentVariableId = `variable_${string}`;

/**
 * Durable revision identifier owned by the modeling backend.
 * Changes whenever document state changes.
 */
export type RevisionId = `rev_${string}`;

/**
 * Durable authored feature identifier.
 */
export type FeatureId = `feature_${string}`;

/**
 * Durable immutable geometry asset identifier.
 */
export type GeometryAssetId = `asset_${string}`;

/**
 * Durable feature instance identifier for kernels that separate feature
 * definitions from instantiated occurrences.
 */
export type FeatureInstanceId = `feature_instance_${string}`;

/**
 * Durable sketch identifier.
 */
export type SketchId = `sketch_${string}`;

/**
 * Durable body identifier.
 */
export type BodyId = `body_${string}`;

/**
 * Durable face identifier.
 */
export type FaceId = `face_${string}`;

/**
 * Durable edge identifier.
 */
export type EdgeId = `edge_${string}`;

/**
 * Durable vertex identifier.
 */
export type VertexId = `vertex_${string}`;

/**
 * Durable loop identifier.
 */
export type LoopId = `loop_${string}`;

/**
 * Durable coedge identifier for kernels that expose oriented edge uses.
 */
export type CoedgeId = `coedge_${string}`;

/**
 * Durable sketch entity identifier.
 */
export type SketchEntityId = `sketch_entity_${string}`;

/**
 * Durable sketch point identifier.
 */
export type SketchPointId = `sketch_point_${string}`;

/**
 * Durable sketch style identifier.
 */
export type SketchStyleId = `sketch_style_${string}`;

/**
 * Durable sketch-local authoring operation identifier.
 */
export type SketchAuthoringOperationId = `sketch_operation_${string}`;

/**
 * Durable geometric constraint identifier.
 */
export type ConstraintId = `constraint_${string}`;

/**
 * Durable sketch dimension identifier.
 */
export type DimensionId = `dimension_${string}`;

/**
 * Durable solver- or kernel-derived region identifier.
 */
export type RegionId = `region_${string}`;

/**
 * Durable loop identifier scoped to one derived sketch region.
 */
export type RegionLoopId = `region_loop_${string}`;

/**
 * Durable resolved-reference identifier tracked by the modeling boundary.
 */
export type ReferenceId = `ref_${string}`;

/**
 * Durable projected-geometry identifier scoped to one external sketch reference.
 */
export type ProjectedGeometryId = `projected_geometry_${string}`;

/**
 * Transient preview identifier owned by a preview/evaluation workflow.
 */
export type PreviewId = `preview_${string}`;

/**
 * Correlation identifier for async effect requests.
 */
export type RequestId = `request_${string}`;

/**
 * Correlation identifier for editor command sessions.
 */
export type CommandSessionId = `command_${string}`;

/**
 * Durable construction/reference geometry identifier.
 */
export type ConstructionId = `construction_${string}`;

/**
 * Presentational tree node identifier used only for feature-tree view models.
 * This key is not a durable modeling reference.
 */
export type FeatureTreeNodeId = `feature_tree_node_${string}`;

/**
 * Presentational tree node identifier used only for object-tree view models.
 * This key is not a durable modeling reference.
 */
export type ObjectTreeNodeId = `object_tree_node_${string}`;

/**
 * Presentational document-history item identifier used only for timeline view models.
 * This key is not a durable modeling reference.
 */
export type DocumentHistoryItemId = `document_history_item_${string}`;

/**
 * Presentational snapshot entity key used for sidebar/detail view models.
 * This key is not a durable modeling reference.
 */
export type SnapshotEntityId = `snapshot_entity_${string}`;

/**
 * Transient render export identifier used to correlate renderable payloads.
 * This key is not a durable modeling reference.
 */
export type RenderableId = `renderable_${string}`;

/**
 * Transient pick-binding identifier used by viewport selection/render export.
 */
export type PickId = `pick_${string}`;
