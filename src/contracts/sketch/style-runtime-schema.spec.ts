import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { sketchDefinitionSchema } from '@/contracts/sketch/runtime-schema'
import type { SketchDefinition } from '@/contracts/sketch/schema'

test('src/contracts/sketch/style-runtime-schema.spec.ts', () => {  const baseDefinition: SketchDefinition = {
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
        position: [10, 0],
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
        style: {
          strokeMiterLimit: 5,
          strokeDashSize: 0.4,
          strokeGapSize: 0.2,
        },
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  }

  const migrated = sketchDefinitionSchema.safeParse(baseDefinition)
  expectTrue(migrated.success, 'Runtime schema should accept older definitions without authored styles.')
  expectTrue(Array.isArray(migrated.data.styleIds), 'Older payloads should migrate with styleIds present.')
  expectTrue(Array.isArray(migrated.data.styles), 'Older payloads should migrate with styles present.')
  expectTrue(migrated.data.styleIds.length === 0, 'Older payloads should default styleIds to an empty list.')
  expectTrue(migrated.data.styles.length === 0, 'Older payloads should default styles to an empty list.')
  expectTrue(migrated.data.svgRenderingEnabled === false, 'Older payloads should default SVG rendering to disabled.')

  const withStyles: SketchDefinition = {
    ...baseDefinition,
    svgRenderingEnabled: false,
    styleIds: ['sketch_style_line', 'sketch_style_region'],
    styles: [
      {
        styleId: 'sketch_style_line',
        label: 'Primary edge style',
        target: { kind: 'entity', entityId: 'sketch_entity_line' },
        fill: { kind: 'none' },
        stroke: {
          color: '#7dd3fc',
          opacity: 0.95,
          width: 2,
          lineCap: 'round',
          lineJoin: 'round',
          miterLimit: 4,
          dashSize: 0.6,
          gapSize: 0.25,
        },
      },
      {
        styleId: 'sketch_style_region',
        label: 'Candidate region style',
        target: { kind: 'region', regionId: 'region_preview_face' },
        fill: {
          kind: 'gradient',
          gradient: {
            kind: 'linear',
            angleRadians: 0.3,
            startColor: '#1f2937',
            startOpacity: 0.4,
            endColor: '#0ea5e9',
            endOpacity: 0.8,
          },
        },
        stroke: {
          color: '#0ea5e9',
          opacity: 1,
          width: 1,
          lineCap: 'butt',
          lineJoin: 'miter',
          miterLimit: 6,
        },
      },
    ],
  }

  const parsed = sketchDefinitionSchema.safeParse(withStyles)
  expectTrue(parsed.success, 'Runtime schema should accept authored entity/region style records.')

  const serialized = JSON.parse(JSON.stringify(parsed.data)) as unknown
  const roundTrip = sketchDefinitionSchema.safeParse(serialized)
  expectTrue(roundTrip.success, 'Style payloads should survive serialize/parse round-trips.')
  expectTrue(roundTrip.data.svgRenderingEnabled === false, 'Round-tripped definitions should preserve SVG rendering state.')
  expectTrue(roundTrip.data.styles?.length === 2, 'Round-tripped style records should be preserved.')
  expectTrue(roundTrip.data.styles?.[1]?.fill.kind === 'gradient', 'Round-tripped gradient fill should be preserved.')
  expectTrue(roundTrip.data.styles?.[0]?.stroke.dashSize === 0.6, 'Round-tripped style records should preserve dash size.')
  expectTrue(
    roundTrip.data.entities[0]?.style?.strokeMiterLimit === 5,
    'Round-tripped local style records should preserve miter limits.',
  )
})
