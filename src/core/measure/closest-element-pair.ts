import type { WorkspaceVec3 } from "@/core/workspace/sketch-plane-mapping";

/**
 * Closest points between two segment or triangle sets: the minimum distance
 * of the measure readout between tessellated edges and faces.
 *
 * Every element pair is measured with the floating-point operations of the
 * brute-force scan it replaced (within a triangle pair, the same candidates
 * reduced in the same order), on flat coordinates without allocating. The
 * search skips element pairs whose box or plane bounds show they cannot come
 * closer than the best so far minus TIE_TOLERANCE (chunk pairs are visited
 * nearest first), and a candidate whose squared distance is certainly above
 * that skips `Math.hypot`, which costs several times the rest of a candidate.
 *
 * The distance is therefore the brute-force minimum or at most TIE_TOLERANCE
 * above it, and the witness is a measured pair of points at exactly that
 * distance. Among pairs closer together than the tolerance (an exact tie
 * included) the witness is whichever the fixed visiting order meets first,
 * so it is deterministic for a given input but may differ from the
 * brute-force scan's earliest pair. Without the tolerance, faces that are
 * equidistant everywhere (two sides of a plate, coaxial cylinders) tie on
 * nearly every overlapping pair, and every tie has to be measured.
 */

export interface ClosestElementPair {
  distance: number;
  start: WorkspaceVec3;
  end: WorkspaceVec3;
}

export interface MeasuredTriangle {
  first: WorkspaceVec3;
  second: WorkspaceVec3;
  third: WorkspaceVec3;
}

/** Work done by the search, for timing-free regressions. */
export interface ClosestElementPairWork {
  /** Element pairs measured with the segment/triangle kernel. */
  measuredPairs: number;
}

const work: ClosestElementPairWork = { measuredPairs: 0 };

/** The work `run` made the search do. */
export function traceClosestElementPairWorkForTest<T>(run: () => T): {
  result: T;
  work: ClosestElementPairWork;
} {
  work.measuredPairs = 0;
  const result = run();
  return { result, work: { ...work } };
}

/** Closest points of two polylines' segments, `first` to `second`. */
export function closestPolylinePair(
  first: readonly WorkspaceVec3[],
  second: readonly WorkspaceVec3[],
): ClosestElementPair | null {
  return closestElementPair(
    flattenPolyline(first),
    flattenPolyline(second),
    measureSegmentPair,
  );
}

/** Closest points of a polyline's segments and triangles, polyline first. */
export function closestPolylineTrianglePair(
  polyline: readonly WorkspaceVec3[],
  triangles: readonly MeasuredTriangle[],
): ClosestElementPair | null {
  return closestElementPair(
    flattenPolyline(polyline),
    flattenTriangles(triangles),
    measureSegmentTrianglePair,
  );
}

/** Closest points of two triangle sets, `first` to `second`. */
export function closestTrianglePair(
  first: readonly MeasuredTriangle[],
  second: readonly MeasuredTriangle[],
): ClosestElementPair | null {
  return closestElementPair(
    flattenTriangles(first),
    flattenTriangles(second),
    measureTrianglePair,
  );
}

/** Matches measurement.ts: degenerate lengths and determinants (mm). */
const DISTANCE_EPSILON = 1e-9;
/** Consecutive elements per chunk: tessellations are spatially coherent. */
const ELEMENT_CHUNK_SIZE = 32;
/** Bounds are compared with this margin (mm) for rounding. */
const PRUNE_SLACK = 1e-9;
/**
 * A pair has to beat the best so far by more than this (mm) to be measured.
 * Rigorous bounds carry PRUNE_SLACK for rounding, so they can never prove
 * that a pair tying the best exactly will not come out a rounding error
 * below it: without a tolerance every tie is measured, which on equidistant
 * faces is nearly every overlapping pair (~225k triangle pairs on two wheel
 * plate faces 8 mm apart). The tolerance is far below the readout's display
 * precision; the witness may move among points this close to the minimum.
 */
