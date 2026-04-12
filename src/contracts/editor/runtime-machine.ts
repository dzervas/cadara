import { assign, createActor, fromPromise, raise, setup, type ActorRefFrom } from 'xstate'

import {
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

type WorkflowKind = EditorState['kind']

interface EditorRuntimeContext {
  machineState: EditorState
  activeEffect: EditorEffect | null
  effectQueue: EditorEffect[]
  runtime: EditorEffectRuntime
}

interface EditorRuntimeInput {
  runtime: EditorEffectRuntime
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
  'authoring.reopenRequested',
  'sketch.pointerMoved',
  'sketch.pointerReleased',
  'sketch.toolPatched',
  'sketch.activeToolCleared',
  'sketch.annotationDeleteRequested',
  'form.featurePatched',
  'form.referencePickerActivated',
  'form.referencePickerCancelled',
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
    default:
      return 'isIdleWorkflow'
  }
}

function workflowTarget(kind: WorkflowKind, substate: 'ready' | 'executing') {
  return `#editorRuntime.${kind}.${substate}` as const
}

function createWorkflowRedirects(currentKind: WorkflowKind) {
  const workflowKinds: readonly WorkflowKind[] = [
    'idle',
    'selectionCommand',
    'editingSketch',
    'editingFeature',
  ]

  return workflowKinds
    .filter((kind) => kind !== currentKind)
    .flatMap((kind) => [
      {
        guard: workflowGuardName(kind) as never,
        target: workflowTarget(kind, 'ready'),
      },
    ]) as any
}

function createWorkflowState(kind: WorkflowKind) {
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
            }
          },
          onDone: {
            actions: 'applyCompletedEffect',
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
  } as any
}

const editorRuntimeMachine = setup({
  types: {
    context: {} as EditorRuntimeContext,
    events: {} as EditorEvent,
    input: {} as EditorRuntimeInput,
  },
  actors: {
    runEffect: fromPromise(
      async ({ input }: { input: { effect: EditorEffect; runtime: EditorEffectRuntime } }) =>
        runEditorEffect(input.effect, input.runtime),
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
  },
}).createMachine({
  id: 'editorRuntime',
  context: ({ input }) => ({
    machineState: initialEditorState,
    activeEffect: null,
    effectQueue: [],
    runtime: input.runtime,
  }),
  entry: raise({ type: 'session.started' }),
  on: sharedEventHandlers,
  initial: 'idle',
  states: {
    idle: createWorkflowState('idle'),
    selectionCommand: createWorkflowState('selectionCommand'),
    editingSketch: createWorkflowState('editingSketch'),
    editingFeature: createWorkflowState('editingFeature'),
  },
})

export type EditorRuntimeActor = ActorRefFrom<typeof editorRuntimeMachine>

export function createEditorRuntimeActor(runtime: EditorEffectRuntime) {
  return createActor(editorRuntimeMachine, {
    input: {
      runtime,
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
