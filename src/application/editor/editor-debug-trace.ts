import type { AppError } from '@/contracts/errors'
import {
  getEditorViewState,
  type EditorEffect,
  type EditorEvent,
  type EditorState,
} from '@/domain/editor/state-machine'
import type {
  EditorRuntimeEffectCompletedTraceEntry,
  EditorRuntimeEffectFailedTraceEntry,
  EditorRuntimeEffectStartedTraceEntry,
  EditorRuntimeEventDispatchedTraceEntry,
  EditorRuntimeTraceEntry,
  EditorRuntimeTraceSnapshot,
  EditorRuntimeTraceStateSummary,
} from '@/domain/debug/debug-platform'

const DEFAULT_TRACE_ENTRY_LIMIT = 200

export type EditorEventLoopTraceListener = (entry: EditorRuntimeTraceEntry) => void

export interface EditorDebugTraceRecorder {
  getSnapshot(): EditorRuntimeTraceSnapshot
  record(entry: EditorRuntimeTraceEntry): void
  clear(): void
}

export function createEditorDebugTraceRecorder(maxEntries = DEFAULT_TRACE_ENTRY_LIMIT): EditorDebugTraceRecorder {
  const entries: EditorRuntimeTraceEntry[] = []
  let totalEntries = 0
  let droppedEntries = 0

  return {
    getSnapshot() {
      return {
        maxEntries,
        totalEntries,
        droppedEntries,
        entries: entries.slice(),
      }
    },
    record(entry) {
      totalEntries += 1

      if (entries.length === maxEntries) {
        entries.shift()
        droppedEntries += 1
      }

      entries.push(entry)
    },
    clear() {
      entries.length = 0
      totalEntries = 0
      droppedEntries = 0
    },
  }
}

export function createEventDispatchedTraceEntry(input: {
  sequence: number
  event: EditorEvent
  state: EditorState
  emittedEffects: readonly EditorEffect[]
  at?: Date
}): EditorRuntimeEventDispatchedTraceEntry {
  return {
    kind: 'event-dispatched',
    sequence: input.sequence,
    at: (input.at ?? new Date()).toISOString(),
    event: summarizeEvent(input.event),
    state: summarizeState(input.state),
    emittedEffects: input.emittedEffects.map(summarizeEffect),
  }
}

export function createEffectStartedTraceEntry(input: {
  sequence: number
  effect: EditorEffect
  queueDepthAfterStart: number
  at?: Date
}): EditorRuntimeEffectStartedTraceEntry {
  return {
    kind: 'effect-started',
    sequence: input.sequence,
    at: (input.at ?? new Date()).toISOString(),
    effect: summarizeEffect(input.effect),
    queueDepthAfterStart: input.queueDepthAfterStart,
  }
}

export function createEffectCompletedTraceEntry(input: {
  sequence: number
  effect: EditorEffect
  completion: EditorEvent
  state: EditorState
  emittedEffects: readonly EditorEffect[]
  at?: Date
}): EditorRuntimeEffectCompletedTraceEntry {
  return {
    kind: 'effect-completed',
    sequence: input.sequence,
    at: (input.at ?? new Date()).toISOString(),
    effect: summarizeEffect(input.effect),
    completion: summarizeEvent(input.completion),
    state: summarizeState(input.state),
    emittedEffects: input.emittedEffects.map(summarizeEffect),
  }
}

export function createEffectFailedTraceEntry(input: {
  sequence: number
  effect: EditorEffect
  failureEvent: EditorEvent
  error: AppError
  state: EditorState
  emittedEffects: readonly EditorEffect[]
  at?: Date
}): EditorRuntimeEffectFailedTraceEntry {
  return {
    kind: 'effect-failed',
    sequence: input.sequence,
    at: (input.at ?? new Date()).toISOString(),
    effect: summarizeEffect(input.effect),
    failure: summarizeEvent(input.failureEvent),
    error: {
      code: input.error.code,
      message: input.error.message,
      requestId: input.error.requestId ?? null,
    },
    state: summarizeState(input.state),
    emittedEffects: input.emittedEffects.map(summarizeEffect),
  }
}

export function createEmptyEditorRuntimeTraceSnapshot(maxEntries = DEFAULT_TRACE_ENTRY_LIMIT): EditorRuntimeTraceSnapshot {
  return {
    maxEntries,
    totalEntries: 0,
    droppedEntries: 0,
    entries: [],
  }
}

function summarizeState(state: EditorState): EditorRuntimeTraceStateSummary {
  const viewState = getEditorViewState(state)

  return {
    machineState: state.kind,
    mode: viewState.mode,
    activeCommand: viewState.activeCommand?.toolId ?? null,
    activePhase: viewState.activeCommand?.phase ?? null,
    revisionId: state.document.revisionId,
    selectionCount: viewState.selection.length,
    pendingSnapshotRequestId: state.pendingSnapshotRequestId ?? null,
  }
}

function summarizeEvent(event: EditorEvent) {
  return {
    type: event.type,
    requestId: extractRequestId(event),
  }
}

function summarizeEffect(effect: EditorEffect) {
  return {
    type: effect.type,
    requestId: extractRequestId(effect),
  }
}

function extractRequestId(value: object): string | null {
  const candidate = value as {
    requestId?: unknown
    payload?: { requestId?: unknown }
  }

  if (typeof candidate.requestId === 'string') {
    return candidate.requestId
  }

  if (typeof candidate.payload?.requestId === 'string') {
    return candidate.payload.requestId
  }

  return null
}
