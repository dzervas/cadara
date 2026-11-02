/**
 * The measure readout's closest-pair search between tessellated edges and
 * faces, against the brute-force scan it replaced: every element pair in
 * order, measured with the allocating vector helpers the readout used
 * before, the first least distance winning.
 *
 * Where the nearest pair is unique the search must return the scan's result
 * bit for bit. Where pairs tie (parallel plates, coaxial tubes, crossing
 * sheets) the search may stop at any pair within its 1e-6 mm tie tolerance,
 * so those rows pin the distance and that the witness is a real pair of
 * points at that distance, not which tied pair it is.
 */
import { describe, expect, test } from "vitest";

import {
  closestPolylinePair,
  closestPolylineTrianglePair,
  closestTrianglePair,
  type ClosestElementPair,
  type MeasuredTriangle,
  traceClosestElementPairWorkForTest,
} from "@/core/measure/closest-element-pair";
import type { WorkspaceVec3 } from "@/core/workspace/sketch-plane-mapping";

const TIE_TOLERANCE = 1e-6;

describe("closest element pair matches the brute-force scan", () => {
  test("unique nearest pairs: distance and witness are bit-identical", () => {
    const sheetA = jitteredSheet(1, 10, 0, 0.3);
    const sheetB = jitteredSheet(2, 10, 0.5, 0.3);
    const tubeInner = tube(10, 48, 3, 20);
    // Off-centre and leaning, so its nearest point to the inner tube is unique.
    const tubeOffset = tube(12, 40, 3, 20, [1.5, 0.5], 0.37, 0.08);
    const curve = helix(60, [4, 5, 1.5], 3, 2);
    const skewCurve = helix(45, [5, 4, 1], 2.5, 3, 0.4);

    expectBitIdentical(
      closestTrianglePair(sheetA, sheetB),
      bruteForce(sheetA, sheetB, oracleTrianglePair),
    );
    expectBitIdentical(
      closestTrianglePair(tubeOffset, tubeInner),
      bruteForce(tubeOffset, tubeInner, oracleTrianglePair),
    );
    const curveSegments = segmentsOf(curve);
    const skewSegments = segmentsOf(skewCurve);
    expectBitIdentical(
      closestPolylineTrianglePair(curve, sheetB),
      bruteForce(curveSegments, sheetB, (segment, triangle) =>
        oracleSegmentTriangle(segment[0], segment[1], triangle),
      ),
    );
    expectBitIdentical(
      closestPolylinePair(curve, skewCurve),
      bruteForce(curveSegments, skewSegments, oracleSegmentPair),
    );
  });

  test("tied pairs: distance within the tie tolerance, witness a real pair at that distance", () => {
    const plateTop = flatSheet(8, 0);
    const plateBottom = flatSheet(8, 8);
    const tubeInner = tube(10, 48, 3, 20);
    const tubeOuter = tube(18, 48, 3, 20);
    const sheetA = jitteredSheet(1, 10, 0, 0.3);
    const crossing = jitteredSheet(3, 10, 0.05, 0.3);

    for (const [first, second] of [
      [plateTop, plateBottom],
      [tubeInner, tubeOuter],
      [sheetA, crossing],
    ] as const) {
      const result = closestTrianglePair(first, second)!;
      const oracle = bruteForce(first, second, oracleTrianglePair)!;
      expect(Math.abs(result.distance - oracle.distance)).toBeLessThanOrEqual(
        TIE_TOLERANCE,
      );
      expect(magnitude(subtract(result.end, result.start))).toBe(
        result.distance,
      );
      expect(distanceToTriangles(result.start, first)).toBeLessThan(1e-9);
      expect(distanceToTriangles(result.end, second)).toBeLessThan(1e-9);
    }
    expect(closestTrianglePair(sheetA, crossing)!.distance).toBe(0);
  });

  test("a contact is still found after a pair closer than the tie tolerance", () => {
    const floor = [triangle([0, 0, 0], [10, 0, 0], [0, 10, 0])];
    const hovering = triangle([0, 0, 5e-7], [1, 0, 5e-7], [0, 1, 5e-7]);
    const piercing = triangle([2, 2, -1], [3, 2, -1], [2, 2, 1]);
    expect(closestTrianglePair(floor, [hovering, piercing])!.distance).toBe(0);
  });

  test("two plate faces equidistant everywhere are settled by a few pairs, not every overlapping one", () => {
    // 3200 triangles per face, 8 mm apart: every overlapping triangle pair
    // ties at 8 mm, so measuring each tie would take tens of thousands.
    const top = flatSheet(40, 0);
    const bottom = flatSheet(40, 8);
    const { result, work } = traceClosestElementPairWorkForTest(() =>
      closestTrianglePair(top, bottom),
    );
    expect(Math.abs(result!.distance - 8)).toBeLessThanOrEqual(TIE_TOLERANCE);
    expect(work.measuredPairs).toBeLessThan(top.length);
  });
});

