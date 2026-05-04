import { useState, type CSSProperties, type ReactNode } from 'react'
import { ActionIcon } from '@mantine/core'

import { WorkbenchContextMenu, type WorkbenchContextMenuEntry } from '@/components/layout/workbench-context-menu'
import { getPartsObjectMenuEntries } from '@/components/layout/parts-object-menu.helpers'
import {
  FLOATING_PARTS_TREE_WIDTH_PX,
  VIEWPORT_OVERLAY_INSET_PX,
  VIEWPORT_OVERLAY_TOP_INSET_PX,
} from '@/components/cad/viewport-overlay-layout'
import { ToolIcon } from '@/components/ui/tool-icon'
import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { PrimitiveRef } from '@/core/editor/schema'
import {
  getPrimitiveRefKey,
  selectionFilterAllowsTarget,
} from '@/core/editor/schema'
import { getObjectTreeNodeToolIcon } from '@/core/tools/tool-icon-resolvers'
import { canReassignCommittedSketchPlane } from '@/domain/editor/sketch-plane-editing'
import { useEditorState } from '@/hooks/use-editor-state'

interface FloatingPartsTreeProps {
  snapshot: WorkspaceSnapshot | null
  hiddenTargetKeys: Record<string, boolean>
  objectLabelOverrides: Record<string, string>
  visibleSelection: PrimitiveRef[]
  onSelectTarget: (target: PrimitiveRef) => void
  onReopenTarget: (target: PrimitiveRef) => void
  onObjectDelete: (target: PrimitiveRef, label: string) => void
  onObjectExport: (target: PrimitiveRef, label: string) => void
  onRenameTarget: (target: PrimitiveRef, label: string) => void
  onChangeSketchPlaneTarget?: (target: Extract<PrimitiveRef, { kind: 'sketch' }>) => void
  onToggleTargetVisibility: (target: PrimitiveRef) => void
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
  onChangeSketchPlaneTarget,
  onToggleTargetVisibility,
}: FloatingPartsTreeProps) {
  const {
    state: { selection, selectionFilter, selectionCatalog },
  } = useEditorState()
  const objects = snapshot?.presentation.objects ?? []

  return (
    <aside
      aria-label="Parts and objects"
      className="pointer-events-auto absolute select-none"
      style={{
        left: VIEWPORT_OVERLAY_INSET_PX,
        top: VIEWPORT_OVERLAY_TOP_INSET_PX,
        width: FLOATING_PARTS_TREE_WIDTH_PX,
        zIndex: 15,
        color: 'var(--workbench-shell-text)',
      }}
    >
      <header
        className="px-2.5 pb-2 text-[11px] font-semibold uppercase"
        style={{
          letterSpacing: '0.18em',
          color: 'var(--workbench-shell-text-dim)',
          textShadow: 'var(--workbench-text-shadow-canvas)',
        }}
      >
        Parts &amp; Objects
      </header>
      <div className="flex flex-col">
        {objects.map((item) => {
          const target = item.target
          const targetKey = getPrimitiveRefKey(target)
          const itemLabel = objectLabelOverrides[targetKey] ?? item.label
          const isHidden = hiddenTargetKeys[targetKey] === true
          const isSelected =
            visibleSelection.some((entry) => getPrimitiveRefKey(entry) === targetKey)
          const isAllowed = selectionFilterAllowsTarget(selectionFilter, selection, target, selectionCatalog)
          const itemToolIcon = getObjectTreeNodeToolIcon(item)

          const menuItems: WorkbenchContextMenuEntry[] = getPartsObjectMenuEntries({
            target,
            label: itemLabel,
            canChangeSketchPlane:
              target.kind === 'sketch' && canReassignCommittedSketchPlane(snapshot, target.sketchId),
            onChangeSketchPlaneTarget,
            onObjectDelete,
            onObjectExport,
            onRenameTarget,
          })

          return (
            <WorkbenchContextMenu key={item.id} label={`${itemLabel} actions`} items={menuItems}>
              <Row
                isSelected={isSelected}
                isHidden={isHidden}
                isAllowed={isAllowed}
                label={itemLabel}
                onActivate={() => {
                  if (!isAllowed || isHidden) return
                  onSelectTarget(target)
                }}
                onReopen={
                  target.kind === 'feature' || target.kind === 'sketch'
                    ? () => onReopenTarget(target)
                    : undefined
                }
                onToggleHidden={() => onToggleTargetVisibility(target)}
                icon={
                  itemToolIcon
                    ? <ToolIcon icon={itemToolIcon} className="h-3.5 w-3.5" />
                    : item.kind === 'body'
                      ? <WorkbenchIcon name="box" className="h-3.5 w-3.5" />
                      : item.kind === 'sketch'
                        ? <WorkbenchIcon name="pencilRuler" className="h-3.5 w-3.5" />
                        : <WorkbenchIcon name="component" className="h-3.5 w-3.5" />
                }
              />
            </WorkbenchContextMenu>
          )
        })}
      </div>
    </aside>
  )
}