const TIE_TOLERANCE = 1e-6;
/**
 * A candidate skips `Math.hypot` when its squared distance exceeds the
 * squared bound by this relative margin: both carry a few ulps of rounding,
 * so the skipped distance is certainly above the bound.
 */
const SQUARED_SKIP_MARGIN = 1 + 1e-12;
/** Below this bound squares lose precision to underflow; never skip. */
const MIN_SKIP_BOUND = 1e-100;

/** Elements as flat coordinates and per-element bounds. */
interface ElementList {
  count: number;
  /** 3 coordinates per point, `points` points per element. */
  coordinates: Float64Array;
  points: 2 | 3;
  /** BOUND_STRIDE values per element; see the BOUND_* offsets. */
  bounds: Float64Array;
}

// Per-element bound layout: box min x, y, z, box max x, y, z, plane normal
// x, y, z, plane offset, 1 when the element has a plane (a triangle with
// area) else 0.
const BOUND_STRIDE = 11;
const BOUND_NORMAL = 6;
const BOUND_OFFSET = 9;
const BOUND_HAS_PLANE = 10;

function flattenPolyline(points: readonly WorkspaceVec3[]): ElementList {
  const count = Math.max(0, points.length - 1);
  const coordinates = new Float64Array(count * 6);
  for (let index = 0; index < count; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    coordinates.set(start, index * 6);
    coordinates.set(end, index * 6 + 3);
  }
  return withBounds({ count, coordinates, points: 2 });
}

function flattenTriangles(triangles: readonly MeasuredTriangle[]): ElementList {
  const coordinates = new Float64Array(triangles.length * 9);
  triangles.forEach((triangle, index) => {
    coordinates.set(triangle.first, index * 9);
    coordinates.set(triangle.second, index * 9 + 3);
    coordinates.set(triangle.third, index * 9 + 6);
  });
  return withBounds({ count: triangles.length, coordinates, points: 3 });
}

function withBounds(list: Omit<ElementList, "bounds">): ElementList {
  const { count, coordinates, points } = list;
  const bounds = new Float64Array(count * BOUND_STRIDE);
  const stride = points * 3;
  for (let index = 0; index < count; index += 1) {
    const at = index * stride;
    const bound = index * BOUND_STRIDE;
    for (let axis = 0; axis < 3; axis += 1) {
      let minimum = coordinates[at + axis]!;
      let maximum = minimum;
      for (let point = 1; point < points; point += 1) {
        minimum = Math.min(minimum, coordinates[at + point * 3 + axis]!);
        maximum = Math.max(maximum, coordinates[at + point * 3 + axis]!);
      }
      bounds[bound + axis] = minimum;
      bounds[bound + 3 + axis] = maximum;
    }
    if (points === 3) {
      const abx = coordinates[at + 3]! - coordinates[at]!;
      const aby = coordinates[at + 4]! - coordinates[at + 1]!;
      const abz = coordinates[at + 5]! - coordinates[at + 2]!;
      const acx = coordinates[at + 6]! - coordinates[at]!;
      const acy = coordinates[at + 7]! - coordinates[at + 1]!;
      const acz = coordinates[at + 8]! - coordinates[at + 2]!;
      const cx = aby * acz - abz * acy;
      const cy = abz * acx - abx * acz;
      const cz = abx * acy - aby * acx;
      const length = Math.hypot(cx, cy, cz);
      if (length > DISTANCE_EPSILON) {
        const inverseLength = 1 / length;
        const nx = cx * inverseLength;
        const ny = cy * inverseLength;
        const nz = cz * inverseLength;
        bounds[bound + BOUND_NORMAL] = nx;
        bounds[bound + BOUND_NORMAL + 1] = ny;
        bounds[bound + BOUND_NORMAL + 2] = nz;
        bounds[bound + BOUND_OFFSET] =
          nx * coordinates[at]! +
          ny * coordinates[at + 1]! +
          nz * coordinates[at + 2]!;
        bounds[bound + BOUND_HAS_PLANE] = 1;
      }
    }
  }
  return { ...list, bounds };
}

