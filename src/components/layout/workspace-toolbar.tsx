import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ActionIcon,
  Paper,
  ScrollArea,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";

import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import { ShortcutSettingsButton } from "@/components/shortcuts/shortcut-settings";
import { DocumentFileMenu } from "@/components/layout/document-file-menu";
import { SaveActivityRing } from "@/components/layout/save-activity-ring";
import { ToolButton } from "@/components/layout/tool-button";
import {
  ToolbarDropdownChevron,
  ToolDropdownButton,
} from "@/components/layout/tool-dropdown-button";
import { ToolbarGroupDropdownButton } from "@/components/layout/toolbar-group-dropdown-button";
import {
  readToolbarRecentTools,
  writeToolbarRecentTools,
} from "@/components/layout/toolbar-recent-tools-storage";
import { ToolbarToolIcon } from "@/components/layout/toolbar-tool-icon";
import { ToolbarTooltipContent } from "@/components/layout/toolbar-tooltip-content";
import { getNextToolSearchHighlightIndex } from "@/components/layout/workspace-toolbar.a11y";
import { toolLeavesSketch } from "@/core/tools/activation-policy";
import {
  getToolById,
  getToolbarSectionsForMode,
  isDropdownTool,
  type RegisteredToolDefinition,
  searchToolDefinitions,
  type ToolId,
} from "@/core/tools/tool-registry";
import {
  chooseToolbarCompactionLevel,
  getUnmeasuredToolbarCompactionLevel,
  listToolbarCompactionLevels,
  type ToolbarCompactionGroup,
  type ToolbarCompactionMetrics,
  type ToolbarCompactionSection,
} from "@/core/tools/toolbar-compaction";
import { recordRecentToolbarTool } from "@/core/tools/toolbar-recency";
import { isSketchStyleToolId } from "@/core/sketch-styles/definition";
import {
  shallowEqualRecords,
  useEditorStateSelector,
} from "@/hooks/editor-state-store";
import { selectToolbarEditorState } from "@/components/layout/workspace-toolbar-editor-state";
import { useWorkbenchCommandHandlers } from "@/hooks/use-workbench-command-handlers";
import type { EditorHistoryAvailability } from "@/core/editor/state-machine";
import {
  getToolbarActionIconStyle,
  getToolbarDropdownTriggerStyle,
  sparkLogoClassName,
  toolbarActionIconClassName,
} from "@/theme/workbench-toolbar-styles";
import { DISCORD_URL } from "@/components/layout/community-links";

const REPOSITORY_URL = "https://github.com/dzervas/cadara";
const TOOLBAR_GAP_PX = 8;
const TOOLBAR_PILL_GAP_PX = 2;
const TOOLBAR_SHADOW_GUTTER_PX = 32;
const TOOLBAR_SEARCH_SHADOW_RESERVE_PX = 32;
const PART_TOOL_DURING_SKETCH_REASON =
  "Part tools are unavailable while sketching. Finish Sketch first.";
type VisibleToolbarSection = ReturnType<
  typeof getToolbarSectionsForMode
>[number];
interface ToolbarMeasurement {
  availableWidth: number;
  metrics: ToolbarCompactionMetrics;
}

