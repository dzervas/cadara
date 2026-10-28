import {
  forwardRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ActionIcon, ScrollArea } from "@mantine/core";

import {
  WorkbenchContextMenu,
  type MenuAnchor,
  type WorkbenchContextMenuEntry,
} from "@/components/layout/workbench-context-menu";
import { BodyColorPicker } from "@/components/layout/body-color-picker";
import {
  InlineRenameInput,
  type InlineRenameSession,
} from "@/components/layout/inline-rename";
import { useRowRenameShortcut } from "@/components/layout/use-row-rename-shortcut";
import {
  resolveBodyAppearanceHex,
  type BodyAppearance,
} from "@/contracts/modeling/body-appearance";
import type { BodyId } from "@/contracts/shared/ids";
import { getPartsObjectMenuEntries } from "@/components/layout/parts-object-menu.helpers";
import {
  FLOATING_PARTS_TREE_WIDTH_PX,
  VIEWPORT_OVERLAY_INSET_PX,
  VIEWPORT_OVERLAY_TOP_INSET_STYLE,
} from "@/components/cad/viewport-overlay-layout";
import { ToolIcon } from "@/components/ui/tool-icon";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  getPrimitiveRefKey,
  selectionFilterAllowsTarget,
} from "@/core/editor/schema";
import { getObjectTreeNodeToolIcon } from "@/core/tools/tool-icon-resolvers";
import { canReassignCommittedSketchPlane } from "@/core/editor/sketch-plane-editing";
import { getSketchErrorSummary } from "@/core/modeling/document-snapshot-view";
import { useEditorState } from "@/hooks/use-editor-state";
import type { ShellSelectRequest } from "@/core/editor/state-machine/types";
import { createShellRowSelectRequest } from "@/core/editor/state-machine/selection-helpers";

interface FloatingPartsTreeProps {
  snapshot: WorkspaceSnapshot | null;
  hiddenTargetKeys: Record<string, boolean>;
  objectLabelOverrides: Record<string, string>;
  visibleSelection: PrimitiveRef[];
  /**
   * List conventions (cadara-h026.1): a click selects the row alone,
   * Ctrl/Cmd+click toggles it, Shift+click selects the range from the last
   * clicked row (added with Ctrl/Cmd).
   */
  onSelectTarget: (target: PrimitiveRef, request?: ShellSelectRequest) => void;
  onReopenTarget: (target: PrimitiveRef) => void;
  onObjectDelete: (target: PrimitiveRef, label: string) => void;
  onObjectExport: (target: PrimitiveRef, label: string) => void;
  onRenameTarget: (target: PrimitiveRef, label: string) => void;
  renameSession?: InlineRenameSession;
  onChangeSketchPlaneTarget?: (
    target: Extract<PrimitiveRef, { kind: "sketch" }>,
  ) => void;
  onToggleTargetVisibility: (target: PrimitiveRef) => void;
  /** Persists a body's colour; omit to leave the colour section out. */
  onBodyAppearanceChange?: (
    target: BodyTarget,
    label: string,
    appearance: BodyAppearance,
  ) => void;
  /** Live viewport preview of an uncommitted custom colour; null ends it. */
  onBodyColorPreview?: (bodyId: BodyId, hex: string | null) => void;
}

type BodyTarget = Extract<PrimitiveRef, { kind: "body" }>;

interface CustomColorSession {
  target: BodyTarget;
  label: string;
  anchor: MenuAnchor;
  originalHex: string;
}

/**
 * Floating parts tree — see DESIGN.md "Floating Parts Tree (Viewport Overlay)".
 *
 * Replaces the structural sidebar's "Parts & Objects" section with an overlay anchored
 * top-left at top:76px / left:16px. The container is transparent — only individual rows
 * pick up tinted-glass on hover/active. The active row carries a 2px Workshop-Steel rail
 * on the leading edge plus a `--workbench-glass-fill-row-active` lift; the rail commits
 * the selection, the glass makes it readable.
 */
