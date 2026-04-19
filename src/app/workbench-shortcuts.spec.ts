import { test } from 'bun:test'

import type { EditorEvent, EditorViewState } from '@/contracts/editor/state-machine'
import type { PrimitiveRef } from '@/domain/editor/schema'
import { createWorkbenchShortcutCommandHandlers, getWorkbenchShortcutActiveScopes } from '@/app/workbench-shortcuts'
import { createShortcutCommandRegistry, getShortcutCommandDefinitions } from '@/domain/shortcuts/commands'
import { createEffectiveKeymap } from '@/domain/shortcuts/keymap'
import { createShortcutResolver, type ShortcutResolverEvent } from '@/domain/shortcuts/resolver'
import { createToolActionBus } from '@/domain/tools/tool-action-bus'
import type { ToolId } from '@/domain/tools/tool-registry'
import { isTextEditingTarget } from '@/hooks/shortcut-targets'

test('src/app/workbench-shortcuts.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const deleteFixture = createFixture({
    mode: 'sketch',
    selection: [{ kind: 'dimension', sketchId: 'sketch_a', dimensionId: 'dimension_a' } as PrimitiveRef],
    sketchSession: createSketchSession(),
  })

  const deleteResult = deleteFixture.press({ key: 'Delete' })
  assert(deleteResult.commandId === 'editor.deleteSelection', 'Delete should resolve the annotation delete command.')
  assert(
    deleteFixture.dispatchedEvents.at(-1)?.type === 'sketch.annotationDeleteRequested',
    'Delete shortcut should dispatch the annotation delete event.',
  )

  const backspaceFixture = createFixture({
    mode: 'sketch',
    selection: [{ kind: 'constraint', sketchId: 'sketch_a', constraintId: 'constraint_a' } as PrimitiveRef],
    sketchSession: createSketchSession(),
  })

  const backspaceResult = backspaceFixture.press({ key: 'Backspace' })
  assert(backspaceResult.commandId === 'editor.deleteSelection', 'Backspace should resolve the annotation delete command.')
  assert(
    backspaceFixture.dispatchedEvents.at(-1)?.type === 'sketch.annotationDeleteRequested',
    'Backspace shortcut should dispatch the annotation delete event.',
  )

  const deleteGeometryFixture = createFixture({
    mode: 'sketch',
    selection: [{ kind: 'sketchEntity', sketchId: 'sketch_draft', entityId: 'sketch_entity_1' } as PrimitiveRef],
    sketchSession: createSketchSession(),
  })

  const deleteGeometryResult = deleteGeometryFixture.press({ key: 'Delete' })
  assert(deleteGeometryResult.commandId === 'editor.deleteSelection', 'Delete should resolve for selected sketch geometry.')
  assert(
    deleteGeometryFixture.dispatchedEvents.at(-1)?.type === 'sketch.annotationDeleteRequested',
    'Delete shortcut should dispatch the shared delete-selection event for sketch geometry.',
  )

  const backspacePointFixture = createFixture({
    mode: 'sketch',
    selection: [{ kind: 'sketchPoint', sketchId: 'sketch_draft', pointId: 'sketch_point_1' } as PrimitiveRef],
    sketchSession: createSketchSession(),
  })

  const backspacePointResult = backspacePointFixture.press({ key: 'Backspace' })
  assert(backspacePointResult.commandId === 'editor.deleteSelection', 'Backspace should resolve for selected sketch points.')
  assert(
    backspacePointFixture.dispatchedEvents.at(-1)?.type === 'sketch.annotationDeleteRequested',
    'Backspace shortcut should dispatch the shared delete-selection event for sketch points.',
  )

  const sketchFixture = createFixture({
    mode: 'sketch',
    sketchSession: createSketchSession(),
  })

  const lineResult = sketchFixture.press({ key: 'l' })
  assert(lineResult.commandId === 'tool.line', 'Line shortcut should resolve to the Line tool command in sketch mode.')
  assert(sketchFixture.triggeredToolIds.at(-1) === 'line', 'Line shortcut should trigger the Line tool.')
  assert(sketchFixture.observedLineSource === 'shortcut', 'Line shortcut should route shortcut source metadata.')

  const escapeFixture = createFixture({
    mode: 'sketch',
    sketchSession: createSketchSession('line'),
  })

  const escapeResult = escapeFixture.press({ key: 'Escape' })
  assert(escapeResult.commandId === 'editor.cancel', 'Escape should resolve to the workbench cancel command.')
  assert(
    escapeFixture.dispatchedEvents.at(-1)?.type === 'sketch.activeToolCleared',
    'Escape should dispatch the sketch active-tool clear event when a sketch tool is active.',
  )

  const escapeStyleFocusFixture = createFixture({
    mode: 'sketch',
    selection: [{ kind: 'sketchEntity', sketchId: 'sketch_draft', entityId: 'sketch_entity_1' } as PrimitiveRef],
    sketchSession: createSketchSession(null, 'stroke'),
  })

  const escapeStyleFocusResult = escapeStyleFocusFixture.press({ key: 'Escape' })
  assert(escapeStyleFocusResult.commandId === 'editor.cancel', 'Escape should resolve to cancel while a sketch style tool is focused.')
  assert(
    escapeStyleFocusFixture.dispatchedEvents.at(-1)?.type === 'sketch.activeToolCleared',
    'Escape should dispatch sketch active-tool clear before clearing selection while a style tool is focused.',
  )

  const escapeSelectionFixture = createFixture({
    mode: 'part',
    selection: [{ kind: 'body', bodyId: 'body_a' } as PrimitiveRef],
  })

  const escapeSelectionResult = escapeSelectionFixture.press({ key: 'Escape' })
  assert(escapeSelectionResult.commandId === 'editor.cancel', 'Escape should resolve to cancel for selection clearing.')
  assert(
    escapeSelectionFixture.dispatchedEvents.at(-1)?.type === 'selection.cleared',
    'Escape should dispatch selection clearing when no higher-priority interaction handles it.',
  )

  const finishSketchFixture = createFixture({
    mode: 'sketch',
    sketchSession: createSketchSession(),
  })

  const finishSketchResult = finishSketchFixture.press({ key: 'Enter', shiftKey: true })
  assert(finishSketchResult.commandId === 'tool.finishSketch', 'Shift+Enter should resolve to Finish Sketch.')
  assert(
    finishSketchFixture.triggeredToolIds.at(-1) === 'finishSketch',
    'Finish Sketch shortcut should trigger the finishSketch tool.',
  )

  const guardedInputFixture = createFixture({
    mode: 'sketch',
    sketchSession: createSketchSession(),
  })
  let inputPrevented = false
  const inputResult = guardedInputFixture.press({
    key: 'l',
    target: createTextTarget({ tagName: 'input' }),
    preventDefault: () => {
      inputPrevented = true
    },
  })
  assert(!inputResult.handled && !inputPrevented, 'Printable tool shortcuts should not be handled from inputs.')
  assert(guardedInputFixture.triggeredToolIds.length === 0, 'Input guard should prevent Line activation.')

  const guardedContentEditableFixture = createFixture({
    mode: 'sketch',
    sketchSession: createSketchSession(),
  })
  const contentEditableResult = guardedContentEditableFixture.press({
    key: 'l',
    target: createTextTarget({ isContentEditable: true }),
  })
  assert(
    !contentEditableResult.handled,
    'Printable tool shortcuts should not be handled from contenteditable targets.',
  )
  assert(
    guardedContentEditableFixture.triggeredToolIds.length === 0,
    'Contenteditable guard should prevent Line activation.',
  )

  const partModeFixture = createFixture({ mode: 'part' })
  const partLineResult = partModeFixture.press({ key: 'l' })
  assert(partLineResult.commandId === null, 'Sketch tool shortcuts should not resolve in part mode.')
  assert(partModeFixture.triggeredToolIds.length === 0, 'Part mode should not trigger sketch-only tools.')

  const sketchModeFixture = createFixture({
    mode: 'sketch',
    sketchSession: createSketchSession(),
  })
  const sketchExtrudeResult = sketchModeFixture.press({ key: 'e' })
  assert(sketchExtrudeResult.commandId === null, 'Part tool shortcuts should not resolve in sketch mode.')
  assert(sketchModeFixture.triggeredToolIds.length === 0, 'Sketch mode should not trigger part-only tools.')
})

