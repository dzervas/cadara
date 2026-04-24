import { test } from 'bun:test'

import { sketchDefinitionSchema } from '@/contracts/sketch/runtime-schema'
import type { SketchDefinition } from '@/contracts/sketch/schema'

test('src/contracts/sketch/authoring-operations.runtime-schema.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const legacyDefinition: SketchDefinition = {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: ['sketch_point_a', 'sketch_point_b'],
    points: [
      {
        pointId: 'sketch_point_a',
        label: 'A',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_a' },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_b',
        label: 'B',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_b' },
        position: [1, 0],
        isConstruction: false,
      },
    ],
    entityIds: ['sketch_entity_line'],
    entities: [
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_line',
        label: 'Line',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_line' },
        isConstruction: false,
        startPointId: 'sketch_point_a',
        endPointId: 'sketch_point_b',
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  }

  const migrated = sketchDefinitionSchema.safeParse(legacyDefinition)
  assert(migrated.success, 'Runtime schema should accept legacy sketches without authoring operation metadata.')
  assert(Array.isArray(migrated.data.authoringOperations), 'Missing authoring operations should normalize to an array.')
  assert(migrated.data.authoringOperations?.length === 0, 'Legacy authoring operations should default empty.')

  const withOperation: SketchDefinition = {
    ...legacyDefinition,
    authoringOperations: [
      {
        operationId: 'sketch_operation_1_line',
        label: 'Line 1',
        kind: 'line',
        targets: {
          created: [
            { kind: 'point', pointId: 'sketch_point_a' },
            { kind: 'point', pointId: 'sketch_point_b' },
            { kind: 'entity', entityId: 'sketch_entity_line' },
          ],
        },
        createdGraph: {
          points: legacyDefinition.points,
          entities: legacyDefinition.entities,
        },
      },
    ],
  }

  const parsed = sketchDefinitionSchema.safeParse(withOperation)
  assert(parsed.success, 'Runtime schema should accept durable authoring operations.')
  const serialized = JSON.parse(JSON.stringify(parsed.data)) as unknown
  const roundTrip = sketchDefinitionSchema.safeParse(serialized)
  assert(roundTrip.success, 'Authoring operation metadata should survive serialize/parse round-trips.')
  const operation = roundTrip.data.authoringOperations?.[0]
  assert(operation?.operationId === 'sketch_operation_1_line', 'Round-tripped operation ID should be preserved.')
  assert(operation.label === 'Line 1', 'Round-tripped operation label should be preserved.')
  assert(operation.kind === 'line', 'Round-tripped operation kind should be preserved.')
  assert(operation.targets.created?.[2]?.kind === 'entity', 'Round-tripped operation target refs should be typed.')
  assert(operation.createdGraph?.entities?.[0]?.entityId === 'sketch_entity_line', 'Round-tripped operation graph records should be preserved.')

  const withUndefinedOptionalGraphs = sketchDefinitionSchema.safeParse({
    ...withOperation,
    authoringOperations: [{
      ...withOperation.authoringOperations![0],
      createdGraph: undefined,
      removedGraph: undefined,
    }],
  })
  assert(withUndefinedOptionalGraphs.success, 'Runtime schema should accept optional authoring operation graphs with undefined values.')
  const normalizedOperation = withUndefinedOptionalGraphs.data.authoringOperations?.[0] as Record<string, unknown> | undefined
  assert(normalizedOperation && !('createdGraph' in normalizedOperation), 'Undefined createdGraph should be omitted from normalized operations.')
  assert(normalizedOperation && !('removedGraph' in normalizedOperation), 'Undefined removedGraph should be omitted from normalized operations.')
})
