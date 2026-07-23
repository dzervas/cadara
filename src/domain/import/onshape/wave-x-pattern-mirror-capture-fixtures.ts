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

const sketchRegion = (sketchFeatureId: string) => ({
  btType: "BTMParameterQueryList-148",
  parameterId: "entities",
  queries: [{
    btType: "BTMIndividualQuery-138",
    queryString: `query = qSketchRegion(id + "${sketchFeatureId}", true);`,
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
  deterministicId: "TOP",
  evaluatedAt: "finalState" as const,
  signature: {
    entityClass: "face" as const,
    geometryType: "plane" as const,
    definingData: { normal: [0, 0, 1] as [number, number, number] },
    isDefaultPlane: true,
  },
};

const rightPlaneReference = {
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

const sketchFeature = (featureId: string, name: string) => ({
  featureId,
  featureType: "newSketch",
  name,
  parameters: [query("sketchPlane", "TOP")],
});

const extrudeFeature = (
  featureId: string,
  name: string,
  sketchFeatureId: string,
  operationType: "NEW" | "ADD",
  depth: string,
) => ({
  featureId,
  featureType: "extrude",
  name,
  parameters: [
    enumParameter("bodyType", "SOLID"),
    enumParameter("operationType", operationType),
    sketchRegion(sketchFeatureId),
    enumParameter("endBound", "BLIND"),
    quantityParameter("depth", depth, Number.parseFloat(depth) / 1000),
    booleanParameter("oppositeDirection", false),
  ],
});

const circleSketch = (
  featureId: string,
  center: [number, number, number],
  radius: number,
) => ({
  featureId,
  entities: [{
    sketchEntityId: `${featureId}_circle`,
    sketchEntityType: "skCircle",
    geometry: { center3d: { x: center[0], y: center[1], z: center[2] }, radius },
    isConstruction: false,
  }],
});

/**
 * Proprietary-free representations of the Phase-X.7 captures. The seed
 * operations are permanent, executable ADD extrudes so the provider and real
 * OCC seam can prove replayed deltas without pretending X.4 has promoted the
 * proprietary source profiles. FEATURE forms retain the exact ordered captured
 * FeatureList ids; PART+ADD retains the exact same source/target body query.
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
            sketchFeature("BASE_SKETCH", "Replay base sketch"),
            extrudeFeature("BASE_EXTRUDE", "Replay base", "BASE_SKETCH", "NEW", "5 mm"),
            sketchFeature("SEED_6_SKETCH", "Extrude 6 seed sketch"),
            extrudeFeature("FOKYXKU0uqy9EB3_2", "Extrude 6", "SEED_6_SKETCH", "ADD", "10 mm"),
            {
              featureId: "FNmvaMWuCDIXPZo_2",
              featureType: "linearPattern",
              name: "Linear pattern 1",
              parameters: [
                enumParameter("patternType", "FEATURE"),
                enumParameter("operationType", "NEW"),
                featureList(["FOKYXKU0uqy9EB3_2"]),
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
            sketchFeature("SEED_7_SKETCH", "Extrude 7 seed sketch"),
            extrudeFeature("F2B5cy3xMm2MHNU_2", "Extrude 7", "SEED_7_SKETCH", "ADD", "8 mm"),
            {
              featureId: "Fvk35GMOaMRxzg8_2",
              featureType: "linearPattern",
              name: "Linear pattern 2",
              parameters: [
                enumParameter("patternType", "FEATURE"),
                enumParameter("operationType", "NEW"),
                featureList(["F2B5cy3xMm2MHNU_2"]),
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
              featureId: "FtdzVK4Ok7Ghvzz_2",
              featureType: "mirror",
              name: "Mirror 1",
              parameters: [
                enumParameter("patternType", "FEATURE"),
                enumParameter("operationType", "NEW"),
                featureList([
                  "FOKYXKU0uqy9EB3_2",
                  "FNmvaMWuCDIXPZo_2",
                  "F2B5cy3xMm2MHNU_2",
                  "Fvk35GMOaMRxzg8_2",
                ]),
                query("mirrorPlane", "RIGHT"),
                booleanParameter("fullFeaturePattern", true),
              ],
            },
          ],
        },
        sketches: {
          sketches: [
            circleSketch("BASE_SKETCH", [0, 0, 0], 0.1),
            circleSketch("SEED_6_SKETCH", [0.01, 0.01, 0], 0.005),
            circleSketch("SEED_7_SKETCH", [0.01, -0.01, 0], 0.005),
          ],
        },
        parts: null,
        featureSpecs: { present: false, reason: "synthetic Phase-X.7 fixture" },
        resolvedReferences: [topPlaneReference, rightPlaneReference],
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
        resolvedReferences: [rightPlaneReference, sourceBodyReference],
        resolvedQueryReferences: [],
        groundTruth: { hasBodies: false },
        rollbackSnapshots: [],
      },
    ],
  } as OnshapeCaptureBundleV2;
}