interface FixtureOptions {
  mode: EditorViewState['mode']
  selection?: EditorViewState['selection']
  sketchSession?: EditorViewState['sketchSession']
}

function createFixture({
  mode,
  selection = [],
  sketchSession = null,
}: FixtureOptions) {
  const actionBus = createToolActionBus()
  const dispatchedEvents: EditorEvent[] = []
  const triggeredToolIds: ToolId[] = []
  let observedLineSource: string | null = null

  actionBus.subscribeToTool('line', (event) => {
    observedLineSource = event.source
  })

  const commandHandlers = createWorkbenchShortcutCommandHandlers({
    activeCommand: null,
    activeReferencePickerFieldId: null,
    dispatch: (event) => {
      dispatchedEvents.push(event)
    },
    mode,
    selection,
    sketchSession,
    triggerTool: (toolId, metadata) => {
      triggeredToolIds.push(toolId)
      actionBus.triggerTool(toolId, mode, metadata)
    },
  })
  const registry = createShortcutCommandRegistry(getShortcutCommandDefinitions())
  const resolver = createShortcutResolver(registry, createEffectiveKeymap(registry))

  return {
    get dispatchedEvents() {
      return dispatchedEvents
    },
    get observedLineSource() {
      return observedLineSource
    },
    press(event: ShortcutResolverEvent) {
      return resolver.handleKeyDown(event, {
        activeScopes: getWorkbenchShortcutActiveScopes(mode),
        executeCommand: (command) => commandHandlers[command.id]?.execute(),
        isCommandEnabled: (command) =>
          commandHandlers[command.id]?.isEnabled?.() ?? Boolean(commandHandlers[command.id]),
        isTextEditingTarget,
        platform: 'windows',
      })
    },
    triggeredToolIds,
  }
}

function createSketchSession(
  activeTool: NonNullable<EditorViewState['sketchSession']>['activeTool'] = null,
  styleToolId: 'stroke' | null = null,
) {
  return {
    sketchId: null,
    definition: {
      pointIds: ['sketch_point_1'],
      entityIds: ['sketch_entity_1'],
    },
    activeTool,
    activeStyleFocus: styleToolId
      ? {
          toolId: styleToolId,
          target: {
            kind: 'sketchEntity',
            sketchId: 'sketch_draft',
            entityId: 'sketch_entity_1',
          },
        }
      : null,
  } as EditorViewState['sketchSession']
}

function createTextTarget(target: { isContentEditable?: true; tagName?: string }) {
  return target as EventTarget
}
