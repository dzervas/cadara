import type { EditorEvent, EditorViewState } from '@/contracts/editor/state-machine'
import { getEscapeEvent } from '@/domain/editor/workbench-interactions'
import { getToolCommandId, type ShortcutScope } from '@/domain/shortcuts/commands'
import type { ToolTriggerMetadata } from '@/domain/tools/schema'
import { toolDefinitions, type ToolId } from '@/domain/tools/tool-registry'
import type { ShortcutCommandHandlers } from '@/hooks/shortcut-provider'

export interface WorkbenchShortcutHandlerOptions {
  activeCommand: EditorViewState['activeCommand']
  activeReferencePickerFieldId: EditorViewState['activeReferencePickerFieldId']
  dispatch: (event: EditorEvent) => void
  focusSearch?: () => void
  mode: EditorViewState['mode']
  selection: EditorViewState['selection']
  sketchSession: EditorViewState['sketchSession']
  triggerTool: (toolId: ToolId, metadata: ToolTriggerMetadata) => void
}

export function getWorkbenchShortcutActiveScopes(mode: EditorViewState['mode']): readonly ShortcutScope[] {
  return ['global', mode]
}

export function createWorkbenchShortcutCommandHandlers({
  activeCommand,
  activeReferencePickerFieldId,
  dispatch,
  focusSearch = focusWorkbenchSearch,
  mode,
  selection,
  sketchSession,
  triggerTool,
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
    'editor.deleteSelection': {
      execute: () => dispatch({ type: 'sketch.annotationDeleteRequested' }),
      isEnabled: () =>
        sketchSession !== null
        && (selection[0]?.kind === 'constraint' || selection[0]?.kind === 'dimension'),
    },
    'editor.focusSearch': {
      execute: focusSearch,
      isEnabled: () => true,
    },
  }

  for (const tool of toolDefinitions) {
    commandHandlers[getToolCommandId(tool.id)] = {
      execute: () => triggerTool(tool.id, { source: 'shortcut' }),
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
