import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'

import {
  createModelingServiceEditorEffectRuntime,
  getEditorViewState,
  type EditorEvent,
} from '@/contracts/editor/state-machine'
import { createEditorRuntimeActor } from '@/contracts/editor/runtime-machine'
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
  const [machineState, setMachineState] = useState(() => actor.getSnapshot().context.machineState)

  useEffect(() => {
    actor.start()

    const subscription = actor.subscribe((snapshot) => {
      setMachineState(snapshot.context.machineState)
    })

    setMachineState(actor.getSnapshot().context.machineState)

    return () => {
      subscription.unsubscribe()
      actor.stop()
    }
  }, [actor])

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