interface WorkspaceToolbarProps {
  historyAvailability?: EditorHistoryAvailability;
  showBrowserStorageWarning?: boolean;
  /** A local save is underway in any open tab: the logo shows its ring. */
  localSaving?: boolean;
  onNewDocument?: () => void;
  onOpenDocument?: () => void;
  onSaveDocumentAs?: () => void;
  onReportBug?: () => void;
  onDownloadBugReportState?: () => void | Promise<void>;
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
// Memoized with a selector-subscribed editor state: the workbench re-renders
// on every editor state change (each sketch drag move), the toolbar only when
// its own inputs change.
export const WorkspaceToolbar = memo(function WorkspaceToolbar({
  historyAvailability,
  showBrowserStorageWarning = false,
  localSaving = false,
  onNewDocument = () => undefined,
  onOpenDocument = () => undefined,
  onSaveDocumentAs = () => undefined,
  onReportBug,
  onDownloadBugReportState,
}: WorkspaceToolbarProps = {}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [highlightedSearchResultIndex, setHighlightedSearchResultIndex] =
    useState(-1);
  const [toolbarMeasurement, setToolbarMeasurement] =
    useState<ToolbarMeasurement | null>(null);
  const [recentToolIds, setRecentToolIds] = useState(readToolbarRecentTools);
  const searchListboxId = useId();
  const primaryRailRef = useRef<HTMLDivElement | null>(null);
  const searchRootRef = useRef<HTMLDivElement | null>(null);
  const probePillRef = useRef<HTMLDivElement | null>(null);
  const probeToolRef = useRef<HTMLSpanElement | null>(null);
  const probeDropdownRef = useRef<HTMLSpanElement | null>(null);
  const {
    activeToolId,
    activeEditSession,
    activeSketchPlaneEditSession,
    activeImportSession,
    canUndo,
    canRedo,
    mode,
    hasActiveSketchSession,
    activeSketchStyleToolId,
    svgRenderingEnabled,
    sketchConstructionSelected,
  } = useEditorStateSelector(selectToolbarEditorState, shallowEqualRecords);
  const history = useMemo(() => ({ canUndo, canRedo }), [canUndo, canRedo]);
  const { activateTool } = useWorkbenchCommandHandlers();
  const visibleHistory = historyAvailability ?? history;
  const visibleSections = useMemo(
    () => getToolbarSectionsForMode(mode),
    [mode],
  );
  const searchResults = useMemo(
    () => searchToolDefinitions(searchQuery),
    [searchQuery],
  );
  const clampedHighlightedSearchResultIndex =
    searchResults.length === 0
      ? -1
      : highlightedSearchResultIndex < 0 ||
          highlightedSearchResultIndex >= searchResults.length
        ? 0
        : highlightedSearchResultIndex;
  const isSearchPopoverVisible = searchPopoverOpen && searchQuery.length > 0;
  const canImportReferenceImage =
    hasActiveSketchSession || activeToolId === "sketch";

  const isToolDisabled = (tool: RegisteredToolDefinition) =>
    (tool.id === "undo" && !visibleHistory.canUndo) ||
    (tool.id === "redo" && !visibleHistory.canRedo) ||
    (tool.id === "import" &&
      (activeEditSession !== null ||
        activeSketchPlaneEditSession !== null ||
        activeImportSession !== null)) ||
    (tool.id === "importImage" && !canImportReferenceImage) ||
    (isSketchStyleToolId(tool.id) &&
      (!hasActiveSketchSession || !svgRenderingEnabled)) ||
    (mode === "sketch" && toolLeavesSketch(tool.id));

  const closeSearchPopover = () => {
    setSearchPopoverOpen(false);
  };

  const triggerSearchTool = (tool: RegisteredToolDefinition) => {
    if (isToolDisabled(tool)) {
      return;
    }

    void activateTool(tool.id, { source: "search" });
    setSearchQuery("");
    setSearchPopoverOpen(false);
    setHighlightedSearchResultIndex(-1);
  };

  const handleDocumentPointerDown = useEffectEvent((event: PointerEvent) => {
    const eventTarget = event.target;
    if (!(eventTarget instanceof Node)) {
      return;
    }

    if (searchRootRef.current?.contains(eventTarget)) {
      return;
    }

    closeSearchPopover();
  });

  useEffect(() => {
    if (!isSearchPopoverVisible) {
      return;
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  }, [isSearchPopoverVisible]);

  const handleSearchInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (!isSearchPopoverVisible) {
        return;
      }

      event.preventDefault();
      closeSearchPopover();
      return;
    }

    const nextIndex = getNextToolSearchHighlightIndex(
      clampedHighlightedSearchResultIndex,
      event.key,
      searchResults.length,
    );
    if (nextIndex !== null) {
      event.preventDefault();
      setSearchPopoverOpen(true);
      setHighlightedSearchResultIndex(nextIndex);
      return;
    }

    if (event.key !== "Enter" || !isSearchPopoverVisible) {
      return;
    }

    const highlightedTool = searchResults[clampedHighlightedSearchResultIndex];
    if (!highlightedTool) {
      return;
    }

    event.preventDefault();
    triggerSearchTool(highlightedTool);
  };

  const activeSearchResult =
    clampedHighlightedSearchResultIndex >= 0
      ? searchResults[clampedHighlightedSearchResultIndex]
      : null;
  const activeSearchResultId = activeSearchResult
    ? `${searchListboxId}-option-${activeSearchResult.id}`
    : undefined;
  const isToolShown = (toolId: ToolId) =>
    isToolShownInToolbar(toolId, hasActiveSketchSession);
  const compactionSections = useMemo(
    (): ToolbarCompactionSection[] =>
      visibleSections.map((section) => ({
        id: section.id,
        pinned: "pinned" in section && section.pinned,
        tools: section.toolIds
          .filter((toolId) =>
            isToolShownInToolbar(toolId, hasActiveSketchSession),
          )
          .map((toolId) => {
            const tool = getToolById(toolId);
            return {
              id: toolId,
              variantCount: isDropdownTool(tool)
                ? tool.dropdown.variantIds.length
                : null,
            };
          }),
      })),
    [visibleSections, hasActiveSketchSession],
  );
  const compactionLevels = useMemo(
    () => listToolbarCompactionLevels(compactionSections),
    [compactionSections],
  );
  const compactionLevel = toolbarMeasurement
    ? chooseToolbarCompactionLevel(
        compactionSections,
        compactionLevels,
        toolbarMeasurement.availableWidth,
        toolbarMeasurement.metrics,
      )
    : getUnmeasuredToolbarCompactionLevel(compactionLevels);

  const recordToolUse = useCallback((toolId: ToolId) => {
    setRecentToolIds((current) =>
      current[0] === toolId
        ? current
        : recordRecentToolbarTool(current, toolId),
    );
  }, []);

  useEffect(() => {
    writeToolbarRecentTools(recentToolIds);
  }, [recentToolIds]);

  // Widths come from a hidden probe rather than the live layout, so the chosen
  // level never feeds back into its own measurement.
  const updateToolbarMeasurement = useCallback(() => {
    const primaryRail = primaryRailRef.current;
    const probePill = probePillRef.current;
    const probeTool = probeToolRef.current;
    const probeDropdown = probeDropdownRef.current;
    if (!primaryRail || !probePill || !probeTool || !probeDropdown) {
      return;
    }

    const availableWidth =
      primaryRail.clientWidth -
      TOOLBAR_SHADOW_GUTTER_PX * 2 -
      TOOLBAR_SEARCH_SHADOW_RESERVE_PX;
    const toolWidth = probeTool.getBoundingClientRect().width;
    const dropdownWidth = probeDropdown.getBoundingClientRect().width;
    const pillWidth = probePill.getBoundingClientRect().width;
    if (availableWidth <= 0 || toolWidth <= 0 || dropdownWidth <= 0) {
      return;
    }

    const next: ToolbarMeasurement = {
      availableWidth,
      metrics: {
        toolWidth,
        dropdownWidth,
        pillChromeWidth:
          pillWidth - toolWidth - dropdownWidth - TOOLBAR_PILL_GAP_PX,
        pillGap: TOOLBAR_PILL_GAP_PX,
        railGap: TOOLBAR_GAP_PX,
      },
    };
    setToolbarMeasurement((current) =>
      current &&
      current.availableWidth === next.availableWidth &&
      current.metrics.toolWidth === next.metrics.toolWidth &&
      current.metrics.dropdownWidth === next.metrics.dropdownWidth &&
      current.metrics.pillChromeWidth === next.metrics.pillChromeWidth
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    const primaryRail = primaryRailRef.current;
    const probePill = probePillRef.current;
    if (!primaryRail || !probePill) {
      return;
    }

    let frameId = window.requestAnimationFrame(updateToolbarMeasurement);
    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateToolbarMeasurement);
    });

    resizeObserver.observe(primaryRail);
    resizeObserver.observe(probePill);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [updateToolbarMeasurement]);

