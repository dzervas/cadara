import { forwardRef, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { ActionIcon, Paper, ScrollArea, Text, TextInput, Tooltip } from '@mantine/core'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import { ShortcutSettingsButton } from '@/components/shortcuts/shortcut-settings'
import { DocumentFileMenu } from '@/components/layout/document-file-menu'
import { ToolButton } from '@/components/layout/tool-button'
import { ToolDropdownButton } from '@/components/layout/tool-dropdown-button'
import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'
import { getNextToolSearchHighlightIndex } from '@/components/layout/workspace-toolbar.a11y'
import {
  getToolById,
  getToolbarSectionsForMode,
  isDropdownTool,
  type RegisteredToolDefinition,
  searchToolDefinitions,
} from '@/core/tools/tool-registry'
import {
  getActiveSketchStyleToolId,
  isSketchSvgRenderingEnabled,
  isSketchConstructionSelected,
} from '@/domain/editor/sketch-session'
import { isSketchStyleToolId } from '@/domain/sketch-styles/definition'
import { useEditorState } from '@/hooks/use-editor-state'
import { useWorkbenchCommandHandlers } from '@/hooks/use-workbench-command-handlers'
import type { EditorHistoryAvailability } from '@/domain/editor/state-machine'

const REPOSITORY_URL = 'https://github.com/dzervas/cadara'
const DISCORD_URL = 'https://discord.gg/T2dBRp4SAQ'

interface WorkspaceToolbarProps {
  historyAvailability?: EditorHistoryAvailability
  showBrowserStorageWarning?: boolean
  onNewDocument?: () => void
  onNewDocumentTab?: () => void
  onOpenLocalFile?: () => void
  onSaveLocalFile?: () => void
  onImportDocument?: (file: File) => void
  onExportDocument?: () => void
  onReportBug?: () => void
  onDownloadBugReportState?: () => void | Promise<void>
}

/**
 * Floating CAD toolbar — see DESIGN.md "Floating Toolbar (Pill Clusters)".
 *
 * The bar itself is `pointer-events: none` so the gaps between pills pass clicks through
 * to the viewport beneath; each pill carries `pointer-events: auto`. Tool clusters,
 * search, and the right-edge utility cluster are glass surfaces — `--workbench-glass-fill`
 * + `--workbench-glass-blur` + `--workbench-pill-shadow` — earned because they float over
 * the canvas (Floating-Glass Rule).
 */
export function WorkspaceToolbar({
  historyAvailability,
  showBrowserStorageWarning = false,
  onNewDocument = () => undefined,
  onNewDocumentTab = () => undefined,
  onOpenLocalFile = () => undefined,
  onSaveLocalFile = () => undefined,
  onImportDocument = () => undefined,
  onExportDocument = () => undefined,
  onReportBug,
  onDownloadBugReportState,
}: WorkspaceToolbarProps = {}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false)
  const [highlightedSearchResultIndex, setHighlightedSearchResultIndex] = useState(-1)
  const searchListboxId = useId()
  const searchRootRef = useRef<HTMLDivElement | null>(null)
  const {
    state: { activeCommand, activeEditSession, activeSketchPlaneEditSession, activeImportSession, history, mode, sketchSession },
  } = useEditorState()
  const { activateTool } = useWorkbenchCommandHandlers()
  const visibleHistory = historyAvailability ?? history
  const visibleSections = useMemo(
    () => getToolbarSectionsForMode(mode),
    [mode],
  )
  const searchResults = useMemo(
    () => searchToolDefinitions(searchQuery),
    [searchQuery],
  )
  const clampedHighlightedSearchResultIndex = searchResults.length === 0
    ? -1
    : highlightedSearchResultIndex < 0 || highlightedSearchResultIndex >= searchResults.length
      ? 0
      : highlightedSearchResultIndex
  const isSearchPopoverVisible = searchPopoverOpen && searchQuery.length > 0
  const hasActiveSketchSession = sketchSession !== null
  const canImportReferenceImage = sketchSession !== null || activeCommand?.toolId === 'sketch'

  const activeSketchStyleToolId = sketchSession ? getActiveSketchStyleToolId(sketchSession) : null
  const svgRenderingEnabled = sketchSession ? isSketchSvgRenderingEnabled(sketchSession) : false

  const isToolDisabled = (tool: RegisteredToolDefinition) =>
    (tool.id === 'undo' && !visibleHistory.canUndo)
    || (tool.id === 'redo' && !visibleHistory.canRedo)
    || (tool.id === 'import' && (activeEditSession !== null || activeSketchPlaneEditSession !== null || activeImportSession !== null))
    || (tool.id === 'importImage' && !canImportReferenceImage)
    || (isSketchStyleToolId(tool.id) && (!sketchSession || !svgRenderingEnabled))

  const closeSearchPopover = () => {
    setSearchPopoverOpen(false)
  }

  const triggerSearchTool = (tool: RegisteredToolDefinition) => {
    if (isToolDisabled(tool)) {
      return
    }

    void activateTool(tool.id, { source: 'search' })
    setSearchQuery('')
    setSearchPopoverOpen(false)
    setHighlightedSearchResultIndex(-1)
  }

  const handleDocumentPointerDown = useEffectEvent((event: PointerEvent) => {
    const eventTarget = event.target
    if (!(eventTarget instanceof Node)) {
      return
    }

    if (searchRootRef.current?.contains(eventTarget)) {
      return
    }

    closeSearchPopover()
  })

  useEffect(() => {
    if (!isSearchPopoverVisible) {
      return
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown)
    }
  }, [isSearchPopoverVisible])

  const handleSearchInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (!isSearchPopoverVisible) {
        return
      }

      event.preventDefault()
      closeSearchPopover()
      return
    }

    const nextIndex = getNextToolSearchHighlightIndex(clampedHighlightedSearchResultIndex, event.key, searchResults.length)
    if (nextIndex !== null) {
      event.preventDefault()
      setSearchPopoverOpen(true)
      setHighlightedSearchResultIndex(nextIndex)
      return
    }

    if (event.key !== 'Enter' || !isSearchPopoverVisible) {
      return
    }

    const highlightedTool = searchResults[clampedHighlightedSearchResultIndex]
    if (!highlightedTool) {
      return
    }

    event.preventDefault()
    triggerSearchTool(highlightedTool)
  }

  const activeSearchResult = clampedHighlightedSearchResultIndex >= 0
    ? searchResults[clampedHighlightedSearchResultIndex]
    : null
  const activeSearchResultId = activeSearchResult
    ? `${searchListboxId}-option-${activeSearchResult.id}`
    : undefined

  const renderTool = (tool: RegisteredToolDefinition) => {
    if (tool.id === 'sketch' && hasActiveSketchSession) {
      return null
    }

    if (tool.id === 'finishSketch' && !hasActiveSketchSession) {
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
    <div
      className="absolute left-4 right-4 top-3 z-30 flex h-[50px] items-center gap-2 text-[var(--workbench-shell-text)]"
      style={{ pointerEvents: 'none' }}
      role="toolbar"
      aria-label="CAD tools"
    >
      <DocumentFileMenu
        showBrowserStorageWarning={showBrowserStorageWarning}
        onNewDocument={onNewDocument}
        onNewDocumentTab={onNewDocumentTab}
        onOpenLocalFile={onOpenLocalFile}
        onSaveLocalFile={onSaveLocalFile}
        onImportDocument={onImportDocument}
        onExportDocument={onExportDocument}
        trigger={<SparkLogo />}
      />

      {/*
        Cluster row scrolls horizontally when the bar is too narrow to fit all
        clusters. The padding-y + negative margin-y trick gives the pill drop-shadows
        (`box-shadow: 0 12px 32px ...`) room to render *inside* the scroll container
        instead of being clipped at the cluster row's bottom edge — see DESIGN.md
        "Floating Toolbar (Pill Clusters)".
       */}
      <div
        className="flex min-w-0 items-center gap-2"
        style={{
          overflowX: 'auto',
          overflowY: 'hidden',
          paddingTop: 40,
          paddingBottom: 40,
          marginTop: -40,
          marginBottom: -40,
          scrollbarWidth: 'none',
        }}
      >
        {visibleSections.map((section) => (
          <ToolbarPill key={section.id} style={pillCommonStyle}>
            {section.toolIds.map((toolId) => renderTool(getToolById(toolId)))}
          </ToolbarPill>
        ))}
      </div>

      <div className="flex-1" />

      <div ref={searchRootRef} className="relative w-[260px] shrink-0" style={{ pointerEvents: 'auto' }}>
        <TextInput
          value={searchQuery}
          onChange={(event) => {
            const nextQuery = event.target.value
            setSearchQuery(nextQuery)
            setSearchPopoverOpen(nextQuery.length > 0)
            setHighlightedSearchResultIndex(nextQuery.length > 0 ? 0 : -1)
          }}
          onFocus={() => {
            if (searchQuery.length > 0) {
              setSearchPopoverOpen(true)
            }
          }}
          onKeyDown={handleSearchInputKeyDown}
          placeholder="Search tools"
          leftSection={<WorkbenchIcon name="search" className="h-4 w-4" />}
          rightSectionWidth={28}
          rightSection={<KbdHint label="/" />}
          data-workbench-command="editor.focusSearch"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={isSearchPopoverVisible ? searchListboxId : undefined}
          aria-activedescendant={isSearchPopoverVisible ? activeSearchResultId : undefined}
          aria-expanded={isSearchPopoverVisible}
          styles={{
            input: {
              height: 50,
              borderRadius: 12,
              backgroundColor: 'var(--workbench-glass-fill)',
              backdropFilter: 'var(--workbench-glass-blur)',
              WebkitBackdropFilter: 'var(--workbench-glass-blur)',
              borderColor: 'var(--workbench-glass-border)',
              borderWidth: 1,
              boxShadow: 'var(--workbench-pill-shadow)',
              color: 'var(--workbench-shell-text)',
              fontSize: 12.5,
            },
            section: {
              color: 'var(--workbench-shell-text-dim)',
            },
          }}
        />
        {isSearchPopoverVisible && (
          <Paper
            className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-full overflow-hidden"
            radius="md"
            style={{
              backgroundColor: 'var(--workbench-glass-fill-strong)',
              backdropFilter: 'var(--workbench-glass-blur)',
              WebkitBackdropFilter: 'var(--workbench-glass-blur)',
              border: '1px solid var(--workbench-glass-border)',
              boxShadow: 'var(--workbench-panel-shadow)',
            }}
          >
            {searchResults.length > 0 ? (
              <ScrollArea.Autosize mah={320} mx={4} my={4}>
                <div id={searchListboxId} role="listbox" aria-label="Tool search results" className="grid gap-1">
                  {searchResults.map((tool, index) => {
                    const optionId = `${searchListboxId}-option-${tool.id}`
                    const isHighlighted = searchResults[clampedHighlightedSearchResultIndex]?.id === tool.id
                    return (
                      <ToolButton
                        key={`search-${tool.id}`}
                        tool={tool}
                        inline
                        buttonId={optionId}
                        buttonRole="option"
                        buttonTabIndex={-1}
                        ariaSelected={isHighlighted}
                        active={activeCommand?.toolId === tool.id}
                        selected={isHighlighted}
                        disabled={isToolDisabled(tool)}
                        onButtonFocus={() => setHighlightedSearchResultIndex(index)}
                        onButtonMouseEnter={() => setHighlightedSearchResultIndex(index)}
                        onTrigger={() => {
                          setSearchQuery('')
                          setSearchPopoverOpen(false)
                          setHighlightedSearchResultIndex(-1)
                        }}
                      />
                    )
                  })}
                </div>
              </ScrollArea.Autosize>
            ) : (
              <div id={searchListboxId} role="listbox" aria-label="Tool search results">
                <Text c="dimmed" px="sm" py="md" size="sm" role="status">
                  No tools match “{searchQuery}”.
                </Text>
              </div>
            )}
          </Paper>
        )}
      </div>

      <ToolbarPill style={utilityPillStyle}>
        <ShortcutSettingsButton />
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
              size={32}
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
              title="Discord"
              description="Join the CADara community."
            />
          }
        >
          <ActionIcon
            component="a"
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            variant="subtle"
            color="workbench"
            size={32}
            aria-label="Join Discord community"
          >
            <WorkbenchIcon name="discord" className="h-4 w-4" />
          </ActionIcon>
        </Tooltip>
        <Tooltip
          label={
            <ToolbarTooltipContent
              title="GitHub"
              description="Open the CADara repository."
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
            size={32}
            aria-label="Open repository on GitHub"
          >
            <WorkbenchIcon name="github" className="h-4 w-4" />
          </ActionIcon>
        </Tooltip>
      </ToolbarPill>
    </div>
  )
}

const pillCommonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 4,
  borderRadius: 12,
  backgroundColor: 'var(--workbench-glass-fill)',
  backdropFilter: 'var(--workbench-glass-blur)',
  WebkitBackdropFilter: 'var(--workbench-glass-blur)',
  border: '1px solid var(--workbench-glass-border)',
  boxShadow: 'var(--workbench-pill-shadow)',
  flexShrink: 0,
  pointerEvents: 'auto',
}

const utilityPillStyle: CSSProperties = {
  ...pillCommonStyle,
}

interface ToolbarPillProps {
  style: CSSProperties
  children: ReactNode
}

function ToolbarPill({ style, children }: ToolbarPillProps) {
  return <div style={style}>{children}</div>
}

/**
 * The brand mark — the first of the three Spark Affordances. Identity, not ornament.
 * Doubles as the file-menu trigger: clicking it opens the document file menu, replacing
 * the older standalone file button. See DESIGN.md "Spark Affordance Rule".
 */
const SparkLogo = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function SparkLogo(props, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label="File"
        data-workbench-file-menu=""
        {...props}
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 10,
          background: 'var(--workbench-spark-accent)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--workbench-spark-accent-ink)',
          fontWeight: 700,
          fontSize: 14,
          boxShadow: 'var(--workbench-spark-logo-shadow)',
          pointerEvents: 'auto',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'inherit',
          ...props.style,
        }}
      >
        C
      </button>
    )
  },
)

function KbdHint({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 10.5,
        padding: '2px 5px',
        borderRadius: 4,
        border: '1px solid var(--workbench-kbd-border)',
        color: 'var(--workbench-shell-text-dim)',
      }}
    >
      {label}
    </span>
  )
}