export function FloatingPartsTree({
  snapshot,
  hiddenTargetKeys,
  objectLabelOverrides,
  visibleSelection,
  onSelectTarget,
  onReopenTarget,
  onObjectDelete,
  onObjectExport,
  onRenameTarget,
  renameSession,
  onChangeSketchPlaneTarget,
  onToggleTargetVisibility,
  onBodyAppearanceChange,
  onBodyColorPreview,
}: FloatingPartsTreeProps) {
  const {
    state: { selection, selectionFilter, selectionCatalog },
  } = useEditorState();
  const objects = snapshot?.presentation.objects ?? [];
  // The Shift range anchor: the last row clicked without Shift.
  const [rangeAnchorKey, setRangeAnchorKey] = useState<string | null>(null);
  const isRowSelectable = (target: PrimitiveRef) =>
    hiddenTargetKeys[getPrimitiveRefKey(target)] !== true &&
    selectionFilterAllowsTarget(
      selectionFilter,
      selection,
      target,
      selectionCatalog,
    );
  const activateRow = (target: PrimitiveRef, event: MouseEvent) => {
    const request = createShellRowSelectRequest({
      rows: objects.map((item) => item.target),
      anchorKey: rangeAnchorKey,
      target,
      modifiers: event,
      isSelectable: isRowSelectable,
    });
    if (!request?.range) setRangeAnchorKey(getPrimitiveRefKey(target));
    onSelectTarget(target, request);
  };
  const [customColor, setCustomColor] = useState<CustomColorSession | null>(
    null,
  );
  const endCustomColor = (hex: string | null) => {
    if (!customColor) return;
    setCustomColor(null);
    if (hex && hex !== customColor.originalHex) {
      // The preview stays up until the commit settles (the handler clears it).
      onBodyAppearanceChange?.(customColor.target, customColor.label, {
        kind: "custom",
        hex,
      });
    } else {
      onBodyColorPreview?.(customColor.target.bodyId, null);
    }
  };

  return (
    <aside
      aria-label="Parts and objects"
      className="pointer-events-auto absolute flex flex-col select-none"
      style={{
        left: VIEWPORT_OVERLAY_INSET_PX,
        top: VIEWPORT_OVERLAY_TOP_INSET_STYLE,
        // Clear the bottom history, document tabs and collapsed debugger,
        // plus the measure readout's full height (cadara-h026.4): it shares
        // the debugger's row, so this over-reserves by about one chip.
        maxHeight: `calc(100% - ${VIEWPORT_OVERLAY_TOP_INSET_STYLE} - 208px - var(--workbench-measure-readout-height, 0px))`,
        width: FLOATING_PARTS_TREE_WIDTH_PX,
        zIndex: 15,
        color: "var(--workbench-shell-text)",
      }}
    >
      <header
        className="shrink-0 px-2.5 pb-2 text-[11px] font-semibold uppercase"
        style={{
          letterSpacing: "0.18em",
          color: "var(--workbench-shell-text-dim)",
          textShadow: "var(--workbench-text-shadow-canvas)",
        }}
      >
        Parts &amp; Objects
      </header>
      <ScrollArea.Autosize className="min-h-0" type="auto" scrollbars="y">
        {objects.map((item) => {
          const target = item.target;
          const targetKey = getPrimitiveRefKey(target);
          const itemLabel = objectLabelOverrides[targetKey] ?? item.label;
          const isHidden = hiddenTargetKeys[targetKey] === true;
          const isSelected = visibleSelection.some(
            (entry) => getPrimitiveRefKey(entry) === targetKey,
          );
          const isAllowed = selectionFilterAllowsTarget(
            selectionFilter,
            selection,
            target,
            selectionCatalog,
          );
          const itemToolIcon = getObjectTreeNodeToolIcon(item);
          const errorSummary =
            target.kind === "sketch"
              ? getSketchErrorSummary(snapshot, target.sketchId)
              : null;

          const bodyTarget: BodyTarget | null =
            item.kind === "body" && target.kind === "body" ? target : null;
          const bodyAppearance = bodyTarget
            ? snapshot?.document.bodies.find(
                (body) => body.bodyId === bodyTarget.bodyId,
              )?.appearance
            : undefined;
          const menuItems: WorkbenchContextMenuEntry[] =
            getPartsObjectMenuEntries({
              target,
              bodyColor:
                bodyTarget && bodyAppearance && onBodyAppearanceChange
                  ? {
                      appearance: bodyAppearance,
                      onChoosePaletteSlot: (slot) =>
                        onBodyAppearanceChange(bodyTarget, itemLabel, {
                          kind: "palette",
                          slot,
                        }),
                      onOpenCustomColor: (anchor) =>
                        setCustomColor({
                          target: bodyTarget,
                          label: itemLabel,
                          anchor,
                          originalHex: resolveBodyAppearanceHex(bodyAppearance),
                        }),
                    }
                  : undefined,
              label: itemLabel,
              canChangeSketchPlane:
                target.kind === "sketch" &&
                canReassignCommittedSketchPlane(snapshot, target.sketchId),
              onChangeSketchPlaneTarget,
              onObjectDelete,
              onObjectExport,
              onRenameTarget,
            });

          return (
            <WorkbenchContextMenu
              key={item.id}
              label={`${itemLabel} actions`}
              returnFocus={renameSession?.targetKey !== targetKey}
              items={menuItems}
            >
              <Row
                // T17k2: the row's target key for tests (its text is the
                // label, e.g. "Extrude 1", never an id).
                data-parts-tree-target={targetKey}
                isSelected={isSelected}
                isHidden={isHidden}
                isAllowed={isAllowed}
                label={itemLabel}
                renameSession={
                  renameSession?.targetKey === targetKey
                    ? renameSession
                    : undefined
                }
                onRename={() => onRenameTarget(target, itemLabel)}
                errorSummary={errorSummary}
                onActivate={(event) => {
                  if (!isAllowed || isHidden) return;
                  activateRow(target, event);
                }}
                onReopen={
                  target.kind === "feature" || target.kind === "sketch"
                    ? () => onReopenTarget(target)
                    : undefined
                }
                onToggleHidden={() => onToggleTargetVisibility(target)}
                icon={
                  itemToolIcon ? (
                    <ToolIcon icon={itemToolIcon} className="h-3.5 w-3.5" />
                  ) : item.kind === "body" ? (
                    <WorkbenchIcon name="box" className="h-3.5 w-3.5" />
                  ) : item.kind === "sketch" ? (
                    <WorkbenchIcon name="pencilRuler" className="h-3.5 w-3.5" />
                  ) : (
                    <WorkbenchIcon name="component" className="h-3.5 w-3.5" />
                  )
                }
              />
            </WorkbenchContextMenu>
          );
        })}
      </ScrollArea.Autosize>
      {customColor ? (
        <BodyColorPicker
          key={customColor.target.bodyId}
          anchor={customColor.anchor}
          label={customColor.label}
          originalHex={customColor.originalHex}
          onPreview={(hex) =>
            onBodyColorPreview?.(customColor.target.bodyId, hex)
          }
          onCommit={endCustomColor}
          onCancel={() => endCustomColor(null)}
        />
      ) : null}
    </aside>
  );
}

