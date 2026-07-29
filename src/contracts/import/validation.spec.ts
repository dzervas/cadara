import { test, expect } from "vitest";

import { IMPORT_CONTRACT_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import {
  validateImportBinding,
  validateImportPreparedActions,
  validateImportSource,
  validateResolvedImportSource,
} from "@/contracts/import/validation";

test("src/contracts/import/validation.spec.ts", async () => {
  const importSourceResult = validateImportSource({
    kind: "localFile",
    fileName: "bracket.step",
    pathHint: "/workspace/bracket.step",
  });
  expect(
    importSourceResult.success,
    "Import source schema should accept local file sources.",
  ).toBeTruthy();

  const resolvedSourceResult = validateResolvedImportSource({
    name: "bracket.step",
    origin: {
      kind: "url",
      url: "https://example.com/bracket.step",
    },
    mediaType: "model/step",
    bytes: new Uint8Array([1, 2, 3, 4]),
    fingerprint: `sha256:${"a".repeat(64)}`,
  });
  expect(
    resolvedSourceResult.success,
    "Resolved import source schema should accept fetched byte payloads.",
  ).toBeTruthy();

  const bindingResult = validateImportBinding({
    schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
    kind: "cloudObject",
    service: "drive",
    objectId: "object-123",
    versionId: "v5",
    fingerprint: `sha256:${"b".repeat(64)}`,
    refreshPolicy: "manual",
  });
  expect(
    bindingResult.success,
    "Import binding schema should accept portable cloud object bindings.",
  ).toBeTruthy();

  const preparedActionsResult = validateImportPreparedActions({
    addDocumentVariables: [
      {
        contractVersion: "modeling-contract/v1alpha1",
        documentId: "doc_workspace",
        baseRevisionId: "rev_1",
        variableId: "variable_imported_pitch",
        name: "pitch",
        valueText: "42 mm",
      },
    ],
    binding: {
      schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
      kind: "url",
      url: "https://example.com/bracket.step",
      fingerprint: `sha256:${"c".repeat(64)}`,
      refreshPolicy: "manual",
    },
    diagnostics: [
      {
        severity: "warning",
        message: "Ignored unsupported metadata block.",
        code: "metadata-skipped",
      },
    ],
  });
  expect(
    preparedActionsResult.success,
    "Prepared action schema should accept adapter request payloads and import diagnostics.",
  ).toBeTruthy();

  expect(
    validateImportSource({ kind: "url", url: "not-a-url" }).success,
    "Import source validation should reject malformed URL sources.",
  ).toBeFalsy();
  expect(
    validateImportSource({ kind: "localFile", fileName: "   " }).success,
    "Import source validation should reject empty local file names.",
  ).toBeFalsy();
  expect(
    validateResolvedImportSource({
      name: "bracket.step",
      origin: { kind: "url", url: "https://example.com/bracket.step" },
      mediaType: "model/step",
      bytes: new Uint8Array([1, 2, 3, 4]),
      fingerprint: "sha256:not64hex",
    }).success,
    "Resolved import source validation should reject malformed fingerprints.",
  ).toBeFalsy();
  expect(
    validateImportBinding({
      schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
      kind: "url",
      url: "not-a-url",
      fingerprint: `sha256:${"d".repeat(64)}`,
      refreshPolicy: "manual",
    }).success,
    "Import binding validation should reject malformed URL bindings.",
  ).toBeFalsy();
  expect(
    validateImportBinding({
      schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
      kind: "cloudObject",
      service: "",
      objectId: "object-123",
      fingerprint: `sha256:${"e".repeat(64)}`,
      refreshPolicy: "manual",
    }).success,
    "Import binding validation should reject empty cloud binding service names.",
  ).toBeFalsy();
  expect(
    validateImportPreparedActions({
      binding: {
        schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
        kind: "url",
        url: "https://example.com/bracket.step",
        fingerprint: "sha256:not64hex",
        refreshPolicy: "manual",
      },
    }).success,
    "Prepared action validation should reject invalid nested import bindings.",
  ).toBeFalsy();

  const variableRequest = (name: string) => ({
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    variableId: `variable_${name}`,
    name,
    valueText: "10 mm",
  });


  const sketchRequest = () => ({
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    solverCorrelation: null,
    sketchId: null,
    sketchLabel: "Imported sketch",
    plane: {
      support: { kind: "construction" as const, constructionId: "construction_plane-xy" },
      frame: {
        origin: [0, 0, 0] as const,
        xAxis: [1, 0, 0] as const,
        yAxis: [0, 1, 0] as const,
        normal: [0, 0, 1] as const,
        linearUnit: "documentLength" as const,
        handedness: "rightHanded" as const,
      },
      key: "xy",
    },
    definition: {
      schemaVersion: "sketch-definition/v1alpha1" as const,
      referenceIds: [],
      references: [],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
      styleIds: [],
      styles: [],
      svgRenderingEnabled: true,
      derivedRelationships: [],
      authoringOperations: [],
    },
  });

  const extrudeRequest = (profileActionIndex: number, bodyActionIndex?: number) => ({
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    featureLabel: "Imported extrude",
    definition: {
      kind: "extrude" as const,
      featureTypeVersion: "feature-type/extrude/v1alpha2" as const,
      parameters: {
        resultBodyType: "solid",
        profiles: [
          {
            kind: "regionOf" as const,
            actionIndex: profileActionIndex,
            selector: { kind: "interiorPoint" as const, point: [0.5, 0.5] as const },
          },
        ],
        startExtent: { kind: "profilePlane" as const },
        extent: {
          mode: "oneSide" as const,
          end: {
            kind: "blind" as const,
            direction: "positive" as const,
            distance: { source: "literal" as const, value: 10 },
          },
        },
        operation: { source: "literal" as const, value: bodyActionIndex === undefined ? "newBody" as const : "cut" as const },
        booleanScope:
          bodyActionIndex === undefined
            ? { kind: "standalone" as const }
            : {
                kind: "targetBody" as const,
                bodyId: { kind: "bodyOf" as const, actionIndex: bodyActionIndex },
              },
      },
    },
  });

  expect(
    validateImportPreparedActions({
      addDocumentVariables: [variableRequest("a"), variableRequest("b")],
      orderedActions: [
        { kind: "addDocumentVariable", index: 1 },
        { kind: "addDocumentVariable", index: 0 },
      ],
    }).success,
    "Prepared action validation should accept an ordered sequence that permutes every prepared action once.",
  ).toBeTruthy();

  expect(
    validateImportPreparedActions({
      addDocumentVariables: [variableRequest("a"), variableRequest("b")],
      orderedActions: [{ kind: "addDocumentVariable", index: 0 }],
    }).success,
    "Prepared action validation should reject an ordered sequence that omits a prepared action.",
  ).toBeFalsy();

  expect(
    validateImportPreparedActions({
      addDocumentVariables: [variableRequest("a")],
      orderedActions: [
        { kind: "addDocumentVariable", index: 0 },
        { kind: "addDocumentVariable", index: 0 },
      ],
    }).success,
    "Prepared action validation should reject an ordered sequence that duplicates a prepared action.",
  ).toBeFalsy();

  expect(
    validateImportPreparedActions({
      addDocumentVariables: [variableRequest("a")],
      orderedActions: [{ kind: "addDocumentVariable", index: 5 }],
    }).success,
    "Prepared action validation should reject an ordered sequence with an out-of-range index.",
  ).toBeFalsy();


  const deferredRegionResult = validateImportPreparedActions({
    commitSketches: [sketchRequest()],
    createFeatures: [extrudeRequest(0)],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
    ],
  });
  expect(
    deferredRegionResult.success,
    "Prepared action validation should accept blessed deferred region references to earlier sketch commits.",
  ).toBeTruthy();

  expect(
    validateImportPreparedActions({
      commitSketches: [sketchRequest()],
      createFeatures: [extrudeRequest(1)],
      orderedActions: [
        { kind: "commitSketch", index: 0 },
        { kind: "createFeature", index: 0 },
      ],
    }).success,
    "Prepared action validation should reject forward deferred references.",
  ).toBeFalsy();

  expect(
    validateImportPreparedActions({
      addDocumentVariables: [variableRequest("producer")],
      createFeatures: [extrudeRequest(0)],
      orderedActions: [
        { kind: "addDocumentVariable", index: 0 },
        { kind: "createFeature", index: 0 },
      ],
    }).success,
    "Prepared action validation should reject deferred references to the wrong producer kind.",
  ).toBeFalsy();

  expect(
    validateImportPreparedActions({
      commitSketches: [sketchRequest()],
      createFeatures: [extrudeRequest(5)],
      orderedActions: [
        { kind: "commitSketch", index: 0 },
        { kind: "createFeature", index: 0 },
      ],
    }).success,
    "Prepared action validation should reject deferred references outside the ordered sequence.",
  ).toBeFalsy();

  expect(
    validateImportPreparedActions({
      commitSketches: [sketchRequest()],
      createFeatures: [
        {
          ...extrudeRequest(0),
          definition: {
            ...extrudeRequest(0).definition,
            parameters: {
              ...extrudeRequest(0).definition.parameters,
              profiles: [{ kind: "sketchIdOf" as const, actionIndex: 0 }],
            },
          },
        },
      ],
      orderedActions: [
        { kind: "commitSketch", index: 0 },
        { kind: "createFeature", index: 0 },
      ],
    }).success,
    "Prepared action validation should reject deferred values at non-blessed positions for their kind.",
  ).toBeFalsy();

  const directProfile = {
    kind: "region" as const,
    sketchId: "sketch_profile",
    regionId: "region_profile",
  };
  const deferredFaceTarget = {
    kind: "topologyOf" as const,
    expectedKind: "face" as const,
    capturedSignature: { entityClass: "face" as const, geometryType: "plane" },
    tolerance: {
      linear: 0.01,
      angularRadians: 0.01,
      relative: 0.001,
      ambiguityMargin: 0.25,
    },
    source: {
      consumerFeatureId: "EXTRUDE_FACE",
      parameterId: "endBoundEntityFace",
      deterministicId: "face_1",
    },
  };
  const deferredFaceExtrude = {
    ...extrudeRequest(0),
    definition: {
      ...extrudeRequest(0).definition,
      parameters: {
        ...extrudeRequest(0).definition.parameters,
        profiles: [directProfile],
        extent: {
          mode: "oneSide" as const,
          end: {
            kind: "upToFace" as const,
            direction: "positive" as const,
            target: deferredFaceTarget,
          },
        },
      },
    },
  };
  expect(
    validateImportPreparedActions({
      createFeatures: [
        {
          ...deferredFaceExtrude,
          definition: {
            ...deferredFaceExtrude.definition,
            parameters: {
              ...deferredFaceExtrude.definition.parameters,
              extent: {
                mode: "oneSide",
                end: {
                  kind: "blind",
                  direction: "positive",
                  distance: { source: "literal", value: 10 },
                },
              },
            },
          },
        },
        deferredFaceExtrude,
      ],
      orderedActions: [
        { kind: "createFeature", index: 0 },
        { kind: "createFeature", index: 1 },
      ],
    }).success,
    "Prepared action validation should accept a deferred upToFace target after its producer.",
  ).toBeTruthy();

  expect(
    validateImportPreparedActions({
      createFeatures: [
        {
          ...deferredFaceExtrude,
          definition: {
            ...deferredFaceExtrude.definition,
            parameters: {
              ...deferredFaceExtrude.definition.parameters,
              extent: {
                mode: "oneSide" as const,
                end: {
                  kind: "upToFace" as const,
                  direction: "positive" as const,
                  target: { ...deferredFaceTarget, expectedKind: "body" as const },
                },
              },
            },
          },
        },
      ],
    }).success,
    "Prepared action validation should reject deferred end targets with the wrong expected kind.",
  ).toBeFalsy();

  expect(
    validateImportPreparedActions({
      createFeatures: [
        {
          ...deferredFaceExtrude,
          definition: {
            ...deferredFaceExtrude.definition,
            parameters: {
              ...deferredFaceExtrude.definition.parameters,
              extent: {
                mode: "oneSide" as const,
                end: {
                  kind: "upToFace" as const,
                  direction: "positive" as const,
                  target: { kind: "topologySlot" as const, slotKey: "firstEndFace" },
                },
              },
            },
          },
        },
      ],
    }).success,
    "Prepared action validation should reject planner-only topologySlot targets.",
  ).toBeFalsy();

  expect(
    validateImportPreparedActions({
      commitSketches: [sketchRequest()],
      createFeatures: [extrudeRequest(0), extrudeRequest(0, 1)],
      orderedActions: [
        { kind: "commitSketch", index: 0 },
        { kind: "createFeature", index: 0 },
        { kind: "createFeature", index: 1 },
      ],
    }).success,
    "Prepared action validation should accept blessed deferred body references to earlier feature actions.",
  ).toBeTruthy();

  const planeRequest = () => ({
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    featureLabel: "Imported plane",
    definition: {
      kind: "plane" as const,
      featureTypeVersion: "feature-type/plane/v1alpha1" as const,
      parameters: {
        mode: "explicitFrame" as const,
        frame: {
          origin: [0, 0, 5] as const,
          xAxis: [1, 0, 0] as const,
          yAxis: [0, 1, 0] as const,
          normal: [0, 0, 1] as const,
          linearUnit: "documentLength" as const,
          handedness: "rightHanded" as const,
        },
      },
    },
  });

  const sketchOnConstruction = (actionIndex: number) => ({
    ...sketchRequest(),
    plane: {
      ...sketchRequest().plane,
      support: { kind: "constructionOf" as const, actionIndex },
    },
  });

  // Happy path: a plane feature followed by a sketch whose support defers to it.
  expect(
    validateImportPreparedActions({
      createFeatures: [planeRequest()],
      commitSketches: [sketchOnConstruction(0)],
      orderedActions: [
        { kind: "createFeature", index: 0 },
        { kind: "commitSketch", index: 0 },
      ],
    }).success,
    "Prepared action validation should accept a sketch whose plane support defers to an earlier plane feature.",
  ).toBeTruthy();

  // Forward reference is rejected.
  expect(
    validateImportPreparedActions({
      createFeatures: [planeRequest()],
      commitSketches: [sketchOnConstruction(1)],
      orderedActions: [
        { kind: "commitSketch", index: 0 },
        { kind: "createFeature", index: 0 },
      ],
    }).success,
    "Prepared action validation should reject a constructionOf reference that points forward.",
  ).toBeFalsy();

  // Wrong producer kind (points at a sketch commit, not a feature) is rejected.
  expect(
    validateImportPreparedActions({
      commitSketches: [sketchRequest(), sketchOnConstruction(0)],
      orderedActions: [
        { kind: "commitSketch", index: 0 },
        { kind: "commitSketch", index: 1 },
      ],
    }).success,
    "Prepared action validation should reject a constructionOf reference to a non-feature producer.",
  ).toBeFalsy();

  const probedFaceSupport = {
    kind: "topologyOf" as const,
    expectedKind: "face" as const,
    capturedSignature: {
      entityClass: "face" as const,
      geometryType: "plane",
    } as never,
    tolerance: {
      linear: 0.01,
      angularRadians: 0.01,
      relative: 0.001,
      ambiguityMargin: 0.25,
    },
    source: {
      consumerFeatureId: "S_FACE",
      parameterId: "sketchPlane",
      deterministicId: "face_1",
    },
  };
  const sketchOnProbedFace = () => ({
    ...sketchRequest(),
    plane: { ...sketchRequest().plane, support: probedFaceSupport },
  });

  // Happy path: a probed-face topologyOf support that follows a producer feature.
  expect(
    validateImportPreparedActions({
      createFeatures: [planeRequest()],
      commitSketches: [sketchOnProbedFace()],
      orderedActions: [
        { kind: "createFeature", index: 0 },
        { kind: "commitSketch", index: 0 },
      ],
    }).success,
    "Prepared action validation should accept a topologyOf face support following a producer feature.",
  ).toBeTruthy();

  // A topologyOf support with no earlier producer feature is rejected.
  expect(
    validateImportPreparedActions({
      commitSketches: [sketchOnProbedFace()],
      orderedActions: [{ kind: "commitSketch", index: 0 }],
    }).success,
    "Prepared action validation should reject a topologyOf sketch support with no earlier producer feature.",
  ).toBeFalsy();

  // A non-face topologyOf sketch support is rejected.
  expect(
    validateImportPreparedActions({
      createFeatures: [planeRequest()],
      commitSketches: [
        {
          ...sketchRequest(),
          plane: {
            ...sketchRequest().plane,
            support: { ...probedFaceSupport, expectedKind: "body" as const },
          },
        },
      ],
      orderedActions: [
        { kind: "createFeature", index: 0 },
        { kind: "commitSketch", index: 0 },
      ],
    }).success,
    "Prepared action validation should reject a non-face topologyOf sketch-plane support.",
  ).toBeFalsy();
});


