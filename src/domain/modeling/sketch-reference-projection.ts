import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import type { RenderableEntityRecord, RenderPoint3D } from '@/contracts/render/schema'
import type { SketchPoint2D, SketchReferenceDefinition } from '@/contracts/sketch/schema'
import type { ProjectedGeometryId, ReferenceId, SketchPointId } from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
  ProjectSketchExternalReferencesRequest,
  ProjectSketchExternalReferencesResponse,
  SketchPlaneFrame,
  SketchSolverResponseBase,
  SolverTolerancePolicy,
} from '@/contracts/solver/schema'
import { SOLVER_SCHEMA_VERSION } from '@/contracts/solver/schema'
import type { SketchSolveDiagnostic } from '@/contracts/sketch'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'

type Vec3 = readonly [number, number, number]

function responseBase(request: ProjectSketchExternalReferencesRequest): SketchSolverResponseBase {
  return {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: request.requestId,
    documentId: request.documentId,
    revisionId: request.revisionId,
    sketchId: request.sketchId,
  }
}

function diagnostic(
  code: string,
  severity: SketchSolveDiagnostic['severity'],
  message: string,
): SketchSolveDiagnostic {
  return {
    code,
    severity,
    message,
    target: null,
  }
}

function failedReference(
  referenceId: ReferenceId,
  status: Exclude<ProjectedSketchReferenceRecord['status'], 'projected'>,
  code: string,
  message: string,
): ProjectedSketchReferenceRecord {
  return {
    referenceId,
    status,
    geometry: [],
    diagnostics: [diagnostic(code, status === 'missingSource' ? 'error' : 'warning', message)],
  }
}

export function createProjectedGeometryId(referenceId: ReferenceId, suffix: string): ProjectedGeometryId {
  const normalizedSuffix = suffix.replace(/[^a-zA-Z0-9_-]+/g, '-')
  return `projected_geometry_${referenceId}_${normalizedSuffix}` as ProjectedGeometryId
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function scale(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor]
}

function dot(left: Vec3, right: Vec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function distance2d(left: SketchPoint2D, right: SketchPoint2D) {
  return Math.hypot(left[0] - right[0], left[1] - right[1])
}

function mapSketchPointToWorld(plane: SketchPlaneFrame, point: SketchPoint2D): Vec3 {
  return add(
    add(plane.origin, scale(plane.xAxis, point[0])),
    scale(plane.yAxis, point[1]),
  )
}

function pointPlaneDistance(plane: SketchPlaneFrame, point: Vec3) {
  return dot(subtract(point, plane.origin), plane.normal)
}

function projectWorldPoint(
  plane: SketchPlaneFrame,
  point: Vec3,
): SketchPoint2D {
  const relative = subtract(point, plane.origin)
  return [dot(relative, plane.xAxis), dot(relative, plane.yAxis)]
}

function canUseExistingGeometry(
  reference: SketchReferenceDefinition,
  points: readonly Vec3[],
  plane: SketchPlaneFrame,
  tolerances: SolverTolerancePolicy,
) {
  if (reference.kind === 'modelReference' && reference.projectionMode === 'projectAlongPlaneNormal') {
    return true
  }

  return points.every((point) => Math.abs(pointPlaneDistance(plane, point)) <= tolerances.coincidence)
}

function sameTarget(left: DurableRef, right: DurableRef) {
  if (left.kind !== right.kind) {
    return false
  }

  return JSON.stringify(left) === JSON.stringify(right)
}

function findRenderRecords(snapshot: DocumentSnapshot, target: DurableRef) {
  return snapshot.document.render.records.filter((record) => sameTarget(record.binding.target, target))
}

function isCollinear(points: readonly SketchPoint2D[], tolerance: number) {
  if (points.length <= 2) {
    return true
  }

  const [start, end] = [points[0]!, points.at(-1)!]
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length = Math.hypot(dx, dy)
  if (length <= tolerance) {
    return false
  }

  return points.slice(1, -1).every((point) =>
    Math.abs((point[0] - start[0]) * dy - (point[1] - start[1]) * dx) / length <= tolerance,
  )
}

function circleFromThreePoints(
  a: SketchPoint2D,
  b: SketchPoint2D,
  c: SketchPoint2D,
  tolerance: number,
) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  const span = Math.max(distance2d(a, b), distance2d(a, c), distance2d(b, c))
  if (Math.abs(d) <= tolerance * Math.max(tolerance, span)) {
    return null
  }

  const a2 = a[0] * a[0] + a[1] * a[1]
  const b2 = b[0] * b[0] + b[1] * b[1]
  const c2 = c[0] * c[0] + c[1] * c[1]
  const center: SketchPoint2D = [
    (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d,
  ]
  const radius = distance2d(center, a)
  if (radius <= tolerance) {
    return null
  }

  return { center, radius }
}

function triangleMagnitude(a: SketchPoint2D, b: SketchPoint2D, c: SketchPoint2D) {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
}

function circleFromPoints(points: readonly SketchPoint2D[], tolerance: number) {
  if (points.length < 3) {
    return null
  }

  const first = points[0]!
  let second = points[1]!
  let maxDistance = distance2d(first, second)
  for (const point of points.slice(2)) {
    const pointDistance = distance2d(first, point)
    if (pointDistance > maxDistance) {
      maxDistance = pointDistance
      second = point
    }
  }

  let third: SketchPoint2D | null = null
  let bestMagnitude = 0
  for (const point of points) {
    const magnitude = triangleMagnitude(first, second, point)
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude
      third = point
    }
  }

  if (!third) {
    return null
  }

  const circle = circleFromThreePoints(first, second, third, tolerance)
  if (!circle) {
    return null
  }

  const { center, radius } = circle
  const maxError = Math.max(...points.map((point) => Math.abs(distance2d(center, point) - radius)))
  return maxError <= Math.max(tolerance, radius * 1e-4) ? { center, radius } : null
}

