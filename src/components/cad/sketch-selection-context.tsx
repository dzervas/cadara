/**
 * T16a ([TECH] T16-22, review R-1): the left floating panel column of the
 * sketch session: the validation status first, then the selection-context
 * panels (Mirror, Offset (T17c), Tangent). One positioned column, so they flow and never
 * overlap. Only the panels take the pointer.
 */

import { Paper } from "@mantine/core";
import type { ReactNode } from "react";

import {
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_FLOATING_PANEL_TOP_STYLE,
  VIEWPORT_SKETCH_TOOL_PANEL_WIDTH_PX,
} from "@/components/cad/viewport-overlay-layout";
import { SECTION_HEADER_CLASSES } from "@/components/ui/workbench-panel-styles";

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

/** The sketch session's validation message, the first item of the column. */
export function SketchValidationStatus({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="pointer-events-none max-w-sm rounded-md border border-(--cad-border-strong) bg-(--cad-surface-overlay) px-3 py-2 text-xs text-(--cad-foreground) shadow-(--cad-panel-shadow)"
    >
      {message}
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
