import { useEffect, useState } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";

import {
  FeatureTimelineBar,
  SketchHistoryTimelineBar,
} from "@/components/layout/feature-timeline-bar";
import {
  getHistoryTimelinePanelMotionState,
  readHistoryTimelineCollapsedPreference,
  writeHistoryTimelineCollapsedPreference,
} from "@/components/layout/history-timeline-shell-state";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import {
  type SketchHistoryCursor,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import type {
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
  DocumentHistoryOrderEntry,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import type { FeatureId } from "@/contracts/shared/ids";
import type { PrimitiveRef } from "@/core/editor/schema";

interface HistoryTimelineShellProps {
  snapshot: WorkspaceSnapshot | null;
  sketchSession: SketchSessionState | null;
  historyHighlightFeatureIds: readonly FeatureId[];
  onSelectTarget: (target: PrimitiveRef) => void;
  onReopenTarget: (target: PrimitiveRef) => void;
  onDocumentCursorRequested?: (cursor: DocumentFeatureCursor) => void;
  documentCursorDisabled?: boolean;
  onDocumentHistoryReorder?: (
    item: DocumentHistoryOrderEntry,
    beforeItem: DocumentHistoryOrderEntry | null,
  ) => void;
  documentHistoryReorderDisabled?: boolean;
  onSketchCursorRequested?: (cursor: SketchHistoryCursor) => void;
  onDeleteDocumentItem: (item: DocumentHistoryItemRecord) => void;
  onExportDocumentItem: (
    item: Extract<DocumentHistoryItemRecord, { kind: "sketch" }>,
  ) => void;
  onRenameDocumentItem: (item: DocumentHistoryItemRecord) => void;
  onChangeSketchPlaneTarget?: (
    target: Extract<PrimitiveRef, { kind: "sketch" }>,
  ) => void;
  onSuppressFeature: (
    item: Extract<DocumentHistoryItemRecord, { kind: "feature" }>,
  ) => void;
  visibleSelection: PrimitiveRef[];
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
  onExportDocumentItem,
  onRenameDocumentItem,
  onChangeSketchPlaneTarget,
  onSuppressFeature,
  visibleSelection,
}: HistoryTimelineShellProps) {
  const activeMode = sketchSession ? "sketch" : "document";
  const [collapsed, setCollapsed] = useState(() =>
    readHistoryTimelineCollapsedPreference(),
  );
  const panelMotion = getHistoryTimelinePanelMotionState(collapsed);
  const toggleLabel = collapsed
    ? "Show history timeline"
    : "Hide history timeline";

  useEffect(() => {
    writeHistoryTimelineCollapsedPreference(collapsed);
  }, [collapsed]);

  return (
    <div
      className="pointer-events-none relative shrink-0 overflow-visible"
      data-history-mode={activeMode}
      data-history-collapsed={collapsed ? "true" : "false"}
    >
      <div className="pointer-events-auto absolute bottom-6.5 right-7 z-20">
        <Tooltip label={toggleLabel} position="top" withArrow={false}>
          <ActionIcon
            type="button"
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            color="workbench"
            data-history-toggle="timeline-visibility"
            onClick={() => setCollapsed((current) => !current)}
            radius="xl"
            size={26}
            style={{
              backdropFilter: "var(--workbench-glass-blur)",
              backgroundColor: "var(--workbench-glass-fill-strong)",
              border: "1px solid var(--workbench-glass-border-strong)",
              boxShadow: "var(--workbench-fab-shadow)",
              color: "var(--workbench-shell-text)",
              transition:
                "transform 160ms cubic-bezier(0.25, 1, 0.5, 1), background-color 160ms cubic-bezier(0.25, 1, 0.5, 1), border-color 160ms cubic-bezier(0.25, 1, 0.5, 1), color 160ms cubic-bezier(0.25, 1, 0.5, 1)",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.transform = "translateY(-1px)";
              event.currentTarget.style.backgroundColor =
                "var(--workbench-shell-control-surface-hover)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.transform = "translateY(0)";
              event.currentTarget.style.backgroundColor =
                "var(--workbench-glass-fill-strong)";
            }}
            variant="subtle"
          >
            <WorkbenchIcon
              name="chevronDown"
              size={11}
              style={{
                transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 180ms cubic-bezier(0.25, 1, 0.5, 1)",
              }}
            />
          </ActionIcon>
        </Tooltip>
      </div>
      <div
        className={`motion-reduce:transition-none ${collapsed ? "pointer-events-none" : ""}`}
        aria-hidden={panelMotion.ariaHidden}
        data-history-motion="timeline-panel"
        data-transition-state={panelMotion.transitionState}
        style={panelMotion.style}
      >
        <div
          className={`transition-transform duration-200 motion-reduce:transition-none ${
            sketchSession
              ? "pointer-events-none translate-y-16 opacity-0"
              : "translate-y-0 opacity-100"
          }`}
          aria-hidden={sketchSession ? true : undefined}
          data-history-panel="document"
          data-transition-state={sketchSession ? "leaving-down" : "active"}
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
            onExportItem={onExportDocumentItem}
            onRenameItem={onRenameDocumentItem}
            onChangeSketchPlaneTarget={onChangeSketchPlaneTarget}
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
    </div>
  );
}
