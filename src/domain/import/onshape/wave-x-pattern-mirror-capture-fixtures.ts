import type { OnshapeCaptureBundleV2 } from "@/contracts/import/onshape-capture-bundle";

const query = (parameterId: string, deterministicId: string) => ({
  btType: "BTMParameterQueryList-148",
  parameterId,
  queries: [{
    btType: "BTMIndividualQuery-138",
    queryString: `query=${deterministicId}`,
    deterministicIds: [deterministicId],
  }],
});

const featureList = (featureIds: readonly string[]) => ({
  btType: "BTMParameterFeatureList-1749",
  parameterId: "instanceFunction",
  featureIds,
});

const enumParameter = (parameterId: string, value: string) => ({
  btType: "BTMParameterEnum-145",
  parameterId,
  value,
});

const booleanParameter = (parameterId: string, value: boolean) => ({
  btType: "BTMParameterBoolean-144",
  parameterId,
  value,
});

const quantityParameter = (parameterId: string, expression: string, value: number) => ({
  btType: "BTMParameterQuantity-147",
  parameterId,
  expression,
  value,
});

const topPlaneReference = {
  deterministicId: "RIGHT",
  evaluatedAt: "finalState" as const,
  signature: {
    entityClass: "face" as const,
    geometryType: "plane" as const,
    definingData: { normal: [1, 0, 0] as [number, number, number] },
    isDefaultPlane: true,
  },
};

const sourceBodyReference = {
  deterministicId: "BODY_SOURCE",
  evaluatedAt: "historyPoint" as const,
  consumingFeatureId: "PART_ADD_MIRROR",
  signature: {
    entityClass: "body" as const,
    geometryType: "solid" as const,
    boundingBox: {
      low: [0, 0, 0] as [number, number, number],
      high: [0.004, 0.004, 0.004] as [number, number, number],
    },
    centroid: [0.002, 0.002, 0.002] as [number, number, number],
  },
};

/**
 * Proprietary-free representations of the Phase-X.7 captures. FEATURE forms
 * retain their exact ordered FeatureList seed dependencies; PART+ADD retains
 * the exact same source/target body query required by the executable mirror.
 */
export function makeWaveXPatternMirrorCaptureBundle(): OnshapeCaptureBundleV2 {
  return {
    formatVersion: 2,
    provenance: {
      capturedAt: "2026-07-25T00:00:00.000Z",
      cliVersion: "test",
      apiVersion: "v10",
      baseUrl: "https://cad.onshape.com/api/v10",
      documentId: "x".repeat(24),
      wvm: "w",
      wvmId: "w".repeat(24),
      microversion: "m".repeat(24),
    },
    document: {},
    elements: {},
    diagnostics: [],
    partStudios: [
      {
        elementId: "wave-x-feature-patterns",
        name: "Observed feature patterns",
        features: {
          features: [
            { featureId: "EXTRUDE_6", featureType: "extrude", name: "Extrude 6", parameters: [] },
            {
              featureId: "LINEAR_1",
              featureType: "linearPattern",
              name: "Linear pattern 1",
              parameters: [
                enumParameter("patternType", "FEATURE"),
                enumParameter("operationType", "NEW"),
                featureList(["EXTRUDE_6"]),
                query("directionOne", "RIGHT"),
                quantityParameter("distance", "40.2 mm", 0.0402),
                quantityParameter("instanceCount", "3", 3),
                booleanParameter("oppositeDirection", true),
                booleanParameter("isCentered", false),
                booleanParameter("hasSecondDir", false),
                booleanParameter("fullFeaturePattern", true),
                booleanParameter("skipInstances", false),
              ],
            },
            { featureId: "EXTRUDE_7", featureType: "extrude", name: "Extrude 7", parameters: [] },
            {
              featureId: "LINEAR_2",
              featureType: "linearPattern",
              name: "Linear pattern 2",
              parameters: [
                enumParameter("patternType", "FEATURE"),
                enumParameter("operationType", "NEW"),
                featureList(["EXTRUDE_7"]),
                query("directionOne", "RIGHT"),
                quantityParameter("distance", "40.2 mm", 0.0402),
                quantityParameter("instanceCount", "3", 3),
                booleanParameter("oppositeDirection", true),
                booleanParameter("isCentered", false),
                booleanParameter("hasSecondDir", false),
                booleanParameter("fullFeaturePattern", true),
                booleanParameter("skipInstances", false),
              ],
            },
            {
              featureId: "FEATURE_MIRROR",
              featureType: "mirror",
              name: "Mirror 1",
              parameters: [
                enumParameter("patternType", "FEATURE"),
                enumParameter("operationType", "NEW"),
                featureList(["EXTRUDE_6", "LINEAR_1", "EXTRUDE_7", "LINEAR_2"]),
                query("mirrorPlane", "RIGHT"),
                booleanParameter("fullFeaturePattern", true),
              ],
            },
          ],
        },
        sketches: { sketches: [] },
        parts: null,
        featureSpecs: { present: false, reason: "synthetic Phase-X.7 fixture" },
        resolvedReferences: [topPlaneReference],
        resolvedQueryReferences: [],
        groundTruth: { hasBodies: false },
        rollbackSnapshots: [],
      },
      {
        elementId: "wave-x-part-add-mirror",
        name: "Observed PART+ADD mirror",
        features: {
          features: [{
            featureId: "PART_ADD_MIRROR",
            featureType: "mirror",
            name: "Mirror 1",
            parameters: [
              enumParameter("patternType", "PART"),
              enumParameter("operationType", "ADD"),
              query("entities", "BODY_SOURCE"),
              query("mirrorPlane", "RIGHT"),
              query("booleanScope", "BODY_SOURCE"),
            ],
          }],
        },
        sketches: { sketches: [] },
        parts: null,
        featureSpecs: { present: false, reason: "synthetic Phase-X.7 fixture" },
        resolvedReferences: [topPlaneReference, sourceBodyReference],
        resolvedQueryReferences: [],
        groundTruth: { hasBodies: false },
        rollbackSnapshots: [],
      },
    ],
  } as OnshapeCaptureBundleV2;
}
