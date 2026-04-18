import type {
  RegionRecord,
  RegionBoundarySegmentRecord,
  SolvedSketchEntityGeometryRecord,
  SketchRecord,
} from '@/contracts/sketch/schema'
import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
} from '@/contracts/solver/schema'
import type { FaceId, ReferenceId } from '@/contracts/shared/ids'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import { buildConstructionPlaneFromPlanarFace as buildConstructionPlaneFromPlanarFaceFromPlaneUtility } from '@/domain/modeling/occ/planes'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  extractPlanarFaceData,
  mapSketchPointToWorld,
  midpointOnArc,
  negate,
  toGpDir,
  toGpPlane,
  toGpPnt,
  toVec3FromGpPoint,
  type Vec3,
} from '@/domain/modeling/occ/geometry'
import {
  createProjectedRegionLoopRejection,
  getProjectedRegionLoopRejectionMessage,
  isProjectedRegionSegmentSourceSupported,
} from '@/domain/modeling/occ/implementation-policy'

export interface BuiltSketchProfileFace {
  face: InstanceType<OpenCascadeInstance['TopoDS_Face']>
  plane: SketchPlaneDefinition
  normal: Vec3
}

const PROFILE_LOOP_TOLERANCE = 1e-6

interface OpenBoundarySegmentGeometry {
  kind: 'open'
  segmentId: string
  start: Vec3
  end: Vec3
}

interface ClosedBoundarySegmentGeometry {
  kind: 'closed'
  segmentId: string
}

type BoundarySegmentGeometry = OpenBoundarySegmentGeometry | ClosedBoundarySegmentGeometry

function getSolvedEntityGeometry(
  sketch: SketchRecord,
  entityId: string,
): SolvedSketchEntityGeometryRecord {
  const geometry = sketch.solvedSnapshot.solvedEntities.find((entry) => entry.entityId === entityId)

  if (!geometry) {
    throw new Error(`Sketch entity ${entityId} does not resolve in solved geometry.`)
  }

  return geometry
}

function getSketchEntityDefinition(
  sketch: SketchRecord,
  entityId: string,
) {
  const entity = sketch.definition.entities.find((entry) => entry.entityId === entityId)

  if (!entity) {
    throw new Error(`Sketch entity ${entityId} is not authored on sketch ${sketch.sketchId}.`)
  }

  return entity
}

function assertRegionBelongsToSketch(sketch: SketchRecord, region: RegionRecord) {
  if (region.ownerSketchId !== sketch.sketchId) {
    throw new Error(`Region ${region.regionId} is owned by sketch ${region.ownerSketchId}, not sketch ${sketch.sketchId}.`)
  }

  if (region.sourceSketch.sketchId !== sketch.sketchId) {
    throw new Error(`Region ${region.regionId} sources sketch ${region.sourceSketch.sketchId}, not sketch ${sketch.sketchId}.`)
  }

  if (region.target.sketchId !== sketch.sketchId) {
    throw new Error(`Region ${region.regionId} targets sketch ${region.target.sketchId}, not sketch ${sketch.sketchId}.`)
  }
}

function assertBoundaryPointExists(sketch: SketchRecord, pointId: string) {
  const authoredPoint = sketch.definition.points.find((entry) => entry.pointId === pointId)

  if (!authoredPoint) {
    throw new Error(`Boundary point ${pointId} is not authored on sketch ${sketch.sketchId}.`)
  }
}

function assertLoopCanBuildProfile(sketch: SketchRecord, region: RegionRecord, loop: RegionRecord['loops'][number]) {
  if (!region.isClosed) {
    throw new Error(`Region ${region.regionId} is not closed.`)
  }

  if (!loop.isClosed) {
    throw new Error(`Region loop ${loop.loopId} is not closed.`)
  }

  if (loop.segments.length === 0) {
    throw new Error(`Region loop ${loop.loopId} does not contain any boundary segments.`)
  }

  for (const pointId of loop.boundaryPointIds) {
    assertBoundaryPointExists(sketch, pointId)
  }
}

