import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { SketchDefinition } from '@/contracts/sketch/schema'
import { sketchDefinitionSchema } from '@/contracts/sketch/runtime-schema'

test('src/contracts/sketch/reference-image-runtime-schema.spec.ts', () => {  const baseDefinition: SketchDefinition = {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: [],
    points: [],
    entityIds: [],
    entities: [],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    styleIds: [],
    styles: [],
    svgRenderingEnabled: true,
    derivedRelationships: [],
    authoringOperations: [{
      operationId: 'sketch_operation_1_reference-image',
      label: 'Reference',
      kind: 'referenceImage',
      targets: {
        created: [{ kind: 'operation', operationId: 'sketch_operation_1_reference-image' }],
      },
      ownedState: {
        kind: 'referenceImage',
        image: {
          mediaType: 'image/png',
          fileName: 'reference.png',
          pixelWidth: 640,
          pixelHeight: 480,
          base64Data: 'cG5n',
        },
        placement: {
          center: [0, 0],
          width: 200,
          height: 150,
          rotationRadians: 0,
        },
      },
    }],
  }

  expectTrue(sketchDefinitionSchema.safeParse(baseDefinition).success, 'Runtime schema should accept valid committed reference-image operations.')

  const missingPayload = sketchDefinitionSchema.safeParse({
    ...baseDefinition,
    authoringOperations: [{
      ...baseDefinition.authoringOperations![0]!,
      ownedState: {
        ...baseDefinition.authoringOperations![0]!.ownedState!,
        image: {
          ...baseDefinition.authoringOperations![0]!.ownedState!.image,
          base64Data: '',
        },
      },
    }],
  })
  expectTrue(!missingPayload.success, 'Runtime schema should reject empty inline image payloads.')

  const zeroDimensions = sketchDefinitionSchema.safeParse({
    ...baseDefinition,
    authoringOperations: [{
      ...baseDefinition.authoringOperations![0]!,
      ownedState: {
        ...baseDefinition.authoringOperations![0]!.ownedState!,
        image: {
          ...baseDefinition.authoringOperations![0]!.ownedState!.image,
          pixelWidth: 0,
        },
      },
    }],
  })
  expectTrue(!zeroDimensions.success, 'Runtime schema should reject non-positive reference-image pixel dimensions.')

  const missingPlacement = sketchDefinitionSchema.safeParse({
    ...baseDefinition,
    authoringOperations: [{
      ...baseDefinition.authoringOperations![0]!,
      ownedState: {
        ...baseDefinition.authoringOperations![0]!.ownedState!,
        placement: {
          ...baseDefinition.authoringOperations![0]!.ownedState!.placement,
          width: 0,
        },
      },
    }],
  })
  expectTrue(!missingPlacement.success, 'Runtime schema should reject non-positive placement extents.')

  const legacyAnchor = sketchDefinitionSchema.safeParse({
    ...baseDefinition,
    authoringOperations: [{
      ...baseDefinition.authoringOperations![0]!,
      ownedState: {
        ...baseDefinition.authoringOperations![0]!.ownedState!,
        calibration: {
          scaleMode: 'lockedAspect',
          anchors: [{
            anchorId: 'anchor_a',
            label: 'Anchor A',
            uv: [0.25, 0.5],
            worldPosition: [10, 5],
          }],
          showExportedAnchorsInSketch: true,
        },
      },
    }],
  })
  expectTrue(!legacyAnchor.success, 'Runtime schema should reject calibration anchors that omit a sketch point binding.')

  const legacyConstraints = sketchDefinitionSchema.safeParse({
    ...baseDefinition,
    authoringOperations: [{
      ...baseDefinition.authoringOperations![0]!,
      ownedState: {
        ...baseDefinition.authoringOperations![0]!.ownedState!,
        calibration: {
          scaleMode: 'lockedAspect',
          anchors: [{
            anchorId: 'anchor_a',
            label: 'Anchor A',
            uv: [0.25, 0.5],
            pointId: 'sketch_point_anchor_a',
          }],
          constraints: [{
            constraintId: 'legacy_distance',
            kind: 'distance',
            label: 'Legacy distance',
            firstAnchorId: 'anchor_a',
            secondAnchorId: 'anchor_b',
            distance: 10,
          }],
          showExportedAnchorsInSketch: true,
        },
      },
    }],
  })
  expectTrue(!legacyConstraints.success, 'Runtime schema should reject deprecated calibration-only constraint payloads.')
})
