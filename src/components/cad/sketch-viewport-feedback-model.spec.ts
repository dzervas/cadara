import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { SketchViewportFeedbackLayer } from "@/components/cad/sketch-viewport-feedback";

import {
  estimateSketchAnnotationExtent,
  getOverlayProjectionId,
  getSketchDimensionLabelDropRank,
  getSketchToolLabelObstacles,
  layoutSketchAnnotations,
  recordSketchDimensionLabelDrop,
  type SketchAnnotationLayoutItem,
  type SketchAnnotationLayoutPriority,
  type SketchAnnotationLayoutObstacle as SketchAnnotationLayoutRect,
  type SketchAnnotationLayoutViewport,
  type SketchAnnotationPlacement,
} from "@/components/cad/sketch-viewport-feedback-model";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";

// Lane: ui (docs/testing.md: `src/components/`). Seam: the pure T14d layout
// (`layoutSketchAnnotations` and its extent/obstacle inputs): no DOM, plain
// inputs and placements.

const VIEWPORT: SketchAnnotationLayoutViewport = {
  width: 1200,
  height: 800,
  topInset: 76,
  bottomInset: 120,
};
const GAP = 6;

function chip(
  id: string,
  anchor: { x: number; y: number },
  label: string,
  priority: SketchAnnotationLayoutPriority = "dimension",
): SketchAnnotationLayoutItem {
  return {
    id,
    anchor,
    ...estimateSketchAnnotationExtent({
      status: "dimension",
      visibleLabel: label,
    }),
    priority,
    keepWhenUnplaceable: true,
  };
}

function glyph(
  id: string,
  anchor: { x: number; y: number },
  priority: SketchAnnotationLayoutPriority = "pinned",
): SketchAnnotationLayoutItem {
  return {
    id,
    anchor,
    ...estimateSketchAnnotationExtent({ status: "constraint" }),
    priority,
    keepWhenUnplaceable: priority === "problem",
  };
}

function rectOf(
  placement: SketchAnnotationPlacement,
  items: readonly SketchAnnotationLayoutItem[],
): SketchAnnotationLayoutRect {
  const item = items.find((entry) => entry.id === placement.id)!;
  return {
    x: placement.x - item.width / 2,
    y: placement.y - item.height / 2,
    width: item.width,
    height: item.height,
  };
}

/** The gap between two rects (negative: they overlap). */
function separation(
  left: SketchAnnotationLayoutRect,
  right: SketchAnnotationLayoutRect,
) {
  return Math.max(
    right.x - (left.x + left.width),
    left.x - (right.x + right.width),
    right.y - (left.y + left.height),
    left.y - (right.y + right.height),
  );
}

function expectPairwiseSeparated(
  placements: readonly SketchAnnotationPlacement[],
  items: readonly SketchAnnotationLayoutItem[],
  message: string,
) {
  const rects = placements.map((placement) => rectOf(placement, items));
  for (const [index, left] of rects.entries()) {
    for (const right of rects.slice(index + 1)) {
      expect(separation(left, right), message).toBeGreaterThanOrEqual(
        GAP - 1e-6,
      );
    }
  }
}

function expectInsideViewport(
  placements: readonly SketchAnnotationPlacement[],
  items: readonly SketchAnnotationLayoutItem[],
  viewport: SketchAnnotationLayoutViewport,
  message: string,
) {
  for (const placement of placements) {
    const rect = rectOf(placement, items);
    expect(rect.x, `${message} (left, ${placement.id})`).toBeGreaterThanOrEqual(
      8,
    );
    expect(rect.y, `${message} (top, ${placement.id})`).toBeGreaterThanOrEqual(
      viewport.topInset + 8,
    );
    expect(
      rect.x + rect.width,
      `${message} (right, ${placement.id})`,
    ).toBeLessThanOrEqual(viewport.width - 8);
    expect(
      rect.y + rect.height,
      `${message} (bottom, ${placement.id})`,
    ).toBeLessThanOrEqual(viewport.height - viewport.bottomInset - 8);
  }
}

const byId = (placements: readonly SketchAnnotationPlacement[]) =>
  Object.fromEntries(
    placements.map((placement) => [placement.id, [placement.x, placement.y]]),
  );

