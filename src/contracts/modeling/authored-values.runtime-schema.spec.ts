import { test } from 'bun:test'

import { featureDefinitionSchema } from '@/contracts/modeling/runtime-schema'
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from '@/contracts/modeling/advanced-solid'
import { getAuthoredLiteralValue, isExpressionAuthoredValue } from '@/contracts/modeling/authored-values'
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'

test('src/contracts/modeling/authored-values.runtime-schema.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const baseExtrude = {
    kind: 'extrude',
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      profiles: [{ kind: 'region', sketchId: 'sketch_profile', regionId: 'region_profile' }],
      startExtent: { kind: 'profilePlane' },
      endExtent: { kind: 'blind', direction: 'positive', distance: 12 },
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    },
  }

  const legacyLiteral = featureDefinitionSchema.parse(baseExtrude)
  assert(
    legacyLiteral.kind === 'extrude' &&
      getAuthoredLiteralValue(legacyLiteral.parameters.endExtent.distance) === 12,
    'Runtime validation should normalize supported legacy literals to literal authored wrappers.',
  )

  const expression = featureDefinitionSchema.parse({
    ...baseExtrude,
    parameters: {
      ...baseExtrude.parameters,
      endExtent: {
        ...baseExtrude.parameters.endExtent,
        distance: { source: 'expression', valueText: 'depth + 1' },
      },
    },
  })
  assert(
    expression.kind === 'extrude' &&
      isExpressionAuthoredValue(expression.parameters.endExtent.distance) &&
      expression.parameters.endExtent.distance.valueText === 'depth + 1',
    'Runtime validation should accept expression-authored wrappers on expression-capable fields.',
  )

  const invalidLiteral = featureDefinitionSchema.safeParse({
    ...baseExtrude,
    parameters: {
      ...baseExtrude.parameters,
      endExtent: {
        ...baseExtrude.parameters.endExtent,
        distance: { source: 'literal', value: '12' },
      },
    },
  })
  assert(!invalidLiteral.success, 'Runtime validation should reject literal wrappers with the wrong value type.')

  const referenceExpression = featureDefinitionSchema.safeParse({
    ...baseExtrude,
    parameters: {
      ...baseExtrude.parameters,
      profiles: [{ source: 'expression', valueText: 'profileRef' }],
    },
  })
  assert(!referenceExpression.success, 'Runtime validation should reject expression wrappers on reference fields.')

  const advancedOptionExpression = featureDefinitionSchema.parse({
    kind: 'loft',
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      operationIntent: 'create',
      participants: [
        {
          role: 'profile',
          targets: [
            { kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' },
            { kind: 'region', sketchId: 'sketch_b', regionId: 'region_b' },
          ],
        },
      ],
      options: {
        sectionCount: { source: 'expression', valueText: 'sections + 1' },
      },
    },
  })
  assert(
    advancedOptionExpression.kind === 'loft' &&
      isExpressionAuthoredValue(advancedOptionExpression.parameters.options?.sectionCount) &&
      advancedOptionExpression.parameters.options.sectionCount.valueText === 'sections + 1',
    'Runtime validation should preserve expression-authored positive integer advanced options.',
  )

  const advancedReferenceExpression = featureDefinitionSchema.safeParse({
    kind: 'loft',
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      operationIntent: 'create',
      participants: [
        {
          role: 'profile',
          targets: [{ source: 'expression', valueText: 'profileRef' }],
        },
      ],
      options: { sectionCount: 2 },
    },
  })
  assert(!advancedReferenceExpression.success, 'Runtime validation should reject expression wrappers on advanced participant references.')
})