  const isToolActive = (toolId: ToolId) =>
    (toolId === "construction" && sketchConstructionSelected) ||
    (toolId === "svgRendering" && svgRenderingEnabled) ||
    activeSketchStyleToolId === toolId ||
    activeToolId === toolId;

  const renderPlainTool = (tool: RegisteredToolDefinition) => (
    <ToolButton
      key={tool.id}
      tool={tool}
      active={isToolActive(tool.id)}
      disabled={isToolDisabled(tool)}
      onTrigger={recordToolUse}
    />
  );

  const renderTool = (tool: RegisteredToolDefinition) => {
    if (!isDropdownTool(tool)) {
      return renderPlainTool(tool);
    }

    if (!compactionLevel.collapsedFamilyIds.has(tool.id)) {
      return tool.dropdown.variantIds.map((variantId) =>
        renderPlainTool(getToolById(variantId)),
      );
    }

    return (
      <ToolDropdownButton
        key={tool.id}
        tool={tool}
        active={
          isToolActive(tool.id) ||
          tool.dropdown.variantIds.some((variantId) => isToolActive(variantId))
        }
        disabled={isToolDisabled(tool)}
        activeToolId={activeToolId}
        recentToolIds={recentToolIds}
        onToolUsed={recordToolUse}
      />
    );
  };

