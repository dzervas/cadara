import type { ToolId } from '@/core/tools/tool-registry'
import { toolDefinitions, toolGroups } from '@/core/tools/tool-registry'
import type { ToolbarMode } from '@/core/tools/schema'

export type ShortcutScope = 'active-tool' | 'focused-panel' | 'global' | 'modal' | 'part' | 'sketch'

export type ShortcutCommandCategory =
  | 'Context Menus'
  | 'Documents'
  | 'Editor'
  | 'History'
  | 'Sketch'
  | 'Tools'
  | 'Viewport'

export type ToolCommandId = `tool.${ToolId}`
export type EditorCommandId =
  | 'editor.cancel'
  | 'editor.deleteSelection'
  | 'editor.focusSearch'
  | 'editor.redo'
  | 'editor.undo'
export type WorkbenchCommandId =
  | 'context.delete'
  | 'context.edit'
  | 'context.export'
  | 'context.inspectDiagnostic'
  | 'context.rename'
  | 'context.rollCursorHere'
  | 'context.selectTarget'
  | 'context.suppress'
  | 'document.activateNext'
  | 'document.activatePrevious'
  | 'document.activateTab1'
  | 'document.activateTab2'
  | 'document.activateTab3'
  | 'document.activateTab4'
  | 'document.activateTab5'
  | 'document.closeActive'
  | 'selection.clear'
  | 'viewport.fit'
  | 'viewport.viewBack'
  | 'viewport.viewBottom'
  | 'viewport.viewFront'
  | 'viewport.viewLeft'
  | 'viewport.viewRight'
  | 'viewport.viewTop'

export type ShortcutCommandId = ToolCommandId | EditorCommandId | WorkbenchCommandId

export interface ShortcutCommandDefinition {
  id: ShortcutCommandId
  label: string
  category: ShortcutCommandCategory
  scope: ShortcutScope
  defaultShortcuts: readonly string[]
  customizable: boolean
  allowTextEditingTargets?: boolean
  toolId?: ToolId
  nonCommandRationale?: string
}

export type ShortcutCommandRegistry = ReadonlyMap<ShortcutCommandId, ShortcutCommandDefinition>

const editorCommands = [
  {
    id: 'editor.undo',
    label: 'Undo',
    category: 'History',
    scope: 'global',
    defaultShortcuts: ['mod+z'],
    customizable: true,
  },
  {
    id: 'editor.redo',
    label: 'Redo',
    category: 'History',
    scope: 'global',
    defaultShortcuts: ['mod+shift+z', 'mod+y'],
    customizable: true,
  },
  {
    id: 'editor.cancel',
    label: 'Cancel',
    category: 'Editor',
    scope: 'global',
    defaultShortcuts: ['escape'],
    customizable: true,
  },
  {
    id: 'editor.deleteSelection',
    label: 'Delete Selection',
    category: 'Editor',
    scope: 'global',
    defaultShortcuts: ['delete', 'backspace'],
    customizable: true,
  },
  {
    id: 'editor.focusSearch',
    label: 'Focus Tool Search',
    category: 'Editor',
    scope: 'global',
    defaultShortcuts: ['mod+k'],
    customizable: true,
  },
] as const satisfies readonly ShortcutCommandDefinition[]

