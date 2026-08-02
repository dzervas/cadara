import { expect, test } from "vitest";

import {
  deriveImportRegionBoundaryIdentity,
  resolveImportedRegionByBoundaryIdentity,
} from "@/contracts/import/region-boundary-identity";
import type { RegionRecord } from "@/contracts/sketch/schema";

type SegmentInput = readonly [
  source: string,
  ordinal?: number,
  direction?: "forward" | "reverse",
];

function region(input: {
  id: string;
  loops: readonly {
    role: "outer" | "inner";
    segments: readonly SegmentInput[];
  }[];
  isClosed?: boolean;
}): RegionRecord {
  return {
    regionId: input.id,
    isClosed: input.isClosed ?? true,
    loops: input.loops.map((loop, loopIndex) => ({
      loopId: `loop_${input.id}_${loopIndex}`,
      role: loop.role,
      orientation: "counterClockwise",
      isClosed: true,
      boundaryPointIds: [],
      segments: loop.segments.map(
        ([
          entityId,
          sourceSegmentOrdinal = 0,
          traversalDirection = "forward",
        ]) => ({
          source: { kind: "entity", entityId },
          sourceSegmentOrdinal,
          traversalDirection,
          startPointId: null,
          endPointId: null,
        }),
      ),
    })),
  } as RegionRecord;
}

function reverseSourceOrientations(
  regionRecord: RegionRecord,
  universe: readonly RegionRecord[],
): RegionRecord {
  const counts = new Map<string, number>();
  for (const candidate of universe) {
    for (const loop of candidate.loops) {
      for (const segment of loop.segments) {
        if (segment.source.kind !== "entity") continue;
        counts.set(
          segment.source.entityId,
          Math.max(
            counts.get(segment.source.entityId) ?? 0,
            (segment.sourceSegmentOrdinal ?? 0) + 1,
          ),
        );
      }
    }
  }
  return {
    ...regionRecord,
    loops: regionRecord.loops.map((loop) => ({
      ...loop,
      segments: loop.segments.map((segment) => {
        const count =
          segment.source.kind === "entity"
            ? (counts.get(segment.source.entityId) ?? 1)
            : 1;
        return {
          ...segment,
          sourceSegmentOrdinal: count - 1 - (segment.sourceSegmentOrdinal ?? 0),
          traversalDirection:
            segment.traversalDirection === "reverse" ? "forward" : "reverse",
        };
      }),
    })),
  };
}

function reverseLoopTraversal(regionRecord: RegionRecord): RegionRecord {
  return {
    ...regionRecord,
    loops: regionRecord.loops.map((loop) => ({
      ...loop,
      segments: [...loop.segments].reverse().map((segment) => ({
        ...segment,
        traversalDirection:
          segment.traversalDirection === "reverse" ? "forward" : "reverse",
      })),
    })),
  };
}

test("import boundary identity matches a reversed unsplit source orientation", () => {
  const forward = region({
    id: "region_forward",
    loops: [
      { role: "outer", segments: [["bottom"], ["right"], ["top"], ["left"]] },
    ],
  });
  const sourceReversed = reverseSourceOrientations(forward, [forward]);

  expect(
    deriveImportRegionBoundaryIdentity(sourceReversed, [sourceReversed]),
  ).toBe(deriveImportRegionBoundaryIdentity(forward, [forward]));
});

const splitCellProfiles = [
  region({
    id: "region_left",
    loops: [
      {
        role: "outer",
        segments: [["bottom", 0], ["split"], ["top", 1], ["left"]],
      },
    ],
  }),
  region({
    id: "region_right",
    loops: [
      {
        role: "outer",
        segments: [["bottom", 1], ["right"], ["top", 0], ["split"]],
      },
    ],
  }),
] as const;