  const getShownTools = (section: VisibleToolbarSection) =>
    section.toolIds.filter(isToolShown).map((toolId) => getToolById(toolId));

  const sectionById = new Map<string, VisibleToolbarSection>(
    visibleSections.map((section) => [section.id, section]),
  );

  // A group shows its leading tools inline and tucks the rest (or, merged,
  // everything) into one trailing dropdown.
  const renderGroup = (group: ToolbarCompactionGroup) => {
    const sections = group.sectionIds.map(
      (sectionId) => sectionById.get(sectionId)!,
    );
    const merged = sections.length > 1;
    const inlineTools = merged
      ? []
      : getShownTools(sections[0]!).slice(0, group.inlineCount);
    const tuckedSections = sections
      .map((section) => {
        const shownTools = getShownTools(section);
        const tuckedTools = merged
          ? shownTools
          : shownTools.slice(group.inlineCount);
        const tools = tuckedTools.flatMap((tool): RegisteredToolDefinition[] =>
          isDropdownTool(tool)
            ? tool.dropdown.variantIds.map((variantId) =>
                getToolById(variantId),
              )
            : [tool],
        );
        return {
          id: section.id,
          label: section.label,
          tools,
          toolLabels: [
            ...new Set(
              [...tuckedTools, ...tools].flatMap((tool) => [
                tool.name,
                tool.tooltip,
              ]),
            ),
          ],
        };
      })
      .filter((section) => section.tools.length > 0);

    return (
      <ToolbarPill
        key={group.sectionIds.join("+")}
        sectionId={group.sectionIds.join(" ")}
        collapsed={tuckedSections.length > 0}
        style={pillCommonStyle}
      >
        {inlineTools.map(renderTool)}
        {tuckedSections.length > 0 ? (
          <ToolbarGroupDropdownButton
            sections={tuckedSections}
            isToolActive={isToolActive}
            isToolDisabled={isToolDisabled}
            recentToolIds={recentToolIds}
            onToolUsed={recordToolUse}
          />
        ) : null}
      </ToolbarPill>
    );
  };

