import { test } from 'bun:test'

import {
  documentExportRequestSchema,
  getDefaultCadaraExportOptions,
} from '@/contracts/modeling/export.runtime-schema'
import { stlExportProvider } from '@/domain/export/providers/stl-export-provider'
import { stepExportProvider } from '@/domain/export/providers/step-export-provider'
import { threeMfExportProvider } from '@/domain/export/providers/threemf-export-provider'

test('src/contracts/modeling/export.runtime-schema.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const stlDefaults = stlExportProvider.getDefaultOptions()
  const threeMfDefaults = threeMfExportProvider.getDefaultOptions()
  const stepDefaults = stepExportProvider.getDefaultOptions()
  const cadaraDefaults = getDefaultCadaraExportOptions()

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

  assert(parsedStep.format === 'step', 'Export request parsing should preserve the format.')
})
