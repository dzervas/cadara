import type {
  BodyId,
  ConstructionId,
  ConstraintId,
  DimensionId,
  EdgeId,
  FaceId,
  FeatureId,
  LoopId,
  RegionId,
  SketchAuthoringOperationId,
  SketchEntityId,
  SketchId,
  SketchPointId,
  VertexId,
} from '@/contracts/shared/ids'

/**
 * Durable reference to a body owned by the modeling backend.
 */
export interface BodyRef {
  /** Stable discriminant for durable body references. */
  kind: 'body'
  /** Durable body identity owned by the modeling backend. */
  bodyId: BodyId
}

/**
 * Durable reference to a face. The face is owned by `bodyId`.
 */
export interface FaceRef {
  /** Stable discriminant for durable face references. */
  kind: 'face'
  /** Owning body of the referenced face. */
  bodyId: BodyId
  /** Durable face identity within `bodyId`. */
  faceId: FaceId
}

/**
 * Durable reference to an edge. The edge is owned by `bodyId`.
 */
export interface EdgeRef {
  /** Stable discriminant for durable edge references. */
  kind: 'edge'
  /** Owning body of the referenced edge. */
  bodyId: BodyId
  /** Durable edge identity within `bodyId`. */
  edgeId: EdgeId
}

/**
 * Durable reference to a vertex. The vertex is owned by `bodyId`.
 */
export interface VertexRef {
  /** Stable discriminant for durable vertex references. */
  kind: 'vertex'
  /** Owning body of the referenced vertex. */
  bodyId: BodyId
  /** Durable vertex identity within `bodyId`. */
  vertexId: VertexId
}

/**
 * Durable reference to a loop. The loop is owned by `bodyId`.
 */
export interface LoopRef {
  /** Stable discriminant for durable loop references. */
  kind: 'loop'
  /** Owning body of the referenced loop. */
  bodyId: BodyId
  /** Durable loop identity within `bodyId`. */
  loopId: LoopId
}

/**
 * Durable reference to an authored sketch.
 */
export interface SketchRef {
  /** Stable discriminant for durable sketch references. */
  kind: 'sketch'
  /** Durable sketch identity. */
  sketchId: SketchId
}

/**
 * Durable reference to a sketch entity.
 */
export interface SketchEntityRef {
  /** Stable discriminant for durable sketch-entity references. */
  kind: 'sketchEntity'
  /** Owning sketch of the referenced entity. */
  sketchId: SketchId
  /** Durable entity identity within `sketchId`. */
  entityId: SketchEntityId
}

/**
 * Durable reference to a sketch point.
 */
export interface SketchPointRef {
  /** Stable discriminant for durable sketch-point references. */
  kind: 'sketchPoint'
  /** Owning sketch of the referenced point. */
  sketchId: SketchId
  /** Durable point identity within `sketchId`. */
  pointId: SketchPointId
}

/**
 * Durable reference to an authored sketch constraint annotation.
 */
export interface SketchConstraintRef {
  /** Stable discriminant for durable sketch-constraint references. */
  kind: 'constraint'
  /** Owning sketch of the referenced constraint. */
  sketchId: SketchId
  /** Durable constraint identity within `sketchId`. */
  constraintId: ConstraintId
}

/**
 * Durable reference to an authored sketch dimension annotation.
 */
export interface SketchDimensionRef {
  /** Stable discriminant for durable sketch-dimension references. */
  kind: 'dimension'
  /** Owning sketch of the referenced dimension. */
  sketchId: SketchId
  /** Durable dimension identity within `sketchId`. */
  dimensionId: DimensionId
}

/**
 * Durable reference to a sketch authoring operation.
 */
export interface SketchOperationRef {
  /** Stable discriminant for durable sketch-operation references. */
  kind: 'sketchOperation'
  /** Owning sketch of the referenced operation. */
  sketchId: SketchId
  /** Durable operation identity within `sketchId`. */
  operationId: SketchAuthoringOperationId
}

/**
 * Durable reference to an authored feature.
 */
export interface FeatureRef {
  /** Stable discriminant for durable feature references. */
  kind: 'feature'
  /** Durable feature identity. */
  featureId: FeatureId
}

/**
 * Durable reference to authored construction geometry.
 */
export interface ConstructionRef {
  /** Stable discriminant for durable construction references. */
  kind: 'construction'
  /** Durable construction/reference-geometry identity. */
  constructionId: ConstructionId
}

/**
 * Solver- or kernel-derived region/profile reference.
 * The editor must never author these directly.
 */
export interface RegionRef {
  /** Stable discriminant for derived sketch-region references. */
  kind: 'region'
  /** Owning sketch from which the region was derived. */
  sketchId: SketchId
  /** Durable derived region identity within `sketchId`. */
  regionId: RegionId
}

/**
 * Canonical durable reference union shared by editor and modeling contracts.
 */
export type DurableRef =
  | BodyRef
  | FaceRef
  | EdgeRef
  | VertexRef
  | LoopRef
  | SketchRef
  | SketchEntityRef
  | SketchPointRef
  | SketchOperationRef
  | SketchConstraintRef
  | SketchDimensionRef
  | FeatureRef
  | ConstructionRef
  | RegionRef
