import { describe, expect, test } from "vitest";

import {
  SKETCH_ANNOTATION_WHEEL_RADIUS_PX,
  SKETCH_ANNOTATION_WHEEL_SPOKE_PX,
  clampSketchAnnotationWheelCentre,
  clusterSketchAnnotations,
  getSketchAnnotationWheelObstacles,
  layoutSketchAnnotationWheel,
  getSketchAnnotationContextExtent,
  getSketchAnnotationOverflowChipId,
  layoutSketchAnnotationClusters,
  getSketchAnnotationClusterSignature,
  isSketchAnnotationHoverUnplaced,
  resolveSketchAnnotationDenseLimit,
  type SketchAnnotationClusterGroup,
  type SketchAnnotationClusterItem,
  type SketchAnnotationClusterLayoutItem,
  type SketchAnnotationDenseLimit,
} from "@/components/cad/sketch-annotation-clusters";
import type { SketchAnnotationLayoutViewport } from "@/components/cad/sketch-viewport-feedback-model";
import { getPrimitiveRefKey, type PrimitiveRef } from "@/core/editor/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";

// Lane: ui (docs/testing.md: `src/components/`). Seam: the pure T14f cluster
// model (clustering, dense limit with hysteresis, context extent, and the
// layout pass with `+N` chips): plain inputs and outputs, no DOM.

const VIEWPORT: SketchAnnotationLayoutViewport = {
  width: 1200,
  height: 800,
  topInset: 76,
  bottomInset: 120,
};
const LIMITS_4: Record<
  SketchAnnotationClusterGroup,
  SketchAnnotationDenseLimit
> = { pinned: 4, preview: 4 };
const LIMITS_2: Record<
  SketchAnnotationClusterGroup,
  SketchAnnotationDenseLimit
> = { pinned: 2, preview: 2 };

/** Ids that sort in index order: `annotation:c00`, `annotation:c01`, … */
const id = (index: number) => `annotation:c${String(index).padStart(2, "0")}`;
const glyphIds = (count: number) =>
  Array.from({ length: count }, (_, index) => id(index));

function items(
  count: number,
  anchorOf: (index: number) => { x: number; y: number },
  mustExpand: readonly number[] = [],
): SketchAnnotationClusterItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: id(index),
    anchor: anchorOf(index),
    mustExpand: mustExpand.includes(index),
  }));
}

function layoutItems(
  entries: readonly SketchAnnotationClusterItem[],
  group: SketchAnnotationClusterGroup = "pinned",
): SketchAnnotationClusterLayoutItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    anchor: entry.anchor,
    width: 32,
    height: 32,
    priority: group,
    keepWhenUnplaceable: false,
    cluster: { group, mustExpand: entry.mustExpand },
  }));
}

const endpoint = { x: 600, y: 400 };

