import { useMemo, useState } from 'react'
import { Divider, Paper, ScrollArea, Text, TextInput } from '@mantine/core'
import { Search } from 'lucide-react'

import { ToolButton } from '@/components/layout/tool-button'
import { ToolDropdownButton } from '@/components/layout/tool-dropdown-button'
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
    <Paper
      component="header"
      radius={0}
      px="md"
      py={6}
      style={{
        backgroundColor: 'var(--workbench-shell-surface-strong)',
        borderBottom: '1px solid var(--workbench-shell-border)',
      }}
    >
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
                <Divider
                  orientation="vertical"
                  style={{ borderColor: 'var(--workbench-shell-border-strong)', height: 32 }}
                />
              ) : null}
            </div>
          ))}
        </div>

        <div className="relative w-full max-w-[240px]">
          <TextInput
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search tools"
            leftSection={<Search className="h-4 w-4" />}
            styles={{
              input: {
                height: 40,
              },
            }}
          />
          {searchQuery && (
            <Paper
              className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-full overflow-hidden"
              withBorder
              style={{
                backgroundColor: 'var(--workbench-shell-overlay-strong)',
                borderColor: 'var(--workbench-shell-border-strong)',
                boxShadow: 'var(--workbench-panel-shadow)',
              }}
            >
              {searchResults.length > 0 ? (
                <ScrollArea.Autosize mah={320} mx={4} my={4}>
                  <div className="grid gap-1">
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
                </ScrollArea.Autosize>
              ) : (
                <Text c="dimmed" px="sm" py="md" size="sm">
                  No tools match “{searchQuery}”.
                </Text>
              )}
            </Paper>
          )}
        </div>
      </div>
    </Paper>
  )
}
