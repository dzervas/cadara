/** Synthetic captures using the BTM parameter envelopes and feature-spec defaults archived by real bundles. */
export function makeWaveARevolveCaptureBundle() {
  return {
    formatVersion: 1,
    provenance: {
      capturedAt: "2026-07-15T00:00:00.000Z",
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
      {
        elementId: "wave-a-studio",
        name: "Wave A revolve",
        features: {
          features: [
            {
              featureType: "assignVariable",
              featureId: "V_TURNS",
              name: "Turns",
              parameters: [
                { parameterId: "name", value: "turns" },
                {
                  btType: "BTMParameterQuantity-147",
                  parameterId: "value",
                  expression: "1",
                  value: 1,
                },
              ],
            },
            {
              featureType: "newSketch",
              featureId: "S_PROFILE",
              name: "Revolve profile",
              parameters: [
                {
                  btType: "BTMParameterQueryList-148",
                  parameterId: "sketchPlane",
                  queries: [{ deterministicIds: ["Top"] }],
                },
              ],
            },
            {
              featureType: "revolve",
              featureId: "F_REVOLVE",
              name: "Parametric revolve",
              parameters: [
                {
                  btType: "BTMParameterEnum-145",
                  parameterId: "bodyType",
                  value: "SOLID",
                },
                {
                  btType: "BTMParameterEnum-145",
                  parameterId: "operationType",
                  value: "NEW",
                },
                {
                  btType: "BTMParameterQueryList-148",
                  parameterId: "entities",
                  queries: [
                    {
                      queryString:
                        'query = qSketchRegion(id + "S_PROFILE", true);',
                    },
                  ],
                },
                {
                  btType: "BTMParameterQueryList-148",
                  parameterId: "axis",
                  queries: [
                    {
                      queryString:
                        'query=qCompressed(1.0,"$operationId$S_PROFILEwireOp$queryType$SKETCH_ENTITY$sketchEntityId$axis_line",id);',
                    },
                  ],
                },
                {
                  btType: "BTMParameterEnum-145",
                  parameterId: "revolveType",
                  value: "ONE_DIRECTION",
                },
                {
                  btType: "BTMParameterBoolean-144",
                  parameterId: "oppositeDirection",
                  value: false,
                },
                {
                  btType: "BTMParameterQuantity-147",
                  parameterId: "angle",
                  expression: "#turns * 30 deg",
                  value: Math.PI / 6,
                },
              ],
            },
          ],
        },
        sketches: {
          sketches: [
            {
              featureId: "S_PROFILE",
              entities: [
                {
                  sketchEntityId: "profile_circle",
                  sketchEntityType: "skCircle",
                  geometry: {
                    center3d: { x: 0.01, y: 0, z: 0 },
                    radius: 0.004,
                  },
                  isConstruction: false,
                },
                {
                  sketchEntityId: "axis_line",
                  sketchEntityType: "skLineSegment",
                  startPosition3d: { x: 0, y: -0.01, z: 0 },
                  endPosition3d: { x: 0, y: 0.01, z: 0 },
                  isConstruction: true,
                },
              ],
            },
          ],
        },
        parts: null,
        featureSpecs: {
          present: true,
          response: {
            btType: "BTFeatureSpecsResponse-664",
            featureSpecs: [
              {
                btType: "BTFeatureSpec-129",
                featureType: "revolve",
                featureTypeName: "Revolve",
                parameters: [
                  { parameterId: "entities", btType: "BTParameterSpecQuery-174" },
                  { parameterId: "axis", btType: "BTParameterSpecQuery-174" },
                  {
                    parameterId: "revolveType",
                    btType: "BTParameterSpecEnum-171",
                    defaultValue: { value: "FULL" },
                  },
                  {
                    parameterId: "angle",
                    btType: "BTParameterSpecQuantity-173",
                    defaultValue: { value: 30, units: "degree" },
                  },
                ],
              },
            ],
          },
        },
        resolvedReferences: [
          {
            deterministicId: "Top",
            evaluatedAt: "finalState",
            signature: {
              entityClass: "face",
              geometryType: "plane",
              definingData: { normal: [0, 0, 1] },
              isDefaultPlane: true,
            },
          },
        ],
        groundTruth: { hasBodies: false },
        rollbackSnapshots: null,
      },
    ],
  };
}