test("validates deferred revolve boolean scope and advanced construction participants", () => {
  const planeRequest = {
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    featureLabel: "Plane",
    definition: {
      kind: "plane" as const,
      featureTypeVersion: "feature-type/plane/v1alpha1" as const,
      parameters: {
        mode: "explicitFrame" as const,
        frame: {
          origin: [0, 0, 0] as const,
          xAxis: [1, 0, 0] as const,
          yAxis: [0, 1, 0] as const,
          normal: [0, 0, 1] as const,
          linearUnit: "documentLength" as const,
          handedness: "rightHanded" as const,
        },
      },
    },
  };
  const sketchRequest = {
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    solverCorrelation: null,
    sketchId: null,
    sketchLabel: "Sketch",
    plane: {
      support: { kind: "construction" as const, constructionId: "construction_plane-xy" },
      frame: planeRequest.definition.parameters.frame,
      key: "xy" as const,
    },
    definition: {
      schemaVersion: "sketch-definition/v1alpha1" as const,
      referenceIds: [], references: [], pointIds: [], points: [], entityIds: [], entities: [],
      constraintIds: [], constraints: [], dimensionIds: [], dimensions: [], styleIds: [], styles: [],
      svgRenderingEnabled: true, derivedRelationships: [], authoringOperations: [],
    },
  };
  const revolve = {
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    featureLabel: "Cut revolve",
    definition: {
      kind: "revolve" as const,
      featureTypeVersion: "feature-type/revolve/v1alpha2" as const,
      parameters: {
        resultBodyType: "solid",
        profiles: [{ kind: "regionOf" as const, actionIndex: 0, selector: { kind: "interiorPoint" as const, point: [0, 0] as const } }],
        axis: { kind: "sketchEntity" as const, sketchId: { kind: "sketchIdOf" as const, actionIndex: 0 }, entityId: "sketch_entity_axis" },
        startAngle: { source: "literal" as const, value: 0 },
        extent: { mode: "oneSide" as const, end: { kind: "full" as const } },
        operation: { source: "literal" as const, value: "cut" as const },
        booleanScope: { kind: "targetBody" as const, bodyId: { kind: "bodyOf" as const, actionIndex: 1 } },
      },
    },
  };
  const mirror = {
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    featureLabel: "Mirror",
    definition: {
      kind: "mirror" as const,
      featureTypeVersion: "advanced-solid-feature/v0" as const,
      parameters: {
        participants: [{ role: "plane" as const, targets: [{ kind: "constructionOf" as const, actionIndex: 1 }] }],
        options: { copy: true },
      },
    },
  };

  const result = validateImportPreparedActions({
    commitSketches: [sketchRequest],
    createFeatures: [planeRequest, revolve, mirror],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
      { kind: "createFeature", index: 1 },
      { kind: "createFeature", index: 2 },
    ],
  });
  expect(result.success, JSON.stringify(result.issues)).toBe(true);
});


