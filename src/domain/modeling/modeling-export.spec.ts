import { test } from 'bun:test'

import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import { getDefaultCadaraExportOptions } from '@/contracts/modeling/export.runtime-schema'
import { AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { createMemoryDocumentRepository } from '@/domain/modeling/memory-document-repository'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import { createModelingService } from '@/domain/modeling/modeling-service'
import { createBuiltinExportProviderRegistry } from '@/domain/export/builtin-provider-composition'
import { stepExportProvider } from '@/domain/export/providers/step-export-provider'
import { stlExportProvider } from '@/domain/export/providers/stl-export-provider'

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
      baseRevisionId: snapshot.document.revisionId,
      target: { kind: 'body', bodyId: 'body_part-1' },
      targetLabel: 'Part 1',
      format: 'cadara',
      options: getDefaultCadaraExportOptions(),
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
      exportProviders: createBuiltinExportProviderRegistry(),
    })
    const snapshot = await service.getCurrentDocumentSnapshot()

    const result = await service.exportDocument({
      baseRevisionId: snapshot.document.revisionId,
      target: { kind: 'body', bodyId: 'body_part-1' },
      targetLabel: 'Part 1',
      format: 'step',
      options: stepExportProvider.getDefaultOptions(),
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
      exportProviders: createBuiltinExportProviderRegistry(),
    })
    const snapshot = await service.getCurrentDocumentSnapshot()

    const result = await service.exportDocument({
      baseRevisionId: snapshot.document.revisionId,
      target: { kind: 'sketch', sketchId: 'sketch_primary' },
      targetLabel: 'Sketch 1',
      format: 'stl',
      options: stlExportProvider.getDefaultOptions(),
    })

    assert(!result.ok, 'Geometry export should reject non-body targets.')
    assert(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'mock-export-unexportable-target'),
      'Unexportable targets should report a structured diagnostic.',
    )
  }

  async function testFileMenuExportImportsAuthoredDocumentJson() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository: createMemoryDocumentRepository(),
    })
    const exportResult = await service.exportCurrentDocument()

    assert(exportResult.filename === 'document.cadara', 'Current document export should use a document-level cadara filename.')
    assert(exportResult.mimeType === 'application/vnd.cadara+json', 'Current document export should use the cadara JSON MIME type.')
    assert(typeof exportResult.payload === 'string', 'Current document export should return authored JSON text.')

    const exported = JSON.parse(exportResult.payload) as AuthoredModelDocument
    assert(
      exported.schemaVersion === AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
      'Current document export should use the authored document schema.',
    )
    assert(!('presentation' in exported), 'Current document export should exclude presentation-only state.')

    const importedDocument: AuthoredModelDocument = {
      ...exported,
      bodyLabels: exported.bodyLabels.map((label) => ({
        ...label,
        label: 'Imported Body',
      })),
    }
    const importResult = await service.importDocument({ document: importedDocument })
    assert(importResult.ok, 'Valid authored document import should succeed.')

    const snapshot = await service.getCurrentDocumentSnapshot()
    assert(
      snapshot.document.bodies.some((body) => body.label === 'Imported Body'),
      'Imported authored body labels should appear in the refreshed snapshot.',
    )

    const newResult = await service.createNewDocument()
    assert(newResult.ok, 'New document reset should restore the seeded authored document.')
    const resetSnapshot = await service.getCurrentDocumentSnapshot()
    assert(
      resetSnapshot.document.bodies.every((body) => body.label !== 'Imported Body'),
      'New document reset should remove imported authored body labels.',
    )
  }

  async function testFileMenuImportRejectsInvalidDocumentJson() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
    })

    const result = await service.importDocument({
      document: {
        contractVersion: 'modeling-contract/v1alpha1',
        schemaVersion: 'authored-model-document/v999',
      },
    })

    assert(!result.ok, 'Invalid authored document import should be rejected.')
    assert(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'document-import-unsupported-schema-version'),
      'Invalid import should report a structured schema diagnostic.',
    )
  }

  async function testGeometryExportRequiresExplicitComposition() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
    })
    const snapshot = await service.getCurrentDocumentSnapshot()

    const result = await service.exportDocument({
      baseRevisionId: snapshot.document.revisionId,
      target: { kind: 'body', bodyId: 'body_part-1' },
      targetLabel: 'Part 1',
      format: 'step',
      options: stepExportProvider.getDefaultOptions(),
    })

    assert(!result.ok, 'Geometry export without an explicit export-provider composition should fail.')
    assert(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'export-unsupported-format'),
      'Missing explicit export-provider composition should surface an unsupported-format diagnostic.',
    )
  }

  await testCadaraExportsDurableDocumentJson()
  await testGeometryExportPayloadMetadata()
  await testUnexportableGeometryTargetReportsDiagnostic()
  await testFileMenuExportImportsAuthoredDocumentJson()
  await testFileMenuImportRejectsInvalidDocumentJson()
  await testGeometryExportRequiresExplicitComposition()
})
