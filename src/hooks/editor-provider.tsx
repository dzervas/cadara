import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { PropsWithChildren } from 'react'

import {
  createModelingServiceEditorEffectRuntime,
  getEditorViewState,
  initialEditorState,
  type EditorEvent,
} from '@/contracts/editor/state-machine'
import {
  createEditorRuntimeActor,
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
  const actor = useMemo(() => createEditorRuntimeActor(runtime), [runtime])

  useEffect(() => {
    actor.start()

    return () => {
      actor.stop()
    }
  }, [actor])

  const subscribe = useCallback((onStoreChange: () => void) => {
    const subscription = actor.subscribe(() => {
      onStoreChange()
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [actor])

  const machineState = useSyncExternalStore(
    subscribe,
    () => actor.getSnapshot().context.machineState,
    () => initialEditorState,
  )

  const dispatch = useCallback((event: EditorEvent) => {
    actor.send(event)
  }, [actor])

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
