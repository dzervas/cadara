import type { SketchNearGap } from "@/domain/sketch-interaction/near-gap";

/** The smallest glyph ring, in px; larger gaps get a ring around both ends. */
export const SKETCH_NEAR_GAP_GLYPH_MIN_PX = 14;

/**
 * The passive near-gap glyphs (T13k, D26): one dashed warning ring centred
 * between the two ends of each near gap, at their screen positions. Purely
 * presentational: `pointer-events: none` throughout, so it never intercepts
 * a pick (it is not in the pick stack; T14-safe).
 */
export function SketchNearGapGlyphs({
  gaps,
}: {
  gaps: readonly SketchNearGap[];
}) {
  if (gaps.length === 0) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="sketch-near-gap-glyphs"
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      {gaps.map(({ a, b, distancePx }) => {
        const size = Math.max(SKETCH_NEAR_GAP_GLYPH_MIN_PX, distancePx + 10);
        return (
          <span
            key={`${a.pointId}|${b.pointId}`}
            data-testid="sketch-near-gap-glyph"
            data-point-ids={`${a.pointId} ${b.pointId}`}
            className="pointer-events-none absolute rounded-full"
            style={{
              left: (a.screen.x + b.screen.x) / 2 - size / 2,
              top: (a.screen.y + b.screen.y) / 2 - size / 2,
              width: size,
              height: size,
              border: "1.5px dashed var(--workbench-shell-warning-border)",
            }}
          />
        );
      })}
    </div>
  );
}
