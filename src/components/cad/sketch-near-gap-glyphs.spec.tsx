// Lane: ui (docs/testing.md). Seam: `SketchNearGapGlyphs` (T13k, D26): the
// passive near-gap glyphs' screen placement and their pointer
// transparency (no interception: they are never in the pick stack).
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import {
  SKETCH_NEAR_GAP_GLYPH_MIN_PX,
  SketchNearGapGlyphs,
} from "@/components/cad/sketch-near-gap-glyphs";
import type { SketchNearGap } from "@/core/sketch-interaction/near-gap";

const end = (name: string, x: number, y: number) => ({
  pointId: `sketch_point_${name}` as SketchPointId,
  entityId: `sketch_entity_${name}` as SketchEntityId,
  role: "end" as const,
  screen: { x, y },
});

test("each near gap gets one glyph centred between its ends' screen positions", () => {
  const gaps: SketchNearGap[] = [
    // 6 px apart: the minimum ring.
    { a: end("b", 100, 200), b: end("c", 106, 208), distancePx: 10 },
    // Distance 0: the minimum ring on the shared position.
    { a: end("p", 40, 50), b: end("q", 40, 50), distancePx: 0 },
  ];
  const markup = renderToStaticMarkup(<SketchNearGapGlyphs gaps={gaps} />);
  expect(markup.match(/data-testid="sketch-near-gap-glyph"/g)).toHaveLength(2);
  expect(SKETCH_NEAR_GAP_GLYPH_MIN_PX).toBe(14);
  // Ring size max(14, d + 10) = 20, centred on (103, 204).
  expect(markup).toContain(
    'data-point-ids="sketch_point_b sketch_point_c" class="pointer-events-none absolute rounded-full" style="left:93px;top:194px;width:20px;height:20px;border:1.5px dashed var(--workbench-shell-warning-border)"',
  );
  expect(markup).toContain(
    'data-point-ids="sketch_point_p sketch_point_q" class="pointer-events-none absolute rounded-full" style="left:33px;top:43px;width:14px;height:14px',
  );
});

test("the glyph layer never intercepts the pointer and is hidden from assistive tech; no gaps render nothing", () => {
  const markup = renderToStaticMarkup(
    <SketchNearGapGlyphs
      gaps={[{ a: end("b", 0, 0), b: end("c", 1, 0), distancePx: 1 }]}
    />,
  );
  expect(markup).toMatch(
    /^<div aria-hidden="true" data-testid="sketch-near-gap-glyphs" class="pointer-events-none absolute inset-0 /,
  );
  expect(
    markup.match(/pointer-events-none/g),
    "the layer and every glyph",
  ).toHaveLength(2);
  expect(markup).not.toContain("pointer-events-auto");
  expect(renderToStaticMarkup(<SketchNearGapGlyphs gaps={[]} />)).toBe("");
});
