import { z } from 'zod'

import type {
  ConstraintDefinition,
  DimensionDefinition,
  ProjectedSketchGeometryRef,
  RegionRecord,
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchAuthoringOperation,
  SketchPointDefinition,
  SketchRecord,
  SketchReferenceDefinition,
  SketchStyleRecord,
  SolvedSketchSnapshot,
} from '@/contracts/sketch/schema'
import { sketchPlaneDefinitionSchema } from '@/contracts/shared/sketch-plane.runtime-schema'
import {
  durableRefSchema,
  sketchEntityRefSchema,
  sketchPointRefSchema,
  sketchRefSchema,
} from '@/contracts/shared/references.runtime-schema'
import {
  constraintIdSchema,
  dimensionIdSchema,
  point2dSchema,
  positiveNumberSchema,
  projectedGeometryIdSchema,
  referenceIdSchema,
  regionIdSchema,
  requestIdSchema,
  sketchAuthoringOperationIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchPointIdSchema,
  sketchStyleIdSchema,
} from '@/contracts/shared/runtime-schema'

export const sketchSchemaVersionSchema = z.literal('sketch-definition/v1alpha1')
export const solvedSketchSchemaVersionSchema = z.literal('solved-sketch/v1alpha1')

const projectedSketchGeometryRefSchema = z.object({
  kind: z.union([
    z.literal('projectedPoint'),
    z.literal('projectedLineSegment'),
    z.literal('projectedCircle'),
    z.literal('projectedArc'),
    z.literal('projectedSpline'),
  ]).optional(),
  referenceId: referenceIdSchema,
  geometryId: projectedGeometryIdSchema,
}).transform((value) => value as ProjectedSketchGeometryRef)

const sketchReferenceDefinitionSchema = z.discriminatedUnion('kind', [
  z.object({
    referenceId: referenceIdSchema,
    kind: z.literal('constructionPlane'),
    label: z.string(),
    source: z.object({
      kind: z.literal('construction'),
      constructionId: z.string(),
    }),
    projectionMode: z.literal('coplanar'),
  }),
  z.object({
    referenceId: referenceIdSchema,
    kind: z.literal('modelReference'),
    label: z.string(),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('face'), bodyId: z.string(), faceId: z.string() }),
      z.object({ kind: z.literal('edge'), bodyId: z.string(), edgeId: z.string() }),
      z.object({ kind: z.literal('vertex'), bodyId: z.string(), vertexId: z.string() }),
    ]),
    projectionMode: z.union([
      z.literal('projectAlongPlaneNormal'),
      z.literal('useExistingCoplanarGeometry'),
    ]),
  }),
  z.object({
    referenceId: referenceIdSchema,
    kind: z.literal('sketchReference'),
    label: z.string(),
    source: z.union([sketchEntityRefSchema, sketchPointRefSchema, sketchRefSchema]),
    projectionMode: z.literal('useExistingCoplanarGeometry'),
  }),
]).transform((value) => value as SketchReferenceDefinition)

const sketchStyleDefinitionSchema = z.object({
  fillMode: z.union([z.literal('none'), z.literal('solid'), z.literal('gradient')]).optional(),
  fillColor: z.string().optional(),
  gradientStartColor: z.string().optional(),
  gradientEndColor: z.string().optional(),
  strokeEnabled: z.boolean().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().min(0).optional(),
  strokeCap: z.union([z.literal('butt'), z.literal('round'), z.literal('square')]).optional(),
  strokeJoin: z.union([z.literal('miter'), z.literal('round'), z.literal('bevel')]).optional(),
  strokeMiterLimit: z.number().min(0).optional(),
  strokeDashSize: z.number().min(0).optional(),
  strokeGapSize: z.number().min(0).optional(),
})

const sketchPointDefinitionSchema = z.object({
  pointId: sketchPointIdSchema,
  label: z.string(),
  target: sketchPointRefSchema,
  position: point2dSchema,
  isConstruction: z.boolean(),
  style: sketchStyleDefinitionSchema.optional(),
}).transform((value) => value as SketchPointDefinition)

const sketchEntityDefinitionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('lineSegment'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    startPointId: sketchPointIdSchema,
    endPointId: sketchPointIdSchema,
    style: sketchStyleDefinitionSchema.optional(),
  }),
  z.object({
    kind: z.literal('point'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    pointId: sketchPointIdSchema,
    style: sketchStyleDefinitionSchema.optional(),
  }),
  z.object({
    kind: z.literal('circle'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    centerPointId: sketchPointIdSchema,
    radius: positiveNumberSchema('Circle radius must be positive.'),
    style: sketchStyleDefinitionSchema.optional(),
  }),
  z.object({
    kind: z.literal('arc'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    centerPointId: sketchPointIdSchema,
    startPointId: sketchPointIdSchema,
    endPointId: sketchPointIdSchema,
    sweepDirection: z.union([z.literal('clockwise'), z.literal('counterClockwise')]),
    style: sketchStyleDefinitionSchema.optional(),
  }),
  z.object({
    kind: z.literal('spline'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    fitPointIds: z.array(sketchPointIdSchema).min(3),
    degree: z.union([z.literal(2), z.literal(3)]),
    style: sketchStyleDefinitionSchema.optional(),
  }),
  z.object({
    kind: z.literal('ellipse'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    centerPointId: sketchPointIdSchema,
    majorAxisPointId: sketchPointIdSchema,
    minorRadius: positiveNumberSchema('Ellipse minor radius must be positive.'),
    style: sketchStyleDefinitionSchema.optional(),
  }),
  z.object({
    kind: z.literal('ellipticalArc'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    centerPointId: sketchPointIdSchema,
    majorAxisPointId: sketchPointIdSchema,
    startPointId: sketchPointIdSchema,
    endPointId: sketchPointIdSchema,
    minorRadius: positiveNumberSchema('Elliptical arc minor radius must be positive.'),
    sweepDirection: z.union([z.literal('clockwise'), z.literal('counterClockwise')]),
    style: sketchStyleDefinitionSchema.optional(),
  }),
  z.object({
    kind: z.literal('conic'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    startPointId: sketchPointIdSchema,
    controlPointId: sketchPointIdSchema,
    endPointId: sketchPointIdSchema,
    rho: positiveNumberSchema('Conic rho must be positive.'),
    style: sketchStyleDefinitionSchema.optional(),
  }),
  z.object({
    kind: z.literal('bezierCurve'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    controlPointIds: z.array(sketchPointIdSchema).min(3).max(4),
    degree: z.union([z.literal(2), z.literal(3)]),
    style: sketchStyleDefinitionSchema.optional(),
  }).superRefine((value, ctx) => {
    if (value.controlPointIds.length !== value.degree + 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Bezier control point count must equal degree + 1.',
        path: ['controlPointIds'],
      })
    }
  }),
  z.object({
    kind: z.literal('profileText'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    anchorPointId: sketchPointIdSchema,
    text: z.string().trim().min(1, 'Profile text content must not be empty.'),
    height: positiveNumberSchema('Profile text height must be positive.'),
    rotationRadians: z.number(),
    horizontalAlign: z.union([z.literal('left'), z.literal('center'), z.literal('right')]),
    verticalAlign: z.union([z.literal('baseline'), z.literal('middle'), z.literal('top'), z.literal('bottom')]),
    style: sketchStyleDefinitionSchema.optional(),
  }),
]).transform((value) => value as SketchEntityDefinition)

const localSketchPointConstraintOperandSchema = z.object({
  kind: z.literal('localPoint'),
  pointId: sketchPointIdSchema,
})

const localSketchEntityConstraintOperandSchema = z.object({
  kind: z.literal('localEntity'),
  entityId: sketchEntityIdSchema,
})

const projectedSketchGeometryConstraintOperandSchema = z.object({
  kind: z.literal('projectedGeometry'),
  reference: projectedSketchGeometryRefSchema,
})

const dimensionLineAnnotationPlacementSchema = z.object({
  kind: z.literal('dimensionLine'),
  offset: z.number(),
  angleRadians: z.number().optional(),
})

const dimensionAngleAnnotationPlacementSchema = z.object({
  kind: z.literal('angleArc'),
  radius: positiveNumberSchema('Angle annotation radius must be positive.'),
  side: z.union([z.literal('minor'), z.literal('major')]),
})

const constraintDefinitionSchema = z.discriminatedUnion('kind', [
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('coincident'),
    label: z.string(),
    pointIds: z.tuple([sketchPointIdSchema, sketchPointIdSchema]),
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('horizontal'),
    label: z.string(),
    entityId: sketchEntityIdSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('fixPoint'),
    label: z.string(),
    pointId: sketchPointIdSchema,
    position: point2dSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('angle'),
    label: z.string(),
    pointIds: z.tuple([sketchPointIdSchema, sketchPointIdSchema, sketchPointIdSchema]),
    valueRadians: z.number(),
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('parallel'),
    label: z.string(),
    entityIds: z.tuple([sketchEntityIdSchema, sketchEntityIdSchema]),
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('perpendicular'),
    label: z.string(),
    entityIds: z.tuple([sketchEntityIdSchema, sketchEntityIdSchema]),
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('equalLength'),
    label: z.string(),
    entityIds: z.tuple([sketchEntityIdSchema, sketchEntityIdSchema]),
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('vertical'),
    label: z.string(),
    entityId: sketchEntityIdSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('coincidentProjectedPoint'),
    label: z.string(),
    point: localSketchPointConstraintOperandSchema,
    projectedPoint: projectedSketchGeometryConstraintOperandSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('pointOnProjectedCurve'),
    label: z.string(),
    point: localSketchPointConstraintOperandSchema,
    projectedCurve: projectedSketchGeometryConstraintOperandSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('midpoint'),
    label: z.string(),
    point: localSketchPointConstraintOperandSchema,
    line: localSketchEntityConstraintOperandSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('midpointProjectedLine'),
    label: z.string(),
    point: localSketchPointConstraintOperandSchema,
    projectedLine: projectedSketchGeometryConstraintOperandSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('pointOnCurve'),
    label: z.string(),
    point: localSketchPointConstraintOperandSchema,
    curve: localSketchEntityConstraintOperandSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('parallelProjectedLine'),
    label: z.string(),
    line: localSketchEntityConstraintOperandSchema,
    projectedLine: projectedSketchGeometryConstraintOperandSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('perpendicularProjectedLine'),
    label: z.string(),
    line: localSketchEntityConstraintOperandSchema,
    projectedLine: projectedSketchGeometryConstraintOperandSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('tangentProjectedCurve'),
    label: z.string(),
    curve: localSketchEntityConstraintOperandSchema,
    projectedCurve: projectedSketchGeometryConstraintOperandSchema,
    relation: z.union([z.literal('external'), z.literal('internal')]),
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('tangent'),
    label: z.string(),
    entityIds: z.tuple([sketchEntityIdSchema, sketchEntityIdSchema]),
    relation: z.union([z.literal('external'), z.literal('internal')]),
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('concentric'),
    label: z.string(),
    entityIds: z.tuple([sketchEntityIdSchema, sketchEntityIdSchema]),
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('concentricProjectedCurve'),
    label: z.string(),
    curve: localSketchEntityConstraintOperandSchema,
    projectedCurve: projectedSketchGeometryConstraintOperandSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('normal'),
    label: z.string(),
    line: localSketchEntityConstraintOperandSchema,
    curve: localSketchEntityConstraintOperandSchema,
    point: localSketchPointConstraintOperandSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('normalProjectedCurve'),
    label: z.string(),
    line: localSketchEntityConstraintOperandSchema,
    projectedCurve: projectedSketchGeometryConstraintOperandSchema,
    point: localSketchPointConstraintOperandSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('symmetric'),
    label: z.string(),
    pointIds: z.tuple([sketchPointIdSchema, sketchPointIdSchema]),
    axis: localSketchEntityConstraintOperandSchema,
  }),
  z.object({
    constraintId: constraintIdSchema,
    kind: z.literal('symmetricProjectedLine'),
    label: z.string(),
    pointIds: z.tuple([sketchPointIdSchema, sketchPointIdSchema]),
    projectedLine: projectedSketchGeometryConstraintOperandSchema,
  }),
]).transform((value) => value as ConstraintDefinition)

const dimensionDefinitionSchema = z.discriminatedUnion('kind', [
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('distance'),
    label: z.string(),
    axis: z.union([z.literal('aligned'), z.literal('horizontal'), z.literal('vertical')]),
    pointIds: z.tuple([sketchPointIdSchema, sketchPointIdSchema]),
    value: z.number(),
    annotationPlacement: dimensionLineAnnotationPlacementSchema.optional(),
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('circleRadius'),
    label: z.string(),
    entityId: sketchEntityIdSchema,
    value: positiveNumberSchema('Circle radius dimension must be positive.'),
    annotationPlacement: dimensionLineAnnotationPlacementSchema.optional(),
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('diameter'),
    label: z.string(),
    entityId: sketchEntityIdSchema,
    value: positiveNumberSchema('Diameter dimension must be positive.'),
    annotationPlacement: dimensionLineAnnotationPlacementSchema.optional(),
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('lineDistance'),
    label: z.string(),
    lines: z.tuple([
      z.union([localSketchEntityConstraintOperandSchema, projectedSketchGeometryConstraintOperandSchema]),
      z.union([localSketchEntityConstraintOperandSchema, projectedSketchGeometryConstraintOperandSchema]),
    ]),
    value: positiveNumberSchema('Line distance dimension must be positive.'),
    annotationPlacement: dimensionLineAnnotationPlacementSchema.optional(),
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('linePointDistance'),
    label: z.string(),
    line: z.union([localSketchEntityConstraintOperandSchema, projectedSketchGeometryConstraintOperandSchema]),
    point: z.union([localSketchPointConstraintOperandSchema, projectedSketchGeometryConstraintOperandSchema]),
    value: positiveNumberSchema('Line-point distance dimension must be positive.'),
    annotationPlacement: dimensionLineAnnotationPlacementSchema.optional(),
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('lineAngle'),
    label: z.string(),
    lines: z.tuple([
      z.union([localSketchEntityConstraintOperandSchema, projectedSketchGeometryConstraintOperandSchema]),
      z.union([localSketchEntityConstraintOperandSchema, projectedSketchGeometryConstraintOperandSchema]),
    ]),
    valueRadians: positiveNumberSchema('Line angle dimension must be positive.'),
    annotationPlacement: dimensionAngleAnnotationPlacementSchema.optional(),
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('horizontalDistance'),
    label: z.string(),
    pointIds: z.tuple([sketchPointIdSchema, sketchPointIdSchema]),
    value: z.number(),
    annotationPlacement: dimensionLineAnnotationPlacementSchema.optional(),
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('verticalDistance'),
    label: z.string(),
    pointIds: z.tuple([sketchPointIdSchema, sketchPointIdSchema]),
    value: z.number(),
    annotationPlacement: dimensionLineAnnotationPlacementSchema.optional(),
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('arcStartPointCoincident'),
    label: z.string(),
    entityId: sketchEntityIdSchema,
    pointId: sketchPointIdSchema,
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('arcEndPointCoincident'),
    label: z.string(),
    entityId: sketchEntityIdSchema,
    pointId: sketchPointIdSchema,
  }),
]).transform((value) => value as DimensionDefinition)

const sketchStyleFillSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('none'),
  }),
  z.object({
    kind: z.literal('solid'),
    color: z.string(),
    opacity: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('gradient'),
    gradient: z.object({
      kind: z.literal('linear'),
      angleRadians: z.number(),
      startColor: z.string(),
      startOpacity: z.number().min(0).max(1),
      endColor: z.string(),
      endOpacity: z.number().min(0).max(1),
    }),
  }),
])

