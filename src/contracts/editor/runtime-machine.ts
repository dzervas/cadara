import { assign, createActor, fromPromise, raise, setup, type ActorRefFrom } from 'xstate'

import {
  createEditorEffectFailureEvent,
  getEditorViewState,
  initialEditorState,
  runEditorEffect,
  transitionEditorState,
  type EditorEffect,
  type EditorEffectRuntime,
  type EditorEvent,
  type EditorState,
  type EditorViewState,
} from '@/contracts/editor/state-machine'
import {
  createConsoleErrorReporter,
  normalizeUnknownError,
  type ErrorReporter,
} from '@/contracts/errors'

type WorkflowKind = EditorState['kind']

interface EditorRuntimeContext {
  machineState: EditorState
  activeEffect: EditorEffect | null
  effectQueue: EditorEffect[]
  runtime: EditorEffectRuntime
  errorReporter: ErrorReporter
  runEffect: (effect: EditorEffect, runtime: EditorEffectRuntime) => Promise<EditorEvent>
}

interface EditorRuntimeInput {
  runtime: EditorEffectRuntime
  errorReporter: ErrorReporter
  runEffect: (effect: EditorEffect, runtime: EditorEffectRuntime) => Promise<EditorEvent>
}

const editorEventTypes = [
  'session.started',
  'tool.activated',
  'command.cancelled',
  'command.commitRequested',
  'document.refreshRequested',
  'viewport.hovered',
  'viewport.hoverCleared',
  'viewport.selectionRequested',
  'sketch.connectedSelectionRequested',
  'selection.cleared',
  'authoring.reopenRequested',
  'sketch.pointerMoved',
  'sketch.pointerReleased',
  'sketch.specialModeEntered',
  'sketch.specialModePanelActionInvoked',
  'sketch.specialModeClickRequested',
  'sketch.specialModeDoubleClickRequested',
  'sketch.specialModeDragStarted',
  'sketch.specialModeDragMoved',
  'sketch.specialModeDragEnded',
  'sketch.geometryDragStarted',
  'sketch.geometryDragMoved',
  'sketch.geometryDragEnded',
  'section.offsetUpdated',
  'section.flipRequested',
  'section.cleared',
  'sketch.toolPatched',
  'sketch.activeToolCleared',
  'sketch.historyCursorRequested',
  'document.historyCursorRequested',
  'history.undoRequested',
  'history.redoRequested',
  'document.snapshotLoaded',
  'sketch.annotationDeleteRequested',
  'sketch.annotationEditRequested',
  'form.featurePatched',
  'form.referencePickerActivated',
  'form.referencePickerCancelled',
  'import.fileSelected',
  'import.providerSelected',
  'import.selectionPatched',
  'import.commitRequested',
  'import.cancelled',
  'import.committed',
  'import.failed',
  'effect.snapshotLoaded',
  'effect.snapshotFailed',
  'effect.sketchSessionOpened',
  'effect.sketchSessionOpenFailed',
  'effect.featureSessionHydrated',
  'effect.featureSessionHydrationFailed',
  'effect.featurePreviewCompleted',
  'effect.featurePreviewFailed',
  'effect.featureCommitted',
  'effect.featureCommitFailed',
  'effect.sketchCommitted',
  'effect.sketchCommitFailed',
  'effect.sketchReferencesProjected',
  'effect.sketchReferenceProjectionFailed',
  'effect.sketchReferenceImageImportCompleted',
  'effect.sketchReferenceImageImportFailed',
  'effect.sketchSpecialModeEffectCompleted',
  'effect.sketchSpecialModeEffectFailed',
  'effect.documentCursorMoved',
  'effect.documentCursorMoveFailed',
] as const satisfies readonly EditorEvent['type'][]

const sharedEventHandlers = Object.fromEntries(
  editorEventTypes.map((type) => [type, { actions: 'applyEditorEvent' }]),
)