interface RowProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  icon: ReactNode;
  isSelected: boolean;
  isHidden: boolean;
  isAllowed: boolean;
  /** Why the row's sketch is not current (cadara-dyh); null when it is. */
  errorSummary: string | null;
  onActivate: (event: MouseEvent) => void;
  onReopen?: () => void;
  onToggleHidden: () => void;
  onRename: () => void;
  renameSession?: InlineRenameSession;
}

const ROW_BASE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "5px 10px",
  borderRadius: 7,
  fontSize: 13,
  fontWeight: 500,
  textShadow: "var(--workbench-text-shadow-canvas-strong)",
  position: "relative",
  whiteSpace: "nowrap",
  cursor: "default",
  transition:
    "background-color 120ms cubic-bezier(0.25, 1, 0.5, 1), opacity 120ms cubic-bezier(0.25, 1, 0.5, 1)",
};

const Row = forwardRef<HTMLDivElement, RowProps>(function Row(
  {
    label,
    icon,
    isSelected,
    isHidden,
    isAllowed,
    errorSummary,
    onActivate,
    onReopen,
    onToggleHidden,
    onRename,
    renameSession,
    onMouseEnter,
    onMouseLeave,
    ...rowProps
  },
  ref,
) {
  const [isHover, setIsHover] = useState(false);
  const handleRenameShortcut = useRowRenameShortcut();
  const showLift = isSelected || isHover;
  const style: CSSProperties = {
    ...ROW_BASE,
    color: errorSummary
      ? "var(--workbench-shell-danger-text)"
      : "var(--workbench-shell-text)",
    fontWeight: isSelected ? 600 : 500,
    opacity: isHidden ? 0.55 : !isAllowed ? 0.65 : 1,
    background: showLift
      ? isSelected
        ? "var(--workbench-glass-fill-row-active)"
        : "var(--workbench-glass-fill-row-hover)"
      : "transparent",
    backdropFilter: showLift ? "var(--workbench-glass-blur-row)" : undefined,
    WebkitBackdropFilter: showLift
      ? "var(--workbench-glass-blur-row)"
      : undefined,
    boxShadow: isSelected
      ? "var(--workbench-parts-tree-row-active-shadow)"
      : undefined,
  };
  const trailVisible = isHover || isHidden;

  return (
    <div
      {...rowProps}
      ref={ref}
      role="treeitem"
      aria-selected={isSelected}
      data-parts-tree-row
      data-active={isSelected ? "true" : undefined}
      data-hidden={isHidden ? "true" : undefined}
      data-object-error={errorSummary ? "true" : undefined}
      style={style}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        setIsHover(true);
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        setIsHover(false);
      }}
    >
      {isSelected ? <SelectionRail /> : null}
      <span
        aria-hidden="true"
        style={{
          width: 14,
          height: 14,
          flexShrink: 0,
          color: errorSummary
            ? "var(--workbench-shell-danger-text)"
            : isSelected
              ? "var(--workbench-shell-sidebar-item-selected-icon)"
              : "var(--workbench-shell-text-muted)",
          filter: "var(--workbench-icon-drop-shadow-canvas)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </span>
      {renameSession ? (
        <InlineRenameInput label={label} {...renameSession} />
      ) : <button
        type="button"
        onClick={onActivate}
        onKeyDown={(event) => handleRenameShortcut(event, onRename)}
        onDoubleClick={onReopen}
        aria-disabled={!isAllowed || isHidden}
        title={
          isHidden
            ? "Hidden in the viewport"
            : errorSummary
              ? errorSummary
              : onReopen
                ? "Double-click to reopen authoring in place"
                : !isAllowed
                  ? "Filtered out by the current command"
                  : undefined
        }
        className="min-w-0 flex-1 truncate text-left bg-transparent border-0 p-0"
        style={{
          color: "inherit",
          font: "inherit",
          textShadow: "inherit",
          cursor: !isAllowed || isHidden ? "not-allowed" : "pointer",
        }}
      >
        {label}
      </button>}
      {errorSummary ? (
        <span
          role="img"
          aria-label={`${label} error: ${errorSummary}`}
          title={errorSummary}
          data-object-error-marker
          style={{
            display: "inline-flex",
            flexShrink: 0,
            color: "var(--workbench-shell-danger-text)",
            filter: "var(--workbench-icon-drop-shadow-canvas)",
          }}
        >
          <WorkbenchIcon name="error" className="h-3.5 w-3.5" />
        </span>
      ) : null}
      <ActionIcon
        component="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleHidden();
        }}
        variant="subtle"
        color="gray"
        size={22}
        aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
        title={isHidden ? "Show in viewport" : "Hide from viewport"}
        data-trail
        style={{
          marginLeft: "auto",
          opacity: trailVisible ? 1 : 0,
          transition: "opacity 120ms cubic-bezier(0.25, 1, 0.5, 1)",
        }}
      >
        <WorkbenchIcon
          name={isHidden ? "eyeClosed" : "eyeOpen"}
          className="h-3.5 w-3.5"
        />
      </ActionIcon>
    </div>
  );
});

function SelectionRail() {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 0,
        top: 6,
        bottom: 6,
        width: 2,
        background: "var(--workbench-shell-accent)",
        borderRadius: "0 2px 2px 0",
      }}
    />
  );
}
