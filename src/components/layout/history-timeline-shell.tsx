import { FeatureTimelineBar, SketchHistoryTimelineBar } from '@/components/layout/feature-timeline-bar'
import {
  type SketchHistoryCursor,
  type SketchSessionState,
} from '@/domain/editor/sketch-session'
import type {
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
  DocumentHistoryOrderEntry,
  DocumentSnapshot,
} from '@/contracts/modeling/schema'
import type { FeatureId } from '@/contracts/shared/ids'
import type { PrimitiveRef } from '@/domain/editor/schema'

interface HistoryTimelineShellProps {
  snapshot: DocumentSnapshot | null
  sketchSession: SketchSessionState | null
  historyHighlightFeatureIds: readonly FeatureId[]
  onSelectTarget: (target: PrimitiveRef) => void
  onReopenTarget: (target: PrimitiveRef) => void
  onDocumentCursorRequested?: (cursor: DocumentFeatureCursor) => void
  documentCursorDisabled?: boolean
  onDocumentHistoryReorder?: (item: DocumentHistoryOrderEntry, beforeItem: DocumentHistoryOrderEntry | null) => void
  documentHistoryReorderDisabled?: boolean
  onSketchCursorRequested?: (cursor: SketchHistoryCursor) => void
  onDeleteDocumentItem: (item: DocumentHistoryItemRecord) => void
  onRenameDocumentItem: (item: DocumentHistoryItemRecord) => void
  onSuppressFeature: (item: Extract<DocumentHistoryItemRecord, { kind: 'feature' }>) => void
  visibleSelection: PrimitiveRef[]
}

export function HistoryTimelineShell({
  snapshot,
  sketchSession,
  historyHighlightFeatureIds,
  onSelectTarget,
  onReopenTarget,
  onDocumentCursorRequested,
  documentCursorDisabled = false,
  onDocumentHistoryReorder,
  documentHistoryReorderDisabled = false,
  onSketchCursorRequested,
  onDeleteDocumentItem,
  onRenameDocumentItem,
  onSuppressFeature,
  visibleSelection,
}: HistoryTimelineShellProps) {
  const activeMode = sketchSession ? 'sketch' : 'document'

  return (
    <div
      className="relative shrink-0 overflow-visible"
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
          historyHighlightFeatureIds={historyHighlightFeatureIds}
          visibleSelection={visibleSelection}
          onSelectTarget={onSelectTarget}
          onReopenTarget={onReopenTarget}
          onCursorRequested={onDocumentCursorRequested}
          cursorDisabled={documentCursorDisabled}
          onReorderItem={onDocumentHistoryReorder}
          reorderDisabled={documentHistoryReorderDisabled}
          onDeleteItem={onDeleteDocumentItem}
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
