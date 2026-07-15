import type { OnshapeFeatureTranslator } from "@/domain/import/onshape/feature-translator-registry";

const REGION_CONSUMING_FEATURES = new Set(["revolve", "sweep", "loft", "thicken"]);
const TOPOLOGY_DEPENDENT_FEATURES = new Set([
  "chamfer", "fillet", "shell", "cPlane", "transform", "splitPart", "split",
  "booleanBodies", "deleteBodies", "hole", "mirror",
]);

export const fallbackFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: [],
  plan: ({ feature, label, state }) => {
    const reason = REGION_CONSUMING_FEATURES.has(feature.featureType)
      ? "needs-region-resolution"
      : TOPOLOGY_DEPENDENT_FEATURES.has(feature.featureType)
        ? "needs-history-probe"
        : "custom-feature";
    state.bakedLineageFeatureIds.add(feature.featureId);
    return {
      onshapeFeatureId: feature.featureId,
      featureType: feature.featureType,
      label,
      tier: "baked",
      target: { kind: "bakedBody" },
      reasonCodes: [reason],
      suppressed: true,
      inputFeatureIds: [],
    };
  },
};

export const planeFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["defaultPlane", "cPlane"],
  plan: fallbackFeatureTranslator.plan,
  apply: ({ apply }) => apply(),
};
