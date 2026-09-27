/**
 * Canonical topological region signatures and SHA-256 region identity
 * (T09 design §2.5 plus the U6 identity amendment).
 *
 * Standalone first (T09d): the record types live in `sketch-arrangement.ts`
 * until T09e moves them into `schema.ts`, cuts the arrangement owner over and
 * deletes `authored-region-slots.ts` and the old FNV region ids. This landing
 * is allowed only because T09e performs that cutover and deletion.
 *
 * Identity never uses coordinates or floating parameters. A signature is built
 * only from branch keys, vertex keys and traversal signs. Every key component
 * is JSON-encoded, so the encoding is injective for arbitrary id strings.
 */
import type { RegionId, SketchId } from "@/contracts/shared/ids";
import type {
  RegionBoundaryBranch,
  RegionBoundarySegmentRecord,
  RegionBoundaryVertex,
  RegionRecord,
} from "@/contracts/sketch/sketch-arrangement";

export function regionBranchKey(branch: RegionBoundaryBranch): string {
  const source =
    branch.source.kind === "entity"
      ? ["e", branch.source.entityId]
      : [
          "p",
          branch.source.reference.referenceId,
          branch.source.reference.geometryId,
        ];
  return JSON.stringify([...source, branch.spanId]);
}

/** Declared join class: every member key (point ids, projected point and knot keys), sorted. */
export function declaredJoinVertexKey(memberKeys: readonly string[]): string {
  return `j${JSON.stringify([...memberKeys].sort())}`;
}

/**
 * Pair event: `n` verified contacts of the pair outside its join balls, and
 * this event's rank along each branch. Branch keys are ordered (A < B).
 * Ranks are seam-free: along an open branch they follow its parameter; along a
 * full circle they are cyclic offsets from the event of rank 0 on the open
 * partner; for two circles both ranks come from the certified crossing
 * orientation (rank 0 where cross(A′, B′) > 0).
 */
export function intersectionVertexKey(
  firstBranchKey: string,
  secondBranchKey: string,
  contactCount: number,
  firstRank: number,
  secondRank: number,
): string {
  return firstBranchKey < secondBranchKey
    ? `x${JSON.stringify([firstBranchKey, secondBranchKey, contactCount, firstRank, secondRank])}`
    : `x${JSON.stringify([secondBranchKey, firstBranchKey, contactCount, secondRank, firstRank])}`;
}

export function selfIntersectionVertexKey(
  branchKey: string,
  index: number,
): string {
  return `s${JSON.stringify([branchKey, index])}`;
}

/**
 * End `end` of the `index`-th of `overlapCount` exact overlaps. `index` and
 * `end` are measured along the lower-key branch; the branch keys are ordered
 * (A < B) here, so the key does not depend on argument order.
 */
export function overlapEndVertexKey(
  firstBranchKey: string,
  secondBranchKey: string,
  overlapCount: number,
  index: number,
  end: "lo" | "hi",
): string {
  const [low, high] =
    firstBranchKey < secondBranchKey
      ? [firstBranchKey, secondBranchKey]
      : [secondBranchKey, firstBranchKey];
  return `o${JSON.stringify([low, high, overlapCount, index, end])}`;
}

/** The canonical key the owner computed for the vertex (it needs the family census). */
export function regionVertexKey(vertex: RegionBoundaryVertex): string {
  return vertex.key;
}

function segmentKey(
  branchKey: string,
  from: string | null,
  to: string | null,
  traversal: "forward" | "reverse",
) {
  const sign = traversal === "forward" ? "+" : "-";
  if (from === null || to === null)
    return `${branchKey}:${JSON.stringify(null)}${sign}`;
  // `from`/`to` are given in branch-forward order.
  return `${branchKey}:${JSON.stringify([from, to])}${sign}`;
}

/**
 * One loop as a cyclic key sequence. A vertex of arrangement degree 2 whose two
 * boundary segments continue on the same primary branch is not topologically
 * significant (a pruned stub, a pruned crossing, or the end of an exact overlap
 * that the boundary continues through): its segments collapse into one key.
 * A loop that collapses completely onto one branch is that closed branch.
 */
function loopKeys(
  segments: readonly RegionBoundarySegmentRecord[],
  vertexDegree: ReadonlyMap<string, number>,
): string[] {
  const noise = (index: number) => {
    const current = segments[index]!;
    const next = segments[(index + 1) % segments.length]!;
    return (
      current.end !== null &&
      vertexDegree.get(current.end.key) === 2 &&
      regionBranchKey(current.branch) === regionBranchKey(next.branch) &&
      current.traversalDirection === next.traversalDirection
    );
  };
  const count = segments.length;
  const significantEnds = segments
    .map((_, index) => index)
    .filter((index) => !noise(index));
  if (significantEnds.length === 0) {
    const first = segments[0]!;
    return [
      segmentKey(
        regionBranchKey(first.branch),
        null,
        null,
        first.traversalDirection,
      ),
    ];
  }
  return significantEnds.map((endIndex, runIndex) => {
    const previousEnd =
      significantEnds[
        (runIndex - 1 + significantEnds.length) % significantEnds.length
      ]!;
    const startIndex = (previousEnd + 1) % count;
    const first = segments[startIndex]!;
    const last = segments[endIndex]!;
    const startKey = first.start?.key ?? null;
    const endKey = last.end?.key ?? null;
    return first.traversalDirection === "forward"
      ? segmentKey(regionBranchKey(first.branch), startKey, endKey, "forward")
      : segmentKey(regionBranchKey(first.branch), endKey, startKey, "reverse");
  });
}

function compareKeyLists(left: readonly string[], right: readonly string[]) {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index]! < right[index]!) return -1;
    if (left[index]! > right[index]!) return 1;
  }
  return left.length - right.length;
}

function minimalRotation(keys: readonly string[]): string[] {
  let best = [...keys];
  for (let shift = 1; shift < keys.length; shift += 1) {
    const rotated = [...keys.slice(shift), ...keys.slice(0, shift)];
    if (compareKeyLists(rotated, best) < 0) best = rotated;
  }
  return best;
}

/**
 * Canonical signature of one region: `[outer, ...innerLoopsSorted]`, each loop
 * rotated to its lexicographic minimum. Orientation is fixed by the records
 * (outer counter-clockwise, inner clockwise). `vertexDegree` is the pruned
 * arrangement degree of every vertex key, which loop records alone do not carry.
 */
export function canonicalRegionSignature(
  region: Pick<RegionRecord, "loops">,
  vertexDegree: ReadonlyMap<string, number>,
): string {
  const loops = region.loops.map((loop) => ({
    role: loop.role,
    keys: minimalRotation(loopKeys(loop.segments, vertexDegree)),
  }));
  const outer = loops.filter((loop) => loop.role === "outer");
  const inner = loops
    .filter((loop) => loop.role === "inner")
    .map((loop) => loop.keys)
    .sort(compareKeyLists);
  return JSON.stringify([...outer.map((loop) => loop.keys), ...inner]);
}

/** `region_` + the first 128 bits of SHA-256 over the sketch id and signature. */
export async function createRegionId(
  sketchId: SketchId,
  signature: string,
): Promise<RegionId> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([sketchId, signature])),
  );
  const hex = [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `region_${hex}`;
}
