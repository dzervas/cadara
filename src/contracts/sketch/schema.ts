import type {
  ConstraintId,
  DimensionId,
  ProjectedGeometryId,
  RegionId,
  RegionLoopId,
  ReferenceId,
  SketchEntityId,
  SketchId,
  SketchPointId,
  SketchStyleId,
} from '@/contracts/shared/ids'
import type { OwnershipRecord } from '@/contracts/shared/diagnostics'
import type {
  ConstructionRef,
  EdgeRef,
  FaceRef,
  RegionRef,
  SketchEntityRef,
  SketchPointRef,
  SketchRef,
  VertexRef,
} from '@/contracts/shared/references'
import type { SketchPlaneSupportRef } from '@/contracts/shared/sketch-plane'

/**
 * Declarative sketch-space point coordinates expressed in sketch plane units.
 * The sketch definition owns this tuple; callers must not infer world-space axes.
 */
export type SketchPoint2D = readonly [number, number]

/**
 * Versioned schema identifier for authored sketch payloads.
 */
export type SketchSchemaVersion = 'sketch-definition/v1alpha1'

/**
 * Versioned schema identifier for solved sketch payloads.
 */
export type SolvedSketchSchemaVersion = 'solved-sketch/v1alpha1'

/**
 * Current authored sketch schema version literal.
 */
export const SKETCH_SCHEMA_VERSION: SketchSchemaVersion = 'sketch-definition/v1alpha1'

/**
 * Current solved sketch schema version literal.
 */
export const SOLVED_SKETCH_SCHEMA_VERSION: SolvedSketchSchemaVersion = 'solved-sketch/v1alpha1'

export type SketchFillMode = 'none' | 'solid' | 'gradient'
export type SketchStrokeCap = 'butt' | 'round' | 'square'
export type SketchStrokeJoin = 'miter' | 'round' | 'bevel'

export interface SketchStyleDefinition {
  fillMode?: SketchFillMode
  fillColor?: string
  gradientStartColor?: string
  gradientEndColor?: string
  strokeEnabled?: boolean
  strokeColor?: string
  strokeWidth?: number
  strokeCap?: SketchStrokeCap
  strokeJoin?: SketchStrokeJoin
  strokeMiterLimit?: number
  strokeDashSize?: number
  strokeGapSize?: number
}

/**
 * Durable authored sketch point definition.
 * The point record is part of the authored sketch graph and can be referenced by
 * entity endpoints, constraints, and dimensions.
 */
export interface SketchPointDefinition {
  /** Durable authored point identity within the containing sketch definition. */
  pointId: SketchPointId
  /** Human-readable label owned by the producer of the sketch definition. */
  label: string
  /** Durable target that must resolve to the same sketch as the containing record. */
  target: SketchPointRef
  /** Authored point coordinates in sketch-plane units relative to the parent sketch plane frame. */
  position: SketchPoint2D
  /** True when the point is construction-only and should not participate in profile/region extraction. */
  isConstruction: boolean
  /** Optional local style authored directly in the sketch session. */
  style?: SketchStyleDefinition
}

/**
 * Durable authored sketch entity definition.
 * The entity graph is authored input to the solver, not a solved/exported result.
 */
