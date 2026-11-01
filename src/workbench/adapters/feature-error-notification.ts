import type {
  ModelingDiagnostic,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import type { DocumentId, FeatureId } from "@/contracts/shared/ids";

/**
 * A workbench status notification that reports features' errors (for
 * example "Fillet 1 edge selection is incorrect." after deleting the extrude
 * it was built on, or the warning that an accepted delete left Fillet 1
 * failing). Feature ids are numbered per document, so the tie names its
 * document too. `observed` records whether a document snapshot has shown
 * one of those errors yet: the notification can arrive before its snapshot.
 */
export interface FeatureErrorNotificationTie {
  documentId: DocumentId;
  featureIds: readonly FeatureId[];
  observed: boolean;
}

/**
 * Follows a feature-tied status notification through document snapshots.
 * Returns the tie to keep (marked observed once the snapshot carries an
 * error of a tied feature), or "outlived" once a snapshot after that has no
 * error for any of them (they were deleted, the action that broke them was
 * undone, or they were repaired) or once the snapshot is of another
 * document.
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
      diagnostic.featureId != null &&
      tie.featureIds.includes(diagnostic.featureId),
  );

  if (featureHasError) {
    return tie.observed ? tie : { ...tie, observed: true };
  }

  return tie.observed ? "outlived" : tie;
}

export interface NewlyFailingFeature {
  featureId: FeatureId;
  label: string;
  /** Its only errors say an earlier failure blocks it: it needs no repair of its own. */
  blockedOnly: boolean;
}

const DEPENDENCY_BLOCKED_CODE = "feature-dependency-blocked";

function featureErrorCodes(diagnostics: readonly ModelingDiagnostic[]) {
  const codes = new Map<FeatureId, string[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== "error" || diagnostic.featureId == null) continue;
    codes.set(diagnostic.featureId, [
      ...(codes.get(diagnostic.featureId) ?? []),
      diagnostic.code,
    ]);
  }
  return codes;
}

/**
 * The features an accepted edit left failing: an error in `after` on a
 * feature that had none `before`. A feature that was already failing is not
 * news; the timeline keeps showing it.
 */
export function findNewlyFailingFeatures(
  before: Pick<WorkspaceSnapshot["document"], "diagnostics"> | null,
  after: Pick<WorkspaceSnapshot["document"], "diagnostics" | "features">,
): NewlyFailingFeature[] {
  const failingBefore = featureErrorCodes(before?.diagnostics ?? []);
  const failingAfter = featureErrorCodes(after.diagnostics);
  return after.features.flatMap((feature) => {
    const codes = failingAfter.get(feature.featureId);
    return codes && !failingBefore.has(feature.featureId)
      ? [
          {
            featureId: feature.featureId,
            label: feature.label,
            blockedOnly: codes.every((code) => code === DEPENDENCY_BLOCKED_CODE),
          },
        ]
      : [];
  });
}

function joinLabels(labels: readonly string[]) {
  return labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * Announces an accepted edit: its success message as info, or, when it left
 * features failing, one warning that says so after the success message. The
 * warning names the features that need a repair, not those only blocked by
 * them (they are named only when nothing else is), and stays while any of
 * them fails.
 */
export function announceAcceptedDocumentMutation(input: {
  successMessage: string | null;
  newlyFailingFeatures: readonly NewlyFailingFeature[];
  showWorkbenchInfo: (message: string) => void;
  showWorkbenchWarning: (
    message: string,
    featureIds: readonly FeatureId[],
  ) => void;
}) {
  const { newlyFailingFeatures, successMessage } = input;
  if (newlyFailingFeatures.length === 0) {
    if (successMessage) input.showWorkbenchInfo(successMessage);
    return;
  }

  const broken = newlyFailingFeatures.filter((entry) => !entry.blockedOnly);
  const named = broken.length > 0 ? broken : newlyFailingFeatures;
  const labels = joinLabels(named.map((entry) => entry.label));
  const failure =
    named.length === 1
      ? `${labels} no longer rebuilds: repair it or undo.`
      : `${labels} no longer rebuild: repair them or undo.`;
  input.showWorkbenchWarning(
    successMessage ? `${successMessage} ${failure}` : failure,
    newlyFailingFeatures.map((entry) => entry.featureId),
  );
}
