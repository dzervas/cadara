import { forwardRef, useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
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
import { getToolbarActionIconStyle, sparkLogoClassName, toolbarActionIconClassName } from '@/theme/workbench-toolbar-styles'

const REPOSITORY_URL = 'https://github.com/dzervas/cadara'
const DISCORD_URL = 'https://discord.gg/T2dBRp4SAQ'
const TOOLBAR_GAP_PX = 8
const TOOLBAR_SHADOW_GUTTER_PX = 32
const TOOLBAR_SEARCH_SHADOW_RESERVE_PX = 32
type VisibleToolbarSection = ReturnType<typeof getToolbarSectionsForMode>[number]
interface ResponsiveToolbarSectionState {
  sectionKey: string
  primarySectionIds: readonly string[]
}

interface WorkspaceToolbarProps {
  historyAvailability?: EditorHistoryAvailability
  showBrowserStorageWarning?: boolean
  onNewDocument?: () => void
  onOpenDocument?: () => void
  onSaveDocumentAs?: () => void
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
  onOpenDocument = () => undefined,
  onSaveDocumentAs = () => undefined,
  onReportBug,
  onDownloadBugReportState,
}: WorkspaceToolbarProps = {}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false)
  const [highlightedSearchResultIndex, setHighlightedSearchResultIndex] = useState(-1)
  const [responsiveSectionState, setResponsiveSectionState] = useState<ResponsiveToolbarSectionState | null>(null)
  const searchListboxId = useId()
  const primaryRailRef = useRef<HTMLDivElement | null>(null)
  const searchRootRef = useRef<HTMLDivElement | null>(null)
  const toolbarSectionElementsRef = useRef(new Map<string, HTMLDivElement>())
  const {
    state: { activeCommand, activeEditSession, activeSketchPlaneEditSession, activeImportSession, history, mode, sketchSession },
  } = useEditorState()
  const { activateTool } = useWorkbenchCommandHandlers()
  const visibleHistory = historyAvailability ?? history
  const visibleSections = useMemo(
    () => getToolbarSectionsForMode(mode),
    [mode],
  )
  const visibleSectionIds = useMemo(() => visibleSections.map((section) => section.id), [visibleSections])
  const visibleSectionKey = visibleSectionIds.join('|')
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
  const activePrimarySectionIds = useMemo(() => {
    const visibleIdSet = new Set<string>(visibleSectionIds)
    const measuredPrimaryIds = responsiveSectionState?.sectionKey === visibleSectionKey
      ? responsiveSectionState.primarySectionIds.filter((sectionId) => visibleIdSet.has(sectionId))
      : []
    return measuredPrimaryIds.length > 0 ? measuredPrimaryIds : visibleSectionIds
  }, [responsiveSectionState, visibleSectionIds, visibleSectionKey])
  const activePrimarySectionIdSet = useMemo(
    () => new Set(activePrimarySectionIds),
    [activePrimarySectionIds],
  )
  const primarySections = visibleSections.filter((section) => activePrimarySectionIdSet.has(section.id))
  const overflowSections = visibleSections.filter((section) => !activePrimarySectionIdSet.has(section.id))

  const setToolbarSectionRef = useCallback(
    (sectionId: string) => (node: HTMLDivElement | null) => {
      if (node) {
        toolbarSectionElementsRef.current.set(sectionId, node)
        return
      }
      toolbarSectionElementsRef.current.delete(sectionId)
    },
    [],
  )

  const updateResponsiveSections = useCallback(() => {
    const primaryRail = primaryRailRef.current
    if (!primaryRail) {
      return
    }

    const availableWidth = primaryRail.clientWidth - TOOLBAR_SHADOW_GUTTER_PX * 2 - TOOLBAR_SEARCH_SHADOW_RESERVE_PX
    if (availableWidth <= 0) {
      return
    }

    const widths = visibleSections.map((section) => ({
      section,
      width: toolbarSectionElementsRef.current.get(section.id)?.getBoundingClientRect().width ?? 0,
    }))
    if (widths.some(({ width }) => width <= 0)) {
      return
    }

    const nextPrimarySectionIds: string[] = []
    let occupiedWidth = 0

    for (const { section, width } of widths) {
      const nextWidth = occupiedWidth + (nextPrimarySectionIds.length > 0 ? TOOLBAR_GAP_PX : 0) + width
      if (nextWidth <= availableWidth || nextPrimarySectionIds.length === 0) {
        nextPrimarySectionIds.push(section.id)
        occupiedWidth = nextWidth
        continue
      }

      break
    }

    setResponsiveSectionState((current) => {
      if (
        current?.sectionKey === visibleSectionKey
        && current.primarySectionIds.length === nextPrimarySectionIds.length
        && current.primarySectionIds.every((sectionId, index) => sectionId === nextPrimarySectionIds[index])
      ) {
        return current
      }
      return {
        sectionKey: visibleSectionKey,
        primarySectionIds: nextPrimarySectionIds,
      }
    })
  }, [visibleSections, visibleSectionKey])

  useEffect(() => {
    const primaryRail = primaryRailRef.current
    if (!primaryRail) {
      return
    }

    let frameId = window.requestAnimationFrame(updateResponsiveSections)
    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(updateResponsiveSections)
    })

    resizeObserver.observe(primaryRail)
    return () => {
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [updateResponsiveSections])

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

  const renderSection = (section: VisibleToolbarSection) => (
    <ToolbarPill
      key={section.id}
      ref={setToolbarSectionRef(section.id)}
      sectionId={section.id}
      style={pillCommonStyle}
    >
      {section.toolIds.map((toolId) => renderTool(getToolById(toolId)))}
    </ToolbarPill>
  )

  return (
    <div
      className="absolute left-4 right-4 top-3 z-30 grid gap-x-2 gap-y-2 text-[var(--workbench-shell-text)]"
      style={{
        alignItems: 'start',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
        pointerEvents: 'none',
      }}
      role="toolbar"
      aria-label="CAD tools"
      data-toolbar-responsive-rows={overflowSections.length > 0 ? '2' : '1'}
    >
      <DocumentFileMenu
        showBrowserStorageWarning={showBrowserStorageWarning}
        onNewDocument={onNewDocument}
        onOpenDocument={onOpenDocument}
        onSaveDocumentAs={onSaveDocumentAs}
        trigger={<SparkLogo />}
      />

      {/*
        Whole tool groups progressively spill into a second rail before they
        can collide with search or utilities. The second rail scrolls
        horizontally if a dense mode still exceeds the viewport, so the toolbar
        never creates a third row.
       */}
      <div
        ref={primaryRailRef}
        data-toolbar-primary-rail=""
        className="flex min-w-0 items-center gap-2"
        style={{
          boxSizing: 'border-box',
          gridColumn: '2',
          gridRow: '1',
          minHeight: 50,
          overflowX: 'hidden',
          overflowY: 'hidden',
          paddingTop: 40,
          paddingRight: TOOLBAR_SHADOW_GUTTER_PX,
          paddingBottom: 40,
          paddingLeft: TOOLBAR_SHADOW_GUTTER_PX,
          marginTop: -40,
          marginRight: -TOOLBAR_SHADOW_GUTTER_PX,
          marginBottom: -40,
          marginLeft: -TOOLBAR_SHADOW_GUTTER_PX,
          scrollbarWidth: 'none',
        }}
      >
        {primarySections.map(renderSection)}
      </div>

      <div
        ref={searchRootRef}
        className="relative w-[clamp(184px,22vw,260px)] shrink-0"
        style={{ gridColumn: '3', gridRow: '1', pointerEvents: 'auto' }}
      >
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

      <ToolbarPill sectionId="utilities" style={utilityPillStyle}>
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
              className={toolbarActionIconClassName}
              style={getToolbarActionIconStyle()}
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
            className={toolbarActionIconClassName}
            style={getToolbarActionIconStyle()}
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
            className={toolbarActionIconClassName}
            style={getToolbarActionIconStyle()}
          >
            <WorkbenchIcon name="github" className="h-4 w-4" />
          </ActionIcon>
        </Tooltip>
      </ToolbarPill>
      {overflowSections.length > 0 ? (
        <div
          data-toolbar-overflow-rail=""
          className="flex min-w-0 items-center gap-2"
          style={{
            boxSizing: 'border-box',
            gridColumn: '2 / -1',
            gridRow: '2',
            maxWidth: '100%',
            overflowX: 'auto',
            overflowY: 'hidden',
            paddingTop: 40,
            paddingRight: TOOLBAR_SHADOW_GUTTER_PX,
            paddingBottom: 40,
            paddingLeft: TOOLBAR_SHADOW_GUTTER_PX,
            marginTop: -40,
            marginRight: -TOOLBAR_SHADOW_GUTTER_PX,
            marginBottom: -40,
            marginLeft: -TOOLBAR_SHADOW_GUTTER_PX,
            scrollbarWidth: 'none',
          }}
        >
          {overflowSections.map(renderSection)}
        </div>
      ) : null}
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
  sectionId?: string
  style: CSSProperties
  children: ReactNode
}

const ToolbarPill = forwardRef<HTMLDivElement, ToolbarPillProps>(
  function ToolbarPill({ sectionId, style, children }, ref) {
    return <div ref={ref} data-toolbar-section={sectionId} style={style}>{children}</div>
  },
)

/**
 * The brand mark — the first of the three Spark Affordances. Identity, not ornament.
 * Doubles as the file-menu trigger: clicking it opens the document file menu, replacing
 * the older standalone file button. See DESIGN.md "Spark Affordance Rule".
 */
const SparkLogo = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function SparkLogo({ className, style, ...props }, ref) {
    return (
      <ActionIcon
        ref={ref}
        type="button"
        aria-label="File"
        data-workbench-file-menu=""
        variant="filled"
        radius={10}
        size={36}
        className={[sparkLogoClassName, className].filter(Boolean).join(' ')}
        style={style}
        {...props}
      >
        C
      </ActionIcon>
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
