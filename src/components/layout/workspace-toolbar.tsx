import { useMemo, useState } from 'react'
import {
  Search,
} from 'lucide-react'

import { ToolButton } from '@/components/layout/tool-button'
import { ToolDropdownButton } from '@/components/layout/tool-dropdown-button'
import { Input } from '@/components/ui/input'
import {
  getToolById,
  getToolbarSectionsForMode,
  isDropdownTool,
  type RegisteredToolDefinition,
  searchToolDefinitions,
} from '@/domain/tools/tool-registry'
import { useEditorState } from '@/hooks/use-editor-state'

export function WorkspaceToolbar() {
  const [searchQuery, setSearchQuery] = useState('')
  const {
    state: { activeCommand, mode, sketchSession },
  } = useEditorState()
  const visibleSections = useMemo(() => getToolbarSectionsForMode(mode), [mode])
  const searchResults = useMemo(() => searchToolDefinitions(searchQuery), [searchQuery])
  const hasActiveSketchSession = sketchSession !== null

  const renderTool = (tool: RegisteredToolDefinition) => {
    if (tool.id === 'sketch' && hasActiveSketchSession) {
      return null
    }

    if (tool.id === 'finishSketch' && !hasActiveSketchSession) {
      return null
    }

    const isActive =
      activeCommand?.toolId === tool.id ||
      (isDropdownTool(tool) &&
        tool.dropdown.variantIds.some((variantId) => variantId === activeCommand?.toolId))

    if (isDropdownTool(tool)) {
      const variantTools = tool.dropdown.variantIds.map((toolId) => getToolById(toolId))
      return (
        <ToolDropdownButton
          key={tool.id}
          tool={tool}
          variantTools={variantTools}
          active={isActive}
        />
      )
    }

    return <ToolButton key={tool.id} tool={tool} active={isActive} />
  }

  return (
    <header className="border-b border-[var(--cad-border)] bg-[var(--cad-surface-muted)] px-4 py-1.5">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {visibleSections.map((section, index) => (
            <div
              key={section.id}
              className="flex items-center gap-3"
            >
              <div className="flex items-center gap-1">
                {section.toolIds.map((toolId) => renderTool(getToolById(toolId)))}
              </div>
              {index < visibleSections.length - 1 ? (
                <div className="h-8 w-px bg-[var(--cad-border-strong)]" aria-hidden="true" />
              ) : null}
            </div>
          ))}
        </div>

        <div className="relative w-full max-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cad-muted)]" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search tools"
            className="h-10 rounded-xl border-[var(--cad-border)] bg-[rgba(12,16,22,0.92)] pl-9"
          />
          {searchQuery && (
            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-full overflow-hidden rounded-xl border border-[var(--cad-border-strong)] bg-[rgba(9,13,18,0.98)] shadow-[var(--cad-panel-shadow)]">
              {searchResults.length > 0 ? (
                <div className="max-h-80 overflow-y-auto p-1">
                  {searchResults.map((tool) => {
                    return (
                      <ToolButton
                        key={`search-${tool.id}`}
                        tool={tool}
                        inline
                        active={activeCommand?.toolId === tool.id}
                        onTrigger={() => setSearchQuery('')}
                      />
                    )
                  })}
                </div>
              ) : (
                <div className="px-3 py-4 text-sm text-[var(--cad-muted-foreground)]">
                  No tools match “{searchQuery}”.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
