import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  initialEditorState,
  type EditorEffect,
  type EditorEffectRuntime,
  type EditorEvent,
  type EditorExtensionDependencies,
} from "@/domain/editor/state-machine";
import type { EditorEventLoopTraceListener } from "@/application/editor/editor-debug-trace";
import {
  cancelEditorAnimationFrame,
  createSketchPointerPreviewScheduler,
  requestEditorAnimationFrame,
  type SketchPointerPreviewScheduler,
} from "@/application/editor/sketch-pointer-preview-scheduler";
import type { ErrorReporter } from "@/contracts/errors";
import {
  createEditorEventLoop,
  type EditorEventLoop,
} from "@/application/editor/editor-event-loop";

export function useEditorEventLoop(
  runtime: EditorEffectRuntime,
  errorReporter: ErrorReporter,
  dependencies: EditorExtensionDependencies,
  executeEffect?: (
    effect: EditorEffect,
    runtime: EditorEffectRuntime,
  ) => Promise<EditorEvent>,
  traceListener?: EditorEventLoopTraceListener,
) {
  const eventLoopRef = useRef<EditorEventLoop | null>(null);
  const pendingEventsRef = useRef<EditorEvent[]>([]);
  const schedulerRef = useRef<SketchPointerPreviewScheduler | null>(null);
  const eventLoop = useMemo(
    () =>
      createEditorEventLoop(
        runtime,
        errorReporter,
        executeEffect,
        dependencies,
      ),
    [dependencies, errorReporter, executeEffect, runtime],
  );
  const [machineState, setMachineState] = useState(
    () => eventLoop.getState() ?? initialEditorState,
  );

  useEffect(() => {
    eventLoopRef.current = eventLoop;
    const traceSubscription = traceListener
      ? eventLoop.subscribeToTrace(traceListener)
      : null;
    const subscription = eventLoop.subscribe((nextState) => {
      setMachineState(nextState);
    });

    eventLoop.start();
    for (const event of pendingEventsRef.current.splice(0)) {
      eventLoop.dispatch(event);
    }

    return () => {
      traceSubscription?.unsubscribe();
      subscription.unsubscribe();
      if (eventLoopRef.current === eventLoop) {
        eventLoopRef.current = null;
      }
      eventLoop.stop();
    };
  }, [eventLoop, traceListener]);

  const dispatchEvent = useCallback((event: EditorEvent) => {
    if (!eventLoopRef.current) {
      pendingEventsRef.current.push(event);
      return;
    }

    eventLoopRef.current.dispatch(event);
  }, []);

  useEffect(() => {
    const scheduler = createSketchPointerPreviewScheduler({
      dispatchEvent,
      requestFrame: requestEditorAnimationFrame,
      cancelFrame: cancelEditorAnimationFrame,
    });
    schedulerRef.current = scheduler;

    return () => {
      if (schedulerRef.current === scheduler) {
        schedulerRef.current = null;
      }
      scheduler.cancel();
    };
  }, [dispatchEvent]);

  const dispatch = useCallback(
    (event: EditorEvent) => {
      const scheduler = schedulerRef.current;
      if (scheduler) {
        scheduler.dispatch(event);
        return;
      }

      dispatchEvent(event);
    },
    [dispatchEvent],
  );

  return {
    eventLoopRef,
    machineState,
    dispatch,
  };
}