export type SketchEntityDefinition =
  | {
      kind: 'lineSegment'
      /** Durable authored entity identity within the containing sketch definition. */
      entityId: SketchEntityId
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Durable target that must resolve to the same sketch as the containing record. */
      target: SketchEntityRef
      /** True when the curve is construction-only and should not generate derived regions. */
      isConstruction: boolean
      /** Start endpoint reference. Must exist in `SketchDefinition.pointIds`. */
      startPointId: SketchPointId
      /** End endpoint reference. Must exist in `SketchDefinition.pointIds`. */
      endPointId: SketchPointId
      /** Optional local style authored directly in the sketch session. */
      style?: SketchStyleDefinition
    }
  | {
      kind: 'point'
      /** Durable authored entity identity within the containing sketch definition. */
      entityId: SketchEntityId
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Durable target that must resolve to the same sketch as the containing record. */
      target: SketchEntityRef
      /** True when the point is construction-only and should not generate derived regions. */
      isConstruction: boolean
      /** Referenced point record represented by this point entity. */
      pointId: SketchPointId
      /** Optional local style authored directly in the sketch session. */
      style?: SketchStyleDefinition
    }
  | {
      kind: 'circle'
      /** Durable authored entity identity within the containing sketch definition. */
      entityId: SketchEntityId
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Durable target that must resolve to the same sketch as the containing record. */
      target: SketchEntityRef
      /** True when the curve is construction-only and should not generate derived regions. */
      isConstruction: boolean
      /** Center-point reference. Must exist in `SketchDefinition.pointIds`. */
      centerPointId: SketchPointId
      /** Authored radius in sketch-plane units. Must be greater than zero. */
      radius: number
      /** Optional local style authored directly in the sketch session. */
      style?: SketchStyleDefinition
    }
  | {
      kind: 'arc'
      /** Durable authored entity identity within the containing sketch definition. */
      entityId: SketchEntityId
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Durable target that must resolve to the same sketch as the containing record. */
      target: SketchEntityRef
      /** True when the curve is construction-only and should not generate derived regions. */
      isConstruction: boolean
      /** Arc center-point reference. Must exist in `SketchDefinition.pointIds`. */
      centerPointId: SketchPointId
      /** Arc start-point reference. Must exist in `SketchDefinition.pointIds`. */
      startPointId: SketchPointId
      /** Arc end-point reference. Must exist in `SketchDefinition.pointIds`. */
      endPointId: SketchPointId
      /** Sweep direction from start to end around `centerPointId`. */
      sweepDirection: 'clockwise' | 'counterClockwise'
      /** Optional local style authored directly in the sketch session. */
      style?: SketchStyleDefinition
    }
  | {
      kind: 'spline'
      /** Durable authored entity identity within the containing sketch definition. */
      entityId: SketchEntityId
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Durable target that must resolve to the same sketch as the containing record. */
      target: SketchEntityRef
      /** True when the curve is construction-only and should not generate derived regions. */
      isConstruction: boolean
      /** Fit/control points defining this first-version spline curve. */
      fitPointIds: readonly SketchPointId[]
      /** Polynomial degree for this explicit spline representation. */
      degree: 2 | 3
      /** Optional local style authored directly in the sketch session. */
      style?: SketchStyleDefinition
    }
  | {
      kind: 'ellipse'
      /** Durable authored entity identity within the containing sketch definition. */
      entityId: SketchEntityId
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Durable target that must resolve to the same sketch as the containing record. */
      target: SketchEntityRef
      /** True when the curve is construction-only and should not generate derived regions. */
      isConstruction: boolean
      /** Ellipse center-point reference. Must exist in `SketchDefinition.pointIds`. */
      centerPointId: SketchPointId
      /** Endpoint of the major-axis radius vector. Must exist in `SketchDefinition.pointIds`. */
      majorAxisPointId: SketchPointId
      /** Authored minor radius in sketch-plane units. Must be greater than zero. */
      minorRadius: number
      /** Optional local style authored directly in the sketch session. */
      style?: SketchStyleDefinition
    }
  | {
      kind: 'ellipticalArc'
      /** Durable authored entity identity within the containing sketch definition. */
      entityId: SketchEntityId
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Durable target that must resolve to the same sketch as the containing record. */
      target: SketchEntityRef
      /** True when the curve is construction-only and should not generate derived regions. */
      isConstruction: boolean
      /** Ellipse center-point reference. Must exist in `SketchDefinition.pointIds`. */
      centerPointId: SketchPointId
      /** Endpoint of the major-axis radius vector. Must exist in `SketchDefinition.pointIds`. */
      majorAxisPointId: SketchPointId
      /** Arc start-point reference. Must exist in `SketchDefinition.pointIds`. */
      startPointId: SketchPointId
      /** Arc end-point reference. Must exist in `SketchDefinition.pointIds`. */
      endPointId: SketchPointId
      /** Authored minor radius in sketch-plane units. Must be greater than zero. */
      minorRadius: number
      /** Sweep direction from start to end around `centerPointId`. */
      sweepDirection: 'clockwise' | 'counterClockwise'
      /** Optional local style authored directly in the sketch session. */
      style?: SketchStyleDefinition
    }
  | {
      kind: 'conic'
      /** Durable authored entity identity within the containing sketch definition. */
      entityId: SketchEntityId
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Durable target that must resolve to the same sketch as the containing record. */
      target: SketchEntityRef
      /** True when the curve is construction-only and should not generate derived regions. */
      isConstruction: boolean
      /** Conic start-point reference. Must exist in `SketchDefinition.pointIds`. */
      startPointId: SketchPointId
      /** Conic control-point reference. Must exist in `SketchDefinition.pointIds`. */
      controlPointId: SketchPointId
      /** Conic end-point reference. Must exist in `SketchDefinition.pointIds`. */
      endPointId: SketchPointId
      /** Positive conic weight/rho preserving the authored conic family. */
      rho: number
      /** Optional local style authored directly in the sketch session. */
      style?: SketchStyleDefinition
    }
  | {
      kind: 'bezierCurve'
      /** Durable authored entity identity within the containing sketch definition. */
      entityId: SketchEntityId
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Durable target that must resolve to the same sketch as the containing record. */
      target: SketchEntityRef
      /** True when the curve is construction-only and should not generate derived regions. */
      isConstruction: boolean
      /** Ordered Bezier control points. Quadratic curves use 3 points; cubic curves use 4. */
      controlPointIds: readonly SketchPointId[]
      /** Polynomial degree for this Bezier representation. */
      degree: 2 | 3
      /** Optional local style authored directly in the sketch session. */
      style?: SketchStyleDefinition
    }
  | {
      kind: 'profileText'
      /** Durable authored entity identity within the containing sketch definition. */
      entityId: SketchEntityId
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Durable target that must resolve to the same sketch as the containing record. */
      target: SketchEntityRef
      /** True when the text is construction-only and should not generate derived regions. */
      isConstruction: boolean
      /** Text baseline anchor. Must exist in `SketchDefinition.pointIds`. */
      anchorPointId: SketchPointId
      /** Authored text content. Must contain at least one non-whitespace character. */
      text: string
      /** Text cap-height in sketch-plane units. Must be greater than zero. */
      height: number
      /** Baseline rotation in sketch-plane radians. */
      rotationRadians: number
      /** Horizontal placement of the generated outline relative to `anchorPointId`. */
      horizontalAlign: 'left' | 'center' | 'right'
      /** Vertical placement of the generated outline relative to `anchorPointId`. */
      verticalAlign: 'baseline' | 'middle' | 'top' | 'bottom'
      /** Optional local style authored directly in the sketch session. */
      style?: SketchStyleDefinition
    }

