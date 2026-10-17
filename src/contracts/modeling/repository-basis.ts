import type { WorkspaceSnapshot } from "./schema";
import type { AuthoredModelDocument } from "./authored-document";

/** Correlate an exact stored transaction with the live snapshot representing it.
 * The service alone supplies the stored-to-live restore association. */
export function snapshotRepresentsRepositoryDocument(
  snapshot: WorkspaceSnapshot | null | undefined,
  applied: {
    document: AuthoredModelDocument;
    metadata: { heads: readonly string[] };
  },
): boolean {
  const provenance = snapshot?.provenance;
  return (
    !!snapshot &&
    !!provenance &&
    snapshot.document.documentId === applied.document.documentId &&
    (provenance.repositoryRevisionId ?? snapshot.document.revisionId) ===
      applied.document.revisionId &&
    provenance.repositoryHeads.length === applied.metadata.heads.length &&
    [...provenance.repositoryHeads]
      .sort()
      .every(
        (head, index) => head === [...applied.metadata.heads].sort()[index],
      )
  );
}
