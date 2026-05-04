import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { ExportCapabilities, MeshExportAccuracy, MeshTriangle, StepWriterOptions } from '@/contracts/export/capabilities'
import type { SketchVectorExportModel } from '@/contracts/export/sketch-vector'
import type { DocumentExportDiagnostic as ExportDiagnostic } from '@/contracts/modeling/export'
import type { DurableRef } from '@/contracts/shared/references'
import { dxfSketchExportProvider } from '@/domain/export/providers/dxf-sketch-export-provider'
import { svgSketchExportProvider } from '@/domain/export/providers/svg-sketch-export-provider'
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
  sketchModel?: SketchVectorExportModel | ExportDiagnostic
} = {}): ExportCapabilities {
  const triangles = options.triangles ?? [MOCK_TRIANGLE]
  const stepPayload = options.stepPayload ?? 'mock step payload'
  const sketchModel = options.sketchModel ?? createMockSketchModel()

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
    sketchVector: {
      resolveSketchVectorModel(_unusedTarget: DurableRef): SketchVectorExportModel | { diagnostic: ExportDiagnostic } {
        if ('code' in sketchModel) {
          return { diagnostic: sketchModel }
        }
        return sketchModel
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

  async function testSvgSketchExportPreservesStyles() {
    const capabilities = createMockCapabilities()
    const result = await svgSketchExportProvider.export({
      target: { kind: 'sketch', sketchId: 'sketch_export' },
      targetLabel: 'Styled Sketch',
      options: svgSketchExportProvider.getDefaultOptions(),
      capabilities,
    })

    expectTrue(result.ok, 'SVG sketch export should succeed with a sketch vector model.')
    expectTrue(typeof result.payload === 'string', 'SVG sketch export should return text payload.')
    expectTrue(result.payload.includes('<svg'), 'SVG sketch export should include an SVG root.')
    expectTrue(result.payload.includes('viewBox='), 'SVG sketch export should include a viewBox.')
    expectTrue(result.payload.includes('stroke="#ff3366"'), 'SVG sketch export should serialize authored stroke color.')
    expectTrue(result.payload.includes('stroke-width="2"'), 'SVG sketch export should serialize authored stroke width.')
    expectTrue(result.payload.includes('vector-effect="non-scaling-stroke"'), 'SVG sketch export should preserve authored stroke width as display pixels instead of model units.')
    expectTrue(result.payload.includes('fill="url(#cadara-gradient-1)"'), 'SVG sketch export should serialize gradient region fills.')
    expectTrue(result.payload.includes('stop-color="#2266ff"'), 'SVG sketch export should include gradient definitions.')
  }

  async function testSvgSketchExportNormalizesBoundsAndDefaultStroke() {
    const capabilities = createMockCapabilities({ sketchModel: createOffsetUnstyledSketchModel() })
    const result = await svgSketchExportProvider.export({
      target: { kind: 'sketch', sketchId: 'sketch_export' },
      targetLabel: 'Unstyled Sketch',
      options: svgSketchExportProvider.getDefaultOptions(),
      capabilities,
    })

    expectTrue(result.ok, 'SVG sketch export should succeed for an unstyled offset sketch.')
    expectTrue(typeof result.payload === 'string', 'SVG sketch export should return text payload.')
    expectTrue(
      result.payload.includes('width="5.187448mm" height="9.482872mm" viewBox="0 0 5.187448 9.482872"'),
      'SVG sketch export should normalize geometry bounds without padding or source-coordinate offsets.',
    )
    expectTrue(
      result.payload.includes('d="M 0 0 L 5.187448 0"'),
      'SVG sketch export should translate entity coordinates into the normalized SVG viewBox.',
    )
    expectTrue(
      result.payload.includes('stroke="black" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"'),
      'Unstyled SVG sketch export should use a non-scaling default stroke so small sketches do not render with huge model-unit strokes.',
    )
  }

  async function testDxfSketchExportProducesEntitiesAndDiagnostics() {
    const capabilities = createMockCapabilities()
    const result = await dxfSketchExportProvider.export({
      target: { kind: 'sketch', sketchId: 'sketch_export' },
      targetLabel: 'Styled Sketch',
      options: dxfSketchExportProvider.getDefaultOptions(),
      capabilities,
    })

    expectTrue(result.ok, 'DXF sketch export should succeed with supported geometry even when diagnostics are present.')
    expectTrue(typeof result.payload === 'string', 'DXF sketch export should return text payload.')
    expectTrue(result.payload.includes('SECTION\n2\nENTITIES'), 'DXF sketch export should include the ENTITIES section.')
    expectTrue(result.payload.includes('LINE'), 'DXF sketch export should include line entities.')
    expectTrue(result.diagnostics.some((diagnostic) => diagnostic.code === 'sketch-vector-unsupported-entity'), 'DXF sketch export should preserve unsupported geometry diagnostics.')
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
  await testSvgSketchExportPreservesStyles()
  await testSvgSketchExportNormalizesBoundsAndDefaultStroke()
  await testDxfSketchExportProducesEntitiesAndDiagnostics()
})

function createMockSketchModel(): SketchVectorExportModel {
  return {
    documentId: 'doc_export',
    revisionId: 'rev_0001',
    sketchId: 'sketch_export',
    label: 'Styled Sketch',
    units: 'millimeter',
    points: new Map([
      ['point_a', [0, 0]],
      ['point_b', [10, 0]],
      ['point_c', [10, 8]],
      ['point_d', [0, 8]],
    ]),
    entities: [
      {
        kind: 'lineSegment',
        entityId: 'entity_ab',
        label: 'AB',
        start: [0, 0],
        end: [10, 0],
        isConstruction: false,
        style: {
          fill: { kind: 'none' },
          stroke: {
            color: '#ff3366',
            opacity: 0.8,
            width: 2,
            lineCap: 'round',
            lineJoin: 'round',
            miterLimit: 4,
          },
        },
      },
      {
        kind: 'lineSegment',
        entityId: 'entity_bc',
        label: 'BC',
        start: [10, 0],
        end: [10, 8],
        isConstruction: false,
        style: null,
      },
      {
        kind: 'circle',
        entityId: 'entity_circle',
        label: 'Circle',
        center: [5, 4],
        radius: 2,
        isConstruction: false,
        style: null,
      },
    ],
    regions: [{
      regionId: 'region_square',
      label: 'Square',
      loops: [{
        role: 'outer',
        isClosed: true,
        boundaryPointIds: ['point_a', 'point_b', 'point_c', 'point_d'],
        segments: [
          { entityId: 'entity_ab', traversalDirection: 'forward' },
          { entityId: 'entity_bc', traversalDirection: 'forward' },
        ],
      }],
      style: {
        fill: {
          kind: 'gradient',
          gradient: {
            kind: 'linear',
            angleRadians: 0,
            startColor: '#2266ff',
            startOpacity: 0.25,
            endColor: '#ffcc33',
            endOpacity: 0.75,
          },
        },
        stroke: null,
      },
    }],
    diagnostics: [{
      code: 'sketch-vector-unsupported-entity',
      severity: 'warning',
      message: 'Unsupported entity was skipped.',
      target: { kind: 'sketch', sketchId: 'sketch_export' },
    }],
  }
}

function createOffsetUnstyledSketchModel(): SketchVectorExportModel {
  return {
    documentId: 'doc_export',
    revisionId: 'rev_0001',
    sketchId: 'sketch_export',
    label: 'Unstyled Sketch',
    units: 'millimeter',
    points: new Map([
      ['point_a', [11.837349689681922, -3.5042547517455396]],
      ['point_b', [17.024798172032582, -3.5042547517455396]],
      ['point_c', [17.024798172032582, 5.978617145073699]],
      ['point_d', [11.837349689681922, 5.978617145073699]],
    ]),
    entities: [
      {
        kind: 'lineSegment',
        entityId: 'entity_ab',
        label: 'AB',
        start: [11.837349689681922, -3.5042547517455396],
        end: [17.024798172032582, -3.5042547517455396],
        isConstruction: false,
        style: null,
      },
      {
        kind: 'lineSegment',
        entityId: 'entity_bc',
        label: 'BC',
        start: [17.024798172032582, -3.5042547517455396],
        end: [17.024798172032582, 5.978617145073699],
        isConstruction: false,
        style: null,
      },
    ],
    regions: [],
    diagnostics: [],
  }
}