export type LocalSketchPointConstraintOperand = {
  kind: 'localPoint'
  pointId: SketchPointId
}

export type LocalSketchEntityConstraintOperand = {
  kind: 'localEntity'
  entityId: SketchEntityId
}

export type ProjectedSketchGeometryConstraintOperand = {
  kind: 'projectedGeometry'
  reference: ProjectedSketchGeometryRef & {
    kind: NonNullable<ProjectedSketchGeometryRef['kind']>
  }
}

export type SketchPointConstraintOperand =
  | LocalSketchPointConstraintOperand
  | ProjectedSketchGeometryConstraintOperand

export type SketchCurveConstraintOperand =
  | LocalSketchEntityConstraintOperand
  | ProjectedSketchGeometryConstraintOperand

/**
 * Authorable fill payload for sketch styles.
 */
export type SketchStyleFill =
  | { kind: 'none' }
  | {
      kind: 'solid'
      color: string
      opacity: number
    }
  | {
      kind: 'gradient'
      gradient: {
        kind: 'linear'
        angleRadians: number
        startColor: string
        startOpacity: number
        endColor: string
        endOpacity: number
      }
    }

/**
 * Authorable stroke payload for sketch styles.
 */
export interface SketchStyleStroke {
  color: string
  opacity: number
  width: number
  lineCap: 'butt' | 'round' | 'square'
  lineJoin: 'miter' | 'round' | 'bevel'
  miterLimit: number
  dashSize?: number
  gapSize?: number
}

/**
 * Durable authored style record scoped to sketch-local entities and optional derived regions.
 */
export interface SketchStyleRecord {
  /** Durable authored style identity within the containing sketch definition. */
  styleId: SketchStyleId
  /** Human-readable label owned by the producer of the sketch definition. */
  label: string
  /** Stable style target in the containing sketch payload. */
  target:
    | { kind: 'entity'; entityId: SketchEntityId }
    | { kind: 'region'; regionId: RegionId }
  /** Authored fill model for the style target. */
  fill: SketchStyleFill
  /** Authored stroke model for the style target. */
  stroke: SketchStyleStroke
}

/**
 * Durable authored geometric constraint definition.
 * The editor may author these; the solver owns their satisfaction status.
 */