function signedPolylineArea(points: readonly SketchPoint2D[]) {
  let area = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]!
    const next = points[index + 1]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

function splineDegreeForPointCount(pointCount: number): 2 | 3 {
  return pointCount >= 4 ? 3 : 2
}

function geometryFromWorldPolyline(input: {
  referenceId: ReferenceId
  suffix: string
  points: readonly Vec3[]
  isClosed: boolean
  plane: SketchPlaneFrame
  tolerances: SolverTolerancePolicy
}): ProjectedSketchReferenceGeometry | null {
  const projected = input.points.map((point) => projectWorldPoint(input.plane, point))
  const unique = projected.filter((point, index) =>
    index === 0 || distance2d(point, projected[index - 1]!) > input.tolerances.minimumSegmentLength,
  )
  const closesOnStart = unique.length >= 2
    && distance2d(unique[0]!, unique.at(-1)!) <= input.tolerances.minimumSegmentLength
  const candidate = closesOnStart ? unique.slice(0, -1) : unique
  const isClosed = input.isClosed || closesOnStart

  if (candidate.length < 2) {
    return null
  }

  if (!isClosed && isCollinear(candidate, input.tolerances.minimumSegmentLength)) {
    return {
      geometryId: createProjectedGeometryId(input.referenceId, input.suffix),
      kind: 'lineSegment',
      startPosition: candidate[0]!,
      endPosition: candidate.at(-1)!,
    }
  }

  const circle = circleFromPoints(candidate, input.tolerances.minimumSegmentLength)
  if (circle && isClosed) {
    return {
      geometryId: createProjectedGeometryId(input.referenceId, input.suffix),
      kind: 'circle',
      centerPosition: circle.center,
      radius: circle.radius,
    }
  }

  if (!circle) {
    return candidate.length >= 3
      ? {
          geometryId: createProjectedGeometryId(input.referenceId, input.suffix),
          kind: 'spline',
          fitPoints: candidate,
          degree: splineDegreeForPointCount(candidate.length),
          isClosed,
        }
      : null
  }

  return {
    geometryId: createProjectedGeometryId(input.referenceId, input.suffix),
    kind: 'arc',
    centerPosition: circle.center,
    startPosition: candidate[0]!,
    endPosition: candidate.at(-1)!,
    sweepDirection: signedPolylineArea(candidate) < 0 ? 'clockwise' : 'counterClockwise',
  }
}