  // No Tooltip.Group: its shared delay-group context re-renders every toolbar
  // tooltip whenever the open tooltip changes, which made mode switches (e.g.
  // Finish Sketch under the pointer) block the main thread.
  return (
    <div
      className="absolute left-4 right-4 top-3 z-30 grid gap-x-2 gap-y-2 text-[var(--workbench-shell-text)]"
      style={{
        alignItems: "start",
        gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
        pointerEvents: "none",
      }}
      role="toolbar"
      aria-label="CAD tools"
      data-toolbar-compaction={compactionLevel.stage}
    >
      <DocumentFileMenu
        showBrowserStorageWarning={showBrowserStorageWarning}
        onNewDocument={onNewDocument}
        onOpenDocument={onOpenDocument}
        onSaveDocumentAs={onSaveDocumentAs}
        trigger={<SparkLogo saving={localSaving} />}
      />

      {/*
        Tool families, then whole islands, progressively collapse into
        dropdowns (and finally merge) before they can collide with search or
        utilities; see core/tools/toolbar-compaction.
       */}
      <div
        ref={primaryRailRef}
        data-toolbar-primary-rail=""
        className="flex min-w-0 items-center gap-2"
        style={{
          boxSizing: "border-box",
          gridColumn: "2",
          gridRow: "1",
          overflowX: "hidden",
          overflowY: "hidden",
          paddingTop: 36,
          paddingRight: TOOLBAR_SHADOW_GUTTER_PX,
          paddingBottom: 36,
          paddingLeft: TOOLBAR_SHADOW_GUTTER_PX,
          marginTop: -36,
          marginRight: -TOOLBAR_SHADOW_GUTTER_PX,
          marginBottom: -36,
          marginLeft: -TOOLBAR_SHADOW_GUTTER_PX,
          scrollbarWidth: "none",
        }}
      >
        {compactionLevel.groups.map(renderGroup)}
        <div
          ref={probePillRef}
          aria-hidden="true"
          inert
          style={{
            ...pillCommonStyle,
            pointerEvents: "none",
            position: "absolute",
            visibility: "hidden",
          }}
        >
          <ActionIcon
            ref={probeToolRef}
            component="span"
            variant="subtle"
            color="workbench"
            className={toolbarActionIconClassName}
          >
            <ToolbarToolIcon icon={getToolById("undo").icon} />
          </ActionIcon>
          <ActionIcon
            ref={probeDropdownRef}
            component="span"
            variant="subtle"
            color="workbench"
            className={toolbarActionIconClassName}
            style={getToolbarDropdownTriggerStyle({
              active: false,
              disabled: false,
            })}
          >
            <ToolbarToolIcon icon={getToolById("undo").icon} />
            <ToolbarDropdownChevron disabled={false} />
          </ActionIcon>
        </div>
      </div>

      <div
        ref={searchRootRef}
        className="relative w-[clamp(184px,22vw,260px)] shrink-0"
        style={{ gridColumn: "3", gridRow: "1", pointerEvents: "auto" }}
      >
        <TextInput
          value={searchQuery}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setSearchQuery(nextQuery);
            setSearchPopoverOpen(nextQuery.length > 0);
            setHighlightedSearchResultIndex(nextQuery.length > 0 ? 0 : -1);
          }}
          onFocus={() => {
            if (searchQuery.length > 0) {
              setSearchPopoverOpen(true);
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
          aria-activedescendant={
            isSearchPopoverVisible ? activeSearchResultId : undefined
          }
          aria-expanded={isSearchPopoverVisible}
          styles={{
            input: {
              height: 42,
              borderRadius: 12,
              backgroundColor: "var(--workbench-glass-fill)",
              backdropFilter: "var(--workbench-glass-blur)",
              WebkitBackdropFilter: "var(--workbench-glass-blur)",
              borderColor: "var(--workbench-glass-border)",
              borderWidth: 1,
              boxShadow: "var(--workbench-pill-shadow)",
              color: "var(--workbench-shell-text)",
              fontSize: 12.5,
            },
            section: {
              color: "var(--workbench-shell-text-dim)",
            },
          }}
        />
        {isSearchPopoverVisible && (
          <Paper
            className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-full overflow-hidden"
            radius="md"
            style={{
              backgroundColor: "var(--workbench-glass-fill-strong)",
              backdropFilter: "var(--workbench-glass-blur)",
              WebkitBackdropFilter: "var(--workbench-glass-blur)",
              border: "1px solid var(--workbench-glass-border)",
              boxShadow: "var(--workbench-panel-shadow)",
            }}
          >
            {searchResults.length > 0 ? (
              <ScrollArea.Autosize mah={320} mx={4} my={4}>
                <div
                  id={searchListboxId}
                  role="listbox"
                  aria-label="Tool search results"
                  className="grid gap-1"
                >
                  {searchResults.map((tool, index) => {
                    const optionId = `${searchListboxId}-option-${tool.id}`;
                    const isHighlighted =
                      searchResults[clampedHighlightedSearchResultIndex]?.id ===
                      tool.id;
                    return (
                      <ToolButton
                        key={`search-${tool.id}`}
                        tool={tool}
                        inline
                        buttonId={optionId}
                        buttonRole="option"
                        buttonTabIndex={-1}
                        ariaSelected={isHighlighted}
                        active={activeToolId === tool.id}
                        selected={isHighlighted}
                        disabled={isToolDisabled(tool)}
                        disabledReason={
                          mode === "sketch" && toolLeavesSketch(tool.id)
                            ? PART_TOOL_DURING_SKETCH_REASON
                            : undefined
                        }
                        onButtonFocus={() =>
                          setHighlightedSearchResultIndex(index)
                        }
                        onButtonMouseEnter={() =>
                          setHighlightedSearchResultIndex(index)
                        }
                        onTrigger={() => {
                          setSearchQuery("");
                          setSearchPopoverOpen(false);
                          setHighlightedSearchResultIndex(-1);
                        }}
                      />
                    );
                  })}
                </div>
              </ScrollArea.Autosize>
            ) : (
              <div
                id={searchListboxId}
                role="listbox"
                aria-label="Tool search results"
              >
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
              onContextMenu={
                onDownloadBugReportState
                  ? (event) => {
                      event.preventDefault();
                      void onDownloadBugReportState();
                    }
                  : undefined
              }
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
    </div>
  );
});

function isToolShownInToolbar(toolId: ToolId, hasActiveSketchSession: boolean) {
  return hasActiveSketchSession
    ? toolId !== "sketch"
    : toolId !== "finishSketch";
}

const pillCommonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: TOOLBAR_PILL_GAP_PX,
  borderRadius: 12,
  backgroundColor: "var(--workbench-glass-fill)",
  backdropFilter: "var(--workbench-glass-blur)",
  WebkitBackdropFilter: "var(--workbench-glass-blur)",
  border: "1px solid var(--workbench-glass-border)",
  boxShadow: "var(--workbench-pill-shadow)",
  flexShrink: 0,
  pointerEvents: "auto",
};

const utilityPillStyle: CSSProperties = {
  ...pillCommonStyle,
};

interface ToolbarPillProps {
  sectionId?: string;
  collapsed?: boolean;
  style: CSSProperties;
  children: ReactNode;
}

function ToolbarPill({
  sectionId,
  collapsed,
  style,
  children,
}: ToolbarPillProps) {
  return (
    <div
      data-toolbar-section={sectionId}
      data-toolbar-collapsed={collapsed || undefined}
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * The brand mark — the first of the three Spark Affordances. Identity, not ornament.
 * Doubles as the file-menu trigger: clicking it opens the document file menu, replacing
 * the older standalone file button. See DESIGN.md "Spark Affordance Rule".
 */
const SparkLogo = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { saving: boolean }
>(function SparkLogo({ className, style, saving, ...props }, ref) {
  return (
    <ActionIcon
      ref={ref}
      type="button"
      aria-label="File"
      data-workbench-file-menu=""
      variant="filled"
      radius={10}
      size={36}
      className={[sparkLogoClassName, className].filter(Boolean).join(" ")}
      style={style}
      {...props}
    >
      C
      <SaveActivityRing saving={saving} />
    </ActionIcon>
  );
});

function KbdHint({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        fontFamily:
          "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 10.5,
        padding: "2px 5px",
        borderRadius: 4,
        border: "1px solid var(--workbench-kbd-border)",
        color: "var(--workbench-shell-text-dim)",
      }}
    >
      {label}
    </span>
  );
}