describe("T14d estimated extents (A-6, A3)", () => {
  test("glyphs are 32 × 32; chips grow with their label, calibrated on the measured 110 px 'Coincident' chip", () => {
    expect(estimateSketchAnnotationExtent({ status: "constraint" })).toEqual({
      width: 32,
      height: 32,
    });
    expect(
      estimateSketchAnnotationExtent({
        status: "dimension",
        visibleLabel: "Coincident",
      }),
      "the measured Coincident chip (T14 plan review probe b) is 110 × 32",
    ).toEqual({ width: 110, height: 32 });
    expect(
      estimateSketchAnnotationExtent({
        status: "dimension",
        visibleLabel: "(24.00)",
      }).width,
      "a reference label's parentheses count (A3)",
    ).toBe(89);
  });
});

describe("T14d layoutSketchAnnotations (T-8)", () => {
  test("wide chips and glyphs sharing an anchor never overlap and keep the 6 px gap; the highest priority sits at its anchor", () => {
    const anchor = { x: 600, y: 400 };
    const items = [
      chip("annotation:a-reference", anchor, "(24.00)"),
      chip("annotation:b-binding", anchor, "Coincident"),
      chip("annotation:c-distance", { x: 610, y: 404 }, "120.00"),
      glyph("annotation:d-parallel", anchor),
      glyph("annotation:e-horizontal", { x: 590, y: 396 }),
      glyph("annotation:f-preview", anchor, "preview"),
      glyph("annotation:g-problem", { x: 604, y: 402 }, "problem"),
    ];

    const placements = layoutSketchAnnotations(items, VIEWPORT, []);

    expect(placements, "every item finds a place").toHaveLength(items.length);
    expectPairwiseSeparated(placements, items, "no two labels overlap");
    expectInsideViewport(placements, items, VIEWPORT, "inside the viewport");
    expect(
      byId(placements)["annotation:g-problem"],
      "the problem is first and takes its anchor",
    ).toEqual([604, 402]);
  });

  test("labels with an on-screen anchor clamp inside all four edges (8 px inset, below the top inset, above the bottom band)", () => {
    const items = [
      chip("annotation:left", { x: 10, y: 400 }, "(24.00)"),
      chip("annotation:right", { x: 1195, y: 400 }, "Coincident"),
      glyph("annotation:top", { x: 600, y: 80 }),
      glyph("annotation:bottom", { x: 600, y: 678 }),
      glyph("annotation:corner", { x: 1199, y: 679 }),
    ];

    const placements = layoutSketchAnnotations(items, VIEWPORT, []);

    expect(placements).toHaveLength(items.length);
    expectInsideViewport(placements, items, VIEWPORT, "clamped");
    expect(byId(placements)).toEqual({
      "annotation:left": [8 + 89 / 2, 400],
      "annotation:right": [1200 - 8 - 55, 400],
      "annotation:top": [600, 76 + 8 + 16],
      "annotation:bottom": [600, 800 - 120 - 8 - 16],
      "annotation:corner": [1200 - 8 - 16, 800 - 120 - 8 - 16],
    });
    expectPairwiseSeparated(placements, items, "no overlap after clamping");
  });

  test("review B-1: a label anchored outside the usable canvas (off-screen, under the toolbar, in the bottom band, under chrome) is not rendered, problems included", () => {
    const partsPanel = { x: 16, y: 128, width: 240, height: 300, chrome: true };
    const items = [
      glyph("annotation:off-left", { x: -5, y: 300 }, "problem"),
      chip("annotation:off-right", { x: 1210, y: 300 }, "10.00"),
      chip("annotation:under-toolbar", { x: 600, y: 60 }, "10.00"),
      chip("annotation:in-band", { x: 600, y: 700 }, "10.00"),
      glyph("annotation:off-bottom", { x: 600, y: 900 }, "problem"),
      glyph("annotation:under-parts", { x: 100, y: 200 }, "problem"),
      chip("annotation:beside-parts", { x: 262, y: 200 }, "(24.00)"),
    ];

    const placements = layoutSketchAnnotations(items, VIEWPORT, [partsPanel]);

    expect(placements.map(({ id }) => id)).toEqual(["annotation:beside-parts"]);
    expect(
      separation(rectOf(placements[0]!, items), partsPanel),
      "a label anchored beside chrome moves clear of it",
    ).toBeGreaterThanOrEqual(GAP - 1e-6);
  });

  test("review B-1: chrome is never covered, not even by a problem or dimension with no free candidate", () => {
    // A non-chrome wall leaves no free candidate; the chrome beside the
    // anchors must still stay uncovered by the fallback.
    const wall = { x: 0, y: 0, width: 1200, height: 800 };
    const cube = { x: 1060, y: 80, width: 124, height: 200, chrome: true };
    const items = [
      chip("annotation:dimension", { x: 1050, y: 150 }, "(24.00)"),
      glyph("annotation:problem", { x: 1055, y: 200 }, "problem"),
    ];

    const placements = layoutSketchAnnotations(items, VIEWPORT, [wall, cube]);

    expect(placements).toHaveLength(2);
    for (const placement of placements) {
      expect(
        separation(rectOf(placement, items), cube),
        `${placement.id} keeps clear of the view-cube column`,
      ).toBeGreaterThanOrEqual(GAP - 1e-6);
    }
  });

  test("obstacles (near-gap ring, tool label, floating panel, hint chip) are avoided with the gap", () => {
    const obstacles: SketchAnnotationLayoutRect[] = [
      { x: 590, y: 390, width: 20, height: 20 }, // near-gap ring on the anchor
      { x: 620, y: 360, width: 70, height: 22 }, // "Destination" label
      { x: 268, y: 84, width: 260, height: 140 }, // sketch tool panel
      { x: 540, y: 84, width: 180, height: 30 }, // hint chip
    ];
    const items = [
      chip("annotation:chip", { x: 600, y: 400 }, "(24.00)"),
      glyph("annotation:glyph", { x: 650, y: 371 }),
      chip("annotation:under-panel", { x: 300, y: 150 }, "10.00"),
      glyph("annotation:under-hint", { x: 560, y: 95 }, "problem"),
    ];

    const placements = layoutSketchAnnotations(items, VIEWPORT, obstacles);

    expect(placements).toHaveLength(items.length);
    for (const placement of placements) {
      for (const obstacle of obstacles) {
        expect(
          separation(rectOf(placement, items), obstacle),
          `${placement.id} keeps clear of ${JSON.stringify(obstacle)}`,
        ).toBeGreaterThanOrEqual(GAP - 1e-6);
      }
    }
    expectPairwiseSeparated(placements, items, "and of each other");
  });

  test("priority problem > dimension > pinned > preview decides who keeps a shared anchor", () => {
    const anchor = { x: 500, y: 500 };
    // Ids sort against the priority order, so only priority can explain it.
    const ladder = [
      glyph("annotation:a-preview", anchor, "preview"),
      glyph("annotation:b-pinned", anchor, "pinned"),
      chip("annotation:c-dimension", anchor, "10.00"),
      glyph("annotation:e-problem", anchor, "problem"),
    ];

    for (const [index, winner] of [...ladder].reverse().entries()) {
      const contenders = ladder.slice(0, ladder.length - index);
      expect(
        byId(layoutSketchAnnotations(contenders, VIEWPORT, []))[winner.id],
        `${winner.priority} outranks everything below it`,
      ).toEqual([500, 500]);
    }
  });

  test("cadara-0atd: on a shared anchor a user-placed chip outranks an auto-placed one, the most recent drop outranks other user-placed chips, and a problem still outranks them all", () => {
    const anchor = { x: 500, y: 500 };
    const at = (items: readonly SketchAnnotationLayoutItem[]) =>
      Object.entries(byId(layoutSketchAnnotations(items, VIEWPORT, []))).find(
        ([, centre]) => centre[0] === 500 && centre[1] === 500,
      )?.[0];
    // Ids sort against the expected winner each time.
    const auto = chip("annotation:a-auto", anchor, "10.00");
    const placed = {
      ...chip("annotation:b-placed", anchor, "10.00"),
      placedByUser: true,
    };
    const dropped = (id: string, dropRank: number) => ({
      ...chip(id, anchor, "10.00"),
      placedByUser: true,
      dropRank,
    });

    expect(
      at([auto, placed]),
      "persisted: a user-placed label keeps its anchor over an auto-placed one (a reload keeps the drop)",
    ).toBe("annotation:b-placed");
    expect(
      at([auto, placed, dropped("annotation:c-dropped", 0)]),
      "session: a dropped chip outranks the other user-placed labels",
    ).toBe("annotation:c-dropped");
    expect(
      at([
        auto,
        placed,
        dropped("annotation:c-earlier", 1),
        dropped("annotation:d-last", 0),
      ]),
      "session: the most recent drop wins among dropped chips",
    ).toBe("annotation:d-last");
    expect(
      at([
        dropped("annotation:c-dropped", 0),
        glyph("annotation:z-problem", anchor, "problem"),
      ]),
      "A-14: a problem still outranks a dropped chip",
    ).toBe("annotation:z-problem");
  });

  test("cadara-0atd: recorded drops rank chips dropped on their anchor by recency, and an angle dropped at its displacement keeps its pre-drag rank although its drag committed a placement", () => {
    const live = new Set(["h-length", "h-angle", "h-width"]);
    let drops = recordSketchDimensionLabelDrop(
      [],
      { handleId: "h-width", placedByUserBeforeDrag: null },
      live,
    );
    drops = recordSketchDimensionLabelDrop(
      drops,
      { handleId: "h-length", placedByUserBeforeDrag: null },
      live,
    );
    drops = recordSketchDimensionLabelDrop(
      drops,
      { handleId: "h-angle", placedByUserBeforeDrag: false },
      live,
    );
    // A re-drop moves the chip to the front; a chip that is gone leaves.
    drops = recordSketchDimensionLabelDrop(
      [...drops, { handleId: "h-deleted", placedByUserBeforeDrag: null }],
      { handleId: "h-width", placedByUserBeforeDrag: null },
      live,
    );
    expect(drops.map((drop) => drop.handleId)).toEqual([
      "h-width",
      "h-angle",
      "h-length",
    ]);
    expect(getSketchDimensionLabelDropRank(drops, "h-width", true)).toEqual({
      placedByUser: true,
      dropRank: 0,
    });
    expect(
      getSketchDimensionLabelDropRank(drops, "h-length", true),
      "the displaced angle drop takes no recency slot",
    ).toEqual({ placedByUser: true, dropRank: 1 });
    expect(
      getSketchDimensionLabelDropRank(drops, "h-angle", true),
      "an angle dropped at its displacement stays auto-placed for this session (else it would outrank the label displacing it and jump onto its anchor)",
    ).toEqual({ placedByUser: false, dropRank: null });
    expect(
      getSketchDimensionLabelDropRank(drops, "h-other", true),
      "never dropped: its committed placement alone",
    ).toEqual({ placedByUser: true, dropRank: null });
  });

  test("A-14: adding or removing lower-priority items (a hover preview, a newly pinned glyph) never moves a higher-priority one", () => {
    const base = [
      chip("annotation:z-width", { x: 400, y: 300 }, "120.00"),
      chip("annotation:z-height", { x: 430, y: 300 }, "(80.00)"),
      glyph("annotation:z-problem", { x: 420, y: 310 }, "problem"),
    ];
    const before = byId(layoutSketchAnnotations(base, VIEWPORT, []));
    // Lower ids than every higher-priority item, at the same anchors: an
    // input-order or id-order layout would let them in first.
    const lower = [
      glyph("annotation:a-preview", { x: 400, y: 300 }, "preview"),
      glyph("annotation:b-pinned", { x: 430, y: 300 }, "pinned"),
      glyph("annotation:c-pinned", { x: 420, y: 310 }, "pinned"),
    ];
    const after = byId(
      layoutSketchAnnotations([...lower, ...base], VIEWPORT, []),
    );

    for (const item of base) {
      expect(after[item.id], `${item.id} did not move`).toEqual(
        before[item.id],
      );
    }
  });

  test("A-7: a dragged chip stays at its dragged position, before everything else, and the rest avoid it", () => {
    const dragged: SketchAnnotationLayoutItem = {
      ...chip("annotation:z-dragged", { x: 700, y: 500 }, "(24.00)"),
      fixed: { x: 700, y: 500 },
    };
    const items = [
      glyph("annotation:a-problem", { x: 700, y: 500 }, "problem"),
      chip("annotation:b-dimension", { x: 690, y: 505 }, "10.00"),
      dragged,
    ];

    const placements = layoutSketchAnnotations(items, VIEWPORT, [
      // Even an obstacle under it does not move it.
      { x: 695, y: 495, width: 10, height: 10 },
    ]);

    expect(byId(placements)["annotation:z-dragged"]).toEqual([700, 500]);
    expectPairwiseSeparated(
      placements,
      items,
      "the others avoid the dragged chip",
    );
  });

  test("a translation away from the edges keeps the relative layout identical (pan stability)", () => {
    const items = [
      chip("annotation:a", { x: 500, y: 400 }, "(24.00)"),
      chip("annotation:b", { x: 505, y: 402 }, "Coincident"),
      glyph("annotation:c", { x: 498, y: 398 }),
      glyph("annotation:d", { x: 520, y: 380 }, "preview"),
      glyph("annotation:e", { x: 510, y: 410 }, "problem"),
    ];
    const obstacles = [{ x: 470, y: 420, width: 18, height: 18 }];
    const shift = { x: 137.5, y: -91.25 };
    const shifted = items.map((item) => ({
      ...item,
      anchor: { x: item.anchor.x + shift.x, y: item.anchor.y + shift.y },
    }));

    const original = layoutSketchAnnotations(items, VIEWPORT, obstacles);
    const moved = layoutSketchAnnotations(shifted, VIEWPORT, [
      { ...obstacles[0]!, x: 470 + shift.x, y: 420 + shift.y },
    ]);

    expect(
      moved.map(({ id, x, y }) => ({ id, x: x - shift.x, y: y - shift.y })),
    ).toEqual(original);
  });

  test("the order is deterministic: any input order gives the same placements", () => {
    const items = [
      chip("annotation:b", { x: 500, y: 400 }, "10.00"),
      chip("annotation:a", { x: 500, y: 400 }, "20.00"),
      glyph("annotation:d", { x: 500, y: 400 }),
      glyph("annotation:c", { x: 500, y: 400 }),
      glyph("annotation:e", { x: 500, y: 400 }, "preview"),
    ];
    const expected = byId(layoutSketchAnnotations(items, VIEWPORT, []));

    for (const order of [
      [...items].reverse(),
      [items[2]!, items[4]!, items[0]!, items[3]!, items[1]!],
    ]) {
      expect(byId(layoutSketchAnnotations(order, VIEWPORT, []))).toEqual(
        expected,
      );
    }
    expect(
      expected["annotation:a"],
      "equal priority: the lower id keeps the anchor",
    ).toEqual([500, 400]);
  });

  test("ring cap 6: a glyph whose first free candidate is on ring 6 is placed there; one that needs ring 7 is dropped, while a dimension or problem falls back to its anchor", () => {
    const anchor = { x: 600, y: 400 };
    // Glyph ring step 38: ring r clears a block of half-size R when
    // 38 r − 16 ≥ R + 6. R = 206 → ring 6 exactly; R = 207 → ring 7.
    const block = (half: number) => ({
      x: anchor.x - half,
      y: anchor.y - half,
      width: 2 * half,
      height: 2 * half,
    });

    expect(
      byId(
        layoutSketchAnnotations([glyph("annotation:g", anchor)], VIEWPORT, [
          block(206),
        ]),
      ),
      "ring 6 (east first) is still a candidate",
    ).toEqual({ "annotation:g": [600 + 6 * 38, 400] });

    expect(
      byId(
        layoutSketchAnnotations([glyph("annotation:g", anchor)], VIEWPORT, [
          block(207),
        ]),
      ),
      "ring 7 is past the cap: the glyph is dropped",
    ).toEqual({});

    // Nothing free anywhere: glyphs drop; a problem and a dimension stay at
    // their (clamped) anchors.
    const items = [
      glyph("annotation:pinned", anchor),
      glyph("annotation:preview", anchor, "preview"),
      glyph("annotation:problem", anchor, "problem"),
      chip("annotation:dimension", { x: 610, y: 410 }, "10.00"),
    ];
    expect(
      byId(
        layoutSketchAnnotations(items, VIEWPORT, [
          { x: 0, y: 0, width: 1200, height: 800 },
        ]),
      ),
    ).toEqual({
      "annotation:problem": [600, 400],
      "annotation:dimension": [610, 410],
    });
  });
});

