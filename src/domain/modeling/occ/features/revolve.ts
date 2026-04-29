import type {
  RevolveEndCondition,
  RevolveFeatureParameters,
} from '@/contracts/modeling/schema'
import { getRevolveFeatureExtent } from '@/contracts/modeling/feature-extents'
import type { FeatureId } from '@/contracts/shared/ids'
import {
  getConstructionBackedRevolveAxisRejectionReason,
  OCC_CONTRACT_GAP_CODES,
} from '@/domain/modeling/occ/implementation-policy'
import type { Vec3 } from '@/domain/modeling/occ/math'
import {
  buildAxisFromLineEdge,
  buildRegionProfileFace,
  getExtrusionNormalForPlanarFace,
} from '@/domain/modeling/occ/sketch-profile'
import { cross, dot, magnitude, normalize, scale, subtract, toVec3FromGpPoint } from '@/domain/modeling/occ/geometry'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  requireSketchSnapshot,
  requireRegion,
  requireBody,
  requireFace,
  requireEdge,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from '@/domain/modeling/occ/features/shared'
import { applyBooleanPolicy } from '@/domain/modeling/occ/features/boolean-operations'
import { getShapeVertexPoints } from '@/domain/modeling/occ/features/extrude'

function buildRevolveFeatureShape(
  context: OccFeatureExecutionContext,
  parameters: RevolveFeatureParameters,
) {
  if (parameters.axis.kind === 'construction') {
    throw new Error(`${OCC_CONTRACT_GAP_CODES.constructionRevolveAxisUnsupported}: ${getConstructionBackedRevolveAxisRejectionReason()}`)
  }

  if (parameters.profiles.length > 1) {
    throw new Error('unsupported-profile-group: OCC revolve does not support multi-profile groups yet.')
  }

  const profile = parameters.profiles[0]
  let profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>

  if (profile.kind === 'region') {
    const sketch = requireSketchSnapshot(context, profile.sketchId)
    const region = requireRegion(sketch, profile.regionId)
    profileShape = buildRegionProfileFace(context.oc, { plane: sketch.plane, sketch: sketch.sketch }, region).face
  } else {
    const body = requireBody(context, profile.bodyId)
    const face = requireFace(body, profile.faceId)
    getExtrusionNormalForPlanarFace(context.oc, face, 'positive')
    profileShape = face
  }

  const axisBody = requireBody(context, parameters.axis.bodyId)
  const axisEdge = requireEdge(axisBody, parameters.axis.edgeId)
  const axis = buildAxisFromLineEdge(context.oc, axisEdge)

  if (parameters.startAngle !== 0) {
    const rotation = new context.oc.gp_Trsf_1()
    rotation.SetRotation_1(axis, parameters.startAngle)
    const transform = new context.oc.BRepBuilderAPI_Transform_2(profileShape, rotation, true)
    transform.Build(new context.oc.Message_ProgressRange_1())

    if (!transform.IsDone()) {
      throw new Error('OCC revolve pre-rotation transform failed.')
    }

    profileShape = transform.Shape()
  }

  const extent = getRevolveFeatureExtent(parameters)
  const ends: RevolveEndCondition[] = extent.mode === 'twoSide'
    ? [extent.firstEnd, extent.secondEnd]
    : extent.mode === 'symmetric'
      ? [extent.end, { ...extent.end, direction: extent.end.direction === 'counterClockwise' ? 'clockwise' : 'counterClockwise' }]
      : [extent.end]
  const shapes = ends.map((end) => buildRevolveEndShape(context, profileShape, axis, end))

  if (shapes.length === 1) {
    return shapes[0]!
  }

  const builder = new context.oc.BRep_Builder()
  const compound = new context.oc.TopoDS_Compound()
  builder.MakeCompound(compound)
  for (const shape of shapes) {
    builder.Add(compound, shape)
  }

  return compound
}

function getAxisOriginAndDirection(axis: InstanceType<OpenCascadeInstance['gp_Ax1_2']>) {
  return {
    origin: toVec3FromGpPoint(axis.Location()),
    direction: normalize(toVec3FromGpPoint(axis.Direction())),
  }
}

function getPerpendicularAxisVector(point: Vec3, axisOrigin: Vec3, axisDirection: Vec3) {
  const relative = subtract(point, axisOrigin)
  const axial = scale(axisDirection, dot(relative, axisDirection))
  return subtract(relative, axial)
}

function getRevolveReferenceVector(
  oc: OpenCascadeInstance,
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  axisOrigin: Vec3,
  axisDirection: Vec3,
  tolerance: number,
) {
  const points = getShapeVertexPoints(oc, profileShape)

  if (points.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC revolve profile has no vertices for angular target resolution.')
  }

  const centroid = scale(
    points.reduce((sum, point) => [
      sum[0] + point[0],
      sum[1] + point[1],
      sum[2] + point[2],
    ] as Vec3, [0, 0, 0]),
    1 / points.length,
  )
  const centroidVector = getPerpendicularAxisVector(centroid, axisOrigin, axisDirection)

  if (magnitude(centroidVector) > tolerance) {
    return normalize(centroidVector)
  }

  const radialPoint = points.find((point) =>
    magnitude(getPerpendicularAxisVector(point, axisOrigin, axisDirection)) > tolerance,
  )

  if (!radialPoint) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC revolve profile is coincident with the axis.')
  }

  return normalize(getPerpendicularAxisVector(radialPoint, axisOrigin, axisDirection))
}

