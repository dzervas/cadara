import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { featureDefinitionSchema } from '@/contracts/modeling/runtime-schema'
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from '@/contracts/modeling/advanced-solid'
import { getAuthoredLiteralValue, isExpressionAuthoredValue } from '@/contracts/modeling/authored-values'
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'

test('src/contracts/modeling/authored-values.runtime-schema.spec.ts', () => {  const baseExtrude = {
    kind: 'extrude',
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      profiles: [{ kind: 'region', sketchId: 'sketch_profile', regionId: 'region_profile' }],
      startExtent: { kind: 'profilePlane' },
      extent: {
        mode: 'oneSide',
        end: { kind: 'blind', direction: 'positive', distance: 12 },
      },
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    },
  }

  const parsedExtrude = featureDefinitionSchema.parse(baseExtrude)
  expectTrue(
    parsedExtrude.kind === 'extrude' &&
      getAuthoredLiteralValue(parsedExtrude.parameters.extent.end.kind === 'blind' ? parsedExtrude.parameters.extent.end.distance : null) === 12,
    'Runtime validation should preserve literal authored wrappers on canonical extrude extents.',
  )

  const expression = featureDefinitionSchema.parse({
    ...baseExtrude,
    parameters: {
      ...baseExtrude.parameters,
      extent: {
        mode: 'oneSide',
        end: {
          kind: 'blind',
          direction: 'positive',
          distance: { source: 'expression', valueText: 'depth + 1' },
        },
      },
    },
  })
  expectTrue(
    expression.kind === 'extrude' &&
      expression.parameters.extent.end.kind === 'blind' &&
      isExpressionAuthoredValue(expression.parameters.extent.end.distance) &&
      expression.parameters.extent.end.distance.valueText === 'depth + 1',
    'Runtime validation should accept expression-authored wrappers on expression-capable fields.',
  )

  const invalidLiteral = featureDefinitionSchema.safeParse({
    ...baseExtrude,
    parameters: {
      ...baseExtrude.parameters,
      extent: {
        mode: 'oneSide',
        end: {
          kind: 'blind',
          direction: 'positive',
          distance: { source: 'literal', value: '12' },
        },
      },
    },
  })
  expectTrue(!invalidLiteral.success, 'Runtime validation should reject literal wrappers with the wrong value type.')

  const referenceExpression = featureDefinitionSchema.safeParse({
    ...baseExtrude,
    parameters: {
      ...baseExtrude.parameters,
      profiles: [{ source: 'expression', valueText: 'profileRef' }],
    },
  })
  expectTrue(!referenceExpression.success, 'Runtime validation should reject expression wrappers on reference fields.')

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
        path: {
          sectionCount: { source: 'expression', valueText: 'sections + 1' },
        },
      },
    },
  })
  expectTrue(
    advancedOptionExpression.kind === 'loft' &&
      !!advancedOptionExpression.parameters.options?.path &&
      typeof advancedOptionExpression.parameters.options.path === 'object' &&
      'sectionCount' in advancedOptionExpression.parameters.options.path &&
      isExpressionAuthoredValue(advancedOptionExpression.parameters.options.path.sectionCount) &&
      advancedOptionExpression.parameters.options.path.sectionCount.valueText === 'sections + 1',
    'Runtime validation should preserve expression-authored positive integer advanced options.',
  )

  const sweepAdvancedOptions = featureDefinitionSchema.parse({
    kind: 'sweep',
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      operationIntent: 'create',
      participants: [
        { role: 'profile', targets: [{ kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' }] },
        { role: 'path', targets: [{ kind: 'edge', bodyId: 'body_a', edgeId: 'edge_path' }] },
      ],
      options: {
        profileControl: 'lockProfileDirection',
        twist: { type: 'turns', turns: { source: 'literal', value: 1.5 } },
        endScale: { source: 'literal', value: 1.25 },
      },
    },
  })
  expectTrue(
    sweepAdvancedOptions.kind === 'sweep' &&
      sweepAdvancedOptions.parameters.options?.twist &&
      typeof sweepAdvancedOptions.parameters.options.twist === 'object' &&
      'type' in sweepAdvancedOptions.parameters.options.twist &&
      sweepAdvancedOptions.parameters.options.twist.type === 'turns' &&
      !('angle' in sweepAdvancedOptions.parameters.options.twist),
    'Runtime validation should preserve only the active sweep twist variant.',
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
      options: { path: { sectionCount: 2 } },
    },
  })
  expectTrue(!advancedReferenceExpression.success, 'Runtime validation should reject expression wrappers on advanced participant references.')
})
