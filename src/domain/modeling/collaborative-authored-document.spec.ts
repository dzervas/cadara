import { test } from 'bun:test'

import { createAuthoredModelDocumentFromSnapshot, type AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { FeatureDefinition } from '@/contracts/modeling/schema'
import { CONTRACT_VERSION, EXTRUDE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import {
  COLLABORATIVE_MERGE_DIAGNOSTIC_CODES,
  normalizeCollaborativeAuthoredModelDocument,
} from '@/domain/modeling/collaborative-authored-document'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/domain/modeling/collaborative-authored-document.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function createSeedDocument() {
    const snapshot = (await new MockKernelAdapter().getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot
    return createAuthoredModelDocumentFromSnapshot(snapshot)
  }

  function cloneExtrude(seed: AuthoredModelDocument, suffix: string): AuthoredModelDocument['features'][number] {
    const extrude = seed.features.find((feature) => feature.featureId === 'feature_extrude-1')
    assert(extrude, 'Seed extrude feature should exist.')
    return {
      featureId: `feature_extrude-${suffix}` as AuthoredModelDocument['features'][number]['featureId'],
      label: `Extrude ${suffix}`,
      definition: structuredClone(extrude.definition),
    }
  }

  const seed = await createSeedDocument()
  const concurrentInsertDocument: AuthoredModelDocument = {
    ...seed,
    features: [
      ...seed.features,
      cloneExtrude(seed, 'a'),
      cloneExtrude(seed, 'b'),
    ],
    featureOrder: ['feature_extrude-1'],
  }
  const concurrentInsert = normalizeCollaborativeAuthoredModelDocument(concurrentInsertDocument)
  const concurrentAIndex = concurrentInsert.document.featureOrder.indexOf('feature_extrude-a' as AuthoredModelDocument['featureOrder'][number])
  const concurrentBIndex = concurrentInsert.document.featureOrder.indexOf('feature_extrude-b' as AuthoredModelDocument['featureOrder'][number])
  assert(
    concurrentAIndex >= 0 && concurrentBIndex > concurrentAIndex,
    'Concurrent feature insertions missing from order should append deterministically by durable ID.',
  )

  const movedAndDeleted = normalizeCollaborativeAuthoredModelDocument({
    ...seed,
    featureOrder: ['feature_extrude-missing', ...seed.featureOrder] as AuthoredModelDocument['featureOrder'],
  })
  assert(
    !movedAndDeleted.document.featureOrder.includes('feature_extrude-missing' as AuthoredModelDocument['featureOrder'][number]),
    'Move/delete races should not keep order entries for missing features.',
  )
  assert(
    movedAndDeleted.diagnostics.some((diagnostic) => diagnostic.code === COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.invalidFeatureOrder),
    'Move/delete races should emit explicit feature-order diagnostics.',
  )

  const renameConflict = normalizeCollaborativeAuthoredModelDocument({
    ...concurrentInsertDocument,
    features: concurrentInsertDocument.features.map((feature) => ({ ...feature, label: 'Shared Label' })),
    featureOrder: concurrentInsert.document.featureOrder,
  })
  assert(
    renameConflict.diagnostics.some((diagnostic) => diagnostic.code === COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.concurrentLabelConflict),
    'Concurrent scalar label conflicts should be explicit diagnostics.',
  )

  const missingCursor = normalizeCollaborativeAuthoredModelDocument({
    ...seed,
    cursor: { kind: 'feature', featureId: 'feature_deleted' as AuthoredModelDocument['features'][number]['featureId'] },
  } as AuthoredModelDocument)
  assert(missingCursor.document.cursor.kind === 'empty', 'Missing cursor targets should normalize to an empty cursor.')
  assert(
    missingCursor.diagnostics.some((diagnostic) => diagnostic.code === COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.missingCursorTarget),
    'Missing cursor targets should emit stable merge diagnostics.',
  )

  const variableConflict = normalizeCollaborativeAuthoredModelDocument({
    ...seed,
    variables: [
      { variableId: 'variable_a', name: 'a', valueText: 'b + 1' },
      { variableId: 'variable_b', name: 'b', valueText: 'a + 1' },
    ],
  } as AuthoredModelDocument)
  assert(
    variableConflict.diagnostics.some((diagnostic) => diagnostic.code === COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.unresolvedVariableCycle),
    'Variable cycles introduced by merge should have stable diagnostics.',
  )

  const invalidReferenceDefinition: FeatureDefinition = {
    kind: 'extrude',
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      profiles: [{ kind: 'region', sketchId: 'sketch_deleted', regionId: 'region_deleted' }],
      startExtent: { kind: 'profilePlane' },
      endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    },
  }
  const invalidReference = normalizeCollaborativeAuthoredModelDocument({
    ...seed,
    features: [{ featureId: 'feature_invalid-ref', label: 'Invalid Ref', definition: invalidReferenceDefinition }],
    featureOrder: ['feature_invalid-ref'],
  } as AuthoredModelDocument)
  assert(
    invalidReference.document.features[0]?.featureId === 'feature_invalid-ref',
    'Merge diagnostics should not delete authored records to hide invalid references.',
  )
  assert(
    invalidReference.diagnostics.some((diagnostic) => diagnostic.code === COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.invalidDurableReference),
    'Invalid durable references caused by merge should be explicit diagnostics.',
  )
})