interface ElementChunk {
  /** Index of the chunk's first element. */
  offset: number;
  count: number;
  /** Box min x, y, z, max x, y, z. */
  box: Float64Array;
}

function chunkElements(list: ElementList): ElementChunk[] {
  const chunks: ElementChunk[] = [];
  for (let offset = 0; offset < list.count; offset += ELEMENT_CHUNK_SIZE) {
    const count = Math.min(ELEMENT_CHUNK_SIZE, list.count - offset);
    const box = new Float64Array(6);
    for (let axis = 0; axis < 3; axis += 1) {
      let minimum = Infinity;
      let maximum = -Infinity;
      for (let index = offset; index < offset + count; index += 1) {
        minimum = Math.min(minimum, list.bounds[index * BOUND_STRIDE + axis]!);
        maximum = Math.max(
          maximum,
          list.bounds[index * BOUND_STRIDE + 3 + axis]!,
        );
      }
      box[axis] = minimum;
      box[3 + axis] = maximum;
    }
    chunks.push({ offset, count, box });
  }
  return chunks;
}

/** No two points of the boxes (min x, y, z, max x, y, z at the offsets) are closer than this. */
function boxGap(
  first: Float64Array,
  firstAt: number,
  second: Float64Array,
  secondAt: number,
) {
  let sum = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const gap = Math.max(
      0,
      second[secondAt + axis]! - first[firstAt + 3 + axis]!,
      first[firstAt + axis]! - second[secondAt + 3 + axis]!,
    );
    sum += gap * gap;
  }
  return Math.sqrt(sum);
}

/**
 * No point of element `index` of `list` is closer than this to the plane of
 * the bound at `planeAt` (0 when that element has none or straddles it).
 */
function planeGap(
  planeBounds: Float64Array,
  planeAt: number,
  list: ElementList,
  index: number,
) {
  if (planeBounds[planeAt + BOUND_HAS_PLANE] !== 1) return 0;
  const nx = planeBounds[planeAt + BOUND_NORMAL]!;
  const ny = planeBounds[planeAt + BOUND_NORMAL + 1]!;
  const nz = planeBounds[planeAt + BOUND_NORMAL + 2]!;
  const planeOffset = planeBounds[planeAt + BOUND_OFFSET]!;
  const coordinates = list.coordinates;
  const at = index * list.points * 3;
  let above = Infinity;
  let below = Infinity;
  for (let point = 0; point < list.points; point += 1) {
    const offset =
      nx * coordinates[at + point * 3]! +
      ny * coordinates[at + point * 3 + 1]! +
      nz * coordinates[at + point * 3 + 2]! -
      planeOffset;
    if (offset >= 0) above = Math.min(above, offset);
    else below = Math.min(below, -offset);
  }
  return above === Infinity ? below : below === Infinity ? above : 0;
}

/**
 * The element pair's distance when it is at most `bound`, with its closest
 * points in `pairWitness`; otherwise a value above `bound`: Infinity, or the
 * distance of one of the pair's candidates with that candidate's points.
 */
type PairKernel = (
  first: Float64Array,
  firstAt: number,
  second: Float64Array,
  secondAt: number,
  bound: number,
) => number;

/** Start x, y, z and end x, y, z of the last kernel result. */
const pairWitness = new Float64Array(6);

