import { flipSectionViewRetainedSide } from '@/domain/section-view/session'
import type {
  EditorEvent,
  EditorTransitionResult,
  EditorState,
} from './types'
import { toIdleState } from './helpers'

export function handleSectionOffsetUpdated(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'section.offsetUpdated' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'inspectingSection'
    || state.command.commandSessionId !== event.commandSessionId
  ) {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      section: {
        ...state.section,
        offset: event.offset,
      },
      command: {
        ...state.command,
        phase: 'editing',
      },
    },
    effects: [],
  }
}

export function handleSectionFlipRequested(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'section.flipRequested' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'inspectingSection'
    || state.command.commandSessionId !== event.commandSessionId
  ) {
    return { state, effects: [] }
  }

  return {
    state: {
      ...state,
      section: {
        ...state.section,
        retainedSide: flipSectionViewRetainedSide(state.section.retainedSide),
      },
      command: {
        ...state.command,
        phase: 'editing',
      },
    },
    effects: [],
  }
}

export function handleSectionCleared(
  state: EditorState,
  event: Extract<EditorEvent, { type: 'section.cleared' }>,
): EditorTransitionResult {
  if (
    state.kind !== 'inspectingSection'
    || state.command.commandSessionId !== event.commandSessionId
  ) {
    return { state, effects: [] }
  }

  return {
    state: toIdleState(state, 'part'),
    effects: [],
  }
}
