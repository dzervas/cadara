import type { ModelingDiagnostic } from "@/contracts/modeling/schema";

/**
 * For the part-mode Diagnostics list and the feature inspector. T17e (review
 * R-3, specification "Minimum failure feedback"): user text only, never an id, address or
 * revision id: a broken reference names its owning feature by label, a
 * rebuild failure its affected features by label (`featureLabel`; an
 * unknown feature is not listed); revision and preview races have no
 * user detail (the message says what happened).
 */
export function formatUserDiagnosticDetail(
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
    case "advancedFeatureValidation":
      return detail.diagnostic.role
        ? `${detail.diagnostic.role}: ${detail.diagnostic.message}`
        : detail.diagnostic.message;
    default:
      return null;
  }
}