function closestElementPair(
  first: ElementList,
  second: ElementList,
  measure: PairKernel,
): ClosestElementPair | null {
  const firstChunks = chunkElements(first);
  const secondChunks = chunkElements(second);
  const chunkPairs = firstChunks
    .flatMap((firstChunk) =>
      secondChunks.map((secondChunk) => ({
        firstChunk,
        secondChunk,
        gap: boxGap(firstChunk.box, 0, secondChunk.box, 0),
      })),
    )
    .sort((left, right) => left.gap - right.gap);
  const firstStride = first.points * 3;
  const secondStride = second.points * 3;
  const firstBounds = first.bounds;
  const secondBounds = second.bounds;
  const columns = new Int32Array(ELEMENT_CHUNK_SIZE);
  let found = false;
  let bestDistance = Infinity;
  let bestFirst = -1;
  let bestSecond = -1;
  const best = new Float64Array(6);
  /** Pairs whose distance is certainly above this cannot be the result. */
  let pruneDistance = Infinity;
  for (const { firstChunk, secondChunk, gap } of chunkPairs) {
    if (found && gap - PRUNE_SLACK > pruneDistance) break;
    // Elements whose boxes are already too far from the other chunk's box.
    let columnCount = 0;
    for (let offset = 0; offset < secondChunk.count; offset += 1) {
      const index = secondChunk.offset + offset;
      if (
        !found ||
        !(
          boxGap(firstChunk.box, 0, secondBounds, index * BOUND_STRIDE) -
            PRUNE_SLACK >
          pruneDistance
        )
      )
        columns[columnCount++] = index;
    }
    for (
      let firstIndex = firstChunk.offset;
      firstIndex < firstChunk.offset + firstChunk.count;
      firstIndex += 1
    ) {
      const firstAt = firstIndex * BOUND_STRIDE;
      if (
        found &&
        boxGap(firstBounds, firstAt, secondChunk.box, 0) - PRUNE_SLACK >
          pruneDistance
      )
        continue;
      for (let column = 0; column < columnCount; column += 1) {
        const secondIndex = columns[column]!;
        const secondAt = secondIndex * BOUND_STRIDE;
        if (found) {
          if (
            boxGap(firstBounds, firstAt, secondBounds, secondAt) - PRUNE_SLACK >
              pruneDistance ||
            planeGap(firstBounds, firstAt, second, secondIndex) - PRUNE_SLACK >
              pruneDistance ||
            planeGap(secondBounds, secondAt, first, firstIndex) - PRUNE_SLACK >
              pruneDistance
          )
            continue;
        }
        work.measuredPairs += 1;
        const distance = measure(
          first.coordinates,
          firstIndex * firstStride,
          second.coordinates,
          secondIndex * secondStride,
          pruneDistance,
        );
        if (
          !found ||
          distance < bestDistance ||
          (distance === bestDistance &&
            (firstIndex < bestFirst ||
              (firstIndex === bestFirst && secondIndex < bestSecond)))
        ) {
          found = true;
          bestDistance = distance;
          // Never below 0, so a touching pair is still found after a pair
          // within the tolerance; an exact contact ends the search.
          pruneDistance =
            distance === 0 ? -Infinity : Math.max(0, distance - TIE_TOLERANCE);
          bestFirst = firstIndex;
          bestSecond = secondIndex;
          best.set(pairWitness);
        }
      }
    }
  }
  return found
    ? {
        distance: bestDistance,
        start: [best[0]!, best[1]!, best[2]!],
        end: [best[3]!, best[4]!, best[5]!],
      }
    : null;
}

/*
 * The kernel. Each function below is the scalar form of the vector
 * closest-point helpers the measure readout used before (subtract, dot,
 * cross, add, scale, clamp and Math.hypot in the same operation order; the
 * spec keeps them as its oracle), so every distance and point is
 * bit-identical to theirs. Candidates are reduced with strict `<` in the old
 * order. A candidate known to exceed `bound` (or the reduction's best) may
 * stand in as Infinity: it could not have been chosen, and a reduction whose
 * every candidate exceeds `bound` is above `bound` either way.
 */

/** Output of closestPointOnTriangle / closestPointOnSegment. */
const closestPoint = new Float64Array(3);
/** Output of closestPointsBetweenSegments: start x, y, z, end x, y, z. */
const segmentPoints = new Float64Array(6);
/** Best candidate of one segment–triangle reduction: start, end. */
const groupPoints = new Float64Array(6);

function skipBoundSquared(bound: number) {
  return bound > MIN_SKIP_BOUND && bound !== Infinity
    ? bound * bound * SQUARED_SKIP_MARGIN
    : Infinity;
}