const sketchStyleStrokeSchema = z.object({
  color: z.string(),
  opacity: z.number().min(0).max(1),
  width: z.number().min(0),
  lineCap: z.union([z.literal('butt'), z.literal('round'), z.literal('square')]),
  lineJoin: z.union([z.literal('miter'), z.literal('round'), z.literal('bevel')]),
  miterLimit: z.number().min(0),
  dashSize: z.number().min(0).optional(),
  gapSize: z.number().min(0).optional(),
})

const sketchStyleRecordSchema = z.object({
  styleId: sketchStyleIdSchema,
  label: z.string(),
  target: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('entity'),
      entityId: sketchEntityIdSchema,
    }),
    z.object({
      kind: z.literal('region'),
      regionId: regionIdSchema,
    }),
  ]),
  fill: sketchStyleFillSchema,
  stroke: sketchStyleStrokeSchema,
}).transform((value) => value as SketchStyleRecord)

const sketchDerivedEntityOutputSchema = z.object({
  seedEntityId: sketchEntityIdSchema,
  outputEntityId: sketchEntityIdSchema,
  instanceIndex: z.number().int().min(1),
  seedPointIds: z.array(sketchPointIdSchema),
  outputPointIds: z.array(sketchPointIdSchema),
})

const sketchDerivationBaseSchema = {
  derivationId: z.string().regex(/^sketch_derivation_.+$/, 'Sketch derivation ID is invalid.'),
  label: z.string(),
  seedEntityIds: z.array(sketchEntityIdSchema),
  outputs: z.array(sketchDerivedEntityOutputSchema),
} as const

