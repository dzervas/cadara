import { test } from 'bun:test'

import type { ExportCapabilities, MeshExportAccuracy, MeshTriangle, StepWriterOptions } from '@/contracts/export/capabilities'
import type { DocumentExportDiagnostic as ExportDiagnostic } from '@/contracts/modeling/export'
import type { DurableRef } from '@/contracts/shared/references'
import { stlExportProvider } from '@/domain/export/providers/stl-export-provider'
import { stepExportProvider } from '@/domain/export/providers/step-export-provider'
import { threeMfExportProvider } from '@/domain/export/providers/threemf-export-provider'

const MOCK_BODY_TARGET: DurableRef = { kind: 'body', bodyId: 'body_test' }

const MOCK_TRIANGLE: MeshTriangle = {
  normal: [0, 0, 1],
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
}

function createMockCapabilities(options: {
  triangles?: MeshTriangle[] | ExportDiagnostic
  stepPayload?: string | ExportDiagnostic
} = {}): ExportCapabilities {
  const triangles = options.triangles ?? [MOCK_TRIANGLE]
  const stepPayload = options.stepPayload ?? 'mock step payload'

  return {
    mesh: {
      tessellate(_unusedTarget: DurableRef, _unusedAccuracy: MeshExportAccuracy): MeshTriangle[] | ExportDiagnostic {
        return triangles
      },
    },
    brep: {
      writeStep(_unusedTarget: DurableRef, _unusedOptions: StepWriterOptions): { payload: string } | { diagnostic: ExportDiagnostic } {
        if (typeof stepPayload === 'string') {
          return { payload: stepPayload }
        }
        return { diagnostic: stepPayload }
      },
    },
  }
}