/** distanceBetween(start, end), or Infinity when certainly above √`skip`. */
function candidateDistance(dx: number, dy: number, dz: number, skip: number) {
  if (dx * dx + dy * dy + dz * dz > skip) return Infinity;
  return Math.hypot(dx, dy, dz);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

const measureSegmentPair: PairKernel = (
  first,
  firstAt,
  second,
  secondAt,
  bound,
) => {
  closestPointsBetweenSegments(
    first[firstAt]!,
    first[firstAt + 1]!,
    first[firstAt + 2]!,
    first[firstAt + 3]!,
    first[firstAt + 4]!,
    first[firstAt + 5]!,
    second[secondAt]!,
    second[secondAt + 1]!,
    second[secondAt + 2]!,
    second[secondAt + 3]!,
    second[secondAt + 4]!,
    second[secondAt + 5]!,
  );
  pairWitness.set(segmentPoints);
  return candidateDistance(
    segmentPoints[3]! - segmentPoints[0]!,
    segmentPoints[4]! - segmentPoints[1]!,
    segmentPoints[5]! - segmentPoints[2]!,
    skipBoundSquared(bound),
  );
};

const measureSegmentTrianglePair: PairKernel = (
  segment,
  segmentAt,
  triangle,
  triangleAt,
  bound,
) => {
  const distance = segmentTriangleCandidate(
    segment[segmentAt]!,
    segment[segmentAt + 1]!,
    segment[segmentAt + 2]!,
    segment[segmentAt + 3]!,
    segment[segmentAt + 4]!,
    segment[segmentAt + 5]!,
    triangle,
    triangleAt,
    bound,
  );
  pairWitness.set(groupPoints);
  return distance;
};

/**
 * closestPointsBetweenTriangles: each edge of `first` against `second`,
 * then each edge of `second` against `first` (its points reversed).
 */
const measureTrianglePair: PairKernel = (
  first,
  firstAt,
  second,
  secondAt,
  bound,
) => {
  let best = NaN;
  for (let group = 0; group < 6; group += 1) {
    const reversed = group >= 3;
    const edgeOwner = reversed ? second : first;
    const edgeAt = reversed ? secondAt : firstAt;
    const start = edgeAt + (group % 3) * 3;
    const end = edgeAt + ((group + 1) % 3) * 3;
    const groupBound = group > 0 && best < bound ? best : bound;
    const distance = segmentTriangleCandidate(
      edgeOwner[start]!,
      edgeOwner[start + 1]!,
      edgeOwner[start + 2]!,
      edgeOwner[end]!,
      edgeOwner[end + 1]!,
      edgeOwner[end + 2]!,
      reversed ? first : second,
      reversed ? firstAt : secondAt,
      groupBound,
    );
    if (group === 0 || distance < best) {
      best = distance;
      for (let axis = 0; axis < 3; axis += 1) {
        pairWitness[axis] = groupPoints[reversed ? axis + 3 : axis]!;
        pairWitness[axis + 3] = groupPoints[reversed ? axis : axis + 3]!;
      }
    }
  }
  return best;
};

/**
 * closestPointsBetweenSegmentAndTriangle: 0 at an intersection, else the
 * least of the endpoints' closest triangle points and the segment's closest
 * points to each triangle edge. Leaves its points in `groupPoints`.
 */
function segmentTriangleCandidate(
  sx: number,
  sy: number,
  sz: number,
  ex: number,
  ey: number,
  ez: number,
  triangle: Float64Array,
  at: number,
  bound: number,
) {
  if (intersectSegmentTriangle(sx, sy, sz, ex, ey, ez, triangle, at)) {
    groupPoints[0] = groupPoints[3] = closestPoint[0]!;
    groupPoints[1] = groupPoints[4] = closestPoint[1]!;
    groupPoints[2] = groupPoints[5] = closestPoint[2]!;
    return 0;
  }

  const ax = triangle[at]!;
  const ay = triangle[at + 1]!;
  const az = triangle[at + 2]!;
  const bx = triangle[at + 3]!;
  const by = triangle[at + 4]!;
  const bz = triangle[at + 5]!;
  const cx = triangle[at + 6]!;
  const cy = triangle[at + 7]!;
  const cz = triangle[at + 8]!;

  let skip = skipBoundSquared(bound);
  closestPointOnTriangle(sx, sy, sz, ax, ay, az, bx, by, bz, cx, cy, cz);
  let best = candidateDistance(
    closestPoint[0]! - sx,
    closestPoint[1]! - sy,
    closestPoint[2]! - sz,
    skip,
  );
  groupPoints[0] = sx;
  groupPoints[1] = sy;
  groupPoints[2] = sz;
  groupPoints.set(closestPoint, 3);
  if (best < bound) skip = skipBoundSquared(best);

  closestPointOnTriangle(ex, ey, ez, ax, ay, az, bx, by, bz, cx, cy, cz);
  const endDistance = candidateDistance(
    closestPoint[0]! - ex,
    closestPoint[1]! - ey,
    closestPoint[2]! - ez,
    skip,
  );
  if (endDistance < best) {
    best = endDistance;
    groupPoints[0] = ex;
    groupPoints[1] = ey;
    groupPoints[2] = ez;
    groupPoints.set(closestPoint, 3);
    if (best < bound) skip = skipBoundSquared(best);
  }

  for (let edge = 0; edge < 3; edge += 1) {
    const from = at + edge * 3;
    const to = at + ((edge + 1) % 3) * 3;
    closestPointsBetweenSegments(
      sx,
      sy,
      sz,
      ex,
      ey,
      ez,
      triangle[from]!,
      triangle[from + 1]!,
      triangle[from + 2]!,
      triangle[to]!,
      triangle[to + 1]!,
      triangle[to + 2]!,
    );
    const distance = candidateDistance(
      segmentPoints[3]! - segmentPoints[0]!,
      segmentPoints[4]! - segmentPoints[1]!,
      segmentPoints[5]! - segmentPoints[2]!,
      skip,
    );
    if (distance < best) {
      best = distance;
      groupPoints.set(segmentPoints);
      if (best < bound) skip = skipBoundSquared(best);
    }
  }
  return best;
}

/** Möller–Trumbore; the hit point goes to `closestPoint`. */
function intersectSegmentTriangle(
  sx: number,
  sy: number,
  sz: number,
  ex: number,
  ey: number,
  ez: number,
  triangle: Float64Array,
  at: number,
) {
  const dx = ex - sx;
  const dy = ey - sy;
  const dz = ez - sz;
  const ax = triangle[at]!;
  const ay = triangle[at + 1]!;
  const az = triangle[at + 2]!;
  const e1x = triangle[at + 3]! - ax;
  const e1y = triangle[at + 4]! - ay;
  const e1z = triangle[at + 5]! - az;
  const e2x = triangle[at + 6]! - ax;
  const e2y = triangle[at + 7]! - ay;
  const e2z = triangle[at + 8]! - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const determinant = e1x * px + e1y * py + e1z * pz;

  if (Math.abs(determinant) <= DISTANCE_EPSILON) return false;

  const inverseDeterminant = 1 / determinant;
  const tx = sx - ax;
  const ty = sy - ay;
  const tz = sz - az;
  const u = (tx * px + ty * py + tz * pz) * inverseDeterminant;

  if (u < 0 || u > 1) return false;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inverseDeterminant;

  if (v < 0 || u + v > 1) return false;

  const t = (e2x * qx + e2y * qy + e2z * qz) * inverseDeterminant;

  if (t < 0 || t > 1) return false;

  closestPoint[0] = sx + dx * t;
  closestPoint[1] = sy + dy * t;
  closestPoint[2] = sz + dz * t;
  return true;
}

/** Ericson's closest point on triangle abc to p, into `closestPoint`. */
function closestPointOnTriangle(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;

  if (d1 <= 0 && d2 <= 0) return setClosestPoint(ax, ay, az);

  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return setClosestPoint(bx, by, bz);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return setClosestPoint(ax + abx * v, ay + aby * v, az + abz * v);
  }

  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return setClosestPoint(cx, cy, cz);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return setClosestPoint(ax + acx * w, ay + acy * w, az + acz * w);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return setClosestPoint(
      bx + (cx - bx) * w,
      by + (cy - by) * w,
      bz + (cz - bz) * w,
    );
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return setClosestPoint(
    ax + (abx * v + acx * w),
    ay + (aby * v + acy * w),
    az + (abz * v + acz * w),
  );
}

