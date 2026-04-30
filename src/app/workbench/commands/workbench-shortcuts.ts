import type { EditorEvent, EditorViewState } from '@/domain/editor/state-machine'
import { isEditableSketchGeometrySelection } from '@/domain/editor/sketch-session'
import { getEscapeEvent } from '@/domain/editor/workbench-interactions'
import { getToolCommandId, type ShortcutScope } from '@/core/shortcuts/commands'
import { toolDefinitions } from '@/core/tools/tool-registry'
import type { WorkbenchCommandHandlers } from '@/hooks/workbench-command-context'
import type { ShortcutCommandHandlers } from '@/hooks/shortcut-provider'

export interface WorkbenchShortcutHandlerOptions {
  activeCommand: EditorViewState['activeCommand']
  activeReferencePickerFieldId: EditorViewState['activeReferencePickerFieldId']
  canRedo?: boolean
  canUndo?: boolean
  dispatch: (event: EditorEvent) => void
  focusSearch?: () => void
  mode: EditorViewState['mode']
  requestRedo?: () => void
  requestUndo?: () => void
  selection: EditorViewState['selection']
  sketchSession: EditorViewState['sketchSession']
  activateTool: WorkbenchCommandHandlers['activateTool']
}

export function getWorkbenchShortcutActiveScopes(mode: EditorViewState['mode']): readonly ShortcutScope[] {
  return ['global', mode]
}

export function createWorkbenchShortcutCommandHandlers({
  activeCommand,
  activeReferencePickerFieldId,
  canRedo = true,
  canUndo = true,
  dispatch,
  focusSearch = focusWorkbenchSearch,
  mode,
  requestRedo,
  requestUndo,
  selection,
  sketchSession,
  activateTool,
}: WorkbenchShortcutHandlerOptions): ShortcutCommandHandlers {
  const commandHandlers: ShortcutCommandHandlers = {
    'editor.cancel': {
      execute: () => {
        const escapeEvent = getEscapeEvent({
          activeCommand,
          activeReferencePickerFieldId,
          selection,
          sketchSession,
        })

        if (escapeEvent) {
          dispatch(escapeEvent)
        }
      },
      isEnabled: () => getEscapeEvent({
        activeCommand,
        activeReferencePickerFieldId,
        selection,
        sketchSession,
      }) !== null,
    },
    'editor.redo': {
      execute: () => {
        requestRedo?.()
      },
      isEnabled: () => canRedo,
    },
    'editor.undo': {
      execute: () => {
        requestUndo?.()
      },
      isEnabled: () => canUndo,
    },
    'editor.deleteSelection': {
      execute: () => dispatch({ type: 'sketch.annotationDeleteRequested' }),
      isEnabled: () =>
        sketchSession !== null
        && (
          selection[0]?.kind === 'constraint'
          || selection[0]?.kind === 'dimension'
          || selection[0]?.kind === 'projectedReferenceGeometry'
          || selection[0]?.kind === 'sketchExternalReference'
          || isEditableSketchGeometrySelection(sketchSession, selection)
        ),
    },
    'editor.focusSearch': {
      execute: focusSearch,
      isEnabled: () => true,
    },
  }

  for (const tool of toolDefinitions) {
    commandHandlers[getToolCommandId(tool.id)] = {
      execute: () => {
        void activateTool(tool.id, { source: 'shortcut' })
      },
      isEnabled: () =>
        (tool.modes as readonly typeof mode[]).includes(mode)
        && (tool.id !== 'finishSketch' || sketchSession !== null)
        && (tool.id !== 'sketch' || sketchSession === null),
    }
  }

  return commandHandlers
}

function focusWorkbenchSearch() {
  if (typeof document === 'undefined') {
    return
  }

  const searchInput = document.querySelector<HTMLInputElement>(
    'input[data-workbench-command="editor.focusSearch"], [data-workbench-command="editor.focusSearch"] input',
  )
  searchInput?.focus()
}