const sketchDerivationDefinitionSchema = z.discriminatedUnion('kind', [
  z.object({
    ...sketchDerivationBaseSchema,
    kind: z.literal('mirror'),
    mirrorReference: z.object({
      kind: z.literal('lineEntity'),
      entityId: sketchEntityIdSchema,
    }),
  }),
  z.object({
    ...sketchDerivationBaseSchema,
    kind: z.literal('linearPattern'),
    vector: point2dSchema,
    instanceCount: z.number().int().min(2),
  }),
  z.object({
    ...sketchDerivationBaseSchema,
    kind: z.literal('circularPattern'),
    center: point2dSchema,
    angleRadians: z.number(),
    instanceCount: z.number().int().min(2),
  }),
  z.object({
    ...sketchDerivationBaseSchema,
    kind: z.literal('transform'),
    origin: point2dSchema,
    translation: point2dSchema,
    rotationRadians: z.number(),
    scale: positiveNumberSchema('Sketch transform scale must be positive.'),
  }),
]).transform((value) => value as SketchDerivationDefinition)

const sketchAuthoringOperationMemberRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('point'),
    pointId: sketchPointIdSchema,
  }),
  z.object({
    kind: z.literal('entity'),
    entityId: sketchEntityIdSchema,
  }),
  z.object({
    kind: z.literal('constraint'),
    constraintId: constraintIdSchema,
  }),
  z.object({
    kind: z.literal('dimension'),
    dimensionId: dimensionIdSchema,
  }),
  z.object({
    kind: z.literal('style'),
    styleId: sketchStyleIdSchema,
  }),
  z.object({
    kind: z.literal('derivation'),
    derivationId: z.string(),
  }),
])