function toBoundarySegmentGeometry(
  plane: SketchPlaneDefinition,
  geometry: SolvedSketchEntityGeometryRecord,
): BoundarySegmentGeometry {
  switch (geometry.kind) {
    case 'lineSegment':
      return {
        kind: 'open',
        segmentId: geometry.entityId,
        start: mapSketchPointToWorld(plane, geometry.startPosition),
        end: mapSketchPointToWorld(plane, geometry.endPosition),
      }
    case 'arc':
      return {
        kind: 'open',
        segmentId: geometry.entityId,
        start: mapSketchPointToWorld(plane, geometry.startPosition),
        end: mapSketchPointToWorld(plane, geometry.endPosition),
      }
    case 'circle':
      return {
        kind: 'closed',
        segmentId: geometry.entityId,
      }
    case 'point':
      throw new Error(`Point entity ${geometry.entityId} cannot define a profile boundary.`)
    case 'spline':
      throw new Error(`Spline entity ${geometry.entityId} cannot define a profile boundary.`)
  }
}

function arePointsCoincident(left: Vec3, right: Vec3) {
  return Math.abs(left[0] - right[0]) <= PROFILE_LOOP_TOLERANCE
    && Math.abs(left[1] - right[1]) <= PROFILE_LOOP_TOLERANCE
    && Math.abs(left[2] - right[2]) <= PROFILE_LOOP_TOLERANCE
}

function assertLoopGeometryIsClosed(
  loop: RegionRecord['loops'][number],
  segments: BoundarySegmentGeometry[],
) {
  if (segments.length === 1) {
    const [onlySegment] = segments

    if (onlySegment.kind === 'closed') {
      return
    }

    if (arePointsCoincident(onlySegment.start, onlySegment.end)) {
      return
    }

    throw new Error(`Region loop ${loop.loopId} does not close back onto its starting point.`)
  }

  for (const segment of segments) {
    if (segment.kind === 'closed') {
      throw new Error(`Closed curve segment ${segment.segmentId} cannot participate in multi-segment loop ${loop.loopId}.`)
    }
  }

  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index]
    const next = segments[(index + 1) % segments.length]

    if (current.kind !== 'open' || next.kind !== 'open') {
      throw new Error(`Region loop ${loop.loopId} contains unsupported mixed segment topology.`)
    }

    if (!arePointsCoincident(current.end, next.start)) {
      throw new Error(`Region loop ${loop.loopId} is not geometrically closed between segments ${current.segmentId} and ${next.segmentId}.`)
    }
  }
}

function assertLoopSegmentOwnership(
  sketch: SketchRecord,
  geometry: SolvedSketchEntityGeometryRecord,
) {
  const entity = getSketchEntityDefinition(sketch, geometry.entityId)

  if (entity.isConstruction) {
    throw new Error(`Construction entity ${geometry.entityId} cannot define a profile boundary.`)
  }
}

function buildLineEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  geometry: Extract<SolvedSketchEntityGeometryRecord, { kind: 'lineSegment' }>,
) {
  return buildLineEdgeFromWorld(
    oc,
    mapSketchPointToWorld(plane, geometry.startPosition),
    mapSketchPointToWorld(plane, geometry.endPosition),
  )
}

function buildLineEdgeFromWorld(
  oc: OpenCascadeInstance,
  startPosition: Vec3,
  endPosition: Vec3,
) {
  const start = toGpPnt(oc, startPosition)
  const end = toGpPnt(oc, endPosition)
  const builder = new oc.BRepBuilderAPI_MakeEdge_3(start, end)
  return builder.Edge()
}

function buildCircleEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  geometry: Extract<SolvedSketchEntityGeometryRecord, { kind: 'circle' }>,
) {
  return buildCircleEdgeFromSketchGeometry(oc, plane, geometry.centerPosition, geometry.solvedRadius)
}

