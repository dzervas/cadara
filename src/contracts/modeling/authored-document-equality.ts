import type {
  AuthoredBodyLabelRecord,
  AuthoredModelDocument,
} from "@/contracts/modeling/authored-document";
import type { AuthoredBodyAppearanceRecord } from "@/contracts/modeling/body-appearance";
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

function serializeCertifiedContent(document: AuthoredModelDocument) {
  return JSON.stringify(stableJsonValue(certifiedContent(document)));
}

export function authoredModelDocumentsEqual(
  left: AuthoredModelDocument,
  right: AuthoredModelDocument,
) {
  return serializeCertifiedContent(left) === serializeCertifiedContent(right);
}

/**
 * The document fields a kernel changes in place without re-running any
 * feature (cadara-xkg): `revisionId` is identity, not content, and body
 * labels and colours have their own runtime operations. Every other field,
 * including feature and sketch labels and the document name, takes a full
 * restore. Adding a field here also needs its per-record diff below and its
 * in-place apply in the modeling service.
 */
const KERNEL_FREE_AUTHORED_FIELDS = [
  "revisionId",
  "bodyLabels",
  "bodyAppearances",
] as const satisfies readonly (keyof AuthoredModelDocument)[];

export type AuthoredModelDocumentChange =
  /** Only `revisionId` differs, if anything. */
  | { kind: "sameContent" }
  /** Only labels or colours of the same bodies, in the same order, differ;
   * the records are `next`'s changed ones. */
  | {
      kind: "bodyMetadata";
      bodyLabels: AuthoredBodyLabelRecord[];
      bodyAppearances: AuthoredBodyAppearanceRecord[];
    }
  /** Anything else differs, so `next` needs a full restore. */
  | { kind: "authored" };

/** The content a kernel rebuild depends on. Repositories store sketches and
 * features as keyed records, so their array order is not authored: a kernel
 * replays features in `featureOrder` and sketches in `historyOrder` (which
 * lists every sketch it holds), both still compared as exact sequences. */
function kernelContent(document: AuthoredModelDocument) {
  const content: Partial<AuthoredModelDocument> = {
    ...document,
    sketches: byKey(document.sketches, "sketchId"),
    features: byKey(document.features, "featureId"),
  };
  for (const field of KERNEL_FREE_AUTHORED_FIELDS) delete content[field];
  return content as AuthoredModelDocument;
}

/** `next`'s records whose value differs from `current`'s record for the same
 * body, or null when the two lists do not hold the same bodies in the same
 * order (body order seeds automatic colours, so it is not metadata). */
function changedBodyRecords<T extends { bodyId: string }>(
  current: readonly T[],
  next: readonly T[],
) {
  if (
    current.length !== next.length ||
    current.some((record, index) => record.bodyId !== next[index]!.bodyId)
  ) {
    return null;
  }
  return next.filter(
    (record, index) =>
      JSON.stringify(stableJsonValue(record)) !==
      JSON.stringify(stableJsonValue(current[index])),
  );
}

/** Classifies how `next` differs from `current` (cadara-xkg): Undo/Redo of a
 * body rename or recolour must not rebuild the model. */
export function classifyAuthoredModelDocumentChange(
  current: AuthoredModelDocument,
  next: AuthoredModelDocument,
): AuthoredModelDocumentChange {
  if (
    serializeCertifiedContent(kernelContent(current)) !==
    serializeCertifiedContent(kernelContent(next))
  ) {
    return { kind: "authored" };
  }
  const bodyLabels = changedBodyRecords(current.bodyLabels, next.bodyLabels);
  // A document saved before body colours has none; restoring it assigns
  // automatic ones, which no single-body operation reproduces.
  const bodyAppearances =
    current.bodyAppearances && next.bodyAppearances
      ? changedBodyRecords(current.bodyAppearances, next.bodyAppearances)
      : current.bodyAppearances === next.bodyAppearances
        ? []
        : null;
  if (!bodyLabels || !bodyAppearances) return { kind: "authored" };
  return bodyLabels.length === 0 && bodyAppearances.length === 0
    ? { kind: "sameContent" }
    : { kind: "bodyMetadata", bodyLabels, bodyAppearances };
}