describe("T14f (T-9) clusters and the dense limit", () => {
  test("10 constraints on one endpoint: 4 expanded and one `+6`", () => {
    const glyphs = items(10, () => endpoint);
    const [cluster, ...rest] = clusterSketchAnnotations(glyphs, 4);
    expect(rest, "one cluster").toEqual([]);
    expect(cluster!.expandedIds).toEqual([id(0), id(1), id(2), id(3)]);
    expect(cluster!.collapsedIds).toHaveLength(6);

    const layout = layoutSketchAnnotationClusters(
      layoutItems(glyphs),
      LIMITS_4,
      new Map(),
      VIEWPORT,
      [],
    );
    expect(
      [...layout.placements.keys()].filter(
        (key) => key !== layout.chips[0]?.id,
      ),
    ).toEqual([id(0), id(1), id(2), id(3)]);
    expect(layout.chips).toEqual([
      expect.objectContaining({
        id: getSketchAnnotationOverflowChipId("pinned", id(0)),
        group: "pinned",
        key: id(0),
        count: 6,
      }),
    ]);
    // The chip is a placed 32 px label clear of every expanded glyph.
    const chip = layout.chips[0]!;
    for (const glyphId of [id(0), id(1), id(2), id(3)]) {
      const placed = layout.placements.get(glyphId)!;
      expect(
        Math.max(Math.abs(placed.x - chip.x), Math.abs(placed.y - chip.y)),
        `the +N chip keeps clear of ${glyphId}`,
      ).toBeGreaterThanOrEqual(38);
    }
  });

  test("a small context extent: 2 expanded and one `+8`", () => {
    const layout = layoutSketchAnnotationClusters(
      layoutItems(items(10, () => endpoint)),
      LIMITS_2,
      new Map(),
      VIEWPORT,
      [],
    );
    expect(layout.placements.has(id(0)) && layout.placements.has(id(1))).toBe(
      true,
    );
    expect(layout.placements.size, "2 glyphs + the chip").toBe(3);
    expect(layout.chips.map((chip) => chip.count)).toEqual([8]);
  });

  test("A-5 hysteresis: 2 below 150 px, back to 4 above 170 px, the previous limit in between", () => {
    const walk = (extents: readonly (number | null)[]) => {
      let limit: SketchAnnotationDenseLimit = 4;
      return extents.map((extent) => {
        limit = resolveSketchAnnotationDenseLimit(extent, limit);
        return limit;
      });
    };
    // Zooming out: 4 holds through the band, drops below 150.
    expect(walk([400, 170, 160, 150, 149.9, 120])).toEqual([4, 4, 4, 4, 2, 2]);
    // Zooming back in: 2 holds through the band, returns above 170.
    expect(walk([100, 150, 160, 170, 170.1, 300])).toEqual([2, 2, 2, 2, 4, 4]);
    // Inside the band the limit depends on the way in.
    expect(resolveSketchAnnotationDenseLimit(160, 4)).toBe(4);
    expect(resolveSketchAnnotationDenseLimit(160, 2)).toBe(2);
    // Nothing measurable keeps the context's previous limit.
    expect(resolveSketchAnnotationDenseLimit(null, 2)).toBe(2);
    expect(resolveSketchAnnotationDenseLimit(null, 4)).toBe(4);
  });

  test("review A-1: a fresh context (no previous limit) takes the T-9 160 px rule, never a previous context's K", () => {
    expect(resolveSketchAnnotationDenseLimit(159.9, null)).toBe(2);
    expect(resolveSketchAnnotationDenseLimit(160, null)).toBe(4);
    expect(resolveSketchAnnotationDenseLimit(155, null)).toBe(2);
    expect(resolveSketchAnnotationDenseLimit(165, null)).toBe(4);
    expect(resolveSketchAnnotationDenseLimit(100, null)).toBe(2);
    expect(resolveSketchAnnotationDenseLimit(400, null)).toBe(4);
    expect(
      resolveSketchAnnotationDenseLimit(null, null),
      "nothing measurable in a fresh context: 4",
    ).toBe(4);
  });

  test("the context extent is the largest owner entity diagonal; a point owner contributes its incident entities", () => {
    const sketchId = "sketch_draft" as const;
    const definition = {
      entities: [
        {
          entityId: "line_a",
          kind: "lineSegment",
          startPointId: "p",
          endPointId: "q",
        },
        {
          entityId: "line_b",
          kind: "lineSegment",
          startPointId: "p",
          endPointId: "r",
        },
        {
          entityId: "line_c",
          kind: "lineSegment",
          startPointId: "s",
          endPointId: "t",
        },
      ],
    } as unknown as SketchDefinition;
    const entity = (entityId: string) =>
      ({ kind: "sketchEntity", sketchId, entityId }) as PrimitiveRef;
    const extents = new Map([
      [getPrimitiveRefKey(entity("line_a")), 90],
      [getPrimitiveRefKey(entity("line_b")), 140],
      [getPrimitiveRefKey(entity("line_c")), 400],
    ]);
    const point = (pointId: string) =>
      ({ kind: "sketchPoint", sketchId, pointId }) as PrimitiveRef;

    expect(
      getSketchAnnotationContextExtent([entity("line_a")], definition, extents),
    ).toBe(90);
    expect(
      getSketchAnnotationContextExtent([point("p")], definition, extents),
      "p is the start of line_a and line_b",
    ).toBe(140);
    expect(
      getSketchAnnotationContextExtent(
        [point("q"), entity("line_c")],
        definition,
        extents,
      ),
      "the largest over every owner",
    ).toBe(400);
    expect(
      getSketchAnnotationContextExtent(
        [
          {
            kind: "sketchTangentHandle",
            sketchId,
            entityId: "line_b",
            pointId: "p",
            side: "out",
          } as unknown as PrimitiveRef,
        ],
        definition,
        extents,
      ),
      "a tangent handle contributes its curve",
    ).toBe(140);
    expect(
      getSketchAnnotationContextExtent([point("lonely")], definition, extents),
      "an isolated point has no measurable extent",
    ).toBeNull();
    expect(
      getSketchAnnotationContextExtent([], definition, extents),
    ).toBeNull();
  });

  test("the active or last glyph counts toward K and is always expanded", () => {
    const glyphs = items(10, () => endpoint, [8]);
    const [cluster] = clusterSketchAnnotations(glyphs, 4);
    expect(cluster!.expandedIds).toEqual([id(0), id(1), id(2), id(8)]);
    expect(cluster!.collapsedIds).toHaveLength(6);

    const [small] = clusterSketchAnnotations(glyphs, 2);
    expect(small!.expandedIds).toEqual([id(0), id(8)]);

    // Active and last both required at K = 2: only they are expanded.
    const [both] = clusterSketchAnnotations(
      items(10, () => endpoint, [5, 9]),
      2,
    );
    expect(both!.expandedIds).toEqual([id(5), id(9)]);

    // More required glyphs than K: none of them is ever hidden.
    const [many] = clusterSketchAnnotations(
      items(10, () => endpoint, [3, 6, 9]),
      2,
    );
    expect(many!.expandedIds).toEqual([id(3), id(6), id(9)]);
  });

  test("a click that only moves the active/last status between expanded glyphs keeps the expanded set (previous set preferred)", () => {
    // `last` = c08 (selected earlier, e.g. from the list) is expanded with
    // c00…c02. A viewport click selects the expanded c01: c08 is no longer
    // last, so by id alone c03 would replace it.
    const before = clusterSketchAnnotations(
      items(10, () => endpoint, [8]),
      4,
    )[0]!.expandedIds;
    expect(before).toEqual([id(0), id(1), id(2), id(8)]);
    const clicked = items(10, () => endpoint, [1]);
    expect(
      clusterSketchAnnotations(clicked, 4)[0]!.expandedIds,
      "premise: without the previous set the expanded glyphs change",
    ).toEqual([id(0), id(1), id(2), id(3)]);
    const preferred = new Map([
      [getSketchAnnotationClusterSignature(glyphIds(10)), before],
    ]);
    expect(
      clusterSketchAnnotations(clicked, 4, preferred)[0]!.expandedIds,
    ).toEqual(before);
  });

  test("review R-2: the previous expanded set is preferred only while the cluster's membership is unchanged", () => {
    // c00…c03 expanded; deleting c01 expands c04 in its place. Undo brings
    // c01 back: a different membership, so the stateless rule applies and
    // the original set returns (with any membership-blind preference, c04
    // would keep c01 collapsed).
    const nine = items(10, () => endpoint).filter((item) => item.id !== id(1));
    const afterDelete = clusterSketchAnnotations(nine, 4)[0]!;
    expect(afterDelete.expandedIds).toEqual([id(0), id(2), id(3), id(4)]);
    const preferred = new Map([
      [afterDelete.signature, afterDelete.expandedIds],
    ]);
    const restored = clusterSketchAnnotations(
      items(10, () => endpoint),
      4,
      preferred,
    )[0]!;
    expect(
      restored.expandedIds,
      "after Undo the original expanded set returns (c01 expanded)",
    ).toEqual([id(0), id(1), id(2), id(3)]);
    // The same membership keeps preferring (click stability).
    expect(
      clusterSketchAnnotations(
        nine,
        4,
        new Map([[afterDelete.signature, [id(5), id(6), id(7), id(9)]]]),
      )[0]!.expandedIds,
    ).toEqual([id(5), id(6), id(7), id(9)]);
  });

  test("dimensions and problems are never clustered", () => {
    const keepers: SketchAnnotationClusterLayoutItem[] = Array.from(
      { length: 8 },
      (_, index) => ({
        id: `annotation:k${index}`,
        anchor: endpoint,
        width: index % 2 ? 54 : 32,
        height: 32,
        priority: index % 2 ? "dimension" : "problem",
        keepWhenUnplaceable: true,
        cluster: null,
      }),
    );
    const layout = layoutSketchAnnotationClusters(
      keepers,
      LIMITS_2,
      new Map(),
      VIEWPORT,
      [],
    );
    expect(layout.chips).toEqual([]);
    expect(layout.placements.size).toBe(8);
  });

  test("A-4: chained anchors along a dense outline split at the 120 px diameter cap", () => {
    // 12 glyphs 30 px apart: single linkage alone chains them into one
    // 330 px cluster.
    const along = (offset: { x: number; y: number }) =>
      items(12, (index) => ({ x: offset.x + index * 30, y: offset.y }));
    const clusters = clusterSketchAnnotations(along({ x: 200, y: 400 }), 4);
    expect(clusters.map((cluster) => cluster.memberIds.length)).toEqual([
      5, 5, 2,
    ]);
    for (const cluster of clusters) {
      const xs = cluster.memberIds.map(
        (memberId) => 200 + Number(memberId.slice(-2)) * 30,
      );
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(120);
    }
    expect(clusters.map((cluster) => cluster.collapsedIds.length)).toEqual([
      1, 1, 0,
    ]);
    // Translation invariant: the same clusters after a pan.
    expect(
      clusterSketchAnnotations(along({ x: 517, y: 233 }), 4).map((cluster) => [
        cluster.memberIds,
        cluster.expandedIds,
      ]),
    ).toEqual(
      clusters.map((cluster) => [cluster.memberIds, cluster.expandedIds]),
    );
    // Glyphs farther than 40 px apart never share a cluster.
    expect(
      clusterSketchAnnotations(
        items(3, (index) => ({ x: 200 + index * 41, y: 400 })),
        2,
      ).map((cluster) => cluster.memberIds.length),
    ).toEqual([1, 1, 1]);
  });

  test("ring-cap drops fold into the cluster's `+N` (one is created when the cluster had none)", () => {
    // A 60 × 60 canvas fits a single 32 px label: every candidate clamps to
    // the same few px.
    const tiny: SketchAnnotationLayoutViewport = {
      width: 60,
      height: 60,
      topInset: 0,
      bottomInset: 0,
    };
    const centre = { x: 30, y: 30 };
    const three = layoutSketchAnnotationClusters(
      layoutItems(items(3, () => centre)),
      LIMITS_4,
      new Map(),
      tiny,
      [],
    );
    expect(
      [...three.placements.keys()].filter((key) =>
        key.startsWith("annotation:"),
      ),
      "premise: the ring cap drops two of the three glyphs",
    ).toEqual([id(0)]);
    expect(three.chips.map((chip) => chip.count)).toEqual([2]);

    const six = layoutSketchAnnotationClusters(
      layoutItems(items(6, () => centre)),
      LIMITS_4,
      new Map(),
      tiny,
      [],
    );
    expect(
      six.chips.map((chip) => chip.count),
      "2 collapsed + 3 dropped",
    ).toEqual([5]);
  });

  test("pinned glyphs and hover previews cluster apart: previews never change the pinned expansion", () => {
    const pinned = layoutItems(
      items(6, () => endpoint),
      "pinned",
    );
    const previews = layoutItems(
      Array.from({ length: 6 }, (_, index) => ({
        id: `annotation:a${index}`,
        anchor: endpoint,
        mustExpand: false,
      })),
      "preview",
    );
    const alone = layoutSketchAnnotationClusters(
      pinned,
      LIMITS_4,
      new Map(),
      VIEWPORT,
      [],
    );
    const withPreviews = layoutSketchAnnotationClusters(
      [...pinned, ...previews],
      LIMITS_4,
      new Map(),
      VIEWPORT,
      [],
    );
    expect(
      withPreviews.chips.map(({ group, count }) => [group, count]),
    ).toEqual([
      ["pinned", 2],
      ["preview", 2],
    ]);
    for (const [key, placement] of alone.placements) {
      expect(withPreviews.placements.get(key), key).toEqual(placement);
    }
  });
});

