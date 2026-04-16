import { CircleDot, History, MousePointer2, PencilRuler, Ruler, SlidersHorizontal } from 'lucide-react'

import { FeatureTimelineBar } from '@/components/layout/feature-timeline-bar'
import { WorkbenchContextMenu, type WorkbenchContextMenuEntry } from '@/components/layout/workbench-context-menu'
import {
  getSketchHistoryCursorForIndex,
  getSketchHistoryCursorIndex,
  getSketchHistoryItems,
  type SketchHistoryCursor,
  type SketchSessionState,
} from '@/domain/editor/sketch-session'
import type { DocumentFeatureCursor, DocumentSnapshot } from '@/contracts/modeling/schema'
import type { DocumentHistoryItemRecord } from '@/contracts/modeling/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import { getPrimitiveRefKey, selectionFilterAllowsTarget } from '@/domain/editor/schema'
import { useEditorState } from '@/hooks/use-editor-state'

interface HistoryTimelineShellProps {
  snapshot: DocumentSnapshot | null
  sketchSession: SketchSessionState | null
  onSelectTarget: (target: PrimitiveRef) => void
  onReopenTarget: (target: PrimitiveRef) => void
  onDocumentCursorRequested?: (cursor: DocumentFeatureCursor) => void
  onSketchCursorRequested?: (cursor: SketchHistoryCursor) => void
  onDeleteFeature: (item: Extract<DocumentHistoryItemRecord, { kind: 'feature' }>) => void
  onRenameDocumentItem: (item: DocumentHistoryItemRecord) => void
  onSuppressFeature: (item: Extract<DocumentHistoryItemRecord, { kind: 'feature' }>) => void
  visibleSelection: PrimitiveRef[]
}

export function HistoryTimelineShell({
  snapshot,
  sketchSession,
  onSelectTarget,
  onReopenTarget,
  onDocumentCursorRequested,
  onSketchCursorRequested,
  onDeleteFeature,
  onRenameDocumentItem,
  onSuppressFeature,
  visibleSelection,
}: HistoryTimelineShellProps) {
  const activeMode = sketchSession ? 'sketch' : 'document'

  return (
    <div
      className="relative min-h-[64px] shrink-0 overflow-hidden border-t"
      style={{
        backgroundColor: 'var(--workbench-shell-overlay-strong)',
        borderColor: 'var(--workbench-shell-border)',
      }}
      data-history-mode={activeMode}
    >
      <div
        className={`transition-transform duration-200 motion-reduce:transition-none ${
          sketchSession ? 'pointer-events-none translate-y-16 opacity-0' : 'translate-y-0 opacity-100'
        }`}
        aria-hidden={sketchSession ? true : undefined}
        data-history-panel="document"
        data-transition-state={sketchSession ? 'leaving-down' : 'active'}
      >
        <FeatureTimelineBar
          snapshot={snapshot}
          visibleSelection={visibleSelection}
          onSelectTarget={onSelectTarget}
          onReopenTarget={onReopenTarget}
          onCursorRequested={onDocumentCursorRequested}
          onDeleteFeature={onDeleteFeature}
          onRenameItem={onRenameDocumentItem}
          onSuppressFeature={onSuppressFeature}
        />
      </div>
      {sketchSession ? (
        <div
          className="absolute inset-0 translate-y-0 opacity-100 transition-transform duration-200 motion-reduce:transition-none"
          data-history-panel="sketch"
          data-transition-state="active"
        >
          <SketchHistoryTimelineBar
            session={sketchSession}
            visibleSelection={visibleSelection}
            onSelectTarget={onSelectTarget}
            onCursorRequested={onSketchCursorRequested}
          />
        </div>
      ) : null}
    </div>
  )
}

interface SketchHistoryTimelineBarProps {
  session: SketchSessionState
  visibleSelection: PrimitiveRef[]
  onSelectTarget: (target: PrimitiveRef) => void
  onCursorRequested?: (cursor: SketchHistoryCursor) => void
}

function getSketchHistoryIcon(kind: ReturnType<typeof getSketchHistoryItems>[number]['kind']) {
  switch (kind) {
    case 'entity':
      return <PencilRuler className="h-4 w-4" />
    case 'constraint':
      return <SlidersHorizontal className="h-4 w-4" />
    case 'dimension':
      return <Ruler className="h-4 w-4" />
  }
}

