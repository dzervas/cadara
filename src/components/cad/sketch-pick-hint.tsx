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
// Paper's unlayered display rule overrides Tailwind's layered flex utility.
// Set display through Mantine so truncation leaves room for the action button.
// T14d re-review RR-2: one line per chip (the label truncates with an
// ellipsis, its full text in `title`), so the hint column always fits the
// slot the annotation layout reserves for it.
const CHIP_CLASS =
  "max-w-full items-center gap-2 rounded-[6px] px-2.5 py-1 text-xs whitespace-nowrap text-[var(--workbench-shell-text-muted)]";
const LABEL_CLASS = "min-w-0 truncate";

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
          display="flex"
          role="status"
          data-testid="sketch-pick-hint"
          className={`${onChoose ? "pointer-events-auto" : "pointer-events-none"} ${CHIP_CLASS}`}
          style={CHIP_STYLE}
        >
          <span className={LABEL_CLASS} title={getSketchPickHintText(hint)}>
            {getSketchPickHintText(hint)}
          </span>
          {onChoose ? (
            <Button
              className="shrink-0"
              size="compact-xs"
              variant="default"
              onClick={onChoose}
            >
              Choose…
            </Button>
          ) : null}
        </Paper>
      ) : null}
      {nearGap ? (
        <Paper
          component="div"
          display="flex"
          role="status"
          data-testid="sketch-near-gap-hint"
          className={`pointer-events-auto ${CHIP_CLASS}`}
          style={CHIP_STYLE}
        >
          <span
            className={LABEL_CLASS}
            title={getSketchNearGapHintText(nearGap)}
          >
            {getSketchNearGapHintText(nearGap)}
          </span>
          {nearGap.mergeRefusal === null ? (
            <Button
              className="shrink-0"
              size="compact-xs"
              variant="default"
              onClick={onMerge}
            >
              Merge…
            </Button>
          ) : null}
        </Paper>
      ) : null}
    </div>
  );
}
