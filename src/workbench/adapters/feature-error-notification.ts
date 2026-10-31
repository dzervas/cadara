import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { DocumentId, FeatureId } from "@/contracts/shared/ids";

/**
 * A workbench status error that reports one feature's diagnostic (for
 * example "Fillet 1 edge selection is incorrect." after deleting the extrude
 * it was built on). Feature ids are numbered per document, so the tie names
 * its document too. `observed` records whether a document snapshot has shown
 * that error yet: the notification can arrive before its snapshot.
 */
export interface FeatureErrorNotificationTie {
  documentId: DocumentId;
  featureId: FeatureId;
  observed: boolean;
}

/**
 * Follows a feature-tied status error through document snapshots. Returns
 * the tie to keep (marked observed once the snapshot carries the feature's
 * error), or "outlived" once a snapshot after that no longer has an error
 * for the feature (it was deleted, the action that broke it was undone, or
 * it was repaired) or once the snapshot is of another document.
 */
export function followFeatureErrorNotification(
  tie: FeatureErrorNotificationTie,
  document: {
    documentId: DocumentId;
    diagnostics: readonly ModelingDiagnostic[];
  },
): FeatureErrorNotificationTie | "outlived" {
  if (document.documentId !== tie.documentId) return "outlived";

  const featureHasError = document.diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      diagnostic.featureId === tie.featureId,
  );

  if (featureHasError) {
    return tie.observed ? tie : { ...tie, observed: true };
  }

  return tie.observed ? "outlived" : tie;
}