function effectMatchesState(effect: EditorEffect, state: EditorState) {
  switch (effect.type) {
    case 'document.fetchSnapshot':
      return state.pendingSnapshotRequestId === effect.requestId
    case 'sketch.openSession':
      return (
        state.kind === 'selectionCommand'
        && state.pendingRequestId === effect.requestId
        && state.command.commandSessionId === effect.commandSessionId
      )
    case 'feature.hydrateFromSelection':
      return (
        state.kind === 'selectionCommand'
        && state.pendingRequestId === effect.requestId
        && state.command.commandSessionId === effect.commandSessionId
      )
    case 'feature.evaluatePreview':
      return (
        state.kind === 'editingFeature'
        && state.pendingPreviewRequestId === effect.requestId
        && state.command.commandSessionId === effect.commandSessionId
      )
    case 'feature.commit':
      return (
        state.kind === 'editingFeature'
        && state.pendingCommitRequestId === effect.requestId
        && state.command.commandSessionId === effect.commandSessionId
      )
    case 'sketch.commit':
      return (
        state.kind === 'editingSketch'
        && state.pendingCommitRequestId === effect.requestId
        && state.command.commandSessionId === effect.commandSessionId
      )
    case 'sketch.importReferenceImages':
      return (
        state.kind === 'editingSketch'
        && state.pendingImportRequestId === effect.requestId
        && state.command.commandSessionId === effect.commandSessionId
      )
    case 'sketch.specialModeEffect':
      return (
        state.kind === 'editingSketch'
        && state.session.activeSpecialMode?.pendingEffect?.requestId === effect.requestId
        && state.command.commandSessionId === effect.commandSessionId
      )
    case 'document.moveHistoryCursor':
      return state.pendingHistoryCursorRequestId === effect.requestId
    default:
      return false
  }
}

function workflowGuardName(kind: WorkflowKind) {
  switch (kind) {
    case 'idle':
      return 'isIdleWorkflow'
    case 'selectionCommand':
      return 'isSelectionCommandWorkflow'
    case 'editingSketch':
      return 'isEditingSketchWorkflow'
    case 'editingFeature':
      return 'isEditingFeatureWorkflow'
    case 'importing':
      return 'isImportingWorkflow'
    case 'inspectingSection':
      return 'isInspectingSectionWorkflow'
    default:
      return 'isIdleWorkflow'
  }
}

function workflowTarget(kind: WorkflowKind, substate: 'ready' | 'executing') {
  return `#editorRuntime.${kind}.${substate}` as const
}

type WorkflowRedirect = {
  guard: ReturnType<typeof workflowGuardName>
  target: ReturnType<typeof workflowTarget>
}

type WorkflowStateConfig = {
  initial: 'ready'
  states: {
    ready: {
      always: Array<
        | WorkflowRedirect
        | {
            guard: 'hasQueuedEffects'
            actions: 'promoteQueuedEffect'
            target: 'executing'
          }
      >
    }
    executing: {
      invoke: {
        src: 'runEffect'
        input: ({ context }: { context: EditorRuntimeContext }) => {
          effect: EditorEffect
          runtime: EditorEffectRuntime
          runEffect: (effect: EditorEffect, runtime: EditorEffectRuntime) => Promise<EditorEvent>
        }
        onDone: {
          actions: 'applyCompletedEffect'
        },
        onError: {
          actions: 'handleEscapedEffectError',
        },
      }
      always: Array<
        | WorkflowRedirect
        | {
            guard: 'hasNoActiveEffect'
            target: 'ready'
          }
      >
    }
  }
}

function createWorkflowRedirects(currentKind: WorkflowKind): WorkflowRedirect[] {
  const workflowKinds: readonly WorkflowKind[] = [
    'idle',
    'selectionCommand',
    'editingSketch',
    'editingFeature',
    'importing',
    'inspectingSection',
  ]

  return workflowKinds
    .filter((kind) => kind !== currentKind)
    .map((kind) => ({
      guard: workflowGuardName(kind),
      target: workflowTarget(kind, 'ready'),
    }))
}

function createWorkflowState(kind: WorkflowKind): WorkflowStateConfig {
  return {
    initial: 'ready',
    states: {
      ready: {
        always: [
          ...createWorkflowRedirects(kind),
          {
            guard: 'hasQueuedEffects',
            actions: 'promoteQueuedEffect',
            target: 'executing',
          },
        ],
      },
      executing: {
        invoke: {
          src: 'runEffect',
          input: ({ context }: { context: EditorRuntimeContext }) => {
            if (!context.activeEffect) {
              throw new Error('Editor runtime attempted to execute without an active effect.')
            }

              return {
                effect: context.activeEffect,
                runtime: context.runtime,
                runEffect: context.runEffect,
              }
            },
          onDone: {
            actions: 'applyCompletedEffect',
          },
          onError: {
            actions: 'handleEscapedEffectError',
          },
        },
        always: [
          ...createWorkflowRedirects(kind),
          {
            guard: 'hasNoActiveEffect',
            target: 'ready',
          },
        ],
      },
    },
  }
}