test("import boundary identity keeps source-reversed split cells matching and distinct", () => {
  const sourceReversed = splitCellProfiles.map((candidate) =>
    reverseSourceOrientations(candidate, splitCellProfiles),
  );
  const [left, right] = splitCellProfiles;
  const expectedLeft = deriveImportRegionBoundaryIdentity(left, splitCellProfiles);
  const expectedRight = deriveImportRegionBoundaryIdentity(right, splitCellProfiles);

  expect(expectedLeft).not.toBe(expectedRight);
  expect(
    deriveImportRegionBoundaryIdentity(sourceReversed[0], sourceReversed),
  ).toBe(expectedLeft);
  expect(
    deriveImportRegionBoundaryIdentity(sourceReversed[1], sourceReversed),
  ).toBe(expectedRight);
  expect(
    resolveImportedRegionByBoundaryIdentity(sourceReversed, expectedLeft)
      ?.regionId,
  ).toBe("region_left");
  expect(
    resolveImportedRegionByBoundaryIdentity(sourceReversed, expectedRight)
      ?.regionId,
  ).toBe("region_right");
});

test("import boundary identity keeps traversal-reversed split cells matching and distinct", () => {
  const traversalReversed = splitCellProfiles.map(reverseLoopTraversal);
  const [left, right] = splitCellProfiles;
  const expectedLeft = deriveImportRegionBoundaryIdentity(left, splitCellProfiles);
  const expectedRight = deriveImportRegionBoundaryIdentity(right, splitCellProfiles);

  expect(expectedLeft).not.toBe(expectedRight);
  expect(
    deriveImportRegionBoundaryIdentity(traversalReversed[0], traversalReversed),
  ).toBe(expectedLeft);
  expect(
    deriveImportRegionBoundaryIdentity(traversalReversed[1], traversalReversed),
  ).toBe(expectedRight);
  expect(
    resolveImportedRegionByBoundaryIdentity(traversalReversed, expectedLeft)
      ?.regionId,
  ).toBe("region_left");
  expect(
    resolveImportedRegionByBoundaryIdentity(traversalReversed, expectedRight)
      ?.regionId,
  ).toBe("region_right");
});

test("import boundary identity resolves zero, one, and many matches strictly", () => {
  const selected = region({
    id: "region_selected",
    loops: [{ role: "outer", segments: [["a"], ["b"]] }],
  });
  const expected = deriveImportRegionBoundaryIdentity(selected, [selected]);
  const different = region({
    id: "region_different",
    loops: [{ role: "outer", segments: [["c"], ["d"]] }],
  });
  const duplicate = {
    ...selected,
    regionId: "region_duplicate" as RegionRecord["regionId"],
  };

  expect(
    resolveImportedRegionByBoundaryIdentity([different], expected),
  ).toBeNull();
  expect(resolveImportedRegionByBoundaryIdentity([selected], expected)).toBe(
    selected,
  );
  expect(
    resolveImportedRegionByBoundaryIdentity([selected, duplicate], expected),
  ).toBeNull();
});

test("import boundary identity rejects open regions and distinguishes inner loops", () => {
  const annulus = region({
    id: "region_annulus",
    loops: [
      { role: "outer", segments: [["outer"]] },
      { role: "inner", segments: [["inner"]] },
    ],
  });
  const outerOnly = region({
    id: "region_outer",
    loops: [{ role: "outer", segments: [["outer"]] }],
  });
  const open = region({
    id: "region_open",
    isClosed: false,
    loops: [{ role: "outer", segments: [["outer"]] }],
  });

  const annulusIdentity = deriveImportRegionBoundaryIdentity(annulus, [
    annulus,
    outerOnly,
  ]);
  expect(annulusIdentity).not.toBe(
    deriveImportRegionBoundaryIdentity(outerOnly, [annulus, outerOnly]),
  );
  expect(
    resolveImportedRegionByBoundaryIdentity([outerOnly], annulusIdentity),
  ).toBeNull();
  expect(
    resolveImportedRegionByBoundaryIdentity(
      [open],
      deriveImportRegionBoundaryIdentity(open, [open]),
    ),
  ).toBeNull();
});
