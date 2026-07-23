import type { OnshapeCaptureBundleV2 } from "@/contracts/import/onshape-capture-bundle";

type ConsumerKind = "boolean" | "transform" | "split" | "delete";

const query = (parameterId: string, ids: string[]) => ({
  btType: "BTMParameterQueryList-148",
  parameterId,
  queries: ids.map((id) => ({
    btType: "BTMIndividualQuery-138",
    queryString: `query=${id}`,
    deterministicIds: [id],
  })),
});

const tessellation = (bodies: { id: string; low: [number, number, number]; high: [number, number, number] }[]) => ({
  btType: "BTExportTessellatedFacesResponse-898",
  bodies: bodies.map(({ id, low, high }) => ({
    id,
    faces: [{
      id: `${id}_face`,
      facets: [{
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

function sketch(id: string) {
  return {
    featureType: "newSketch",
    featureId: id,
    name: id,
    parameters: [query("sketchPlane", ["Top"])],
  };
}

function extrude(id: string, sketchId: string, endBound = "BLIND") {
  return {
    featureType: "extrude",
    featureId: id,
    name: id,
    parameters: [
      { ...query("entities", []), queries: [{ queryString: `query = qSketchRegion(id + "${sketchId}", true);` }] },
      { parameterId: "endBound", value: endBound },
      { parameterId: "depth", expression: "10 mm", value: 0.01 },
      { parameterId: "operationType", value: "NEW" },
    ],
  };
}

export function makeWaveBBodyCaptureBundle(
  kind: ConsumerKind,
  options: { bakedProducer?: boolean } = {},
) {
  const needsTwo = kind === "boolean" || kind === "split";
  // An unsupported end bound keeps E1 honestly baked so its body only ever
  // exists in rollback snapshots, never in the parametric prefix.
  const features: Record<string, unknown>[] = [
    sketch("S1"),
    extrude("E1", "S1", options.bakedProducer ? "UP_TO_SURFACE" : "BLIND"),
  ];
  if (needsTwo) features.push(sketch("S2"), extrude("E2", "S2"));
  const consumer = kind === "boolean"
    ? { featureType: "booleanBodies", featureId: "C", name: "Boolean", parameters: [
        { parameterId: "operationType", value: "SUBTRACTION" },
        query("targets", ["SRC1"]), query("tools", ["SRC2"]),
        { parameterId: "offset", value: false }, { parameterId: "keepTools", value: false },
        query("entitiesToOffset", ["inactive-face"]),
      ] }
    : kind === "transform"
      ? { featureType: "transform", featureId: "C", name: "Transform", parameters: [
          query("entities", ["SRC1"]), { parameterId: "transformType", value: "TRANSLATION_BY_XYZ" },
          { parameterId: "dx", expression: "5 mm", value: 0.005 },
          { parameterId: "dy", expression: "0 mm", value: 0 },
          { parameterId: "dz", expression: "0 mm", value: 0 },
          { parameterId: "makeCopy", value: false },
        ] }
      : kind === "split"
        ? { featureType: "splitPart", featureId: "C", name: "Split", parameters: [
            { parameterId: "splitType", value: "PART" }, query("targets", ["SRC1"]), query("tool", ["SRC2"]),
            { parameterId: "keepBothSides", value: true }, { parameterId: "keepTools", value: true },
          ] }
        : { featureType: "deleteBodies", featureId: "C", name: "Delete", parameters: [
            query("entities", ["SRC1"]), query("nonCompositeEntities", ["SRC1"]),
          ] };
  features.push(consumer);

  const body1 = { id: "SRC1", low: [-0.004, -0.003, 0.012] as [number, number, number], high: [0.004, 0.003, 0.012] as [number, number, number] };
  const body2 = { id: "SRC2", low: [-0.002, -0.003, 0.012] as [number, number, number], high: [0.006, 0.003, 0.012] as [number, number, number] };
  const snapshots = [
    { featureId: "E1", tessellationTolerance: 0.0001, tessellatedFaces: tessellation([body1]) },
    ...(needsTwo ? [{ featureId: "E2", tessellationTolerance: 0.0001, tessellatedFaces: tessellation([body1, body2]) }] : []),
    { featureId: "C", tessellationTolerance: 0.0001, tessellatedFaces: tessellation(kind === "delete" ? [] : [body1, ...(needsTwo ? [body2] : [])]) },
  ];

  return {
    formatVersion: 2,
    provenance: {
      capturedAt: "2026-07-15T00:00:00.000Z", cliVersion: "test", apiVersion: "v10",
      baseUrl: "https://cad.onshape.com/api/v10", documentId: "d".repeat(24), wvm: "w",
      wvmId: "w".repeat(24), microversion: "m".repeat(24),
    },
    document: {}, elements: {}, diagnostics: [],
    partStudios: [{
      elementId: `wave-b-${kind}`, name: `Wave B ${kind}`,
      features: { features },
      sketches: { sketches: [
        { featureId: "S1", entities: [{ sketchEntityId: "circle1", sketchEntityType: "skCircle", geometry: { center3d: { x: 0, y: 0, z: 0 }, radius: 0.004 }, isConstruction: false }] },
        ...(needsTwo ? [{ featureId: "S2", entities: [{ sketchEntityId: "circle2", sketchEntityType: "skCircle", geometry: { center3d: { x: 0.002, y: 0, z: 0 }, radius: 0.004 }, isConstruction: false }] }] : []),
      ] },
      parts: null, featureSpecs: { present: false, reason: "not required by synthetic fixture" },
      resolvedReferences: [{ deterministicId: "Top", evaluatedAt: "finalState", signature: { entityClass: "face", geometryType: "plane", definingData: { normal: [0, 0, 1] }, isDefaultPlane: true } }],
      profileEvidence: ["E1", ...(needsTwo ? ["E2"] : [])].map((featureId, index) => ({
        consumingFeatureId: featureId,
        parameterId: "entities" as const,
        queryIndex: 0,
        resultIndex: 0,
        deterministicId: `wave-b-profile:${featureId}`,
        evaluatedAt: "historyPoint" as const,
        kind: "sketchRegion" as const,
        sourceSketchFeatureId: index === 0 ? "S1" : "S2",
        interiorPoint3d: index === 0 ? [0, 0, 0] as [number, number, number] : [0.002, 0, 0] as [number, number, number],
      })),
      groundTruth: { hasBodies: false }, rollbackSnapshots: snapshots,
    }],
  };
}

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

const quantityParameter = (parameterId: string, expression: string, value = 0) => ({
  btType: "BTMParameterQuantity-147",
  parameterId,
  expression,
  value,
});

const holeLocationQuery = (sketchId: string, pointEntityId: string) => ({
  btType: "BTMParameterQueryList-148",
  parameterId: "locations",
  queries: [{
    btType: "BTMIndividualQuery-138",
    queryString: `query = qCreatedBy(id + "${sketchId}" + "pointOp", EntityType.VERTEX)->qEntityFilter(EntityType.VERTEX)->qContainsPoint(id + "${sketchId}" + "${pointEntityId}");`,
    deterministicIds: [`${sketchId}:${pointEntityId}`],
  }],
});

const holeScopeQuery = (bodyId: string, producerFeatureId: string) => ({
  btType: "BTMParameterQueryList-148",
  parameterId: "scope",
  queries: [{
    btType: "BTMIndividualQuery-138",
    queryString: `query = qCreatedBy(id + "${producerFeatureId}", EntityType.BODY);`,
    deterministicIds: [bodyId],
  }],
});

function pointSketch(id: string) {
  return {
    featureType: "newSketch",
    featureId: id,
    name: id,
    parameters: [query("sketchPlane", ["Top"])],
  };
}

function pointSketchData(featureId: string, pointEntityId: string, x = 0.001) {
  return {
    featureId,
    entities: [{
      sketchEntityId: pointEntityId,
      sketchEntityType: "skPoint",
      geometry: { center3d: { x, y: 0, z: 0 } },
      isConstruction: false,
    }],
  };
}

type HoleFixtureStyle = "simple" | "counterbore" | "countersink";

function holeFeature(style: HoleFixtureStyle, featureId: string, sketchId: string, pointEntityId: string, bodyId: string, producerFeatureId: string) {
  const styleValue = style === "counterbore" ? "C_BORE" : style === "countersink" ? "C_SINK" : "SIMPLE";
  return {
    featureType: "hole",
    featureId,
    name: `Hole ${style}`,
    parameters: [
      enumParameter("styleV2", styleValue),
      enumParameter("endStyleV2", style === "simple" ? "BLIND" : "THROUGH"),
      quantityParameter("holeDiameterV3", "4 mm", 0.004),
      ...(style === "simple" ? [quantityParameter("holeDepthV3", "8 mm", 0.008)] : []),
      ...(style === "counterbore"
        ? [quantityParameter("cBoreDiameterV3", "7 mm", 0.007), quantityParameter("cBoreDepthV3", "2 mm", 0.002)]
        : []),
      ...(style === "countersink"
        ? [quantityParameter("cSinkDiameterV3", "8 mm", 0.008), quantityParameter("cSinkAngleV3", "90 deg", Math.PI / 2)]
        : []),
      booleanParameter("oppositeDirection", style === "counterbore"),
      holeLocationQuery(sketchId, pointEntityId),
      holeScopeQuery(bodyId, producerFeatureId),
    ],
  };
}

function waveBHoleStudio(style: HoleFixtureStyle, elementId: string) {
  const baseSketch = `S_BASE_${style}`;
  const locationSketch = `S_LOC_${style}`;
  const pointEntityId = `P_${style}`;
  const bodyId = `BODY_${style}`;
  const holeId = `HOLE_${style}`;
  const baseExtrude = `E_BASE_${style}`;
  return {
    elementId,
    name: `Wave B Hole ${style}`,
    features: { features: [
      sketch(baseSketch),
      extrude(baseExtrude, baseSketch),
      pointSketch(locationSketch),
      holeFeature(style, holeId, locationSketch, pointEntityId, bodyId, baseExtrude),
    ] },
    sketches: { sketches: [
      { featureId: baseSketch, entities: [{ sketchEntityId: `C_${style}`, sketchEntityType: "skCircle", geometry: { center3d: { x: 0, y: 0, z: 0 }, radius: 0.004 }, isConstruction: false }] },
      pointSketchData(locationSketch, pointEntityId),
    ] },
    parts: null,
    featureSpecs: { present: false as const, reason: "synthetic hole translator fixture" },
    resolvedReferences: [{ deterministicId: "Top", evaluatedAt: "finalState" as const, signature: { entityClass: "face" as const, geometryType: "plane" as const, definingData: { normal: [0, 0, 1] as [number, number, number] }, isDefaultPlane: true } }],
    profileEvidence: [{
      consumingFeatureId: baseExtrude, parameterId: "entities" as const,
      queryIndex: 0, resultIndex: 0, deterministicId: `hole-profile:${style}`,
      evaluatedAt: "historyPoint" as const, kind: "sketchRegion" as const,
      sourceSketchFeatureId: baseSketch, interiorPoint3d: [0, 0, 0] as [number, number, number],
    }],
    groundTruth: { hasBodies: false as const },
    rollbackSnapshots: [
      { featureId: baseExtrude, tessellationTolerance: 0.0001, tessellatedFaces: tessellation([{ id: bodyId, low: [-0.004, -0.003, 0.012], high: [0.004, 0.003, 0.012] }]) },
      { featureId: holeId, tessellationTolerance: 0.0001, tessellatedFaces: tessellation([{ id: bodyId, low: [-0.004, -0.003, 0.012], high: [0.004, 0.003, 0.012] }]) },
    ],
  };
}

export function makeWaveBHoleCaptureBundle(): OnshapeCaptureBundleV2 {
  return {
    formatVersion: 2,
    provenance: {
      capturedAt: "2026-07-21T00:00:00.000Z",
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
    partStudios: [
      waveBHoleStudio("simple", "wave-b-hole-simple"),
      waveBHoleStudio("counterbore", "wave-b-hole-counterbore"),
      waveBHoleStudio("countersink", "wave-b-hole-countersink"),
    ],
  };
}

function integrationBody(id: string, lowX: number, extent: number) {
  const low = [lowX, 0, 0] as const;
  const high = [lowX + extent, extent, extent] as const;
  const vertices = [
    { x: low[0], y: low[1], z: low[2] },
    { x: high[0], y: low[1], z: low[2] },
    { x: low[0], y: high[1], z: low[2] },
    { x: low[0], y: low[1], z: high[2] },
  ];
  return {
    id,
    faces: [{
      id: `${id}-face`,
      facets: [
        { vertices: [vertices[0]!, vertices[2]!, vertices[1]!] },
        { vertices: [vertices[0]!, vertices[1]!, vertices[3]!] },
        { vertices: [vertices[1]!, vertices[2]!, vertices[3]!] },
        { vertices: [vertices[2]!, vertices[0]!, vertices[3]!] },
      ],
    }],
  };
}

/** CI-safe B.3.7 history with two baked runs and a multi-output replacement closure. */
export function makeWaveBSegmentedApplyCaptureBundle(): OnshapeCaptureBundleV2 {
  const base = extrude("E_BASE", "S1");
  const features = [
    sketch("S1"),
    base,
    {
      featureType: "transform",
      featureId: "ROTATE_ONE",
      name: "Rotation one",
      parameters: [
        query("entities", ["A"]),
        { parameterId: "transformType", value: "ROTATION" },
        { parameterId: "makeCopy", value: false },
      ],
    },
    {
      featureType: "assignVariable",
      featureId: "V_BETWEEN",
      name: "Between checkpoints",
      parameters: [
        { parameterId: "name", value: "betweenCheckpoints" },
        { parameterId: "value", expression: "4 mm", value: 0.004 },
      ],
    },
    {
      featureType: "booleanBodies",
      featureId: "BOOLEAN",
      name: "Boolean after first checkpoint",
      parameters: [
        { parameterId: "operationType", value: "UNION" },
        query("targets", ["A"]),
        query("tools", ["B"]),
        { parameterId: "offset", value: false },
        { parameterId: "keepTools", value: true },
        query("entitiesToOffset", ["inactive-face"]),
      ],
    },
    {
      featureType: "transform",
      featureId: "ROTATE_TWO",
      name: "Rotation two",
      parameters: [
        query("entities", ["A"]),
        { parameterId: "transformType", value: "ROTATION" },
        { parameterId: "makeCopy", value: false },
      ],
    },
    {
      featureType: "assignVariable",
      featureId: "V_AFTER",
      name: "After checkpoints",
      parameters: [
        { parameterId: "name", value: "afterCheckpoints" },
        { parameterId: "value", expression: "6 mm", value: 0.006 },
      ],
    },
    {
      featureType: "transform",
      featureId: "MOVE_AFTER",
      name: "Move after second checkpoint",
      parameters: [
        query("entities", ["A"]),
        { parameterId: "transformType", value: "TRANSLATION_BY_XYZ" },
        { parameterId: "dx", expression: "5 mm", value: 0.005 },
        { parameterId: "dy", expression: "0 mm", value: 0 },
        { parameterId: "dz", expression: "0 mm", value: 0 },
        { parameterId: "makeCopy", value: false },
      ],
    },
    {
      featureType: "assignVariable",
      featureId: "V_FINAL",
      name: "After fallback",
      parameters: [
        { parameterId: "name", value: "afterFallback" },
        { parameterId: "value", expression: "8 mm", value: 0.008 },
      ],
    },
  ];
  const states = {
    base: [integrationBody("A", 0, 0.01), integrationBody("B", 0.03, 0.01)],
    rotatedOne: [integrationBody("A", 0, 0.012), integrationBody("B", 0.03, 0.01)],
    boolean: [integrationBody("A", 0, 0.045), integrationBody("B", 0.03, 0.011)],
    rotatedTwo: [integrationBody("A", 0, 0.05), integrationBody("B", 0.03, 0.011)],
    moved: [integrationBody("A", 0.005, 0.05), integrationBody("B", 0.03, 0.011)],
  };
  const snapshot = (featureId: string, bodies: ReturnType<typeof integrationBody>[]) => ({
    featureId,
    tessellationTolerance: 0.0001,
    tessellatedFaces: { bodies },
  });

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
    partStudios: [{
      elementId: "wave-b-segmented-apply",
      name: "Wave B segmented apply",
      features: { features },
      sketches: {
        sketches: [{
          featureId: "S1",
          entities: [{
            sketchEntityId: "circle1",
            sketchEntityType: "skCircle",
            geometry: { center3d: { x: 0, y: 0, z: 0 }, radius: 0.004 },
            isConstruction: false,
          }],
        }],
      },
      parts: null,
      featureSpecs: { present: false, reason: "not required by synthetic fixture" },
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
      profileEvidence: [{
        consumingFeatureId: "E_BASE", parameterId: "entities", queryIndex: 0,
        resultIndex: 0, deterministicId: "segmented-profile", evaluatedAt: "historyPoint",
        kind: "sketchRegion", sourceSketchFeatureId: "S1", interiorPoint3d: [0, 0, 0],
      }],
      groundTruth: {
        hasBodies: true,
        tessellationTolerance: 0.0001,
        tessellatedFaces: { bodies: states.moved },
        step: "",
      },
      rollbackSnapshots: [
        snapshot("S1", []),
        snapshot("E_BASE", states.base),
        snapshot("ROTATE_ONE", states.rotatedOne),
        snapshot("V_BETWEEN", states.rotatedOne),
        snapshot("BOOLEAN", states.boolean),
        snapshot("ROTATE_TWO", states.rotatedTwo),
        snapshot("V_AFTER", states.rotatedTwo),
        snapshot("MOVE_AFTER", states.moved),
        snapshot("V_FINAL", states.moved),
      ],
    }],
  };
}
