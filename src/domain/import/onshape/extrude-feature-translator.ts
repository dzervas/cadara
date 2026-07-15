import {
  planExtrudeFeature,
  referencedSketchFeatureIds,
} from "@/domain/import/onshape/extrude-planner";
import type { OnshapeFeatureTranslator } from "@/domain/import/onshape/feature-translator-registry";

export const extrudeFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["extrude"],
  plan: ({ feature, label, onshapeSuppressed, read, state }) => {
    const inputFeatureIds = referencedSketchFeatureIds(feature);
    let dependsOnBakedLineage = inputFeatureIds.some((id) => state.bakedLineageFeatureIds.has(id));
    const referencedSketch = inputFeatureIds
      .map((id) => state.sketchPlansByFeatureId.get(id))
      .find((plan) => plan !== undefined);
    const solvedSketch = inputFeatureIds
      .map((id) => read.solvedSketchesByFeatureId.get(id))
      .find((solved) => solved !== undefined);
    const extrudePlan = planExtrudeFeature({
      feature,
      solvedSketch,
      referencedSketch,
      priorBodyProducingFeatureIds: state.bodyProducingFeatureIds,
    });

    if (extrudePlan.tier === "parametric") {
      if (extrudePlan.plannedExtrude.boolean.kind === "deferredBody") {
        const sourceFeatureId = extrudePlan.plannedExtrude.boolean.sourceFeatureId;
        inputFeatureIds.push(sourceFeatureId);
        dependsOnBakedLineage ||= state.bakedLineageFeatureIds.has(sourceFeatureId);
      }
      if (!dependsOnBakedLineage) {
        if (extrudePlan.plannedExtrude.boolean.kind === "standalone") {
          state.bodyProducingFeatureIds.push(feature.featureId);
        }
        return {
          onshapeFeatureId: feature.featureId,
          featureType: feature.featureType,
          label,
          tier: "parametric",
          target: { kind: "feature" },
          reasonCodes: [],
          suppressed: onshapeSuppressed,
          plannedExtrude: extrudePlan.plannedExtrude,
          inputFeatureIds,
        };
      }
    }

    const reason = extrudePlan.tier === "baked" ? extrudePlan.reason : "needs-region-resolution";
    if (isNewBodyExtrude(feature)) {
      state.bodyProducingFeatureIds.push(feature.featureId);
    }
    state.bakedLineageFeatureIds.add(feature.featureId);
    return {
      onshapeFeatureId: feature.featureId,
      featureType: feature.featureType,
      label,
      tier: "baked",
      target: { kind: dependsOnBakedLineage ? "suppressed" : "bakedBody" },
      reasonCodes: dependsOnBakedLineage
        ? extrudePlan.tier === "baked"
          ? [reason, "downstream-of-baked"]
          : ["downstream-of-baked"]
        : [reason],
      suppressed: true,
      inputFeatureIds,
    };
  },
  apply: ({ apply }) => apply(),
};

function isNewBodyExtrude(feature: Parameters<OnshapeFeatureTranslator["plan"]>[0]["feature"]): boolean {
  const operationType = feature.parameters?.find(
    (parameter) =>
      typeof parameter === "object" &&
      parameter !== null &&
      (parameter as { parameterId?: unknown }).parameterId === "operationType",
  ) as { value?: unknown } | undefined;
  return operationType?.value === undefined || operationType.value === "NEW";
}