interface RowProps {
  label: string
  icon: ReactNode
  isSelected: boolean
  isHidden: boolean
  isAllowed: boolean
  onActivate: () => void
  onReopen?: () => void
  onToggleHidden: () => void
}

const ROW_BASE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 10px',
  borderRadius: 7,
  fontSize: 13,
  fontWeight: 500,
  textShadow: 'var(--workbench-text-shadow-canvas-strong)',
  position: 'relative',
  whiteSpace: 'nowrap',
  cursor: 'default',
  transition: 'background-color 120ms cubic-bezier(0.25, 1, 0.5, 1), opacity 120ms cubic-bezier(0.25, 1, 0.5, 1)',
}

function Row({
  label,
  icon,
  isSelected,
  isHidden,
  isAllowed,
  onActivate,
  onReopen,
  onToggleHidden,
}: RowProps) {
  const [isHover, setIsHover] = useState(false)
  const showLift = isSelected || isHover
  const style: CSSProperties = {
    ...ROW_BASE,
    color: 'var(--workbench-shell-text)',
    fontWeight: isSelected ? 600 : 500,
    opacity: isHidden ? 0.55 : !isAllowed ? 0.65 : 1,
    background: showLift
      ? (isSelected ? 'var(--workbench-glass-fill-row-active)' : 'var(--workbench-glass-fill-row-hover)')
      : 'transparent',
    backdropFilter: showLift ? 'var(--workbench-glass-blur-row)' : undefined,
    WebkitBackdropFilter: showLift ? 'var(--workbench-glass-blur-row)' : undefined,
    boxShadow: isSelected ? 'var(--workbench-parts-tree-row-active-shadow)' : undefined,
  }
  const trailVisible = isHover || isHidden

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      data-parts-tree-row
      data-active={isSelected ? 'true' : undefined}
      data-hidden={isHidden ? 'true' : undefined}
      style={style}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
    >
      {isSelected ? <SelectionRail /> : null}
      <span
        aria-hidden="true"
        style={{
          width: 14,
          height: 14,
          flexShrink: 0,
          color: isSelected
            ? 'var(--workbench-shell-sidebar-item-selected-icon)'
            : 'var(--workbench-shell-text-muted)',
          filter: 'var(--workbench-icon-drop-shadow-canvas)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </span>
      <button
        type="button"
        onClick={onActivate}
        onDoubleClick={onReopen}
        aria-disabled={!isAllowed || isHidden}
        title={
          isHidden
            ? 'Hidden in the viewport'
            : onReopen
              ? 'Double-click to reopen authoring in place'
              : !isAllowed
                ? 'Filtered out by the current command'
                : undefined
        }
        className="min-w-0 flex-1 truncate text-left bg-transparent border-0 p-0"
        style={{
          color: 'inherit',
          font: 'inherit',
          textShadow: 'inherit',
          cursor: !isAllowed || isHidden ? 'not-allowed' : 'pointer',
        }}
      >
        {label}
      </button>
      <ActionIcon
        component="button"
        onClick={(event) => {
          event.stopPropagation()
          onToggleHidden()
        }}
        variant="subtle"
        color="gray"
        size={22}
        aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
        title={isHidden ? 'Show in viewport' : 'Hide from viewport'}
        data-trail
        style={{
          marginLeft: 'auto',
          opacity: trailVisible ? 1 : 0,
          transition: 'opacity 120ms cubic-bezier(0.25, 1, 0.5, 1)',
        }}
      >
        <WorkbenchIcon name={isHidden ? 'eyeClosed' : 'eyeOpen'} className="h-3.5 w-3.5" />
      </ActionIcon>
    </div>
  )
}

function SelectionRail() {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 0,
        top: 6,
        bottom: 6,
        width: 2,
        background: 'var(--workbench-shell-accent)',
        borderRadius: '0 2px 2px 0',
      }}
    />
  )
}