describe("T14d tool label obstacles (A4)", () => {
  test("each rendered tool label (reference, snap, measurement, handled dimension preview) is an obstacle centred on its projection; unlabelled overlays are not", () => {
    const schema = {
      overlays: [
        {
          id: "merge-destination",
          kind: "referenceLabel",
          anchor: { kind: "sketchPoint", point: [0, 0] },
          label: "Destination",
        },
        {
          id: "snap",
          kind: "snapIndicator",
          point: [1, 1],
          label: "Endpoint",
        },
        {
          id: "length",
          kind: "measurement",
          anchor: { kind: "sketchPoint", point: [2, 2] },
          label: "Length",
          value: 12.5,
          unit: "mm",
        },
        {
          id: "marker",
          kind: "anchor",
          point: [3, 3],
          label: "Start",
        },
      ],
    } as unknown as SketchToolPresentationSchema;
    const projections = [
      { id: getOverlayProjectionId("merge-destination"), x: 300, y: 200 },
      { id: getOverlayProjectionId("snap"), x: 400, y: 200 },
      { id: getOverlayProjectionId("length"), x: 500, y: 200 },
      { id: getOverlayProjectionId("marker"), x: 600, y: 200 },
    ];

    const obstacles = getSketchToolLabelObstacles(schema, projections);

    expect(obstacles).toHaveLength(3);
    const [destination, snap, measurement] = obstacles;
    // 18 px frame + 11 chars × 7 = 95, centred on its projection.
    expect(destination).toEqual({
      x: 300 - 47.5,
      y: 189,
      width: 95,
      height: 22,
    });
    expect(snap!.x + snap!.width / 2).toBe(400);
    // "Length" + gap 8 + "12.50 mm".
    expect(measurement!.width).toBe(18 + 6 * 7 + 8 + 8 * 7);
    expect(getSketchToolLabelObstacles(null, projections)).toEqual([]);
  });
});

