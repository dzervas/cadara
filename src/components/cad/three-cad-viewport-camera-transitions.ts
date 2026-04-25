import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import type { ViewportCameraControls } from '@/domain/workspace/viewport-camera-controls'
import { computeSketchCameraFrame } from '@/domain/workspace/sketch-camera-framing'
import {
  captureViewportCameraFrame,
  cloneViewportCameraFrame,
  type ViewportCamera,
  type ViewportCameraFrame,
} from '@/domain/workspace/viewport-projection'
import {
  createViewNavigationCameraFrame,
  getViewNavigationDirection,
  type ViewNavigationPresetId,
} from '@/domain/workspace/view-navigation'

export interface ViewportSketchCameraSession {
  sketchId: string | null
  plane: SketchPlaneDefinition
}

export interface SketchCameraTransitionState {
  activeSessionToken: string | null
  preSketchFrame: ViewportCameraFrame | null
}

interface SketchCameraTransitionResolution {
  fromFrame?: ViewportCameraFrame
  state: SketchCameraTransitionState
  targetFrame: ViewportCameraFrame | null
}

export function requestViewCubeCameraTransition(input: {
  presetId: ViewNavigationPresetId
  camera: ViewportCamera | null
  controls: ViewportCameraControls | null
  requestTransition: (targetFrame: ViewportCameraFrame, fromFrame?: ViewportCameraFrame) => void
}) {
  const { camera, controls, presetId, requestTransition } = input

  if (!camera || !controls) {
    return null
  }

  const fromFrame = captureViewportCameraFrame(camera, controls)
  const targetFrame = createViewNavigationCameraFrame({
    camera,
    controls,
    direction: getViewNavigationDirection(presetId),
  })

  requestTransition(targetFrame, fromFrame)

  return {
    fromFrame,
    targetFrame,
  }
}

export function resolveSketchCameraTransition(input: {
  camera: ViewportCamera
  controls: ViewportCameraControls
  sketchSession: ViewportSketchCameraSession | null
  sketchDisplayRenderables: SketchSessionDisplayRenderable[]
  state: SketchCameraTransitionState
}): SketchCameraTransitionResolution {
  if (!input.sketchSession) {
    if (!input.state.preSketchFrame) {
      return {
        state: {
          activeSessionToken: null,
          preSketchFrame: null,
        },
        targetFrame: null,
      }
    }

    return {
      fromFrame: captureViewportCameraFrame(input.camera, input.controls),
      state: {
        activeSessionToken: null,
        preSketchFrame: null,
      },
      targetFrame: cloneViewportCameraFrame(input.state.preSketchFrame),
    }
  }

  const nextToken = getSketchSessionCameraToken(input.sketchSession)
  if (input.state.activeSessionToken === nextToken) {
    return {
      state: input.state,
      targetFrame: null,
    }
  }

  const fromFrame = captureViewportCameraFrame(input.camera, input.controls)

  return {
    fromFrame,
    state: {
      activeSessionToken: nextToken,
      preSketchFrame: cloneViewportCameraFrame(fromFrame),
    },
    targetFrame: computeSketchCameraFrame({
      camera: input.camera,
      plane: input.sketchSession.plane,
      renderables: input.sketchDisplayRenderables,
    }),
  }
}

function getSketchSessionCameraToken(session: ViewportSketchCameraSession) {
  const support = session.plane.support
  const supportToken = support.kind === 'construction'
    ? support.constructionId
    : `${support.bodyId}:${support.faceId}`
  const origin = session.plane.frame.origin.join(',')

  return `${session.sketchId ?? 'draft'}:${support.kind}:${supportToken}:${origin}`
}
