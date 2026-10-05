/**
 * T12f: the restrained transient cue shown at the drag target when the
 * geometry is constrained or the frame fails (issue 05). Rendered by the
 * viewport overlay when `activeDrag.feedback` is present; hidden otherwise.
 */
export function SketchDragFeedbackCue({
  cue,
}: {
  cue: { x: number; y: number; text: string } | null;
}) {
  if (!cue) return null;
  return (
    <div
      data-testid="sketch-drag-feedback-cue"
      className="pointer-events-none absolute z-30 max-w-[200px] whitespace-nowrap rounded border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] px-2 py-1 text-[11px] leading-none text-[var(--cad-muted-foreground)] shadow-[var(--cad-panel-shadow)]"
      style={{
        left: cue.x,
        top: cue.y,
        transform: "translate(-50%, -100%) translateY(-8px)",
      }}
    >
      {cue.text}
    </div>
  );
}
