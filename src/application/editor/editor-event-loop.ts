import {
  createConsoleErrorReporter,
  normalizeUnknownError,
  type ErrorReporter,
} from '@/contracts/errors'
import {
  createEditorEffectFailureEvent,
  defaultEditorExtensionDependencies,
  initialEditorState,
  transitionEditorState,
  type EditorExtensionDependencies,
  type EditorEffect,
  type EditorEffectRuntime,
  type EditorEvent,
  type EditorState,
} from '@/core/editor/state-machine'
import {
  createEffectCompletedTraceEntry,
  createEffectFailedTraceEntry,
  createEffectStartedTraceEntry,
  createEventDispatchedTraceEntry,
  type EditorEventLoopTraceListener,
} from './editor-debug-trace'
import { runEditorEffect } from './effect-registry'

export type EditorEventLoopListener = (state: EditorState) => void

export class EditorEventLoop {
  private readonly runtime: EditorEffectRuntime
  private readonly dependencies: EditorExtensionDependencies
  private readonly errorReporter: ErrorReporter
  private readonly executeEffect: (effect: EditorEffect, runtime: EditorEffectRuntime) => Promise<EditorEvent>
  private state: EditorState = initialEditorState
  private readonly effectQueue: EditorEffect[] = []
  private readonly listeners = new Set<EditorEventLoopListener>()
  private readonly traceListeners = new Set<EditorEventLoopTraceListener>()
  private processing = false
  private running = false
  private runToken = 0
  private traceSequence = 0

  constructor(
    runtime: EditorEffectRuntime,
    dependencies: EditorExtensionDependencies,
    errorReporter: ErrorReporter,
    executeEffect: (effect: EditorEffect, runtime: EditorEffectRuntime) => Promise<EditorEvent>,
  ) {
    this.runtime = runtime
    this.dependencies = dependencies
    this.errorReporter = errorReporter
    this.executeEffect = executeEffect
  }

  dispatch(event: EditorEvent) {
    if (!this.running) {
      return
    }

    const result = transitionEditorState(this.state, event, this.dependencies)
    this.applyTransitionResult(result)
    this.emitTrace(
      createEventDispatchedTraceEntry({
        sequence: this.nextTraceSequence(),
        event,
        state: this.state,
        emittedEffects: result.effects,
      }),
    )
    this.scheduleDrain()
  }

  subscribe(listener: EditorEventLoopListener) {
    this.listeners.add(listener)

    return {
      unsubscribe: () => {
        this.listeners.delete(listener)
      },
    }
  }

  subscribeToTrace(listener: EditorEventLoopTraceListener) {
    this.traceListeners.add(listener)

    return {
      unsubscribe: () => {
        this.traceListeners.delete(listener)
      },
    }
  }

  getState() {
    return this.state
  }

  start() {
    if (this.running) {
      return
    }

    this.running = true
    this.runToken += 1
    this.dispatch({ type: 'session.started' })
  }

  stop() {
    if (!this.running && !this.processing && this.effectQueue.length === 0) {
      return
    }

    this.running = false
    this.runToken += 1
    this.effectQueue.length = 0
  }

  private applyTransitionResult(result: ReturnType<typeof transitionEditorState>) {
    this.state = result.state
    if (result.effects.length > 0) {
      this.effectQueue.push(...result.effects)
    }

    for (const listener of this.listeners) {
      listener(this.state)
    }
  }

  private scheduleDrain() {
    if (this.processing || !this.running || this.effectQueue.length === 0) {
      return
    }

    void this.drainEffects(this.runToken)
  }

  private async drainEffects(runToken: number) {
    if (this.processing || !this.running || runToken !== this.runToken) {
      return
    }

    this.processing = true

    try {
      while (this.running && runToken === this.runToken) {
        const effect = this.effectQueue.shift()

        if (!effect) {
          break
        }

        this.emitTrace(
          createEffectStartedTraceEntry({
            sequence: this.nextTraceSequence(),
            effect,
            queueDepthAfterStart: this.effectQueue.length,
          }),
        )

        try {
          const effectEvent = await this.executeEffect(effect, this.runtime)

          if (!this.running || runToken !== this.runToken) {
            break
          }

          const result = transitionEditorState(this.state, effectEvent, this.dependencies)
          this.applyTransitionResult(result)
          this.emitTrace(
            createEffectCompletedTraceEntry({
              sequence: this.nextTraceSequence(),
              effect,
              completion: effectEvent,
              state: this.state,
              emittedEffects: result.effects,
            }),
          )
        } catch (error: unknown) {
          if (!this.running || runToken !== this.runToken) {
            break
          }

          const appError = normalizeUnknownError(error, {
            code: 'editor/invocation-failed',
            fallbackMessage: 'Editor runtime invocation failed.',
            context: [
              { key: 'operation', value: effect.type },
              { key: 'requestId', value: effect.requestId },
            ],
            requestId: effect.requestId,
          })

          this.errorReporter.report(appError, {
            source: 'editor-runtime',
            visibility: 'user',
            dedupeKey: `${effect.type}:${appError.requestId ?? appError.message}`,
          })

          const failureEvent = createEditorEffectFailureEvent(
            effect,
            appError,
            'Editor runtime invocation failed.',
          )
          const result = transitionEditorState(this.state, failureEvent, this.dependencies)
          this.applyTransitionResult(result)
          this.emitTrace(
            createEffectFailedTraceEntry({
              sequence: this.nextTraceSequence(),
              effect,
              failureEvent,
              error: appError,
              state: this.state,
              emittedEffects: result.effects,
            }),
          )
        }
      }
    } finally {
      this.processing = false
      if (this.running && this.effectQueue.length > 0) {
        this.scheduleDrain()
      }
    }
  }

  private nextTraceSequence() {
    this.traceSequence += 1
    return this.traceSequence
  }

  private emitTrace(
    entry: ReturnType<
      | typeof createEventDispatchedTraceEntry
      | typeof createEffectStartedTraceEntry
      | typeof createEffectCompletedTraceEntry
      | typeof createEffectFailedTraceEntry
    >,
  ) {
    if (this.traceListeners.size === 0) {
      return
    }

    for (const listener of this.traceListeners) {
      try {
        listener(entry)
      } catch (error: unknown) {
        const appError = normalizeUnknownError(error, {
          code: 'app/unknown',
          fallbackMessage: 'Editor debug trace listener failed.',
          context: [{ key: 'traceKind', value: entry.kind }],
        })

        this.errorReporter.report(appError, {
          source: 'editor-runtime',
          visibility: 'developer',
          dedupeKey: `debug-trace:${entry.kind}:${appError.message}`,
        })
      }
    }
  }
}

export function createEditorEventLoop(
  runtime: EditorEffectRuntime,
  errorReporter: ErrorReporter = createConsoleErrorReporter(),
  executeEffect: (effect: EditorEffect, runtime: EditorEffectRuntime) => Promise<EditorEvent> = runEditorEffect,
  dependencies: EditorExtensionDependencies = defaultEditorExtensionDependencies,
) {
  return new EditorEventLoop(runtime, dependencies, errorReporter, executeEffect)
}