function buildCircleEdgeFromSketchGeometry(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  centerPosition: readonly [number, number],
  radius: number,
) {
  const center = mapSketchPointToWorld(plane, centerPosition)
  const axis = new oc.gp_Ax2_2(
    toGpPnt(oc, center),
    toGpDir(oc, plane.frame.normal),
    toGpDir(oc, plane.frame.xAxis),
  )
  const circle = new oc.gp_Circ_2(axis, radius)
  const builder = new oc.BRepBuilderAPI_MakeEdge_8(circle)
  return builder.Edge()
}

function buildArcEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  geometry: Extract<SolvedSketchEntityGeometryRecord, { kind: 'arc' }>,
) {
  return buildArcEdgeFromSketchGeometry(
    oc,
    plane,
    geometry.startPosition,
    geometry.endPosition,
    geometry.centerPosition,
    geometry.sweepDirection,
    `sketch entity ${geometry.entityId}`,
  )
}

function buildArcEdgeFromSketchGeometry(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  startPosition: readonly [number, number],
  endPosition: readonly [number, number],
  centerPosition: readonly [number, number],
  sweepDirection: 'clockwise' | 'counterClockwise',
  label: string,
) {
  const start = mapSketchPointToWorld(plane, startPosition)
  const end = mapSketchPointToWorld(plane, endPosition)
  const midpoint = midpointOnArc(
    start,
    end,
    mapSketchPointToWorld(plane, centerPosition),
    plane.frame.normal,
    sweepDirection,
  )
  const arc = new oc.GC_MakeArcOfCircle_4(
    toGpPnt(oc, start),
    toGpPnt(oc, midpoint),
    toGpPnt(oc, end),
  )

  if (!arc.IsDone()) {
    throw new Error(`Failed to build OCC arc for ${label}.`)
  }

  const curveHandle = new oc.Handle_Geom_Curve_2(arc.Value().get())
  const builder = new oc.BRepBuilderAPI_MakeEdge_24(curveHandle)
  return builder.Edge()
}

function getProjectedSegmentId(source: Extract<RegionBoundarySegmentRecord['source'], { kind: 'projectedGeometry' }>) {
  return `${source.reference.referenceId}/${source.reference.geometryId}`
}

function projectedGeometryKindForRef(geometry: ProjectedSketchReferenceGeometry) {
  switch (geometry.kind) {
    case 'point':
      return 'projectedPoint'
    case 'lineSegment':
      return 'projectedLineSegment'
    case 'circle':
      return 'projectedCircle'
    case 'arc':
      return 'projectedArc'
  }
}

function isAuthoredProjectedReference(sketch: SketchRecord, referenceId: ReferenceId) {
  const isOrdered = sketch.definition.referenceIds.includes(referenceId)
  const hasRecord = sketch.definition.references.some((reference) => reference.referenceId === referenceId)
  return isOrdered && hasRecord
}

function resolveProjectedBoundaryGeometry(
  sketch: SketchRecord,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  source: Extract<RegionBoundarySegmentRecord['source'], { kind: 'projectedGeometry' }>,
) {
  if (!isAuthoredProjectedReference(sketch, source.reference.referenceId)) {
    const rejection = createProjectedRegionLoopRejection(source)
    const error = new Error(`${rejection.message} The referenced projection is not backed by the current authored sketch references.`) as Error & {
      code?: string
    }
    error.code = rejection.code
    throw error
  }

  const projectedReference = projectedReferences.find((entry) => entry.referenceId === source.reference.referenceId)
  const geometry = projectedReference?.geometry.find((entry) => entry.geometryId === source.reference.geometryId) ?? null

  if (!projectedReference || projectedReference.status !== 'projected' || !geometry) {
    const rejection = createProjectedRegionLoopRejection(source)
    const error = new Error(getProjectedRegionLoopRejectionMessage(source)) as Error & { code?: string }
    error.code = rejection.code
    throw error
  }

  if (source.reference.kind && projectedGeometryKindForRef(geometry) !== source.reference.kind) {
    const rejection = createProjectedRegionLoopRejection(source)
    const error = new Error(`${rejection.message} Expected ${source.reference.kind}, received ${geometry.kind}.`) as Error & {
      code?: string
    }
    error.code = rejection.code
    throw error
  }

  return geometry
}

