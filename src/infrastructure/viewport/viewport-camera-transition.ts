import * as THREE from 'three'

import {
  cloneViewportCameraFrame,
  interpolateViewportCameraFrame,
  type ViewportCameraFrame,
} from '@/infrastructure/viewport/viewport-projection'

const DEFAULT_TRANSITION_DURATION_MS = 280

interface ViewportCameraTransitionState {
  fromFrame: ViewportCameraFrame
  toFrame: ViewportCameraFrame
  durationMs: number
  elapsedMs: number
}

export interface ViewportCameraTransitionResult {
  completed: boolean
  frame: ViewportCameraFrame
  progress: number
}

export interface ViewportCameraTransitionController {
  advance: (deltaMs: number) => ViewportCameraTransitionResult | null
  cancel: () => void
  getTargetFrame: () => ViewportCameraFrame | null
  isActive: () => boolean
  start: (input: {
    fromFrame: ViewportCameraFrame
    toFrame: ViewportCameraFrame
    durationMs?: number
  }) => void
}

export function createViewportCameraTransitionController(): ViewportCameraTransitionController {
  let state: ViewportCameraTransitionState | null = null

  return {
    advance(deltaMs) {
      if (!state) {
        return null
      }

      state.elapsedMs = Math.min(state.elapsedMs + Math.max(deltaMs, 0), state.durationMs)
      const progress = state.durationMs <= 0 ? 1 : state.elapsedMs / state.durationMs

      if (progress >= 1) {
        const frame = cloneViewportCameraFrame(state.toFrame)
        state = null
        return {
          completed: true,
          frame,
          progress: 1,
        }
      }

      return {
        completed: false,
        frame: interpolateViewportCameraFrame(
          state.fromFrame,
          state.toFrame,
          easeViewportCameraTransition(progress),
        ),
        progress,
      }
    },
    cancel() {
      state = null
    },
    getTargetFrame() {
      return state ? cloneViewportCameraFrame(state.toFrame) : null
    },
    isActive() {
      return state !== null
    },
    start(input) {
      state = {
        fromFrame: cloneViewportCameraFrame(input.fromFrame),
        toFrame: cloneViewportCameraFrame(input.toFrame),
        durationMs: Math.max(input.durationMs ?? DEFAULT_TRANSITION_DURATION_MS, 0),
        elapsedMs: 0,
      }
    },
  }
}

function easeViewportCameraTransition(progress: number) {
  const clampedProgress = THREE.MathUtils.clamp(progress, 0, 1)

  return 1 - ((1 - clampedProgress) ** 3)
}
