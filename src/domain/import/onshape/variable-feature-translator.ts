import { extractVariableName } from "@/domain/import/onshape/fidelity-planner";
import type { OnshapeFeatureTranslator } from "@/domain/import/onshape/feature-translator-registry";

export const variableFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["assignVariable"],
  plan: ({ feature, label, onshapeSuppressed }) => ({
    onshapeFeatureId: feature.featureId,
    featureType: feature.featureType,
    label: extractVariableName(feature) ?? label,
    tier: "parametric",
    target: { kind: "variable" },
    reasonCodes: ["document-variable"],
    suppressed: onshapeSuppressed,
    inputDependencies: [],
    inputFeatureIds: [],
  }),
  apply: ({ apply }) => apply(),
};
