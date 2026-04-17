import { strToU8, zipSync } from 'fflate'

import type {
  DocumentExportDiagnostic,
  DocumentExportFormat,
  DocumentExportRequest,
  DocumentExportResult,
  DocumentExportSuccessResult,
  MeshExportAccuracyOptions,
  StepExportOptions,
} from '@/contracts/modeling/export'
import type { DurableRef } from '@/contracts/shared/references'
import type { OccAuthoringState } from '@/domain/modeling/occ/authoring-state'
import type { OccTrackedBody } from '@/domain/modeling/occ/topology'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'

type OccShape = InstanceType<OpenCascadeInstance['TopoDS_Shape']>
type OccFace = InstanceType<OpenCascadeInstance['TopoDS_Face']>
type OccLocation = InstanceType<OpenCascadeInstance['TopLoc_Location']>

type MeshPoint = readonly [number, number, number]

interface MeshTriangle {
  normal: MeshPoint
  vertices: readonly [MeshPoint, MeshPoint, MeshPoint]
}

interface ExportableBody {
  body: OccTrackedBody
  target: DurableRef
}

let tempExportPathCounter = 0

function createOccExportDiagnostic(
  code: string,
  message: string,
  target: DocumentExportDiagnostic['target'],
): DocumentExportDiagnostic {
  return {
    code,
    severity: 'error',
    message,
    target,
  }
}

function createFailure(
  format: DocumentExportFormat,
  diagnostic: DocumentExportDiagnostic,
): DocumentExportResult {
  return {
    ok: false,
    format,
    diagnostics: [diagnostic],
  }
}

function createSuccess(
  request: DocumentExportRequest,
  payload: DocumentExportSuccessResult['payload'],
): DocumentExportSuccessResult {
  return {
    ok: true,
    format: request.format,
    filename: createGeometryExportFilename(request.targetLabel, request.format),
    extension: getGeometryExportExtension(request.format),
    mimeType: getGeometryExportMimeType(request.format),
    payload,
    diagnostics: [],
  }
}

function getGeometryExportExtension(format: DocumentExportFormat) {
  switch (format) {
    case 'stl':
      return 'stl'
    case 'step':
      return 'step'
    case '3mf':
      return '3mf'
    case 'cadara':
      return 'cadara'
  }
}

function getGeometryExportMimeType(format: DocumentExportFormat) {
  switch (format) {
    case 'stl':
      return 'model/stl'
    case 'step':
      return 'model/step'
    case '3mf':
      return 'model/3mf'
    case 'cadara':
      return 'application/vnd.cadara+json'
  }
}