export type ConstraintDefinition =
  | {
      constraintId: ConstraintId
      kind: 'coincident'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Two distinct point references that the solver must force to the same solved position. */
      pointIds: readonly [SketchPointId, SketchPointId]
    }
  | {
      constraintId: ConstraintId
      kind: 'horizontal'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Constrained line entity. Must exist in `SketchDefinition.entityIds`. */
      entityId: SketchEntityId
    }
  | {
      constraintId: ConstraintId
      kind: 'coincidentProjectedPoint'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Local editable point participating in the coincident relationship. */
      point: LocalSketchPointConstraintOperand
      /** Read-only projected point target. */
      projectedPoint: ProjectedSketchGeometryConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'pointOnProjectedCurve'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Local editable point constrained onto the projected curve. */
      point: LocalSketchPointConstraintOperand
      /** Read-only projected line, circle, or arc target. */
      projectedCurve: ProjectedSketchGeometryConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'midpoint'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Local editable point constrained to the midpoint. */
      point: LocalSketchPointConstraintOperand
      /** Local editable line whose solved midpoint is targeted. */
      line: LocalSketchEntityConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'midpointProjectedLine'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Local editable point constrained to the projected midpoint. */
      point: LocalSketchPointConstraintOperand
      /** Read-only projected line whose derived midpoint is targeted. */
      projectedLine: ProjectedSketchGeometryConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'pointOnCurve'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Local editable point constrained onto the local curve. */
      point: LocalSketchPointConstraintOperand
      /** Local editable line, circle, or arc target. */
      curve: LocalSketchEntityConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'parallelProjectedLine'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Local editable line entity. */
      line: LocalSketchEntityConstraintOperand
      /** Read-only projected line target. */
      projectedLine: ProjectedSketchGeometryConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'perpendicularProjectedLine'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Local editable line entity. */
      line: LocalSketchEntityConstraintOperand
      /** Read-only projected line target. */
      projectedLine: ProjectedSketchGeometryConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'tangentProjectedCurve'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Local editable curve entity. */
      curve: LocalSketchEntityConstraintOperand
      /** Read-only projected circle or arc target. */
      projectedCurve: ProjectedSketchGeometryConstraintOperand
      /** Tangency side for closed-curve relationships. */
      relation: 'external' | 'internal'
    }
  | {
      constraintId: ConstraintId
      kind: 'tangent'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Two local editable curve entities that must solve tangent. */
      entityIds: readonly [SketchEntityId, SketchEntityId]
      /** Tangency side for closed-curve relationships. */
      relation: 'external' | 'internal'
    }
  | {
      constraintId: ConstraintId
      kind: 'concentric'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Two local editable circle or arc entities whose centers must coincide. */
      entityIds: readonly [SketchEntityId, SketchEntityId]
    }
  | {
      constraintId: ConstraintId
      kind: 'concentricProjectedCurve'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Local editable circle or arc entity. */
      curve: LocalSketchEntityConstraintOperand
      /** Read-only projected circle or arc target. */
      projectedCurve: ProjectedSketchGeometryConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'normal'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Local editable line entity. */
      line: LocalSketchEntityConstraintOperand
      /** Local editable circle or arc target. */
      curve: LocalSketchEntityConstraintOperand
      /** Local editable contact point constrained onto the curve. */
      point: LocalSketchPointConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'normalProjectedCurve'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Local editable line entity. */
      line: LocalSketchEntityConstraintOperand
      /** Read-only projected circle or arc target. */
      projectedCurve: ProjectedSketchGeometryConstraintOperand
      /** Local editable contact point constrained onto the projected curve. */
      point: LocalSketchPointConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'symmetric'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Two local editable points mirrored about the axis. */
      pointIds: readonly [SketchPointId, SketchPointId]
      /** Local editable line used as the symmetry axis. */
      axis: LocalSketchEntityConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'symmetricProjectedLine'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Two local editable points mirrored about the projected axis. */
      pointIds: readonly [SketchPointId, SketchPointId]
      /** Read-only projected line used as the symmetry axis. */
      projectedLine: ProjectedSketchGeometryConstraintOperand
    }
  | {
      constraintId: ConstraintId
      kind: 'fixPoint'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Constrained point. Must exist in `SketchDefinition.pointIds`. */
      pointId: SketchPointId
      /** Requested solved position in sketch-plane units. */
      position: SketchPoint2D
    }
  | {
      constraintId: ConstraintId
      kind: 'angle'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Ordered point references `[point1, point2, middlePoint]`. */
      pointIds: readonly [SketchPointId, SketchPointId, SketchPointId]
      /** Requested enclosed angle in radians. */
      valueRadians: number
    }
  | {
      constraintId: ConstraintId
      kind: 'parallel'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Two line entities that must solve parallel. */
      entityIds: readonly [SketchEntityId, SketchEntityId]
    }
  | {
      constraintId: ConstraintId
      kind: 'perpendicular'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Two line entities that must solve perpendicular. */
      entityIds: readonly [SketchEntityId, SketchEntityId]
    }
  | {
      constraintId: ConstraintId
      kind: 'equalLength'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Two line entities whose solved lengths must match. */
      entityIds: readonly [SketchEntityId, SketchEntityId]
    }
  | {
      constraintId: ConstraintId
      kind: 'vertical'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Constrained line entity. Must exist in `SketchDefinition.entityIds`. */
      entityId: SketchEntityId
    }

