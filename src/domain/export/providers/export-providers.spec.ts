import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
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

test('src/domain/export/providers/export-providers.spec.ts', async () => {  function testStlProviderMetadata() {
    expectTrue(stlExportProvider.id === 'stl', 'STL provider should have id stl.')
    expectTrue(stlExportProvider.formatId === 'stl', 'STL provider should have formatId stl.')
    expectTrue(stlExportProvider.fileExtension === 'stl', 'STL provider should have extension stl.')
    expectTrue(stlExportProvider.mimeType === 'model/stl', 'STL provider should advertise correct MIME type.')
  }

  function testStlProviderDefaultOptions() {
    const defaults = stlExportProvider.getDefaultOptions()
    expectTrue(defaults.encoding === 'binary', 'STL defaults to binary encoding.')
    expectTrue(defaults.meshAccuracy.chordTolerance > 0, 'STL default chord tolerance should be positive.')
    expectTrue(defaults.meshAccuracy.angleToleranceRadians > 0, 'STL default angle tolerance should be positive.')
  }

  function testStlProviderOptionForm() {
    const defaults = stlExportProvider.getDefaultOptions()
    const schema = stlExportProvider.getOptionFormSchema(defaults)
    const section = schema.sections[0]
    expectTrue(section !== undefined, 'STL schema should have at least one section.')
    expectTrue(section.title === 'Mesh accuracy', 'STL schema section should be titled "Mesh accuracy".')
    expectTrue(schema.sections.some((s) => s.fields.some((f) => f.kind === 'enum')), 'STL schema should have an encoding field.')
  }

  function testStlProviderApplyPatch() {
    const defaults = stlExportProvider.getDefaultOptions()
    const updated = stlExportProvider.applyOptionPatch(defaults, {
      'meshAccuracy.chordTolerance': 0.1,
      'encoding': 'ascii',
    })
    expectTrue(updated.meshAccuracy.chordTolerance === 0.1, 'Patch should update chord tolerance.')
    expectTrue(updated.encoding === 'ascii', 'Patch should update encoding.')
  }

  async function testStlExportSucceeds() {
    const capabilities = createMockCapabilities()
    const result = await stlExportProvider.export({
      target: MOCK_BODY_TARGET,
      targetLabel: 'Test Body',
      options: stlExportProvider.getDefaultOptions(),
      capabilities,
    })
    expectTrue(result.ok, 'STL export should succeed with a valid body target and triangles.')
    expectTrue(result.payload instanceof Uint8Array, 'STL binary export should return a Uint8Array payload.')
  }

  async function testStlExportAscii() {
    const capabilities = createMockCapabilities()
    const options = stlExportProvider.applyOptionPatch(stlExportProvider.getDefaultOptions(), { encoding: 'ascii' })
    const result = await stlExportProvider.export({
      target: MOCK_BODY_TARGET,
      targetLabel: 'Test Body',
      options,
      capabilities,
    })
    expectTrue(result.ok, 'ASCII STL export should succeed.')
    expectTrue(typeof result.payload === 'string', 'ASCII STL export should return a string payload.')
    expectTrue(result.payload.includes('solid cadara'), 'ASCII STL should start with solid cadara.')
  }

  async function testStlExportFailsOnCapabilityDiagnostic() {
    const diagnostic: ExportDiagnostic = {
      code: 'test-failure',
      severity: 'error',
      message: 'Test failure',
      target: MOCK_BODY_TARGET,
    }
    const capabilities = createMockCapabilities({ triangles: diagnostic })
    const result = await stlExportProvider.export({
      target: MOCK_BODY_TARGET,
      targetLabel: 'Test Body',
      options: stlExportProvider.getDefaultOptions(),
      capabilities,
    })
    expectTrue(!result.ok, 'STL export should fail when capabilities return a diagnostic.')
    expectTrue(result.diagnostics[0]?.code === 'test-failure', 'Diagnostic code should be propagated.')
  }

  function testStepProviderMetadata() {
    expectTrue(stepExportProvider.id === 'step', 'STEP provider should have id step.')
    expectTrue(stepExportProvider.formatId === 'step', 'STEP provider should have formatId step.')
    expectTrue(stepExportProvider.fileExtension === 'step', 'STEP provider should have extension step.')
    expectTrue(stepExportProvider.mimeType === 'model/step', 'STEP provider should advertise correct MIME type.')
  }

  function testStepProviderDefaultOptions() {
    const defaults = stepExportProvider.getDefaultOptions()
    expectTrue(defaults.schema === 'AP242', 'STEP defaults to AP242 schema.')
    expectTrue(defaults.unit === 'millimeter', 'STEP defaults to millimeter units.')
  }

  function testStepProviderOptionForm() {
    const defaults = stepExportProvider.getDefaultOptions()
    const schema = stepExportProvider.getOptionFormSchema(defaults)
    const section = schema.sections[0]
    expectTrue(section !== undefined, 'STEP schema should have at least one section.')
    expectTrue(section.title === 'STEP options', 'STEP schema section should be titled "STEP options".')
  }

  async function testStepExportSucceeds() {
    const capabilities = createMockCapabilities({ stepPayload: 'ISO-10303 STEP data' })
    const result = await stepExportProvider.export({
      target: MOCK_BODY_TARGET,
      targetLabel: 'Test Body',
      options: stepExportProvider.getDefaultOptions(),
      capabilities,
    })
    expectTrue(result.ok, 'STEP export should succeed.')
    expectTrue(typeof result.payload === 'string', 'STEP export should return a string payload.')
    expectTrue(result.payload.includes('ISO-10303'), 'STEP export payload should match what capabilities returned.')
  }

  function testThreeMfProviderMetadata() {
    expectTrue(threeMfExportProvider.id === '3mf', '3MF provider should have id 3mf.')
    expectTrue(threeMfExportProvider.formatId === '3mf', '3MF provider should have formatId 3mf.')
    expectTrue(threeMfExportProvider.fileExtension === '3mf', '3MF provider should have extension 3mf.')
    expectTrue(threeMfExportProvider.mimeType === 'model/3mf', '3MF provider should advertise correct MIME type.')
  }

  function testThreeMfProviderDefaultOptions() {
    const defaults = threeMfExportProvider.getDefaultOptions()
    expectTrue(defaults.unit === 'millimeter', '3MF defaults to millimeter units.')
    expectTrue(defaults.includeMetadata === true, '3MF defaults to including metadata.')
  }

  function testThreeMfProviderOptionForm() {
    const defaults = threeMfExportProvider.getDefaultOptions()
    const schema = threeMfExportProvider.getOptionFormSchema(defaults)
    const section = schema.sections[0]
    expectTrue(section !== undefined, '3MF schema should have at least one section.')
    expectTrue(section.title === 'Mesh accuracy', '3MF schema section should be titled "Mesh accuracy".')
    const hasCheckbox = section.fields.some((f) => f.kind === 'custom' && f.rendererId === 'checkbox')
    expectTrue(hasCheckbox, '3MF schema should have a checkbox field for includeMetadata.')
  }

  async function testThreeMfExportSucceeds() {
    const capabilities = createMockCapabilities()
    const result = await threeMfExportProvider.export({
      target: MOCK_BODY_TARGET,
      targetLabel: 'Test Body',
      options: threeMfExportProvider.getDefaultOptions(),
      capabilities,
    })
    expectTrue(result.ok, '3MF export should succeed with a valid body target and triangles.')
    expectTrue(result.payload instanceof Uint8Array, '3MF export should return a Uint8Array (ZIP) payload.')
  }

  testStlProviderMetadata()
  testStlProviderDefaultOptions()
  testStlProviderOptionForm()
  testStlProviderApplyPatch()
  await testStlExportSucceeds()
  await testStlExportAscii()
  await testStlExportFailsOnCapabilityDiagnostic()
  testStepProviderMetadata()
  testStepProviderDefaultOptions()
  testStepProviderOptionForm()
  await testStepExportSucceeds()
  testThreeMfProviderMetadata()
  testThreeMfProviderDefaultOptions()
  testThreeMfProviderOptionForm()
  await testThreeMfExportSucceeds()
})
