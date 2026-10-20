import type {
  RegionBoundaryBranch,
  RegionBoundarySegmentRecord,
  RegionRecord,
} from "@/contracts/sketch/schema";

/**
 * Boundary provenance shared by native persisted profiles and the importer.
 * The historical v1 prefix is retained byte-for-byte for compatibility.
 */
export type RegionBoundaryIdentity =
  `import-region-boundary/v1:${string}`;

type Orientation = "forward" | "reverse";

function sourceKey(branch: RegionBoundaryBranch): string {
  const source = branch.source;
  const key =
    source.kind === "entity"
      ? `entity:${source.entityId}`
      : `projected:${source.reference.referenceId}:${source.reference.geometryId}`;
  return branch.spanId === "whole" ? key : `${key}:${branch.spanId}`;
}

function flip(orientation: Orientation): Orientation {
  return orientation === "forward" ? "reverse" : "forward";
}

function pieceCounts(
  regions: readonly RegionRecord[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const region of regions) {
    for (const loop of region.loops) {
      for (const segment of loop.segments) {
        const key = sourceKey(segment.branch);
        const count = segment.sourceSegmentOrdinal + 1;
        counts.set(key, Math.max(counts.get(key) ?? 0, count));
      }
    }
  }
  return counts;
}

function canonicalRotation(entries: readonly string[]): string {
  if (entries.length === 0) return "[]";
  const rotations = entries.map((_, start) =>
    JSON.stringify(
      entries.map((_, index) => entries[(start + index) % entries.length]!),
    ),
  );
  return rotations.sort()[0]!;
}

function segmentIdentity(input: {
  segment: RegionBoundarySegmentRecord;
  counts: ReadonlyMap<string, number>;
  reverseSourceOrientation: boolean;
  reverseTraversal: boolean;
}): string {
  const key = sourceKey(input.segment.branch);
  const pieceCount = input.counts.get(key) ?? 1;
  const ordinal = input.segment.sourceSegmentOrdinal;
  const sourceReversedOrdinal = input.reverseSourceOrientation
    ? pieceCount - 1 - ordinal
    : ordinal;
  const sourceDirection = input.segment.traversalDirection;
  const direction = input.reverseTraversal
    ? flip(sourceDirection)
    : sourceDirection;
  const coincident = (input.segment.coincidentBranches ?? [])
    .map(sourceKey)
    .sort();
  return JSON.stringify([key, sourceReversedOrdinal, direction, coincident]);
}

function loopIdentity(input: {
  loop: RegionRecord["loops"][number];
  counts: ReadonlyMap<string, number>;
  reverseSourceOrientation: boolean;
  reverseLoopTraversal: boolean;
}): string {
  const orderedSegments = input.reverseLoopTraversal
    ? [...input.loop.segments].reverse()
    : input.loop.segments;
  return JSON.stringify([
    input.loop.role,
    input.loop.isClosed,
    canonicalRotation(
      orderedSegments.map((segment) =>
        segmentIdentity({
          segment,
          counts: input.counts,
          reverseSourceOrientation: input.reverseSourceOrientation,
          reverseTraversal:
            input.reverseSourceOrientation !== input.reverseLoopTraversal,
        }),
      ),
    ),
  ]);
}

function regionRepresentation(
  region: RegionRecord,
  counts: ReadonlyMap<string, number>,
  reverseSourceOrientation: boolean,
  reverseLoopTraversal: boolean,
): string {
  return JSON.stringify(
    region.loops
      .map((loop) =>
        loopIdentity({
          loop,
          counts,
          reverseSourceOrientation,
          reverseLoopTraversal,
        }),
      )
      .sort(),
  );
}

/**
 * Derives canonical importer provenance using boundary records only. The four
 * representations account for a full source-orientation reversal and a loop
 * traversal reversal without changing durable RegionIds.
 */
export function deriveRegionBoundaryIdentity(
  region: RegionRecord,
  regionUniverse: readonly RegionRecord[],
): RegionBoundaryIdentity {
  const counts = pieceCounts(regionUniverse);
  const representations = [false, true].flatMap((reverseSourceOrientation) =>
    [false, true].map((reverseLoopTraversal) =>
      regionRepresentation(
        region,
        counts,
        reverseSourceOrientation,
        reverseLoopTraversal,
      ),
    ),
  );
  return `import-region-boundary/v1:${representations.sort()[0]!}`;
}

/** All closed live regions carrying the expected importer provenance. */
export function matchRegionsByBoundaryIdentity(
  regions: readonly RegionRecord[],
  expected: RegionBoundaryIdentity,
): RegionRecord[] {
  return regions.filter(
    (region) =>
      region.isClosed &&
      deriveRegionBoundaryIdentity(region, regions) === expected,
  );
}

/** Resolves only one closed live region with the expected importer provenance. */
export function resolveRegionByBoundaryIdentity(
  regions: readonly RegionRecord[],
  expected: RegionBoundaryIdentity,
): RegionRecord | null {
  const matches = matchRegionsByBoundaryIdentity(regions, expected);
  return matches.length === 1 ? matches[0]! : null;
}