describe("T14f review R-1: a hovered control without a placed label is stale", () => {
  const target = (constraintId: string) =>
    ({
      kind: "constraint",
      sketchId: "sketch_draft",
      constraintId,
    }) as const;
  const items = [
    { annotation: { id: "c00", target: target("c00") }, isInteractive: true },
    { annotation: { id: "c03", target: target("c03") }, isInteractive: true },
    { annotation: { id: "p01", target: target("p01") }, isInteractive: false },
  ];
  const placements = new Map([["annotation:c00", {}]]);

  test("collapsed into `+N` (or dropped) → stale; placed, passive or none → not", () => {
    expect(
      isSketchAnnotationHoverUnplaced(target("c03"), items, placements),
    ).toBe(true);
    expect(
      isSketchAnnotationHoverUnplaced(target("c00"), items, placements),
    ).toBe(false);
    expect(
      isSketchAnnotationHoverUnplaced(target("p01"), items, placements),
      "a passive item is the visibility rule's case, not this one",
    ).toBe(false);
    expect(isSketchAnnotationHoverUnplaced(null, items, placements)).toBe(
      false,
    );
  });
});

// T14g (T-10), same lane and seam: the pure wheel geometry (centre clamp,
// spoke positions, envelope, the active spoke in the centre, "More…").
describe("T14g radial wheel geometry", () => {
  const near = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected)).toBeLessThan(1e-9);

  test("the centre is the activating point when the whole wheel fits; otherwise it moves only as far as needed, at every edge and corner", () => {
    const at = (x: number, y: number) =>
      clampSketchAnnotationWheelCentre({ x, y }, VIEWPORT, []);
    expect(at(500, 400), "inside: the pointer itself").toEqual({
      x: 500,
      y: 400,
    });
    // Usable band: x ∈ [100, 1100], y ∈ [76 + 100, 800 − 120 − 100] = [176, 580].
    expect(at(30, 400), "left edge").toEqual({ x: 100, y: 400 });
    expect(at(1170, 400), "right edge").toEqual({ x: 1100, y: 400 });
    expect(at(500, 90), "under the top inset").toEqual({ x: 500, y: 176 });
    expect(at(500, 700), "in the bottom band").toEqual({ x: 500, y: 580 });
    expect(at(10, 10), "top-left corner").toEqual({ x: 100, y: 176 });
    expect(at(1199, 10), "top-right corner").toEqual({ x: 1100, y: 176 });
    expect(at(10, 799), "bottom-left corner").toEqual({ x: 100, y: 580 });
    expect(at(1199, 799), "bottom-right corner").toEqual({ x: 1100, y: 580 });
    expect(at(101, 177), "just inside: unchanged").toEqual({ x: 101, y: 177 });
  });

  test("the wheel never covers chrome: it moves off a chrome rect by the least distance, and ignores non-chrome obstacles", () => {
    const panel = { x: 900, y: 76, width: 300, height: 400, chrome: true };
    expect(
      clampSketchAnnotationWheelCentre({ x: 950, y: 300 }, VIEWPORT, [panel]),
      "beside a right-side panel: pushed left to 100 px from its edge",
    ).toEqual({ x: 800, y: 300 });
    expect(
      clampSketchAnnotationWheelCentre({ x: 1000, y: 560 }, VIEWPORT, [panel]),
      "near the panel's bottom: 16 px down beats 200 px left",
    ).toEqual({ x: 1000, y: 576 });
    expect(
      clampSketchAnnotationWheelCentre({ x: 850, y: 300 }, VIEWPORT, [
        { ...panel, chrome: undefined },
      ]),
      "a non-chrome obstacle (a floating tool panel) does not move it",
    ).toEqual({ x: 850, y: 300 });
    const left = { x: 0, y: 76, width: 260, height: 604, chrome: true };
    expect(
      clampSketchAnnotationWheelCentre({ x: 120, y: 300 }, VIEWPORT, [left]),
      "off the left parts panel",
    ).toEqual({ x: 360, y: 300 });
    for (const point of [
      { x: 950, y: 300 },
      { x: 1100, y: 100 },
      { x: 120, y: 300 },
    ]) {
      const centre = clampSketchAnnotationWheelCentre(point, VIEWPORT, [
        panel,
        left,
      ]);
      for (const rect of [panel, left]) {
        const clear =
          centre.x + 100 <= rect.x ||
          centre.x - 100 >= rect.x + rect.width ||
          centre.y + 100 <= rect.y ||
          centre.y - 100 >= rect.y + rect.height;
        expect(clear, `${JSON.stringify(point)} clears the chrome`).toBe(true);
      }
    }
  });

  test("spokes: 82 px radius from −π/2, evenly spaced clockwise in id order, 28 px each, envelope ≤ 192 px; with no active spoke the centre is `−N`", () => {
    const wheel = layoutSketchAnnotationWheel({
      point: { x: 500, y: 400 },
      memberIds: [id(3), id(0), id(2), id(1)],
      activeId: null,
      viewport: VIEWPORT,
      obstacles: [],
    });
    expect(wheel.centre).toEqual({ x: 500, y: 400 });
    expect(wheel.centreId, "the `−N` toggle").toBe(null);
    expect(
      wheel.spokes.map((spoke) => spoke.kind === "member" && spoke.id),
    ).toEqual(glyphIds(4));
    const expected = [
      [500, 318],
      [582, 400],
      [500, 482],
      [418, 400],
    ];
    wheel.spokes.forEach((spoke, index) => {
      near(spoke.x, expected[index]![0]!);
      near(spoke.y, expected[index]![1]!);
    });
    expect(SKETCH_ANNOTATION_WHEEL_RADIUS_PX).toBe(82);
    expect(SKETCH_ANNOTATION_WHEEL_SPOKE_PX).toBe(28);

    const ten = layoutSketchAnnotationWheel({
      point: { x: 500, y: 400 },
      memberIds: glyphIds(10),
      activeId: null,
      viewport: VIEWPORT,
      obstacles: [],
    });
    const xs = ten.spokes.map((spoke) => spoke.x);
    const ys = ten.spokes.map((spoke) => spoke.y);
    const width = Math.max(...xs) - Math.min(...xs) + 28;
    const height = Math.max(...ys) - Math.min(...ys) + 28;
    expect(width, "envelope width").toBeLessThanOrEqual(192);
    expect(height, "envelope height").toBeLessThanOrEqual(192);
    ten.spokes.forEach((spoke, index) => {
      near(Math.hypot(spoke.x - 500, spoke.y - 400), 82);
      near(
        Math.atan2(spoke.y - 400, spoke.x - 500),
        Math.atan2(
          Math.sin(-Math.PI / 2 + (index * 2 * Math.PI) / 10),
          Math.cos(-Math.PI / 2 + (index * 2 * Math.PI) / 10),
        ),
      );
    });
    // Review R-2: one 28 px obstacle per occupied slot (centre first).
    expect(
      getSketchAnnotationWheelObstacles(ten),
      "one layout obstacle per slot",
    ).toEqual(
      [ten.centre, ...ten.spokes].map((slot) => ({
        x: slot.x - 14,
        y: slot.y - 14,
        width: 28,
        height: 28,
      })),
    );
  });

  test("the active spoke takes the centre and the other N − 1 stay radial; choosing another swaps them", () => {
    const members = glyphIds(5);
    const first = layoutSketchAnnotationWheel({
      point: { x: 500, y: 400 },
      memberIds: members,
      activeId: id(2),
      viewport: VIEWPORT,
      obstacles: [],
    });
    expect(first.centreId).toBe(id(2));
    expect(
      first.spokes.map((spoke) => spoke.kind === "member" && spoke.id),
    ).toEqual([id(0), id(1), id(3), id(4)]);
    near(first.spokes[1]!.x, 582);
    near(first.spokes[1]!.y, 400);
    const swapped = layoutSketchAnnotationWheel({
      point: { x: 500, y: 400 },
      memberIds: members,
      activeId: id(4),
      viewport: VIEWPORT,
      obstacles: [],
    });
    expect(swapped.centreId).toBe(id(4));
    expect(
      swapped.spokes.map((spoke) => spoke.kind === "member" && spoke.id),
      "the previous centre is back on the wheel",
    ).toEqual([id(0), id(1), id(2), id(3)]);
    expect(swapped.centre, "the centre point is unchanged").toEqual(
      first.centre,
    );
    expect(
      layoutSketchAnnotationWheel({
        point: { x: 500, y: 400 },
        memberIds: members,
        activeId: "annotation:elsewhere",
        viewport: VIEWPORT,
        obstacles: [],
      }).centreId,
      "an active annotation outside the wheel leaves the `−N` centre",
    ).toBe(null);
  });

  test('beyond 12 radial spokes the 12th is "More…" for the rest', () => {
    const twelve = layoutSketchAnnotationWheel({
      point: { x: 500, y: 400 },
      memberIds: glyphIds(12),
      activeId: null,
      viewport: VIEWPORT,
      obstacles: [],
    });
    expect(twelve.spokes.every((spoke) => spoke.kind === "member")).toBe(true);
    expect(twelve.spokes).toHaveLength(12);
    const thirteenActive = layoutSketchAnnotationWheel({
      point: { x: 500, y: 400 },
      memberIds: glyphIds(13),
      activeId: id(0),
      viewport: VIEWPORT,
      obstacles: [],
    });
    expect(
      thirteenActive.spokes.every((spoke) => spoke.kind === "member"),
      "13 members with one in the centre: 12 radial, no More…",
    ).toBe(true);
    const fifteen = layoutSketchAnnotationWheel({
      point: { x: 500, y: 400 },
      memberIds: glyphIds(15),
      activeId: null,
      viewport: VIEWPORT,
      obstacles: [],
    });
    expect(fifteen.spokes).toHaveLength(12);
    expect(
      fifteen.spokes
        .slice(0, 11)
        .map((spoke) => spoke.kind === "member" && spoke.id),
    ).toEqual(glyphIds(11));
    const more = fifteen.spokes[11]!;
    expect(more.kind).toBe("more");
    expect(more.kind === "more" && more.ids).toEqual([
      id(11),
      id(12),
      id(13),
      id(14),
    ]);
    near(Math.hypot(more.x - 500, more.y - 400), 82);
  });

  test("A-2: the open wheel's slots are obstacles placed before every label: no dimension chip or glyph is placed into one", () => {
    const wheel = layoutSketchAnnotationWheel({
      point: { x: 500, y: 400 },
      memberIds: glyphIds(6),
      activeId: null,
      viewport: VIEWPORT,
      obstacles: [],
    });
    const slots = getSketchAnnotationWheelObstacles(wheel);
    const others: SketchAnnotationClusterLayoutItem[] = [
      {
        id: "annotation:dim",
        anchor: { x: 560, y: 380 },
        width: 89,
        height: 32,
        priority: "dimension",
        keepWhenUnplaceable: true,
        cluster: null,
      },
      {
        id: "annotation:problem",
        anchor: { x: 500, y: 320 },
        width: 32,
        height: 32,
        priority: "problem",
        keepWhenUnplaceable: true,
        cluster: null,
      },
      {
        id: "annotation:glyph",
        anchor: { x: 430, y: 430 },
        width: 32,
        height: 32,
        priority: "pinned",
        keepWhenUnplaceable: false,
        cluster: { group: "pinned", mustExpand: false },
      },
    ];
    const { placements } = layoutSketchAnnotationClusters(
      others,
      LIMITS_4,
      new Map(),
      VIEWPORT,
      slots,
    );
    for (const item of others) {
      const placed = placements.get(item.id);
      expect(placed, `${item.id} is placed`).toBeDefined();
      // Review R-2: clear of every slot by the 6 px layout gap.
      for (const slot of slots) {
        const clear =
          placed!.x + item.width / 2 + 6 <= slot.x + 1e-6 ||
          placed!.x - item.width / 2 - 6 >= slot.x + slot.width - 1e-6 ||
          placed!.y + item.height / 2 + 6 <= slot.y + 1e-6 ||
          placed!.y - item.height / 2 - 6 >= slot.y + slot.height - 1e-6;
        expect(clear, `${item.id} stays out of every wheel slot`).toBe(true);
      }
    }
  });
});
