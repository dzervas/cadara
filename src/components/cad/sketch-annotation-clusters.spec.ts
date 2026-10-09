import { describe, expect, test } from "vitest";

import {
  clusterSketchAnnotations,
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
