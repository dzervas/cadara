/**
 * T12e: compact Mantine selection-context controls for tangent handle actions.
 *
 * Shown in the sketch tool panel area (there is no existing selection-context
 * UI host, so this uses the tool panel slot; see T12e-brief.md) when the
 * current selection includes at least one eligible tangent target (a tangent
 * handle or a fit point of a spline).
 */

import { Button, Paper } from "@mantine/core";

import {
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_FLOATING_PANEL_TOP_STYLE,
  VIEWPORT_SKETCH_TOOL_PANEL_WIDTH_PX,
} from "@/components/cad/viewport-overlay-layout";
import { SECTION_HEADER_CLASSES } from "@/components/ui/workbench-panel-styles";

export interface SketchTangentActionsProps {
  resetEnabled: boolean;
  zeroEnabled: boolean;
  onReset: () => void;
  onZero: () => void;
}

/**
 * Compact Mantine control for "Reset tangent to automatic" and "Set tangent
 * to zero". Rendered in the sketch tool panel slot (PRODUCT.md: visible
 * tools beat hidden tools).
 */
export function SketchTangentActions({
  resetEnabled,
  zeroEnabled,
  onReset,
  onZero,
}: SketchTangentActionsProps) {
  return (
    <Paper
      component="div"
      className="pointer-events-auto absolute z-20 max-w-[calc(100vw-32px)] overflow-hidden rounded-[6px] text-xs text-[var(--workbench-shell-text-muted)]"
      style={{
        left: VIEWPORT_FLOATING_PANEL_LEFT_PX,
        top: VIEWPORT_FLOATING_PANEL_TOP_STYLE,
        width: VIEWPORT_SKETCH_TOOL_PANEL_WIDTH_PX,
        background: "var(--workbench-shell-surface-panel-elev)",
        boxShadow: "var(--workbench-shell-elevation-md)",
      }}
    >
      <div className="grid gap-2 p-3">
        <p className={SECTION_HEADER_CLASSES}>Tangent</p>
        <div className="flex gap-2">
          <Button
            size="compact-xs"
            variant="default"
            disabled={!resetEnabled}
            onClick={onReset}
            style={{ flex: 1 }}
            data-testid="tangent-reset"
          >
            Reset to automatic
          </Button>
          <Button
            size="compact-xs"
            variant="default"
            disabled={!zeroEnabled}
            onClick={onZero}
            style={{ flex: 1 }}
            data-testid="tangent-zero"
          >
            Set to zero
          </Button>
        </div>
      </div>
    </Paper>
  );
}
