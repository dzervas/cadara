import { interpretResolvedReference } from "@/domain/import/onshape/signature-interpreter";
import { extractSketchPlaneDeterministicId } from "@/domain/import/onshape/fidelity-planner";
import type { OnshapeFeatureTranslator } from "@/domain/import/onshape/feature-translator-registry";

export const sketchFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["newSketch"],
  plan: ({ feature, onshapeSuppressed, references, state }) => {
    const planeId = extractSketchPlaneDeterministicId(feature);
    const records = planeId ? references.get(planeId) ?? [] : [];
    const reference = records.find(
      (record) =>
        record.evaluatedAt === "historyPoint" && record.consumingFeatureId === feature.featureId,
    ) ?? records.find((record) => record.evaluatedAt === "finalState");
    const resolution = reference ? interpretResolvedReference(reference) : null;
    const sketch =
      resolution?.kind === "canonicalPlane"
        ? { planeKey: resolution.planeKey }
        : !planeId
          ? { planeKey: "xy" as const }
          : null;

    if (!sketch) {
      state.bakedLineageFeatureIds.add(feature.featureId);
      return {
        onshapeFeatureId: feature.featureId,
        featureType: feature.featureType,
        label: feature.name ?? feature.featureId,
        tier: "baked",
        target: { kind: "suppressed" },
        reasonCodes: ["needs-history-probe"],
        suppressed: true,
        inputFeatureIds: [],
      };
    }

    state.sketchPlansByFeatureId.set(feature.featureId, {
      tier: "parametric",
      planeKey: sketch.planeKey,
    });
    return {
      onshapeFeatureId: feature.featureId,
      featureType: feature.featureType,
      label: feature.name ?? feature.featureId,
      tier: "parametric",
      target: { kind: "sketch", planeKey: sketch.planeKey },
      reasonCodes: ["sketch-on-canonical-plane"],
      suppressed: onshapeSuppressed,
      inputFeatureIds: [],
    };
  },
  apply: ({ apply }) => apply(),
};