function toProjectedBoundarySegmentGeometry(
  plane: SketchPlaneDefinition,
  source: Extract<RegionBoundarySegmentRecord['source'], { kind: 'projectedGeometry' }>,
  geometry: ProjectedSketchReferenceGeometry,
  traversalDirection: RegionBoundarySegmentRecord['traversalDirection'],
): BoundarySegmentGeometry {
  const segmentId = getProjectedSegmentId(source)

  if (geometry.kind === 'lineSegment') {
    const base = {
      kind: 'open' as const,
      segmentId,
      start: mapSketchPointToWorld(plane, geometry.startPosition),
      end: mapSketchPointToWorld(plane, geometry.endPosition),
    }
    return traversalDirection === 'reverse'
      ? { ...base, start: base.end, end: base.start }
      : base
  }

  if (geometry.kind === 'arc') {
    const base = {
      kind: 'open' as const,
      segmentId,
      start: mapSketchPointToWorld(plane, geometry.startPosition),
      end: mapSketchPointToWorld(plane, geometry.endPosition),
    }
    return traversalDirection === 'reverse'
      ? { ...base, start: base.end, end: base.start }
      : base
  }

  if (geometry.kind === 'circle') {
    return {
      kind: 'closed',
      segmentId,
    }
  }

  const rejection = createProjectedRegionLoopRejection(source)
  const error = new Error(`Projected point geometry ${source.reference.geometryId} cannot define a profile boundary.`) as Error & {
    code?: string
  }
  error.code = rejection.code
  throw error
}

function getLoopSegmentTraversal(
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  segment: RegionBoundarySegmentRecord,
  geometry: SolvedSketchEntityGeometryRecord,
): BoundarySegmentGeometry {
  const baseGeometry = toBoundarySegmentGeometry(plane, geometry)

  if (baseGeometry.kind === 'closed') {
    return baseGeometry
  }

  if (segment.startPointId === null || segment.endPointId === null) {
    return baseGeometry
  }

  const startPoint = getSolvedBoundaryPointPosition(plane, sketch, segment.startPointId)
  const endPoint = getSolvedBoundaryPointPosition(plane, sketch, segment.endPointId)

  if (arePointsCoincident(baseGeometry.start, startPoint) && arePointsCoincident(baseGeometry.end, endPoint)) {
    return baseGeometry
  }

  if (arePointsCoincident(baseGeometry.start, endPoint) && arePointsCoincident(baseGeometry.end, startPoint)) {
    return {
      kind: 'open',
      segmentId: baseGeometry.segmentId,
      start: baseGeometry.end,
      end: baseGeometry.start,
    }
  }

  throw new Error(`Region loop segment for entity ${geometry.entityId} does not match authored traversal endpoints.`)
}

function getSolvedBoundaryPointPosition(
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  pointId: string,
) {
  const solvedPoint = sketch.solvedSnapshot.solvedPoints.find((entry) => entry.pointId === pointId)

  if (solvedPoint) {
    return mapSketchPointToWorld(plane, solvedPoint.solvedPosition)
  }

  const authoredPoint = sketch.definition.points.find((entry) => entry.pointId === pointId)

  if (!authoredPoint) {
    throw new Error(`Boundary point ${pointId} is not authored on sketch ${sketch.sketchId}.`)
  }

  return mapSketchPointToWorld(plane, authoredPoint.position)
}