test("validates deferred advanced sketch-point participant sketch producers", () => {
  const sketchRequest = {
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    solverCorrelation: null,
    sketchId: null,
    sketchLabel: "Hole sketch",
    plane: {
      support: { kind: "construction" as const, constructionId: "construction_plane-xy" },
      frame: {
        origin: [0, 0, 0] as const,
        xAxis: [1, 0, 0] as const,
        yAxis: [0, 1, 0] as const,
        normal: [0, 0, 1] as const,
        linearUnit: "documentLength" as const,
        handedness: "rightHanded" as const,
      },
      key: "xy" as const,
    },
    definition: {
      schemaVersion: "sketch-definition/v1alpha1" as const,
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_hole_center"],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
      styleIds: [],
      styles: [],
      svgRenderingEnabled: true,
      derivedRelationships: [],
      authoringOperations: [],
    },
  };
  const planeRequest = {
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    featureLabel: "Plane",
    definition: {
      kind: "plane" as const,
      featureTypeVersion: "feature-type/plane/v1alpha1" as const,
      parameters: {
        mode: "explicitFrame" as const,
        frame: sketchRequest.plane.frame,
      },
    },
  };
  const holeRequest = (actionIndex: number) => ({
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    featureLabel: "Hole",
    definition: {
      kind: "hole" as const,
      featureTypeVersion: "advanced-solid-feature/v0" as const,
      parameters: {
        participants: [
          {
            role: "location" as const,
            targets: [
              {
                kind: "sketchPoint" as const,
                sketchId: { kind: "sketchIdOf" as const, actionIndex },
                pointId: "sketch_point_hole_center" as const,
              },
            ],
          },
          { role: "body" as const, targets: [{ kind: "body" as const, bodyId: "body_target" }] },
        ],
      },
    },
  });

  expect(
    validateImportPreparedActions({
      commitSketches: [sketchRequest],
      createFeatures: [holeRequest(0)],
      orderedActions: [
        { kind: "commitSketch", index: 0 },
        { kind: "createFeature", index: 0 },
      ],
    }).success,
    "Prepared action validation should accept deferred sketchPoint targets from earlier sketch commits.",
  ).toBe(true);

  for (const { name, actions } of [
    {
      name: "forward",
      actions: {
        commitSketches: [sketchRequest],
        createFeatures: [holeRequest(1)],
        orderedActions: [
          { kind: "createFeature" as const, index: 0 },
          { kind: "commitSketch" as const, index: 0 },
        ],
      },
    },
    {
      name: "self",
      actions: {
        commitSketches: [sketchRequest],
        createFeatures: [holeRequest(1)],
        orderedActions: [
          { kind: "commitSketch" as const, index: 0 },
          { kind: "createFeature" as const, index: 0 },
        ],
      },
    },
    {
      name: "missing",
      actions: {
        commitSketches: [sketchRequest],
        createFeatures: [holeRequest(9)],
        orderedActions: [
          { kind: "commitSketch" as const, index: 0 },
          { kind: "createFeature" as const, index: 0 },
        ],
      },
    },
    {
      name: "wrong producer kind",
      actions: {
        createFeatures: [planeRequest, holeRequest(0)],
        orderedActions: [
          { kind: "createFeature" as const, index: 0 },
          { kind: "createFeature" as const, index: 1 },
        ],
      },
    },
    {
      name: "ordered cardinality",
      actions: {
        commitSketches: [sketchRequest],
        createFeatures: [holeRequest(0)],
        orderedActions: [
          { kind: "commitSketch" as const, index: 0 },
          { kind: "commitSketch" as const, index: 0 },
        ],
      },
    },
  ]) {
    expect(
      validateImportPreparedActions(actions).success,
      `Prepared action validation should reject ${name} deferred sketchPoint producer references.`,
    ).toBe(false);
  }
});

