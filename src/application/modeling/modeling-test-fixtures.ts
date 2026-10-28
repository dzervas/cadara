import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredFeatureTopologyLineage,
  type AuthoredModelDocument,
} from "@/contracts/modeling/authored-document";
import type { EdgeId } from "@/contracts/shared/ids";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";

export async function createSeedDocumentSnapshot(
  documentId: WorkspaceSnapshot["document"]["documentId"] = "doc_workspace",
) {
  const adapter = new MockKernelAdapter();
  return (
    await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId,
    })
  ).snapshot;
}

export async function createSeedAuthoredModelDocument(
  documentId: AuthoredModelDocument["documentId"] = "doc_workspace",
) {
  return createAuthoredModelDocumentFromSnapshot(
    await createSeedDocumentSnapshot(documentId),
  );
}

/** Keyed topology lineage for `document`'s first two features and first body,
 * as a native rebuild exports it before and after a metadata-only mutation:
 * `rebuilt` replaces one revision-sensitive fallback source key and lists
 * features and sources in a different order; stable keys keep exact targets. */
export function createRebuiltTopologyLineage(document: AuthoredModelDocument): {
  original: AuthoredFeatureTopologyLineage[];
  rebuilt: AuthoredFeatureTopologyLineage[];
} {
  const [first, second] = document.featureOrder;
  const bodyId = document.bodyLabels[0]!.bodyId;
  const output = (sources: Array<[string, EdgeId]>) => ({
    outputSlot: bodyId,
    topologyToken: "token_stable",
    topology: {
      faceIds: [],
      edgeIds: sources.map(([, edgeId]) => edgeId),
      vertexIds: [],
    },
    sourceTargets: sources.map(([sourceKey, edgeId]) => ({
      sourceKey,
      targets: [{ kind: "edge" as const, bodyId, edgeId }],
    })),
    unsupportedSourceKeys: [],
  });
  return {
    original: [
      {
        featureId: first!,
        outputs: [
          output([
            ["source:a", "edge_stable_a"],
            ["source:fallback:t0012", "edge_fallback_t0012"],
            ["source:b", "edge_stable_b"],
          ]),
        ],
      },
      { featureId: second!, outputs: [] },
    ],
    rebuilt: [
      { featureId: second!, outputs: [] },
      {
        featureId: first!,
        outputs: [
          output([
            ["source:fallback:g9", "edge_fallback_g9"],
            ["source:a", "edge_stable_a"],
            ["source:b", "edge_stable_b"],
          ]),
        ],
      },
    ],
  };
}
