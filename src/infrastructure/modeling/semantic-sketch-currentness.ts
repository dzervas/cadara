import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { RevisionId } from "@/contracts/shared/ids";
import { isUnevaluatedMetadataOnlySketch, sketchProfileGateFailures } from "@/contracts/sketch/derived-validity";
import { regionBoundaryBasisOfRecord, resolveRegionBoundaryCurve } from "@/contracts/sketch/region-boundary-curves";

/** A bodyless document still owes current published sketch geometry after rebuild. */
export function semanticSketchesCurrent(snapshot: WorkspaceSnapshot | null | undefined, revisionId: RevisionId): boolean {
  return !!snapshot && snapshot.document.revisionId === revisionId && snapshot.document.sketches.every(({ sketch }) => {
    const definition = sketch.definition;
    // Empty/image-only metadata has no curve obligation, as in sketch publication.
    const metadataOnly = isUnevaluatedMetadataOnlySketch(definition, sketch.solvedSnapshot);
    const basis = regionBoundaryBasisOfRecord(sketch);
    return (sketch.derivedValidity.state === "current" || metadataOnly) &&
      sketchProfileGateFailures(sketch.solvedSnapshot).length === 0 &&
      sketch.regions.every(region => region.loops.every(loop => loop.segments.every(segment =>
        resolveRegionBoundaryCurve(basis, segment).kind !== "failed")));
  });
}