function expectBitIdentical(
  actual: ClosestElementPair | null,
  expected: ClosestElementPair | null,
) {
  expect(actual).not.toBeNull();
  const bits = (pair: ClosestElementPair) =>
    [pair.distance, ...pair.start, ...pair.end].map((value) =>
      Object.is(value, -0) ? "-0" : String(value),
    );
  expect(bits(actual!)).toEqual(bits(expected!));
}

function bruteForce<First, Second>(
  first: readonly First[],
  second: readonly Second[],
  measure: (first: First, second: Second) => ClosestElementPair,
) {
  let best: ClosestElementPair | null = null;
  for (const firstElement of first)
    for (const secondElement of second) {
      const result = measure(firstElement, secondElement);
      if (!best || result.distance < best.distance) best = result;
    }
  return best;
}

function distanceToTriangles(
  point: WorkspaceVec3,
  triangles: readonly MeasuredTriangle[],
) {
  return Math.min(
    ...triangles.map((triangle) =>
      magnitude(subtract(oracleClosestPointOnTriangle(point, triangle), point)),
    ),
  );
}

// Fixtures.

function triangle(
  first: WorkspaceVec3,
  second: WorkspaceVec3,
  third: WorkspaceVec3,
): MeasuredTriangle {
  return { first, second, third };
}

function gridTriangles(
  columns: number,
  rows: number,
  point: (column: number, row: number) => WorkspaceVec3,
  wrapColumns = false,
) {
  const points: WorkspaceVec3[][] = [];
  for (let row = 0; row <= rows; row += 1) {
    points.push([]);
    for (let column = 0; column < columns + (wrapColumns ? 0 : 1); column += 1)
      points[row]!.push(point(column, row));
  }
  const at = (column: number, row: number) =>
    points[row]![wrapColumns ? column % columns : column]!;
  const triangles: MeasuredTriangle[] = [];
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      triangles.push(
        triangle(at(column, row), at(column + 1, row), at(column + 1, row + 1)),
        triangle(at(column, row), at(column + 1, row + 1), at(column, row + 1)),
      );
    }
  return triangles;
}

function flatSheet(cells: number, z: number) {
  return gridTriangles(cells, cells, (column, row) => [column, row, z]);
}

/** Seeded jitter: near ties without exact ones. */
function jitteredSheet(seed: number, cells: number, z: number, jitter: number) {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
  return gridTriangles(cells, cells, (column, row) => [
    column + random() * jitter,
    row + random() * jitter,
    z + random() * jitter * 4,
  ]);
}

function tube(
  radius: number,
  segments: number,
  rings: number,
  height: number,
  centre: readonly [number, number] = [0, 0],
  phase = 0,
  lean = 0,
) {
  return gridTriangles(
    segments,
    rings,
    (step, ring) => {
      const angle = (2 * Math.PI * (step + phase)) / segments;
      const z = (height * ring) / rings;
      return [
        centre[0] + lean * z + radius * Math.cos(angle),
        centre[1] + radius * Math.sin(angle),
        z,
      ];
    },
    true,
  );
}

function helix(
  points: number,
  centre: WorkspaceVec3,
  radius: number,
  pitch: number,
  phase = 0,
): WorkspaceVec3[] {
  return Array.from({ length: points }, (_, index) => {
    const angle = phase + index * 0.21;
    return [
      centre[0] + radius * Math.cos(angle),
      centre[1] + radius * Math.sin(angle),
      centre[2] + (pitch * angle) / (2 * Math.PI),
    ];
  });
}

function segmentsOf(points: readonly WorkspaceVec3[]) {
  return points.slice(1).map((end, index) => [points[index]!, end] as const);
}

// The pre-change kernel, verbatim apart from names: the oracle.

const DISTANCE_EPSILON = 1e-9;

function oracleSegmentPair(
  first: readonly [WorkspaceVec3, WorkspaceVec3],
  second: readonly [WorkspaceVec3, WorkspaceVec3],
): ClosestElementPair {
  const result = oracleSegments(first[0], first[1], second[0], second[1]);
  return {
    distance: distanceBetween(result.start, result.end),
    start: result.start,
    end: result.end,
  };
}

