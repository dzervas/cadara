import type {
  EditorTransitionResult,
  SectionEvent,
  SectionViewEditorState,
} from './types'
import { toIdleState } from './state-creators'
import {
  handleSectionOffsetUpdated,
  handleSectionFlipRequested,
  handleSectionCleared,
} from './transitions-section'

export function reduceSectionWorkflow(
  state: SectionViewEditorState,
  event: SectionEvent,
): EditorTransitionResult {
  switch (event.type) {
    case 'command.cancelled':
      if (state.command.commandSessionId !== event.commandSessionId) {
        return { state, effects: [] }
      }

      return {
        state: toIdleState(state, state.mode),
        effects: [],
      }
    case 'section.offsetUpdated':
      return handleSectionOffsetUpdated(state, event)
    case 'section.flipRequested':
      return handleSectionFlipRequested(state, event)
    case 'section.cleared':
      return handleSectionCleared(state, event)
  }

  return { state, effects: [] }
}
