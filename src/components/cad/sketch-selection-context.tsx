/**
 * T16a ([TECH] T16-22, review R-1): the left floating panel column of the
 * sketch session: selection-context panels (Mirror, Offset, Spline).
 * One positioned column, so they flow and never overlap. Only the panels
 * take the pointer. Session diagnostics use the notification column.
 */

import { Paper } from "@mantine/core";
import type { ReactNode } from "react";

import {
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_FLOATING_PANEL_TOP_STYLE,
  VIEWPORT_SKETCH_TOOL_PANEL_WIDTH_PX,
} from "@/components/cad/viewport-overlay-layout";
import { SECTION_HEADER_CLASSES } from "@/components/ui/workbench-panel-styles";
import { WorkbenchNotification } from "@/components/layout/workbench-notification";

export function SketchSelectionContextStack({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 flex max-w-[calc(100vw-32px)] flex-col items-start gap-2"
      style={{
        left: VIEWPORT_FLOATING_PANEL_LEFT_PX,
        top: VIEWPORT_FLOATING_PANEL_TOP_STYLE,
      }}
      data-testid="sketch-selection-context-stack"
    >
      {children}
    </div>
  );
}

/** Session diagnostics share the generic notification presentation. */
export function SketchValidationStatus({
  message,
  displayMessage = message,
  severity = "error",
  onUndo,
  onHover,
  onClearHover,
}: {
  message: string;
  displayMessage?: string;
  severity?: "warning" | "error";
  onUndo?: () => void;
  onHover?: () => void;
  onClearHover?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      className="pointer-events-none"
      data-sketch-diagnostic={onHover ? "linked" : ""}
      onPointerEnter={onHover}
      onPointerLeave={onClearHover}
    >
      <WorkbenchNotification
        className="pointer-events-none"
        type={severity}
        title="Sketch geometry"
        message={displayMessage}
        action={onUndo ? { label: "Undo", onClick: () => onUndo() } : undefined}
      />
    </div>
  );
}

/** One selection-context panel of the column. */
export function SketchSelectionContextPanel({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Paper
      component="section"
      aria-label={title}
      className="pointer-events-auto overflow-hidden rounded-[6px] text-xs text-[var(--workbench-shell-text-muted)]"
      style={{
        width: VIEWPORT_SKETCH_TOOL_PANEL_WIDTH_PX,
        background: "var(--workbench-shell-surface-panel-elev)",
        boxShadow: "var(--workbench-shell-elevation-md)",
      }}
      data-testid={testId}
    >
      <div className="grid gap-2 p-3">
        <p className={SECTION_HEADER_CLASSES}>{title}</p>
        {children}
      </div>
    </Paper>
  );
}
