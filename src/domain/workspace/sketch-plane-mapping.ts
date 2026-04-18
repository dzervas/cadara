import type { SketchPlaneDefinition, SketchPlaneFrame } from '@/contracts/shared/sketch-plane'
import type { SketchPoint2D } from '@/contracts/sketch/schema'

const UNIT_TOLERANCE = 1e-6
const ORTHOGONAL_TOLERANCE = 1e-6

export type WorkspaceVec3 = readonly [number, number, number]

export type SketchPlaneFrameInput = SketchPlaneDefinition | SketchPlaneFrame

function getFrame(input: SketchPlaneFrameInput): SketchPlaneFrame {
  return 'frame' in input ? input.frame : input
}

function dot(left: WorkspaceVec3, right: WorkspaceVec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: WorkspaceVec3, right: WorkspaceVec3): WorkspaceVec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function magnitude(vector: WorkspaceVec3) {
  return Math.hypot(vector[0], vector[1], vector[2])
}

function normalize(vector: WorkspaceVec3): WorkspaceVec3 {
  const length = magnitude(vector)

  if (length === 0) {
    throw new Error('Cannot normalize a zero-length vector.')
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function assertUnitLength(vector: WorkspaceVec3, label: string) {
  if (Math.abs(magnitude(vector) - 1) > UNIT_TOLERANCE) {
    throw new Error(`Sketch plane frame ${label} must be unit length.`)
  }
}

function assertValidSketchPlaneFrame(frame: SketchPlaneFrame) {
  assertUnitLength(frame.xAxis, 'xAxis')
  assertUnitLength(frame.yAxis, 'yAxis')
  assertUnitLength(frame.normal, 'normal')

  if (Math.abs(dot(frame.xAxis, frame.yAxis)) > ORTHOGONAL_TOLERANCE) {
    throw new Error('Sketch plane frame xAxis and yAxis must be orthogonal.')
  }

  if (Math.abs(dot(frame.xAxis, frame.normal)) > ORTHOGONAL_TOLERANCE) {
    throw new Error('Sketch plane frame xAxis and normal must be orthogonal.')
  }

  if (Math.abs(dot(frame.yAxis, frame.normal)) > ORTHOGONAL_TOLERANCE) {
    throw new Error('Sketch plane frame yAxis and normal must be orthogonal.')
  }

  if (dot(normalize(cross(frame.xAxis, frame.yAxis)), frame.normal) < 1 - ORTHOGONAL_TOLERANCE) {
    throw new Error('Sketch plane frame must be right-handed with normal = xAxis x yAxis.')
  }
}

export function mapSketchPointToWorkspaceWorld(
  input: SketchPlaneFrameInput,
  point: SketchPoint2D,
): WorkspaceVec3 {
  const frame = getFrame(input)
  assertValidSketchPlaneFrame(frame)

  return [
    frame.origin[0] + frame.xAxis[0] * point[0] + frame.yAxis[0] * point[1],
    frame.origin[1] + frame.xAxis[1] * point[0] + frame.yAxis[1] * point[1],
    frame.origin[2] + frame.xAxis[2] * point[0] + frame.yAxis[2] * point[1],
  ]
}

export function mapWorldPointToWorkspaceSketch(
  input: SketchPlaneFrameInput,
  point: WorkspaceVec3,
): SketchPoint2D {
  const frame = getFrame(input)
  assertValidSketchPlaneFrame(frame)
  const relative: WorkspaceVec3 = [
    point[0] - frame.origin[0],
    point[1] - frame.origin[1],
    point[2] - frame.origin[2],
  ]

  return [dot(relative, frame.xAxis), dot(relative, frame.yAxis)]
}