/**
 * Durable authored dimension definition.
 * Dimensions are solver-facing authored inputs and must not be inferred from UI state.
 */
export type DimensionDefinition =
  | {
      dimensionId: DimensionId
      kind: 'distance'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Axis interpretation for `value` within the sketch-plane frame. */
      axis: 'aligned' | 'horizontal' | 'vertical'
      /** Two referenced points whose solved separation must match `value`. */
      pointIds: readonly [SketchPointId, SketchPointId]
      /** Requested dimension value in sketch-plane units. */
      value: number
    }
  | {
      dimensionId: DimensionId
      kind: 'circleRadius'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Referenced circle entity whose solved radius must match `value`. */
      entityId: SketchEntityId
      /** Requested radius value in sketch-plane units. */
      value: number
    }
  | {
      dimensionId: DimensionId
      kind: 'horizontalDistance'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Two referenced points whose solved horizontal separation must match `value`. */
      pointIds: readonly [SketchPointId, SketchPointId]
      /** Requested signed horizontal distance in sketch-plane units. */
      value: number
    }
  | {
      dimensionId: DimensionId
      kind: 'verticalDistance'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Two referenced points whose solved vertical separation must match `value`. */
      pointIds: readonly [SketchPointId, SketchPointId]
      /** Requested signed vertical distance in sketch-plane units. */
      value: number
    }
  | {
      dimensionId: DimensionId
      kind: 'arcStartPointCoincident'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Referenced arc entity. */
      entityId: SketchEntityId
      /** Referenced authored point that must coincide with the solved arc start point. */
      pointId: SketchPointId
    }
  | {
      dimensionId: DimensionId
      kind: 'arcEndPointCoincident'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** Referenced arc entity. */
      entityId: SketchEntityId
      /** Referenced authored point that must coincide with the solved arc end point. */
      pointId: SketchPointId
    }

/**
 * Durable authored external sketch reference definition.
 * These records describe solver inputs that originate outside the local sketch graph.
 */
export type SketchReferenceDefinition =
  | {
      /** Durable authored reference identity within the containing sketch definition. */
      referenceId: ReferenceId
      kind: 'constructionPlane'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** External construction plane driving the sketch reference frame or derived projections. */
      source: ConstructionRef
      /** Declared projection mode into sketch-space coordinates. */
      projectionMode: 'coplanar'
    }
  | {
      /** Durable authored reference identity within the containing sketch definition. */
      referenceId: ReferenceId
      kind: 'modelReference'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** External model reference projected into sketch space for solving. */
      source: FaceRef | EdgeRef | VertexRef
      /** Declared projection mode into sketch-space coordinates. */
      projectionMode: 'projectAlongPlaneNormal' | 'useExistingCoplanarGeometry'
    }
  | {
      /** Durable authored reference identity within the containing sketch definition. */
      referenceId: ReferenceId
      kind: 'sketchReference'
      /** Human-readable label owned by the producer of the sketch definition. */
      label: string
      /** External sketch-owned geometry projected into this sketch space. */
      source: SketchEntityRef | SketchPointRef | SketchRef
      /** Declared projection mode into sketch-space coordinates. */
      projectionMode: 'useExistingCoplanarGeometry'
    }

/**
 * Durable authored sketch graph submitted to the solver/kernel boundary.
 * Regions are deliberately absent because the editor must not author them.
 */
export interface SketchDefinition {
  /** Schema version for the authored sketch definition payload. */
  schemaVersion: SketchSchemaVersion
  /** Canonical authored external-reference order. Each ID must be unique and appear exactly once in `references`. */
  referenceIds: ReferenceId[]
  /** Authored external references consumed by the solver alongside the local sketch graph. */
  references: SketchReferenceDefinition[]
  /** Canonical authored point order. Each ID must be unique and appear exactly once in `points`. */
  pointIds: SketchPointId[]
  /** Authored sketch points owned by the containing sketch definition. */
  points: SketchPointDefinition[]
  /** Canonical authored entity order. Each ID must be unique and appear exactly once in `entities`. */
  entityIds: SketchEntityId[]
  /** Authored sketch entities owned by the containing sketch definition. */
  entities: SketchEntityDefinition[]
  /** Canonical authored constraint order. Each ID must be unique and appear exactly once in `constraints`. */
  constraintIds: ConstraintId[]
  /** Authored geometric constraints owned by the containing sketch definition. */
  constraints: ConstraintDefinition[]
  /** Canonical authored dimension order. Each ID must be unique and appear exactly once in `dimensions`. */
  dimensionIds: DimensionId[]
  /** Authored dimensions owned by the containing sketch definition. */
  dimensions: DimensionDefinition[]
  /** Canonical authored style order. Each ID must be unique and appear exactly once in `styles`. */
  styleIds?: SketchStyleId[]
  /** Authored visual styles scoped to sketch entities and optional derived regions. */
  styles?: SketchStyleRecord[]
}

