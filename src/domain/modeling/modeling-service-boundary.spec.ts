import { test } from 'bun:test'

import type {
  AddDocumentVariableResponse,
  CreateFeatureResponse,
} from '@/contracts/modeling/schema'
import { createModelingService } from '@/domain/modeling/modeling-service'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/domain/modeling/modeling-service-boundary.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  class MalformedDualSchemaResponseAdapter extends MockKernelAdapter {
    override async createFeature(): Promise<CreateFeatureResponse> {
      return {
        contractVersion: 'modeling-contract/v1alpha1',
        documentId: 'doc_workspace',
        revisionId: 'rev_0001',
        revisionState: { kind: 'accepted', baseRevisionId: 'rev_0001' },
        rebuildResult: { kind: 'succeeded', invalidatedTargets: [], diagnostics: [] },
        changedTargets: [],
        diagnostics: [],
      } as unknown as CreateFeatureResponse
    }

    override async addDocumentVariable(): Promise<AddDocumentVariableResponse> {
      return {
        contractVersion: 'modeling-contract/v1alpha1',
        documentId: 'doc_workspace',
        revisionId: 'rev_0001',
        revisionState: { kind: 'accepted', baseRevisionId: 'rev_0001' },
        rebuildResult: { kind: 'succeeded', invalidatedTargets: [], diagnostics: [] },
        changedTargets: [],
        diagnostics: [],
      } as unknown as AddDocumentVariableResponse
    }
  }

  const service = createModelingService(new MalformedDualSchemaResponseAdapter(), {
    currentDocumentId: 'doc_workspace',
  })
  const snapshot = await service.getCurrentDocumentSnapshot()
  const seedFeature = snapshot.features.find((feature) => feature.definition.kind === 'extrude')
  assert(seedFeature?.definition.kind === 'extrude', 'Seed extrude feature must exist.')

  const featureResult = await service.createFeature({
    baseRevisionId: snapshot.revisionId,
    definition: seedFeature.definition,
  })

  assert(featureResult.isErr(), 'Malformed feature mutation responses should return a boundary error.')
  assert(featureResult.error.message.includes('CreateFeatureResponse'), 'Feature response errors should name the first schema.')
  assert(featureResult.error.message.includes('UpdateFeatureResponse'), 'Feature response errors should name the fallback schema.')
  assert(featureResult.error.message.includes('featureId'), 'Feature response errors should include actionable schema issue paths.')

  const variableResult = await service.addDocumentVariable({
    baseRevisionId: snapshot.revisionId,
    variableId: 'variable_width',
    name: 'width',
    valueText: '10',
  })

  assert(variableResult.isErr(), 'Malformed document variable mutation responses should return a boundary error.')
  assert(variableResult.error.message.includes('AddDocumentVariableResponse'), 'Variable response errors should name the first schema.')
  assert(variableResult.error.message.includes('UpdateDocumentVariableResponse'), 'Variable response errors should name the fallback schema.')
  assert(variableResult.error.message.includes('variableId'), 'Variable response errors should include actionable schema issue paths.')
})
