import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { RevisionId } from "@/contracts/shared/ids";
import { sketchProfileGateFailures } from "@/contracts/sketch/derived-validity";
import { regionBoundaryBasisOfRecord, resolveRegionBoundaryCurve } from "@/contracts/sketch/region-boundary-curves";

/** A bodyless document still owes current published sketch geometry after rebuild. */
export function semanticSketchesCurrent(snapshot: WorkspaceSnapshot | null | undefined, revisionId: RevisionId): boolean {
  return !!snapshot && snapshot.document.revisionId === revisionId && snapshot.document.sketches.every(({ sketch }) => {
    const definition = sketch.definition;
    // Empty/image-only metadata has no curve obligation, as in sketch publication.
    const metadataOnly = definition.entities.length === 0 && definition.points.length === 0 &&
      definition.constraints.length === 0 && definition.dimensions.length === 0 &&
      definition.references.length === 0 && (definition.derivedRelationships?.length ?? 0) === 0 &&
      sketch.solvedSnapshot.status.solveState === "notEvaluated";
    const basis = regionBoundaryBasisOfRecord(sketch);
    return (sketch.derivedValidity.state === "current" || metadataOnly) &&
      sketchProfileGateFailures(sketch.solvedSnapshot).length === 0 &&
      sketch.regions.every(region => region.loops.every(loop => loop.segments.every(segment =>
        resolveRegionBoundaryCurve(basis, segment).kind !== "failed")));
  });
}