function orientEdgeForLoop(
  oc: OpenCascadeInstance,
  edge: InstanceType<OpenCascadeInstance['TopoDS_Edge']>,
  loopGeometry: BoundarySegmentGeometry,
  segment: RegionBoundarySegmentRecord,
) {
  if (loopGeometry.kind !== 'open' || segment.startPointId === null || segment.endPointId === null) {
    return edge
  }

  const curve = new oc.BRepAdaptor_Curve_2(edge)
  const first = curve.Value(curve.FirstParameter())
  const last = curve.Value(curve.LastParameter())
  const currentStart = toVec3FromGpPoint(first)
  const currentEnd = toVec3FromGpPoint(last)

  if (arePointsCoincident(currentStart, loopGeometry.start) && arePointsCoincident(currentEnd, loopGeometry.end)) {
    return edge
  }

  if (arePointsCoincident(currentStart, loopGeometry.end) && arePointsCoincident(currentEnd, loopGeometry.start)) {
    return oc.TopoDS.Edge_1(edge.Reversed())
  }

  throw new Error(`Built OCC edge for segment ${loopGeometry.segmentId} does not match loop traversal geometry.`)
}

function buildProjectedBoundaryEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  source: Extract<RegionBoundarySegmentRecord['source'], { kind: 'projectedGeometry' }>,
  geometry: ProjectedSketchReferenceGeometry,
  loopGeometry: BoundarySegmentGeometry,
  loopRole: RegionRecord['loops'][number]['role'],
  traversalDirection: RegionBoundarySegmentRecord['traversalDirection'],
) {
  switch (geometry.kind) {
    case 'lineSegment':
      if (loopGeometry.kind !== 'open') {
        throw new Error(`Projected line ${source.reference.geometryId} did not resolve to open loop geometry.`)
      }
      return buildLineEdgeFromWorld(oc, loopGeometry.start, loopGeometry.end)
    case 'circle': {
      const edge = buildCircleEdgeFromSketchGeometry(oc, plane, geometry.centerPosition, geometry.radius)
      return loopRole === 'inner'
        ? oc.TopoDS.Edge_1(edge.Reversed())
        : edge
    }
    case 'arc': {
      const edge = buildArcEdgeFromSketchGeometry(
        oc,
        plane,
        geometry.startPosition,
        geometry.endPosition,
        geometry.centerPosition,
        geometry.sweepDirection,
        `projected geometry ${source.reference.geometryId}`,
      )
      return traversalDirection === 'reverse'
        ? oc.TopoDS.Edge_1(edge.Reversed())
        : edge
    }
    case 'point':
      throw new Error(`Projected point geometry ${source.reference.geometryId} cannot define a profile boundary.`)
  }
}

function buildLoopWire(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  loop: RegionRecord['loops'][number],
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
) {
  const loopGeometry: BoundarySegmentGeometry[] = []
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1()

  for (const segment of loop.segments) {
    if (!isProjectedRegionSegmentSourceSupported(segment.source)) {
      throw new Error('Unsupported region segment source.')
    }

    if (segment.source.kind === 'projectedGeometry') {
      const projectedGeometry = resolveProjectedBoundaryGeometry(sketch, projectedReferences, segment.source)
      const segmentGeometry = toProjectedBoundarySegmentGeometry(
        plane,
        segment.source,
        projectedGeometry,
        segment.traversalDirection,
      )
      loopGeometry.push(segmentGeometry)
      wireBuilder.Add_1(buildProjectedBoundaryEdge(
        oc,
        plane,
        segment.source,
        projectedGeometry,
        segmentGeometry,
        loop.role,
        segment.traversalDirection,
      ))
    } else {
      const geometry = getSolvedEntityGeometry(sketch, segment.source.entityId)
      assertLoopSegmentOwnership(sketch, geometry)
      const segmentGeometry = getLoopSegmentTraversal(plane, sketch, segment, geometry)
      loopGeometry.push(segmentGeometry)

      switch (geometry.kind) {
        case 'lineSegment': {
          const edge = orientEdgeForLoop(oc, buildLineEdge(oc, plane, geometry), segmentGeometry, segment)
          wireBuilder.Add_1(edge)
          break
        }
        case 'circle': {
          const edge = buildCircleEdge(oc, plane, geometry)
          wireBuilder.Add_1(
            loop.role === 'inner'
              ? oc.TopoDS.Edge_1(edge.Reversed())
              : edge,
          )
          break
        }
        case 'arc': {
          const edge = orientEdgeForLoop(oc, buildArcEdge(oc, plane, geometry), segmentGeometry, segment)
          wireBuilder.Add_1(edge)
          break
        }
        case 'point':
          throw new Error(`Point entity ${geometry.entityId} cannot define a profile boundary.`)
      }
    }
  }

  assertLoopGeometryIsClosed(loop, loopGeometry)

  if (!wireBuilder.IsDone()) {
    throw new Error(`Failed to build OCC wire for region loop ${loop.loopId}.`)
  }

  return wireBuilder.Wire()
}

