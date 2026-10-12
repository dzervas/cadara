import { getPrimitiveRefLabel } from "@/core/editor/schema";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";

function formatCommonDiagnosticDetail(
  detail: NonNullable<ModelingDiagnostic["detail"]>,
): string | null {
  switch (detail.kind) {
    case "revisionConflict":
      return `Expected ${detail.expectedRevisionId}, current ${detail.actualRevisionId}`;
    case "stalePreview":
      return `Preview ${detail.previewId} used ${detail.requestedRevisionId}; current is ${detail.currentRevisionId}`;
    case "advancedFeatureValidation":
      return detail.diagnostic.role
        ? `${detail.diagnostic.role}: ${detail.diagnostic.message}`
        : detail.diagnostic.message;
    default:
      return null;
  }
}

/** For use in the feature inspector (shows broken ref reason). */
export function formatInspectorDiagnosticDetail(
  diagnostic: ModelingDiagnostic,
): string | null {
  const detail = diagnostic.detail;
  if (!detail) {
    return null;
  }

  if (detail.kind === "invalidReference") {
    return `Broken ref ${getPrimitiveRefLabel(detail.reference.target)}: ${detail.reference.reason}`;
  }

  if (detail.kind === "rebuildFailure") {
    return `Affected features: ${detail.affectedFeatureIds.join(", ") || "none"}`;
  }

  return formatCommonDiagnosticDetail(detail);
}

/**
 * For use in the part-mode Diagnostics list. T17e (review R-3, specification
 * "Minimum failure feedback"): user text only, never an id, address or
 * revision id: a broken reference names its owning feature by label, a
 * rebuild failure its affected features by label (`featureLabel`; an
 * unknown feature is not listed); revision and preview races have no
 * user detail (the message says what happened).
 */
export function formatSidebarDiagnosticDetail(
  diagnostic: ModelingDiagnostic,
  featureLabel: (featureId: string) => string | undefined,
): string | null {
  const detail = diagnostic.detail;
  if (!detail) {
    return null;
  }
  const named = (featureIds: readonly string[]) =>
    [...new Set(featureIds)].flatMap((featureId) => {
      const label = featureLabel(featureId);
      return label === undefined ? [] : [`‘${label}’`];
    });

  switch (detail.kind) {
    case "invalidReference": {
      const [owner] = named(
        detail.reference.ownerFeatureId
          ? [detail.reference.ownerFeatureId]
          : [],
      );
      return owner
        ? `A reference of ${owner} no longer resolves.`
        : "A reference no longer resolves.";
    }
    case "rebuildFailure": {
      const affected = named(detail.affectedFeatureIds);
      return affected.length > 0
        ? `Affected features: ${affected.join(", ")}`
        : null;
    }
    case "revisionConflict":
    case "stalePreview":
      return null;
    default:
      return formatCommonDiagnosticDetail(detail);
  }
}
