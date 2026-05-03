import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  initialEditorState,
  type EditorEffect,
  type EditorEffectRuntime,
  type EditorEvent,
  type EditorExtensionDependencies,
} from '@/domain/editor/state-machine'
import type { EditorEventLoopTraceListener } from '@/application/editor/editor-debug-trace'
import type { ErrorReporter } from '@/contracts/errors'
import { createEditorEventLoop, type EditorEventLoop } from '@/application/editor/editor-event-loop'

export function useEditorEventLoop(
  runtime: EditorEffectRuntime,
  errorReporter: ErrorReporter,
  dependencies: EditorExtensionDependencies,
  executeEffect?: (effect: EditorEffect, runtime: EditorEffectRuntime) => Promise<EditorEvent>,
  traceListener?: EditorEventLoopTraceListener,
) {
  const eventLoopRef = useRef<EditorEventLoop | null>(null)
  const eventLoop = useMemo(
    () => createEditorEventLoop(runtime, errorReporter, executeEffect, dependencies),
    [dependencies, errorReporter, executeEffect, runtime],
  )
  const [machineState, setMachineState] = useState(() => eventLoop.getState() ?? initialEditorState)

  useEffect(() => {
    eventLoopRef.current = eventLoop
    const traceSubscription = traceListener ? eventLoop.subscribeToTrace(traceListener) : null
    const subscription = eventLoop.subscribe((nextState) => {
      setMachineState(nextState)
    })

    eventLoop.start()

    return () => {
      traceSubscription?.unsubscribe()
      subscription.unsubscribe()
      if (eventLoopRef.current === eventLoop) {
        eventLoopRef.current = null
      }
      eventLoop.stop()
    }
  }, [eventLoop, traceListener])

  const dispatch = useCallback((event: EditorEvent) => {
    eventLoopRef.current?.dispatch(event)
  }, [])

  return {
    eventLoopRef,
    machineState,
    dispatch,
  }
}
