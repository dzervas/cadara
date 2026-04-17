import { test } from 'bun:test'

import { getDefaultDocumentExportOptions } from '@/contracts/modeling/export.runtime-schema'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import { createModelingService } from '@/domain/modeling/modeling-service'

test('src/domain/modeling/modeling-export.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function testCadaraExportsDurableDocumentJson() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
    })
    const snapshot = await service.getCurrentDocumentSnapshot()

    const result = await service.exportDocument({
      baseRevisionId: snapshot.revisionId,
      target: { kind: 'body', bodyId: 'body_part-1' },
      targetLabel: 'Part 1',
      format: 'cadara',
      options: getDefaultDocumentExportOptions('cadara'),
    })

    assert(result.ok, 'cadara export should succeed for the current document revision.')
    assert(result.filename === 'part-1.cadara', 'cadara export should use the selected row label for the filename.')
    assert(result.mimeType === 'application/vnd.cadara+json', 'cadara export should advertise a JSON MIME type.')
    assert(typeof result.payload === 'string', 'cadara export should return text JSON.')

    const payload = JSON.parse(result.payload) as Record<string, unknown>
    assert(payload.contractVersion === snapshot.document.contractVersion, 'cadara export should preserve contract version.')
    assert(payload.schemaVersion === snapshot.document.schemaVersion, 'cadara export should preserve schema version.')
    assert(!('presentation' in payload), 'cadara export should not include presentation-only workspace state.')
  }

  async function testGeometryExportPayloadMetadata() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
    })
    const snapshot = await service.getCurrentDocumentSnapshot()

    const result = await service.exportDocument({
      baseRevisionId: snapshot.revisionId,
      target: { kind: 'body', bodyId: 'body_part-1' },
      targetLabel: 'Part 1',
      format: 'step',
      options: getDefaultDocumentExportOptions('step'),
    })

    assert(result.ok, 'Mock STEP export should succeed for a body target.')
    assert(result.filename === 'part-1.step', 'Geometry export should include the returned filename.')
    assert(result.extension === 'step', 'Geometry export should include the returned extension.')
    assert(result.mimeType === 'model/step', 'Geometry export should include the returned MIME type.')
    assert(typeof result.payload === 'string', 'Mock STEP export should return a text payload.')
    assert(result.payload.includes('cadara mock step export'), 'Mock geometry export should identify the format.')
  }

  async function testUnexportableGeometryTargetReportsDiagnostic() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
    })
    const snapshot = await service.getCurrentDocumentSnapshot()

    const result = await service.exportDocument({
      baseRevisionId: snapshot.revisionId,
      target: { kind: 'sketch', sketchId: 'sketch_primary' },
      targetLabel: 'Sketch 1',
      format: 'stl',
      options: getDefaultDocumentExportOptions('stl'),
    })

    assert(!result.ok, 'Geometry export should reject non-body targets.')
    assert(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'mock-export-unexportable-target'),
      'Unexportable targets should report a structured diagnostic.',
    )
  }

  await testCadaraExportsDurableDocumentJson()
  await testGeometryExportPayloadMetadata()
  await testUnexportableGeometryTargetReportsDiagnostic()
})
