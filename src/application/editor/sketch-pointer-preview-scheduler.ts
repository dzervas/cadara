import type { EditorEvent } from '@/domain/editor/state-machine'

type ScheduledFrameCallback = (time: number) => void

interface SketchPointerPreviewSchedulerInput {
  dispatchEvent: (event: EditorEvent) => void
  requestFrame: (callback: ScheduledFrameCallback) => number
  cancelFrame: (frameId: number) => void
}

export interface SketchPointerPreviewScheduler {
  dispatch(event: EditorEvent): void
  flush(): void
  cancel(): void
}

export function createSketchPointerPreviewScheduler(
  input: SketchPointerPreviewSchedulerInput,
): SketchPointerPreviewScheduler {
  let pendingPointerEvent: Extract<EditorEvent, { type: 'sketch.pointerMoved' }> | null = null
  let pendingFrameId: number | null = null

  const clearFrame = () => {
    if (pendingFrameId !== null) {
      input.cancelFrame(pendingFrameId)
      pendingFrameId = null
    }
  }

  const flush = () => {
    const event = pendingPointerEvent
    if (!event) {
      return
    }

    clearFrame()
    pendingPointerEvent = null
    input.dispatchEvent(event)
  }

  const schedule = () => {
    if (pendingFrameId !== null) {
      return
    }

    pendingFrameId = input.requestFrame(() => {
      pendingFrameId = null
      const event = pendingPointerEvent
      pendingPointerEvent = null

      if (event) {
        input.dispatchEvent(event)
      }
    })
  }

  return {
    dispatch(event) {
      if (event.type === 'sketch.pointerMoved') {
        pendingPointerEvent = event
        schedule()
        return
      }

      flush()
      input.dispatchEvent(event)
    },
    flush,
    cancel() {
      clearFrame()
      pendingPointerEvent = null
    },
  }
}

export function requestEditorAnimationFrame(callback: ScheduledFrameCallback): number {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback)
  }

  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number
}

export function cancelEditorAnimationFrame(frameId: number) {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(frameId)
    return
  }

  globalThis.clearTimeout(frameId)
}
