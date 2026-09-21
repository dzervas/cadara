import { createReferenceImageFixture as createReferenceImageOperation } from "@/domain/reference-image/operation-test-fixtures";
import { test, expect } from "vitest";

import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  acceptSketchDraw,
  appendReferenceImageOperations,
  beginSketchTool,
  createSketchSessionFromSnapshot,
  createNewSketchSession,
  deleteSelectedSketchGeometry,
  getSketchSessionDisplayRenderables,
  startSketchDraw,
  updateReferenceImageOperationStates,
} from "@/domain/editor/sketch-session";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import {
  REFERENCE_IMAGE_CALIBRATION_MODE_ID,
  type ReferenceImageCalibrationModeState,
} from "@/domain/reference-image-calibration/mode/shared";
import { solveReferenceImageOperationState } from "@/domain/reference-image-calibration/state";

function loadCapturedReferenceImageSketchFixture() {
  const sketch = {
    sketchId: "sketch_primary",
    label: "Sketch Draft",
    plane: createStandardPlaneDefinition("xy"),
    planeTarget: {
      kind: "construction" as const,
      constructionId: "construction_plane-xy",
    },
    planeKey: "xy" as const,
    definition: {
      schemaVersion: "sketch-definition/v1alpha1" as const,
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1",
        "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2",
      ],
      points: [
        {
          pointId:
            "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1",
          label: "Anchor 1",
          target: {
            kind: "sketchPoint" as const,
            sketchId: "sketch_primary",
            pointId:
              "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1",
          },
          position: [66.07556708127112, 23.759903721283415] as const,
          isConstruction: true,
        },
        {
          pointId:
            "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2",
          label: "Anchor 2",
          target: {
            kind: "sketchPoint" as const,
            sketchId: "sketch_primary",
            pointId:
              "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2",
          },
          position: [66.75807778062575, -22.650823834832128] as const,
          isConstruction: true,
        },
      ],
      entityIds: [
        "sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1_point",
        "sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2_point",
      ],
      entities: [
        {
          kind: "point" as const,
          entityId:
            "sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1_point",
          label: "Anchor 1",
          target: {
            kind: "sketchEntity" as const,
            sketchId: "sketch_primary",
            entityId:
              "sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1_point",
          },
          isConstruction: true,
          pointId:
            "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1",
        },
        {
          kind: "point" as const,
          entityId:
            "sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2_point",
          label: "Anchor 2",
          target: {
            kind: "sketchEntity" as const,
            sketchId: "sketch_primary",
            entityId:
              "sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2_point",
          },
          isConstruction: true,
          pointId:
            "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2",
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
      styleIds: [],
      styles: [],
      svgRenderingEnabled: true,
      derivedRelationships: [],
      referenceImages: [
        {
          operationId: "sketch_operation_1_reference-image",
          label: "cadara-mock.png",
          kind: "referenceImage" as const,
          ownedPointIds: [
            "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1",
            "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2",
          ],
          ownedEntityIds: [
            "sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1_point",
            "sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2_point",
          ],
          ownedState: {
            kind: "referenceImage" as const,
            image: {
              mediaType: "image/png",
              fileName: "cadara-mock.png",
              pixelWidth: 1254,
              pixelHeight: 1254,
              base64Data: "fixture-image-data",
            },
            placement: {
              center: [0, 0] as const,
              width: 199.99999999999994,
              height: 199.99999999999994,
              rotationRadians: 0,
            },
            calibration: {
              scaleMode: "lockedAspect" as const,
              showExportedAnchorsInSketch: true,
              anchors: [
                {
                  anchorId: "sketch_operation_1_reference-image_anchor_1",
                  label: "Anchor 1",
                  uv: [0.8303778354063556, 0.3812004813935829] as const,
                  pointId:
                    "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1",
                },
                {
                  anchorId: "sketch_operation_1_reference-image_anchor_2",
                  label: "Anchor 2",
                  uv: [0.8337903889031288, 0.6132541191741606] as const,
                  pointId:
                    "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2",
                },
              ],
            },
          },
        },
      ],
    },
  };

  const solved = solveSketchDefinitionCore({
    definition: sketch.definition,
    projectedReferences: [],
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: "bestEffort",
  });

  return {
    ownerDocumentId: "doc_fixture",
    ownerRevisionId: "rev_fixture",
    ownerFeatureId: null,
    ownerSketchId: sketch.sketchId,
    ownerBodyId: null,
    sketchId: sketch.sketchId,
    label: sketch.label,
    plane: sketch.plane,
    planeTarget: sketch.planeTarget,
    planeKey: sketch.planeKey,
    sketch: {
      ownerDocumentId: "doc_fixture",
      ownerRevisionId: "rev_fixture",
      ownerFeatureId: null,
      ownerSketchId: sketch.sketchId,
      ownerBodyId: null,
      sketchId: sketch.sketchId,
      label: sketch.label,
      planeSupport: sketch.planeTarget,
      definition: sketch.definition,
      solvedSnapshot: solved.solvedSnapshot,
      derivedValidity: { state: "current", diagnostics: [] },
      regions: [],
    },
    solvedSketch: solved,
    projectedReferences: [],
  };
}

test("src/domain/editor/reference-image-operations.spec.ts keeps reference-image state authored while rendering the latest payload", () => {
  const plane = createStandardPlaneDefinition("xy");
  const session = appendReferenceImageOperations(
    createNewSketchSession(plane),
    [
      createReferenceImageOperation({
        sequence: 1,
        sketchId: "sketch_draft",
        payload: {
          mediaType: "image/png",
          fileName: "reference-a.png",
          pixelWidth: 400,
          pixelHeight: 200,
          base64Data: "cG5n",
        },
      }),
      createReferenceImageOperation({
        sequence: 2,
        sketchId: "sketch_draft",
        payload: {
          mediaType: "image/jpeg",
          fileName: "reference-b.jpg",
          pixelWidth: 200,
          pixelHeight: 400,
          base64Data: "anBn",
        },
      }),
    ],
  );

  expect(
    session.definition.points.length,
    "Reference-image imports should not materialize sketch points at import time.",
  ).toBe(0);
  expect(
    session.definition.referenceImages?.length,
    "Reference-image imports should commit as authoring operations.",
  ).toBe(2);

  const updated = updateReferenceImageOperationStates({
    session,
    updates: [
      {
        operationId: "sketch_operation_1_reference-image",
        label: "reference-a-updated.png",
        state: {
          kind: "referenceImage",
          image: {
            mediaType: "image/png",
            fileName: "reference-a-updated.png",
            pixelWidth: 800,
            pixelHeight: 600,
            base64Data: "dXBkYXRlZA==",
          },
          placement: {
            center: [12, -4],
            width: 240,
            height: 180,
            rotationRadians: 0.4,
          },
        },
      },
    ],
  });

  const persistedCalibration =
    updated.definition.referenceImages?.[0]?.ownedState?.kind ===
    "referenceImage"
      ? updated.definition.referenceImages[0]?.ownedState.calibration
      : undefined;

  expect(
    updated.definition.referenceImages?.[0]?.kind,
    "Reference-image edits update the explicit authored record.",
  ).toBe("referenceImage");
  expect(
    updated.commitRequest?.definition.references.some(
      (reference) => reference.kind === "referenceImageAnchor",
    ),
    "Committed sketch definitions must not persist derived reference-image anchor references.",
  ).toBeFalsy();
  expect(
    persistedCalibration === undefined ||
      !("solveResult" in persistedCalibration),
    "Persisted reference-image operation state must not serialize runtime-only calibration solve output.",
  ).toBeTruthy();

  const updatedRenderables = getSketchSessionDisplayRenderables(updated).filter(
    (entry) => entry.target?.kind === "sketchOperation",
  );
  expect(
    updatedRenderables[0]?.label,
    "Reference-image updates should replay the latest operation label.",
  ).toBe("reference-a-updated.png");
  expect(
    updatedRenderables[0]?.textureFill?.base64Data,
    "Reference-image updates should replay the latest inline payload bytes for rendering.",
  ).toBe("dXBkYXRlZA==");

  const explicitEdit = updateReferenceImageOperationStates({
    session,
    updates: [
      {
        operationId: "sketch_operation_2_reference-image",
        label: "reference-b-adjusted.jpg",
        state: {
          kind: "referenceImage",
          image: {
            mediaType: "image/jpeg",
            fileName: "reference-b-adjusted.jpg",
            pixelWidth: 200,
            pixelHeight: 400,
            base64Data: "YWRqdXN0ZWQ=",
          },
          placement: {
            center: [-6, 8],
            width: 100,
            height: 200,
            rotationRadians: 1.2,
          },
        },
      },
    ],
  });
  const adjustedRenderables = getSketchSessionDisplayRenderables(
    explicitEdit,
  ).filter((entry) => entry.target?.kind === "sketchOperation");
  expect(
    adjustedRenderables[1]?.textureFill?.sourceKey.includes(
      "reference-b-adjusted.jpg",
    ),
    "Reference-image edit rows should update the active texture source token for the targeted operation.",
  ).toBeTruthy();
});

test("src/domain/editor/reference-image-operations.spec.ts removes anchor bindings when a bound sketch point is deleted", () => {
  const session = updateReferenceImageOperationStates({
    session: appendReferenceImageOperations(
      createNewSketchSession(createStandardPlaneDefinition("xy")),
      [
        createReferenceImageOperation({
          sequence: 1,
          sketchId: "sketch_draft",
          payload: {
            mediaType: "image/png",
            fileName: "reference.png",
            pixelWidth: 400,
            pixelHeight: 200,
            base64Data: "cG5n",
          },
        }),
      ],
    ),
    updates: [
      {
        operationId: "sketch_operation_1_reference-image",
        state: {
          kind: "referenceImage",
          image: {
            mediaType: "image/png",
            fileName: "reference.png",
            pixelWidth: 400,
            pixelHeight: 200,
            base64Data: "cG5n",
          },
          placement: {
            center: [0, 0],
            width: 200,
            height: 100,
            rotationRadians: 0,
          },
          calibration: {
            scaleMode: "lockedAspect",
            anchors: [
              {
                anchorId: "anchor-1",
                label: "A1",
                uv: [0.25, 0.5],
                pointId: "sketch_point_anchor_1",
              },
            ],
          },
        },
        createdPoints: [
          {
            pointId: "sketch_point_anchor_1",
            label: "A1",
            target: {
              kind: "sketchPoint",
              sketchId: "sketch_draft",
              pointId: "sketch_point_anchor_1",
            },
            position: [0, 0],
            isConstruction: true,
          },
        ],
      },
    ],
  });

  const deleted = deleteSelectedSketchGeometry(session, [
    {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: "sketch_point_anchor_1",
    },
  ]);

  const latestOwnedState =
    deleted.definition.referenceImages?.at(-1)?.ownedState;
  expect(
    latestOwnedState?.kind,
    "Deleting a bound point should update the explicit reference-image record.",
  ).toBe("referenceImage");
  expect(deleted.definition.referenceImages?.[0]?.ownedPointIds).toEqual([]);
  expect(
    latestOwnedState.calibration?.anchors.length,
    "Deleting a bound anchor point should detach the anchor binding from the reference-image operation.",
  ).toBe(0);
});

test("src/domain/editor/reference-image-operations.spec.ts renders draft reference-image payload overrides without projected anchor exports", () => {
  const plane = createStandardPlaneDefinition("xy");
  const operationId = "sketch_operation_1_reference-image";
  const committed = appendReferenceImageOperations(
    createNewSketchSession(plane),
    [
      createReferenceImageOperation({
        sequence: 1,
        sketchId: "sketch_draft",
        payload: {
          mediaType: "image/png",
          fileName: "reference.png",
          pixelWidth: 400,
          pixelHeight: 200,
          base64Data: "cG5n",
        },
      }),
    ],
  );

  const draftState: ReferenceImageCalibrationModeState = {
    sketchId: "sketch_draft",
    operationId,
    draftPoints: [
      {
        pointId: "sketch_point_anchor_1",
        label: "A1",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_draft",
          pointId: "sketch_point_anchor_1",
        },
        position: [15, 5],
        isConstruction: true,
      },
    ],
    draftState: solveReferenceImageOperationState(
      {
        kind: "referenceImage",
        image: {
          mediaType: "image/png",
          fileName: "reference-updated.png",
          pixelWidth: 400,
          pixelHeight: 200,
          base64Data: "dXBkYXRlZA==",
        },
        placement: {
          center: [15, 5],
          width: 200,
          height: 100,
          rotationRadians: 0,
        },
        calibration: {
          scaleMode: "lockedAspect",
          anchors: [
            {
              anchorId: "anchor-1",
              label: "A1",
              uv: [0.25, 0.5],
              pointId: "sketch_point_anchor_1",
            },
          ],
        },
      },
      {
        pointPositionsById: new Map([
          ["sketch_point_anchor_1", [15, 5] as const],
        ]),
      },
    ),
    selectedAnchorId: "anchor-1",
    pendingAnchorPlacement: false,
  };

  const renderables = getSketchSessionDisplayRenderables({
    ...committed,
    activeSpecialMode: {
      modeId: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
      operationTarget: {
        kind: "sketchOperation",
        sketchId: "sketch_draft",
        operationId,
      },
      state: draftState,
      generation: 1,
      hoverTarget: null,
      selectedTarget: null,
      activeDragHandle: null,
      pendingEffect: null,
      pendingExit: false,
    },
  });

  const draftImage = renderables.find(
    (entry) =>
      entry.target?.kind === "sketchOperation" &&
      entry.target.operationId === operationId,
  );
  const projectedAnchor = renderables.find(
    (entry) => entry.target?.kind === "projectedReferenceGeometry",
  );

  expect(
    draftImage?.textureFill?.base64Data,
    "Active calibration sessions should render the draft reference-image payload.",
  ).toBe("dXBkYXRlZA==");
  expect(
    projectedAnchor,
    "Draft calibration display should not synthesize projected anchor exports.",
  ).toBe(undefined);
});