const sketchAuthoringOperationGraphSchema = z.object({
  points: z.array(sketchPointDefinitionSchema).optional(),
  entities: z.array(sketchEntityDefinitionSchema).optional(),
  constraints: z.array(constraintDefinitionSchema).optional(),
  dimensions: z.array(dimensionDefinitionSchema).optional(),
  styles: z.array(sketchStyleRecordSchema).optional(),
  derivedRelationships: z.array(sketchDerivationDefinitionSchema).optional(),
})

const sketchAuthoringOperationSchema = z.object({
  operationId: sketchAuthoringOperationIdSchema,
  label: z.string(),
  kind: z.union([
    z.literal('point'),
    z.literal('line'),
    z.literal('midpointLine'),
    z.literal('rectangle'),
    z.literal('centerPointRectangle'),
    z.literal('alignedRectangle'),
    z.literal('circle'),
    z.literal('threePointCircle'),
    z.literal('centerPointArc'),
    z.literal('threePointArc'),
    z.literal('tangentArc'),
    z.literal('ellipse'),
    z.literal('ellipticalArc'),
    z.literal('conic'),
    z.literal('bezierCurve'),
    z.literal('inscribedPolygon'),
    z.literal('circumscribedPolygon'),
    z.literal('spline'),
    z.literal('controlPointSpline'),
    z.literal('profileText'),
    z.literal('constraint'),
    z.literal('dimension'),
    z.literal('construction'),
    z.literal('reference'),
    z.literal('delete'),
    z.literal('edit'),
    z.literal('derived'),
    z.literal('operation'),
  ]),
  targets: z.object({
    created: z.array(sketchAuthoringOperationMemberRefSchema).optional(),
    removed: z.array(sketchAuthoringOperationMemberRefSchema).optional(),
    edited: z.array(sketchAuthoringOperationMemberRefSchema).optional(),
  }),
  createdGraph: sketchAuthoringOperationGraphSchema.optional(),
  removedGraph: sketchAuthoringOperationGraphSchema.optional(),
}).transform(({ createdGraph, removedGraph, ...value }) => {
  const operation: Omit<SketchAuthoringOperation, 'createdGraph' | 'removedGraph'> & Partial<Pick<SketchAuthoringOperation, 'createdGraph' | 'removedGraph'>> = value

  if (createdGraph) {
    operation.createdGraph = createdGraph
  }

  if (removedGraph) {
    operation.removedGraph = removedGraph
  }

  return operation as SketchAuthoringOperation
})