function oracleTrianglePair(
  first: MeasuredTriangle,
  second: MeasuredTriangle,
): ClosestElementPair {
  const candidates: ClosestElementPair[] = [];
  for (const [start, end] of triangleEdges(first))
    candidates.push(oracleSegmentTriangle(start, end, second));
  for (const [start, end] of triangleEdges(second)) {
    const reversed = oracleSegmentTriangle(start, end, first);
    candidates.push({
      distance: reversed.distance,
      start: reversed.end,
      end: reversed.start,
    });
  }
  return candidates.reduce((best, entry) =>
    entry.distance < best.distance ? entry : best,
  );
}

function oracleSegmentTriangle(
  start: WorkspaceVec3,
  end: WorkspaceVec3,
  triangle: MeasuredTriangle,
): ClosestElementPair {
  const intersection = oracleIntersectSegmentTriangle(start, end, triangle);
  if (intersection)
    return { distance: 0, start: intersection, end: intersection };

  const startClosest = oracleClosestPointOnTriangle(start, triangle);
  const endClosest = oracleClosestPointOnTriangle(end, triangle);
  const candidates: ClosestElementPair[] = [
    {
      distance: distanceBetween(start, startClosest),
      start,
      end: startClosest,
    },
    { distance: distanceBetween(end, endClosest), start: end, end: endClosest },
  ];
  for (const [edgeStart, edgeEnd] of triangleEdges(triangle)) {
    const result = oracleSegments(start, end, edgeStart, edgeEnd);
    candidates.push({
      distance: distanceBetween(result.start, result.end),
      start: result.start,
      end: result.end,
    });
  }
  return candidates.reduce((best, entry) =>
    entry.distance < best.distance ? entry : best,
  );
}

function triangleEdges(triangle: MeasuredTriangle) {
  return [
    [triangle.first, triangle.second],
    [triangle.second, triangle.third],
    [triangle.third, triangle.first],
  ] as const;
}

function oracleIntersectSegmentTriangle(
  start: WorkspaceVec3,
  end: WorkspaceVec3,
  triangle: MeasuredTriangle,
) {
  const direction = subtract(end, start);
  const edgeOne = subtract(triangle.second, triangle.first);
  const edgeTwo = subtract(triangle.third, triangle.first);
  const pVector = crossProduct(direction, edgeTwo);
  const determinant = dotProduct(edgeOne, pVector);
  if (Math.abs(determinant) <= DISTANCE_EPSILON) return null;

  const inverseDeterminant = 1 / determinant;
  const tVector = subtract(start, triangle.first);
  const u = dotProduct(tVector, pVector) * inverseDeterminant;
  if (u < 0 || u > 1) return null;

  const qVector = crossProduct(tVector, edgeOne);
  const v = dotProduct(direction, qVector) * inverseDeterminant;
  if (v < 0 || u + v > 1) return null;

  const t = dotProduct(edgeTwo, qVector) * inverseDeterminant;
  if (t < 0 || t > 1) return null;

  return add(start, scale(direction, t));
}

function oracleClosestPointOnTriangle(
  point: WorkspaceVec3,
  triangle: MeasuredTriangle,
): WorkspaceVec3 {
  const ab = subtract(triangle.second, triangle.first);
  const ac = subtract(triangle.third, triangle.first);
  const ap = subtract(point, triangle.first);
  const d1 = dotProduct(ab, ap);
  const d2 = dotProduct(ac, ap);
  if (d1 <= 0 && d2 <= 0) return triangle.first;

  const bp = subtract(point, triangle.second);
  const d3 = dotProduct(ab, bp);
  const d4 = dotProduct(ac, bp);
  if (d3 >= 0 && d4 <= d3) return triangle.second;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return add(triangle.first, scale(ab, v));
  }

  const cp = subtract(point, triangle.third);
  const d5 = dotProduct(ab, cp);
  const d6 = dotProduct(ac, cp);
  if (d6 >= 0 && d5 <= d6) return triangle.third;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return add(triangle.first, scale(ac, w));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return add(
      triangle.second,
      scale(subtract(triangle.third, triangle.second), w),
    );
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return add(triangle.first, add(scale(ab, v), scale(ac, w)));
}