export function buildRegionProfileFace(
  oc: OpenCascadeInstance,
  snapshotSketch: { plane: SketchPlaneDefinition; sketch: SketchRecord; projectedReferences?: readonly ProjectedSketchReferenceRecord[] },
  region: RegionRecord,
): BuiltSketchProfileFace {
  assertRegionBelongsToSketch(snapshotSketch.sketch, region)

  const outerLoops = region.loops.filter((loop) => loop.role === 'outer')

  if (outerLoops.length !== 1) {
    throw new Error(`Region ${region.regionId} must contain exactly one outer loop.`)
  }

  const [outerLoop] = outerLoops

  assertLoopCanBuildProfile(snapshotSketch.sketch, region, outerLoop)

  const plane = snapshotSketch.plane
  const projectedReferences = snapshotSketch.projectedReferences ?? snapshotSketch.sketch.projectedReferences ?? []
  const planeShape = toGpPlane(oc, plane)
  const outerWire = buildLoopWire(oc, plane, snapshotSketch.sketch, outerLoop, projectedReferences)
  const faceBuilder = new oc.BRepBuilderAPI_MakeFace_16(planeShape, outerWire, true)

  for (const innerLoop of region.loops.filter((loop) => loop.role === 'inner')) {
    assertLoopCanBuildProfile(snapshotSketch.sketch, region, innerLoop)
    faceBuilder.Add(buildLoopWire(oc, plane, snapshotSketch.sketch, innerLoop, projectedReferences))
  }

  if (!faceBuilder.IsDone()) {
    throw new Error(`Failed to build OCC face for region ${region.regionId}.`)
  }

  return {
    face: faceBuilder.Face(),
    plane,
    normal: plane.frame.normal,
  }
}

export function getExtrusionNormalForSketchProfile(
  plane: SketchPlaneDefinition,
  direction: 'positive' | 'negative',
): Vec3 {
  return direction === 'positive' ? plane.frame.normal : negate(plane.frame.normal)
}

export function getExtrusionNormalForPlanarFace(
  oc: OpenCascadeInstance,
  face: InstanceType<OpenCascadeInstance['TopoDS_Face']>,
  direction: 'positive' | 'negative',
) {
  const { frame } = extractPlanarFaceData(oc, face, 'Face-backed profile requires a planar face.')
  const normal = frame.normal as Vec3
  return direction === 'positive' ? normal : negate(normal)
}

export function buildConstructionPlaneFromPlanarFace(
  oc: OpenCascadeInstance,
  face: InstanceType<OpenCascadeInstance['TopoDS_Face']>,
  faceId: FaceId,
  support: SketchPlaneDefinition['support'],
): SketchPlaneDefinition {
  return buildConstructionPlaneFromPlanarFaceFromPlaneUtility(oc, face, faceId, support)
}

export function buildAxisFromLineEdge(
  oc: OpenCascadeInstance,
  edge: InstanceType<OpenCascadeInstance['TopoDS_Edge']>,
) {
  const curve = new oc.BRepAdaptor_Curve_2(edge)

  if (curve.GetType() !== oc.GeomAbs_CurveType.GeomAbs_Line) {
    throw new Error('Revolve axis edges must resolve to linear OCC edges.')
  }

  return curve.Line().Position()
}

export function buildCircleAxis(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  center: Vec3,
  radius: number,
) {
  const normal = toGpDir(oc, plane.frame.normal)
  return new oc.GC_MakeCircle_6(toGpPnt(oc, center), normal, radius)
}