export const sketchDefinitionSchema = z.object({
  schemaVersion: sketchSchemaVersionSchema,
  referenceIds: z.array(referenceIdSchema),
  references: z.array(sketchReferenceDefinitionSchema),
  pointIds: z.array(sketchPointIdSchema),
  points: z.array(sketchPointDefinitionSchema),
  entityIds: z.array(sketchEntityIdSchema),
  entities: z.array(sketchEntityDefinitionSchema),
  constraintIds: z.array(constraintIdSchema),
  constraints: z.array(constraintDefinitionSchema),
  dimensionIds: z.array(dimensionIdSchema),
  dimensions: z.array(dimensionDefinitionSchema),
  styleIds: z.array(sketchStyleIdSchema).default([]),
  styles: z.array(sketchStyleRecordSchema).default([]),
  svgRenderingEnabled: z.boolean().default(true),
  derivedRelationships: z.array(sketchDerivationDefinitionSchema).default([]),
  authoringOperations: z.array(sketchAuthoringOperationSchema).default([]),
}).transform((value) => value as SketchDefinition)

const regionRecordSchema = z.object({
  regionId: regionIdSchema,
  label: z.string(),
  target: durableRefSchema,
  sourceSketch: z.object({ kind: z.literal('sketch'), sketchId: sketchIdSchema }),
}).passthrough().transform((value) => value as unknown as RegionRecord)

