import { test } from 'bun:test'

import type { SketchDefinition } from '@/contracts/sketch/schema'
import { sketchDefinitionSchema } from '@/contracts/sketch/runtime-schema'

test('src/contracts/sketch/image-reference-runtime-schema.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const baseDefinition: SketchDefinition = {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: [
      'sketch_point_tl',
      'sketch_point_tr',
      'sketch_point_br',
      'sketch_point_bl',
    ],
    points: [
      ['sketch_point_tl', [-1, 1], 'Top left'],
      ['sketch_point_tr', [1, 1], 'Top right'],
      ['sketch_point_br', [1, -1], 'Bottom right'],
      ['sketch_point_bl', [-1, -1], 'Bottom left'],
    ].map(([pointId, position, label]) => ({
      pointId: pointId as SketchDefinition['pointIds'][number],
      label: label as string,
      target: { kind: 'sketchPoint' as const, sketchId: 'sketch_image_reference', pointId: pointId as SketchDefinition['pointIds'][number] },
      position: position as readonly [number, number],
      isConstruction: true,
    })),
    entityIds: ['sketch_entity_image_reference'],
    entities: [{
      kind: 'imageReference',
      entityId: 'sketch_entity_image_reference',
      label: 'Reference',
      target: { kind: 'sketchEntity', sketchId: 'sketch_image_reference', entityId: 'sketch_entity_image_reference' },
      isConstruction: true,
      cornerPointIds: ['sketch_point_tl', 'sketch_point_tr', 'sketch_point_br', 'sketch_point_bl'],
      embeddedBinaryId: 'asset_image_reference',
      pixelWidth: 640,
      pixelHeight: 480,
    }],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    styleIds: [],
    styles: [],
    svgRenderingEnabled: true,
    derivedRelationships: [],
    authoringOperations: [],
  }

  assert(sketchDefinitionSchema.safeParse(baseDefinition).success, 'Runtime schema should accept valid image reference entities.')

  const missingCorner = sketchDefinitionSchema.safeParse({
    ...baseDefinition,
    entities: [{
      ...baseDefinition.entities[0]!,
      cornerPointIds: ['sketch_point_tl', 'sketch_point_tr', 'sketch_point_br'],
    }],
  })
  assert(!missingCorner.success, 'Runtime schema should reject image references with fewer than four corners.')

  const zeroDimensions = sketchDefinitionSchema.safeParse({
    ...baseDefinition,
    entities: [{
      ...baseDefinition.entities[0]!,
      pixelWidth: 0,
    }],
  })
  assert(!zeroDimensions.success, 'Runtime schema should reject image references with non-positive pixel dimensions.')
})
