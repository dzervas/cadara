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
      profileEvidence: [{
        consumingFeatureId: "E_SOLID_CUT",
        parameterId: "entities",
        queryIndex: 0,
        resultIndex: 0,
        deterministicId: "surface-fixture-cut-profile",
        evaluatedAt: "historyPoint",
        kind: "sketchRegion",
        sourceSketchFeatureId: "S_SOLID_CUT",
        interiorPoint3d: [0, 0, 0],
      }],
      profileEvidenceSchemaVersion: 3,
      profileEvidenceManifest: [{
        consumingFeatureId: "E_SOLID_CUT", parameterId: "entities", queryIndex: 0,
        sourceQueryString: 'query = qSketchRegion(id + "S_SOLID_CUT", true);',
        kind: "faceResults", emittedRecordCount: 1, completed: true,
      }],
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
  // Exact analytic envelope of the 4 mm circular profile, matching what Onshape
  // reports for this solid. Kernel signatures derive curved extents from exact
  // arc geometry, so a chord-deficient stand-in would itself be the artifact.
  const low = { x: -0.004, y: -0.004, z: 0 };
  const high = { x: 0.004, y: 0.004, z: 0.01 };
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
      profileEvidence: [{
        consumingFeatureId: baseExtrudeId,
        parameterId: "entities",
        queryIndex: 0,
        resultIndex: 0,
        deterministicId: "shell-base-profile",
        evaluatedAt: "historyPoint",
        kind: "sketchRegion",
        sourceSketchFeatureId: "SHELL_SKETCH",
        interiorPoint3d: [0, 0, 0],
      }],
      profileEvidenceSchemaVersion: 3,
      profileEvidenceManifest: [{
        consumingFeatureId: baseExtrudeId, parameterId: "entities", queryIndex: 0,
        sourceQueryString: 'query = qSketchRegion(id + "SHELL_SKETCH", true);',
        kind: "faceResults", emittedRecordCount: 1, completed: true,
      }],
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

/**
 * Proprietary-free X.4 contract fixture. The opaque profile proves that one
 * complete schema-v3 witness record controls subset selection; the readable
 * profile proves qSketchRegion(..., true) expands its six root ring regions.
 * It does not claim to certify Onshape server query semantics.
 */