function projectModelVertex(
  snapshot: DocumentSnapshot,
  reference: ProjectSketchExternalReferencesRequest['references'][number],
  plane: SketchPlaneFrame,
  tolerances: SolverTolerancePolicy,
): ProjectedSketchReferenceRecord {
  const target = reference.reference.source
  const records = findRenderRecords(snapshot, target)
  const marker = records.find((record) => record.geometry.kind === 'marker')
  if (!marker || marker.geometry.kind !== 'marker') {
    return failedReference(reference.referenceId, 'missingSource', 'missing-model-vertex-source', `Model vertex ${reference.referenceId} does not resolve in the requested revision.`)
  }

  if (!canUseExistingGeometry(reference.reference, [marker.geometry.position], plane, tolerances)) {
    return failedReference(reference.referenceId, 'outOfPlane', 'projection-source-out-of-plane', `Model vertex ${reference.referenceId} is not coplanar with the active sketch plane.`)
  }

  return {
    referenceId: reference.referenceId,
    status: 'projected',
    geometry: [{
      geometryId: createProjectedGeometryId(reference.referenceId, 'point'),
      kind: 'point',
      position: projectWorldPoint(plane, marker.geometry.position),
    }],
    diagnostics: [],
  }
}

function projectModelEdge(
  snapshot: DocumentSnapshot,
  reference: ProjectSketchExternalReferencesRequest['references'][number],
  plane: SketchPlaneFrame,
  tolerances: SolverTolerancePolicy,
): ProjectedSketchReferenceRecord {
  const target = reference.reference.source
  const records = findRenderRecords(snapshot, target)
  const polyline = records.find((record) => record.geometry.kind === 'polyline')
  if (!polyline || polyline.geometry.kind !== 'polyline') {
    return failedReference(reference.referenceId, 'missingSource', 'missing-model-edge-source', `Model edge ${reference.referenceId} does not resolve in the requested revision.`)
  }

  if (!canUseExistingGeometry(reference.reference, polyline.geometry.points, plane, tolerances)) {
    return failedReference(reference.referenceId, 'outOfPlane', 'projection-source-out-of-plane', `Model edge ${reference.referenceId} is not coplanar with the active sketch plane.`)
  }

  const geometry = geometryFromWorldPolyline({
    referenceId: reference.referenceId,
    suffix: 'edge',
    points: polyline.geometry.points,
    isClosed: polyline.geometry.isClosed,
    plane,
    tolerances,
  })

  return geometry
    ? { referenceId: reference.referenceId, status: 'projected', geometry: [geometry], diagnostics: [] }
    : failedReference(reference.referenceId, 'unsupportedSource', 'unsupported-model-edge-source', `Model edge ${reference.referenceId} cannot be represented as a projected line, circle, or arc.`)
}

