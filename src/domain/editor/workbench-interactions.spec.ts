import { test } from 'bun:test'
import { getEditorViewState, initialEditorState } from '@/contracts/editor/state-machine'
import { createNewSketchSession } from '@/domain/editor/sketch-session'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'

import {
  getEscapeEvent,
  getNavigationReopenRequest,
  shouldViewportClickRequestSelection,
  shouldViewportStartSketchGeometryDrag,
} from './workbench-interactions'

test('src/domain/editor/workbench-interactions.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const adapter = new MockKernelAdapter()
  const response = await adapter.getDocumentSnapshot({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
  })
  const snapshot = response.snapshot

  function testFeatureReopenIntentUsesCommittedFeatureKind() {
    const event = getNavigationReopenRequest(snapshot, {
      kind: 'feature',
      featureId: 'feature_extrude-1',
    })

    assert(event?.type === 'authoring.reopenRequested', 'Feature double-click should emit a reopen event.')
    assert(event.toolId === 'extrude', 'Feature double-click should reopen through the committed feature tool.')
  }

  function testSketchReopenIntentUsesSketchFlow() {
    const event = getNavigationReopenRequest(snapshot, {
      kind: 'sketch',
      sketchId: 'sketch_primary',
    })

    assert(event?.type === 'authoring.reopenRequested', 'Sketch double-click should emit a reopen event.')
    assert(event.toolId === 'sketch', 'Sketch double-click should reopen through the sketch flow.')
  }

  function testEscapePrefersReferencePickerCancellation() {
    const event = getEscapeEvent({
      ...getEditorViewState(initialEditorState),
      activeCommand: {
        commandSessionId: 'command_shell-1',
        toolId: 'shell',
        phase: 'editing',
      },
      activeReferencePickerFieldId: 'shell-faces',
      sketchSession: {
        ...createNewSketchSession(createStandardPlaneDefinition('xy')),
        activeTool: 'line',
      },
    })

    assert(event?.type === 'form.referencePickerCancelled', 'Escape should cancel reference pickers before any broader authoring state.')
  }

  function testEscapeClearsActiveSketchToolBeforeExitingSketch() {
    const event = getEscapeEvent({
      activeCommand: {
        commandSessionId: 'command_sketch-1',
        toolId: 'line',
        phase: 'editing',
      },
      activeReferencePickerFieldId: null,
      sketchSession: {
        ...createNewSketchSession(createStandardPlaneDefinition('xy')),
        activeTool: 'line',
      },
    })

    assert(event?.type === 'sketch.activeToolCleared', 'Escape should clear the active sketch tool before exiting sketch mode.')
  }

  function testEscapeDoesNothingWhenSketchIsIdle() {
    const event = getEscapeEvent({
      activeCommand: {
        commandSessionId: 'command_sketch-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      activeReferencePickerFieldId: null,
      sketchSession: {
        ...createNewSketchSession(createStandardPlaneDefinition('xy')),
        activeTool: null,
      },
    })

    assert(event === null, 'Escape should not finish an idle sketch session.')
  }

  function testViewportClickSelectionRoutingAllowsConstraintsOnly() {
    assert(
      shouldViewportClickRequestSelection(null),
      'Viewport clicks should request selection when no sketch tool is active.',
    )
    assert(
      shouldViewportClickRequestSelection('constraintCoincident'),
      'Viewport clicks should request selection while a constraint tool is active.',
    )
    assert(
      shouldViewportClickRequestSelection('construction'),
      'Viewport clicks should request selection while Construction is picking an existing sketch target.',
    )
    assert(
      !shouldViewportClickRequestSelection('line'),
      'Viewport clicks should keep drawing tools on the pointer construction path.',
    )
  }

  function testViewportSketchGeometryDragCanInterruptIdleDrawingTools() {
    assert(
      shouldViewportStartSketchGeometryDrag(null, 'idle'),
      'Viewport sketch geometry drags should start when no sketch tool is active.',
    )
    assert(
      shouldViewportStartSketchGeometryDrag('line', 'idle'),
      'Idle drawing tools should allow dragged sketch vertices to interrupt placement.',
    )
    assert(
      !shouldViewportStartSketchGeometryDrag('line', 'drawing'),
      'Viewport sketch geometry drags should not interrupt an in-progress drawing gesture.',
    )
    assert(
      !shouldViewportStartSketchGeometryDrag('constraintCoincident', 'collectingTargets'),
      'Viewport sketch geometry drags should not interrupt constraint target collection.',
    )
    assert(
      !shouldViewportStartSketchGeometryDrag('construction', 'collectingTargets'),
      'Viewport sketch geometry drags should not interrupt Construction target-picking.',
    )
  }

  testFeatureReopenIntentUsesCommittedFeatureKind()
  testSketchReopenIntentUsesSketchFlow()
  testEscapePrefersReferencePickerCancellation()
  testEscapeClearsActiveSketchToolBeforeExitingSketch()
  testEscapeDoesNothingWhenSketchIsIdle()
  testViewportClickSelectionRoutingAllowsConstraintsOnly()
  testViewportSketchGeometryDragCanInterruptIdleDrawingTools()
})
