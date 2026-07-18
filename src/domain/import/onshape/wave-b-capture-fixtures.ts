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
      groundTruth: { hasBodies: false }, rollbackSnapshots: snapshots,
    }],
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