/**
 * Explicit authored-graph invariants that every producer must satisfy.
 * These rules exist here so solver/kernel implementers do not need to infer
 * hidden editor assumptions from tests or runtime code.
 */
export const SKETCH_DEFINITION_INVARIANTS = {
  /** Every ordered ID array must be unique and bijective with its record array. */
  orderedIdsAreBijective: true,
  /** All point/entity targets must resolve to the containing `sketchId`. */
  localTargetsMustMatchOwningSketch: true,
  /** Every referenced point/entity/constraint/dimension ID must exist exactly once. */
  graphReferencesMustResolve: true,
  /** Construction-only geometry must not contribute to derived profile regions. */
  constructionGeometryExcludedFromRegions: true,
  /** Derived regions are solver/kernel outputs only and never authored input. */
  regionsAreDerivedOnly: true,
} as const

/**
 * Solver-owned solved point position for an authored sketch point.
 */
export interface SolvedSketchPointRecord {
  /** Authored point identity being reported in solved space. */
  pointId: SketchPointId
  /** Durable point target owned by the same sketch as the containing solved snapshot. */
  target: SketchPointRef
  /** Solver-computed point coordinates in sketch-plane units. */
  solvedPosition: SketchPoint2D
}

/**
 * Solver-owned solve validity for one sketch evaluation.
 */
export type SolvedSketchSolveState = 'notEvaluated' | 'solved' | 'partiallySolved' | 'failed'

/**
 * Solver-owned constrainedness classification for one sketch evaluation.
 */
export type SolvedSketchConstraintState =
  | 'unknown'
  | 'underConstrained'
  | 'wellConstrained'
  | 'overConstrained'
  | 'inconsistent'

/**
 * Solver-owned solved sketch status summary.
 * `solveState` answers whether usable geometry was produced.
 * `constraintState` answers how the constraint system classified the result.
 */
export interface SolvedSketchStatus {
  /** Whether the solver produced a usable solved state for this evaluation. */
  solveState: SolvedSketchSolveState
  /** Constraint-system classification for the evaluated sketch graph. */
  constraintState: SolvedSketchConstraintState
}

/**
 * Solver-owned solved entity geometry.
 * Geometry records are authoritative solver outputs, not authored inputs.
 */
