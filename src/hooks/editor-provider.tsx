import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsWithChildren } from 'react'

import {
  createModelingServiceEditorEffectRuntime,
  getEditorViewState,
  initialEditorState,
  type EditorEvent,
} from '@/contracts/editor/state-machine'
import {
  createEditorRuntimeActor,
  type EditorRuntimeActor,
} from '@/contracts/editor/runtime-machine'
import type { ModelingService } from '@/domain/modeling/modeling-service'
import { EditorContext } from '@/hooks/editor-context'

interface EditorProviderProps extends PropsWithChildren {
  modelingService: ModelingService
}

export function EditorProvider({ modelingService, children }: EditorProviderProps) {
  const runtime = useMemo(
    () => createModelingServiceEditorEffectRuntime(modelingService),
    [modelingService],
  )
  const actorRef = useRef<EditorRuntimeActor | null>(null)
  const [machineState, setMachineState] = useState(() => initialEditorState)

  useEffect(() => {
    const actor = createEditorRuntimeActor(runtime)
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
  }, [modelingService, runtime])

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
