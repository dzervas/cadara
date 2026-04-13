import { z } from 'zod'

import type { DurableRef } from '@/contracts/shared/references'
import {
  bodyIdSchema,
  constructionIdSchema,
  constraintIdSchema,
  dimensionIdSchema,
  edgeIdSchema,
  faceIdSchema,
  featureIdSchema,
  loopIdSchema,
  regionIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchPointIdSchema,
  vertexIdSchema,
} from '@/contracts/shared/runtime-schema'

export const bodyRefSchema = z.object({
  kind: z.literal('body'),
  bodyId: bodyIdSchema,
})

export const faceRefSchema = z.object({
  kind: z.literal('face'),
  bodyId: bodyIdSchema,
  faceId: faceIdSchema,
})

export const edgeRefSchema = z.object({
  kind: z.literal('edge'),
  bodyId: bodyIdSchema,
  edgeId: edgeIdSchema,
})

export const vertexRefSchema = z.object({
  kind: z.literal('vertex'),
  bodyId: bodyIdSchema,
  vertexId: vertexIdSchema,
})

export const loopRefSchema = z.object({
  kind: z.literal('loop'),
  bodyId: bodyIdSchema,
  loopId: loopIdSchema,
})

export const sketchRefSchema = z.object({
  kind: z.literal('sketch'),
  sketchId: sketchIdSchema,
})

export const sketchEntityRefSchema = z.object({
  kind: z.literal('sketchEntity'),
  sketchId: sketchIdSchema,
  entityId: sketchEntityIdSchema,
})

export const sketchPointRefSchema = z.object({
  kind: z.literal('sketchPoint'),
  sketchId: sketchIdSchema,
  pointId: sketchPointIdSchema,
})

export const sketchConstraintRefSchema = z.object({
  kind: z.literal('constraint'),
  sketchId: sketchIdSchema,
  constraintId: constraintIdSchema,
})

export const sketchDimensionRefSchema = z.object({
  kind: z.literal('dimension'),
  sketchId: sketchIdSchema,
  dimensionId: dimensionIdSchema,
})

export const featureRefSchema = z.object({
  kind: z.literal('feature'),
  featureId: featureIdSchema,
})

export const constructionRefSchema = z.object({
  kind: z.literal('construction'),
  constructionId: constructionIdSchema,
})

export const regionRefSchema = z.object({
  kind: z.literal('region'),
  sketchId: sketchIdSchema,
  regionId: regionIdSchema,
})

export const durableRefSchema = z.discriminatedUnion('kind', [
  bodyRefSchema,
  faceRefSchema,
  edgeRefSchema,
  vertexRefSchema,
  loopRefSchema,
  sketchRefSchema,
  sketchEntityRefSchema,
  sketchPointRefSchema,
  sketchConstraintRefSchema,
  sketchDimensionRefSchema,
  featureRefSchema,
  constructionRefSchema,
  regionRefSchema,
]).transform((value) => value as DurableRef)
