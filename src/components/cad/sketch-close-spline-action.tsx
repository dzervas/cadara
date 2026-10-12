/**
 * T17c2 ([TECH] T17-16): the Close spline selection-context panel (in the
 * shared left column, `sketch-selection-context.tsx`). A refused Close
 * spline stays visible, disabled, with its reason, so the rule is
 * discoverable.
 */

import { Button } from "@mantine/core";

import { SketchSelectionContextPanel } from "@/components/cad/sketch-selection-context";
import type { SketchCloseSplineState } from "@/domain/editor/sketch-session";

export interface SketchCloseSplineActionProps {
  state: SketchCloseSplineState;
  onClose: () => void;
}

export function SketchCloseSplineAction({
  state,
  onClose,
}: SketchCloseSplineActionProps) {
  return (
    <SketchSelectionContextPanel
      title="Spline"
      testId="sketch-close-spline-action"
    >
      <Button
        size="compact-xs"
        variant="default"
        disabled={state.refusal !== null}
        onClick={onClose}
        data-testid="spline-close"
      >
        Close spline
      </Button>
      {state.refusal === null ? null : (
        <p data-testid="spline-close-refusal">{state.refusal}</p>
      )}
    </SketchSelectionContextPanel>
  );
}