function getAngleAroundAxis(
  startVector: Vec3,
  targetVector: Vec3,
  axisDirection: Vec3,
  direction: Exclude<RevolveEndCondition, { kind: 'full' }>['direction'],
) {
  const start = normalize(startVector)
  const target = normalize(targetVector)
  const cosine = Math.max(-1, Math.min(1, dot(start, target)))
  let angle = Math.acos(cosine)
  const orientation = dot(cross(start, target), axisDirection)

  if (direction === 'counterClockwise') {
    if (orientation < 0) {
      angle = Math.PI * 2 - angle
    }
  } else if (orientation > 0) {
    angle = Math.PI * 2 - angle
  }

  return angle
}

function getRevolveTargetPointCandidates(
  context: OccFeatureExecutionContext,
  end: Exclude<RevolveEndCondition, { kind: 'blind' | 'full' }>,
) {
  if (end.kind === 'upToNext') {
    return context.bodies.flatMap((body) =>
      getShapeVertexPoints(context.oc, body.shape).map((point) => ({
        point,
        source: body.bodyId,
      })),
    )
  }

  if (end.kind === 'upToFace') {
    const body = requireBody(context, end.target.bodyId)
    const face = requireFace(body, end.target.faceId)
    return getShapeVertexPoints(context.oc, face).map((point) => ({
      point,
      source: `${end.target.bodyId}:${end.target.faceId}`,
    }))
  }

  if (end.kind === 'upToPart') {
    const body = requireBody(context, end.target.bodyId)
    return getShapeVertexPoints(context.oc, body.shape).map((point) => ({
      point,
      source: body.bodyId,
    }))
  }

  const body = requireBody(context, end.target.bodyId)
  const vertex = body.verticesById.get(end.target.vertexId)
  if (!vertex) {
    throw new Error(`Vertex ${end.target.vertexId} does not resolve on body ${end.target.bodyId}.`)
  }

  return [{
    point: toVec3FromGpPoint(context.oc.BRep_Tool.Pnt(vertex)),
    source: `${end.target.bodyId}:${end.target.vertexId}`,
  }]
}

function selectNearestForwardAngle(
  candidates: Array<{ angle: number; source: string }>,
  tolerance: number,
  label: string,
) {
  const sortedCandidates = [...candidates].sort((left, right) => left.angle - right.angle)
  const nearest = sortedCandidates[0]

  if (!nearest) {
    return null
  }

  const matchingSources = new Set(
    sortedCandidates
      .filter((candidate) => Math.abs(candidate.angle - nearest.angle) <= tolerance)
      .map((candidate) => candidate.source),
  )

  if (matchingSources.size > 1) {
    throw new Error(`advanced-feature-unsupported-kernel-case: OCC ${label} termination is ambiguous between multiple bodies.`)
  }

  return nearest.angle
}

function resolveRevolveTargetAngle(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  axis: InstanceType<OpenCascadeInstance['gp_Ax1_2']>,
  end: Exclude<RevolveEndCondition, { kind: 'blind' | 'full' }>,
) {
  const { origin, direction: axisDirection } = getAxisOriginAndDirection(axis)
  const startVector = getRevolveReferenceVector(context.oc, profileShape, origin, axisDirection, context.modelingTolerance)
  const angularTolerance = Math.max(context.modelingTolerance * 0.01, 1e-7)
  const candidates = getRevolveTargetPointCandidates(context, end).flatMap((candidate) => {
    const targetVector = getPerpendicularAxisVector(candidate.point, origin, axisDirection)

    if (magnitude(targetVector) <= context.modelingTolerance) {
      return []
    }

    const angle = getAngleAroundAxis(startVector, targetVector, axisDirection, end.direction)
    if (angle <= angularTolerance || angle >= Math.PI * 2 - angularTolerance) {
      return []
    }

    return [{ angle, source: candidate.source }]
  })

  return selectNearestForwardAngle(candidates, angularTolerance, 'revolve up-to')
}

function resolveRevolveAngle(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  axis: InstanceType<OpenCascadeInstance['gp_Ax1_2']>,
  end: RevolveEndCondition,
) {
  if (end.kind === 'full') {
    return Math.PI * 2
  }

  if (end.kind === 'blind') {
    const angle = end.angle as number
    if (angle <= 0) {
      throw new Error('Revolve end angle must be positive.')
    }
    return angle
  }

  const targetAngle = resolveRevolveTargetAngle(context, profileShape, axis, end)
  if (targetAngle === null) {
    throw new Error(`advanced-feature-unsupported-kernel-case: OCC revolve ${end.kind} found no terminating geometry.`)
  }

  const offset = (end.offset?.angle ?? 0) as number
  const signedOffset = end.offset?.direction === 'extend' ? offset : -offset
  const angle = targetAngle + signedOffset
  if (angle <= context.modelingTolerance || angle > Math.PI * 2 + context.modelingTolerance) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC revolve termination is impossible after offset.')
  }

  return angle
}

function buildRevolveEndShape(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  axis: InstanceType<OpenCascadeInstance['gp_Ax1_2']>,
  end: RevolveEndCondition,
) {
  const angle = resolveRevolveAngle(context, profileShape, axis, end)
  const signedExtent = end.kind !== 'full' && end.direction === 'clockwise'
    ? -angle
    : angle

  const revol = new context.oc.BRepPrimAPI_MakeRevol_1(
    profileShape,
    axis,
    signedExtent,
    false,
  )
  revol.Build(new context.oc.Message_ProgressRange_1())

  if (!revol.IsDone()) {
    throw new Error('OCC revolve build failed.')
  }

  return revol.Shape()
}

export function executeRevolveFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: RevolveFeatureParameters,
): OccFeatureExecutionResult {
  const featureShape = buildRevolveFeatureShape(context, parameters)
  const result = applyBooleanPolicy(context, ownerFeatureId, parameters.operation, parameters.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}
