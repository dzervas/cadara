import type { ToolId } from '@/core/tools/tool-registry'
import type { PrimitiveRef } from '@/core/editor/schema'
import type { SketchPlaneSupportRef } from '@/contracts/shared/sketch-plane'
import type { CommandSessionId, RequestId } from '@/contracts/shared/ids'
import type { SketchSessionState } from '@/domain/editor/sketch-session'
import type { EditorCommandToolId, EditorState } from './types'

export function nextCommandSessionId(state: EditorState, toolId: EditorCommandToolId) {
  return `command_${toolId}-${state.nextCommandSequence}` as CommandSessionId
}

export function nextRequestId(state: EditorState, scope: string) {
  return `request_${scope}-${state.nextRequestSequence}` as RequestId
}

export const EDITOR_SKETCH_REFERENCE_PROJECTION_TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
} as const

export function deriveSketchPointFromWorld(
  _plane: SketchSessionState['plane'],
  point: readonly [number, number],
) {
  return point
}

export function assertSketchPlaneSupport(target: PrimitiveRef): SketchPlaneSupportRef {
  if (target.kind === 'construction' || target.kind === 'face') {
    return target
  }

  throw new Error('Sketch commits require a construction plane or planar face target.')
}

export function isFeatureTool(toolId: EditorCommandToolId): toolId is Extract<ToolId, 'extrude' | 'revolve' | 'fillet' | 'shell' | 'plane' | 'sweep' | 'loft' | 'chamfer' | 'thicken' | 'combine' | 'split' | 'deleteSolid' | 'mirror' | 'transform'> {
  return toolId === 'extrude'
    || toolId === 'revolve'
    || toolId === 'fillet'
    || toolId === 'shell'
    || toolId === 'plane'
    || toolId === 'sweep'
    || toolId === 'loft'
    || toolId === 'chamfer'
    || toolId === 'thicken'
    || toolId === 'combine'
    || toolId === 'split'
    || toolId === 'deleteSolid'
    || toolId === 'mirror'
    || toolId === 'transform'
}

export function isPassiveSketchTool(toolId: ToolId): toolId is Extract<ToolId, 'fill' | 'stroke'> {
  return toolId === 'fill'
    || toolId === 'stroke'
}