const workbenchCommands = [
  {
    id: 'context.rename',
    label: 'Rename',
    category: 'Context Menus',
    scope: 'focused-panel',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'context.delete',
    label: 'Delete',
    category: 'Context Menus',
    scope: 'focused-panel',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'context.export',
    label: 'Export',
    category: 'Context Menus',
    scope: 'focused-panel',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'context.edit',
    label: 'Edit',
    category: 'Context Menus',
    scope: 'focused-panel',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'context.rollCursorHere',
    label: 'Roll Cursor Here',
    category: 'Context Menus',
    scope: 'focused-panel',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'context.selectTarget',
    label: 'Select Target',
    category: 'Context Menus',
    scope: 'focused-panel',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'context.inspectDiagnostic',
    label: 'Inspect Diagnostic',
    category: 'Context Menus',
    scope: 'focused-panel',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'context.suppress',
    label: 'Suppress Feature',
    category: 'Context Menus',
    scope: 'focused-panel',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'selection.clear',
    label: 'Clear Selection',
    category: 'Editor',
    scope: 'global',
    defaultShortcuts: [],
    customizable: true,
    nonCommandRationale: 'Selection clearing is currently implicit through viewport selection flows.',
  },
  {
    id: 'viewport.fit',
    label: 'Fit View',
    category: 'Viewport',
    scope: 'global',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'viewport.viewTop',
    label: 'Top View',
    category: 'Viewport',
    scope: 'global',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'viewport.viewBottom',
    label: 'Bottom View',
    category: 'Viewport',
    scope: 'global',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'viewport.viewFront',
    label: 'Front View',
    category: 'Viewport',
    scope: 'global',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'viewport.viewBack',
    label: 'Back View',
    category: 'Viewport',
    scope: 'global',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'viewport.viewLeft',
    label: 'Left View',
    category: 'Viewport',
    scope: 'global',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'viewport.viewRight',
    label: 'Right View',
    category: 'Viewport',
    scope: 'global',
    defaultShortcuts: [],
    customizable: true,
  },
  {
    id: 'document.activateNext',
    label: 'Next Document',
    category: 'Documents',
    scope: 'global',
    defaultShortcuts: ['mod+shift+]'],
    customizable: true,
  },
  {
    id: 'document.activatePrevious',
    label: 'Previous Document',
    category: 'Documents',
    scope: 'global',
    defaultShortcuts: ['mod+shift+['],
    customizable: true,
  },
  {
    id: 'document.activateTab1',
    label: 'Activate Document 1',
    category: 'Documents',
    scope: 'global',
    defaultShortcuts: ['mod+1'],
    customizable: true,
  },
  {
    id: 'document.activateTab2',
    label: 'Activate Document 2',
    category: 'Documents',
    scope: 'global',
    defaultShortcuts: ['mod+2'],
    customizable: true,
  },
  {
    id: 'document.activateTab3',
    label: 'Activate Document 3',
    category: 'Documents',
    scope: 'global',
    defaultShortcuts: ['mod+3'],
    customizable: true,
  },
  {
    id: 'document.activateTab4',
    label: 'Activate Document 4',
    category: 'Documents',
    scope: 'global',
    defaultShortcuts: ['mod+4'],
    customizable: true,
  },
  {
    id: 'document.activateTab5',
    label: 'Activate Document 5',
    category: 'Documents',
    scope: 'global',
    defaultShortcuts: ['mod+5'],
    customizable: true,
  },
  {
    id: 'document.closeActive',
    label: 'Close Document',
    category: 'Documents',
    scope: 'global',
    defaultShortcuts: ['mod+w'],
    customizable: true,
  },
] as const satisfies readonly ShortcutCommandDefinition[]

const toolShortcutDefaults: Partial<Record<ToolId, readonly string[]>> = {
  circle: ['c'],
  construction: ['x'],
  dimension: ['d'],
  extrude: ['e'],
  finishSketch: ['shift+enter'],
  line: ['l'],
  rectangle: ['r'],
}

export function getToolCommandId(toolId: ToolId): ToolCommandId {
  return `tool.${toolId}`
}

export function getToolbarToolCommandId(toolId: ToolId): ShortcutCommandId {
  if (toolId === 'undo') {
    return 'editor.undo'
  }

  if (toolId === 'redo') {
    return 'editor.redo'
  }

  return getToolCommandId(toolId)
}

export function getShortcutCommandDefinitions() {
  return [
    ...deriveToolCommands(),
    ...editorCommands,
    ...workbenchCommands,
  ] as readonly ShortcutCommandDefinition[]
}

export function createShortcutCommandRegistry(
  commands: readonly ShortcutCommandDefinition[] = getShortcutCommandDefinitions(),
): ShortcutCommandRegistry {
  return new Map(commands.map((command) => [command.id, command]))
}

function deriveToolCommands() {
  return toolDefinitions.map((tool) => {
    const scope = getToolShortcutScope(tool.modes)
    const group = toolGroups[tool.group]

    return {
      id: getToolCommandId(tool.id),
      label: tool.name,
      category: group.id === 'history'
        ? 'History'
        : (group.modes as readonly ToolbarMode[]).includes('sketch')
          && !(group.modes as readonly ToolbarMode[]).includes('part')
          ? 'Sketch'
          : 'Tools',
      scope,
      defaultShortcuts: toolShortcutDefaults[tool.id] ?? [],
      customizable: tool.id !== 'pattern',
      toolId: tool.id,
    } satisfies ShortcutCommandDefinition
  })
}

function getToolShortcutScope(modes: readonly ToolbarMode[]): ShortcutScope {
  if (modes.length === 1) {
    return modes[0]
  }

  return 'global'
}
