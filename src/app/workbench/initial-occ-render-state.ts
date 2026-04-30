import type { EditorState } from '@/contracts/editor/state-machine'

export function isInitialOccRenderPending(machineState: Pick<EditorState, 'snapshot'>) {
  return machineState.snapshot === null
}
