import type { OnshapeFeatureTranslator } from "@/domain/import/onshape/feature-translator-registry";

const REGION_CONSUMING_FEATURES = new Set(["revolve", "sweep", "loft", "thicken"]);
const TOPOLOGY_DEPENDENT_FEATURES = new Set(["cPlane", "transform", "splitPart", "split", "booleanBodies", "deleteBodies", "mirror"]);

/** Wave-C bake classification. Families are explicit so the review says what Cadara cannot preserve. */
const WAVE_C_REASON_BY_FEATURE_TYPE: ReadonlyMap<string, import("@/domain/import/onshape/fidelity-planner").PlanReasonCode> = new Map([
  ...["sheetMetalBend", "sheetMetalBendRelief", "sheetMetalCorner", "sheetMetalCornerBreak", "sheetMetalCornerBreakAttributeBased", "sheetMetalEnd", "sheetMetalFlange", "sheetMetalFormed", "sheetMetalHem", "sheetMetalJoint", "sheetMetalMakeJoint", "sheetMetalRecognize", "sheetMetalRefold", "sheetMetalRip", "sheetMetalStart", "sheetMetalTab", "sheetMetalUnfold"].map((type) => [type, "sheet-metal-unsupported"] as const),
  ...["boundarySurface", "constrainedSurface", "offsetSurface", "ruledSurface", "extendSurface", "fill", "replaceFace", "deleteFace", "mutualTrim", "endcap", "enclose"].map((type) => [type, "surface-modeling-unsupported"] as const),
  ...["bridgingCurve", "compositeCurve", "editCurve", "fitSpline", "helix", "intersectionCurve", "isocline", "isoparametricCurve", "offsetCurveOnFace", "projectCurves", "trimCurve", "wrap", "routingCurve"].map((type) => [type, "curve-modeling-unsupported"] as const),
  ...["sphere", "cube"].map((type) => [type, "primitive-unsupported"] as const),
  ...["tag", "origin", "cPoint", "mateConnector", "nameEntity", "computeMass", "cutlist", "cutlistTable", "decal", "holeTable"].map((type) => [type, "annotation-meta-unsupported"] as const),
  ...["bodyDraft", "draft", "faceBlend", "modifyFillet", "moveFace", "rib", "externalThread", "frame", "frameTrim", "compositePart", "copyPart", "importDerived", "importForeign"].map((type) => [type, "part-operation-unsupported"] as const),
  ...["circularPattern", "curvePattern", "linearPattern", "derivedMirror"].map((type) => [type, "pattern-unsupported"] as const),
  ...["angleTolerance", "diameterTolerance", "lengthTolerance"].map((type) => [type, "tolerance-unsupported"] as const),
]);

export const fallbackFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: [],
  plan: ({ feature, label }) => {
    const reason = REGION_CONSUMING_FEATURES.has(feature.featureType)
      ? "needs-region-resolution"
      : TOPOLOGY_DEPENDENT_FEATURES.has(feature.featureType)
        ? "needs-history-probe"
        : WAVE_C_REASON_BY_FEATURE_TYPE.get(feature.featureType) ?? "custom-feature";
    return {
      onshapeFeatureId: feature.featureId,
      featureType: feature.featureType,
      label,
      tier: "baked",
      target: { kind: "bakedBody" },
      reasonCodes: [reason],
      suppressed: true,
      inputDependencies: [],
      inputFeatureIds: [],
    };
  },
};

export const planeFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["defaultPlane", "cPlane"],
  plan: fallbackFeatureTranslator.plan,
  apply: ({ apply }) => apply(),
};