function setClosestPoint(x: number, y: number, z: number) {
  closestPoint[0] = x;
  closestPoint[1] = y;
  closestPoint[2] = z;
}

/** Closest points of segments p1q1 and p2q2, into `segmentPoints`. */
function closestPointsBetweenSegments(
  p1x: number,
  p1y: number,
  p1z: number,
  q1x: number,
  q1y: number,
  q1z: number,
  p2x: number,
  p2y: number,
  p2z: number,
  q2x: number,
  q2y: number,
  q2z: number,
) {
  const d1x = q1x - p1x;
  const d1y = q1y - p1y;
  const d1z = q1z - p1z;
  const d2x = q2x - p2x;
  const d2y = q2y - p2y;
  const d2z = q2z - p2z;
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let firstT = 0;
  let secondT = 0;

  if (a <= DISTANCE_EPSILON && e <= DISTANCE_EPSILON) {
    setSegmentPoints(p1x, p1y, p1z, p2x, p2y, p2z);
    return;
  }

  const b = d1x * d2x + d1y * d2y + d1z * d2z;
  const denominator = a * e - b * b;

  if (
    a > DISTANCE_EPSILON &&
    e > DISTANCE_EPSILON &&
    Math.abs(denominator) <= DISTANCE_EPSILON * a * e
  ) {
    closestPointsBetweenParallelSegments(
      p1x,
      p1y,
      p1z,
      q1x,
      q1y,
      q1z,
      p2x,
      p2y,
      p2z,
      q2x,
      q2y,
      q2z,
    );
    return;
  }

  if (a <= DISTANCE_EPSILON) {
    secondT = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
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

  setSegmentPoints(
    p1x + d1x * firstT,
    p1y + d1y * firstT,
    p1z + d1z * firstT,
    p2x + d2x * secondT,
    p2y + d2y * secondT,
    p2z + d2z * secondT,
  );
}

function setSegmentPoints(
  sx: number,
  sy: number,
  sz: number,
  ex: number,
  ey: number,
  ez: number,
) {
  segmentPoints[0] = sx;
  segmentPoints[1] = sy;
  segmentPoints[2] = sz;
  segmentPoints[3] = ex;
  segmentPoints[4] = ey;
  segmentPoints[5] = ez;
}

function closestPointsBetweenParallelSegments(
  p1x: number,
  p1y: number,
  p1z: number,
  q1x: number,
  q1y: number,
  q1z: number,
  p2x: number,
  p2y: number,
  p2z: number,
  q2x: number,
  q2y: number,
  q2z: number,
) {
  const dx = q1x - p1x;
  const dy = q1y - p1y;
  const dz = q1z - p1z;
  const firstLength = Math.hypot(dx, dy, dz);

  if (firstLength <= DISTANCE_EPSILON) {
    closestPointOnSegment(p1x, p1y, p1z, p2x, p2y, p2z, q2x, q2y, q2z);
    setSegmentPoints(
      p1x,
      p1y,
      p1z,
      closestPoint[0]!,
      closestPoint[1]!,
      closestPoint[2]!,
    );
    return;
  }

  const inverseLength = 1 / firstLength;
  const axisX = dx * inverseLength;
  const axisY = dy * inverseLength;
  const axisZ = dz * inverseLength;
  const secondStartProjection =
    (p2x - p1x) * axisX + (p2y - p1y) * axisY + (p2z - p1z) * axisZ;
  const secondEndProjection =
    (q2x - p1x) * axisX + (q2y - p1y) * axisY + (q2z - p1z) * axisZ;
  const secondMinimum = Math.min(secondStartProjection, secondEndProjection);
  const secondMaximum = Math.max(secondStartProjection, secondEndProjection);
  const overlapStart = Math.max(0, secondMinimum);
  const overlapEnd = Math.min(firstLength, secondMaximum);

  if (overlapStart <= overlapEnd + DISTANCE_EPSILON) {
    const along = clamp((overlapStart + overlapEnd) / 2, 0, firstLength);
    const anchorX = p1x + axisX * along;
    const anchorY = p1y + axisY * along;
    const anchorZ = p1z + axisZ * along;
    closestPointOnSegment(
      anchorX,
      anchorY,
      anchorZ,
      p1x,
      p1y,
      p1z,
      q1x,
      q1y,
      q1z,
    );
    const sx = closestPoint[0]!;
    const sy = closestPoint[1]!;
    const sz = closestPoint[2]!;
    closestPointOnSegment(
      anchorX,
      anchorY,
      anchorZ,
      p2x,
      p2y,
      p2z,
      q2x,
      q2y,
      q2z,
    );
    setSegmentPoints(
      sx,
      sy,
      sz,
      closestPoint[0]!,
      closestPoint[1]!,
      closestPoint[2]!,
    );
    return;
  }

  // The four endpoint-to-segment candidates, the first least distance wins.
  closestPointOnSegment(p1x, p1y, p1z, p2x, p2y, p2z, q2x, q2y, q2z);
  setSegmentPoints(
    p1x,
    p1y,
    p1z,
    closestPoint[0]!,
    closestPoint[1]!,
    closestPoint[2]!,
  );
  let best = Math.hypot(
    segmentPoints[3]! - p1x,
    segmentPoints[4]! - p1y,
    segmentPoints[5]! - p1z,
  );
  closestPointOnSegment(q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z);
  let distance = Math.hypot(
    closestPoint[0]! - q1x,
    closestPoint[1]! - q1y,
    closestPoint[2]! - q1z,
  );
  if (distance < best) {
    best = distance;
    setSegmentPoints(
      q1x,
      q1y,
      q1z,
      closestPoint[0]!,
      closestPoint[1]!,
      closestPoint[2]!,
    );
  }
  closestPointOnSegment(p2x, p2y, p2z, p1x, p1y, p1z, q1x, q1y, q1z);
  distance = Math.hypot(
    p2x - closestPoint[0]!,
    p2y - closestPoint[1]!,
    p2z - closestPoint[2]!,
  );
  if (distance < best) {
    best = distance;
    setSegmentPoints(
      closestPoint[0]!,
      closestPoint[1]!,
      closestPoint[2]!,
      p2x,
      p2y,
      p2z,
    );
  }
  closestPointOnSegment(q2x, q2y, q2z, p1x, p1y, p1z, q1x, q1y, q1z);
  distance = Math.hypot(
    q2x - closestPoint[0]!,
    q2y - closestPoint[1]!,
    q2z - closestPoint[2]!,
  );
  if (distance < best) {
    setSegmentPoints(
      closestPoint[0]!,
      closestPoint[1]!,
      closestPoint[2]!,
      q2x,
      q2y,
      q2z,
    );
  }
}

/** Closest point on segment se to p, into `closestPoint`. */
function closestPointOnSegment(
  px: number,
  py: number,
  pz: number,
  sx: number,
  sy: number,
  sz: number,
  ex: number,
  ey: number,
  ez: number,
) {
  const dx = ex - sx;
  const dy = ey - sy;
  const dz = ez - sz;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared <= DISTANCE_EPSILON) return setClosestPoint(sx, sy, sz);

  const t = clamp(
    ((px - sx) * dx + (py - sy) * dy + (pz - sz) * dz) / lengthSquared,
    0,
    1,
  );
  return setClosestPoint(sx + dx * t, sy + dy * t, sz + dz * t);
}