const solvedSketchEntityGeometrySchema = z.discriminatedUnion('kind', [
  z.object({
    entityId: sketchEntityIdSchema,
    kind: z.literal('point'),
    solvedPosition: point2dSchema,
  }),
  z.object({
    entityId: sketchEntityIdSchema,
    kind: z.literal('lineSegment'),
    startPosition: point2dSchema,
    endPosition: point2dSchema,
  }),
  z.object({
    entityId: sketchEntityIdSchema,
    kind: z.literal('circle'),
    centerPosition: point2dSchema,
    solvedRadius: positiveNumberSchema('Solved circle radius must be positive.'),
  }),
  z.object({
    entityId: sketchEntityIdSchema,
    kind: z.literal('arc'),
    centerPosition: point2dSchema,
    startPosition: point2dSchema,
    endPosition: point2dSchema,
    sweepDirection: z.union([z.literal('clockwise'), z.literal('counterClockwise')]),
  }),
  z.object({
    entityId: sketchEntityIdSchema,
    kind: z.literal('spline'),
    fitPoints: z.array(point2dSchema).min(3),
    degree: z.union([z.literal(2), z.literal(3)]),
  }),
  z.object({
    entityId: sketchEntityIdSchema,
    kind: z.literal('ellipse'),
    centerPosition: point2dSchema,
    majorAxisEndpointPosition: point2dSchema,
    minorRadius: positiveNumberSchema('Solved ellipse minor radius must be positive.'),
  }),
  z.object({
    entityId: sketchEntityIdSchema,
    kind: z.literal('ellipticalArc'),
    centerPosition: point2dSchema,
    majorAxisEndpointPosition: point2dSchema,
    startPosition: point2dSchema,
    endPosition: point2dSchema,
    minorRadius: positiveNumberSchema('Solved elliptical arc minor radius must be positive.'),
    sweepDirection: z.union([z.literal('clockwise'), z.literal('counterClockwise')]),
  }),
  z.object({
    entityId: sketchEntityIdSchema,
    kind: z.literal('conic'),
    startPosition: point2dSchema,
    controlPosition: point2dSchema,
    endPosition: point2dSchema,
    rho: positiveNumberSchema('Solved conic rho must be positive.'),
  }),
  z.object({
    entityId: sketchEntityIdSchema,
    kind: z.literal('bezierCurve'),
    controlPoints: z.array(point2dSchema).min(3).max(4),
    degree: z.union([z.literal(2), z.literal(3)]),
  }).superRefine((value, ctx) => {
    if (value.controlPoints.length !== value.degree + 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Solved Bezier control point count must equal degree + 1.',
        path: ['controlPoints'],
      })
    }
  }),
  z.object({
    entityId: sketchEntityIdSchema,
    kind: z.literal('profileText'),
    anchorPosition: point2dSchema,
    text: z.string().trim().min(1, 'Solved profile text content must not be empty.'),
    height: positiveNumberSchema('Solved profile text height must be positive.'),
    rotationRadians: z.number(),
    horizontalAlign: z.union([z.literal('left'), z.literal('center'), z.literal('right')]),
    verticalAlign: z.union([z.literal('baseline'), z.literal('middle'), z.literal('top'), z.literal('bottom')]),
  }),
])

export const sketchRecordSchema = z.object({
  sketchId: sketchIdSchema,
  sketchLabel: z.string(),
  plane: sketchPlaneDefinitionSchema,
  planeTarget: z.union([
    z.object({ kind: z.literal('construction'), constructionId: z.string() }),
    z.object({ kind: z.literal('face'), bodyId: z.string(), faceId: z.string() }),
  ]),
  planeKey: z.union([z.literal('xy'), z.literal('yz'), z.literal('xz')]).nullable(),
  definition: sketchDefinitionSchema,
}).passthrough().transform((value) => value as unknown as SketchRecord)

export const solvedSketchSnapshotSchema = z.object({
  schemaVersion: solvedSketchSchemaVersionSchema,
  status: z.object({
    solveState: z.union([z.literal('notEvaluated'), z.literal('solved'), z.literal('partiallySolved'), z.literal('failed')]),
    constraintState: z.union([
      z.literal('unknown'),
      z.literal('underConstrained'),
      z.literal('wellConstrained'),
      z.literal('overConstrained'),
      z.literal('inconsistent'),
    ]),
  }),
  solvedPoints: z.array(z.object({
    pointId: sketchPointIdSchema,
    target: sketchPointRefSchema,
    solvedPosition: point2dSchema,
  }).passthrough()),
  solvedEntities: z.array(solvedSketchEntityGeometrySchema),
  constraintStatuses: z.array(z.object({
    constraintId: constraintIdSchema,
    status: z.union([z.literal('satisfied'), z.literal('unsatisfied'), z.literal('conflicting')]),
  }).passthrough()),
  dimensionStatuses: z.array(z.object({
    dimensionId: dimensionIdSchema,
    status: z.union([z.literal('driving'), z.literal('driven'), z.literal('unsatisfied')]),
    solvedValue: z.number().nullable(),
  }).passthrough()),
  diagnostics: z.array(z.object({
    code: z.string(),
    severity: z.union([z.literal('info'), z.literal('warning'), z.literal('error')]),
    message: z.string(),
    target: z.unknown().nullable(),
  }).passthrough()),
}).passthrough().transform((value) => value as unknown as SolvedSketchSnapshot)

export const projectedReferenceRequestTargetSchema = z.union([
  durableRefSchema,
  projectedSketchGeometryRefSchema,
])

export const solverRegionRecordSchema = regionRecordSchema
export const solverRequestIdSchema = requestIdSchema
