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

/**
 * CI-safe stand-in for Laptop Stand's variable chamfer and default-target
 * UNION. The caller supplies the matching prefix topology probe.
 */
function shellSnapshotBody(id: string) {
  const low = { x: -0.004, y: -0.00397084, z: 0 };
  const high = { x: 0.004, y: 0.00397084, z: 0.01 };
  return {
    id,
    faces: [{
      id: `${id}_face`,
      facets: [
        { vertices: [low, { x: high.x, y: low.y, z: low.z }, high] },
        { vertices: [low, high, { x: low.x, y: high.y, z: high.z }] },
      ],
    }],
  };
}

/**
 * Proprietary-free stand-in for 9841 Shell 1: an exact singleton solid scope,
 * empty openings, 2.5 mm inward thickness, and an unchanged rollback envelope.
 */
export function makeWaveXClosedHollowShellCaptureBundle(): OnshapeCaptureBundleV2 {
  const bodyId = "SHELL_BODY";
  const shellId = "SHELL_CLOSED";
  const baseExtrudeId = "SHELL_BASE";
  return {
    formatVersion: 2,
    provenance: {
      capturedAt: "2026-07-26T00:00:00.000Z",
      cliVersion: "test",
      apiVersion: "v10",
      baseUrl: "https://cad.onshape.com/api/v10",
      documentId: "h".repeat(24),
      wvm: "w",
      wvmId: "w".repeat(24),
      microversion: "m".repeat(24),
    },
    document: {},
    elements: {},
    diagnostics: [],
    partStudios: [{
      elementId: "wave-x-closed-hollow-shell",
      name: "Closed hollow shell",
      features: {
        features: [
          sketch("SHELL_SKETCH", "Shell profile"),
          extrude({
            featureId: baseExtrudeId,
            name: "Shell base",
            sketchId: "SHELL_SKETCH",
            bodyType: "SOLID",
            operationType: "NEW",
          }),
          {
            featureType: "shell",
            featureId: shellId,
            name: "Shell 1",
            parameters: [
              { parameterId: "isHollow", value: true },
              { parameterId: "entities", queries: [] },
              {
                parameterId: "parts",
                queries: [{
                  queryString: `query = qCreatedBy(id + "${baseExtrudeId}", EntityType.BODY);`,
                  deterministicIds: [bodyId],
                }],
              },
              { parameterId: "thickness", expression: "2.5 mm", value: 0.0025 },
              { parameterId: "oppositeDirection", value: false },
            ],
          },
        ],
      },
      sketches: {
        sketches: [{
          featureId: "SHELL_SKETCH",
          sketchSolveStatus: "WELL_DEFINED",
          entities: [{
            sketchEntityId: "SHELL_SKETCH_circle",
            sketchEntityType: "skCircle",
            geometry: { center3d: { x: 0, y: 0, z: 0 }, radius: 0.004 },
            isConstruction: false,
          }],
        }],
      },
      parts: null,
      featureSpecs: { present: false, reason: "synthetic Phase-X closed hollow fixture" },
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
      rollbackSnapshots: [
        {
          featureId: baseExtrudeId,
          tessellationTolerance: 0.0001,
          tessellatedFaces: { bodies: [shellSnapshotBody(bodyId)] },
        },
        {
          featureId: shellId,
          tessellationTolerance: 0.0001,
          tessellatedFaces: { bodies: [shellSnapshotBody(bodyId)] },
        },
      ],
    }],
  };
}

export function makeWaveXChamferAndImplicitUnionCaptureBundle(): OnshapeCaptureBundleV2 {
  const bodySignature = (id: string, x: number) => ({
    deterministicId: id,
    evaluatedAt: "historyPoint" as const,
    consumingFeatureId: "BOOLEAN",
    signature: {
      entityClass: "body" as const,
      geometryType: "solid" as const,
      boundingBox: { low: [x / 1000, 0, 0] as [number, number, number], high: [(x + 1) / 1000, 0.001, 0.001] as [number, number, number] },
      centroid: [(x + 0.5) / 1000, 0.0005, 0.0005] as [number, number, number],
    },
  });
  return {
    formatVersion: 2,
    provenance: {
      capturedAt: "2026-07-24T00:00:00.000Z",
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
    partStudios: [{
      elementId: "wave-x-chamfer-union",
      name: "Chamfer and implicit union",
      features: {
        features: [{
          featureType: "assignVariable",
          featureId: "WALL",
          name: "Wall",
          parameters: [
            { parameterId: "name", value: "Wall" },
            { parameterId: "value", expression: "5 mm", value: 0.005 },
          ],
        }, {
          featureType: "chamfer",
          featureId: "CHAMFER",
          name: "Chamfer 2",
          parameters: [
            { parameterId: "entities", queries: [{ queryString: "query=edge", deterministicIds: ["CHAMFER_EDGE"] }] },
            { parameterId: "chamferMethod", value: "FACE_OFFSET" },
            { parameterId: "chamferType", value: "EQUAL_OFFSETS" },
            { parameterId: "width", expression: "#Wall*(4/5)", value: 0 },
            { parameterId: "directionOverrides", queries: [] },
          ],
        }, {
          featureType: "booleanBodies",
          featureId: "BOOLEAN",
          name: "Boolean 1",
          parameters: [
            { parameterId: "operationType", value: "UNION" },
            { parameterId: "tools", queries: ["TOOL_A", "TOOL_B", "TOOL_C", "TOOL_D"].map((id) => ({ queryString: `query=${id}`, deterministicIds: [id] })) },
            { parameterId: "targets", queries: [] },
            { parameterId: "offset", value: false },
            { parameterId: "keepTools", value: false },
          ],
        }],
      },
      sketches: { sketches: [] },
      parts: null,
      featureSpecs: { present: false, reason: "synthetic Phase-X fixture" },
      resolvedReferences: [{
        deterministicId: "CHAMFER_EDGE",
        evaluatedAt: "historyPoint",
        consumingFeatureId: "CHAMFER",
        signature: {
          entityClass: "edge",
          geometryType: "line",
          definingData: { origin: [0, 0, 0], direction: [1, 0, 0] },
        },
      }, ...["TOOL_A", "TOOL_B", "TOOL_C", "TOOL_D"].map((id, index) => bodySignature(id, index + 1))],
      resolvedQueryReferences: [],
      groundTruth: { hasBodies: false },
      rollbackSnapshots: [],
    }],
  };
}