// Lane: logic (per docs/testing.md — contract validation seam).
// Seam: prepared surface extrude actions accept deferred open sketch-curve
// profiles only through `sketchIdOf`, and carry no boolean state.
test("validates deferred open sketch-curve profiles on surface extrude actions", () => {
  const sketchRequest = {
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    solverCorrelation: null,
    sketchId: null,
    sketchLabel: "Open chain",
    plane: {
      support: { kind: "construction" as const, constructionId: "construction_plane-xy" },
      frame: {
        origin: [0, 0, 0] as const,
        xAxis: [1, 0, 0] as const,
        yAxis: [0, 1, 0] as const,
        normal: [0, 0, 1] as const,
        linearUnit: "documentLength" as const,
        handedness: "rightHanded" as const,
      },
      key: "xy" as const,
    },
    definition: {
      schemaVersion: "sketch-definition/v1alpha1" as const,
      referenceIds: [], references: [], pointIds: [], points: [], entityIds: [], entities: [],
      constraintIds: [], constraints: [], dimensionIds: [], dimensions: [], styleIds: [], styles: [],
      svgRenderingEnabled: true, derivedRelationships: [], authoringOperations: [],
    },
  };
  const surfaceExtrude = (sketchId: unknown) => ({
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    featureLabel: "Extrude 4",
    definition: {
      kind: "extrude" as const,
      featureTypeVersion: "feature-type/extrude/v1alpha2" as const,
      parameters: {
        resultBodyType: "surface",
        profiles: [{ kind: "sketchEntity" as const, sketchId, entityId: "sketch_entity_open" }],
        startExtent: { kind: "profilePlane" as const },
        extent: {
          mode: "oneSide" as const,
          end: {
            kind: "blind" as const,
            direction: "positive" as const,
            distance: { source: "literal" as const, value: 10 },
          },
        },
      },
    },
  });
  const orderedActions = [
    { kind: "commitSketch" as const, index: 0 },
    { kind: "createFeature" as const, index: 0 },
  ];

  const accepted = validateImportPreparedActions({
    commitSketches: [sketchRequest],
    createFeatures: [surfaceExtrude({ kind: "sketchIdOf", actionIndex: 0 })],
    orderedActions,
  });
  expect(accepted.success, JSON.stringify(accepted.issues)).toBe(true);

  for (const [name, sketchId] of [
    ["forward reference", { kind: "sketchIdOf", actionIndex: 1 }],
    ["wrong deferred kind", { kind: "bodyOf", actionIndex: 0 }],
  ] as const) {
    expect(
      validateImportPreparedActions({
        commitSketches: [sketchRequest],
        createFeatures: [surfaceExtrude(sketchId)],
        orderedActions,
      }).success,
      `Prepared action validation should reject a ${name} open sketch-curve profile.`,
    ).toBe(false);
  }

  const withBooleanState = validateImportPreparedActions({
    commitSketches: [sketchRequest],
    createFeatures: [{
      ...surfaceExtrude({ kind: "sketchIdOf", actionIndex: 0 }),
      definition: {
        ...surfaceExtrude({ kind: "sketchIdOf", actionIndex: 0 }).definition,
        parameters: {
          ...surfaceExtrude({ kind: "sketchIdOf", actionIndex: 0 }).definition.parameters,
          operation: { source: "literal", value: "newBody" },
          booleanScope: { kind: "standalone" },
        },
      },
    }],
    orderedActions,
  });
  expect(
    withBooleanState.success,
    "A surface extrude action must not carry boolean operation state.",
  ).toBe(false);
});
