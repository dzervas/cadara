import type { OnshapeCaptureBundleV2 } from "@/contracts/import/onshape-capture-bundle";

const LOCAL_SURFACE_EXTRUDE_STUDIOS = [
  ["wave-x-9841", "Part Studio 1"],
  ["wave-x-d3cd9", "Part Studio 1"],
] as const;

function sketch(featureId: string, name: string) {
  return {
    featureType: "newSketch",
    featureId,
    name,
    parameters: [{
      parameterId: "sketchPlane",
      queries: [{ queryString: 'query = qCreatedBy(id + "TopplaneOp", EntityType.FACE);' }],
    }],
  };
}

function extrude(input: {
  featureId: string;
  name: string;
  sketchId: string;
  bodyType: "SOLID" | "SURFACE";
  operationType: "NEW" | "REMOVE";
}) {
  return {
    featureType: "extrude",
    featureId: input.featureId,
    name: input.name,
    parameters: [
      { parameterId: "bodyType", value: input.bodyType },
      { parameterId: "operationType", value: input.operationType },
      {
        parameterId: "entities",
        queries: [{ queryString: `query = qSketchRegion(id + "${input.sketchId}", true);` }],
      },
      { parameterId: "endBound", value: "BLIND" },
      { parameterId: "depth", expression: "10 mm", value: 0.01 },
    ],
  };
}

/**
 * Proprietary-free stand-ins for the two local Phase-X `Extrude 4` surface
 * forms. The following cut proves a surface result never becomes solid body
 * lineage for downstream planning.
 */
export function makeWaveXSurfaceExtrudeCaptureBundle(): OnshapeCaptureBundleV2 {
  return {
    formatVersion: 2,
    provenance: {
      capturedAt: "2026-07-18T00:00:00.000Z",
      cliVersion: "test",
      apiVersion: "v10",
      baseUrl: "https://cad.onshape.com/api/v10",
      documentId: "d".repeat(24),
      wvm: "w",
      wvmId: "w".repeat(24),
      microversion: "m".repeat(24),
    },
    document: {},
    elements: {},
    diagnostics: [],
    partStudios: LOCAL_SURFACE_EXTRUDE_STUDIOS.map(([elementId, name]) => ({
      elementId,
      name,
      features: {
        features: [
          sketch("S_SURFACE", "Surface profile"),
          extrude({
            featureId: "E_SURFACE_4",
            name: "Extrude 4",
            sketchId: "S_SURFACE",
            bodyType: "SURFACE",
            operationType: "NEW",
          }),
          sketch("S_SOLID_CUT", "Solid cut profile"),
          extrude({
            featureId: "E_SOLID_CUT",
            name: "Solid cut after surface",
            sketchId: "S_SOLID_CUT",
            bodyType: "SOLID",
            operationType: "REMOVE",
          }),
        ],
      },
      sketches: {
        sketches: ["S_SURFACE", "S_SOLID_CUT"].map((featureId) => ({
          featureId,
          sketchSolveStatus: "WELL_DEFINED",
          entities: [{
            sketchEntityId: `${featureId}_circle`,
            sketchEntityType: "skCircle",
            geometry: { center3d: { x: 0, y: 0, z: 0 }, radius: 0.004 },
            isConstruction: false,
          }],
        })),
      },
      parts: null,
      featureSpecs: { present: false, reason: "synthetic Phase-X fixture" },
      resolvedReferences: [{
        deterministicId: "Top",
        evaluatedAt: "finalState",
        signature: {
          entityClass: "face",
          geometryType: "plane",
          definingData: { normal: [0, 0, 1] },
          isDefaultPlane: true,
        },
      }],
      resolvedQueryReferences: [],
      groundTruth: { hasBodies: false },
      rollbackSnapshots: [],
    })),
  };
}
