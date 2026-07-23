import type { OnshapeCaptureBundleV2 } from "@/contracts/import/onshape-capture-bundle";

const query = (parameterId: string, ids: string[], queryString?: string) => ({
  btType: "BTMParameterQueryList-148",
  parameterId,
  queries: ids.map((id) => ({
    btType: "BTMIndividualQuery-138",
    queryString: queryString ?? `query=${id}`,
    deterministicIds: [id],
  })),
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

const tessellation = (bodies: { id: string; low: [number, number, number]; high: [number, number, number] }[]) => ({
  btType: "BTExportTessellatedFacesResponse-898",
  bodies: bodies.map(({ id, low, high }) => ({
    id,
    faces: [{
      id: `${id}_face`,
      facets: [
        {
          vertices: [
            { x: low[0], y: low[1], z: low[2] },
            { x: high[0], y: low[1], z: low[2] },
            { x: high[0], y: high[1], z: high[2] },
          ],
          normals: [],
        },
        {
          vertices: [
            { x: low[0], y: low[1], z: low[2] },
            { x: high[0], y: high[1], z: high[2] },
            { x: low[0], y: high[1], z: high[2] },
          ],
          normals: [],
        },
      ],
    }],
  })),
});


function circleSketch(featureId: string, center: [number, number, number], radius: number) {
  return {
    featureId,
    entities: [{
      sketchEntityId: `${featureId}_circle`,
      sketchEntityType: "skCircle",
      geometry: { center3d: { x: center[0], y: center[1], z: center[2] }, radius },
      isConstruction: false,
    }],
  };
}

function directionSketch(featureId: string, entityId: string) {
  return {
    featureId,
    entities: [{
      sketchEntityId: entityId,
      sketchEntityType: "skLineSegment",
      startPosition3d: { x: 0, y: 0, z: 0 },
      endPosition3d: { x: 0.001, y: 0, z: 0 },
      isConstruction: true,
    }],
  };
}

const sketchFeature = (featureId: string, name = featureId) => ({
  featureType: "newSketch",
  featureId,
  name,
  parameters: [query("sketchPlane", ["Top"])],
});

const extrudeFeature = (featureId: string, sketchId: string) => ({
  featureType: "extrude",
  featureId,
  name: featureId,
  parameters: [
    { ...query("entities", []), queries: [{ queryString: `query = qSketchRegion(id + "${sketchId}", true);` }] },
    enumParameter("endBound", "BLIND"),
    quantityParameter("depth", "2 mm", 0.002),
    enumParameter("operationType", "NEW"),
  ],
});

function bodyReference(deterministicId: string, consumerFeatureId: string, low: [number, number, number], high: [number, number, number]) {
  return {
    deterministicId,
    evaluatedAt: "historyPoint" as const,
    consumingFeatureId: consumerFeatureId,
    signature: {
      entityClass: "body" as const,
      geometryType: "solid" as const,
      boundingBox: { low, high },
      centroid: [
        (low[0] + high[0]) / 2,
        (low[1] + high[1]) / 2,
        (low[2] + high[2]) / 2,
      ] as [number, number, number],
    },
  };
}

const topReference = {
  deterministicId: "Top",
  evaluatedAt: "finalState" as const,
  signature: {
    entityClass: "face" as const,
    geometryType: "plane" as const,
    definingData: { normal: [0, 0, 1] as [number, number, number] },
    isDefaultPlane: true,
  },
};

function linearStudio() {
  const seed = { id: "BODY_LINEAR", low: [0, 0, 0] as [number, number, number], high: [0.002, 0.002, 0.002] as [number, number, number] };
  const copies = [
    seed,
    { id: "BODY_LINEAR_COPY_1", low: [0.01, 0, 0] as [number, number, number], high: [0.012, 0.002, 0.002] as [number, number, number] },
    { id: "BODY_LINEAR_COPY_2", low: [0.02, 0, 0] as [number, number, number], high: [0.022, 0.002, 0.002] as [number, number, number] },
  ];
  return {
    elementId: "wave-w-pattern-linear",
    name: "Wave W Linear Pattern",
    features: { features: [
      sketchFeature("S_LINEAR_BASE", "Linear base sketch"),
      extrudeFeature("E_LINEAR_BASE", "S_LINEAR_BASE"),
      sketchFeature("S_LINEAR_DIR", "Linear direction sketch"),
      {
        featureType: "linearPattern",
        featureId: "P_LINEAR",
        name: "Linear pattern",
        parameters: [
          enumParameter("patternType", "PART"),
          query("entities", ["BODY_LINEAR"], 'query = qCreatedBy(id + "E_LINEAR_BASE", EntityType.BODY);'),
          query("directionOne", ["S_LINEAR_DIR:axis_line"], 'query = qCreatedBy(id + "S_LINEAR_DIR" + "wireOp", EntityType.EDGE)->qNthElement(0) /* axis_line */;'),
          quantityParameter("distance", "10 mm", 0.01),
          { parameterId: "instanceCount", value: 3 },
          booleanParameter("oppositeDirection", false),
          booleanParameter("isCentered", false),
          booleanParameter("hasSecondDir", false),
          enumParameter("operationType", "NEW"),
          booleanParameter("skipInstances", false),
        ],
      },
    ] },
    sketches: { sketches: [
      circleSketch("S_LINEAR_BASE", [0.001, 0.001, 0], 0.001),
      directionSketch("S_LINEAR_DIR", "axis_line"),
    ] },
    parts: null,
    featureSpecs: { present: false as const, reason: "synthetic pattern translator fixture" },
    resolvedReferences: [topReference, bodyReference("BODY_LINEAR", "P_LINEAR", seed.low, seed.high)],
    profileEvidence: [{
      consumingFeatureId: "E_LINEAR_BASE", parameterId: "entities" as const,
      queryIndex: 0, resultIndex: 0, deterministicId: "linear-profile",
      evaluatedAt: "historyPoint" as const, kind: "sketchRegion" as const,
      sourceSketchFeatureId: "S_LINEAR_BASE", interiorPoint3d: [0.001, 0.001, 0] as [number, number, number],
    }],
    groundTruth: { hasBodies: true as const, tessellationTolerance: 0.0001, tessellatedFaces: tessellation(copies), step: "" },
    rollbackSnapshots: [
      { featureId: "S_LINEAR_BASE", tessellationTolerance: 0.0001, tessellatedFaces: tessellation([]) },
      { featureId: "E_LINEAR_BASE", tessellationTolerance: 0.0001, tessellatedFaces: tessellation([seed]) },
      { featureId: "S_LINEAR_DIR", tessellationTolerance: 0.0001, tessellatedFaces: tessellation([seed]) },
      { featureId: "P_LINEAR", tessellationTolerance: 0.0001, tessellatedFaces: tessellation(copies) },
    ],
  };
}

function circularStudio() {
  const seed = { id: "BODY_CIRCULAR", low: [0.01, -0.000992709, 0] as [number, number, number], high: [0.012, 0.000992709, 0.002] as [number, number, number] };
  const finalBodies = [
    seed,
    { id: "BODY_CIRCULAR_Q2", low: [-0.001, 0.01, 0] as [number, number, number], high: [0.001, 0.012, 0.002] as [number, number, number] },
    { id: "BODY_CIRCULAR_Q3", low: [-0.012, -0.001, 0] as [number, number, number], high: [-0.01, 0.001, 0.002] as [number, number, number] },
    { id: "BODY_CIRCULAR_Q4", low: [-0.001, -0.012, 0] as [number, number, number], high: [0.001, -0.01, 0.002] as [number, number, number] },
  ];
  return {
    elementId: "wave-w-pattern-circular",
    name: "Wave W Circular Pattern",
    features: { features: [
      sketchFeature("S_CIRCULAR_BASE", "Circular base sketch"),
      extrudeFeature("E_CIRCULAR_BASE", "S_CIRCULAR_BASE"),
      {
        featureType: "circularPattern",
        featureId: "P_CIRCULAR",
        name: "Circular pattern",
        parameters: [
          enumParameter("patternType", "PART"),
          query("entities", ["BODY_CIRCULAR"], 'query = qCreatedBy(id + "E_CIRCULAR_BASE", EntityType.BODY);'),
          query("axis", ["Top"]),
          quantityParameter("angle", "360 deg", Math.PI * 2),
          { parameterId: "instanceCount", value: 4 },
          booleanParameter("oppositeDirection", false),
          booleanParameter("equalSpace", true),
          booleanParameter("isCentered", false),
          enumParameter("operationType", "NEW"),
          booleanParameter("skipInstances", false),
        ],
      },
    ] },
    sketches: { sketches: [circleSketch("S_CIRCULAR_BASE", [0.011, 0, 0], 0.001)] },
    parts: null,
    featureSpecs: { present: false as const, reason: "synthetic pattern translator fixture" },
    resolvedReferences: [topReference, bodyReference("BODY_CIRCULAR", "P_CIRCULAR", seed.low, seed.high)],
    profileEvidence: [{
      consumingFeatureId: "E_CIRCULAR_BASE", parameterId: "entities" as const,
      queryIndex: 0, resultIndex: 0, deterministicId: "circular-profile",
      evaluatedAt: "historyPoint" as const, kind: "sketchRegion" as const,
      sourceSketchFeatureId: "S_CIRCULAR_BASE", interiorPoint3d: [0.011, 0, 0] as [number, number, number],
    }],
    groundTruth: { hasBodies: true as const, tessellationTolerance: 0.0001, tessellatedFaces: tessellation(finalBodies), step: "" },
    rollbackSnapshots: [
      { featureId: "S_CIRCULAR_BASE", tessellationTolerance: 0.0001, tessellatedFaces: tessellation([]) },
      { featureId: "E_CIRCULAR_BASE", tessellationTolerance: 0.0001, tessellatedFaces: tessellation([seed]) },
      { featureId: "P_CIRCULAR", tessellationTolerance: 0.0001, tessellatedFaces: tessellation(finalBodies) },
    ],
  };
}

export function makeWaveWPatternCaptureBundle(): OnshapeCaptureBundleV2 {
  return {
    formatVersion: 2,
    provenance: {
      capturedAt: "2026-07-22T00:00:00.000Z",
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
    partStudios: [linearStudio(), circularStudio()],
  } as OnshapeCaptureBundleV2;
}
