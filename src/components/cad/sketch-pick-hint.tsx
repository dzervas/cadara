import { Button, Paper } from "@mantine/core";

import {
  getSketchPickHintText,
  type SketchPickHintModel,
} from "@/components/cad/sketch-pick-hint-model";

/**
 * The overlap hint chip at the viewport's top-left. `onChoose` is the seam
 * for the always-visible "Choose…" button that opens the candidate chooser
 * (T11e, review A-8); without it no button renders.
 */
export function SketchPickHint({
  hint,
  onChoose,
}: {
  hint: SketchPickHintModel | null;
  onChoose?: () => void;
}) {
  if (!hint) return null;
  return (
    <Paper
      component="div"
      role="status"
      data-testid="sketch-pick-hint"
      className={`${onChoose ? "pointer-events-auto" : "pointer-events-none"} flex items-center gap-2 rounded-[6px] px-2.5 py-1 text-xs text-[var(--workbench-shell-text-muted)]`}
      style={{
        background: "var(--workbench-shell-surface-panel-elev)",
        boxShadow: "var(--workbench-shell-elevation-md)",
      }}
    >
      <span>{getSketchPickHintText(hint)}</span>
      {onChoose ? (
        <Button size="compact-xs" variant="default" onClick={onChoose}>
          Choose…
        </Button>
      ) : null}
    </Paper>
  );
}
