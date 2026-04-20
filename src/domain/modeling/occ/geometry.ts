export {
  add,
  cross,
  dot,
  magnitude,
  negate,
  normalize,
  scale,
  subtract,
  type Vec3,
} from '@/domain/modeling/occ/math'

export {
  createPlaneAxes,
  extractPlanarFaceData,
  getSignedDistanceToSketchPlane,
  mapSketchPointToWorld,
  mapWorldPointToSketch,
  toGpAx1,
  toGpAx3,
  toGpDir,
  toGpPlane,
  toGpPnt,
  toGpVec,
  toSketchPlaneFrameFromGpAx3,
  toSketchPlaneFrameFromGpPlane,
  toVec3FromGpPoint,
  type ExtractedPlanarFaceData,
  type OpenCascadePlaneAxes,
  type SketchPlaneFrameInput,
} from '@/domain/modeling/occ/planes'

import { add, cross, dot, magnitude, normalize, scale, type Vec3 } from '@/domain/modeling/occ/math'

export function midpointOnArc(
  startPoint: Vec3,
  endPoint: Vec3,
  centerPoint: Vec3,
  planeNormal: Vec3,
  sweepDirection: 'clockwise' | 'counterClockwise',
): Vec3 {
  const startVector = normalize([
    startPoint[0] - centerPoint[0],
    startPoint[1] - centerPoint[1],
    startPoint[2] - centerPoint[2],
  ])
  const endVector = normalize([
    endPoint[0] - centerPoint[0],
    endPoint[1] - centerPoint[1],
    endPoint[2] - centerPoint[2],
  ])
  let cosine = dot(startVector, endVector)
  cosine = Math.max(-1, Math.min(1, cosine))
  let sweep = Math.acos(cosine)
  const orientation = dot(cross(startVector, endVector), planeNormal)

  if (sweepDirection === 'counterClockwise') {
    if (orientation < 0) {
      sweep = Math.PI * 2 - sweep
    }
  } else if (orientation > 0) {
    sweep = Math.PI * 2 - sweep
  }

  const halfSweep = sweep / 2
  const tangentDirection = sweepDirection === 'counterClockwise'
    ? normalize(cross(planeNormal, startVector))
    : normalize(cross(startVector, planeNormal))
  const midVector = normalize(add(scale(startVector, Math.cos(halfSweep)), scale(tangentDirection, Math.sin(halfSweep))))
  const radius = magnitude([
    startPoint[0] - centerPoint[0],
    startPoint[1] - centerPoint[1],
    startPoint[2] - centerPoint[2],
  ])

  return add(centerPoint, scale(midVector, radius))
}
