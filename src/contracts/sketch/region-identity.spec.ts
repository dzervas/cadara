import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  canonicalRegionSignature,
  createRegionId,
  declaredJoinVertexKey,
  intersectionVertexKey,
  overlapEndVertexKey,
  regionBranchKey,
} from "@/contracts/sketch/region-identity";
import type {
  RegionBoundaryBranch,
  RegionBoundarySegmentRecord,
  RegionBoundaryVertex,
  RegionLoopRecord,
} from "@/contracts/sketch/sketch-arrangement";

const branch = (name: string): RegionBoundaryBranch => ({
  source: { kind: "entity", entityId: `sketch_entity_${name}` },
  spanId: "whole",
});
const join = (name: string): RegionBoundaryVertex => ({
  kind: "declaredJoin",
  key: declaredJoinVertexKey([`sketch_point_${name}`]),
  pointIds: [`sketch_point_${name}`],
  portPointId: null,
  position: [0, 0],
  ballRadius: 0,
});
const segment = (
  name: string,
  start: RegionBoundaryVertex,
  end: RegionBoundaryVertex,
  traversal: "forward" | "reverse" = "forward",
): RegionBoundarySegmentRecord => ({
  branch: branch(name),
  sourceParameterInterval: [0, 1],
  traversalDirection: traversal,
  start,
  end,
  sourceSegmentOrdinal: 0,
});
const loop = (
  role: "outer" | "inner",
  segments: RegionBoundarySegmentRecord[],
): RegionLoopRecord => ({
  loopId: "region_loop_x",
  role,
  orientation: role === "outer" ? "counterClockwise" : "clockwise",
  segments,
  boundaryPointIds: [],
  isClosed: true,
});
const [a, b, c, d] = ["a", "b", "c", "d"].map(join) as [
  RegionBoundaryVertex,
  RegionBoundaryVertex,
  RegionBoundaryVertex,
  RegionBoundaryVertex,
];
const square = [
  segment("s0", a, b),
  segment("s1", b, c),
  segment("s2", c, d),
  segment("s3", d, a),
];
const degree = (value: number) =>
  new Map([a, b, c, d].map((vertex) => [vertex.key, value]));

describe("canonical region signature", () => {
  test("is invariant to loop rotation and to the order of inner loops", () => {
    const hole1 = loop("inner", [segment("h1", a, a, "reverse")]);
    const hole2 = loop("inner", [segment("h2", b, b, "reverse")]);
    const base = canonicalRegionSignature(
      { loops: [loop("outer", square), hole1, hole2] },
      degree(3),
    );
    const rotated = canonicalRegionSignature(
      {
        loops: [
          loop("outer", [...square.slice(2), ...square.slice(0, 2)]),
          hole2,
          hole1,
        ],
      },
      degree(3),
    );
    expect(rotated).toBe(base);
    expect(
      canonicalRegionSignature(
        { loops: [loop("outer", square), hole1] },
        degree(3),
      ),
    ).not.toBe(base);
  });

  test("keys encode branch, branch-forward endpoints and traversal sign, never coordinates", () => {
    const forward = canonicalRegionSignature(
      { loops: [loop("outer", square)] },
      degree(3),
    );
    const moved = square.map((entry) => ({
      ...entry,
      sourceParameterInterval: [0.25, 0.75] as const,
      start: entry.start && { ...entry.start, position: [9, 9] as const },
    }));
    expect(
      canonicalRegionSignature({ loops: [loop("outer", moved)] }, degree(3)),
    ).toBe(forward);
    const reversedFirst = [segment("s0", b, a, "reverse"), ...square.slice(1)];
    expect(
      canonicalRegionSignature(
        { loops: [loop("outer", reversedFirst)] },
        degree(3),
      ),
    ).not.toBe(forward);
  });

  test("a degree-2 vertex between two segments of one branch collapses; a degree-3 vertex does not", () => {
    const x: RegionBoundaryVertex = { ...join("x"), key: "x-noise" };
    const split = [
      segment("s0", a, x),
      segment("s0", x, b),
      ...square.slice(1),
    ];
    const noise = new Map([...degree(3), [x.key, 2]]);
    expect(
      canonicalRegionSignature({ loops: [loop("outer", split)] }, noise),
    ).toBe(
      canonicalRegionSignature({ loops: [loop("outer", square)] }, degree(3)),
    );
    const significant = new Map([...degree(3), [x.key, 3]]);
    expect(
      canonicalRegionSignature({ loops: [loop("outer", split)] }, significant),
    ).not.toBe(
      canonicalRegionSignature({ loops: [loop("outer", square)] }, degree(3)),
    );
  });

  test("a loop that collapses completely onto one closed branch is that branch", () => {
    const x: RegionBoundaryVertex = { ...join("x"), key: "x-noise" };
    const circle = [segment("c", x, x)];
    const unsplit: RegionBoundarySegmentRecord = {
      ...segment("c", x, x),
      start: null,
      end: null,
    };
    expect(
      canonicalRegionSignature(
        { loops: [loop("outer", circle)] },
        new Map([[x.key, 2]]),
      ),
    ).toBe(
      canonicalRegionSignature(
        { loops: [loop("outer", [unsplit])] },
        new Map(),
      ),
    );
  });
});

describe("vertex and branch keys", () => {
  test("keys are injective for ids containing separators", () => {
    expect(intersectionVertexKey("a|b", "c", 1, 0, 0)).not.toBe(
      intersectionVertexKey("a", "b|c", 1, 0, 0),
    );
    expect(declaredJoinVertexKey(["p,q"])).not.toBe(
      declaredJoinVertexKey(["p", "q"]),
    );
    expect(overlapEndVertexKey("a", "b", 1, 0, "lo")).not.toBe(
      overlapEndVertexKey("a", "b", 1, 0, "hi"),
    );
  });

  test("pair keys are symmetric in argument order and include the family census", () => {
    expect(intersectionVertexKey("b", "a", 2, 1, 0)).toBe(
      intersectionVertexKey("a", "b", 2, 0, 1),
    );
    expect(
      overlapEndVertexKey("b", "a", 2, 1, "lo"),
      "overlap ends are measured along the lower-key branch, whatever the argument order",
    ).toBe(overlapEndVertexKey("a", "b", 2, 1, "lo"));
    expect(intersectionVertexKey("a", "b", 3, 0, 1)).not.toBe(
      intersectionVertexKey("a", "b", 2, 0, 1),
    );
    expect(declaredJoinVertexKey(["q", "p"])).toBe(
      declaredJoinVertexKey(["p", "q"]),
    );
  });

  test("branch keys separate entities, projected geometry and spans", () => {
    const keys = [
      regionBranchKey(branch("x")),
      regionBranchKey({ ...branch("x"), spanId: "o0>o1" }),
      regionBranchKey({
        source: {
          kind: "projectedGeometry",
          reference: {
            referenceId: "ref_x",
            geometryId: "projected_geometry_x",
          },
        },
        spanId: "whole",
      }),
    ];
    expect(new Set(keys).size).toBe(3);
  });
});

describe("region id", () => {
  test("is the 128-bit SHA-256 prefix of the sketch id and signature", async () => {
    const signature = '[["k"]]';
    const expected = createHash("sha256")
      .update(JSON.stringify(["sketch_a", signature]))
      .digest("hex")
      .slice(0, 32);
    expect(await createRegionId("sketch_a", signature)).toBe(
      `region_${expected}`,
    );
    expect(await createRegionId("sketch_b", signature)).not.toBe(
      `region_${expected}`,
    );
  });
});
