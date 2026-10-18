import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { stableJsonValue } from "@/contracts/modeling/authored-document-serialization";
import type { DocumentId } from "@/contracts/shared/ids";

export function normalizeAuthoredDocumentId(
  document: AuthoredModelDocument,
  documentId: DocumentId,
): AuthoredModelDocument {
  return {
    ...document,
    documentId,
  };
}

function byKey<T, K extends keyof T>(records: readonly T[], key: K) {
  return [...records].sort((a, b) =>
    a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0,
  );
}

/** Topology lineage records, outputs and sources are keyed by `featureId`,
 * `outputSlot` and `sourceKey` (unique per the document contract) and
 * repositories store them as keyed records, so their array order carries no
 * meaning. Every other array, including targets, topology ids and witnesses,
 * remains an exact sequence. */
function certifiedContent(document: AuthoredModelDocument) {
  if (!document.topologyLineage) return document;
  return {
    ...document,
    topologyLineage: byKey(
      document.topologyLineage.map((lineage) => ({
        ...lineage,
        outputs: byKey(
          lineage.outputs.map((output) => ({
            ...output,
            sourceTargets: byKey(output.sourceTargets, "sourceKey"),
          })),
          "outputSlot",
        ),
      })),
      "featureId",
    ),
  };
}

export function authoredModelDocumentsEqual(
  left: AuthoredModelDocument,
  right: AuthoredModelDocument,
) {
  return (
    JSON.stringify(stableJsonValue(certifiedContent(left))) ===
    JSON.stringify(stableJsonValue(certifiedContent(right)))
  );
}