function boundaryEdgesFromTriangles(triangles: readonly (readonly [number, number, number])[]) {
  const edges = new Map<string, readonly [number, number]>()
  const counts = new Map<string, number>()

  for (const triangle of triangles) {
    const pairs = [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ] as const
    for (const [left, right] of pairs) {
      const key = left < right ? `${left}:${right}` : `${right}:${left}`
      edges.set(key, [left, right])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  return [...edges.entries()]
    .filter(([key]) => counts.get(key) === 1)
    .map(([, edge]) => edge)
}

function projectModelFace(
  snapshot: DocumentSnapshot,
  reference: ProjectSketchExternalReferencesRequest['references'][number],
  plane: SketchPlaneFrame,
  tolerances: SolverTolerancePolicy,
): ProjectedSketchReferenceRecord {
  const target = reference.reference.source
  const records = findRenderRecords(snapshot, target)
  const meshRecord = records.find((record) => record.geometry.kind === 'mesh')
  const meshGeometry = meshRecord?.geometry.kind === 'mesh' ? meshRecord.geometry : null
  if (!meshGeometry) {
    return failedReference(reference.referenceId, 'missingSource', 'missing-model-face-source', `Model face ${reference.referenceId} does not resolve in the requested revision.`)
  }

  if (!canUseExistingGeometry(reference.reference, meshGeometry.vertexPositions, plane, tolerances)) {
    return failedReference(reference.referenceId, 'outOfPlane', 'projection-source-out-of-plane', `Model face ${reference.referenceId} is not coplanar with the active sketch plane.`)
  }

  const boundary = boundaryEdgesFromTriangles(meshGeometry.triangleIndices)
  if (boundary.length < 3) {
    return failedReference(reference.referenceId, 'ambiguous', 'ambiguous-model-face-boundary', `Model face ${reference.referenceId} does not expose a representable boundary.`)
  }

  const geometry = boundary.map(([startIndex, endIndex], index): ProjectedSketchReferenceGeometry => ({
    geometryId: createProjectedGeometryId(reference.referenceId, `face-edge-${index + 1}`),
    kind: 'lineSegment',
    startPosition: projectWorldPoint(plane, meshGeometry.vertexPositions[startIndex]!),
    endPosition: projectWorldPoint(plane, meshGeometry.vertexPositions[endIndex]!),
  }))

  return {
    referenceId: reference.referenceId,
    status: 'projected',
    geometry,
    diagnostics: [],
  }
}

function projectSketchPoint(
  snapshot: DocumentSnapshot,
  reference: ProjectSketchExternalReferencesRequest['references'][number],
  plane: SketchPlaneFrame,
  tolerances: SolverTolerancePolicy,
): ProjectedSketchReferenceRecord {
  const source = reference.reference.source
  if (source.kind !== 'sketchPoint') {
    return failedReference(reference.referenceId, 'unsupportedSource', 'unsupported-sketch-reference-source', `Sketch reference ${reference.referenceId} does not target a sketch point.`)
  }

  const sketch = snapshot.document.sketches.find((entry) => entry.sketchId === source.sketchId)
  const point = sketch?.sketch.definition.points.find((entry) => entry.pointId === source.pointId)
  if (!sketch || !point) {
    return failedReference(reference.referenceId, 'missingSource', 'missing-sketch-point-source', `Sketch point ${reference.referenceId} does not resolve in the requested revision.`)
  }

  const solvedPoint = sketch.sketch.solvedSnapshot.solvedPoints.find((entry) => entry.pointId === source.pointId)
  const world = mapSketchPointToWorld(sketch.plane.frame, solvedPoint?.solvedPosition ?? point.position)
  if (!canUseExistingGeometry(reference.reference, [world], plane, tolerances)) {
    return failedReference(reference.referenceId, 'outOfPlane', 'projection-source-out-of-plane', `Sketch point ${reference.referenceId} is not coplanar with the active sketch plane.`)
  }

  return {
    referenceId: reference.referenceId,
    status: 'projected',
    geometry: [{
      geometryId: createProjectedGeometryId(reference.referenceId, 'point'),
      kind: 'point',
      position: projectWorldPoint(plane, world),
    }],
    diagnostics: [],
  }
}

function projectSketchEntityGeometry(input: {
  snapshot: DocumentSnapshot
  referenceId: ReferenceId
  sourceSketchId: string
  sourceEntityId: string
  plane: SketchPlaneFrame
  tolerances: SolverTolerancePolicy
}): ProjectedSketchReferenceGeometry[] | null {
  const sketch = input.snapshot.document.sketches.find((entry) => entry.sketchId === input.sourceSketchId)
  const entity = sketch?.sketch.definition.entities.find((entry) => entry.entityId === input.sourceEntityId)
  if (!sketch || !entity) {
    return null
  }

  const pointById = new Map(sketch.sketch.definition.points.map((point) => [point.pointId, point.position]))
  for (const solved of sketch.sketch.solvedSnapshot.solvedPoints) {
    pointById.set(solved.pointId, solved.solvedPosition)
  }

  const worldPoint = (pointId: SketchPointId) => {
    const point = pointById.get(pointId)
    return point ? mapSketchPointToWorld(sketch.plane.frame, point) : null
  }

  switch (entity.kind) {
    case 'point': {
      const point = worldPoint(entity.pointId)
      return point
        ? [{
            geometryId: createProjectedGeometryId(input.referenceId, entity.entityId),
            kind: 'point' as const,
            position: projectWorldPoint(input.plane, point),
          }]
        : null
    }
    case 'lineSegment': {
      const start = worldPoint(entity.startPointId)
      const end = worldPoint(entity.endPointId)
      return start && end
        ? [{
            geometryId: createProjectedGeometryId(input.referenceId, entity.entityId),
            kind: 'lineSegment' as const,
            startPosition: projectWorldPoint(input.plane, start),
            endPosition: projectWorldPoint(input.plane, end),
          }]
        : null
    }
    case 'circle': {
      const center = worldPoint(entity.centerPointId)
      return center
        ? [{
            geometryId: createProjectedGeometryId(input.referenceId, entity.entityId),
            kind: 'circle' as const,
            centerPosition: projectWorldPoint(input.plane, center),
            radius: entity.radius,
          }]
        : null
    }
    case 'arc': {
      const center = worldPoint(entity.centerPointId)
      const start = worldPoint(entity.startPointId)
      const end = worldPoint(entity.endPointId)
      return center && start && end
        ? [{
            geometryId: createProjectedGeometryId(input.referenceId, entity.entityId),
            kind: 'arc' as const,
            centerPosition: projectWorldPoint(input.plane, center),
            startPosition: projectWorldPoint(input.plane, start),
            endPosition: projectWorldPoint(input.plane, end),
            sweepDirection: entity.sweepDirection,
          }]
        : null
    }
    case 'spline': {
      const fitPoints = entity.fitPointIds.flatMap((pointId) => {
        const point = worldPoint(pointId)
        return point ? [projectWorldPoint(input.plane, point)] : []
      })
      return fitPoints.length === entity.fitPointIds.length
        ? [{
            geometryId: createProjectedGeometryId(input.referenceId, entity.entityId),
            kind: 'spline' as const,
            fitPoints,
            degree: entity.degree,
            isClosed: false,
          }]
        : null
    }
  }
}

function projectSketchEntity(
  snapshot: DocumentSnapshot,
  reference: ProjectSketchExternalReferencesRequest['references'][number],
  plane: SketchPlaneFrame,
  tolerances: SolverTolerancePolicy,
): ProjectedSketchReferenceRecord {
  const source = reference.reference.source
  if (source.kind !== 'sketchEntity') {
    return failedReference(reference.referenceId, 'unsupportedSource', 'unsupported-sketch-reference-source', `Sketch reference ${reference.referenceId} does not target a sketch entity.`)
  }

  const sketch = snapshot.document.sketches.find((entry) => entry.sketchId === source.sketchId)
  const entity = sketch?.sketch.definition.entities.find((entry) => entry.entityId === source.entityId)
  if (!sketch || !entity) {
    return failedReference(reference.referenceId, 'missingSource', 'missing-sketch-entity-source', `Sketch entity ${reference.referenceId} does not resolve in the requested revision.`)
  }

  const geometry = projectSketchEntityGeometry({
    snapshot,
    referenceId: reference.referenceId,
    sourceSketchId: source.sketchId,
    sourceEntityId: source.entityId,
    plane,
    tolerances,
  })
  if (!geometry) {
    return failedReference(reference.referenceId, 'missingSource', 'missing-sketch-entity-source', `Sketch entity ${reference.referenceId} references missing sketch points.`)
  }
  if (geometry.length === 0) {
    return failedReference(reference.referenceId, 'unsupportedSource', 'unsupported-sketch-entity-source', `Sketch entity ${reference.referenceId} cannot be represented as projected point, line, circle, or arc geometry.`)
  }

  const worldPoints = sketch.sketch.definition.points.map((point) => mapSketchPointToWorld(sketch.plane.frame, point.position))
  if (!canUseExistingGeometry(reference.reference, worldPoints, plane, tolerances)) {
    return failedReference(reference.referenceId, 'outOfPlane', 'projection-source-out-of-plane', `Sketch entity ${reference.referenceId} is not coplanar with the active sketch plane.`)
  }

  return {
    referenceId: reference.referenceId,
    status: 'projected',
    geometry,
    diagnostics: [],
  }
}

function projectWholeSketch(
  snapshot: DocumentSnapshot,
  reference: ProjectSketchExternalReferencesRequest['references'][number],
  plane: SketchPlaneFrame,
  tolerances: SolverTolerancePolicy,
): ProjectedSketchReferenceRecord {
  const source = reference.reference.source
  if (source.kind !== 'sketch') {
    return failedReference(reference.referenceId, 'unsupportedSource', 'unsupported-sketch-reference-source', `Sketch reference ${reference.referenceId} does not target a sketch.`)
  }

  const sketch = snapshot.document.sketches.find((entry) => entry.sketchId === source.sketchId)
  if (!sketch) {
    return failedReference(reference.referenceId, 'missingSource', 'missing-sketch-source', `Sketch ${reference.referenceId} does not resolve in the requested revision.`)
  }

  const sourcePoints = sketch.sketch.definition.points.map((point) => mapSketchPointToWorld(sketch.plane.frame, point.position))
  if (!canUseExistingGeometry(reference.reference, sourcePoints, plane, tolerances)) {
    return failedReference(reference.referenceId, 'outOfPlane', 'projection-source-out-of-plane', `Sketch ${reference.referenceId} is not coplanar with the active sketch plane.`)
  }

  const geometry = sketch.sketch.definition.entities.flatMap((entity): ProjectedSketchReferenceGeometry[] =>
    projectSketchEntityGeometry({
      snapshot,
      referenceId: reference.referenceId,
      sourceSketchId: sketch.sketchId,
      sourceEntityId: entity.entityId,
      plane,
      tolerances,
    }) ?? [],
  )

  return geometry.length > 0
    ? { referenceId: reference.referenceId, status: 'projected', geometry, diagnostics: [] }
    : failedReference(reference.referenceId, 'unsupportedSource', 'unsupported-sketch-source', `Sketch ${reference.referenceId} does not contain supported projectable geometry.`)
}

function projectReference(
  snapshot: DocumentSnapshot,
  reference: ProjectSketchExternalReferencesRequest['references'][number],
  request: ProjectSketchExternalReferencesRequest,
): ProjectedSketchReferenceRecord {
  if (reference.reference.kind === 'constructionPlane') {
    return {
      referenceId: reference.referenceId,
      status: 'projected',
      geometry: [],
      diagnostics: [],
    }
  }

  if (reference.reference.kind === 'modelReference') {
    switch (reference.reference.source.kind) {
      case 'vertex':
        return projectModelVertex(snapshot, reference, request.plane, request.tolerances)
      case 'edge':
        return projectModelEdge(snapshot, reference, request.plane, request.tolerances)
      case 'face':
        return projectModelFace(snapshot, reference, request.plane, request.tolerances)
    }
  }

  switch (reference.reference.source.kind) {
    case 'sketchPoint':
      return projectSketchPoint(snapshot, reference, request.plane, request.tolerances)
    case 'sketchEntity':
      return projectSketchEntity(snapshot, reference, request.plane, request.tolerances)
    case 'sketch':
      return projectWholeSketch(snapshot, reference, request.plane, request.tolerances)
  }
}

export function projectSketchExternalReferencesFromSnapshot(
  snapshot: DocumentSnapshot,
  request: ProjectSketchExternalReferencesRequest,
): ProjectSketchExternalReferencesResponse {
  if (snapshot.document.documentId !== request.documentId || snapshot.document.revisionId !== request.revisionId) {
    const diagnostics = [
      diagnostic(
        'projection-revision-mismatch',
        'error',
        `Projection request targeted ${request.documentId}@${request.revisionId}, but snapshot is ${snapshot.document.documentId}@${snapshot.document.revisionId}.`,
      ),
    ]

    return {
      ...responseBase(request),
      projectedReferences: request.references.map((reference) => ({
        referenceId: reference.referenceId,
        status: 'missingSource',
        geometry: [],
        diagnostics,
      })),
      diagnostics,
    }
  }

  const projectedReferences = request.references.map((reference) => projectReference(snapshot, reference, request))
  return {
    ...responseBase(request),
    projectedReferences,
    diagnostics: projectedReferences.flatMap((reference) => reference.diagnostics),
  }
}

export function createMarkerRenderRecord(input: {
  template: RenderableEntityRecord
  position: RenderPoint3D
}) {
  return {
    ...input.template,
    geometry: {
      kind: 'marker' as const,
      position: input.position,
      displayRadius: 0.12,
    },
  }
}
