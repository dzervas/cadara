import type {
  RegionBoundarySegmentRecord,
  RegionRecord,
} from "@/contracts/sketch/schema";

/**
 * Transient importer-only identity for a selected sketch region.
 *
 * Unlike `RegionId`, this is not persisted in a feature definition. It bridges
 * the importer verification sketch to the separately committed live sketch.
 */
export type ImportRegionBoundaryIdentity =
  `import-region-boundary/v1:${string}`;

type BoundarySource = RegionBoundarySegmentRecord["source"];

type Orientation = "forward" | "reverse";

function sourceKey(source: BoundarySource): string {
  return source.kind === "entity"
    ? `entity:${source.entityId}`
    : `projected:${source.reference.referenceId}:${source.reference.geometryId}`;
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
        const key = sourceKey(segment.source);
        const count = (segment.sourceSegmentOrdinal ?? 0) + 1;
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
  const key = sourceKey(input.segment.source);
  const pieceCount = input.counts.get(key) ?? 1;
  const ordinal = input.segment.sourceSegmentOrdinal ?? 0;
  const sourceReversedOrdinal = input.reverseSourceOrientation
    ? pieceCount - 1 - ordinal
    : ordinal;
  const sourceDirection = input.segment.traversalDirection ?? "forward";
  const direction = input.reverseTraversal
    ? flip(sourceDirection)
    : sourceDirection;
  const coincident = (input.segment.coincidentSources ?? [])
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
export function deriveImportRegionBoundaryIdentity(
  region: RegionRecord,
  regionUniverse: readonly RegionRecord[],
): ImportRegionBoundaryIdentity {
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
export function matchImportedRegionsByBoundaryIdentity(
  regions: readonly RegionRecord[],
  expected: ImportRegionBoundaryIdentity,
): RegionRecord[] {
  return regions.filter(
    (region) =>
      region.isClosed &&
      deriveImportRegionBoundaryIdentity(region, regions) === expected,
  );
}

/** Resolves only one closed live region with the expected importer provenance. */
export function resolveImportedRegionByBoundaryIdentity(
  regions: readonly RegionRecord[],
  expected: ImportRegionBoundaryIdentity,
): RegionRecord | null {
  const matches = matchImportedRegionsByBoundaryIdentity(regions, expected);
  return matches.length === 1 ? matches[0]! : null;
}
