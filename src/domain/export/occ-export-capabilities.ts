import type {
  BRepWriterCapability,
  ExportCapabilities,
  MeshExportAccuracy,
  MeshTessellationCapability,
  MeshTriangle,
  StepWriterOptions,
} from '@/contracts/export/capabilities'
import type { DocumentExportDiagnostic as ExportDiagnostic } from '@/contracts/modeling/export'
import type { DurableRef } from '@/contracts/shared/references'
import type { OccAuthoringState } from '@/domain/modeling/occ/authoring-state'
import type { OccTrackedBody } from '@/domain/modeling/occ/topology'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'

type OccFace = InstanceType<OpenCascadeInstance['TopoDS_Face']>
type OccLocation = InstanceType<OpenCascadeInstance['TopLoc_Location']>
type OccShape = InstanceType<OpenCascadeInstance['TopoDS_Shape']>
type MeshPoint = readonly [number, number, number]

let tempExportPathCounter = 0

function createTempExportPath(extension: string) {
  tempExportPathCounter += 1
  return `/cadara-export-${Date.now()}-${tempExportPathCounter}.${extension}`
}

function removeTempExportPath(oc: OpenCascadeInstance, path: string) {
  if (oc.FS.analyzePath(path).exists) {
    oc.FS.unlink(path)
  }
}

function isOccDoneStatus(status: unknown) {
  return typeof status === 'object'
    && status !== null
    && 'value' in status
    && (status as { value: unknown }).value === 1
}

function createExportDiagnostic(
  code: string,
  message: string,
  target: DurableRef | null,
): ExportDiagnostic {
  return { code, severity: 'error', message, target }
}

function resolveBody(
  state: OccAuthoringState,
  target: DurableRef,
): OccTrackedBody | ExportDiagnostic {
  if (target.kind !== 'body') {
    return createExportDiagnostic(
      'occ-export-unexportable-target',
      'Only live solid body targets can be exported to geometry formats.',
      target,
    )
  }

  const body = state.bodies.find((candidate) => candidate.bodyId === target.bodyId)

  if (!body) {
    return createExportDiagnostic(
      'occ-export-missing-body',
      `Body ${target.bodyId} does not resolve in the current OpenCascade authoring state.`,
      target,
    )
  }

  return body
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

function meshShape(oc: OpenCascadeInstance, shape: OccShape, options: MeshExportAccuracy) {
  new oc.BRepMesh_IncrementalMesh_2(
    shape,
    options.chordTolerance,
    false,
    options.angleToleranceRadians,
    false,
  )
}

function collectTrianglesFromBody(
  state: OccAuthoringState,
  body: OccTrackedBody,
  options: MeshExportAccuracy,
): MeshTriangle[] {
  meshShape(state.oc, body.shape, options)

  const triangles: MeshTriangle[] = []
  let missingTriangulationFaceCount = 0

  for (const faceId of body.topology.faceIds) {
    const face = body.facesById.get(faceId)

    if (!face) {
      continue
    }

    const location = new state.oc.TopLoc_Location_1()
    const triangulationHandle = state.oc.BRep_Tool.Triangulation(face, location, 0 as never)

    if (triangulationHandle.IsNull()) {
      missingTriangulationFaceCount += 1
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

  if (missingTriangulationFaceCount > 0 && body.meshExportFallback) {
    return body.meshExportFallback.map((vertices) => ({
      normal: calculateNormal(vertices),
      vertices,
    }))
  }

  return triangles
}

function mapStepSchema(schema: StepWriterOptions['schema']) {
  switch (schema) {
    case 'AP203':
      return 'AP203'
    case 'AP214':
      return 'AP214IS'
    case 'AP242':
      return 'AP242DIS'
  }
}

function createOccMeshTessellationCapability(state: OccAuthoringState): MeshTessellationCapability {
  return {
    tessellate(target: DurableRef, options: MeshExportAccuracy): MeshTriangle[] | ExportDiagnostic {
      const bodyOrDiagnostic = resolveBody(state, target)

      if ('code' in bodyOrDiagnostic) {
        return bodyOrDiagnostic
      }

      return collectTrianglesFromBody(state, bodyOrDiagnostic, options)
    },
  }
}

function createOccBRepWriterCapability(state: OccAuthoringState): BRepWriterCapability {
  return {
    writeStep(target: DurableRef, options: StepWriterOptions): { payload: string } | { diagnostic: ExportDiagnostic } {
      const bodyOrDiagnostic = resolveBody(state, target)

      if ('code' in bodyOrDiagnostic) {
        return { diagnostic: bodyOrDiagnostic }
      }

      const body = bodyOrDiagnostic
      const oc = state.oc

      if (
        typeof oc.STEPControl_Controller?.Init !== 'function'
        || typeof oc.Interface_Static?.IsPresent !== 'function'
        || typeof oc.Interface_Static?.SetCVal !== 'function'
      ) {
        return {
          diagnostic: createExportDiagnostic(
            'occ-export-writer-unavailable',
            'STEP writer configuration is not available in this OpenCascade runtime.',
            target,
          ),
        }
      }

      oc.STEPControl_Controller.Init()

      if (!oc.Interface_Static.IsPresent('write.step.schema') || !oc.Interface_Static.IsPresent('write.step.unit')) {
        return {
          diagnostic: createExportDiagnostic(
            'occ-export-writer-unavailable',
            'STEP writer schema and unit options are not available in this OpenCascade runtime.',
            target,
          ),
        }
      }

      const schemaConfigured = oc.Interface_Static.SetCVal('write.step.schema', mapStepSchema(options.schema))
      const unitConfigured = oc.Interface_Static.SetCVal('write.step.unit', options.unit === 'millimeter' ? 'MM' : options.unit)

      if (!schemaConfigured || !unitConfigured) {
        return {
          diagnostic: createExportDiagnostic(
            'occ-export-writer-unavailable',
            `STEP writer cannot configure ${options.schema} with ${options.unit} units in this OpenCascade runtime.`,
            target,
          ),
        }
      }

      const outputPath = createTempExportPath('step')
      const writer = new oc.STEPControl_Writer_1()
      const progress = new oc.Message_ProgressRange_1()
      const transferMode = oc.STEPControl_StepModelType.STEPControl_AsIs as unknown as OpenCascadeInstance['STEPControl_StepModelType']

      try {
        const transferStatus = writer.Transfer(body.shape, transferMode, true, progress)

        if (!isOccDoneStatus(transferStatus)) {
          return {
            diagnostic: createExportDiagnostic(
              'occ-export-writer-failed',
              'OpenCascade STEP writer failed to transfer the selected body shape.',
              target,
            ),
          }
        }

        const writeStatus = writer.Write(outputPath)

        if (!isOccDoneStatus(writeStatus) || !oc.FS.analyzePath(outputPath).exists) {
          return {
            diagnostic: createExportDiagnostic(
              'occ-export-writer-failed',
              'OpenCascade STEP writer did not produce an output file.',
              target,
            ),
          }
        }

        const payload = oc.FS.readFile(outputPath, { encoding: 'utf8' }) as string

        if (payload.trim().length === 0) {
          return {
            diagnostic: createExportDiagnostic(
              'occ-export-writer-failed',
              'OpenCascade STEP writer produced an empty output file.',
              target,
            ),
          }
        }

        return { payload }
      } finally {
        removeTempExportPath(oc, outputPath)
        writer.delete()
      }
    },
  }
}

export function createOccExportCapabilities(state: OccAuthoringState): ExportCapabilities {
  return {
    mesh: createOccMeshTessellationCapability(state),
    brep: createOccBRepWriterCapability(state),
  }
}
