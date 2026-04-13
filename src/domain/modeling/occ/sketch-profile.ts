import type {
  RegionRecord,
  RegionBoundarySegmentRecord,
  SolvedSketchEntityGeometryRecord,
  SketchRecord,
} from '@/contracts/sketch/schema'
import type { FaceId } from '@/contracts/shared/ids'
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
  entityId: string
  start: Vec3
  end: Vec3
}

interface ClosedBoundarySegmentGeometry {
  kind: 'closed'
  entityId: string
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
        entityId: geometry.entityId,
        start: mapSketchPointToWorld(plane, geometry.startPosition),
        end: mapSketchPointToWorld(plane, geometry.endPosition),
      }
    case 'arc':
      return {
        kind: 'open',
        entityId: geometry.entityId,
        start: mapSketchPointToWorld(plane, geometry.startPosition),
        end: mapSketchPointToWorld(plane, geometry.endPosition),
      }
    case 'circle':
      return {
        kind: 'closed',
        entityId: geometry.entityId,
      }
    case 'point':
      throw new Error(`Point entity ${geometry.entityId} cannot define a profile boundary.`)
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
      throw new Error(`Closed curve entity ${segment.entityId} cannot participate in multi-segment loop ${loop.loopId}.`)
    }
  }

  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index]
    const next = segments[(index + 1) % segments.length]

    if (current.kind !== 'open' || next.kind !== 'open') {
      throw new Error(`Region loop ${loop.loopId} contains unsupported mixed segment topology.`)
    }

    if (!arePointsCoincident(current.end, next.start)) {
      throw new Error(`Region loop ${loop.loopId} is not geometrically closed between entities ${current.entityId} and ${next.entityId}.`)
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
  const start = toGpPnt(oc, mapSketchPointToWorld(plane, geometry.startPosition))
  const end = toGpPnt(oc, mapSketchPointToWorld(plane, geometry.endPosition))
  const builder = new oc.BRepBuilderAPI_MakeEdge_3(start, end)
  return builder.Edge()
}

function buildCircleEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  geometry: Extract<SolvedSketchEntityGeometryRecord, { kind: 'circle' }>,
) {
  const center = mapSketchPointToWorld(plane, geometry.centerPosition)
  const axis = new oc.gp_Ax2_2(
    toGpPnt(oc, center),
    toGpDir(oc, plane.frame.normal),
    toGpDir(oc, plane.frame.xAxis),
  )
  const circle = new oc.gp_Circ_2(axis, geometry.solvedRadius)
  const builder = new oc.BRepBuilderAPI_MakeEdge_8(circle)
  return builder.Edge()
}

function buildArcEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  geometry: Extract<SolvedSketchEntityGeometryRecord, { kind: 'arc' }>,
) {
  const start = mapSketchPointToWorld(plane, geometry.startPosition)
  const end = mapSketchPointToWorld(plane, geometry.endPosition)
  const midpoint = midpointOnArc(
    start,
    end,
    mapSketchPointToWorld(plane, geometry.centerPosition),
    plane.frame.normal,
    geometry.sweepDirection,
  )
  const arc = new oc.GC_MakeArcOfCircle_4(
    toGpPnt(oc, start),
    toGpPnt(oc, midpoint),
    toGpPnt(oc, end),
  )

  if (!arc.IsDone()) {
    throw new Error(`Failed to build OCC arc for sketch entity ${geometry.entityId}.`)
  }

  const curveHandle = new oc.Handle_Geom_Curve_2(arc.Value().get())
  const builder = new oc.BRepBuilderAPI_MakeEdge_24(curveHandle)
  return builder.Edge()
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
      entityId: baseGeometry.entityId,
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

  throw new Error(`Built OCC edge for entity ${loopGeometry.entityId} does not match loop traversal geometry.`)
}

function buildLoopWire(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  sketch: SketchRecord,
  loop: RegionRecord['loops'][number],
) {
  const loopGeometry: BoundarySegmentGeometry[] = []
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1()

  for (const segment of loop.segments) {
    // Phase 0 red line: committed sketch payloads do not preserve enough
    // projected-geometry data to rebuild OCC profile wires faithfully.
    if (!isProjectedRegionSegmentSourceSupported(segment.source)) {
      const rejection = createProjectedRegionLoopRejection(segment.source)
      const error = new Error(getProjectedRegionLoopRejectionMessage(segment.source)) as Error & {
        code?: string
      }
      error.code = rejection.code
      throw error
    }

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
        wireBuilder.Add_1(edge)
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

  assertLoopGeometryIsClosed(loop, loopGeometry)

  if (!wireBuilder.IsDone()) {
    throw new Error(`Failed to build OCC wire for region loop ${loop.loopId}.`)
  }

  return wireBuilder.Wire()
}

export function buildRegionProfileFace(
  oc: OpenCascadeInstance,
  snapshotSketch: { plane: SketchPlaneDefinition; sketch: SketchRecord },
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
  const planeShape = toGpPlane(oc, plane)
  const outerWire = buildLoopWire(oc, plane, snapshotSketch.sketch, outerLoop)
  const faceBuilder = new oc.BRepBuilderAPI_MakeFace_16(planeShape, outerWire, true)

  for (const innerLoop of region.loops.filter((loop) => loop.role === 'inner')) {
    assertLoopCanBuildProfile(snapshotSketch.sketch, region, innerLoop)
    faceBuilder.Add(buildLoopWire(oc, plane, snapshotSketch.sketch, innerLoop))
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
