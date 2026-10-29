import { createRenderMeshGeometry } from "@/contracts/render/render-mesh-geometry";
import { defaultEditorExtensionDependencies } from "@/composition/editor-extension-dependencies";
import { test, expect } from "vitest";
import {
  createFeatureEditSession,
  patchFeatureEditSession,
} from "@/core/editor/feature-editing";
import {
  initialEditorState,
  transitionEditorState,
  type FeatureEditorState,
} from "./index";
import type {
  RenderableEntityRecord,
  RenderPoint3D,
} from "@/contracts/render/schema";
import type {
  BodyId,
  CommandSessionId,
  FaceId,
  PickId,
  RenderableId,
  RegionId,
  RequestId,
  RevisionId,
  SketchId,
  SnapshotEntityId,
} from "@/contracts/shared/ids";
import {
  CONTRACT_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";

test("feature preview completion preselects boolean targets and preserves later manual overrides", () => {
  const session = {
    ...createFeatureEditSession({
      featureType: "extrude",
      selectedTarget: {
        kind: "region",
        sketchId: "sketch_a" as SketchId,
        regionId: "region_profile" as RegionId,
      },
    }),
    status: "previewing" as const,
  };
  const previewCompleted = transitionEditorState(
    createPreviewState(session, "request_feature-preview-1" as RequestId),
    {
      type: "effect.featurePreviewCompleted",
      requestId: "request_feature-preview-1" as RequestId,
      documentId: "doc_workspace",
      commandSessionId: "command_extrude-1" as CommandSessionId,
      baseRevisionId: "rev_1" as RevisionId,
      revisionId: "rev_1" as RevisionId,
      stale: false,
      diagnostics: [],
      renderables: [
        boxMesh("preview_intersecting", null, [0.5, 0.5, 0.5], [1.5, 1.5, 1.5]),
      ],
    }, defaultEditorExtensionDependencies,
  );

  expect(
    previewCompleted.state.kind,
    "Preview completion should stay in feature editing.",
  ).toBe("editingFeature");
  expect(
    previewCompleted.state.kind === "editingFeature" &&
      previewCompleted.state.session.draft.operation === "cut" &&
      previewCompleted.state.session.draft.booleanScope.kind === "targetBody" &&
      previewCompleted.state.session.draft.booleanScope.bodyId === "body_a",
    "Successful preview completion should preselect cut and the intersecting target body.",
  ).toBeTruthy();

  if (previewCompleted.state.kind !== "editingFeature") {
    throw new Error("Expected feature editing after preview completion.");
  }

  const manualSession = {
    ...patchFeatureEditSession(previewCompleted.state.session, {
      operation: "join",
      booleanTargetBodyId: "body_manual" as BodyId,
    }),
    status: "previewing" as const,
  };
  const laterPreviewCompleted = transitionEditorState(
    createPreviewState(manualSession, "request_feature-preview-2" as RequestId),
    {
      type: "effect.featurePreviewCompleted",
      requestId: "request_feature-preview-2" as RequestId,
      documentId: "doc_workspace",
      commandSessionId: "command_extrude-1" as CommandSessionId,
      baseRevisionId: "rev_1" as RevisionId,
      revisionId: "rev_1" as RevisionId,
      stale: false,
      diagnostics: [],
      renderables: [
        boxMesh(
          "preview_other_intersection",
          null,
          [9.5, 9.5, 9.5],
          [10.5, 10.5, 10.5],
        ),
      ],
    }, defaultEditorExtensionDependencies,
  );

  expect(
    laterPreviewCompleted.state.kind === "editingFeature" &&
      laterPreviewCompleted.state.session.draft.operation === "join" &&
      laterPreviewCompleted.state.session.draft.booleanScope.kind ===
        "targetBody" &&
      laterPreviewCompleted.state.session.draft.booleanScope.bodyId ===
        "body_manual",
    "Manual operation and target selections should survive later preview completion classifications.",
  ).toBeTruthy();
});

test("feature preview completion keeps unsupported advanced boolean families explicit", () => {
  const session = {
    ...createFeatureEditSession({
      featureType: "thicken",
      selectedTarget: {
        kind: "face",
        bodyId: "body_a" as BodyId,
        faceId: "face_top" as FaceId,
      },
    }),
    status: "previewing" as const,
  };
  const previewCompleted = transitionEditorState(
    createPreviewState(
      session,
      "request_feature-preview-advanced" as RequestId,
      "thicken",
    ),
    {
      type: "effect.featurePreviewCompleted",
      requestId: "request_feature-preview-advanced" as RequestId,
      documentId: "doc_workspace",
      commandSessionId: "command_extrude-1" as CommandSessionId,
      baseRevisionId: "rev_1" as RevisionId,
      revisionId: "rev_1" as RevisionId,
      stale: false,
      diagnostics: [],
      renderables: [
        boxMesh("preview_intersecting", null, [0.5, 0.5, 0.5], [1.5, 1.5, 1.5]),
      ],
    }, defaultEditorExtensionDependencies,
  );

  expect(
    previewCompleted.state.kind === "editingFeature" &&
      previewCompleted.state.session.featureType === "thicken" &&
      previewCompleted.state.session.draft.operationIntent === "create" &&
      previewCompleted.state.session.draft.targetBodyTargets.length === 0,
    "Preview completion should leave advanced families explicit until their boolean composition path is supported.",
  ).toBeTruthy();
});

// Seam: the editor transition on preview completion. The preselection infers
// the operation and target from the preview of a New body draft; when that
// changes the draft, the changed draft is previewed before the session is
// ready, so the ready preview is what a commit runs. A join or cut preview
// shows the boolean result, which is never classified again (it overlaps the
// body it merged with: a join became a cut). A same-value New body inference
// previews nothing more.
test("a preselection that changes a New body draft previews the inferred operation once before the preview is ready", () => {
  const regionSession = () => ({
    ...createFeatureEditSession({
      featureType: "extrude",
      selectedTarget: {
        kind: "region",
        sketchId: "sketch_a" as SketchId,
        regionId: "region_profile" as RegionId,
      },
    }),
    status: "previewing" as const,
  });
  // body_a's top face, planar, so a preview face on it is in coplanar contact.
  const withPlanarTop = (state: FeatureEditorState): FeatureEditorState => {
    const snapshot = state.snapshot!;
    return {
      ...state,
      snapshot: {
        ...snapshot,
        document: {
          ...snapshot.document,
          render: {
            ...snapshot.document.render,
            records: [
              ...snapshot.document.render.records,
              squareMesh("body_a_top", "body_a" as BodyId, [0, 0], [1, 1], 1),
            ],
          },
        },
      },
    };
  };
  const completion = (
    requestId: RequestId,
    renderables: RenderableEntityRecord[],
  ) =>
    ({
      type: "effect.featurePreviewCompleted",
      requestId,
      documentId: "doc_workspace",
      commandSessionId: "command_extrude-1" as CommandSessionId,
      baseRevisionId: "rev_1" as RevisionId,
      revisionId: "rev_1" as RevisionId,
      stale: false,
      diagnostics: [],
      renderables,
    }) as const;
  const onTop = [squareMesh("preview_on_top", null, [0.2, 0.2], [0.8, 0.8], 1)];
  const intersecting = [
    boxMesh("preview_intersecting", null, [0.5, 0.5, 0.5], [1.5, 1.5, 1.5]),
  ];
  const apart = [boxMesh("preview_apart", null, [5, 5, 5], [6, 6, 6])];
  const summary = (result: ReturnType<typeof transitionEditorState>) => {
    if (result.state.kind !== "editingFeature") {
      throw new Error("Expected feature editing after preview completion.");
    }
    const { draft, status } = result.state.session;
    return {
      previews: result.effects.flatMap((effect) =>
        effect.type === "feature.evaluatePreview" &&
        effect.requestId ===
          (result.state as FeatureEditorState).pendingPreviewRequestId
          ? [effect.featureSession.draft]
          : [],
      ),
      effects: result.effects.length,
      operation: draft.operation,
      booleanScope: draft.booleanScope,
      status,
    };
  };
  const join = {
    operation: "join",
    booleanScope: { kind: "targetBody", bodyId: "body_a" },
  };
  const cut = { ...join, operation: "cut" };

  for (const [inferred, profileRenderables, resultRenderables] of [
    [join, onTop, intersecting],
    [cut, intersecting, apart],
  ] as const) {
    const first = transitionEditorState(
      withPlanarTop(
        createPreviewState(
          regionSession(),
          "request_feature-preview-1" as RequestId,
        ),
      ),
      completion("request_feature-preview-1" as RequestId, [
        ...profileRenderables,
      ]),
      defaultEditorExtensionDependencies,
    );
    expect(
      summary(first),
      `the inferred ${inferred.operation} is previewed before the session is ready`,
    ).toMatchObject({
      previews: [inferred],
      effects: 1,
      ...inferred,
      status: "previewing",
    });

    // The boolean result overlaps body_a, or lies apart from it: a profile
    // preview like either would infer another operation.
    const confirmed = transitionEditorState(
      first.state,
      completion((first.state as FeatureEditorState).pendingPreviewRequestId!, [
        ...resultRenderables,
      ]),
      defaultEditorExtensionDependencies,
    );
    expect(
      summary(confirmed),
      `the ${inferred.operation} preview is ready and is not classified again`,
    ).toMatchObject({ effects: 0, ...inferred, status: "previewReady" });
  }

  expect(
    summary(
      transitionEditorState(
        createPreviewState(
          regionSession(),
          "request_feature-preview-2" as RequestId,
        ),
        completion("request_feature-preview-2" as RequestId, apart),
        defaultEditorExtensionDependencies,
      ),
    ),
    "a New body inferred for a New body draft previews nothing more",
  ).toMatchObject({
    effects: 0,
    operation: "newBody",
    status: "previewReady",
  });
});

function createPreviewState(
  session: FeatureEditorState["session"],
  pendingPreviewRequestId: RequestId,
  toolId: FeatureEditorState["command"]["toolId"] = "extrude",
): FeatureEditorState {
  return {
    ...initialEditorState,
    kind: "editingFeature",
    command: {
      commandSessionId: "command_extrude-1" as CommandSessionId,
      toolId,
      phase: "awaitingEffect",
    },
    document: {
      documentId: "doc_workspace",
      revisionId: "rev_1" as RevisionId,
    },
    snapshot: createSnapshot(),
    selection: [
      {
        kind: "region",
        sketchId: "sketch_a" as SketchId,
        regionId: "region_profile" as RegionId,
      },
    ],
    preview: null,
    previewRenderables: null,
    session,
    activeReferencePickerFieldId: null,
    pendingPreviewRequestId,
    pendingCommitRequestId: null,
  };
}

function createSnapshot(): WorkspaceSnapshot {
  const renderable = boxMesh(
    "body_a",
    "body_a" as BodyId,
    [0, 0, 0],
    [1, 1, 1],
  );
  const entity = {
    ownerDocumentId: "doc_workspace",
    ownerRevisionId: "rev_1" as RevisionId,
    ownerFeatureId: null,
    ownerSketchId: null,
    ownerBodyId: "body_a" as BodyId,
    id: "snapshot_entity_body_a" as SnapshotEntityId,
    label: "Body A",
    target: { kind: "body", bodyId: "body_a" as BodyId },
    relatedTargets: [],
    contributingFeatureIds: [],
    consumedByFeatureIds: [],
    selectionSemantics: ["body" as const],
  };

  return {
    document: {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      documentId: "doc_workspace",
      name: "Workspace",
      revisionId: "rev_1" as RevisionId,
      settings: {
        linearUnit: "millimeter",
        modelingTolerance: 0.001,
        angularToleranceRadians: 0.0001,
      },
      capabilities: {
        supportedFeatureKinds: ["extrude"],
        previewableFeatureKinds: ["extrude"],
        supportedProfileKinds: ["region", "face"],
        supportsFaceBackedSketchPlanes: true,
        supportsDurableTopologyNaming: false,
      },
      featureTree: [],
      objects: [],
      features: [],
      cursor: { kind: "empty" },
      sketches: [],
      bodies: [
        {
          ownerDocumentId: "doc_workspace",
          ownerRevisionId: "rev_1" as RevisionId,
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: "body_a" as BodyId,
          bodyId: "body_a" as BodyId,
          label: "Body A",
          topology: {
            faceIds: [],
            edgeIds: [],
            vertexIds: [],
          },
        },
      ],
      constructions: [],
      variables: [],
      entities: [entity],
      references: [],
      diagnostics: [],
      render: {
        schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
        records: [renderable],
      },
    },
    presentation: {
      featureTree: [],
      objects: [],
      documentHistory: [],
      entities: [entity],
    },
    provenance: null,
  };
}

function boxMesh(
  id: string,
  ownerBodyId: BodyId | null,
  min: RenderPoint3D,
  max: RenderPoint3D,
): RenderableEntityRecord {
  const targetBodyId = ownerBodyId ?? "body_preview";
  return {
    id: id as RenderableId,
    label: id,
    ownerBodyId,
    ownerFeatureId: null,
    binding: {
      pickId: `pick_${id}` as PickId,
      pickPriority: 0,
      target: {
        kind: "face",
        bodyId: targetBodyId as BodyId,
        faceId: `face_${id}` as FaceId,
      },
      topology: "face",
      semanticClass: "bodyFace",
    },
    geometry: createRenderMeshGeometry({
      vertexPositions: [
        [min[0], min[1], min[2]],
        [max[0], min[1], min[2]],
        [max[0], max[1], min[2]],
        [min[0], max[1], min[2]],
        [min[0], min[1], max[2]],
        [max[0], min[1], max[2]],
        [max[0], max[1], max[2]],
        [min[0], max[1], max[2]],
      ],
      vertexNormals: null,
      triangleIndices: [
        [0, 1, 2],
        [0, 2, 3],
        [4, 6, 5],
        [4, 7, 6],
      ],
    }),
  };
}

function squareMesh(
  id: string,
  ownerBodyId: BodyId | null,
  min: [number, number],
  max: [number, number],
  z: number,
): RenderableEntityRecord {
  const box = boxMesh(
    id,
    ownerBodyId,
    [min[0], min[1], z],
    [max[0], max[1], z],
  );
  return {
    ...box,
    binding: { ...box.binding, semanticClass: "planarFace" },
    geometry: createRenderMeshGeometry({
      vertexPositions: [
        [min[0], min[1], z],
        [max[0], min[1], z],
        [max[0], max[1], z],
        [min[0], max[1], z],
      ],
      vertexNormals: null,
      triangleIndices: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    }),
  };
}
