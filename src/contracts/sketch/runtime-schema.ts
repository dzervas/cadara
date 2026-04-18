import { z } from 'zod'

import type {
  ConstraintDefinition,
  DimensionDefinition,
  ProjectedSketchGeometryRef,
  RegionRecord,
  SketchDefinition,
  SketchEntityDefinition,
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

const sketchPointDefinitionSchema = z.object({
  pointId: sketchPointIdSchema,
  label: z.string(),
  target: sketchPointRefSchema,
  position: point2dSchema,
  isConstruction: z.boolean(),
  style: z.object({
    fillMode: z.union([z.literal('none'), z.literal('solid'), z.literal('gradient')]).optional(),
    fillColor: z.string().optional(),
    gradientStartColor: z.string().optional(),
    gradientEndColor: z.string().optional(),
    strokeEnabled: z.boolean().optional(),
    strokeColor: z.string().optional(),
    strokeWidth: z.number().min(0).optional(),
    strokeCap: z.union([z.literal('butt'), z.literal('round'), z.literal('square')]).optional(),
    strokeJoin: z.union([z.literal('miter'), z.literal('round'), z.literal('bevel')]).optional(),
  }).optional(),
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
    style: z.object({
      fillMode: z.union([z.literal('none'), z.literal('solid'), z.literal('gradient')]).optional(),
      fillColor: z.string().optional(),
      gradientStartColor: z.string().optional(),
      gradientEndColor: z.string().optional(),
      strokeEnabled: z.boolean().optional(),
      strokeColor: z.string().optional(),
      strokeWidth: z.number().min(0).optional(),
      strokeCap: z.union([z.literal('butt'), z.literal('round'), z.literal('square')]).optional(),
      strokeJoin: z.union([z.literal('miter'), z.literal('round'), z.literal('bevel')]).optional(),
    }).optional(),
  }),
  z.object({
    kind: z.literal('point'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    pointId: sketchPointIdSchema,
    style: z.object({
      fillMode: z.union([z.literal('none'), z.literal('solid'), z.literal('gradient')]).optional(),
      fillColor: z.string().optional(),
      gradientStartColor: z.string().optional(),
      gradientEndColor: z.string().optional(),
      strokeEnabled: z.boolean().optional(),
      strokeColor: z.string().optional(),
      strokeWidth: z.number().min(0).optional(),
      strokeCap: z.union([z.literal('butt'), z.literal('round'), z.literal('square')]).optional(),
      strokeJoin: z.union([z.literal('miter'), z.literal('round'), z.literal('bevel')]).optional(),
    }).optional(),
  }),
  z.object({
    kind: z.literal('circle'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    centerPointId: sketchPointIdSchema,
    radius: positiveNumberSchema('Circle radius must be positive.'),
    style: z.object({
      fillMode: z.union([z.literal('none'), z.literal('solid'), z.literal('gradient')]).optional(),
      fillColor: z.string().optional(),
      gradientStartColor: z.string().optional(),
      gradientEndColor: z.string().optional(),
      strokeEnabled: z.boolean().optional(),
      strokeColor: z.string().optional(),
      strokeWidth: z.number().min(0).optional(),
      strokeCap: z.union([z.literal('butt'), z.literal('round'), z.literal('square')]).optional(),
      strokeJoin: z.union([z.literal('miter'), z.literal('round'), z.literal('bevel')]).optional(),
    }).optional(),
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
    style: z.object({
      fillMode: z.union([z.literal('none'), z.literal('solid'), z.literal('gradient')]).optional(),
      fillColor: z.string().optional(),
      gradientStartColor: z.string().optional(),
      gradientEndColor: z.string().optional(),
      strokeEnabled: z.boolean().optional(),
      strokeColor: z.string().optional(),
      strokeWidth: z.number().min(0).optional(),
      strokeCap: z.union([z.literal('butt'), z.literal('round'), z.literal('square')]).optional(),
      strokeJoin: z.union([z.literal('miter'), z.literal('round'), z.literal('bevel')]).optional(),
    }).optional(),
  }),
  z.object({
    kind: z.literal('spline'),
    entityId: sketchEntityIdSchema,
    label: z.string(),
    target: sketchEntityRefSchema,
    isConstruction: z.boolean(),
    fitPointIds: z.array(sketchPointIdSchema).min(3),
    degree: z.union([z.literal(2), z.literal(3)]),
    style: z.object({
      fillMode: z.union([z.literal('none'), z.literal('solid'), z.literal('gradient')]).optional(),
      fillColor: z.string().optional(),
      gradientStartColor: z.string().optional(),
      gradientEndColor: z.string().optional(),
      strokeEnabled: z.boolean().optional(),
      strokeColor: z.string().optional(),
      strokeWidth: z.number().min(0).optional(),
      strokeCap: z.union([z.literal('butt'), z.literal('round'), z.literal('square')]).optional(),
      strokeJoin: z.union([z.literal('miter'), z.literal('round'), z.literal('bevel')]).optional(),
    }).optional(),
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
]).transform((value) => value as ConstraintDefinition)

const dimensionDefinitionSchema = z.discriminatedUnion('kind', [
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('distance'),
    label: z.string(),
    axis: z.union([z.literal('aligned'), z.literal('horizontal'), z.literal('vertical')]),
    pointIds: z.tuple([sketchPointIdSchema, sketchPointIdSchema]),
    value: z.number(),
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('circleRadius'),
    label: z.string(),
    entityId: sketchEntityIdSchema,
    value: positiveNumberSchema('Circle radius dimension must be positive.'),
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('horizontalDistance'),
    label: z.string(),
    pointIds: z.tuple([sketchPointIdSchema, sketchPointIdSchema]),
    value: z.number(),
  }),
  z.object({
    dimensionId: dimensionIdSchema,
    kind: z.literal('verticalDistance'),
    label: z.string(),
    pointIds: z.tuple([sketchPointIdSchema, sketchPointIdSchema]),
    value: z.number(),
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
}).transform((value) => value as SketchDefinition)

const regionRecordSchema = z.object({
  regionId: regionIdSchema,
  label: z.string(),
  target: durableRefSchema,
  sourceSketch: z.object({ kind: z.literal('sketch'), sketchId: sketchIdSchema }),
}).passthrough().transform((value) => value as unknown as RegionRecord)

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
  points: z.array(z.object({
    pointId: sketchPointIdSchema,
    target: sketchPointRefSchema,
    solvedPosition: point2dSchema,
  }).passthrough()),
  entities: z.array(z.object({
    entityId: sketchEntityIdSchema,
    target: sketchEntityRefSchema,
  }).passthrough()),
  constraints: z.array(z.object({
    constraintId: constraintIdSchema,
  }).passthrough()),
  dimensions: z.array(z.object({
    dimensionId: dimensionIdSchema,
  }).passthrough()),
}).passthrough().transform((value) => value as unknown as SolvedSketchSnapshot)

export const projectedReferenceRequestTargetSchema = z.union([
  durableRefSchema,
  projectedSketchGeometryRefSchema,
])

export const solverRegionRecordSchema = regionRecordSchema
export const solverRequestIdSchema = requestIdSchema