test('src/domain/export/providers/export-providers.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function testStlProviderMetadata() {
    assert(stlExportProvider.id === 'stl', 'STL provider should have id stl.')
    assert(stlExportProvider.formatId === 'stl', 'STL provider should have formatId stl.')
    assert(stlExportProvider.fileExtension === 'stl', 'STL provider should have extension stl.')
    assert(stlExportProvider.mimeType === 'model/stl', 'STL provider should advertise correct MIME type.')
  }

  function testStlProviderDefaultOptions() {
    const defaults = stlExportProvider.getDefaultOptions()
    assert(defaults.encoding === 'binary', 'STL defaults to binary encoding.')
    assert(defaults.meshAccuracy.chordTolerance > 0, 'STL default chord tolerance should be positive.')
    assert(defaults.meshAccuracy.angleToleranceRadians > 0, 'STL default angle tolerance should be positive.')
  }

  function testStlProviderOptionForm() {
    const defaults = stlExportProvider.getDefaultOptions()
    const schema = stlExportProvider.getOptionFormSchema(defaults)
    const section = schema.sections[0]
    assert(section !== undefined, 'STL schema should have at least one section.')
    assert(section.title === 'Mesh accuracy', 'STL schema section should be titled "Mesh accuracy".')
    assert(schema.sections.some((s) => s.fields.some((f) => f.kind === 'enum')), 'STL schema should have an encoding field.')
  }

  function testStlProviderApplyPatch() {
    const defaults = stlExportProvider.getDefaultOptions()
    const updated = stlExportProvider.applyOptionPatch(defaults, {
      'meshAccuracy.chordTolerance': 0.1,
      'encoding': 'ascii',
    })
    assert(updated.meshAccuracy.chordTolerance === 0.1, 'Patch should update chord tolerance.')
    assert(updated.encoding === 'ascii', 'Patch should update encoding.')
  }

  function testStlExportSucceeds() {
    const capabilities = createMockCapabilities()
    const result = stlExportProvider.export({
      target: MOCK_BODY_TARGET,
      targetLabel: 'Test Body',
      options: stlExportProvider.getDefaultOptions(),
      capabilities,
    })
    assert(result.ok, 'STL export should succeed with a valid body target and triangles.')
    assert(result.payload instanceof Uint8Array, 'STL binary export should return a Uint8Array payload.')
  }

  function testStlExportAscii() {
    const capabilities = createMockCapabilities()
    const options = stlExportProvider.applyOptionPatch(stlExportProvider.getDefaultOptions(), { encoding: 'ascii' })
    const result = stlExportProvider.export({
      target: MOCK_BODY_TARGET,
      targetLabel: 'Test Body',
      options,
      capabilities,
    })
    assert(result.ok, 'ASCII STL export should succeed.')
    assert(typeof result.payload === 'string', 'ASCII STL export should return a string payload.')
    assert(result.payload.includes('solid cadara'), 'ASCII STL should start with solid cadara.')
  }

  function testStlExportFailsOnCapabilityDiagnostic() {
    const diagnostic: ExportDiagnostic = {
      code: 'test-failure',
      severity: 'error',
      message: 'Test failure',
      target: MOCK_BODY_TARGET,
    }
    const capabilities = createMockCapabilities({ triangles: diagnostic })
    const result = stlExportProvider.export({
      target: MOCK_BODY_TARGET,
      targetLabel: 'Test Body',
      options: stlExportProvider.getDefaultOptions(),
      capabilities,
    })
    assert(!result.ok, 'STL export should fail when capabilities return a diagnostic.')
    assert(result.diagnostics[0]?.code === 'test-failure', 'Diagnostic code should be propagated.')
  }

  function testStepProviderMetadata() {
    assert(stepExportProvider.id === 'step', 'STEP provider should have id step.')
    assert(stepExportProvider.formatId === 'step', 'STEP provider should have formatId step.')
    assert(stepExportProvider.fileExtension === 'step', 'STEP provider should have extension step.')
    assert(stepExportProvider.mimeType === 'model/step', 'STEP provider should advertise correct MIME type.')
  }

  function testStepProviderDefaultOptions() {
    const defaults = stepExportProvider.getDefaultOptions()
    assert(defaults.schema === 'AP242', 'STEP defaults to AP242 schema.')
    assert(defaults.unit === 'millimeter', 'STEP defaults to millimeter units.')
  }

  function testStepProviderOptionForm() {
    const defaults = stepExportProvider.getDefaultOptions()
    const schema = stepExportProvider.getOptionFormSchema(defaults)
    const section = schema.sections[0]
    assert(section !== undefined, 'STEP schema should have at least one section.')
    assert(section.title === 'STEP options', 'STEP schema section should be titled "STEP options".')
  }

  function testStepExportSucceeds() {
    const capabilities = createMockCapabilities({ stepPayload: 'ISO-10303 STEP data' })
    const result = stepExportProvider.export({
      target: MOCK_BODY_TARGET,
      targetLabel: 'Test Body',
      options: stepExportProvider.getDefaultOptions(),
      capabilities,
    })
    assert(result.ok, 'STEP export should succeed.')
    assert(typeof result.payload === 'string', 'STEP export should return a string payload.')
    assert(result.payload.includes('ISO-10303'), 'STEP export payload should match what capabilities returned.')
  }

  function testThreeMfProviderMetadata() {
    assert(threeMfExportProvider.id === '3mf', '3MF provider should have id 3mf.')
    assert(threeMfExportProvider.formatId === '3mf', '3MF provider should have formatId 3mf.')
    assert(threeMfExportProvider.fileExtension === '3mf', '3MF provider should have extension 3mf.')
    assert(threeMfExportProvider.mimeType === 'model/3mf', '3MF provider should advertise correct MIME type.')
  }

  function testThreeMfProviderDefaultOptions() {
    const defaults = threeMfExportProvider.getDefaultOptions()
    assert(defaults.unit === 'millimeter', '3MF defaults to millimeter units.')
    assert(defaults.includeMetadata === true, '3MF defaults to including metadata.')
  }

  function testThreeMfProviderOptionForm() {
    const defaults = threeMfExportProvider.getDefaultOptions()
    const schema = threeMfExportProvider.getOptionFormSchema(defaults)
    const section = schema.sections[0]
    assert(section !== undefined, '3MF schema should have at least one section.')
    assert(section.title === 'Mesh accuracy', '3MF schema section should be titled "Mesh accuracy".')
    const hasCheckbox = section.fields.some((f) => f.kind === 'custom' && f.rendererId === 'checkbox')
    assert(hasCheckbox, '3MF schema should have a checkbox field for includeMetadata.')
  }

  function testThreeMfExportSucceeds() {
    const capabilities = createMockCapabilities()
    const result = threeMfExportProvider.export({
      target: MOCK_BODY_TARGET,
      targetLabel: 'Test Body',
      options: threeMfExportProvider.getDefaultOptions(),
      capabilities,
    })
    assert(result.ok, '3MF export should succeed with a valid body target and triangles.')
    assert(result.payload instanceof Uint8Array, '3MF export should return a Uint8Array (ZIP) payload.')
  }

  testStlProviderMetadata()
  testStlProviderDefaultOptions()
  testStlProviderOptionForm()
  testStlProviderApplyPatch()
  testStlExportSucceeds()
  testStlExportAscii()
  testStlExportFailsOnCapabilityDiagnostic()
  testStepProviderMetadata()
  testStepProviderDefaultOptions()
  testStepProviderOptionForm()
  testStepExportSucceeds()
  testThreeMfProviderMetadata()
  testThreeMfProviderDefaultOptions()
  testThreeMfProviderOptionForm()
  testThreeMfExportSucceeds()
})