test("src/domain/editor/reference-image-operations.spec.ts lets bound anchor points participate in ordinary sketch constraints", () => {
  const definition = {
    schemaVersion: "sketch-definition/v1alpha1" as const,
    referenceIds: [],
    references: [],
    pointIds: ["sketch_point_anchor", "sketch_point_free"],
    points: [
      {
        pointId: "sketch_point_anchor",
        label: "Anchor",
        target: {
          kind: "sketchPoint" as const,
          sketchId: "sketch_primary",
          pointId: "sketch_point_anchor",
        },
        position: [0, 0] as const,
        isConstruction: true,
      },
      {
        pointId: "sketch_point_free",
        label: "Free",
        target: {
          kind: "sketchPoint" as const,
          sketchId: "sketch_primary",
          pointId: "sketch_point_free",
        },
        position: [10, 5] as const,
        isConstruction: false,
      },
    ],
    entityIds: ["sketch_entity_line"],
    entities: [
      {
        kind: "lineSegment" as const,
        entityId: "sketch_entity_line",
        label: "Line",
        target: {
          kind: "sketchEntity" as const,
          sketchId: "sketch_primary",
          entityId: "sketch_entity_line",
        },
        isConstruction: false,
        startPointId: "sketch_point_anchor",
        endPointId: "sketch_point_free",
      },
    ],
    constraintIds: ["constraint_horizontal"],
    constraints: [
      {
        constraintId: "constraint_horizontal",
        kind: "horizontal" as const,
        label: "Horizontal",
        entityId: "sketch_entity_line",
      },
    ],
    dimensionIds: [],
    dimensions: [],
    svgRenderingEnabled: true,
    derivedRelationships: [],
    referenceImages: [
      {
        operationId: "sketch_operation_1_reference-image",
        label: "Reference image",
        kind: "referenceImage" as const,
        ownedPointIds: [],
        ownedEntityIds: [],
        ownedState: {
          kind: "referenceImage" as const,
          image: {
            mediaType: "image/png",
            fileName: "reference.png",
            pixelWidth: 400,
            pixelHeight: 200,
            base64Data: "cG5n",
          },
          placement: {
            center: [0, 0] as const,
            width: 200,
            height: 100,
            rotationRadians: 0,
          },
          calibration: {
            scaleMode: "lockedAspect" as const,
            anchors: [
              {
                anchorId: "anchor-1",
                label: "A1",
                uv: [0.25, 0.5] as const,
                pointId: "sketch_point_anchor",
              },
            ],
          },
        },
      },
    ],
  };

  const solved = solveSketchDefinitionCore({
    definition,
    projectedReferences: [],
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: "bestEffort",
  });
  const anchorPoint = solved.solvedSnapshot.solvedPoints.find(
    (point) => point.pointId === "sketch_point_anchor",
  );
  const freePoint = solved.solvedSnapshot.solvedPoints.find(
    (point) => point.pointId === "sketch_point_free",
  );

  expect(
    anchorPoint && freePoint,
    "Expected solved line endpoints.",
  ).toBeTruthy();
  expect(
    Math.abs(anchorPoint.solvedPosition[1] - freePoint.solvedPosition[1]) <
      1e-6,
    "Bound anchor points should remain valid local targets for ordinary sketch constraints.",
  ).toBeTruthy();
});

