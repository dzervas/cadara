import { Button, Paper } from "@mantine/core";

import {
  getSketchNearGapHintText,
  getSketchPickHintText,
  type SketchNearGapHintModel,
  type SketchPickHintModel,
} from "@/components/cad/sketch-pick-hint-model";

const CHIP_STYLE = {
  background: "var(--workbench-shell-surface-panel-elev)",
  boxShadow: "var(--workbench-shell-elevation-md)",
};
const CHIP_CLASS =
  "flex items-center gap-2 rounded-[6px] px-2.5 py-1 text-xs text-[var(--workbench-shell-text-muted)]";

/**
 * The hint chips at the viewport's top-left: the overlap hint, whose
 * `onChoose` is the seam for the always-visible "Choose…" button that
 * opens the candidate chooser (T11e, review A-8; without it no button
 * renders), and the near-gap hint with its "Merge…" button (T13k, D26),
 * which a pair Merge Points would refuse does not offer (review A3).
 */
export function SketchPickHint({
  hint,
  onChoose,
  nearGap = null,
  onMerge,
}: {
  hint: SketchPickHintModel | null;
  onChoose?: () => void;
  nearGap?: SketchNearGapHintModel | null;
  onMerge?: () => void;
}) {
  if (!hint && !nearGap) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      {hint ? (
        <Paper
          component="div"
          role="status"
          data-testid="sketch-pick-hint"
          className={`${onChoose ? "pointer-events-auto" : "pointer-events-none"} ${CHIP_CLASS}`}
          style={CHIP_STYLE}
        >
          <span>{getSketchPickHintText(hint)}</span>
          {onChoose ? (
            <Button size="compact-xs" variant="default" onClick={onChoose}>
              Choose…
            </Button>
          ) : null}
        </Paper>
      ) : null}
      {nearGap ? (
        <Paper
          component="div"
          role="status"
          data-testid="sketch-near-gap-hint"
          className={`pointer-events-auto ${CHIP_CLASS}`}
          style={CHIP_STYLE}
        >
          <span>{getSketchNearGapHintText(nearGap)}</span>
          {nearGap.mergeRefusal === null ? (
            <Button size="compact-xs" variant="default" onClick={onMerge}>
              Merge…
            </Button>
          ) : null}
        </Paper>
      ) : null}
    </div>
  );
}
