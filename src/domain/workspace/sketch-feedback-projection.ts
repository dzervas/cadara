import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import type { SketchToolAnchorDescriptor } from '@/domain/sketch-tools/editor-schema'
import {
  mapSketchPointToWorkspaceWorld,
  type WorkspaceVec3,
} from '@/domain/workspace/sketch-plane-mapping'

export interface ViewportSize {
  width: number
  height: number
}

export interface ProjectedViewportPoint {
  x: number
  y: number
  z: number
}

export interface SketchFeedbackScreenPoint {
  x: number
  y: number
}

export function resolveSketchFeedbackAnchorWorldPoint(
  anchor: SketchToolAnchorDescriptor,
  plane: SketchPlaneDefinition,
): WorkspaceVec3 {
  if (anchor.kind === 'worldPoint') {
    return anchor.point
  }

  return mapSketchPointToWorkspaceWorld(plane, anchor.point)
}

export function projectSketchFeedbackAnchor(input: {
  anchor: SketchToolAnchorDescriptor
  plane: SketchPlaneDefinition
  viewport: ViewportSize
  projectWorldPoint: (point: WorkspaceVec3) => ProjectedViewportPoint
}): SketchFeedbackScreenPoint | null {
  if (input.viewport.width <= 0 || input.viewport.height <= 0) {
    return null
  }

  const projected = input.projectWorldPoint(resolveSketchFeedbackAnchorWorldPoint(input.anchor, input.plane))

  if (projected.z < -1 || projected.z > 1) {
    return null
  }

  const offset = input.anchor.offset ?? { x: 0, y: 0 }

  return {
    x: ((projected.x + 1) / 2) * input.viewport.width + offset.x,
    y: ((1 - projected.y) / 2) * input.viewport.height + offset.y,
  }
}
