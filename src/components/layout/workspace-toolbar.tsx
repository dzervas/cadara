import { useMemo, useState } from 'react'
import { ActionIcon, Divider, Paper, ScrollArea, Text, TextInput, Tooltip } from '@mantine/core'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import { ShortcutSettingsButton } from '@/components/shortcuts/shortcut-settings'
import { DocumentFileMenu } from '@/components/layout/document-file-menu'
import { ToolButton } from '@/components/layout/tool-button'
import { ToolDropdownButton } from '@/components/layout/tool-dropdown-button'
import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'
import {
  getToolById,
  getToolbarSectionsForMode,
  isDropdownTool,
  type RegisteredToolDefinition,
  searchToolDefinitions,
} from '@/domain/tools/tool-registry'
import {
  getActiveSketchStyleToolId,
  isSketchSvgRenderingEnabled,
  isSketchConstructionSelected,
  sketchSessionHasImageReference,
} from '@/domain/editor/sketch-session'
import { isSketchStyleToolId } from '@/domain/sketch-styles/definition'
import { useEditorState } from '@/hooks/use-editor-state'
import type { EditorHistoryAvailability } from '@/contracts/editor/state-machine'

const REPOSITORY_URL = 'https://github.com/dzervas/cadara'

interface WorkspaceToolbarProps {
  historyAvailability?: EditorHistoryAvailability
  showBrowserStorageWarning?: boolean
  onNewDocument?: () => void
  onOpenLocalFile?: () => void
  onSaveLocalFile?: () => void
  onImportDocument?: (file: File) => void
  onExportDocument?: () => void
  onReportBug?: () => void
  onDownloadBugReportState?: () => void | Promise<void>
}

export function WorkspaceToolbar({
  historyAvailability,
  showBrowserStorageWarning = false,
  onNewDocument = () => undefined,
  onOpenLocalFile = () => undefined,
  onSaveLocalFile = () => undefined,
  onImportDocument = () => undefined,
  onExportDocument = () => undefined,
  onReportBug,
  onDownloadBugReportState,
}: WorkspaceToolbarProps = {}) {
  const [searchQuery, setSearchQuery] = useState('')
  const {
    state: { activeCommand, activeEditSession, activeImportSession, history, mode, sketchSession },
  } = useEditorState()
  const visibleHistory = historyAvailability ?? history
  const visibleSections = useMemo(
    () => getToolbarSectionsForMode(mode),
    [mode],
  )
  const searchResults = useMemo(
    () => searchToolDefinitions(searchQuery),
    [searchQuery],
  )
  const hasActiveSketchSession = sketchSession !== null

  const activeSketchStyleToolId = sketchSession ? getActiveSketchStyleToolId(sketchSession) : null
  const svgRenderingEnabled = sketchSession ? isSketchSvgRenderingEnabled(sketchSession) : false

  const isToolDisabled = (tool: RegisteredToolDefinition) =>
    (tool.id === 'undo' && !visibleHistory.canUndo)
    || (tool.id === 'redo' && !visibleHistory.canRedo)
    || (tool.id === 'import' && (activeEditSession !== null || activeImportSession !== null))
    || (isSketchStyleToolId(tool.id) && (!sketchSession || !svgRenderingEnabled))

  const renderTool = (tool: RegisteredToolDefinition) => {
    if (tool.id === 'sketch' && hasActiveSketchSession) {
      return null
    }

    if (tool.id === 'finishSketch' && !hasActiveSketchSession) {
      return null
    }

    if (tool.id === 'anchorPoint' && (!sketchSession || !sketchSessionHasImageReference(sketchSession))) {
      return null
    }

    const isActive =
      (tool.id === 'construction' && sketchSession !== null && isSketchConstructionSelected(sketchSession)) ||
      (tool.id === 'svgRendering' && svgRenderingEnabled) ||
      activeSketchStyleToolId === tool.id ||
      activeCommand?.toolId === tool.id ||
      (isDropdownTool(tool) &&
        tool.dropdown.variantIds.some((variantId) =>
          variantId === activeCommand?.toolId,
        ))

    const disabled = isToolDisabled(tool)

    if (isDropdownTool(tool)) {
      const variantTools = tool.dropdown.variantIds.map((toolId) => getToolById(toolId))
      return (
        <ToolDropdownButton
          key={tool.id}
          tool={tool}
          variantTools={variantTools}
          active={isActive}
          disabled={disabled}
        />
      )
    }

    return <ToolButton key={tool.id} tool={tool} active={isActive} disabled={disabled} />
  }

  return (
    <Paper
      component="header"
      radius={0}
      px="md"
      // py={4}
      style={{
        backgroundColor: 'var(--workbench-shell-surface-strong)',
        boxShadow: 'var(--workbench-shell-elevation-toolbar)',
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <DocumentFileMenu
          showBrowserStorageWarning={showBrowserStorageWarning}
          onNewDocument={onNewDocument}
          onOpenLocalFile={onOpenLocalFile}
          onSaveLocalFile={onSaveLocalFile}
          onImportDocument={onImportDocument}
          onExportDocument={onExportDocument}
        />
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex w-max items-center gap-3">
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
                    style={{ borderColor: 'var(--workbench-shell-overlay-strong)', height: 'auto', opacity: 0.6 }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="relative w-full max-w-[240px] shrink-0">
          <TextInput
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search tools"
            leftSection={<WorkbenchIcon name="search" className="h-4 w-4" />}
            data-workbench-command="editor.focusSearch"
            styles={{
              input: {
                height: 30,
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
                          disabled={isToolDisabled(tool)}
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
        <div className="shrink-0">
          <ShortcutSettingsButton />
        </div>
        {onReportBug ? (
          <Tooltip
            label={
              <ToolbarTooltipContent
                title="Report bug"
                description="Open a GitHub bug report. Right-click to download diagnostics."
              />
            }
          >
            <ActionIcon
              type="button"
              variant="subtle"
              color="workbench"
              className="shrink-0"
              aria-label="Report bug"
              onClick={onReportBug}
              onContextMenu={onDownloadBugReportState
                ? (event) => {
                    event.preventDefault()
                    void onDownloadBugReportState()
                  }
                : undefined}
            >
              <WorkbenchIcon name="reportBug" className="h-4 w-4" />
            </ActionIcon>
          </Tooltip>
        ) : null}
        <Tooltip
          label={
            <ToolbarTooltipContent
              title="GitHub"
              description="Open the Cadara repository."
            />
          }
        >
          <ActionIcon
            component="a"
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            variant="subtle"
            color="workbench"
            className="shrink-0"
            aria-label="Open repository on GitHub"
          >
            <WorkbenchIcon name="github" className="h-4 w-4" />
          </ActionIcon>
        </Tooltip>
      </div>
    </Paper>
  )
}