const editorRuntimeMachine = setup({
  types: {
    context: {} as EditorRuntimeContext,
    events: {} as EditorEvent,
    input: {} as EditorRuntimeInput,
  },
  actors: {
    runEffect: fromPromise(
      async ({ input }: {
        input: {
          effect: EditorEffect
          runtime: EditorEffectRuntime
          runEffect: (effect: EditorEffect, runtime: EditorEffectRuntime) => Promise<EditorEvent>
        }
      }) => input.runEffect(input.effect, input.runtime),
    ),
  },
  actions: {
    applyEditorEvent: assign(({ context, event }) => {
      const result = transitionEditorState(context.machineState, event)
      const activeEffect =
        context.activeEffect && effectMatchesState(context.activeEffect, result.state)
          ? context.activeEffect
          : null

      return {
        machineState: result.state,
        activeEffect,
        effectQueue: [...context.effectQueue, ...result.effects],
      }
    }),
    applyCompletedEffect: assign(({ context, event }) => {
      const result = transitionEditorState(
        context.machineState,
        ((event as unknown) as { output: EditorEvent }).output,
      )

      return {
        machineState: result.state,
        activeEffect: null,
        effectQueue: [...context.effectQueue, ...result.effects],
      }
    }),
    handleEscapedEffectError: assign(({ context, event }) => {
      const error = ((event as unknown) as { error?: unknown }).error
      const appError = normalizeUnknownError(error, {
        code: 'editor/invocation-failed',
        fallbackMessage: 'Editor runtime invocation failed.',
        context: [
          { key: 'operation', value: context.activeEffect?.type ?? 'editor.invoke' },
          { key: 'requestId', value: context.activeEffect?.requestId ?? null },
        ],
        requestId: context.activeEffect?.requestId,
      })

      context.errorReporter.report(appError, {
        source: 'editor-runtime',
        visibility: 'user',
        dedupeKey: `${context.activeEffect?.type ?? 'editor.invoke'}:${appError.requestId ?? appError.message}`,
      })

      if (!context.activeEffect) {
        return {
          ...context,
          activeEffect: null,
        }
      }

      const failureEvent = createEditorEffectFailureEvent(
        context.activeEffect,
        appError,
        'Editor runtime invocation failed.',
      )
      const result = transitionEditorState(context.machineState, failureEvent)

      return {
        machineState: result.state,
        activeEffect: null,
        effectQueue: [...context.effectQueue, ...result.effects],
        runtime: context.runtime,
        errorReporter: context.errorReporter,
        runEffect: context.runEffect,
      }
    }),
    promoteQueuedEffect: assign(({ context }) => {
      const nextEffect = context.effectQueue[0] ?? null

      return {
        ...context,
        activeEffect: nextEffect,
        effectQueue: nextEffect ? context.effectQueue.slice(1) : context.effectQueue,
      }
    }),
  },
  guards: {
    hasQueuedEffects: ({ context }) => context.effectQueue.length > 0,
    hasNoActiveEffect: ({ context }) => context.activeEffect === null,
    isIdleWorkflow: ({ context }) => context.machineState.kind === 'idle',
    isSelectionCommandWorkflow: ({ context }) => context.machineState.kind === 'selectionCommand',
    isEditingSketchWorkflow: ({ context }) => context.machineState.kind === 'editingSketch',
    isEditingFeatureWorkflow: ({ context }) => context.machineState.kind === 'editingFeature',
    isImportingWorkflow: ({ context }) => context.machineState.kind === 'importing',
    isInspectingSectionWorkflow: ({ context }) => context.machineState.kind === 'inspectingSection',
  },
}).createMachine({
  id: 'editorRuntime',
  context: ({ input }) => ({
    machineState: initialEditorState,
    activeEffect: null,
    effectQueue: [],
    runtime: input.runtime,
    errorReporter: input.errorReporter,
    runEffect: input.runEffect,
  }),
  entry: raise({ type: 'session.started' }),
  on: sharedEventHandlers,
  initial: 'idle',
  states: {
    idle: createWorkflowState('idle'),
    selectionCommand: createWorkflowState('selectionCommand'),
    editingSketch: createWorkflowState('editingSketch'),
    editingFeature: createWorkflowState('editingFeature'),
    importing: createWorkflowState('importing'),
    inspectingSection: createWorkflowState('inspectingSection'),
  },
})

export type EditorRuntimeActor = ActorRefFrom<typeof editorRuntimeMachine>

export function createEditorRuntimeActor(
  runtime: EditorEffectRuntime,
  errorReporter: ErrorReporter = createConsoleErrorReporter(),
  runEffect: (effect: EditorEffect, runtime: EditorEffectRuntime) => Promise<EditorEvent> = runEditorEffect,
) {
  return createActor(editorRuntimeMachine, {
    input: {
      runtime,
      errorReporter,
      runEffect,
    },
  })
}

export function getEditorRuntimeState(actor: Pick<EditorRuntimeActor, 'getSnapshot'>): EditorState {
  return actor.getSnapshot().context.machineState
}

export function getEditorRuntimeViewState(
  actor: Pick<EditorRuntimeActor, 'getSnapshot'>,
): EditorViewState {
  return getEditorViewState(getEditorRuntimeState(actor))
}