function oracleSegments(
  firstStart: WorkspaceVec3,
  firstEnd: WorkspaceVec3,
  secondStart: WorkspaceVec3,
  secondEnd: WorkspaceVec3,
): { start: WorkspaceVec3; end: WorkspaceVec3 } {
  const firstDirection = subtract(firstEnd, firstStart);
  const secondDirection = subtract(secondEnd, secondStart);
  const between = subtract(firstStart, secondStart);
  const a = dotProduct(firstDirection, firstDirection);
  const e = dotProduct(secondDirection, secondDirection);
  const f = dotProduct(secondDirection, between);
  let firstT = 0;
  let secondT = 0;

  if (a <= DISTANCE_EPSILON && e <= DISTANCE_EPSILON)
    return { start: firstStart, end: secondStart };

  const b = dotProduct(firstDirection, secondDirection);
  const denominator = a * e - b * b;
  if (
    a > DISTANCE_EPSILON &&
    e > DISTANCE_EPSILON &&
    Math.abs(denominator) <= DISTANCE_EPSILON * a * e
  )
    return oracleParallelSegments(firstStart, firstEnd, secondStart, secondEnd);

  if (a <= DISTANCE_EPSILON) {
    secondT = clamp(f / e, 0, 1);
  } else {
    const c = dotProduct(firstDirection, between);
    if (e <= DISTANCE_EPSILON) {
      firstT = clamp(-c / a, 0, 1);
    } else {
      firstT =
        denominator !== 0 ? clamp((b * f - c * e) / denominator, 0, 1) : 0;
      secondT = (b * firstT + f) / e;
      if (secondT < 0) {
        secondT = 0;
        firstT = clamp(-c / a, 0, 1);
      } else if (secondT > 1) {
        secondT = 1;
        firstT = clamp((b - c) / a, 0, 1);
      }
    }
  }

  return {
    start: add(firstStart, scale(firstDirection, firstT)),
    end: add(secondStart, scale(secondDirection, secondT)),
  };
}

function oracleParallelSegments(
  firstStart: WorkspaceVec3,
  firstEnd: WorkspaceVec3,
  secondStart: WorkspaceVec3,
  secondEnd: WorkspaceVec3,
) {
  const firstDirection = subtract(firstEnd, firstStart);
  const firstLength = magnitude(firstDirection);
  if (firstLength <= DISTANCE_EPSILON)
    return {
      start: firstStart,
      end: oracleClosestPointOnSegment(firstStart, secondStart, secondEnd),
    };

  const axis = scale(firstDirection, 1 / firstLength);
  const secondStartProjection = dotProduct(
    subtract(secondStart, firstStart),
    axis,
  );
  const secondEndProjection = dotProduct(subtract(secondEnd, firstStart), axis);
  const overlapStart = Math.max(
    0,
    Math.min(secondStartProjection, secondEndProjection),
  );
  const overlapEnd = Math.min(
    firstLength,
    Math.max(secondStartProjection, secondEndProjection),
  );
  if (overlapStart <= overlapEnd + DISTANCE_EPSILON) {
    const anchor = add(
      firstStart,
      scale(axis, clamp((overlapStart + overlapEnd) / 2, 0, firstLength)),
    );
    return {
      start: oracleClosestPointOnSegment(anchor, firstStart, firstEnd),
      end: oracleClosestPointOnSegment(anchor, secondStart, secondEnd),
    };
  }

  const candidates = [
    {
      start: firstStart,
      end: oracleClosestPointOnSegment(firstStart, secondStart, secondEnd),
    },
    {
      start: firstEnd,
      end: oracleClosestPointOnSegment(firstEnd, secondStart, secondEnd),
    },
    {
      start: oracleClosestPointOnSegment(secondStart, firstStart, firstEnd),
      end: secondStart,
    },
    {
      start: oracleClosestPointOnSegment(secondEnd, firstStart, firstEnd),
      end: secondEnd,
    },
  ];
  return candidates.reduce((best, entry) =>
    distanceBetween(entry.start, entry.end) <
    distanceBetween(best.start, best.end)
      ? entry
      : best,
  );
}

function oracleClosestPointOnSegment(
  point: WorkspaceVec3,
  start: WorkspaceVec3,
  end: WorkspaceVec3,
) {
  const direction = subtract(end, start);
  const lengthSquared = dotProduct(direction, direction);
  if (lengthSquared <= DISTANCE_EPSILON) return start;
  const t = clamp(
    dotProduct(subtract(point, start), direction) / lengthSquared,
    0,
    1,
  );
  return add(start, scale(direction, t));
}

function distanceBetween(first: WorkspaceVec3, second: WorkspaceVec3) {
  return magnitude(subtract(second, first));
}

function magnitude(vector: WorkspaceVec3) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function subtract(left: WorkspaceVec3, right: WorkspaceVec3): WorkspaceVec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function add(left: WorkspaceVec3, right: WorkspaceVec3): WorkspaceVec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function scale(vector: WorkspaceVec3, amount: number): WorkspaceVec3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function dotProduct(left: WorkspaceVec3, right: WorkspaceVec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function crossProduct(
  left: WorkspaceVec3,
  right: WorkspaceVec3,
): WorkspaceVec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
