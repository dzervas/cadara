import type { EditorState } from '@/domain/editor/state-machine'

export function isInitialOccRenderPending(machineState: Pick<EditorState, 'snapshot'>) {
  return machineState.snapshot === null
}