test("src/domain/editor/reference-image-operations.spec.ts reuses bound anchor point ids when drawing snapped lines", () => {
  let session = createSketchSessionFromSnapshot(
    loadCapturedReferenceImageSketchFixture(),
  );
  const anchorPointIds =
    session.definition.referenceImages?.[0]?.ownedState?.kind ===
    "referenceImage"
      ? (session.definition.referenceImages[0].ownedState.calibration?.anchors.map(
          (anchor) => anchor.pointId,
        ) ?? [])
      : [];

  expect(
    anchorPointIds.length,
    "Expected captured fixture to expose two bound anchor points.",
  ).toBe(2);

  session = beginSketchTool(session, "line");
  session = startSketchDraw(session, [66.08, 23.76]);
  expect(
    session.activeSnap?.kind,
    "Bound anchor points should participate in ordinary endpoint snapping.",
  ).toBe("endpoint");
  session = acceptSketchDraw(session, [66.76, -22.65]);

  const committed = session.definition.entities.at(-1);
  expect(
    committed?.kind,
    "Expected snapped anchor draw to commit a line segment.",
  ).toBe("lineSegment");
  expect(
    committed.startPointId === anchorPointIds[0] &&
      committed.endPointId === anchorPointIds[1],
    "Snapped anchor lines should reuse the existing anchor point ids at both endpoints.",
  ).toBeTruthy();
  expect(
    session.definition.points.length,
    "Connecting two existing anchors should not author duplicate endpoint points.",
  ).toBe(2);
  expect(
    session.definition.constraints.some(
      (constraint) => constraint.kind === "coincident",
    ),
    "Reused anchor endpoints should not need inferred coincident constraints.",
  ).toBeFalsy();
});

