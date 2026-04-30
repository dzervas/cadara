import { test } from 'bun:test'

import {
  initialEditorState,
  runEditorEffect,
  transitionEditorState,
  type EditorEffectRuntime,
  type EditorState,
} from '@/contracts/editor/state-machine'
import { createReferenceImageOperation } from '@/domain/reference-image/operations'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import {
  appendReferenceImageOperations,
  createNewSketchSession,
} from '@/domain/editor/sketch-session'
import {
  createSketchSpecialModeHandleRef,
  createSketchSpecialModeTargetRef,
} from '@/domain/sketch-special-modes/presentation'
import { sketchSpecialModeDefinitions } from '@/domain/sketch-special-modes/registry'
import type { SketchSpecialModeDefinition } from '@/domain/sketch-special-modes/schema'
import { createScopedRuntimeExtensionRegistryCompositionForTest } from '@/domain/extensions/test-registry-composition'

test('src/contracts/editor/sketch-special-mode.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const fixtureMode: SketchSpecialModeDefinition<{
    clicks: number
    lastPayload: string | null
  }> = {
    id: 'fixture.special-mode',
    label: 'Fixture mode',
    resolveOpenRequest: ({ target }) =>
      target?.kind === 'sketchOperation'
        ? { operationId: target.operationId, payload: { openedFrom: 'double-click' } }
        : null,
    selection: {
      label: 'Fixture selection',
      description: 'Select the fixture operation only.',
      allowedKinds: ['sketchOperation'],
      resolveTarget: ({ activeMode, target }) =>
        target.kind === 'sketchOperation' && target.operationId === activeMode.operationTarget.operationId
          ? createSketchSpecialModeTargetRef(activeMode.operationTarget.operationId, 'resolved')
          : null,
    },
    enter: ({ operationTarget }) => ({
      state: {
        clicks: 0,
        lastPayload: null,
      },
      effect: {
        effectId: 'entered',
        kind: 'fixture-entered',
        payload: {
          operationId: operationTarget.operationId,
        },
      },
    }),
    handleHover: ({ resolvedTarget }) => ({
      hoverTarget: resolvedTarget,
    }),
    handleClick: ({ activeMode, resolvedTarget }) => ({
      state: {
        ...activeMode.state,
        clicks: activeMode.state.clicks + 1,
      },
      selectedTarget: resolvedTarget,
    }),
    handleDragStart: ({ activeMode, handle, point }) => ({
      state: {
        ...activeMode.state,
        lastPayload: `${handle.handleId}:${point[0]},${point[1]}`,
      },
      activeDragHandle: handle,
    }),
    handleDragMove: ({ activeMode, handle, point }) => ({
      state: {
        ...activeMode.state,
        lastPayload: `${handle.handleId}:${point[0]},${point[1]}`,
      },
    }),
    handleDragEnd: ({ activeMode, handle, point }) => ({
      state: {
        ...activeMode.state,
        lastPayload: `${handle.handleId}:${point[0]},${point[1]}`,
      },
      activeDragHandle: null,
    }),
    handlePanelAction: ({ activeMode, action }) =>
      action.kind === 'invoke'
        ? {
            effect: {
              effectId: 'panel-action',
              kind: 'fixture-panel-action',
              payload: {
                value: String(action.value ?? ''),
              },
            },
          }
        : {
            state: activeMode.state,
          },
    handleEffectResult: ({ activeMode, payload }) => ({
      ...(payload.value === 'commit' || payload.value === 'cancel'
        ? {}
        : {
            state: {
              ...activeMode.state,
              lastPayload: String(payload.value ?? payload.operationId ?? null),
            },
          }),
      effect: null,
    }),
    cancel: () => ({
      exit: true,
      effect: {
        effectId: 'cancelled',
        kind: 'fixture-cancelled',
        payload: {
          value: 'cancel',
        },
      },
    }),
    commit: () => ({
      exit: true,
      effect: {
        effectId: 'committed',
        kind: 'fixture-committed',
        payload: {
          value: 'commit',
        },
      },
    }),
    buildPanel: () => null,
    buildViewport: () => null,
  }

  const fixtureRegistries = createScopedRuntimeExtensionRegistryCompositionForTest({
    sketchSpecialModes: [fixtureMode],
  })
  const fixtureDependencies = {
    importProviders: fixtureRegistries.importProviders,
    sketchSpecialModes: fixtureRegistries.sketchSpecialModes,
  }
  const builtinRegistries = createScopedRuntimeExtensionRegistryCompositionForTest({
    sketchSpecialModes: sketchSpecialModeDefinitions,
  })
  const builtinDependencies = {
    importProviders: builtinRegistries.importProviders,
    sketchSpecialModes: builtinRegistries.sketchSpecialModes,
  }
  const transitionWithFixtureModes = (state: EditorState, event: Parameters<typeof transitionEditorState>[1]) =>
    transitionEditorState(state, event, fixtureDependencies)
  const transitionWithBuiltinModes = (state: EditorState, event: Parameters<typeof transitionEditorState>[1]) =>
    transitionEditorState(state, event, builtinDependencies)

  {
    const plane = createStandardPlaneDefinition('xy')
    const session = appendReferenceImageOperations(createNewSketchSession(plane), [
      createReferenceImageOperation({
        sequence: 1,
        sketchId: 'sketch_draft',
        payload: {
          mediaType: 'image/png',
          pixelWidth: 320,
          pixelHeight: 200,
          base64Data: 'cG5n',
          fileName: 'fixture.png',
        },
      }),
    ])
    const operationTarget = {
      kind: 'sketchOperation' as const,
      sketchId: 'sketch_draft',
      operationId: 'sketch_operation_1_reference-image',
    }
    const rejectedTarget = {
      kind: 'face' as const,
      bodyId: 'body_fixture',
      faceId: 'face_fixture',
    }

    const baseState: EditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_fixture',
        revisionId: 'rev_fixture',
      },
      command: {
        commandSessionId: 'command_sketch-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    }

    const entered = transitionWithFixtureModes(baseState, {
      type: 'sketch.specialModeDoubleClickRequested',
      point: [4, 6],
      target: operationTarget,
    })
    assert(entered.state.kind === 'editingSketch', 'Special mode entry should preserve sketch editing.')
    assert(entered.effects[0]?.type === 'sketch.specialModeEffect', 'Entry should emit the mode effect contract.')
    assert(
      entered.state.kind === 'editingSketch' && entered.state.session.activeSpecialMode?.modeId === fixtureMode.id,
      'Entry should activate the registered sketch special mode.',
    )
    assert(
      entered.state.selectionFilter?.label === 'Fixture selection'
        && entered.state.selectionFilter.allowedKinds.length === 1
        && entered.state.selectionFilter.allowedKinds[0] === 'sketchOperation',
      'Entering the mode should install the mode-specific pick contract as the active selection filter.',
    )

    const runtime: EditorEffectRuntime = {
      async getCurrentDocumentSnapshot() {
        throw new Error('Snapshot fetch is not used in this test.')
      },
      async commitSketch() {
        return null
      },
      async projectSketchReferences() {
        return { projectedReferences: [], diagnostics: [] }
      },
      async runSketchSpecialModeEffect(input) {
        return {
          effectId: input.effectId,
          payload: {
            operationId: input.payload.operationId,
            value: input.payload.value,
          },
        }
      },
      async evaluatePreview() {
        throw new Error('Feature preview is not used in this test.')
      },
      async commitFeature() {
        throw new Error('Feature commit is not used in this test.')
      },
    }

    const enteredEffectEvent = await runEditorEffect(entered.effects[0]!, runtime)
    const enteredResolved = transitionWithFixtureModes(entered.state, enteredEffectEvent)
    assert(
      enteredResolved.state.kind === 'editingSketch'
        && enteredResolved.state.session.activeSpecialMode?.state.lastPayload === operationTarget.operationId,
      'Effect completion should re-enter the reducer through the registered mode definition.',
    )

    const rejectedHover = transitionWithFixtureModes(enteredResolved.state, {
      type: 'viewport.hovered',
      target: rejectedTarget,
    })
    assert(
      rejectedHover.state.kind === 'editingSketch'
        && rejectedHover.state.hoverTarget === null
        && rejectedHover.state.session.activeSpecialMode?.hoverTarget === null,
      'Mode-specific target contracts should reject targets outside the declared picker semantics.',
    )

    const hovered = transitionWithFixtureModes(enteredResolved.state, {
      type: 'viewport.hovered',
      target: operationTarget,
    })
    assert(
      hovered.state.kind === 'editingSketch'
        && hovered.state.session.activeSpecialMode?.hoverTarget?.targetId === 'sketch_special_target_resolved',
      'Viewport hover should route through the active special-mode adapter.',
    )

    const clicked = transitionWithFixtureModes(hovered.state, {
      type: 'sketch.specialModeClickRequested',
      point: [4, 6],
      target: operationTarget,
    })
    assert(
      clicked.state.kind === 'editingSketch'
        && clicked.state.session.activeSpecialMode?.state.clicks === 1
        && clicked.state.session.activeSpecialMode?.selectedTarget?.targetId === 'sketch_special_target_resolved',
      'Special-mode click events should use the resolved mode-local target contract.',
    )

    const handle = createSketchSpecialModeHandleRef(operationTarget.operationId, 'corner-a')
    const dragged = transitionWithFixtureModes(clicked.state, {
      type: 'sketch.specialModeDragStarted',
      handle,
      point: [1, 2],
    })
    const draggedMove = transitionWithFixtureModes(dragged.state, {
      type: 'sketch.specialModeDragMoved',
      handle,
      point: [7, 9],
    })
    const draggedEnd = transitionWithFixtureModes(draggedMove.state, {
      type: 'sketch.specialModeDragEnded',
      handle,
      point: [10, 12],
    })
    assert(
      draggedEnd.state.kind === 'editingSketch'
        && draggedEnd.state.session.activeSpecialMode?.state.lastPayload === `${handle.handleId}:10,12`,
      'Special-mode handle drags should flow through the dedicated drag channel with durable handle ids.',
    )

    const invoked = transitionWithFixtureModes(draggedEnd.state, {
      type: 'sketch.specialModePanelActionInvoked',
      action: {
        kind: 'invoke',
        actionId: 'recompute',
        value: 'panel-value',
      },
    })
    assert(invoked.effects[0]?.type === 'sketch.specialModeEffect', 'Panel actions should be able to emit async mode effects.')

    const committed = transitionWithFixtureModes(invoked.state, {
      type: 'command.commitRequested',
      commandSessionId: 'command_sketch-1',
    })
    assert(
      committed.effects[0]?.type === 'sketch.specialModeEffect'
        && committed.state.kind === 'editingSketch'
        && committed.state.session.activeSpecialMode !== null,
      'Commit requests should preserve the async special-mode effect path instead of dropping lifecycle effects.',
    )

    const committedResolved = transitionWithFixtureModes(
      committed.state,
      await runEditorEffect(committed.effects[0]!, runtime),
    )
    assert(
      committedResolved.state.kind === 'editingSketch'
        && committedResolved.state.session.activeSpecialMode === null
        && committedResolved.state.selectionFilter?.kind === 'sketchSession',
      'Completing an effectful commit should exit the mode and restore ordinary sketch selection semantics.',
    )

    const reentered = transitionWithFixtureModes(committedResolved.state, {
      type: 'sketch.specialModeEntered',
      modeId: fixtureMode.id,
      operationId: operationTarget.operationId,
    })
    const reenteredResolved = transitionWithFixtureModes(
      reentered.state,
      await runEditorEffect(reentered.effects[0]!, runtime),
    )

    const cancelled = transitionWithFixtureModes(reenteredResolved.state, {
      type: 'command.cancelled',
      commandSessionId: 'command_sketch-1',
    })
    assert(
      cancelled.effects[0]?.type === 'sketch.specialModeEffect'
        && cancelled.state.kind === 'editingSketch'
        && cancelled.state.session.activeSpecialMode !== null,
      'Cancel requests should preserve the async special-mode effect path instead of dropping lifecycle effects.',
    )

    const cancelledEffectEvent = await runEditorEffect(cancelled.effects[0]!, runtime)
    const cancelledResolved = transitionWithFixtureModes(cancelled.state, cancelledEffectEvent)
    assert(
      cancelledResolved.state.kind === 'editingSketch' && cancelledResolved.state.session.activeSpecialMode === null,
      'Cancelling an active special mode should exit after the lifecycle effect resolves.',
    )

    const staleIgnored = transitionWithFixtureModes(cancelledResolved.state, cancelledEffectEvent)
    assert(
      staleIgnored.state.kind === 'editingSketch' && staleIgnored.state.session.activeSpecialMode === null,
      'Stale async mode results should be ignored after mode cancellation.',
    )
  }

  const builtinSession = appendReferenceImageOperations(createNewSketchSession(createStandardPlaneDefinition('xy')), [
    createReferenceImageOperation({
      sequence: 1,
      sketchId: 'sketch_draft',
      payload: {
        mediaType: 'image/png',
        pixelWidth: 320,
        pixelHeight: 200,
        base64Data: 'cG5n',
        fileName: 'builtin.png',
      },
    }),
  ])

  const builtinOpened = transitionWithBuiltinModes(
    {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_builtin',
        revisionId: 'rev_builtin',
      },
      command: {
        commandSessionId: 'command_builtin',
        toolId: 'sketch',
        phase: 'editing',
      },
      session: builtinSession,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    },
    {
      type: 'sketch.specialModeDoubleClickRequested',
      point: [2, 3],
      target: {
        kind: 'sketchOperation',
        sketchId: 'sketch_draft',
        operationId: 'sketch_operation_1_reference-image',
      },
    },
  )

  assert(
    builtinOpened.state.kind === 'editingSketch' && builtinOpened.state.session.activeSpecialMode !== null,
    'Scoped built-in special-mode compositions should preserve the existing reference-image mode behavior.',
  )
})
