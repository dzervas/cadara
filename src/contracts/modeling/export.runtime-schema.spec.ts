import { test } from 'bun:test'

import {
  documentExportRequestSchema,
  getDefaultDocumentExportOptions,
} from '@/contracts/modeling/export.runtime-schema'

test('src/contracts/modeling/export.runtime-schema.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const stlDefaults = getDefaultDocumentExportOptions('stl')
  const threeMfDefaults = getDefaultDocumentExportOptions('3mf')
  const stepDefaults = getDefaultDocumentExportOptions('step')
  const cadaraDefaults = getDefaultDocumentExportOptions('cadara')

  assert(stlDefaults.encoding === 'binary', 'STL export should default to binary encoding.')
  assert(stlDefaults.meshAccuracy.chordTolerance > 0, 'STL defaults should include positive mesh tolerance.')
  assert(threeMfDefaults.includeMetadata, '3MF export should include metadata by default.')
  assert(
    threeMfDefaults.meshAccuracy.angleToleranceRadians === stlDefaults.meshAccuracy.angleToleranceRadians,
    '3MF and STL should share the mesh accuracy default.',
  )
  assert(stepDefaults.schema === 'AP242', 'STEP export should default to AP242.')
  assert(cadaraDefaults.pretty, 'cadara export should default to readable JSON.')

  const parsedStep = documentExportRequestSchema.parse({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_0001',
    target: { kind: 'body', bodyId: 'body_part-1' },
    targetLabel: 'Part 1',
    format: 'step',
    options: stepDefaults,
  })

  assert(parsedStep.format === 'step', 'Export request parsing should discriminate by file type.')
  assert(parsedStep.options.schema === 'AP242', 'Parsed STEP options should preserve STEP-specific fields.')

  const invalidStep = documentExportRequestSchema.safeParse({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_0001',
    target: { kind: 'body', bodyId: 'body_part-1' },
    targetLabel: 'Part 1',
    format: 'step',
    options: {
      ...stepDefaults,
      meshAccuracy: stlDefaults.meshAccuracy,
    },
  })

  assert(!invalidStep.success, 'STEP export options should reject mesh accuracy fields.')

  const invalidStl = documentExportRequestSchema.safeParse({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_0001',
    target: { kind: 'body', bodyId: 'body_part-1' },
    targetLabel: 'Part 1',
    format: 'stl',
    options: {
      ...stlDefaults,
      meshAccuracy: {
        ...stlDefaults.meshAccuracy,
        chordTolerance: 0,
      },
    },
  })

  assert(!invalidStl.success, 'Mesh export options should reject non-positive tolerances.')
})