test("src/domain/editor/reference-image-operations.spec.ts keeps captured debug-state anchors visible in normal sketch mode", () => {
  const session = createSketchSessionFromSnapshot(
    loadCapturedReferenceImageSketchFixture(),
  );
  const renderables = getSketchSessionDisplayRenderables(session);

  const overlayAnchors = renderables.filter(
    (renderable) =>
      renderable.markerLayer === "overlay" &&
      renderable.target?.kind === "sketchPoint" &&
      renderable.label.startsWith("Anchor "),
  );

  expect(
    overlayAnchors.length,
    "Captured bound anchors should render explicit normal-mode overlay markers.",
  ).toBe(2);
  expect(
    overlayAnchors.every(
      (renderable) =>
        renderable.geometry.kind === "marker" &&
        renderable.geometry.displayRadius >= 0.4,
    ),
    "Captured bound anchors should render enlarged overlay markers in normal sketch mode.",
  ).toBeTruthy();
});

test("src/domain/editor/reference-image-operations.spec.ts deletes only image-owned anchor geometry and preserves bound geometry and other images", () => {
  const ownedPoint = {
    pointId: "sketch_point_image_anchor" as const,
    label: "Image anchor",
    target: {
      kind: "sketchPoint" as const,
      sketchId: "sketch_draft" as const,
      pointId: "sketch_point_image_anchor" as const,
    },
    position: [12, 6] as const,
    isConstruction: true,
  };
  const ownedEntity = {
    kind: "point" as const,
    entityId: "sketch_entity_image_anchor" as const,
    label: "Image anchor",
    target: {
      kind: "sketchEntity" as const,
      sketchId: "sketch_draft" as const,
      entityId: "sketch_entity_image_anchor" as const,
    },
    isConstruction: true,
    pointId: ownedPoint.pointId,
  };
  const boundPoint = {
    pointId: "sketch_point_preexisting_bound" as const,
    label: "Preexisting bound point",
    target: {
      kind: "sketchPoint" as const,
      sketchId: "sketch_draft" as const,
      pointId: "sketch_point_preexisting_bound" as const,
    },
    position: [3, 4] as const,
    isConstruction: false,
  };
  const boundEntity = {
    kind: "point" as const,
    entityId: "sketch_entity_preexisting_bound" as const,
    label: "Preexisting bound point",
    target: {
      kind: "sketchEntity" as const,
      sketchId: "sketch_draft" as const,
      entityId: "sketch_entity_preexisting_bound" as const,
    },
    isConstruction: false,
    pointId: boundPoint.pointId,
  };
  const imported = appendReferenceImageOperations(
    createNewSketchSession(createStandardPlaneDefinition("xy")),
    [
      createReferenceImageOperation({
        sequence: 1,
        sketchId: "sketch_draft",
        payload: {
          mediaType: "image/png",
          fileName: "reference-a.png",
          pixelWidth: 400,
          pixelHeight: 200,
          base64Data: "aW1hZ2UtYQ==",
        },
      }),
      createReferenceImageOperation({
        sequence: 2,
        sketchId: "sketch_draft",
        payload: {
          mediaType: "image/png",
          fileName: "reference-b.png",
          pixelWidth: 200,
          pixelHeight: 400,
          base64Data: "aW1hZ2UtYg==",
        },
      }),
    ],
  );
  const withBoundGeometry = {
    ...imported,
    definition: {
      ...imported.definition,
      pointIds: [...imported.definition.pointIds, boundPoint.pointId],
      points: [...imported.definition.points, boundPoint],
      entityIds: [...imported.definition.entityIds, boundEntity.entityId],
      entities: [...imported.definition.entities, boundEntity],
    },
  };
  const session = updateReferenceImageOperationStates({
    session: withBoundGeometry,
    updates: [
      {
        operationId: "sketch_operation_1_reference-image",
        label: "reference-a-edited.png",
        createdPoints: [ownedPoint],
        createdEntities: [ownedEntity],
        state: {
          kind: "referenceImage",
          image: {
            mediaType: "image/png",
            fileName: "reference-a-edited.png",
            pixelWidth: 500,
            pixelHeight: 250,
            base64Data: "ZWRpdGVkLWE=",
          },
          placement: {
            center: [12, 6],
            width: 220,
            height: 110,
            rotationRadians: 0.2,
          },
          calibration: {
            scaleMode: "lockedAspect",
            showExportedAnchorsInSketch: true,
            anchors: [
              {
                anchorId: "image-created-anchor",
                label: "Image anchor",
                uv: [0.25, 0.5],
                pointId: ownedPoint.pointId,
              },
              {
                anchorId: "preexisting-bound-anchor",
                label: "Bound point",
                uv: [0.75, 0.5],
                pointId: boundPoint.pointId,
              },
            ],
          },
        },
      },
    ],
  });

  expect(session.definition.referenceImages?.[0]?.ownedPointIds).toEqual([
    ownedPoint.pointId,
  ]);
  expect(session.definition.referenceImages?.[0]?.ownedEntityIds).toEqual([
    ownedEntity.entityId,
  ]);

  const deleted = deleteSelectedSketchGeometry(session, [
    {
      kind: "sketchOperation",
      sketchId: "sketch_draft",
      operationId: "sketch_operation_1_reference-image",
    },
  ]);
  const renderables = getSketchSessionDisplayRenderables(deleted).filter(
    (entry) => entry.target?.kind === "sketchOperation",
  );

  expect(
    deleted.definition.referenceImages?.map((record) => record.operationId),
    "Deleting one reference image should retain exactly the untargeted current record.",
  ).toEqual(["sketch_operation_2_reference-image"]);
  expect(
    deleted.definition.referenceImages?.length,
    "Deleting an image removes its current authored record.",
  ).toBe(1);
  expect(deleted.definition.pointIds).not.toContain(ownedPoint.pointId);
  expect(deleted.definition.entityIds).not.toContain(ownedEntity.entityId);
  expect(deleted.definition.points).toContainEqual(boundPoint);
  expect(deleted.definition.entities).toContainEqual(boundEntity);
  expect(
    renderables.length,
    "Deleting one reference-image record should preserve other committed reference images.",
  ).toBe(1);
  expect(
    renderables[0]?.label,
    "Deleting one reference-image record should leave the untargeted image intact.",
  ).toBe("reference-b.png");
});
