import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import type {
  DeriveSketchRegionsRequest,
  DeriveSketchRegionsResponse,
  SolveSketchRequest,
  SolveSketchResponse,
} from "@/contracts/solver/schema";
import type { RequestId } from "@/contracts/shared/ids";
import {
  applyOffsetPublications,
  carriedOffsetPlans,
  closeOffsetReplanRound,
  offsetPublicationDiagnostics,
  offsetReplanHints,
} from "@/contracts/sketch/offset-publication";

/**
 * One solve + publish + regions round of a kernel commit/restore ([TECH]
 * G1/G3/G17). The derive request is the plain accepted pair; when any offset
 * relationship answers `planChanged`, the sketch is re-solved ONCE with the
 * certified hints (passed unchanged, origin `certified`) and derived again,
 * so a second disagreement fails closed in publish; any `planChanged` left
 * after the re-solve fails closed too (no third round). The returned solved
 * snapshot has the certified relationships' shells marked `certified` ([TECH]
 * G7) and carries its plans with origin `published` (review A1: a persisted
 * certifier hint must not outlive its one re-solve); publication failures
 * stay relationship-scoped (`offsetDiagnostics`), never in the snapshot
 * diagnostics ([TECH] G16).
 */
export async function solveAndDeriveSketchWithOffsets(
  adapter: Pick<SketchSolverAdapter, "solveSketch" | "deriveSketchRegions">,
  solveRequest: SolveSketchRequest,
  deriveRequest: Omit<DeriveSketchRegionsRequest, "solvedSnapshot">,
): Promise<{
  solved: SolveSketchResponse;
  regions: DeriveSketchRegionsResponse;
  offsetDiagnostics: DeriveSketchRegionsResponse["diagnostics"];
}> {
  let solved = await adapter.solveSketch(solveRequest);
  let regions = await adapter.deriveSketchRegions({
    ...deriveRequest,
    solvedSnapshot: solved.solvedSnapshot,
  });
  const hints = offsetReplanHints(regions.offsetPublications);
  if (hints) {
    solved = await adapter.solveSketch({
      ...solveRequest,
      requestId: `${solveRequest.requestId}:offset-replan` as RequestId,
      offsetPlans: hints,
    });
    regions = await adapter.deriveSketchRegions({
      ...deriveRequest,
      requestId: `${deriveRequest.requestId}:offset-replan` as RequestId,
      solvedSnapshot: solved.solvedSnapshot,
    });
    regions = {
      ...regions,
      offsetPublications: closeOffsetReplanRound(
        solveRequest.definition,
        regions.offsetPublications,
      ),
    };
  }
  const published = applyOffsetPublications(
    solveRequest.definition,
    solved.solvedSnapshot,
    regions.offsetPublications,
  );
  return {
    solved: {
      ...solved,
      solvedSnapshot: published.offsetFramePlans
        ? {
            ...published,
            offsetFramePlans: carriedOffsetPlans(published.offsetFramePlans),
          }
        : published,
    },
    regions,
    offsetDiagnostics: offsetPublicationDiagnostics(regions.offsetPublications),
  };
}
