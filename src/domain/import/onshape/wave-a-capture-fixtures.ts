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