test("T14d (A4): the tool labels the layout avoids are exactly the labels the feedback layer renders, and they stay pointer-events-none", () => {
  const schema = {
    overlays: [
      {
        id: "source",
        kind: "referenceLabel",
        anchor: { kind: "sketchPoint", point: [0, 0] },
        label: "Source",
      },
      {
        id: "destination",
        kind: "referenceLabel",
        anchor: { kind: "sketchPoint", point: [1, 0] },
        label: "Destination",
      },
      {
        id: "snap",
        kind: "snapIndicator",
        point: [1, 1],
        label: "Endpoint",
        candidateKind: "endpoint",
        glyphKind: "endpoint",
      },
      {
        id: "length",
        kind: "measurement",
        anchor: { kind: "sketchPoint", point: [2, 2] },
        label: "Length",
        value: 12.5,
        unit: "mm",
      },
      { id: "marker", kind: "anchor", point: [3, 3], label: "Start" },
      {
        id: "cue",
        kind: "completionCue",
        point: [4, 4],
        label: "Close",
        ready: true,
      },
    ],
  } as unknown as SketchToolPresentationSchema;
  const projections = [
    "source",
    "destination",
    "snap",
    "length",
    "marker",
    "cue",
  ].map((id, index) => ({
    id: getOverlayProjectionId(id),
    x: 100 + index * 150,
    y: 300,
  }));
  const markup = renderToStaticMarkup(
    createElement(SketchViewportFeedbackLayer, {
      schema,
      projections,
      onPatch: () => undefined,
    }),
  );
  const labels = [
    ...markup.matchAll(/<div[^>]*data-sketch-viewport-overlay="[^"]*"[^>]*>/g),
  ].map((match) => match[0]);

  expect(labels.length, "one obstacle per rendered tool label").toBe(
    getSketchToolLabelObstacles(schema, projections).length,
  );
  expect(labels.length, "premise: the label kinds render").toBe(4);
  for (const label of labels) {
    expect(label, "a tool label never takes the pointer").toContain(
      "pointer-events-none",
    );
  }
  expect(markup).toMatch(
    /^<div class="pointer-events-none absolute inset-0 z-10">/,
  );
  expect(markup).not.toContain("pointer-events-auto");
});
