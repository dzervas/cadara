import type { SemanticDiscovery } from "@/contracts/semantic/schema";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { deriveKernelTopologySignaturesFromExactBrepPayload } from "@/domain/modeling/occ/topology-signatures";

/** No display fallback: unavailable exact records are not a measurement certificate. */
export async function inspectSemanticModel(
  service: ModelingService,
  snapshot: WorkspaceSnapshot,
): Promise<NonNullable<SemanticDiscovery["model"]>> {
  const invalid = snapshot.document.diagnostics.some(
    (d) => d.severity === "error",
  );
  const bodies: NonNullable<SemanticDiscovery["model"]>["bodies"][number][] =
    [];
  for (const body of snapshot.document.bodies) {
    let bounds: NonNullable<
      SemanticDiscovery["model"]
    >["bodies"][number]["bounds"] = null;
    if (!invalid && body.topologyPresentation !== "bodyOnlyMesh") {
      const exact = await service.buildNativeExactBrepPayload({
        baseRevisionId: snapshot.document.revisionId,
        target: { kind: "body", bodyId: body.bodyId },
      });
      if (exact.kind === "nativeTopologyPayload") {
        const derived = deriveKernelTopologySignaturesFromExactBrepPayload(
          exact.payload,
        );
        const box =
          derived.status === "available"
            ? derived.signatures.find((s) => s.entityClass === "body")
                ?.boundingBox
            : undefined;
        if (box) bounds = { min: box.low, max: box.high };
      }
    }
    bodies.push({ bodyId: body.bodyId, kind: body.bodyKind, bounds });
  }
  return {
    constructions: snapshot.document.constructions.map(c => ({ constructionId: c.constructionId, ownerFeatureId: c.ownerFeatureId, frame: c.plane.frame })),
    cursor: snapshot.document.cursor,
    timeline: snapshot.document.featureTree.flatMap(row => row.target.kind === "sketch" || row.target.kind === "feature" ? [{ label: row.label, target: row.target }] : []),
    features: snapshot.document.features.map((f) => ({
      featureId: f.featureId,
      label: f.label,
      kind: f.definition.kind,
      suppressed: f.suppressed,
      producedTargets: f.producedTargets,
    })),
    bodies,
  };
}
