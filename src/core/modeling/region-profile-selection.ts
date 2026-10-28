import type {
  ExtrudeProfileRef,
  FeatureDefinition,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type {
  RegionRecord,
  SketchPoint2D,
  SketchRecord,
} from "@/contracts/sketch/schema";
import { deriveRegionBoundaryIdentity } from "@/contracts/sketch/region-boundary-identity";
import { resolveRegionProfile } from "@/contracts/sketch/region-selector";

/**
 * Exact circle-center or line-loop scanline witness. Other curved/projected boundaries deliberately
 * remain ID-only until an interior witness can be certified without sampling.
 */
export function regionInteriorPoint(
  sketch: SketchRecord,
  region: RegionRecord,
): SketchPoint2D | null {
  if (region.loops.length === 1 && region.loops[0]!.segments.length === 1) {
    const source = region.loops[0]!.segments[0]!.branch.source;
    const entity =
      source.kind === "entity"
        ? sketch.definition.entities.find((e) => e.entityId === source.entityId)
        : null;
    if (entity?.kind === "circle") {
      return (
        sketch.solvedSnapshot.solvedPoints.find(
          (p) => p.pointId === entity.centerPointId,
        )?.solvedPosition ?? null
      );
    }
  }
  const edges: [SketchPoint2D, SketchPoint2D][] = [];
  for (const loop of region.loops) {
    for (const segment of loop.segments) {
      const source = segment.branch.source;
      const entity =
        source.kind === "entity"
          ? sketch.definition.entities.find(
              (e) => e.entityId === source.entityId,
            )
          : null;
      if (entity?.kind !== "lineSegment" || !segment.start || !segment.end)
        return null;
      edges.push([segment.start.position, segment.end.position]);
    }
  }
  const ys = [...new Set(edges.flatMap(([a, b]) => [a[1], b[1]]))].sort(
    (a, b) => a - b,
  );
  for (let index = 1; index < ys.length; index++) {
    const y = (ys[index - 1]! + ys[index]!) / 2;
    const xs = edges
      .flatMap(([a, b]) =>
        a[1] > y !== b[1] > y
          ? [a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])]
          : [],
      )
      .sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 2) {
      const x = (xs[i - 1]! + xs[i]!) / 2;
      if (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        x > xs[i - 1]! &&
        x < xs[i]!
      )
        return [x, y];
    }
  }
  return null;
}

export function enrichRegionProfile(
  ref: Extract<ExtrudeProfileRef, { kind: "region" }>,
  sketch: SketchRecord,
): typeof ref {
  const resolved = resolveRegionProfile(sketch, ref);
  if (!resolved.ok) return ref;
  // Preserve an existing selector; a resized boundary may no longer contain its
  // old witness, but the unique provenance proof is still authoritative.
  if (ref.selector) return ref;
  const point = regionInteriorPoint(sketch, resolved.region);
  return point
    ? {
        ...ref,
        selector: {
          kind: "interiorPoint",
          point,
          expectedBoundaryIdentity: deriveRegionBoundaryIdentity(
            resolved.region,
            sketch.regions.filter((r) => r.isClosed),
          ),
        },
      }
    : ref;
}

/**
 * Called for authored create/update mutations, and for the tail preview whose
 * evaluation a create adopts; never on read or rebuild.
 */
export function enrichExtrudeRegionProfiles(
  definition: FeatureDefinition,
  sketches: readonly SketchSnapshotRecord[],
): FeatureDefinition {
  if (definition.kind !== "extrude") return definition;
  const enrich = <
    T extends
      | ExtrudeProfileRef
      | import("@/contracts/modeling/schema").OpenSketchCurveProfileRef,
  >(
    ref: T,
  ): T => {
    if (ref.kind !== "region") return ref;
    const sketch = sketches.find((s) => s.sketchId === ref.sketchId);
    return (sketch ? enrichRegionProfile(ref, sketch.sketch) : ref) as T;
  };
  const parameters = definition.parameters;
  if (parameters.resultBodyType === "solid") {
    return {
      ...definition,
      parameters: {
        ...parameters,
        profiles: [
          enrich(parameters.profiles[0]),
          ...parameters.profiles.slice(1).map(enrich),
        ],
      },
    };
  }
  return {
    ...definition,
    parameters: {
      ...parameters,
      profiles: [
        enrich(parameters.profiles[0]),
        ...parameters.profiles.slice(1).map(enrich),
      ],
    },
  };
}
