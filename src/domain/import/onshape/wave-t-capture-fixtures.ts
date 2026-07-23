/**
 * Synthetic Wave-T capture assembled from parameter envelopes captured from
 * Onshape document 405fa226bb150016d09afc09 on 2026-07-18.
 *
 * Keep the modern v6 parameter ids (for example fullRevolve, sheetProfilesArray,
 * TRANSLATION_3D) intact: Phase-T translators use this CI-safe fixture in place
 * of the gitignored real rollback bundle.
 */
const individualQuery = (queryString: string, deterministicIds: string[] = []) => ({
  btType: "BTMIndividualQuery-138",
  queryString,
  deterministicIds,
});

const query = (
  parameterId: string,
  queryStrings: string[],
  deterministicIds: string[] = [],
) => ({
  btType: "BTMParameterQueryList-148",
  parameterId,
  queries: queryStrings.map((queryString) =>
    individualQuery(queryString, deterministicIds),
  ),
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

const quantity = (parameterId: string, expression: string, value = 0) => ({
  btType: "BTMParameterQuantity-147",
  parameterId,
  expression,
  value,
});

const region = (sketchId: string) => `query = qSketchRegion(id + "${sketchId}", true);`;
const created = (featureId: string, suffix: string, entityType: string) =>
  `query = qCreatedBy(id + "${featureId}" + "${suffix}", EntityType.${entityType});`;

const sketch = (
  featureId: string,
  name: string,
  planeId = "Right",
  planeDeterministicIds: string[] = [],
) => ({
  btType: "BTMSketch-151",
  featureType: "newSketch",
  featureId,
  name,
  parameters: [
    query(
      "sketchPlane",
      [created(planeId, "planeOp", "FACE")],
      planeDeterministicIds,
    ),
  ],
});

const circleSketchData = (featureId: string, radius = 0.004) => ({
  featureId,
  entities: [{
    sketchEntityId: `${featureId}_circle`,
    sketchEntityType: "skCircle",
    geometry: { center3d: { x: 0, y: 0, z: 0 }, radius },
    isConstruction: false,
  }],
});

const extrude = (
  featureId: string,
  name: string,
  sketchId: string,
  overrides: Record<string, unknown>[] = [],
) => {
  const parameters: Record<string, unknown>[] = [
    enumParameter("bodyType", "SOLID"),
    enumParameter("operationType", "NEW"),
    query("entities", [region(sketchId)]),
    enumParameter("endBound", "BLIND"),
    quantity("depth", "20 mm", 0.02),
  ];
  for (const override of overrides) {
    const index = parameters.findIndex(
      (candidate) => candidate.parameterId === override.parameterId,
    );
    if (index === -1) parameters.push(override);
    else parameters[index] = override;
  }
  return {
    btType: "BTMFeature-134",
    featureType: "extrude",
    featureId,
    name,
    parameters,
  };
};

const cPlane = (featureId: string, name: string) => ({
  btType: "BTMFeature-134",
  featureType: "cPlane",
  featureId,
  name,
  parameters: [
    query("entities", [created("Right", "planeOp", "FACE")]),
    enumParameter("cplaneType", "OFFSET"),
    quantity("offset", "30 mm", 0.03),
  ],
});

function syntheticExtrudeProfileEvidence(features: Record<string, unknown>[]) {
  const sourceId = /qSketchRegion\(\s*id\s*\+\s*"([A-Za-z0-9_]+)"/;
  return features.flatMap((feature) => {
    if (feature.featureType !== "extrude" || typeof feature.featureId !== "string") return [];
    const entities = (feature.parameters as Record<string, unknown>[] | undefined)?.find(
      (parameter) => parameter.parameterId === "entities",
    );
    const queries = entities?.queries;
    if (!Array.isArray(queries)) return [];
    return queries.flatMap((query, queryIndex) => {
      const text = typeof (query as { queryString?: unknown }).queryString === "string"
        ? (query as { queryString: string }).queryString
        : "";
      const sketchFeatureId = text.match(sourceId)?.[1];
      return sketchFeatureId ? [{
        consumingFeatureId: feature.featureId,
        parameterId: "entities",
        queryIndex,
        resultIndex: 0,
        deterministicId: `synthetic-profile:${feature.featureId}:${queryIndex}`,
        evaluatedAt: "historyPoint",
        kind: "sketchRegion",
        sourceSketchFeatureId: sketchFeatureId,
        interiorPoint3d: [0, 0, 0],
      }] : [];
    });
  });
}

function studio(
  elementId: string,
  name: string,
  features: Record<string, unknown>[],
  sketches: Record<string, unknown>[],
  extraResolvedReferences: Record<string, unknown>[] = [],
  resolvedQueryReferences: Record<string, unknown>[] = [],
) {
  return {
    elementId,
    name,
    features: { features },
    sketches: { sketches },
    parts: null,
    featureSpecs: { present: false, reason: "real v6 envelopes are embedded in the features" },
    resolvedReferences: [
      {
        deterministicId: "Right",
        evaluatedAt: "finalState",
        signature: {
          entityClass: "face",
          geometryType: "plane",
          definingData: { normal: [1, 0, 0] },
          isDefaultPlane: true,
        },
      },
      ...extraResolvedReferences,
    ],
    resolvedQueryReferences,
    profileEvidence: syntheticExtrudeProfileEvidence(features),
    groundTruth: { hasBodies: false },
    rollbackSnapshots: [],
  };
}

/** A format-v2 CI fixture covering every successfully authored Wave-T behavior. */
export function makeWaveTCaptureBundle() {
  const revolveSketch = "WT_REVOLVE_SKETCH";
  const removeBaseSketch = "WT_REMOVE_BASE_SKETCH";
  const removeBase = "WT_REMOVE_BASE";
  const removeSketch = "WT_REMOVE_SKETCH";
  const sweepProfile = "WT_SWEEP_PROFILE";
  const sweepPath = "WT_SWEEP_PATH";
  const loftA = "WT_LOFT_A";
  const loftPlane = "WT_LOFT_PLANE";
  const loftB = "WT_LOFT_B";
  const extentBaseSketch = "WT_EXTENT_BASE_SKETCH";
  const twoSideSketch = "WT_TWO_SIDE_SKETCH";
  const nextSketch = "WT_NEXT_SKETCH";
  const mirrorSketch = "WT_MIRROR_SKETCH";
  const mirrorBase = "WT_MIRROR_BASE";
  const mirrorPlane = "WT_MIRROR_PLANE";

  return {
    formatVersion: 2,
    provenance: {
      capturedAt: "2026-07-18T00:00:00.000Z",
      cliVersion: "test",
      apiVersion: "v6",
      baseUrl: "https://cad.onshape.com/api/v6",
      documentId: "405fa226bb150016d09afc09",
      wvm: "w",
      wvmId: "50891a71850666bcbdb5d75d",
      microversion: "m".repeat(24),
    },
    document: {},
    elements: {},
    diagnostics: [],
    partStudios: [
      studio(
        "wave-t-full-revolve",
        "Full revolve",
        [
          sketch(revolveSketch, "Revolve profile and axis"),
          {
            btType: "BTMFeature-134",
            featureType: "revolve",
            featureId: "WT_FULL_REVOLVE",
            name: "Full revolve",
            parameters: [
              enumParameter("bodyType", "SOLID"),
              enumParameter("operationType", "NEW"),
              query("entities", [region(revolveSketch)]),
              query("axis", [
                `query = qNthElement(qCreatedBy(id + "${revolveSketch}" + "wireOp", EntityType.EDGE), 1);`,
              ]),
              booleanParameter("fullRevolve", true),
              enumParameter("endBound", "BLIND"),
              quantity("angle", "30.0*deg", Math.PI / 6),
            ],
          },
        ],
        [circleSketchData(revolveSketch)],
      ),
      studio(
        "wave-t-remove-revolve",
        "Blind remove revolve",
        [
          sketch(removeBaseSketch, "Base profile"),
          extrude(removeBase, "Base extrude", removeBaseSketch),
          sketch(removeSketch, "Remove profile and axis"),
          {
            btType: "BTMFeature-134",
            featureType: "revolve",
            featureId: "WT_REMOVE_REVOLVE",
            name: "Blind remove on extrude",
            parameters: [
              enumParameter("bodyType", "SOLID"),
              enumParameter("operationType", "REMOVE"),
              query("entities", [region(removeSketch)]),
              query("axis", [
                `query = qNthElement(qCreatedBy(id + "${removeSketch}" + "wireOp", EntityType.EDGE), 1);`,
              ]),
              booleanParameter("fullRevolve", false),
              enumParameter("endBound", "BLIND"),
              quantity("angle", "90 deg", Math.PI / 2),
              booleanParameter("defaultScope", false),
              query("booleanScope", [created(removeBase, "", "BODY")]),
            ],
          },
        ],
        [circleSketchData(removeBaseSketch, 0.012), circleSketchData(removeSketch)],
      ),
      studio(
        "wave-t-sweep",
        "Sweep",
        [
          sketch(sweepProfile, "Sweep profile"),
          sketch(sweepPath, "Sweep path", "Front"),
          {
            btType: "BTMFeature-134",
            featureType: "sweep",
            featureId: "WT_SWEEP",
            name: "Solid sweep",
            parameters: [
              enumParameter("bodyType", "SOLID"),
              enumParameter("operationType", "NEW"),
              query("profiles", [region(sweepProfile)]),
              query("path", [created(sweepPath, "wireOp", "EDGE")]),
            ],
          },
        ],
        [circleSketchData(sweepProfile, 0.003), circleSketchData(sweepPath)],
      ),
      studio(
        "wave-t-loft",
        "Loft",
        [
          sketch(loftA, "Loft profile A"),
          cPlane(loftPlane, "Loft offset plane"),
          sketch(loftB, "Loft profile B", loftPlane, ["WT_LOFT_PLANE_FACE"]),
          {
            btType: "BTMFeature-134",
            featureType: "loft",
            featureId: "WT_LOFT",
            name: "Solid loft",
            parameters: [
              enumParameter("bodyType", "SOLID"),
              enumParameter("operationType", "NEW"),
              {
                btType: "BTMParameterArray-2025",
                parameterId: "sheetProfilesArray",
                items: [loftA, loftB].map((profileId) => ({
                  btType: "BTMArrayParameterItem-1843",
                  parameters: [query("sheetProfileEntities", [region(profileId)])],
                })),
              },
              booleanParameter("addGuides", false),
            ],
          },
        ],
        [circleSketchData(loftA, 0.006), circleSketchData(loftB, 0.003)],
        [{
          deterministicId: "WT_LOFT_PLANE_FACE",
          evaluatedAt: "finalState",
          signature: {
            entityClass: "face",
            geometryType: "plane",
            boundingBox: { low: [0.03, -0.075, -0.075], high: [0.03, 0.075, 0.075] },
            centroid: [0.03, 0, 0],
            definingData: { normal: [1, 0, 0], origin: [0.03, 0, 0] },
          },
        }],
      ),
      studio(
        "wave-t-extrude-extents",
        "Extrude extents",
        [
          sketch(extentBaseSketch, "Extent base profile"),
          extrude("WT_EXTENT_BASE", "Extent base extrude", extentBaseSketch),
          sketch(twoSideSketch, "Two side profile"),
          extrude("WT_TWO_SIDE", "Two side extrude", twoSideSketch, [
            booleanParameter("hasSecondDirection", true),
            enumParameter("secondDirectionBound", "BLIND"),
            quantity("secondDirectionDepth", "10 mm", 0.01),
          ]),
          sketch(nextSketch, "Up to next profile"),
          extrude("WT_UP_TO_NEXT", "Up to next extrude", nextSketch, [
            enumParameter("operationType", "REMOVE"),
            enumParameter("endBound", "UP_TO_NEXT"),
            booleanParameter("defaultScope", true),
          ]),
        ],
        [
          circleSketchData(extentBaseSketch, 0.01),
          circleSketchData(twoSideSketch),
          circleSketchData(nextSketch),
        ],
      ),
      studio(
        "wave-t-mirror-transform",
        "Mirror transform",
        [
          sketch(mirrorSketch, "Mirror base profile"),
          extrude(mirrorBase, "Mirror base extrude", mirrorSketch),
          cPlane(mirrorPlane, "Mirror offset plane"),
          {
            btType: "BTMFeature-134",
            featureType: "mirror",
            featureId: "WT_MIRROR",
            name: "Part mirror",
            parameters: [
              enumParameter("patternType", "PART"),
              enumParameter("operationType", "NEW"),
              query("entities", [created(mirrorBase, "", "BODY")], ["WT_MIRROR_BODY"]),
              query("mirrorPlane", [created(mirrorPlane, "planeOp", "FACE")], ["WT_MIRROR_PLANE_FACE"]),
            ],
          },
          {
            btType: "BTMFeature-134",
            featureType: "transform",
            featureId: "WT_TRANSFORM",
            name: "XYZ translation",
            parameters: [
              query("entities", [created(mirrorBase, "", "BODY")]),
              enumParameter("transformType", "TRANSLATION_3D"),
              quantity("dx", "5 mm", 0.005),
              quantity("dy", "0 mm"),
              quantity("dz", "0 mm"),
              booleanParameter("makeCopy", false),
            ],
          },
        ],
        [circleSketchData(mirrorSketch, 0.006)],
        [{
          deterministicId: "WT_MIRROR_PLANE_FACE",
          evaluatedAt: "finalState",
          signature: {
            entityClass: "face",
            geometryType: "plane",
            boundingBox: { low: [0.03, -0.075, -0.075], high: [0.03, 0.075, 0.075] },
            centroid: [0.03, 0, 0],
            definingData: { normal: [1, 0, 0], origin: [0.03, 0, 0] },
          },
        }, {
          deterministicId: "WT_MIRROR_BODY",
          evaluatedAt: "historyPoint",
          consumingFeatureId: "WT_MIRROR",
          signature: {
            entityClass: "body",
            geometryType: "solid",
            boundingBox: { low: [-0.01, -0.01, 0], high: [0.01, 0.01, 0.02] },
            centroid: [0, 0, 0.01],
          },
        }],
        [{
          consumingFeatureId: "WT_TRANSFORM",
          parameterId: "entities",
          queryIndex: 0,
          entityIndex: 0,
          evaluatedAt: "historyPoint",
          signature: {
            entityClass: "body",
            geometryType: "solid",
            boundingBox: { low: [-0.01, -0.01, 0], high: [0.01, 0.01, 0.02] },
            centroid: [0, 0, 0.01],
          },
        }],
      ),
    ],
  };
}

/** CI-safe bundle narrowed to the real Wave-T simple loft studio. */
export function makeWaveTLoftCaptureBundle() {
  const bundle = makeWaveTCaptureBundle();
  bundle.partStudios = bundle.partStudios.filter(
    (candidate) => candidate.elementId === "wave-t-loft",
  );
  return bundle;
}

/** CI-safe bundle narrowed to the real Wave-T single-path sweep studio. */
export function makeWaveTSweepCaptureBundle() {
  const bundle = makeWaveTCaptureBundle();
  bundle.partStudios = bundle.partStudios.filter(
    (candidate) => candidate.elementId === "wave-t-sweep",
  );
  return bundle;
}


/** CI-safe bundle narrowed to mirror/transform across a translated cPlane. */
export function makeWaveTMirrorTransformCaptureBundle() {
  const bundle = makeWaveTCaptureBundle();
  bundle.partStudios = bundle.partStudios.filter(
    (candidate) => candidate.elementId === "wave-t-mirror-transform",
  );
  return bundle;
}