function SketchHistoryTimelineBar({
  session,
  visibleSelection,
  onSelectTarget,
  onCursorRequested,
}: SketchHistoryTimelineBarProps) {
  const {
    state: { selection, selectionFilter, selectionCatalog },
  } = useEditorState()
  const items = getSketchHistoryItems(session.fullDefinition)
  const cursorIndex = getSketchHistoryCursorIndex(items, session.historyCursor)

  return (
    <section
      className="flex min-h-[64px] items-center gap-3 px-3 py-2"
      aria-label="Sketch history"
      data-history-kind="sketch"
    >
      <button
        type="button"
        className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md border text-[12px]"
        style={{
          backgroundColor: cursorIndex < 0 ? 'var(--workbench-shell-accent-surface)' : 'transparent',
          borderColor: cursorIndex < 0 ? 'var(--workbench-shell-border-strong)' : 'var(--workbench-shell-border)',
          color: 'var(--workbench-shell-text)',
        }}
        aria-label="Place sketch history cursor before first item"
        aria-current={cursorIndex < 0 ? 'step' : undefined}
        onClick={() => onCursorRequested?.({ kind: 'empty' })}
      >
        <CircleDot className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex min-h-10 min-w-max items-center gap-1 pr-6">
          {items.length === 0 ? (
            <span
              className="flex h-8 items-center rounded-md border border-dashed px-3 text-xs"
              style={{
                borderColor: 'var(--mantine-color-dark-5)',
                color: 'var(--mantine-color-dark-2)',
              }}
            >
              Empty sketch history
            </span>
          ) : null}
          {items.map((item, index) => {
            const targetKey = getPrimitiveRefKey(item.target)
            const isSelected = visibleSelection.some((entry) => getPrimitiveRefKey(entry) === targetKey)
            const isAllowed = selectionFilterAllowsTarget(selectionFilter, selection, item.target, selectionCatalog)
            const isAfterCursor = index > cursorIndex
            const description =
              item.kind === 'entity' ? 'Sketch entity' : item.kind === 'constraint' ? 'Sketch constraint' : 'Sketch dimension'
            const menuItems: WorkbenchContextMenuEntry[] = [
              {
                kind: 'item',
                id: 'select',
                label: 'Select',
                icon: <MousePointer2 className="h-3.5 w-3.5" />,
                disabled: !isAllowed,
                onSelect: () => onSelectTarget(item.target),
              },
              {
                kind: 'item',
                id: 'move-cursor-here',
                label: 'Move cursor here',
                icon: <History className="h-3.5 w-3.5" />,
                onSelect: () => onCursorRequested?.(getSketchHistoryCursorForIndex(items, index)),
              },
            ]

            return (
              <WorkbenchContextMenu key={item.id} label={`${item.label} actions`} items={menuItems}>
                <button
                  type="button"
                  className={`flex h-8 w-8 items-center justify-center rounded-md border transition ${
                    isAfterCursor ? 'opacity-45' : ''
                  } ${!isAllowed ? 'cursor-not-allowed' : ''}`}
                  style={{
                    backgroundColor: isSelected
                      ? 'var(--workbench-shell-accent-surface)'
                      : index === cursorIndex
                        ? 'var(--workbench-shell-control-surface)'
                        : 'transparent',
                    borderColor: isSelected || index === cursorIndex
                      ? 'var(--workbench-shell-border-strong)'
                      : 'transparent',
                    color: 'var(--workbench-shell-text)',
                  }}
                  aria-label={`Select ${item.label}. Double-click to move sketch history cursor.`}
                  aria-current={index === cursorIndex ? 'step' : undefined}
                  aria-disabled={!isAllowed}
                  title={`${description}${isAfterCursor ? '. After current cursor' : ''}. Double-click to move sketch history cursor.`}
                  onClick={() => {
                    if (!isAllowed) {
                      return
                    }
                    onSelectTarget(item.target)
                  }}
                  onDoubleClick={() => onCursorRequested?.(getSketchHistoryCursorForIndex(items, index))}
                >
                  {getSketchHistoryIcon(item.kind)}
                </button>
              </WorkbenchContextMenu>
            )
          })}
        </div>
      </div>
    </section>
  )
}