/** CI-safe v1 envelope for a cut revolve whose profile and axis live in different sketches. */
export function makeWaveARevolveBreadthCaptureBundle() {
  const bundle = makeWaveARevolveCaptureBundle();
  const studio = bundle.partStudios[0]!;
  studio.name = "Wave A revolve breadth";
  studio.features.features = [
    {
      featureType: "newSketch",
      featureId: "S_BASE",
      name: "Base profile",
      parameters: [
        {
          btType: "BTMParameterQueryList-148",
          parameterId: "sketchPlane",
          queries: [{ deterministicIds: ["Top"] }],
        },
      ],
    },
    {
      featureType: "extrude",
      featureId: "F_BASE",
      name: "Base extrude",
      parameters: [
        { btType: "BTMParameterEnum-145", parameterId: "bodyType", value: "SOLID" },
        { btType: "BTMParameterEnum-145", parameterId: "operationType", value: "NEW" },
        {
          btType: "BTMParameterQueryList-148",
          parameterId: "entities",
          queries: [{ queryString: 'query = qSketchRegion(id + "S_BASE", true);' }],
        },
        { btType: "BTMParameterEnum-145", parameterId: "endBound", value: "BLIND" },
        { btType: "BTMParameterQuantity-147", parameterId: "depth", expression: "20 mm", value: 0.02 },
      ],
    },
    {
      featureType: "newSketch",
      featureId: "S_PROFILE",
      name: "Cut profile",
      parameters: [
        {
          btType: "BTMParameterQueryList-148",
          parameterId: "sketchPlane",
          queries: [{ deterministicIds: ["Top"] }],
        },
      ],
    },
    {
      featureType: "newSketch",
      featureId: "S_AXIS",
      name: "Remote axis",
      parameters: [
        {
          btType: "BTMParameterQueryList-148",
          parameterId: "sketchPlane",
          queries: [{ deterministicIds: ["Top"] }],
        },
      ],
    },
    {
      featureType: "revolve",
      featureId: "F_REVOLVE",
      name: "Two-side cut revolve",
      parameters: [
        { btType: "BTMParameterEnum-145", parameterId: "bodyType", value: "SOLID" },
        { btType: "BTMParameterEnum-145", parameterId: "operationType", value: "REMOVE" },
        {
          btType: "BTMParameterQueryList-148",
          parameterId: "entities",
          queries: [{ queryString: 'query = qSketchRegion(id + "S_PROFILE", true);' }],
        },
        {
          btType: "BTMParameterQueryList-148",
          parameterId: "axis",
          queries: [{
            queryString:
              'query=qCompressed(1.0,"$operationId$S_AXISwireOp$queryType$SKETCH_ENTITY$sketchEntityId$axis_line",id);',
          }],
        },
        { btType: "BTMParameterBoolean-144", parameterId: "fullRevolve", value: false },
        { btType: "BTMParameterEnum-145", parameterId: "endBound", value: "BLIND" },
        { btType: "BTMParameterQuantity-147", parameterId: "angle", expression: "60 deg", value: Math.PI / 3 },
        { btType: "BTMParameterBoolean-144", parameterId: "oppositeDirection", value: false },
        { btType: "BTMParameterBoolean-144", parameterId: "hasSecondDirection", value: true },
        { btType: "BTMParameterEnum-145", parameterId: "secondDirectionBound", value: "BLIND" },
        { btType: "BTMParameterQuantity-147", parameterId: "secondDirectionAngle", expression: "30 deg", value: Math.PI / 6 },
        { btType: "BTMParameterBoolean-144", parameterId: "secondDirectionOppositeDirection", value: true },
        { btType: "BTMParameterBoolean-144", parameterId: "defaultScope", value: false },
        {
          btType: "BTMParameterQueryList-148",
          parameterId: "booleanScope",
          queries: [{ queryString: 'query = qCreatedBy(id + "F_BASE", EntityType.BODY);' }],
        },
      ],
    },
  ];
  (studio as { profileEvidence?: unknown }).profileEvidence = [{
    consumingFeatureId: "F_BASE",
    parameterId: "entities",
    queryIndex: 0,
    resultIndex: 0,
    deterministicId: "wave-a-base-profile",
    evaluatedAt: "historyPoint",
    kind: "sketchRegion",
    sourceSketchFeatureId: "S_BASE",
    interiorPoint3d: [0, 0, 0],
  }];
  studio.sketches.sketches = [
    {
      featureId: "S_BASE",
      entities: [
        {
          sketchEntityId: "base_circle",
          sketchEntityType: "skCircle",
          geometry: { center3d: { x: 0, y: 0, z: 0 }, radius: 0.012 },
          isConstruction: false,
        },
      ],
    },
    {
      featureId: "S_PROFILE",
      entities: [
        {
          sketchEntityId: "cut_circle",
          sketchEntityType: "skCircle",
          geometry: { center3d: { x: 0.007, y: 0, z: 0 }, radius: 0.004 },
          isConstruction: false,
        },
      ],
    },
    {
      featureId: "S_AXIS",
      entities: [
        {
          sketchEntityId: "axis_line",
          sketchEntityType: "skLineSegment",
          startPosition3d: { x: 0, y: -0.02, z: 0 },
          endPosition3d: { x: 0, y: 0.02, z: 0 },
          isConstruction: true,
        },
      ],
    },
  ];
  return bundle;
}
