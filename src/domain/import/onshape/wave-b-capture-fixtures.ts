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

function extrude(id: string, sketchId: string) {
  return {
    featureType: "extrude",
    featureId: id,
    name: id,
    parameters: [
      { ...query("entities", []), queries: [{ queryString: `query = qSketchRegion(id + "${sketchId}", true);` }] },
      { parameterId: "endBound", value: "BLIND" },
      { parameterId: "depth", expression: "10 mm", value: 0.01 },
      { parameterId: "operationType", value: "NEW" },
    ],
  };
}

export function makeWaveBBodyCaptureBundle(kind: ConsumerKind) {
  const needsTwo = kind === "boolean" || kind === "split";
  const features: Record<string, unknown>[] = [sketch("S1"), extrude("E1", "S1")];
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
