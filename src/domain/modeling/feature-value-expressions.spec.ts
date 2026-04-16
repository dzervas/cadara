import { test } from 'bun:test'

import { createExpressionAuthoredValue, createLiteralAuthoredValue } from '@/contracts/modeling/authored-values'
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { resolveFeatureDefinitionValues } from '@/domain/modeling/feature-value-expressions'
import type { FeatureDefinition } from '@/contracts/modeling/schema'

test('src/domain/modeling/feature-value-expressions.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const extrude = (distance: unknown): FeatureDefinition => ({
    kind: 'extrude',
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      profiles: [{ kind: 'region', sketchId: 'sketch_profile', regionId: 'region_profile' }],
      startExtent: { kind: 'profilePlane' },
      endExtent: { kind: 'blind', direction: 'positive', distance: distance as never },
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    },
  })

  const literal = resolveFeatureDefinitionValues({
    definition: extrude(createLiteralAuthoredValue(12)),
    variables: [],
  })
  assert(literal.ok && literal.definition.parameters.endExtent.distance === 12, 'Literal authored values should resolve to concrete values.')

  const expression = createExpressionAuthoredValue('depth + 3')
  const resolved = resolveFeatureDefinitionValues({
    definition: extrude(expression),
    variables: [{ variableId: 'variable_depth', name: 'depth', valueText: '9' }],
  })
  assert(resolved.ok && resolved.definition.parameters.endExtent.distance === 12, 'Expression authored values should resolve from document variables.')
  assert(expression.valueText === 'depth + 3', 'Resolution must not rewrite the authored expression source.')

  const recomputed = resolveFeatureDefinitionValues({
    definition: extrude(expression),
    variables: [{ variableId: 'variable_depth', name: 'depth', valueText: '15' }],
  })
  assert(recomputed.ok && recomputed.definition.parameters.endExtent.distance === 18, 'Variable changes should recompute dependent feature values.')

  const invalidSyntax = resolveFeatureDefinitionValues({
    definition: extrude(createExpressionAuthoredValue('depth +')),
    variables: [{ variableId: 'variable_depth', name: 'depth', valueText: '9' }],
  })
  assert(!invalidSyntax.ok && invalidSyntax.diagnostics.some((diagnostic) => diagnostic.code === 'feature-value-expression-invalid-syntax'), 'Invalid expression syntax should reject before execution.')

  const invalidDomain = resolveFeatureDefinitionValues({
    definition: extrude(expression),
    variables: [{ variableId: 'variable_depth', name: 'depth', valueText: '-3' }],
  })
  assert(!invalidDomain.ok && invalidDomain.diagnostics.some((diagnostic) => diagnostic.code === 'feature-value-expression-not-positive'), 'Invalid dependent results should surface value-kind diagnostics.')
})
