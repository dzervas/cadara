import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsWithChildren } from 'react'

import {
  getEditorViewState,
  initialEditorState,
  type EditorEvent,
} from '@/domain/editor/state-machine'
import { createAppEditorEffectRuntime } from '@/application/editor/create-app-editor-effect-runtime'
import {
  clearActiveDocumentTelemetryContext,
  createActiveDocumentTelemetryContext,
  publishActiveDocumentTelemetryContext,
} from '@/contracts/errors/telemetry-context'
import {
  createEditorRuntimeActor,
  type EditorRuntimeActor,
} from '@/application/editor/runtime-machine'
import type { EditorExtensionDependencies } from '@/domain/editor/state-machine'
import type { ModelingService } from '@/domain/modeling/modeling-service'
import { EditorContext } from '@/hooks/editor-context'
import { useErrorReporter } from '@/hooks/use-error-reporter'

interface EditorProviderProps extends PropsWithChildren {
  modelingService: ModelingService
  editorDependencies: EditorExtensionDependencies
}

export function EditorProvider({ modelingService, editorDependencies, children }: EditorProviderProps) {
  const errorReporter = useErrorReporter()
  const runtime = useMemo(
    () => createAppEditorEffectRuntime(modelingService),
    [modelingService],
  )
  const actorRef = useRef<EditorRuntimeActor | null>(null)
  const [machineState, setMachineState] = useState(() => initialEditorState)

  useEffect(() => {
    const actor = createEditorRuntimeActor(runtime, errorReporter, undefined, editorDependencies)
    actorRef.current = actor

    const subscription = actor.subscribe((snapshot) => {
      setMachineState(snapshot.context.machineState)
    })

    actor.start()
    const documentSubscription = modelingService.subscribeToDocumentChanges((event) => {
      if (event.metadata.source === 'peer') {
        actor.send({ type: 'document.refreshRequested' })
      }
    })

    return () => {
      documentSubscription()
      subscription.unsubscribe()
      if (actorRef.current === actor) {
        actorRef.current = null
      }
      actor.stop()
    }
  }, [editorDependencies, errorReporter, modelingService, runtime])

  useEffect(() => {
    if (!machineState.snapshot) {
      clearActiveDocumentTelemetryContext()
      return undefined
    }

    publishActiveDocumentTelemetryContext(createActiveDocumentTelemetryContext(machineState.snapshot))
    return () => {
      clearActiveDocumentTelemetryContext()
    }
  }, [machineState.snapshot])

  const dispatch = useCallback((event: EditorEvent) => {
    actorRef.current?.send(event)
  }, [])

  const value = useMemo(
    () => ({
      machineState,
      state: getEditorViewState(machineState),
      dispatch,
    }),
    [dispatch, machineState],
  )

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}
