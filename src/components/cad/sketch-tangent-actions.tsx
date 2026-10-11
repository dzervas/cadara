/**
 * T12e: compact Mantine selection-context controls for tangent handle actions.
 *
 * Shown in the selection-context stack (T16a, [TECH] T16-22: one column
 * with the Mirror panel in the left floating panel slot) when the current
 * selection includes at least one eligible tangent target (a tangent
 * handle or a fit point of a spline).
 */

import { Button } from "@mantine/core";

import { SketchSelectionContextPanel } from "@/components/cad/sketch-selection-context";

export interface SketchTangentActionsProps {
  resetEnabled: boolean;
  zeroEnabled: boolean;
  onReset: () => void;
  onZero: () => void;
}

/**
 * Compact Mantine control for "Reset tangent to automatic" and "Set tangent
 * to zero" (PRODUCT.md: visible tools beat hidden tools).
 */
export function SketchTangentActions({
  resetEnabled,
  zeroEnabled,
  onReset,
  onZero,
}: SketchTangentActionsProps) {
  return (
    <SketchSelectionContextPanel
      title="Tangent"
      testId="sketch-tangent-actions"
    >
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
    </SketchSelectionContextPanel>
  );
}