export type SolvedSketchEntityGeometryRecord =
  | {
      /** Authored entity identity whose solved geometry is being reported. */
      entityId: SketchEntityId
      /** Stable discriminant for solved point-entity geometry. */
      kind: 'point'
      /** Solver-computed point position in sketch-plane units. */
      solvedPosition: SketchPoint2D
    }
  | {
      /** Authored entity identity whose solved geometry is being reported. */
      entityId: SketchEntityId
      /** Stable discriminant for solved line-segment geometry. */
      kind: 'lineSegment'
      /** Solver-computed start point in sketch-plane units. */
      startPosition: SketchPoint2D
      /** Solver-computed end point in sketch-plane units. */
      endPosition: SketchPoint2D
    }
  | {
      /** Authored entity identity whose solved geometry is being reported. */
      entityId: SketchEntityId
      /** Stable discriminant for solved circle geometry. */
      kind: 'circle'
      /** Solver-computed center point in sketch-plane units. */
      centerPosition: SketchPoint2D
      /** Solver-computed radius in sketch-plane units. */
      solvedRadius: number
    }
  | {
      /** Authored entity identity whose solved geometry is being reported. */
      entityId: SketchEntityId
      /** Stable discriminant for solved arc geometry. */
      kind: 'arc'
      /** Solver-computed arc center in sketch-plane units. */
      centerPosition: SketchPoint2D
      /** Solver-computed arc start point in sketch-plane units. */
      startPosition: SketchPoint2D
      /** Solver-computed arc end point in sketch-plane units. */
      endPosition: SketchPoint2D
      /** Solver-computed sweep direction from start to end. */
      sweepDirection: 'clockwise' | 'counterClockwise'
    }
  | {
      /** Authored entity identity whose solved geometry is being reported. */
      entityId: SketchEntityId
      /** Stable discriminant for solved spline geometry. */
      kind: 'spline'
      /** Solver-computed fit/control points in sketch-plane units. */
      fitPoints: readonly SketchPoint2D[]
      /** Polynomial degree reported for the solved spline representation. */
      degree: 2 | 3
    }
  | {
      /** Authored entity identity whose solved geometry is being reported. */
      entityId: SketchEntityId
      /** Stable discriminant for solved ellipse geometry. */
      kind: 'ellipse'
      /** Solver-computed center point in sketch-plane units. */
      centerPosition: SketchPoint2D
      /** Solver-computed endpoint of the major-axis radius vector. */
      majorAxisEndpointPosition: SketchPoint2D
      /** Solver-computed minor radius in sketch-plane units. */
      minorRadius: number
    }
  | {
      /** Authored entity identity whose solved geometry is being reported. */
      entityId: SketchEntityId
      /** Stable discriminant for solved elliptical arc geometry. */
      kind: 'ellipticalArc'
      /** Solver-computed center point in sketch-plane units. */
      centerPosition: SketchPoint2D
      /** Solver-computed endpoint of the major-axis radius vector. */
      majorAxisEndpointPosition: SketchPoint2D
      /** Solver-computed arc start point in sketch-plane units. */
      startPosition: SketchPoint2D
      /** Solver-computed arc end point in sketch-plane units. */
      endPosition: SketchPoint2D
      /** Solver-computed minor radius in sketch-plane units. */
      minorRadius: number
      /** Solver-computed sweep direction from start to end. */
      sweepDirection: 'clockwise' | 'counterClockwise'
    }
  | {
      /** Authored entity identity whose solved geometry is being reported. */
      entityId: SketchEntityId
      /** Stable discriminant for solved conic geometry. */
      kind: 'conic'
      /** Solver-computed start point in sketch-plane units. */
      startPosition: SketchPoint2D
      /** Solver-computed control point in sketch-plane units. */
      controlPosition: SketchPoint2D
      /** Solver-computed end point in sketch-plane units. */
      endPosition: SketchPoint2D
      /** Positive conic weight/rho preserving the authored conic family. */
      rho: number
    }
  | {
      /** Authored entity identity whose solved geometry is being reported. */
      entityId: SketchEntityId
      /** Stable discriminant for solved Bezier geometry. */
      kind: 'bezierCurve'
      /** Solver-computed Bezier control points in sketch-plane units. */
      controlPoints: readonly SketchPoint2D[]
      /** Polynomial degree reported for this Bezier representation. */
      degree: 2 | 3
    }
  | {
      /** Authored entity identity whose solved geometry is being reported. */
      entityId: SketchEntityId
      /** Stable discriminant for solved profile text geometry. */
      kind: 'profileText'
      /** Solver-computed text anchor in sketch-plane units. */
      anchorPosition: SketchPoint2D
      /** Authored text content preserved for deterministic outline generation. */
      text: string
      /** Text cap-height in sketch-plane units. */
      height: number
      /** Baseline rotation in sketch-plane radians. */
      rotationRadians: number
      /** Horizontal placement of the generated outline relative to `anchorPosition`. */
      horizontalAlign: 'left' | 'center' | 'right'
      /** Vertical placement of the generated outline relative to `anchorPosition`. */
      verticalAlign: 'baseline' | 'middle' | 'top' | 'bottom'
    }

/**
 * Solver-owned per-constraint status payload.
 */
export interface ConstraintStatusRecord {
  /** Authored constraint identity being reported. */
  constraintId: ConstraintId
  /** Machine-readable evaluation result for the authored constraint. */
  status: 'satisfied' | 'unsatisfied' | 'conflicting'
}

/**
 * Solver-owned per-dimension status payload.
 */
export interface DimensionStatusRecord {
  /** Authored dimension identity being reported. */
  dimensionId: DimensionId
  /** Machine-readable evaluation result for the authored dimension. */
  status: 'driving' | 'driven' | 'unsatisfied'
  /** Solver-computed value in sketch-plane units when available. */
  solvedValue: number | null
}

/**
 * Solver-owned machine-readable diagnostic payload for sketch solving.
 */
export interface SketchSolveDiagnostic {
  /** Stable diagnostic code for programmatic handling. */
  code: string
  /** Severity emitted by the solver/kernel producer. */
  severity: 'info' | 'warning' | 'error'
  /** Human-readable diagnostic summary. */
  message: string
  /** Precise authored or derived target implicated by the diagnostic, when known. */
  target:
    | { kind: 'entity'; entityId: SketchEntityId }
    | { kind: 'point'; pointId: SketchPointId }
    | { kind: 'constraint'; constraintId: ConstraintId }
    | { kind: 'dimension'; dimensionId: DimensionId }
    | { kind: 'region'; regionId: RegionId }
    | null
}