function createGeometryExportFilename(targetLabel: string, format: DocumentExportFormat) {
  const slug = targetLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${slug || 'cadara-export'}.${getGeometryExportExtension(format)}`
}

function resolveExportableBody(
  state: OccAuthoringState,
  target: DurableRef,
): ExportableBody | DocumentExportDiagnostic {
  if (target.kind !== 'body') {
    return createOccExportDiagnostic(
      'occ-export-unexportable-target',
      'Only live solid body targets can be exported to geometry formats.',
      target,
    )
  }

  const body = state.bodies.find((candidate) => candidate.bodyId === target.bodyId)

  if (!body) {
    return createOccExportDiagnostic(
      'occ-export-missing-body',
      `Body ${target.bodyId} does not resolve in the current OpenCascade authoring state.`,
      target,
    )
  }

  return {
    body,
    target,
  }
}

function createTempExportPath(extension: string) {
  tempExportPathCounter += 1
  return `/cadara-export-${Date.now()}-${tempExportPathCounter}.${extension}`
}

function removeTempExportPath(oc: OpenCascadeInstance, path: string) {
  if (oc.FS.analyzePath(path).exists) {
    oc.FS.unlink(path)
  }
}

function readTempExportText(oc: OpenCascadeInstance, path: string) {
  return oc.FS.readFile(path, { encoding: 'utf8' }) as string
}

function isOccDoneStatus(status: unknown) {
  return typeof status === 'object'
    && status !== null
    && 'value' in status
    && (status as { value: unknown }).value === 1
}

function mapStepSchema(schema: StepExportOptions['schema']) {
  switch (schema) {
    case 'AP203':
      return 'AP203'
    case 'AP214':
      return 'AP214IS'
    case 'AP242':
      return 'AP242DIS'
  }
}

function configureStepWriter(
  oc: OpenCascadeInstance,
  options: StepExportOptions,
  target: DurableRef,
): DocumentExportDiagnostic | null {
  if (
    typeof oc.STEPControl_Controller?.Init !== 'function'
    || typeof oc.Interface_Static?.IsPresent !== 'function'
    || typeof oc.Interface_Static?.SetCVal !== 'function'
  ) {
    return createOccExportDiagnostic(
      'occ-export-writer-unavailable',
      'STEP writer configuration is not available in this OpenCascade runtime.',
      target,
    )
  }

  oc.STEPControl_Controller.Init()

  if (!oc.Interface_Static.IsPresent('write.step.schema') || !oc.Interface_Static.IsPresent('write.step.unit')) {
    return createOccExportDiagnostic(
      'occ-export-writer-unavailable',
      'STEP writer schema and unit options are not available in this OpenCascade runtime.',
      target,
    )
  }

  const schemaConfigured = oc.Interface_Static.SetCVal('write.step.schema', mapStepSchema(options.schema))
  const unitConfigured = oc.Interface_Static.SetCVal('write.step.unit', options.unit === 'millimeter' ? 'MM' : options.unit)

  if (!schemaConfigured || !unitConfigured) {
    return createOccExportDiagnostic(
      'occ-export-writer-unavailable',
      `STEP writer cannot configure ${options.schema} with ${options.unit} units in this OpenCascade runtime.`,
      target,
    )
  }

  return null
}

function exportStep(
  state: OccAuthoringState,
  request: Extract<DocumentExportRequest, { format: 'step' }>,
  body: OccTrackedBody,
): DocumentExportResult {
  const configurationDiagnostic = configureStepWriter(state.oc, request.options, request.target)

  if (configurationDiagnostic) {
    return createFailure(request.format, configurationDiagnostic)
  }

  const outputPath = createTempExportPath('step')
  const writer = new state.oc.STEPControl_Writer_1()
  const progress = new state.oc.Message_ProgressRange_1()
  const transferMode = state.oc.STEPControl_StepModelType.STEPControl_AsIs as unknown as OpenCascadeInstance['STEPControl_StepModelType']

  try {
    const transferStatus = writer.Transfer(
      body.shape,
      transferMode,
      true,
      progress,
    )

    if (!isOccDoneStatus(transferStatus)) {
      return createFailure(
        request.format,
        createOccExportDiagnostic(
          'occ-export-writer-failed',
          'OpenCascade STEP writer failed to transfer the selected body shape.',
          request.target,
        ),
      )
    }

    const writeStatus = writer.Write(outputPath)

    if (!isOccDoneStatus(writeStatus) || !state.oc.FS.analyzePath(outputPath).exists) {
      return createFailure(
        request.format,
        createOccExportDiagnostic(
          'occ-export-writer-failed',
          'OpenCascade STEP writer did not produce an output file.',
          request.target,
        ),
      )
    }

    const payload = readTempExportText(state.oc, outputPath)

    if (payload.trim().length === 0) {
      return createFailure(
        request.format,
        createOccExportDiagnostic(
          'occ-export-writer-failed',
          'OpenCascade STEP writer produced an empty output file.',
          request.target,
        ),
      )
    }

    return createSuccess(request, payload)
  } finally {
    removeTempExportPath(state.oc, outputPath)
    writer.delete()
  }
}

function meshBody(
  state: OccAuthoringState,
  shape: OccShape,
  options: MeshExportAccuracyOptions,
) {
  new state.oc.BRepMesh_IncrementalMesh_2(
    shape,
    options.chordTolerance,
    false,
    options.angleToleranceRadians,
    false,
  )
}

function getFaceOrientationIsReversed(state: OccAuthoringState, face: OccFace) {
  return (face.Orientation_1() as { value?: number }).value
    === (state.oc.TopAbs_Orientation.TopAbs_REVERSED as { value?: number }).value
}

function toMeshPoint(
  point: { Transformed(theT: InstanceType<OpenCascadeInstance['gp_Trsf']>): { X(): number; Y(): number; Z(): number } },
  location: OccLocation,
): MeshPoint {
  const transformed = point.Transformed(location.Transformation())

  return [transformed.X(), transformed.Y(), transformed.Z()]
}

function normalizeVector(vector: MeshPoint): MeshPoint {
  const length = Math.hypot(vector[0], vector[1], vector[2])

  if (length === 0) {
    return [0, 0, 0]
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function calculateNormal(vertices: readonly [MeshPoint, MeshPoint, MeshPoint]): MeshPoint {
  const [a, b, c] = vertices
  const ab: MeshPoint = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac: MeshPoint = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]

  return normalizeVector([
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ])
}

function collectBodyTriangles(
  state: OccAuthoringState,
  body: OccTrackedBody,
  options: MeshExportAccuracyOptions,
): MeshTriangle[] {
  meshBody(state, body.shape, options)

  const triangles: MeshTriangle[] = []

  for (const faceId of body.topology.faceIds) {
    const face = body.facesById.get(faceId)

    if (!face) {
      continue
    }

    const location = new state.oc.TopLoc_Location_1()
    const triangulationHandle = state.oc.BRep_Tool.Triangulation(face, location, 0 as never)

    if (triangulationHandle.IsNull()) {
      continue
    }

    const triangulation = triangulationHandle.get()
    const isReversed = getFaceOrientationIsReversed(state, face)

    for (let index = 1; index <= triangulation.NbTriangles(); index += 1) {
      const triangle = triangulation.Triangle(index)
      const first = triangle.Value(1)
      const second = triangle.Value(2)
      const third = triangle.Value(3)
      const indices = isReversed
        ? [first, third, second]
        : [first, second, third]
      const vertices = indices.map((nodeIndex) =>
        toMeshPoint(triangulation.Node(nodeIndex), location)
      ) as [MeshPoint, MeshPoint, MeshPoint]

      triangles.push({
        normal: calculateNormal(vertices),
        vertices,
      })
    }
  }

  return triangles
}

function createEmptyMeshDiagnostic(format: DocumentExportFormat, target: DurableRef) {
  return createOccExportDiagnostic(
    'occ-export-empty-mesh',
    `${format.toUpperCase()} export could not produce triangles for the selected body.`,
    target,
  )
}

function exportStl(
  state: OccAuthoringState,
  request: Extract<DocumentExportRequest, { format: 'stl' }>,
  body: OccTrackedBody,
): DocumentExportResult {
  const triangles = collectBodyTriangles(state, body, request.options.meshAccuracy)

  if (triangles.length === 0) {
    return createFailure(request.format, createEmptyMeshDiagnostic(request.format, request.target))
  }

  return createSuccess(
    request,
    request.options.encoding === 'ascii'
      ? writeAsciiStl(triangles)
      : writeBinaryStl(triangles),
  )
}

function writeAsciiStl(triangles: readonly MeshTriangle[]) {
  const lines = ['solid cadara']

  for (const triangle of triangles) {
    lines.push(`  facet normal ${triangle.normal[0]} ${triangle.normal[1]} ${triangle.normal[2]}`)
    lines.push('    outer loop')

    for (const vertex of triangle.vertices) {
      lines.push(`      vertex ${vertex[0]} ${vertex[1]} ${vertex[2]}`)
    }

    lines.push('    endloop')
    lines.push('  endfacet')
  }

  lines.push('endsolid cadara')

  return lines.join('\n')
}

function writeBinaryStl(triangles: readonly MeshTriangle[]) {
  const bytes = new Uint8Array(84 + triangles.length * 50)
  const view = new DataView(bytes.buffer)
  const header = new TextEncoder().encode('cadara binary stl export')

  bytes.set(header.slice(0, 80), 0)
  view.setUint32(80, triangles.length, true)

  let offset = 84

  for (const triangle of triangles) {
    for (const value of triangle.normal) {
      view.setFloat32(offset, value, true)
      offset += 4
    }

    for (const vertex of triangle.vertices) {
      for (const value of vertex) {
        view.setFloat32(offset, value, true)
        offset += 4
      }
    }

    view.setUint16(offset, 0, true)
    offset += 2
  }

  return bytes
}

function exportThreeMf(
  state: OccAuthoringState,
  request: Extract<DocumentExportRequest, { format: '3mf' }>,
  body: OccTrackedBody,
): DocumentExportResult {
  const triangles = collectBodyTriangles(state, body, request.options.meshAccuracy)

  if (triangles.length === 0) {
    return createFailure(request.format, createEmptyMeshDiagnostic(request.format, request.target))
  }

  return createSuccess(request, writeThreeMfPackage(triangles, request.targetLabel, request.options.includeMetadata))
}

function writeThreeMfPackage(
  triangles: readonly MeshTriangle[],
  targetLabel: string,
  includeMetadata: boolean,
) {
  const xml = createThreeMfModelXml(triangles, targetLabel, includeMetadata)

  return zipSync({
    '[Content_Types].xml': strToU8([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
      '</Types>',
    ].join('')),
    '_rels/.rels': strToU8([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
      '</Relationships>',
    ].join('')),
    '3D/3dmodel.model': strToU8(xml),
  }, { level: 0 })
}

function createThreeMfModelXml(
  triangles: readonly MeshTriangle[],
  targetLabel: string,
  includeMetadata: boolean,
) {
  const vertices: string[] = []
  const triangleElements: string[] = []
  const vertexIndicesByKey = new Map<string, number>()

  function getVertexIndex(vertex: MeshPoint) {
    const x = formatXmlNumber(vertex[0])
    const y = formatXmlNumber(vertex[1])
    const z = formatXmlNumber(vertex[2])
    const key = `${x},${y},${z}`
    const existing = vertexIndicesByKey.get(key)

    if (existing !== undefined) {
      return existing
    }

    const index = vertices.length

    vertexIndicesByKey.set(key, index)
    vertices.push(`<vertex x="${x}" y="${y}" z="${z}"/>`)

    return index
  }

  triangles.forEach((triangle) => {
    const [first, second, third] = triangle.vertices.map(getVertexIndex)

    triangleElements.push(`<triangle v1="${first}" v2="${second}" v3="${third}"/>`)
  })

  const metadata = includeMetadata
    ? `<metadata name="Title">${escapeXml(targetLabel)}</metadata>`
    : ''

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    metadata,
    '<resources>',
    '<object id="1" type="model">',
    '<mesh>',
    '<vertices>',
    vertices.join(''),
    '</vertices>',
    '<triangles>',
    triangleElements.join(''),
    '</triangles>',
    '</mesh>',
    '</object>',
    '</resources>',
    '<build>',
    '<item objectid="1"/>',
    '</build>',
    '</model>',
  ].join('')
}

function formatXmlNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function exportOccGeometryDocument(
  state: OccAuthoringState,
  request: DocumentExportRequest,
): DocumentExportResult {
  if (request.format === 'cadara') {
    return createFailure(
      request.format,
      createOccExportDiagnostic(
        'occ-cadara-export-service-only',
        'cadara export is generated by the modeling service from the durable document snapshot.',
        request.target,
      ),
    )
  }

  const resolved = resolveExportableBody(state, request.target)

  if ('code' in resolved) {
    return createFailure(request.format, resolved)
  }

  switch (request.format) {
    case 'step':
      return exportStep(state, request, resolved.body)
    case 'stl':
      return exportStl(state, request, resolved.body)
    case '3mf':
      return exportThreeMf(state, request, resolved.body)
  }
}