export function makeWaveXRegionSelectionCaptureBundle(): OnshapeCaptureBundleV2 {
  const topPlane = {
    deterministicId: "Top",
    evaluatedAt: "finalState" as const,
    signature: {
      entityClass: "face" as const,
      geometryType: "plane" as const,
      definingData: { normal: [0, 0, 1] as [number, number, number] },
      isDefaultPlane: true,
    },
  };
  const rectangleSketchId = "S_X4_DIVIDED_RECTANGLE";
  const annulusSketchId = "S_X4_ANNULI";
  const rectangleExtrudeId = "E_X4_RIGHT_CELL";
  const annulusExtrudeId = "E_X4_ANNULI";
  const annulusCenters = [
    [0, 0], [0, 96.5], [0, 193],
    [102, 0], [102, 96.5], [102, 193],
  ] as const;
  const annulusEntities = annulusCenters.flatMap(([x, y], index) => [
    {
      sketchEntityId: `annulus_outer_${index}`,
      sketchEntityType: "skCircle",
      geometry: { center3d: { x: x / 1000, y: y / 1000, z: 0 }, radius: 0.00375 },
      isConstruction: false,
    },
    {
      sketchEntityId: `annulus_inner_${index}`,
      sketchEntityType: "skCircle",
      geometry: { center3d: { x: x / 1000, y: y / 1000, z: 0 }, radius: 0.00275 },
      isConstruction: false,
    },
  ]);
  const rectangleSegments: readonly [
    string,
    readonly [number, number],
    readonly [number, number],
  ][] = [
    ["rectangle_bottom_left", [0, 0], [10, 0]],
    ["rectangle_bottom_middle", [10, 0], [20, 0]],
    ["rectangle_bottom_right", [20, 0], [30, 0]],
    ["rectangle_right", [30, 0], [30, 10]],
    ["rectangle_top_right", [30, 10], [20, 10]],
    ["rectangle_top_middle", [20, 10], [10, 10]],
    ["rectangle_top_left", [10, 10], [0, 10]],
    ["rectangle_left", [0, 10], [0, 0]],
    // The dividers deliberately carry independent endpoint identities.
    ["divider_10", [10, 0], [10, 10]],
    ["divider_20", [20, 0], [20, 10]],
  ];
  const mirrorRelationships = [0, 1, 2].flatMap((row) => ["outer", "inner"].map((kind) => ({

    constraintType: "MIRROR",
    entityId: `annulus_${kind}_mirror_${row}`,
    parameters: [
      { parameterId: "localFirst", value: `annulus_${kind}_${row}` },
      { parameterId: "localSecond", value: `annulus_${kind}_${row + 3}` },
      { parameterId: "localMirror", value: "annulus_mirror_axis" },
    ],
  })));
  const newSolidExtrude = (
    featureId: string,
    name: string,
    queryString: string,
    depth: number,
  ) => ({
    featureType: "extrude",
    featureId,
    name,
    parameters: [
      { parameterId: "bodyType", value: "SOLID" },
      { parameterId: "operationType", value: "NEW" },
      { parameterId: "entities", queries: [{ queryString }] },
      { parameterId: "endBound", value: "BLIND" },
      { parameterId: "depth", expression: `${depth} mm`, value: depth / 1000 },
    ],
  });
  return {
    formatVersion: 2,
    provenance: {
      capturedAt: "2026-07-27T00:00:00.000Z",
      cliVersion: "test",
      apiVersion: "v10",
      baseUrl: "https://cad.onshape.com/api/v10",
      documentId: "r".repeat(24),
      wvm: "w",
      wvmId: "w".repeat(24),
      microversion: "m".repeat(24),
    },
    document: {},
    elements: {},
    diagnostics: [],
    partStudios: [
      {
        elementId: "wave-x4-right-cell",
        name: "X.4 selected divided rectangle",
        features: { features: [
          {
            ...sketch(rectangleSketchId, "Divided rectangle"),
            constraints: [
              ["rectangle_bottom_left.end", "rectangle_bottom_middle.start"],
              ["rectangle_bottom_middle.end", "rectangle_bottom_right.start"],
              ["rectangle_bottom_left.end", "divider_10.start"],
              ["rectangle_bottom_middle.end", "divider_20.start"],
              ["rectangle_bottom_right.end", "rectangle_right.start"],
              ["rectangle_right.end", "rectangle_top_right.start"],
              ["rectangle_top_right.end", "rectangle_top_middle.start"],
              ["rectangle_top_middle.end", "rectangle_top_left.start"],
              ["rectangle_top_right.end", "divider_20.end"],
              ["rectangle_top_middle.end", "divider_10.end"],
              ["rectangle_top_left.end", "rectangle_left.start"],
              ["rectangle_left.end", "rectangle_bottom_left.start"],
            ].map(([localFirst, localSecond], index) => ({
              constraintType: "COINCIDENT",
              entityId: `rectangle_coincident_${index}`,
              parameters: [
                { parameterId: "localFirst", value: localFirst },
                { parameterId: "localSecond", value: localSecond },
              ],
            })),
          },
          newSolidExtrude(
            rectangleExtrudeId,
            "Right cell",
            'query=qCompressed(1.0,"opaque-x4-right-cell",id);',
            10,
          ),
        ] },
        sketches: { sketches: [{
          featureId: rectangleSketchId,
          entities: rectangleSegments.map(([sketchEntityId, start, end]) => ({

            sketchEntityId,
            sketchEntityType: "skLineSegment",
            startPosition3d: { x: start[0] / 1000, y: start[1] / 1000, z: 0 },
            endPosition3d: { x: end[0] / 1000, y: end[1] / 1000, z: 0 },
            isConstruction: false,
          })),
        }] },
        parts: null,
        featureSpecs: { present: false, reason: "synthetic X.4 fixture" },
        resolvedReferences: [topPlane],
        resolvedQueryReferences: [],
        profileEvidence: [{
          consumingFeatureId: rectangleExtrudeId,
          parameterId: "entities",
          queryIndex: 0,
          resultIndex: 0,
          deterministicId: "x4-right-cell-profile",
          evaluatedAt: "historyPoint",
          kind: "sketchRegion",
          sourceSketchFeatureId: rectangleSketchId,
          interiorPoint3d: [0.025, 0.005, 0],
        }],
        profileEvidenceSchemaVersion: 3,
        profileEvidenceManifest: [{
          consumingFeatureId: rectangleExtrudeId,
          parameterId: "entities",
          queryIndex: 0,
          sourceQueryString: 'query=qCompressed(1.0,"opaque-x4-right-cell",id);',
          kind: "faceResults",
          emittedRecordCount: 1,
          completed: true,
        }],
        groundTruth: { hasBodies: false },
        rollbackSnapshots: [],
      },
      {
        elementId: "wave-x4-annuli",
        name: "X.4 sparse mirrored annuli",
        features: { features: [
          {
            ...sketch(annulusSketchId, "Sparse annuli"),
            // This synthetic relationship uses the MIRROR form supported by
            // sketch-translator; it is not inferred from the ring layout.
            constraints: mirrorRelationships,
          },
          newSolidExtrude(
            annulusExtrudeId,
            "Six annuli",
            `query = qSketchRegion(id + "${annulusSketchId}", true);`,
            8,
          ),
        ] },
        sketches: { sketches: [{
          featureId: annulusSketchId,
          entities: [
            ...annulusEntities,
            {
              sketchEntityId: "annulus_mirror_axis",
              sketchEntityType: "skLineSegment",
              startPosition3d: { x: 0.051, y: -0.01, z: 0 },
              endPosition3d: { x: 0.051, y: 0.203, z: 0 },
              isConstruction: true,
            },
          ],
        }] },
        parts: null,
        featureSpecs: { present: false, reason: "synthetic X.4 fixture" },
        resolvedReferences: [topPlane],
        resolvedQueryReferences: [],
        profileEvidence: [{
          consumingFeatureId: annulusExtrudeId,
          parameterId: "entities",
          queryIndex: 0,
          evaluatedAt: "historyPoint",
          kind: "sketchRegionSet",
          sourceSketchFeatureId: annulusSketchId,
          filterInnerLoops: true,
        }],
        profileEvidenceSchemaVersion: 3,
        profileEvidenceManifest: [{
          consumingFeatureId: annulusExtrudeId,
          parameterId: "entities",
          queryIndex: 0,
          sourceQueryString: `query = qSketchRegion(id + "${annulusSketchId}", true);`,
          kind: "sketchRegionSet",
          emittedRecordCount: 1,
          completed: true,
        }],
        groundTruth: { hasBodies: false },
        rollbackSnapshots: [],
      },
    ],
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