/**
 * Stable projected-geometry reference owned by one external sketch reference.
 */
export interface ProjectedSketchGeometryRef {
  /** Optional selection/runtime discriminant for editor-facing projected targets. */
  kind?: 'projectedPoint' | 'projectedLineSegment' | 'projectedCircle' | 'projectedArc' | 'projectedSpline'
  /** Authored external reference that produced the projected geometry. */
  referenceId: ReferenceId
  /** Stable projected geometry identity scoped to `referenceId`. */
  geometryId: ProjectedGeometryId
}

/**
 * Region boundary segment record in traversal order around one loop.
 */
export interface RegionBoundarySegmentRecord {
  /** Boundary entity or projected geometry used for this loop segment. */
  source:
    | { kind: 'entity'; entityId: SketchEntityId }
    | { kind: 'projectedGeometry'; reference: ProjectedSketchGeometryRef }
  /** Boundary start point when the segment starts at an authored point. */
  startPointId: SketchPointId | null
  /** Boundary end point when the segment ends at an authored point. */
  endPointId: SketchPointId | null
  /** Traversal direction relative to the source geometry's live-derived orientation. */
  traversalDirection?: 'forward' | 'reverse'
}

/**
 * Solver- or kernel-derived boundary loop record for one region.
 */
export interface RegionLoopRecord {
  /** Durable derived loop identity scoped to one region. */
  loopId: RegionLoopId
  /** Declares whether this loop bounds material or a void within the region. */
  role: 'outer' | 'inner'
  /** Traversal orientation of the loop in sketch-plane coordinates. */
  orientation: 'clockwise' | 'counterClockwise'
  /** Ordered boundary segments around the loop perimeter. */
  segments: RegionBoundarySegmentRecord[]
  /** Ordered authored boundary points visited by the loop when available. */
  boundaryPointIds: SketchPointId[]
  /** False when the producer is reporting an incomplete loop candidate. */
  isClosed: boolean
}

/**
 * Solver-owned solved sketch snapshot.
 * This record is derived output and may differ from authored input positions.
 */
export interface SolvedSketchSnapshot {
  /** Schema version for the solved sketch payload. */
  schemaVersion: SolvedSketchSchemaVersion
  /** Solver-owned constraint-status summary for the containing sketch. */
  status: SolvedSketchStatus
  /** Solver-computed geometry per authored entity when available. */
  solvedEntities: SolvedSketchEntityGeometryRecord[]
  /** Solver-computed point positions for authored points that remain valid in this solution. */
  solvedPoints: SolvedSketchPointRecord[]
  /** Solver-computed status per authored constraint. */
  constraintStatuses: ConstraintStatusRecord[]
  /** Solver-computed status/value per authored dimension. */
  dimensionStatuses: DimensionStatusRecord[]
  /** Solver/kernel diagnostics for the current solved sketch state. */
  diagnostics: SketchSolveDiagnostic[]
}

/**
 * Solver- or kernel-derived closed region record.
 * The editor must never author or persist these as primary sketch input.
 */
export interface RegionRecord extends OwnershipRecord {
  /** Durable derived region identity owned by the solver/kernel layer. */
  regionId: RegionId
  /** Human-readable label owned by the solver/kernel producer. */
  label: string
  /** Durable region reference for downstream feature authoring. */
  target: RegionRef
  /** Owning sketch from which the region was derived. */
  sourceSketch: SketchRef
  /** Ordered boundary loops that define the region, including interior voids. */
  loops: RegionLoopRecord[]
  /** False when the producer is reporting an incomplete or invalid derived region candidate. */
  isClosed: boolean
}

/**
 * Durable authored sketch snapshot payload shared by document snapshots.
 * Authored graph, solved graph, and derived regions are separated explicitly.
 */
export interface SketchRecord extends OwnershipRecord {
  /** Durable sketch identity owned by the modeling layer. */
  sketchId: SketchId
  /** Human-readable sketch label owned by the modeling layer. */
  label: string
  /** Explicit planar support from which the sketch coordinate system is derived. */
  planeSupport: SketchPlaneSupportRef
  /** Durable authored sketch graph submitted for solving and downstream feature use. */
  definition: SketchDefinition
  /** Solver-owned solved state corresponding to `definition` at the current revision. */
  solvedSnapshot: SolvedSketchSnapshot
  /** Solver-owned live projection data for the current revision; never authored sketch geometry. */
  projectedReferences?: import('@/contracts/solver/schema').ProjectedSketchReferenceRecord[]
  /** Derived regions owned by the solver/kernel layer for the current solved sketch state. */
  regions: RegionRecord[]
}
