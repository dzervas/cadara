import { test, expect } from "vitest";
import {
  getEditorHistoryAvailability,
  getEditorViewState,
  getEditorSelectionKey,
  type EditorEffectRuntime,
  initialEditorState,
  runEditorEffect,
  type SketchEditorState,
  transitionEditorState,
  type EditorEvent,
  createModelingServiceEditorEffectRuntime,
} from "./state-machine";
import { createEditorEventLoop } from "@/application/editor/editor-event-loop";
import {
  replayEditorEvents,
  replayEditorEventsWithRuntime,
} from "@/domain/editor/state-machine-test-builder";
import {
  getDefaultSelectionFilterForMode,
  planeSelectionFilter,
  primitiveRefEquals,
  type PrimitiveRef,
  type SelectionTargetCatalog,
} from "@/core/editor/schema";
import type { ToolId } from "@/core/tools/tool-registry";
import type { ImportProvider } from "@/contracts/import/provider";
import type {
  WorkspaceSnapshot,
  ModelingDiagnostic,
} from "@/contracts/modeling/schema";
import type {
  SnapshotEntityRecord,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type {
  ConstructionId,
  CommandSessionId,
  DocumentId,
  FeatureId,
  PickId,
  RegionId,
  RenderableId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
  SnapshotEntityId,
} from "@/contracts/shared/ids";
import {
  CONTRACT_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import {
  acceptSketchDraw,
  appendReferenceImageOperations,
  beginSketchTool,
  createNewSketchSession,
  createSketchSessionFromSnapshot,
  getSketchAnnotationDescriptors,
  getSketchSessionPreviewLabel,
  getSketchToolPresentation,
  isSketchSvgRenderingEnabled,
  mapSketchPointToWorld,
  patchSketchConstraintValue,
  selectSketchConstraintTarget,
  startSketchDraw,
  toggleSketchSvgRendering,
} from "@/domain/editor/sketch-session";
import { buildSelectionTargetCatalog } from "@/domain/modeling/document-snapshot-view";
import { getPreviousDocumentHistoryCursor } from "@/domain/modeling/document-history";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createMemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { createModelingService } from "@/domain/modeling/modeling-service";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import { createAppError, ResultAsync, type AppError } from "@/contracts/errors";
import { createReferenceImageOperation } from "@/domain/reference-image/operations";
import {
  createScopedImportProviderRegistryForTest,
  createScopedSketchSpecialModeRegistryForTest,
} from "@/domain/extensions/test-registry-composition";

test("src/contracts/editor/state-machine.spec.ts", async () => {
  function createSelectionCatalog(): SelectionTargetCatalog {
    return {
      selectableTargetKeys: [
        "sketch:sketch_a",
        "construction:construction_plane-xy",
        "construction:construction_plane-yz",
        "construction:construction_plane-xz",
        "face:body_a:face_top",
        "body:body_a",
        "edge:body_a:edge_a",
        "edge:body_a:edge_axis",
      ],
      existingSketchKeys: ["sketch:sketch_a"],
      constructionPlaneKeys: [
        "construction:construction_plane-xy",
        "construction:construction_plane-yz",
        "construction:construction_plane-xz",
      ],
      planarFaceKeys: ["face:body_a:face_top"],
    };
  }

  function createRegionSelectionCatalog(): SelectionTargetCatalog {
    return {
      selectableTargetKeys: [
        "sketch:sketch_a",
        "region:sketch_a:region_profile_a",
        "construction:construction_plane-xy",
        "construction:construction_plane-yz",
        "construction:construction_plane-xz",
        "face:body_a:face_top",
        "body:body_a",
        "edge:body_a:edge_a",
        "edge:body_a:edge_axis",
      ],
      existingSketchKeys: [
        "sketch:sketch_a",
        "region:sketch_a:region_profile_a",
      ],
      constructionPlaneKeys: [
        "construction:construction_plane-xy",
        "construction:construction_plane-yz",
        "construction:construction_plane-xz",
      ],
      planarFaceKeys: ["face:body_a:face_top"],
    };
  }

  function createSectionSelectionSnapshot(): WorkspaceSnapshot {
    const base = createSnapshot();
    const plane = createStandardPlaneDefinition("xy");

    return {
      ...base,
      sketches: [
        {
          ownerDocumentId: "doc_workspace",
          ownerRevisionId: "rev_1",
          ownerFeatureId: null,
          ownerSketchId: "sketch_a",
          ownerBodyId: null,
          sketchId: "sketch_a",
          label: "Sketch A",
          plane,
          planeTarget: plane.support,
          planeKey: plane.key,
          sketch: {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: "sketch_a",
            ownerBodyId: null,
            sketchId: "sketch_a",
            label: "Sketch A",
            planeSupport: plane.support,
            definition: {
              schemaVersion: "sketch-definition/v1alpha1",
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
            },
            solvedSnapshot: {
              schemaVersion: "solved-sketch/v1alpha1",
              status: {
                solveState: "solved",
                constraintState: "underConstrained",
              },
              solvedEntities: [],
              solvedPoints: [],
              constraintStatuses: [],
              dimensionStatuses: [],
              diagnostics: [],
            },
            regions: [],
          },
        },
      ],
      document: {
        ...base.document,
        sketches: [
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: "sketch_a",
            ownerBodyId: null,
            sketchId: "sketch_a",
            label: "Sketch A",
            plane,
            planeTarget: plane.support,
            planeKey: plane.key,
            sketch: {
              ownerDocumentId: "doc_workspace",
              ownerRevisionId: "rev_1",
              ownerFeatureId: null,
              ownerSketchId: "sketch_a",
              ownerBodyId: null,
              sketchId: "sketch_a",
              label: "Sketch A",
              planeSupport: plane.support,
              definition: {
                schemaVersion: "sketch-definition/v1alpha1",
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
              },
              solvedSnapshot: {
                schemaVersion: "solved-sketch/v1alpha1",
                status: {
                  solveState: "solved",
                  constraintState: "underConstrained",
                },
                solvedEntities: [],
                solvedPoints: [],
                constraintStatuses: [],
                dimensionStatuses: [],
                diagnostics: [],
              },
              regions: [],
            },
          },
        ],
        entities: [
          ...base.document.entities,
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: "body_a",
            id: "snapshot_entity_face_top" as SnapshotEntityId,
            label: "Top face",
            target: { kind: "face", bodyId: "body_a", faceId: "face_top" },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ["face", "planarFace", "planarReference"],
          },
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: "sketch_a",
            ownerBodyId: null,
            id: "snapshot_entity_region_a" as SnapshotEntityId,
            label: "Sketch region",
            target: {
              kind: "region",
              sketchId: "sketch_a",
              regionId: "region_profile_a" as RegionId,
            },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ["regionProfile"],
          },
        ],
        render: {
          schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
          records: [
            {
              id: "renderable_face_top" as RenderableId,
              label: "Top face",
              ownerBodyId: "body_a",
              ownerFeatureId: null,
              binding: {
                pickId: "pick_face_top" as PickId,
                pickPriority: 8,
                target: { kind: "face", bodyId: "body_a", faceId: "face_top" },
                topology: "face",
                semanticClass: "planarFace",
              },
              geometry: {
                kind: "mesh",
                vertexPositions: [
                  [0, 0, 0],
                  [4, 0, 0],
                  [0, 4, 0],
                ],
                vertexNormals: [
                  [0, 0, 1],
                  [0, 0, 1],
                  [0, 0, 1],
                ],
                triangleIndices: [[0, 1, 2]],
              },
            },
          ],
        },
      },
      presentation: {
        ...base.presentation,
        entities: [
          ...base.presentation.entities,
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: "body_a",
            id: "snapshot_entity_face_top" as SnapshotEntityId,
            label: "Top face",
            target: { kind: "face", bodyId: "body_a", faceId: "face_top" },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ["face", "planarFace", "planarReference"],
          },
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: "sketch_a",
            ownerBodyId: null,
            id: "snapshot_entity_region_a" as SnapshotEntityId,
            label: "Sketch region",
            target: {
              kind: "region",
              sketchId: "sketch_a",
              regionId: "region_profile_a" as RegionId,
            },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ["regionProfile"],
          },
        ],
      },
    };
  }

  function createSnapshot(): WorkspaceSnapshot {
    return {
      contractVersion: "modeling-contract/v1alpha1",
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      documentId: "doc_workspace",
      revisionId: "rev_1",
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
      documentHistory: [],
      references: [],
      render: {
        schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
        records: [],
      },
      sketches: [],
      features: [],
      cursor: { kind: "empty" },
      bodies: [],
      constructions: [
        {
          ownerDocumentId: "doc_workspace",
          ownerRevisionId: "rev_1",
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          constructionId: "construction_plane-xy" as ConstructionId,
          label: "Top Plane",
          constructionType: "plane",
          plane: createStandardPlaneDefinition("xy"),
          target: {
            kind: "construction",
            constructionId: "construction_plane-xy" as ConstructionId,
          },
        },
      ],
      variables: [],
      entities: [
        {
          ownerDocumentId: "doc_workspace",
          ownerRevisionId: "rev_1",
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          id: "snapshot_entity_plane_xy" as SnapshotEntityId,
          label: "Top Plane",
          target: {
            kind: "construction",
            constructionId: "construction_plane-xy" as ConstructionId,
          },
          relatedTargets: [],
          contributingFeatureIds: [],
          consumedByFeatureIds: [],
          selectionSemantics: ["constructionPlane", "planarReference"],
        },
      ],
      diagnostics: [],
      document: {
        contractVersion: CONTRACT_VERSION,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        documentId: "doc_workspace",
        revisionId: "rev_1",
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
        bodies: [],
        constructions: [
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            constructionId: "construction_plane-xy" as ConstructionId,
            label: "Top Plane",
            constructionType: "plane",
            plane: createStandardPlaneDefinition("xy"),
            target: {
              kind: "construction",
              constructionId: "construction_plane-xy" as ConstructionId,
            },
          },
        ],
        variables: [],
        entities: [
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: "snapshot_entity_plane_xy" as SnapshotEntityId,
            label: "Top Plane",
            target: {
              kind: "construction",
              constructionId: "construction_plane-xy" as ConstructionId,
            },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ["constructionPlane", "planarReference"],
          },
        ],
        references: [],
        diagnostics: [],
        render: {
          schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
          records: [],
        },
      },
      presentation: {
        featureTree: [],
        objects: [],
        documentHistory: [],
        entities: [
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: "snapshot_entity_plane_xy" as SnapshotEntityId,
            label: "Top Plane",
            target: {
              kind: "construction",
              constructionId: "construction_plane-xy" as ConstructionId,
            },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ["constructionPlane", "planarReference"],
          },
        ],
      },
    };
  }

  async function createImageImportSession() {
    const provider: ImportProvider<
      {
        sourceName: string;
      },
      {
        plane: SketchPlaneDefinition | null;
        planeTarget: PrimitiveRef | null;
        planeKey: "xy" | "yz" | "xz" | null;
      }
    > = {
      id: "test-image-import",
      label: "Test Image Import",
      acceptedFileTypes: [{ extension: "png", mediaType: "image/png" }],
      accepts() {
        return true;
      },
      async review(input) {
        return {
          providerReview: {
            sourceName: input.source.name,
          },
          proposedActionKinds: ["commitSketch"],
          diagnostics: [],
        };
      },
      createDefaultSelections() {
        return {
          plane: null,
          planeTarget: null,
          planeKey: null,
        };
      },
      getReviewFormSchema() {
        return {
          sections: [
            {
              id: "image-references",
              title: "References",
              fields: [
                {
                  id: "image-plane",
                  kind: "referencePicker",
                  label: "Sketch plane",
                  helper:
                    "Select one construction plane or planar face for the image reference sketch.",
                  value: null,
                  emptyLabel: "Pick a construction plane or planar face",
                  picker: {
                    mode: "replace",
                    allowsMultiple: false,
                    selectionFilter: planeSelectionFilter,
                    itemLabel: "Plane reference",
                  },
                  patch: { patchKey: "planeSelection" },
                  error: { message: "Select one sketch plane." },
                },
              ],
            },
          ],
        };
      },
      applySelectionPatch(_review, selections, patch) {
        if (!Object.prototype.hasOwnProperty.call(patch, "planeSelection")) {
          return selections;
        }

        const selection = patch.planeSelection as {
          target?: PrimitiveRef | null;
          plane?: SketchPlaneDefinition | null;
        } | null;

        if (!selection?.target || !selection.plane) {
          if (selection?.target?.kind === "construction") {
            return {
              plane: createStandardPlaneDefinition("xy"),
              planeTarget: selection.target,
              planeKey: "xy",
            };
          }

          return {
            plane: null,
            planeTarget: null,
            planeKey: null,
          };
        }

        return {
          plane: selection.plane,
          planeTarget: selection.target,
          planeKey: selection.target.kind === "construction" ? "xy" : null,
        };
      },
      async prepare() {
        return { diagnostics: [] };
      },
    };
    const dependencies = {
      importProviders: createScopedImportProviderRegistryForTest([provider]),
      sketchSpecialModes: createScopedSketchSpecialModeRegistryForTest(),
    };
    const source = {
      name: "reference.png",
      origin: {
        kind: "localFile" as const,
        fileName: "reference.png",
        pathHint: "/tmp/reference.png",
      },
      mediaType: "image/png",
      bytes: Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00,
        0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0x1f, 0x00,
        0x03, 0x03, 0x02, 0x00, 0xef, 0xa7, 0x99, 0x64, 0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]),
      fingerprint: `sha256:${"1".repeat(64)}` as const,
    };
    const review = await provider.review({
      source,
      capabilities: {
        context: {
          contractVersion: CONTRACT_VERSION,
          documentId: "doc_workspace",
          baseRevisionId: "rev_1",
        },
        modeling: {
          async bakeGeometry() {
            throw new Error("Not used in image import session tests.");
          },
          async reconstructMeshToBrep() {
            throw new Error("Not used in image import session tests.");
          },
        },
        sketch: {
          async convertVectorToSketch() {
            throw new Error("Not used in image import session tests.");
          },
        },
        assets: {
          async registerGeometryAsset() {
            throw new Error("Not used in image import session tests.");
          },
          async storeEmbeddedBinary() {
            return "asset_embedded_image_reference";
          },
        },
      },
    });
    const selections = provider.createDefaultSelections(review);

    return {
      session: {
        providerId: provider.id,
        resolvedSource: source,
        review,
        selections,
        formSchema: provider.getReviewFormSchema(review, selections),
        diagnostics: [],
      },
      dependencies,
    };
  }

  async function createMockWorkspaceSnapshot() {
    const adapter = new MockKernelAdapter();
    const response = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    return response.snapshot;
  }

  function createOffsetFixtureSketchSession() {
    let session = createNewSketchSession(createStandardPlaneDefinition("xy"));
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [2, 0]);
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [2, 0]);
    session = acceptSketchDraw(session, [2, 2]);
    return session;
  }

  function cloneSnapshotWithCursor(
    snapshot: WorkspaceSnapshot,
    cursor: WorkspaceSnapshot["document"]["cursor"],
    revisionId: RevisionId,
  ): WorkspaceSnapshot {
    return {
      ...snapshot,
      revisionId,
      cursor: structuredClone(cursor),
      document: {
        ...snapshot.document,
        revisionId,
        cursor: structuredClone(cursor),
      },
    };
  }

  function createRenderRecord(
    id: string,
    featureId: FeatureId,
  ): WorkspaceSnapshot["document"]["render"]["records"][number] {
    return {
      id: id as RenderableId,
      label: id,
      ownerBodyId: null,
      ownerFeatureId: featureId,
      binding: {
        pickId: `pick_${id}` as PickId,
        pickPriority: 10,
        target: {
          kind: "construction",
          constructionId: "construction_plane-xy" as ConstructionId,
        },
        topology: null,
        semanticClass: "construction",
      },
      geometry: {
        kind: "marker",
        position: [0, 0, 0],
        displayRadius: 1,
      },
    };
  }

  function createCursorAwareRuntime(initialSnapshot: WorkspaceSnapshot) {
    let snapshot = structuredClone(initialSnapshot);
    let nextRevisionSequence = 1;
    let snapshotReadCount = 0;
    const cursorMoves: {
      baseRevisionId: RevisionId;
      cursor: WorkspaceSnapshot["document"]["cursor"];
      transient?: boolean;
    }[] = [];
    const previewCalls: {
      baseRevisionId: RevisionId;
      cursor: WorkspaceSnapshot["document"]["cursor"];
    }[] = [];
    const featureCommitCalls: RevisionId[] = [];
    const sketchCommitCalls: RevisionId[] = [];

    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => {
        snapshotReadCount += 1;
        return snapshot;
      },
      commitSketch: async (input) => {
        sketchCommitCalls.push(input.baseRevisionId);
        const revisionId =
          `rev_sketch_commit_${nextRevisionSequence++}` as RevisionId;
        snapshot = cloneSnapshotWithCursor(
          snapshot,
          snapshot.document.cursor,
          revisionId,
        );

        return {
          revisionId,
          accepted: true,
          diagnostics: [],
        };
      },
      projectSketchReferences: async () => ({
        projectedReferences: [],
        diagnostics: [],
      }),
      evaluatePreview: async (input) => {
        previewCalls.push({
          baseRevisionId: input.baseRevisionId,
          cursor: structuredClone(snapshot.document.cursor),
        });

        return {
          revisionId: input.baseRevisionId,
          stale: false,
          diagnostics: [],
          renderables: [],
        };
      },
      commitFeature: async (input) => {
        featureCommitCalls.push(input.baseRevisionId);
        const revisionId =
          `rev_feature_commit_${nextRevisionSequence++}` as RevisionId;
        snapshot = cloneSnapshotWithCursor(
          snapshot,
          snapshot.document.cursor,
          revisionId,
        );

        return {
          revisionId,
          featureId:
            input.featureSession.featureId ?? ("feature_created" as const),
          accepted: true,
          diagnostics: [],
        };
      },
      setDocumentCursor: async (input) => {
        cursorMoves.push({
          baseRevisionId: input.baseRevisionId,
          cursor: structuredClone(input.cursor),
          transient: input.transient,
        });
        const revisionId = `rev_cursor_${nextRevisionSequence++}` as RevisionId;
        snapshot = cloneSnapshotWithCursor(snapshot, input.cursor, revisionId);

        return {
          revisionId,
          accepted: true,
          diagnostics: [],
        };
      },
    };

    return {
      runtime,
      cursorMoves,
      previewCalls,
      featureCommitCalls,
      sketchCommitCalls,
      getSnapshotReadCount: () => snapshotReadCount,
      getSnapshot: () => snapshot,
    };
  }

  async function createSketchExtrudeSketchRevolveSnapshot() {
    const snapshot = structuredClone(await createMockWorkspaceSnapshot());
    const history = snapshot.presentation.documentHistory;
    const sketchItem = history.find((item) => item.kind === "sketch");
    const extrudeItem = history.find(
      (item) =>
        item.kind === "feature" && item.featureId === "feature_extrude-1",
    );

    if (
      !sketchItem ||
      sketchItem.kind !== "sketch" ||
      !extrudeItem ||
      extrudeItem.kind !== "feature"
    ) {
      throw new Error(
        "Mock snapshot must expose sketch and extrude history for rollback tests.",
      );
    }

    const sketch2 = {
      ...structuredClone(snapshot.document.sketches[0]!),
      sketchId: "sketch_second" as SketchId,
      ownerSketchId: "sketch_second" as SketchId,
      label: "Sketch 2",
      sketch: {
        ...structuredClone(snapshot.document.sketches[0]!.sketch),
        sketchId: "sketch_second" as SketchId,
        ownerSketchId: "sketch_second" as SketchId,
        label: "Sketch 2",
      },
    };
    const revolve = {
      ...structuredClone(
        snapshot.document.features.find(
          (feature) => feature.featureId === "feature_extrude-1",
        )!,
      ),
      featureId: "feature_revolve-1",
      ownerFeatureId: "feature_revolve-1",
      label: "Revolve 1",
    };
    const sketch2Item = {
      ...structuredClone(sketchItem),
      id: "document_history_item_sketch_sketch_second",
      label: "Sketch 2",
      target: { kind: "sketch" as const, sketchId: sketch2.sketchId },
      sketchId: sketch2.sketchId,
    };
    const revolveItem = {
      ...structuredClone(extrudeItem),
      id: "document_history_item_feature_feature_revolve-1",
      label: "Revolve 1",
      target: { kind: "feature" as const, featureId: revolve.featureId },
      featureId: revolve.featureId,
    };
    const documentHistory = [
      structuredClone(sketchItem),
      structuredClone(extrudeItem),
      sketch2Item,
      revolveItem,
    ];
    const cursor = { kind: "feature" as const, featureId: revolve.featureId };

    return {
      ...snapshot,
      cursor,
      documentHistory,
      sketches: [...snapshot.document.sketches, sketch2],
      features: [
        ...snapshot.document.features.filter(
          (feature) => feature.featureId === "feature_extrude-1",
        ),
        revolve,
      ],
      document: {
        ...snapshot.document,
        cursor,
        sketches: [...snapshot.document.sketches, sketch2],
        features: [
          ...snapshot.document.features.filter(
            (feature) => feature.featureId === "feature_extrude-1",
          ),
          revolve,
        ],
      },
      presentation: {
        ...snapshot.presentation,
        documentHistory,
      },
    } satisfies WorkspaceSnapshot;
  }

  function runEventTrace(events: readonly EditorEvent[]) {
    return replayEditorEvents(events);
  }

  async function flushAsyncWork() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  }

  function testSketchActivationEmitsCorrelatedOpenEffect() {
    const result = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: "tool.activated",
        toolId: "sketch",
      },
    );

    expect(
      result.state.kind,
      "Sketch activation should arm a selection command.",
    ).toBe("selectionCommand");
    expect(
      result.state.command.commandSessionId,
      "Sketch command session ID should be deterministic.",
    ).toBe("command_sketch-1");
    expect(
      result.effects.length,
      "Sketch without a selection should not emit an effect yet.",
    ).toBe(0);

    const openResult = transitionEditorState(
      {
        ...result.state,
      },
      {
        type: "viewport.selectionRequested",
        target: {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
      },
    );

    expect(
      openResult.effects.length,
      "Selecting a valid sketch plane should emit one open-session effect.",
    ).toBe(1);
    expect(
      openResult.effects[0]?.type,
      "The emitted effect should be sketch.openSession.",
    ).toBe("sketch.openSession");
    expect(
      openResult.effects[0]?.commandSessionId,
      "The open-session effect must preserve the originating command session ID.",
    ).toBe("command_sketch-1");
  }

  function testSketchActivationAcceptsAllPrimaryConstructionPlanes() {
    const baseState = {
      ...initialEditorState,
      document: {
        documentId: "doc_workspace" as DocumentId,
        revisionId: "rev_1" as RevisionId,
      },
      snapshot: createSnapshot(),
      selectionCatalog: createSelectionCatalog(),
    };

    for (const constructionId of [
      "construction_plane-xy",
      "construction_plane-yz",
      "construction_plane-xz",
    ] as const) {
      const activated = transitionEditorState(baseState, {
        type: "tool.activated",
        toolId: "sketch",
      });
      const openResult = transitionEditorState(activated.state, {
        type: "viewport.selectionRequested",
        target: { kind: "construction", constructionId },
      });

      expect(
        openResult.effects[0]?.type,
        `Primary construction plane ${constructionId} should emit sketch.openSession.`,
      ).toBe("sketch.openSession");
    }
  }

  function testSketchActivationReusesCompatiblePreselectionAndClearsInvalidSelection() {
    const snapshot = createSectionSelectionSnapshot();
    const selectionCatalog = buildSelectionTargetCatalog(snapshot);

    const reused = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: snapshot.document.documentId,
          revisionId: snapshot.document.revisionId,
        },
        snapshot,
        selectionCatalog,
        selection: [{ kind: "face", bodyId: "body_a", faceId: "face_top" }],
      },
      {
        type: "tool.activated",
        toolId: "sketch",
      },
    );

    expect(
      reused.state.kind,
      "Sketch activation should still route through the sketch selection command.",
    ).toBe("selectionCommand");
    expect(
      reused.state.selection.length,
      "Sketch activation should preserve one compatible preselected sketch target.",
    ).toBe(1);
    expect(
      reused.effects[0]?.type,
      "Sketch activation should immediately open from a compatible preselected target.",
    ).toBe("sketch.openSession");

    const cleared = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: snapshot.document.documentId,
          revisionId: snapshot.document.revisionId,
        },
        snapshot,
        selectionCatalog,
        selection: [
          { kind: "face", bodyId: "body_a", faceId: "face_top" },
          { kind: "construction", constructionId: "construction_plane-xy" },
        ],
      },
      {
        type: "tool.activated",
        toolId: "sketch",
      },
    );

    expect(
      cleared.state.kind,
      "Sketch activation should remain in selection mode after clearing incompatible preselection.",
    ).toBe("selectionCommand");
    expect(
      cleared.state.selection.length,
      "Sketch activation should clear incompatible multi-target preselection.",
    ).toBe(0);
    expect(
      cleared.effects.length,
      "Sketch activation should wait for a new pick after clearing incompatible preselection.",
    ).toBe(0);
  }

  function testSketchActivationAcceptsPlanarFaces() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: "tool.activated",
        toolId: "sketch",
      },
    );
    const openResult = transitionEditorState(activated.state, {
      type: "viewport.selectionRequested",
      target: { kind: "face", bodyId: "body_a", faceId: "face_top" },
    });

    expect(
      openResult.effects.length,
      "Selecting a planar face should emit one open-session effect.",
    ).toBe(1);
    expect(
      openResult.effects[0]?.type,
      "Planar-face sketch selection should open a sketch session.",
    ).toBe("sketch.openSession");
  }

  function testSectionViewActivationCollectsPlanarSeeds() {
    const snapshot = createSectionSelectionSnapshot();
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: "tool.activated",
        toolId: "sectionView",
      },
    );

    expect(
      activated.state.kind,
      "Section View activation should arm a selection command.",
    ).toBe("selectionCommand");
    expect(
      activated.state.command.toolId,
      "Section View activation should preserve the tool id.",
    ).toBe("sectionView");
    expect(
      activated.effects.length,
      "Section View activation should stay local until a seed is selected.",
    ).toBe(0);

    for (const target of [
      { kind: "construction", constructionId: "construction_plane-xy" },
      { kind: "face", bodyId: "body_a", faceId: "face_top" },
      {
        kind: "region",
        sketchId: "sketch_a",
        regionId: "region_profile_a" as RegionId,
      },
    ] as const) {
      const selected = transitionEditorState(activated.state, {
        type: "viewport.selectionRequested",
        target,
        cameraPosition: [0, 0, 20],
      });

      expect(
        selected.state.kind,
        `Section View should accept ${target.kind} seeds.`,
      ).toBe("inspectingSection");
      expect(
        selected.state.section.seed.kind,
        `Section View should store the ${target.kind} seed.`,
      ).toBe(target.kind);
      expect(
        selected.state.section.offset,
        "Accepted section seeds should start from the seed plane.",
      ).toBe(0);
      expect(
        selected.state.section.retainedSide,
        "Positive-Z camera should retain the opposite half-space by default.",
      ).toBe("negative");
    }
  }

  function testSectionViewRejectsUnsupportedOrCameraLessSeeds() {
    const snapshot = createSectionSelectionSnapshot();
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: "tool.activated",
        toolId: "sectionView",
      },
    );

    const invalidTarget = transitionEditorState(activated.state, {
      type: "viewport.selectionRequested",
      target: { kind: "body", bodyId: "body_a" },
      cameraPosition: [0, 0, 20],
    });

    expect(
      invalidTarget.state.kind,
      "Unsupported section seeds should keep the editor in seed-collection mode.",
    ).toBe("selectionCommand");

    const missingCamera = transitionEditorState(activated.state, {
      type: "viewport.selectionRequested",
      target: { kind: "face", bodyId: "body_a", faceId: "face_top" },
    });

    expect(
      missingCamera.state.kind,
      "Section View should require viewport camera context before accepting a seed.",
    ).toBe("selectionCommand");
    expect(
      missingCamera.state.preview?.label.includes("viewport-picked"),
      "Camera-less section seed attempts should explain that viewport selection context is required.",
    ).toBeTruthy();
  }

  function testSectionViewFlipAndClearPreservePlanePosition() {
    const snapshot = createSectionSelectionSnapshot();
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: "tool.activated",
        toolId: "sectionView",
      },
    );
    const selected = transitionEditorState(activated.state, {
      type: "viewport.selectionRequested",
      target: { kind: "face", bodyId: "body_a", faceId: "face_top" },
      cameraPosition: [0, 0, 20],
    });

    expect(
      selected.state.kind,
      "Accepted section seeds should enter active section inspection.",
    ).toBe("inspectingSection");
    const moved = transitionEditorState(selected.state, {
      type: "section.offsetUpdated",
      commandSessionId: selected.state.command.commandSessionId,
      offset: 7.5,
    });
    const flipped = transitionEditorState(moved.state, {
      type: "section.flipRequested",
      commandSessionId:
        moved.state.kind === "inspectingSection"
          ? moved.state.command.commandSessionId
          : ("command_unreachable" as CommandSessionId),
    });

    expect(flipped.state.kind, "Flipping should keep the section active.").toBe(
      "inspectingSection",
    );
    expect(
      flipped.state.section.offset,
      "Flipping should preserve the current plane position.",
    ).toBe(7.5);
    expect(
      flipped.state.section.retainedSide,
      "Flipping should invert the retained half-space.",
    ).toBe("positive");

    const cleared = transitionEditorState(flipped.state, {
      type: "section.cleared",
      commandSessionId: flipped.state.command.commandSessionId,
    });

    expect(
      cleared.state.kind,
      "Clearing an active section should exit the command session.",
    ).toBe("idle");
  }

  async function testMeasureActivationPairsSelectionsAndCleansUp() {
    const snapshot = await createMockWorkspaceSnapshot();
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: "tool.activated",
        toolId: "measure",
      },
    );

    expect(
      activated.state.kind,
      "Measure activation should start a transient selection command.",
    ).toBe("selectionCommand");
    expect(
      activated.state.mode,
      "Measure activation should force the workbench into part mode.",
    ).toBe("part");
    expect(
      activated.state.selectionFilter.label,
      "Measure activation should install the measurement selection filter.",
    ).toBe("Measurement targets");

    const firstSelection = transitionEditorState(activated.state, {
      type: "viewport.selectionRequested",
      target: { kind: "edge", bodyId: "body_part-1", edgeId: "edge_outer-0" },
    });
    expect(
      firstSelection.state.selection.length,
      "Measure should accept a first measurable target.",
    ).toBe(1);

    const pairedSelection = transitionEditorState(firstSelection.state, {
      type: "viewport.selectionRequested",
      target: { kind: "face", bodyId: "body_part-1", faceId: "face_top" },
    });
    expect(
      pairedSelection.state.selection.length,
      "Measure should pair supported two-target selections.",
    ).toBe(2);

    const replacedSelection = transitionEditorState(pairedSelection.state, {
      type: "viewport.selectionRequested",
      target: { kind: "body", bodyId: "body_part-1" },
    });
    expect(
      replacedSelection.state.selection.length === 1 &&
        replacedSelection.state.selection[0]?.kind === "body",
      "Selecting a fresh single-target body should replace an existing pairwise measurement.",
    ).toBeTruthy();

    const clearedSelection = transitionEditorState(replacedSelection.state, {
      type: "selection.cleared",
    });
    expect(
      clearedSelection.state.kind === "selectionCommand" &&
        clearedSelection.state.selection.length === 0,
      "Selection clearing should remove active measurement targets without exiting the command.",
    ).toBeTruthy();

    const cancelled = transitionEditorState(clearedSelection.state, {
      type: "command.cancelled",
      commandSessionId: clearedSelection.state.command.commandSessionId,
    });
    expect(
      cancelled.state.kind,
      "Measure cancellation should return the editor to idle.",
    ).toBe("idle");
  }

  function testSketchSessionPreservesStoredPlaneDefinition() {
    const yzPlane: SketchPlaneDefinition = {
      support: {
        kind: "construction",
        constructionId: "construction_plane-yz" as ConstructionId,
      },
      frame: {
        origin: [0, 0, 0],
        xAxis: [0, 1, 0],
        yAxis: [0, 0, 1],
        normal: [1, 0, 0],
        linearUnit: "documentLength",
        handedness: "rightHanded",
      },
      key: "yz",
    };

    const session = createSketchSessionFromSnapshot({
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_1",
      ownerFeatureId: null,
      ownerSketchId: "sketch_yz",
      ownerBodyId: null,
      sketchId: "sketch_yz",
      label: "Sketch YZ",
      plane: yzPlane,
      planeTarget: yzPlane.support,
      planeKey: "yz",
      sketch: {
        ownerDocumentId: "doc_workspace",
        ownerRevisionId: "rev_1",
        ownerFeatureId: null,
        ownerSketchId: "sketch_yz",
        ownerBodyId: null,
        sketchId: "sketch_yz",
        label: "Sketch YZ",
        planeSupport: yzPlane.support,
        definition: {
          schemaVersion: "sketch-definition/v1alpha1",
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
        },
        solvedSnapshot: {
          schemaVersion: "solved-sketch/v1alpha1",
          status: {
            solveState: "solved",
            constraintState: "underConstrained",
          },
          solvedEntities: [],
          solvedPoints: [],
          constraintStatuses: [],
          dimensionStatuses: [],
          diagnostics: [],
        },
        regions: [],
      },
    });

    const worldPoint = mapSketchPointToWorld(session.plane, [2, 3]);

    expect(
      session.plane.frame.normal[0],
      "Sketch sessions should retain the stored plane definition.",
    ).toBe(1);
    expect(
      worldPoint[0] === 0 && worldPoint[1] === 2 && worldPoint[2] === 3,
      "Sketch display mapping must use the stored plane definition.",
    ).toBeTruthy();
  }

  function createReopenableYzSketchSnapshot(): WorkspaceSnapshot {
    const yzSketchId = "sketch_yz" as SketchId;
    const yzPlane: SketchPlaneDefinition = {
      support: {
        kind: "construction",
        constructionId: "construction_plane-yz" as ConstructionId,
      },
      frame: {
        origin: [0, 0, 0],
        xAxis: [0, 1, 0],
        yAxis: [0, 0, 1],
        normal: [1, 0, 0],
        linearUnit: "documentLength",
        handedness: "rightHanded",
      },
      key: "yz",
    };

    const yzSketch: SketchSnapshotRecord = {
      ownerDocumentId: "doc_workspace" as DocumentId,
      ownerRevisionId: "rev_1" as RevisionId,
      ownerFeatureId: null,
      ownerSketchId: yzSketchId,
      ownerBodyId: null,
      sketchId: yzSketchId,
      label: "Sketch YZ",
      plane: yzPlane,
      planeTarget: yzPlane.support,
      planeKey: "yz" as const,
      sketch: {
        ownerDocumentId: "doc_workspace",
        ownerRevisionId: "rev_1",
        ownerFeatureId: null,
        ownerSketchId: yzSketchId,
        ownerBodyId: null,
        sketchId: yzSketchId,
        label: "Sketch YZ",
        planeSupport: yzPlane.support,
        definition: {
          schemaVersion: "sketch-definition/v1alpha1",
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
        },
        solvedSnapshot: {
          schemaVersion: "solved-sketch/v1alpha1",
          status: {
            solveState: "solved",
            constraintState: "underConstrained",
          },
          solvedEntities: [],
          solvedPoints: [],
          constraintStatuses: [],
          dimensionStatuses: [],
          diagnostics: [],
        },
        regions: [],
      },
    };

    const yzSketchEntity: SnapshotEntityRecord = {
      ownerDocumentId: "doc_workspace" as DocumentId,
      ownerRevisionId: "rev_1" as RevisionId,
      ownerFeatureId: null,
      ownerSketchId: yzSketchId,
      ownerBodyId: null,
      id: "snapshot_entity_sketch_yz" as SnapshotEntityId,
      label: "Sketch YZ",
      target: { kind: "sketch" as const, sketchId: yzSketchId },
      relatedTargets: [],
      contributingFeatureIds: [],
      consumedByFeatureIds: [],
      selectionSemantics: ["existingSketch"] as const,
    };
    const yzHistoryItem = {
      id: "document_history_item_sketch_sketch_yz",
      label: "Sketch YZ",
      description: "Authored sketch",
      kind: "sketch" as const,
      target: { kind: "sketch" as const, sketchId: yzSketchId },
      sketchId: yzSketchId,
      featureId: null,
    };

    const baseSnapshot = createSnapshot();

    return {
      ...baseSnapshot,
      cursor: { kind: "sketch", sketchId: yzSketchId },
      documentHistory: [yzHistoryItem],
      sketches: [...baseSnapshot.document.sketches, yzSketch],
      document: {
        ...baseSnapshot.document,
        cursor: { kind: "sketch", sketchId: yzSketchId },
        sketches: [...baseSnapshot.document.sketches, yzSketch],
        entities: [...baseSnapshot.document.entities, yzSketchEntity],
      },
      entities: [...baseSnapshot.presentation.entities, yzSketchEntity],
      presentation: {
        ...baseSnapshot.presentation,
        documentHistory: [yzHistoryItem],
        entities: [...baseSnapshot.presentation.entities, yzSketchEntity],
      },
    };
  }

  function testFeaturePreviewIgnoresStaleResponseIds() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [
          {
            kind: "region",
            sketchId: "sketch_a",
            regionId: "region_profile_a",
          },
        ],
      },
      {
        type: "tool.activated",
        toolId: "extrude",
      },
    );

    expect(
      activation.state.kind,
      "Extrude activation should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      activation.effects.length,
      "Extrude activation should emit a preview effect.",
    ).toBe(1);
    expect(
      activation.effects[0]?.type,
      "The emitted effect should be feature.evaluatePreview.",
    ).toBe("feature.evaluatePreview");

    const staleIgnored = transitionEditorState(activation.state, {
      type: "effect.featurePreviewCompleted",
      requestId: "request_feature-preview-stale",
      documentId: "doc_workspace",
      commandSessionId: "command_extrude-1",
      baseRevisionId: "rev_1",
      revisionId: "rev_1",
      stale: false,
      diagnostics: [],
      renderables: [],
    });

    expect(
      staleIgnored.state,
      "A preview response with the wrong request ID must be ignored.",
    ).toBe(activation.state);
  }

  function testRevolveActivationStartsFeaturePreviewFlow() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [
          {
            kind: "region",
            sketchId: "sketch_a",
            regionId: "region_profile_a",
          },
        ],
      },
      {
        type: "tool.activated",
        toolId: "revolve",
      },
    );

    expect(
      activation.state.kind,
      "Revolve activation should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      activation.state.session.featureType,
      "Revolve activation should create a revolve session.",
    ).toBe("revolve");
    expect(
      activation.effects.length,
      "Revolve activation without an axis should stay local until the draft is complete.",
    ).toBe(0);

    const completed = transitionEditorState(activation.state, {
      type: "viewport.selectionRequested",
      target: { kind: "edge", bodyId: "body_a", edgeId: "edge_axis" },
    });

    expect(
      completed.state.kind,
      "Revolve selection updates should remain in feature editing.",
    ).toBe("editingFeature");
    expect(
      completed.effects.length,
      "Selecting the missing revolve axis should emit one preview effect.",
    ).toBe(1);
    expect(
      completed.effects[0]?.type,
      "Completed revolve drafts should request a preview effect.",
    ).toBe("feature.evaluatePreview");
  }

  function testRevolveActivationSupportsFaceThenEdgeSelection() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: {
          ...createRegionSelectionCatalog(),
          selectableTargetKeys: [
            ...createRegionSelectionCatalog().selectableTargetKeys,
            "face:body_a:face_side",
            "body:body_b",
          ],
        },
        selection: [{ kind: "face", bodyId: "body_a", faceId: "face_top" }],
      },
      {
        type: "tool.activated",
        toolId: "revolve",
      },
    );

    expect(
      activation.state.kind,
      "Face-selected revolve activation should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      activation.state.session.featureType,
      "Face-selected revolve activation should create a revolve session.",
    ).toBe("revolve");
    expect(
      activation.state.session.draft.profileTargets[0]?.kind,
      "Face-selected revolve activation should keep the selected face as the revolve profile.",
    ).toBe("face");
    expect(
      activation.effects.length,
      "Face-selected revolve activation should wait for an axis before previewing.",
    ).toBe(0);

    const completed = transitionEditorState(activation.state, {
      type: "viewport.selectionRequested",
      target: { kind: "edge", bodyId: "body_a", edgeId: "edge_axis" },
    });

    expect(
      completed.state.kind,
      "Revolve face-then-edge flow should remain in feature editing.",
    ).toBe("editingFeature");
    expect(
      completed.state.session.featureType,
      "Revolve face-then-edge flow should preserve the revolve session kind.",
    ).toBe("revolve");
    expect(
      completed.state.session.draft.axisTarget?.kind,
      "Revolve face-then-edge flow should preserve the selected edge as the axis target.",
    ).toBe("edge");
    expect(
      completed.effects.length,
      "Selecting the axis after a face profile should emit one preview effect.",
    ).toBe(1);
    expect(
      completed.effects[0]?.type,
      "Completed face-then-edge revolve drafts should request a preview effect.",
    ).toBe("feature.evaluatePreview");
  }

  function testShellActivationSeedsBodyFromSelectedFace() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: "face", bodyId: "body_a", faceId: "face_top" }],
      },
      {
        type: "tool.activated",
        toolId: "shell",
      },
    );

    expect(
      activation.state.kind,
      "Shell activation should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      activation.state.session.featureType,
      "Shell activation should create a shell session.",
    ).toBe("shell");
    expect(
      activation.state.session.draft.bodyTarget?.bodyId,
      "Shell activation should infer the source body from a selected face.",
    ).toBe("body_a");
    expect(
      activation.effects.length,
      "Shell activation with a face target should emit one preview effect.",
    ).toBe(1);
    expect(
      activation.effects[0]?.type,
      "Shell activation should request a preview effect.",
    ).toBe("feature.evaluatePreview");
  }

  function testThickenActivationSeedsFaceTargetsFromSelection() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: "face", bodyId: "body_a", faceId: "face_top" }],
      },
      {
        type: "tool.activated",
        toolId: "thicken",
      },
    );

    expect(
      activation.state.kind,
      "Thicken activation should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      activation.state.session.featureType,
      "Thicken activation should create a thicken session.",
    ).toBe("thicken");
    expect(
      activation.state.session.draft.faceTargets[0]?.faceId,
      "Thicken activation should seed the selected face into the draft.",
    ).toBe("face_top");
    expect(
      activation.effects.length,
      "Thicken activation with a face target should emit one preview effect.",
    ).toBe(1);
    expect(
      activation.effects[0]?.type,
      "Thicken activation should request a preview effect.",
    ).toBe("feature.evaluatePreview");
  }

  function testSplitAndDeleteSolidActivationStartFeatureSessions() {
    const combineCatalog = createRegionSelectionCatalog();
    const combineActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: {
          ...combineCatalog,
          selectableTargetKeys: [
            ...combineCatalog.selectableTargetKeys,
            "body:body_b",
          ],
        },
        selection: [{ kind: "body", bodyId: "body_a" }],
      },
      {
        type: "tool.activated",
        toolId: "combine",
      },
    );

    expect(
      combineActivation.state.kind,
      "Combine activation should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      combineActivation.state.session.featureType,
      "Combine activation should create a combine session.",
    ).toBe("combine");
    expect(
      combineActivation.state.session.draft.targetBodyTargets[0]?.bodyId,
      "Combine activation should seed the selected body as a target body.",
    ).toBe("body_a");
    expect(
      combineActivation.effects.length,
      "Combine activation should wait for explicit tool bodies before previewing.",
    ).toBe(0);

    const combineToolSelection = transitionEditorState(
      combineActivation.state,
      {
        type: "viewport.selectionRequested",
        target: { kind: "body", bodyId: "body_b" },
      },
    );

    expect(
      combineToolSelection.state.kind === "editingFeature" &&
        combineToolSelection.state.session.featureType === "combine" &&
        combineToolSelection.state.session.draft.toolBodyTargets[0]?.bodyId ===
          "body_b",
      "Combine body selection should fill explicit tool bodies after the target role is populated.",
    ).toBeTruthy();
    expect(
      combineToolSelection.effects[0]?.type,
      "Complete Combine drafts should request a preview effect.",
    ).toBe("feature.evaluatePreview");

    const splitActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: "body", bodyId: "body_a" }],
      },
      {
        type: "tool.activated",
        toolId: "split",
      },
    );

    expect(
      splitActivation.state.kind,
      "Split activation should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      splitActivation.state.session.featureType,
      "Split activation should create a split session.",
    ).toBe("split");
    expect(
      splitActivation.state.session.draft.targetBodyTarget?.bodyId,
      "Split activation should seed the selected body as the target body.",
    ).toBe("body_a");
    expect(
      splitActivation.effects.length,
      "Split activation should wait for the tool body before previewing.",
    ).toBe(0);

    const deleteSolidActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: "body", bodyId: "body_a" }],
      },
      {
        type: "tool.activated",
        toolId: "deleteSolid",
      },
    );

    expect(
      deleteSolidActivation.state.kind,
      "Delete-solid activation should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      deleteSolidActivation.state.session.featureType,
      "Delete-solid activation should create a delete-solid session.",
    ).toBe("deleteSolid");
    expect(
      deleteSolidActivation.state.session.draft.bodyTargets[0]?.bodyId,
      "Delete-solid activation should seed the selected body into the delete list.",
    ).toBe("body_a");
    expect(
      deleteSolidActivation.effects.length,
      "Delete-solid activation with a selected body should emit one preview effect.",
    ).toBe(1);
    expect(
      deleteSolidActivation.effects[0]?.type,
      "Delete-solid activation should request a preview effect.",
    ).toBe("feature.evaluatePreview");
  }

  function testFeatureActivationReusesCompatibleSelectionAndClearsInvalidSelection() {
    const baseState = {
      ...initialEditorState,
      document: {
        documentId: "doc_workspace" as const,
        revisionId: "rev_1" as const,
      },
      snapshot: createSnapshot(),
      selectionCatalog: {
        ...createRegionSelectionCatalog(),
        selectableTargetKeys: [
          ...createRegionSelectionCatalog().selectableTargetKeys,
          "body:body_b",
        ],
      },
    };

    const reused = transitionEditorState(
      {
        ...baseState,
        selection: [
          { kind: "body", bodyId: "body_a" },
          { kind: "body", bodyId: "body_b" },
        ],
      },
      {
        type: "tool.activated",
        toolId: "combine",
      },
    );

    expect(
      reused.state.kind,
      "Compatible feature preselection should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      reused.state.selection.length,
      "Compatible feature activation should preserve the adopted selection.",
    ).toBe(2);
    expect(
      reused.state.session.draft.targetBodyTargets[0]?.bodyId === "body_a" &&
        reused.state.session.draft.toolBodyTargets[0]?.bodyId === "body_b",
      "Feature activation should seed the first adopted target and replay later adopted targets in order.",
    ).toBeTruthy();

    const cleared = transitionEditorState(
      {
        ...baseState,
        selection: [{ kind: "body", bodyId: "body_a" }],
      },
      {
        type: "tool.activated",
        toolId: "extrude",
      },
    );

    expect(
      cleared.state.kind,
      "Incompatible feature preselection should still enter the feature create flow.",
    ).toBe("editingFeature");
    expect(
      cleared.state.selection.length,
      "Incompatible feature preselection should be cleared during activation.",
    ).toBe(0);
    expect(
      cleared.state.session.draft.profileTargets.length,
      "Cleared feature activation should not partially seed the draft.",
    ).toBe(0);
  }

  function testMirrorAndTransformActivationStartFeatureSessions() {
    const mirrorActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: "body", bodyId: "body_a" }],
      },
      {
        type: "tool.activated",
        toolId: "mirror",
      },
    );

    expect(
      mirrorActivation.state.kind,
      "Mirror activation should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      mirrorActivation.state.session.featureType,
      "Mirror activation should create a mirror session.",
    ).toBe("mirror");
    expect(
      mirrorActivation.state.session.draft.bodyTargets[0]?.bodyId,
      "Mirror activation should seed the selected body as a mirror target.",
    ).toBe("body_a");
    expect(
      mirrorActivation.effects.length,
      "Mirror activation should wait for an explicit plane before previewing.",
    ).toBe(0);

    const transformActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: "body", bodyId: "body_a" }],
      },
      {
        type: "tool.activated",
        toolId: "transform",
      },
    );

    expect(
      transformActivation.state.kind,
      "Transform activation should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      transformActivation.state.session.featureType,
      "Transform activation should create a transform session.",
    ).toBe("transform");
    expect(
      transformActivation.state.session.draft.bodyTargets[0]?.bodyId,
      "Transform activation should seed the selected body as a transform target.",
    ).toBe("body_a");
    expect(
      transformActivation.effects.length,
      "Transform activation should wait for an explicit transform reference before previewing.",
    ).toBe(0);
  }

  function testActiveReferencePickerRoutesSingleAndMultiSelections() {
    const catalog = createRegionSelectionCatalog();
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: {
          ...catalog,
          selectableTargetKeys: [
            ...catalog.selectableTargetKeys,
            "face:body_a:face_side",
            "body:body_b",
          ],
        },
        selection: [{ kind: "face", bodyId: "body_a", faceId: "face_top" }],
      },
      {
        type: "tool.activated",
        toolId: "shell",
      },
    );

    expect(
      activation.state.kind,
      "Shell activation should enter feature editing.",
    ).toBe("editingFeature");

    const facesActive = transitionEditorState(activation.state, {
      type: "form.referencePickerActivated",
      fieldId: "shell-faces",
    });

    expect(
      facesActive.state.kind,
      "Reference picker activation should stay in feature editing.",
    ).toBe("editingFeature");
    expect(
      facesActive.state.activeReferencePickerFieldId,
      "Reference picker activation should track the active form field id.",
    ).toBe("shell-faces");
    expect(
      facesActive.state.selectionFilter?.label,
      "Reference picker activation should switch to the field selection filter.",
    ).toBe("Shell faces");

    const faceAppended = transitionEditorState(facesActive.state, {
      type: "viewport.selectionRequested",
      target: { kind: "face", bodyId: "body_a", faceId: "face_side" },
    });

    expect(
      faceAppended.state.kind,
      "Multi-reference selection should stay in feature editing.",
    ).toBe("editingFeature");
    expect(
      faceAppended.state.session.featureType === "shell" &&
        faceAppended.state.session.draft.faceTargets.length === 2,
      "Active multi-reference picker selection should append unique selected instances.",
    ).toBeTruthy();

    const bodyActive = transitionEditorState(faceAppended.state, {
      type: "form.referencePickerActivated",
      fieldId: "shell-body",
    });

    expect(
      bodyActive.state.kind,
      "Switching active picker fields should stay in feature editing.",
    ).toBe("editingFeature");
    expect(
      bodyActive.state.activeReferencePickerFieldId,
      "Switching active picker fields should update the active field id.",
    ).toBe("shell-body");
    expect(
      bodyActive.state.selectionFilter?.label,
      "Switching active picker fields should update the current selection filter.",
    ).toBe("Shell body");

    const bodySelected = transitionEditorState(bodyActive.state, {
      type: "viewport.selectionRequested",
      target: { kind: "body", bodyId: "body_b" },
    });

    expect(
      bodySelected.state.kind,
      "Single-reference selection should stay in feature editing.",
    ).toBe("editingFeature");
    expect(
      bodySelected.state.session.featureType === "shell" &&
        bodySelected.state.session.draft.bodyTarget?.bodyId === "body_b",
      "Active single-reference picker selection should replace the bound reference.",
    ).toBeTruthy();
  }

  function testReferencePickerCancellationAndSessionCleanup() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: "face", bodyId: "body_a", faceId: "face_top" }],
      },
      {
        type: "tool.activated",
        toolId: "shell",
      },
    );

    expect(
      activation.state.kind,
      "Shell activation should enter feature editing.",
    ).toBe("editingFeature");

    const active = transitionEditorState(activation.state, {
      type: "form.referencePickerActivated",
      fieldId: "shell-faces",
    });

    expect(
      active.state.kind,
      "Reference picker activation should stay in feature editing.",
    ).toBe("editingFeature");

    const escaped = transitionEditorState(active.state, {
      type: "form.referencePickerCancelled",
    });

    expect(
      escaped.state.kind,
      "Escape cancellation should not cancel the whole feature session.",
    ).toBe("editingFeature");
    expect(
      escaped.state.activeReferencePickerFieldId,
      "Escape cancellation should clear the active picker field.",
    ).toBe(null);
    expect(
      escaped.state.selection.length,
      "Escape cancellation should clear picker-specific pending selection.",
    ).toBe(0);
    expect(
      escaped.state.selectionFilter?.label,
      "Escape cancellation should restore the feature-level selection filter.",
    ).toBe("Shell references");

    const cancelled = transitionEditorState(active.state, {
      type: "command.cancelled",
      commandSessionId: active.state.command.commandSessionId,
    });

    expect(
      cancelled.state.kind,
      "Feature session cancellation should leave feature editing.",
    ).toBe("idle");

    const switched = transitionEditorState(active.state, {
      type: "tool.activated",
      toolId: "fillet",
    });

    expect(
      switched.state.kind,
      "Switching to another feature tool should enter the new feature session.",
    ).toBe("editingFeature");
    expect(
      switched.state.activeReferencePickerFieldId,
      "Switching to another feature session should clear active picker state.",
    ).toBe(null);
  }

  async function testImportSessionAutoArmsSinglePlanePicker() {
    const importSession = await createImageImportSession();
    const result = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: "import.fileSelected",
        session: importSession.session,
      },
      importSession.dependencies,
    );

    expect(
      result.state.kind,
      "Import file selection should enter the importing state.",
    ).toBe("importing");
    expect(
      result.state.activeReferencePickerFieldId,
      "A single import plane picker should arm automatically when the import session opens.",
    ).toBe("image-plane");
    expect(
      result.state.selectionFilter?.label,
      "Auto-armed import plane pickers should switch the editor into plane-selection mode immediately.",
    ).toBe("Plane references");
    expect(
      result.state.command.phase,
      "Auto-armed import plane pickers should keep the import command in selection-collection mode.",
    ).toBe("collecting");
  }

  async function testImportPlaneSelectionCompletesSinglePlanePicker() {
    const importSession = await createImageImportSession();
    const opened = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: "import.fileSelected",
        session: importSession.session,
      },
      importSession.dependencies,
    );

    expect(
      opened.state.kind,
      "Import file selection should enter the importing state.",
    ).toBe("importing");

    const selected = transitionEditorState(
      opened.state,
      {
        type: "viewport.selectionRequested",
        target: {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
      },
      importSession.dependencies,
    );

    expect(
      selected.state.kind,
      "Plane selection should keep the editor inside the import session.",
    ).toBe("importing");
    expect(
      selected.state.session.selections.planeTarget?.kind === "construction" &&
        selected.state.session.selections.planeTarget.constructionId ===
          "construction_plane-xy",
      "Import plane selection should patch the selected construction plane into import selections.",
    ).toBeTruthy();
    expect(
      selected.state.activeReferencePickerFieldId,
      "Single import plane picks should complete the active picker after a valid selection.",
    ).toBe(null);
    expect(
      selected.state.selectionFilter?.label,
      "Completing the import plane pick should restore the default part-mode selection filter.",
    ).toBe(getDefaultSelectionFilterForMode("part")?.label);
    expect(
      selected.state.command.phase,
      "Completing the import plane pick should return the import command to editing mode.",
    ).toBe("editing");
  }

  function testSelectionClearEventClearsSelectionAndPreservesActiveState() {
    const selectedTarget = { kind: "body", bodyId: "body_a" } as PrimitiveRef;
    const hoverTarget = {
      kind: "edge",
      bodyId: "body_a",
      edgeId: "edge_a",
    } as PrimitiveRef;
    const selectedState = {
      ...initialEditorState,
      document: {
        documentId: "doc_workspace" as const,
        revisionId: "rev_1" as const,
      },
      snapshot: createSnapshot(),
      selection: [selectedTarget],
      hoverTarget,
      selectionCatalog: createSelectionCatalog(),
    };

    const idleCleared = transitionEditorState(selectedState, {
      type: "selection.cleared",
    });

    expect(
      idleCleared.state.kind,
      "Selection clearing should keep idle state idle.",
    ).toBe("idle");
    expect(
      idleCleared.state.selection.length,
      "Selection clearing should remove idle selection.",
    ).toBe(0);
    expect(
      idleCleared.state.hoverTarget,
      "Selection clearing should remove idle hover.",
    ).toBe(null);

    const commandStarted = transitionEditorState(selectedState, {
      type: "tool.activated",
      toolId: "sketch",
    });

    expect(
      commandStarted.state.kind,
      "Sketch activation should create a selection command.",
    ).toBe("selectionCommand");

    const commandCleared = transitionEditorState(commandStarted.state, {
      type: "selection.cleared",
    });

    expect(
      commandCleared.state.kind,
      "Selection clearing should preserve active command state.",
    ).toBe("selectionCommand");
    expect(
      commandCleared.state.command.commandSessionId,
      "Selection clearing should preserve the active command session.",
    ).toBe(commandStarted.state.command.commandSessionId);
    expect(
      commandCleared.state.selection.length,
      "Selection clearing should remove active-command selection.",
    ).toBe(0);
    expect(
      commandCleared.state.hoverTarget,
      "Selection clearing should remove active-command hover.",
    ).toBe(null);

    const sketchSession = createNewSketchSession(
      createStandardPlaneDefinition("xy"),
    );
    const sketchState: SketchEditorState = {
      ...selectedState,
      kind: "editingSketch",
      mode: "sketch",
      selectionFilter: getDefaultSelectionFilterForMode("sketch"),
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(sketchSession),
        target: sketchSession.planeTarget,
      },
      command: {
        commandSessionId: "command_sketch-1",
        toolId: "sketch",
        phase: "editing",
      },
      session: sketchSession,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    };

    const sketchCleared = transitionEditorState(sketchState, {
      type: "selection.cleared",
    });

    expect(
      sketchCleared.state.kind,
      "Selection clearing should preserve sketch editing state.",
    ).toBe("editingSketch");
    expect(
      sketchCleared.state.command.commandSessionId,
      "Selection clearing should preserve the sketch command session.",
    ).toBe(sketchState.command.commandSessionId);
    expect(
      sketchCleared.state.selection.length,
      "Selection clearing should remove sketch selection.",
    ).toBe(0);
    expect(
      sketchCleared.state.hoverTarget,
      "Selection clearing should remove sketch hover.",
    ).toBe(null);
  }

  function testReplayIsDeterministic() {
    const snapshot = createSnapshot();
    const payload = {
      requestId: "request_snapshot-1" as const,
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
      snapshot,
      selectionCatalog: createSelectionCatalog(),
    };

    const events: EditorEvent[] = [
      { type: "session.started" },
      { type: "effect.snapshotLoaded", payload },
      { type: "tool.activated", toolId: "sketch" },
      {
        type: "viewport.selectionRequested",
        target: {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
      },
    ];

    const first = runEventTrace(events);
    const second = runEventTrace(events);

    expect(
      JSON.stringify(first.state),
      "Replaying the same event trace should reach the same machine state.",
    ).toBe(JSON.stringify(second.state));
    expect(
      JSON.stringify(first.effects),
      "Replaying the same event trace should emit the same effect sequence.",
    ).toBe(JSON.stringify(second.effects));
  }

  function testDirectSnapshotLoadUpdatesDocumentWithoutFetch() {
    const initialSnapshot = createSnapshot();
    const loadedState = {
      ...initialEditorState,
      document: {
        documentId: initialSnapshot.document.documentId,
        revisionId: initialSnapshot.document.revisionId,
      },
      snapshot: initialSnapshot,
      selectionCatalog: buildSelectionTargetCatalog(initialSnapshot),
    };
    const nextSnapshot = structuredClone(initialSnapshot);
    nextSnapshot.document.revisionId = "rev_2";
    nextSnapshot.document.revisionId = "rev_2";

    const loaded = transitionEditorState(loadedState, {
      type: "document.snapshotLoaded",
      snapshot: nextSnapshot,
    });

    expect(
      loaded.effects.length,
      "Direct snapshot loads should not request another snapshot fetch.",
    ).toBe(0);
    expect(
      loaded.state.snapshot?.document.revisionId,
      "Direct snapshot loads should update visible snapshot state immediately.",
    ).toBe("rev_2");
    expect(
      loaded.state.document.revisionId,
      "Direct snapshot loads should update the editor document revision.",
    ).toBe("rev_2");
  }

  function testSelectionKeyUsesDurableRefs() {
    const key = getEditorSelectionKey({
      kind: "feature",
      featureId: "feature_alpha",
    });
    expect(key, "Selection key derivation should remain deterministic.").toBe(
      "feature:feature_alpha",
    );
  }

  async function testRuntimeLoopProcessesSketchOpen() {
    const runtimeSnapshot: WorkspaceSnapshot = createSnapshot();
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: "rev_1" as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: "rev_1" as const,
        featureId: "feature_alpha" as const,
        accepted: true,
        diagnostics: [],
      }),
    };

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "effect.snapshotLoaded",
          payload: {
            requestId: "request_snapshot-1",
            documentId: "doc_workspace",
            revisionId: "rev_1",
            snapshot: runtimeSnapshot,
            selectionCatalog: createSelectionCatalog(),
          },
        },
        { type: "tool.activated", toolId: "sketch" },
        {
          type: "viewport.selectionRequested",
          target: {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Runtime loop should enter sketch editing after opening a sketch session.",
    ).toBe("editingSketch");
    expect(
      result.state.session.planeTarget.kind,
      "Opened sketch session should preserve the selected construction plane.",
    ).toBe("construction");
    expect(
      result.state.command.commandSessionId,
      "Runtime loop should preserve the originating command session ID.",
    ).toBe("command_sketch-1");
  }

  async function testRuntimeLoopOpensSketchFromPlanarFace() {
    const runtimeSnapshot = await createMockWorkspaceSnapshot();
    const planarFace = runtimeSnapshot.document.render.records.find(
      (record) =>
        record.binding.target.kind === "face" &&
        record.binding.semanticClass === "planarFace",
    )?.binding.target;
    expect(
      planarFace?.kind,
      "Mock runtime snapshot should expose a planar face render target.",
    ).toBe("face");

    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: runtimeSnapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: runtimeSnapshot.document.revisionId,
        featureId: "feature_alpha" as const,
        accepted: true,
        diagnostics: [],
      }),
    };

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "effect.snapshotLoaded",
          payload: {
            requestId: "request_snapshot-1",
            documentId: runtimeSnapshot.document.documentId,
            revisionId: runtimeSnapshot.document.revisionId,
            snapshot: runtimeSnapshot,
            selectionCatalog: buildSelectionTargetCatalog(runtimeSnapshot),
          },
        },
        { type: "tool.activated", toolId: "sketch" },
        {
          type: "viewport.selectionRequested",
          target: planarFace,
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Runtime loop should enter sketch editing after selecting a planar face.",
    ).toBe("editingSketch");
    expect(
      result.state.session.planeTarget.kind,
      "Face-backed sketch session should preserve the selected face support.",
    ).toBe("face");
    expect(
      result.state.session.plane.support.kind,
      "Face-backed sketch session should derive a face-supported plane.",
    ).toBe("face");
    expect(
      result.state.session.plane.frame.origin[2],
      "Face-backed sketch plane should derive its origin from the selected face mesh.",
    ).toBe(12);
  }

  async function testRuntimeLoopOpensSketchFromNonXYConstruction() {
    const runtimeSnapshot: WorkspaceSnapshot = {
      ...createSnapshot(),
      constructions: [
        {
          ownerDocumentId: "doc_workspace",
          ownerRevisionId: "rev_1",
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          constructionId: "construction_plane-yz" as ConstructionId,
          label: "Right Plane",
          constructionType: "plane",
          plane: createStandardPlaneDefinition("yz"),
          target: {
            kind: "construction",
            constructionId: "construction_plane-yz" as ConstructionId,
          },
        },
      ],
      document: {
        ...createSnapshot().document,
        constructions: [
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            constructionId: "construction_plane-yz" as ConstructionId,
            label: "Right Plane",
            constructionType: "plane",
            plane: createStandardPlaneDefinition("yz"),
            target: {
              kind: "construction",
              constructionId: "construction_plane-yz" as ConstructionId,
            },
          },
        ],
        entities: [
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: "snapshot_entity_plane_yz" as SnapshotEntityId,
            label: "Right Plane",
            target: {
              kind: "construction",
              constructionId: "construction_plane-yz" as ConstructionId,
            },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ["constructionPlane", "planarReference"],
          },
        ],
      },
      entities: [
        {
          ownerDocumentId: "doc_workspace",
          ownerRevisionId: "rev_1",
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          id: "snapshot_entity_plane_yz" as SnapshotEntityId,
          label: "Right Plane",
          target: {
            kind: "construction",
            constructionId: "construction_plane-yz" as ConstructionId,
          },
          relatedTargets: [],
          contributingFeatureIds: [],
          consumedByFeatureIds: [],
          selectionSemantics: ["constructionPlane", "planarReference"],
        },
      ],
      presentation: {
        ...createSnapshot().presentation,
        entities: [
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_1",
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: "snapshot_entity_plane_yz" as SnapshotEntityId,
            label: "Right Plane",
            target: {
              kind: "construction",
              constructionId: "construction_plane-yz" as ConstructionId,
            },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ["constructionPlane", "planarReference"],
          },
        ],
      },
    };
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: "rev_1" as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: "rev_1" as const,
        featureId: "feature_alpha" as const,
        accepted: true,
        diagnostics: [],
      }),
    };

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "effect.snapshotLoaded",
          payload: {
            requestId: "request_snapshot-1",
            documentId: "doc_workspace",
            revisionId: "rev_1",
            snapshot: runtimeSnapshot,
            selectionCatalog: createSelectionCatalog(),
          },
        },
        { type: "tool.activated", toolId: "sketch" },
        {
          type: "viewport.selectionRequested",
          target: {
            kind: "construction",
            constructionId: "construction_plane-yz",
          },
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "YZ construction plane should also open a sketch session.",
    ).toBe("editingSketch");
    expect(
      result.state.session.plane.key,
      "Sketch session should preserve the selected YZ plane definition.",
    ).toBe("yz");
  }

  async function testRuntimeLoopReopensStoredSketchPlane() {
    const runtimeSnapshot = createReopenableYzSketchSnapshot();
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: "rev_1" as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: "rev_1" as const,
        featureId: "feature_alpha" as const,
        accepted: true,
        diagnostics: [],
      }),
    };

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "effect.snapshotLoaded",
          payload: {
            requestId: "request_snapshot-1",
            documentId: "doc_workspace",
            revisionId: "rev_1",
            snapshot: runtimeSnapshot,
            selectionCatalog: {
              ...createSelectionCatalog(),
              selectableTargetKeys: [
                ...createSelectionCatalog().selectableTargetKeys,
                "sketch:sketch_yz",
              ],
              existingSketchKeys: ["sketch:sketch_a", "sketch:sketch_yz"],
            },
          },
        },
        { type: "tool.activated", toolId: "sketch" },
        {
          type: "viewport.selectionRequested",
          target: { kind: "sketch", sketchId: "sketch_yz" },
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Existing sketches should reopen into the sketch editor.",
    ).toBe("editingSketch");
    expect(
      result.state.session.sketchId,
      "Reopened sketch sessions should preserve the sketch identity.",
    ).toBe("sketch_yz");
    expect(
      result.state.session.plane.key,
      "Reopened sketch sessions should preserve the stored sketch plane.",
    ).toBe("yz");
  }

  async function testRuntimeLoopReopensCommittedFeatureFromExplicitIntent() {
    const runtimeSnapshot = await createMockWorkspaceSnapshot();
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: runtimeSnapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: runtimeSnapshot.document.revisionId,
        featureId: "feature_extrude-1" as const,
        accepted: true,
        diagnostics: [],
      }),
      setDocumentCursor: async () => ({
        revisionId: runtimeSnapshot.document.revisionId,
        accepted: true,
        diagnostics: [],
      }),
    };

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "effect.snapshotLoaded",
          payload: {
            requestId: "request_snapshot-1",
            documentId: runtimeSnapshot.document.documentId,
            revisionId: runtimeSnapshot.document.revisionId,
            snapshot: runtimeSnapshot,
            selectionCatalog: buildSelectionTargetCatalog(runtimeSnapshot),
          },
        },
        {
          type: "authoring.reopenRequested",
          target: { kind: "feature", featureId: "feature_extrude-1" },
          toolId: "extrude",
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Committed feature reopen should enter feature editing.",
    ).toBe("editingFeature");
    expect(
      result.state.session.mode,
      "Committed feature reopen should hydrate an edit session.",
    ).toBe("edit");
    expect(
      result.state.session.featureId,
      "Committed feature reopen should preserve the feature identity.",
    ).toBe("feature_extrude-1");
  }

  async function testRuntimeLoopReopensSketchFromExplicitIntent() {
    const runtimeSnapshot = createReopenableYzSketchSnapshot();
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: "rev_1" as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: "rev_1" as const,
        featureId: "feature_alpha" as const,
        accepted: true,
        diagnostics: [],
      }),
      setDocumentCursor: async () => ({
        revisionId: "rev_1" as const,
        accepted: true,
        diagnostics: [],
      }),
    };

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "effect.snapshotLoaded",
          payload: {
            requestId: "request_snapshot-1",
            documentId: "doc_workspace",
            revisionId: "rev_1",
            snapshot: runtimeSnapshot,
            selectionCatalog: {
              ...createSelectionCatalog(),
              selectableTargetKeys: [
                ...createSelectionCatalog().selectableTargetKeys,
                "sketch:sketch_yz",
              ],
              existingSketchKeys: ["sketch:sketch_a", "sketch:sketch_yz"],
            },
          },
        },
        {
          type: "authoring.reopenRequested",
          target: { kind: "sketch", sketchId: "sketch_yz" },
          toolId: "sketch",
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Committed sketch reopen should enter sketch editing.",
    ).toBe("editingSketch");
    expect(
      result.state.session.sketchId,
      "Committed sketch reopen should preserve the sketch identity.",
    ).toBe("sketch_yz");
    expect(
      result.state.session.plane.key,
      "Committed sketch reopen should preserve the stored sketch plane.",
    ).toBe("yz");
  }

  async function testFeatureEditEntryRollsBackBeforeHydrationFromTail() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot();
    const { runtime, cursorMoves, previewCalls } =
      createCursorAwareRuntime(snapshot);

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "authoring.reopenRequested",
          target: { kind: "feature", featureId: "feature_extrude-1" },
          toolId: "extrude",
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Feature reopen should enter editing after rollback.",
    ).toBe("editingFeature");
    expect(
      cursorMoves.length,
      "Feature reopen should move the document cursor before hydration.",
    ).toBe(1);
    expect(
      cursorMoves[0]?.cursor.kind,
      "Editing extrude should roll back to the preceding sketch.",
    ).toBe("sketch");
    expect(
      cursorMoves[0]?.transient,
      "Edit-entry rollback should be transient.",
    ).toBeTruthy();
    expect(
      result.state.snapshot?.document.cursor.kind,
      "Feature edit snapshot should be refreshed at the rollback cursor.",
    ).toBe("sketch");
    expect(
      previewCalls.length,
      "Feature edit preview should run after rollback snapshot refresh.",
    ).toBe(1);
    expect(
      previewCalls[0]?.cursor.kind,
      "Feature edit preview should evaluate against the rolled-back document basis.",
    ).toBe("sketch");
  }

  async function testSketchEditEntryRollsBackBeforeOpenFromTail() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot();
    const { runtime, cursorMoves, getSnapshotReadCount } =
      createCursorAwareRuntime(snapshot);

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "authoring.reopenRequested",
          target: { kind: "sketch", sketchId: "sketch_second" },
          toolId: "sketch",
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Committed sketch reopen should enter sketch editing.",
    ).toBe("editingSketch");
    expect(
      cursorMoves.length,
      "Sketch reopen should move the document cursor before opening.",
    ).toBe(1);
    expect(
      cursorMoves[0]?.cursor.kind === "feature" &&
        cursorMoves[0].cursor.featureId === "feature_extrude-1",
      "Editing sketch2 should roll back to the preceding extrude.",
    ).toBeTruthy();
    expect(
      result.state.snapshot?.document.cursor.kind === "feature" &&
        result.state.snapshot.document.cursor.featureId === "feature_extrude-1",
      "Sketch edit snapshot should remain at the document rollback cursor.",
    ).toBeTruthy();
    expect(
      result.state.session.historyCursor.kind,
      "Reopened sketch editing should preserve sketch-local history while the document is rolled back.",
    ).not.toBe("empty");
    expect(
      getSnapshotReadCount(),
      "Sketch reopen should reuse the rollback snapshot directly instead of forcing an extra document refresh cycle.",
    ).toBe(2);
  }

  async function testTailSketchReopenSkipsRollbackAndOpensImmediately() {
    const snapshot = createReopenableYzSketchSnapshot();
    const { runtime, cursorMoves, getSnapshotReadCount } =
      createCursorAwareRuntime(snapshot);

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "authoring.reopenRequested",
          target: { kind: "sketch", sketchId: "sketch_yz" },
          toolId: "sketch",
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Tail sketch reopen should enter sketch editing immediately.",
    ).toBe("editingSketch");
    expect(
      result.state.session.sketchId,
      "Tail sketch reopen should preserve the committed sketch id.",
    ).toBe("sketch_yz");
    expect(
      cursorMoves.length,
      "Tail sketch reopen should not roll the document cursor when the sketch is already current.",
    ).toBe(0);
    expect(
      getSnapshotReadCount(),
      "Tail sketch reopen should reuse the loaded snapshot instead of re-fetching it.",
    ).toBe(1);
  }

  async function testFeatureEditCancelRestoresTailCursor() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot();
    const { runtime, cursorMoves } = createCursorAwareRuntime(snapshot);

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "authoring.reopenRequested",
          target: { kind: "feature", featureId: "feature_extrude-1" },
          toolId: "extrude",
        },
        {
          type: "command.cancelled",
          commandSessionId: "command_extrude-1",
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Feature edit cancel should return to idle.",
    ).toBe("idle");
    expect(
      cursorMoves.length,
      "Feature edit cancel should restore the captured entry cursor.",
    ).toBe(2);
    expect(
      cursorMoves[1]?.cursor.kind === "feature" &&
        cursorMoves[1].cursor.featureId === "feature_revolve-1",
      "Feature edit cancel should restore the captured tail cursor.",
    ).toBeTruthy();
  }

  async function testFeatureEditCommitRestoresNonTailCursor() {
    const tailSnapshot = await createSketchExtrudeSketchRevolveSnapshot();
    const entryCursor = {
      kind: "sketch" as const,
      sketchId: "sketch_second" as SketchId,
    };
    const snapshot = cloneSnapshotWithCursor(
      tailSnapshot,
      entryCursor,
      tailSnapshot.document.revisionId,
    );
    const { runtime, cursorMoves, featureCommitCalls } =
      createCursorAwareRuntime(snapshot);

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "authoring.reopenRequested",
          target: { kind: "feature", featureId: "feature_extrude-1" },
          toolId: "extrude",
        },
        {
          type: "command.commitRequested",
          commandSessionId: "command_extrude-1",
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Feature edit commit should return to idle after restore.",
    ).toBe("idle");
    expect(
      featureCommitCalls.length,
      "Feature edit commit should submit the hydrated edit session.",
    ).toBe(1);
    expect(
      cursorMoves.length,
      "Feature edit commit should restore the captured entry cursor.",
    ).toBe(2);
    expect(
      cursorMoves[1]?.cursor.kind === "sketch" &&
        cursorMoves[1].cursor.sketchId === "sketch_second",
      "Feature edit commit should restore the captured non-tail cursor instead of the history tail.",
    ).toBeTruthy();
  }

  async function testSketchAbortRestoresTailCursor() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot();
    const { runtime, cursorMoves } = createCursorAwareRuntime(snapshot);

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "authoring.reopenRequested",
          target: { kind: "sketch", sketchId: "sketch_second" },
          toolId: "sketch",
        },
        {
          type: "command.cancelled",
          commandSessionId: "command_sketch-1",
        },
      ],
      runtime,
    );

    expect(result.state.kind, "Sketch abort should return to idle.").toBe(
      "idle",
    );
    expect(
      cursorMoves.length,
      "Sketch abort should restore the captured entry cursor.",
    ).toBe(2);
    expect(
      cursorMoves[1]?.cursor.kind === "feature" &&
        cursorMoves[1].cursor.featureId === "feature_revolve-1",
      "Sketch abort should restore the captured tail cursor.",
    ).toBeTruthy();
  }

  async function testFinishSketchAtCurrentSketchCursorSkipsRestore() {
    const tailSnapshot = await createSketchExtrudeSketchRevolveSnapshot();
    const entryCursor = {
      kind: "sketch" as const,
      sketchId: "sketch_second" as SketchId,
    };
    const snapshot = cloneSnapshotWithCursor(
      tailSnapshot,
      entryCursor,
      tailSnapshot.document.revisionId,
    );
    const { runtime, cursorMoves } = createCursorAwareRuntime(snapshot);

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "authoring.reopenRequested",
          target: { kind: "sketch", sketchId: "sketch_second" },
          toolId: "sketch",
        },
        {
          type: "tool.activated",
          toolId: "finishSketch",
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Finish sketch should return to idle after commit.",
    ).toBe("idle");
    expect(
      cursorMoves.length,
      "Finish sketch should not restore the document cursor when the reopened sketch is already current.",
    ).toBe(0);
    const sketchCommitIndex = result.effects.findIndex(
      (effect) => effect.type === "sketch.commit",
    );
    const refreshIndex = result.effects.findIndex(
      (effect, index) =>
        index > sketchCommitIndex && effect.type === "document.fetchSnapshot",
    );
    expect(
      sketchCommitIndex >= 0 && refreshIndex > sketchCommitIndex,
      "Finish sketch should refresh the committed snapshot after commit.",
    ).toBeTruthy();
  }

  async function testRepositoryBackedFeatureEditCommitRefreshesBeforeRestore() {
    const documentRepository = createMemoryDocumentRepository();
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const runtime = createModelingServiceEditorEffectRuntime(service);

    const result = await replayEditorEventsWithRuntime(
      [
        { type: "session.started" },
        {
          type: "authoring.reopenRequested",
          target: { kind: "feature", featureId: "feature_extrude-1" },
          toolId: "extrude",
        },
        {
          type: "command.commitRequested",
          commandSessionId: "command_extrude-1",
        },
      ],
      runtime,
    );

    expect(
      result.state.kind,
      "Repository-backed feature edit commit should exit after cursor restore.",
    ).toBe("idle");
    expect(
      result.state.snapshot?.document.cursor.kind === "feature" &&
        result.state.snapshot.document.cursor.featureId === "feature_fillet-1",
      "Repository-backed feature edit commit should restore the tail cursor captured at edit entry.",
    ).toBeTruthy();
    expect(
      result.state.preview?.label,
      "Edit-exit cursor restore should not run against stale repository provenance.",
    ).not.toBe(
      "The authored document changed after the current snapshot was loaded. Refresh before retrying this mutation.",
    );
  }

  async function testDocumentCursorRequestUsesSnapshotBasisAndRefreshesOnConflict() {
    const snapshot = structuredClone(await createMockWorkspaceSnapshot());
    snapshot.provenance = {
      repositoryHeads: ["head_a"],
      repositorySource: "peer",
    };
    const previousCursor = getPreviousDocumentHistoryCursor(snapshot);
    expect(
      previousCursor,
      "Repository cursor fixture should expose a previous cursor.",
    ).toBeTruthy();

    const boot = transitionEditorState(initialEditorState, {
      type: "session.started",
    });
    const fetchEffect = boot.effects[0];
    expect(fetchEffect?.type, "Session start should fetch a snapshot.").toBe(
      "document.fetchSnapshot",
    );
    const loaded = transitionEditorState(boot.state, {
      type: "effect.snapshotLoaded",
      payload: {
        requestId: fetchEffect.requestId,
        documentId: snapshot.document.documentId,
        revisionId: snapshot.document.revisionId,
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
    });
    const requested = transitionEditorState(loaded.state, {
      type: "document.historyCursorRequested",
      cursor: previousCursor,
    });
    const cursorEffect = requested.effects[0];

    expect(
      cursorEffect?.type,
      "Timeline cursor requests should emit the document cursor effect.",
    ).toBe("document.moveHistoryCursor");
    expect(
      cursorEffect.mutationBasis.baseRevisionId ===
        snapshot.document.revisionId &&
        cursorEffect.mutationBasis.baseRepositoryHeads?.[0] === "head_a",
      "Document cursor effects should carry the loaded snapshot repository basis.",
    ).toBeTruthy();
    expect(
      getEditorHistoryAvailability(requested.state).canUndo &&
        !getEditorHistoryAvailability(requested.state).canRedo,
      "Document history actions should be unavailable while the cursor mutation is pending.",
    ).toBeFalsy();

    const conflicted = transitionEditorState(requested.state, {
      type: "effect.documentCursorMoved",
      requestId: cursorEffect.requestId,
      documentId: snapshot.document.documentId,
      baseRevisionId: snapshot.document.revisionId,
      revisionId: "rev_9999",
      accepted: false,
      actualRevisionId: "rev_9999",
      diagnostics: [
        {
          code: "repository-head-conflict",
          severity: "error",
          message:
            "The authored document changed after the current snapshot was loaded.",
          target: null,
          detail: null,
        },
      ],
    });

    expect(
      conflicted.effects[0]?.type,
      "Repository cursor conflicts should request a refresh.",
    ).toBe("document.fetchSnapshot");
    expect(
      conflicted.state.pendingHistoryCursorRequestId,
      "Repository cursor conflicts should clear the pending cursor request.",
    ).toBe(null);
    expect(
      conflicted.state.pendingSnapshotRequestId,
      "Conflict refresh should be tracked as pending.",
    ).toBe(conflicted.effects[0]?.requestId);
  }

  function testSnapshotRefreshCanPreserveRenderRecordsForFeatureDiagnostics() {
    const previous = createSnapshot();
    const featureId = "feature_broken" as FeatureId;
    const previousRender = createRenderRecord("render_previous", featureId);
    previous.document.render.records = [previousRender];
    previous.render = previous.document.render;

    const loaded = transitionEditorState(initialEditorState, {
      type: "document.snapshotLoaded",
      snapshot: previous,
    });
    const refresh = transitionEditorState(loaded.state, {
      type: "document.refreshRequested",
    });
    const effect = refresh.effects[0];
    expect(effect?.type, "Refresh should request a document snapshot.").toBe(
      "document.fetchSnapshot",
    );

    const next = structuredClone(previous);
    next.revisionId = "rev_2";
    next.document.revisionId = "rev_2";
    next.document.render = {
      ...next.document.render,
      records: [createRenderRecord("render_failed_rebuild", featureId)],
    };
    next.render = next.document.render;
    next.document.diagnostics = [
      {
        code: "occ-missing-reference",
        severity: "error",
        message: "Extrude profile selection is incorrect.",
        featureId,
        fieldId: "profiles",
        fieldPath: ["parameters", "profiles"],
        repairGuidance: "Edit Extrude and choose a valid profile selection.",
        target: {
          kind: "region",
          sketchId: "sketch_missing" as SketchId,
          regionId: "region_missing" as RegionId,
        },
        detail: null,
      },
    ];
    next.diagnostics = next.document.diagnostics;

    const failedRefresh = transitionEditorState(refresh.state, {
      type: "effect.snapshotLoaded",
      payload: {
        requestId: effect.requestId,
        documentId: next.documentId,
        revisionId: next.revisionId,
        snapshot: next,
        selectionCatalog: buildSelectionTargetCatalog(next),
        preserveRenderRecordsOnFeatureDiagnostics: true,
      },
    });

    expect(
      failedRefresh.state.snapshot?.document.render.records[0]?.id,
      "Feature-scoped failed refreshes should preserve previous viewport render records.",
    ).toBe(previousRender.id);
    expect(
      failedRefresh.state.snapshot?.document.diagnostics[0]?.featureId,
      "Feature-scoped failed refreshes should still expose the new repair diagnostic.",
    ).toBe(featureId);
    expect(
      failedRefresh.state.snapshot?.revisionId,
      "Render preservation should not roll back the authored snapshot revision.",
    ).toBe("rev_2");

    const fixed = structuredClone(next);
    fixed.revisionId = "rev_3";
    fixed.document.revisionId = "rev_3";
    fixed.document.diagnostics = [];
    fixed.diagnostics = [];
    fixed.document.render = {
      ...fixed.document.render,
      records: [createRenderRecord("render_fixed", featureId)],
    };
    fixed.render = fixed.document.render;
    const secondRefresh = transitionEditorState(failedRefresh.state, {
      type: "document.refreshRequested",
    });
    const secondEffect = secondRefresh.effects[0];
    expect(
      secondEffect?.type,
      "Second refresh should request a document snapshot.",
    ).toBe("document.fetchSnapshot");
    const fixedRefresh = transitionEditorState(secondRefresh.state, {
      type: "effect.snapshotLoaded",
      payload: {
        requestId: secondEffect.requestId,
        documentId: fixed.documentId,
        revisionId: fixed.revisionId,
        snapshot: fixed,
        selectionCatalog: buildSelectionTargetCatalog(fixed),
        preserveRenderRecordsOnFeatureDiagnostics: true,
      },
    });

    expect(
      fixedRefresh.state.snapshot?.document.render.records[0]?.id,
      "Successful corrected refreshes should swap in the new render records.",
    ).toBe("render_fixed");
    expect(
      fixedRefresh.state.snapshot?.document.diagnostics.length,
      "Corrected refreshes should clear feature diagnostics.",
    ).toBe(0);
  }

  function testDocumentReplacementResetsIntoPartIdleState() {
    const loaded = transitionEditorState(initialEditorState, {
      type: "document.snapshotLoaded",
      snapshot: createSnapshot(),
    });
    const sketchCommand = transitionEditorState(loaded.state, {
      type: "tool.activated",
      toolId: "sketch",
    });
    const replacement = createSnapshot();
    replacement.revisionId = "rev_replaced";
    replacement.document.revisionId = "rev_replaced";

    const replaced = transitionEditorState(sketchCommand.state, {
      type: "document.replaced",
      snapshot: replacement,
    });

    expect(
      replaced.state.kind,
      "Whole-document replacement should reset the editor into idle mode.",
    ).toBe("idle");
    expect(
      replaced.state.mode,
      "Whole-document replacement should return the editor to part mode.",
    ).toBe("part");
    expect(
      replaced.state.selection.length,
      "Whole-document replacement should clear the prior selection.",
    ).toBe(0);
    expect(
      replaced.state.snapshot?.revisionId,
      "Whole-document replacement should load the replacement snapshot.",
    ).toBe("rev_replaced");
  }

  async function testEditorEventLoopBootstrapsAndLoadsSnapshot() {
    const snapshot = createSnapshot();
    let snapshotCallCount = 0;
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => {
        snapshotCallCount += 1;
        return snapshot;
      },
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: snapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: snapshot.document.revisionId,
        featureId: "feature_alpha" as const,
        accepted: true,
        diagnostics: [],
      }),
    };

    const actor = createEditorEventLoop(runtime);

    actor.start();
    await flushAsyncWork();

    const machineState = actor.getState();

    expect(
      snapshotCallCount,
      "The editor event loop should bootstrap the initial snapshot load itself.",
    ).toBe(1);
    expect(
      machineState.document.documentId,
      "Bootstrap should hydrate the document id.",
    ).toBe(snapshot.document.documentId);
    expect(
      machineState.document.revisionId,
      "Bootstrap should hydrate the revision id.",
    ).toBe(snapshot.document.revisionId);
    expect(
      machineState.snapshot?.revisionId,
      "Bootstrap should store the loaded snapshot.",
    ).toBe(snapshot.document.revisionId);
    actor.stop();
  }

  async function testEditorEventLoopCancelsObsoleteSketchOpenEffects() {
    const snapshot = createSnapshot();
    let snapshotCallCount = 0;
    let resolveOpenSnapshot: ((value: WorkspaceSnapshot) => void) | null = null;

    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: () => {
        snapshotCallCount += 1;

        if (snapshotCallCount === 1) {
          return Promise.resolve(snapshot);
        }

        return new Promise<WorkspaceSnapshot>((resolve) => {
          resolveOpenSnapshot = resolve;
        });
      },
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: snapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: snapshot.document.revisionId,
        featureId: "feature_alpha" as const,
        accepted: true,
        diagnostics: [],
      }),
    };

    const actor = createEditorEventLoop(runtime);

    actor.start();
    await flushAsyncWork();
    actor.dispatch({ type: "tool.activated", toolId: "sketch" });
    actor.dispatch({
      type: "viewport.selectionRequested",
      target: { kind: "construction", constructionId: "construction_plane-xy" },
    });
    await flushAsyncWork();

    const selectionState = actor.getState();
    expect(
      selectionState.kind,
      "Sketch activation should reach the selection workflow before opening.",
    ).toBe("selectionCommand");

    actor.dispatch({
      type: "command.cancelled",
      commandSessionId: selectionState.command.commandSessionId,
    });

    const pendingOpenSnapshotResolver = resolveOpenSnapshot as
      | ((value: WorkspaceSnapshot) => void)
      | null;

    if (pendingOpenSnapshotResolver) {
      pendingOpenSnapshotResolver(snapshot);
    }
    await flushAsyncWork();

    const cancelledState = actor.getState();

    expect(
      cancelledState.kind,
      "Cancelling sketch selection should return the runtime to idle.",
    ).toBe("idle");
    actor.stop();
  }

  function testSketchToolClearStaysInSketchEditing() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: "tool.activated",
        toolId: "sketch",
      },
    );

    const openRequested = transitionEditorState(activated.state, {
      type: "viewport.selectionRequested",
      target: { kind: "construction", constructionId: "construction_plane-xy" },
    });

    const openEffect = openRequested.effects[0];

    expect(
      openEffect?.type,
      "Sketch fixture should emit an open-session effect.",
    ).toBe("sketch.openSession");

    const opened = transitionEditorState(openRequested.state, {
      type: "effect.sketchSessionOpened",
      requestId: openEffect.requestId,
      documentId: "doc_workspace",
      revisionId: "rev_1",
      commandSessionId: openEffect.commandSessionId,
      session: createNewSketchSession(createStandardPlaneDefinition("xy")),
    });

    expect(
      opened.state.kind,
      "Sketch open fixture should enter sketch editing.",
    ).toBe("editingSketch");

    const withTool = transitionEditorState(opened.state, {
      type: "tool.activated",
      toolId: "line",
    });

    expect(
      withTool.state.kind,
      "Sketch tool activation should stay in sketch editing.",
    ).toBe("editingSketch");
    expect(
      withTool.state.session.activeTool,
      "Sketch tool activation should mark the active tool.",
    ).toBe("line");

    const cleared = transitionEditorState(withTool.state, {
      type: "sketch.activeToolCleared",
    });

    expect(
      cleared.state.kind,
      "Clearing an active sketch tool should keep the sketch session open.",
    ).toBe("editingSketch");
    expect(
      cleared.state.session.activeTool,
      "Clearing an active sketch tool should remove the active tool.",
    ).toBe(null);
    expect(
      cleared.state.command.toolId,
      "Clearing an active sketch tool should restore sketch-session command identity.",
    ).toBe("sketch");
  }

  function testRemainingSketchToolsActivateWithoutDroppingSketchSession() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: "tool.activated",
        toolId: "sketch",
      },
    );

    const openRequested = transitionEditorState(activated.state, {
      type: "viewport.selectionRequested",
      target: { kind: "construction", constructionId: "construction_plane-xy" },
    });
    const openEffect = openRequested.effects[0];

    expect(
      openEffect?.type,
      "Sketch fixture should emit an open-session effect.",
    ).toBe("sketch.openSession");

    const opened = transitionEditorState(openRequested.state, {
      type: "effect.sketchSessionOpened",
      requestId: openEffect.requestId,
      documentId: "doc_workspace",
      revisionId: "rev_1",
      commandSessionId: openEffect.commandSessionId,
      session: createNewSketchSession(createStandardPlaneDefinition("xy")),
    });
    const withTool = transitionEditorState(opened.state, {
      type: "tool.activated",
      toolId: "line",
    });

    expect(
      withTool.state.kind,
      "Sketch tool fixture should enter sketch editing.",
    ).toBe("editingSketch");

    const activeSketchToolIds = [
      ["spline", "spline"],
      ["dimension", "dimensionDistance"],
      ["trim", "trim"],
      ["offset", "offset"],
    ] as const satisfies readonly (readonly [ToolId, string])[];

    for (const [toolId, expectedActiveTool] of activeSketchToolIds) {
      const result = transitionEditorState(withTool.state, {
        type: "tool.activated",
        toolId,
      });
      const viewState = getEditorViewState(result.state);

      expect(
        result.effects.length,
        `${toolId} should not emit effects while editing a sketch.`,
      ).toBe(0);
      expect(
        result.state.kind,
        `${toolId} should keep the editor in sketch editing.`,
      ).toBe("editingSketch");
      expect(
        result.state.mode,
        `${toolId} should keep sketch toolbar mode.`,
      ).toBe("sketch");
      expect(
        viewState.sketchSession,
        `${toolId} should keep the sketch session visible to the UI.`,
      ).not.toBe(null);
      expect(viewState.mode, `${toolId} should keep sketch view mode.`).toBe(
        "sketch",
      );
      expect(
        result.state.command.toolId,
        `${toolId} should replace the active sketch command.`,
      ).toBe(toolId);
      expect(
        result.state.session.activeTool,
        `${toolId} should activate its sketch workflow.`,
      ).toBe(expectedActiveTool);
    }
  }

  function testSketchEditToolActivationReusesCompatibleSelectionAndClearsInvalidSelection() {
    const session = createOffsetFixtureSketchSession();
    const selectedTargets = session.definition.entities.map(
      (entity) => entity.target,
    );
    const baseState: SketchEditorState = {
      ...initialEditorState,
      kind: "editingSketch",
      mode: "sketch",
      document: {
        documentId: "doc_workspace",
        revisionId: "rev_1",
      },
      snapshot: createSnapshot(),
      selection: selectedTargets,
      hoverTarget: selectedTargets[selectedTargets.length - 1] ?? null,
      selectionFilter: getDefaultSelectionFilterForMode("sketch"),
      selectionCatalog: createSelectionCatalog(),
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      nextCommandSequence: initialEditorState.nextCommandSequence,
      nextRequestSequence: initialEditorState.nextRequestSequence,
      pendingSnapshotRequestId: null,
      pendingHistoryCursorRequestId: null,
      editSessionCursorContext: null,
      command: {
        commandSessionId: "command_sketch-1",
        toolId: "sketch",
        phase: "editing",
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    };

    const reused = transitionEditorState(baseState, {
      type: "tool.activated",
      toolId: "offset",
    });

    expect(
      reused.state.kind,
      "Sketch edit-tool activation should remain in sketch editing.",
    ).toBe("editingSketch");
    expect(
      reused.state.selection.length,
      "Compatible sketch edit-tool activation should preserve current selection.",
    ).toBe(selectedTargets.length);
    expect(
      reused.state.session.activeEditTool?.selectedTargets.length,
      "Compatible sketch edit-tool activation should seed the active edit tool from the adopted selection.",
    ).toBe(selectedTargets.length);
    expect(
      reused.state.session.toolStagedEntities.some(
        (entity) => entity.status === "preview",
      ),
      "Compatible sketch edit-tool activation should derive preview geometry from the adopted selection.",
    ).toBeTruthy();

    const cleared = transitionEditorState(
      {
        ...baseState,
        selection: [session.definition.points[0]!.target],
        hoverTarget: session.definition.points[0]!.target,
      },
      {
        type: "tool.activated",
        toolId: "offset",
      },
    );

    expect(
      cleared.state.kind,
      "Invalid sketch edit-tool activation should stay in sketch editing.",
    ).toBe("editingSketch");
    expect(
      cleared.state.selection.length,
      "Invalid sketch edit-tool activation should clear incompatible selection.",
    ).toBe(0);
    expect(
      cleared.state.session.activeEditTool?.selectedTargets.length,
      "Invalid sketch edit-tool activation should start with an empty edit-tool target set.",
    ).toBe(0);
  }

  function testPassiveSketchStyleToolsDoNotDropSketchSession() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: "tool.activated",
        toolId: "sketch",
      },
    );

    const openRequested = transitionEditorState(activated.state, {
      type: "viewport.selectionRequested",
      target: { kind: "construction", constructionId: "construction_plane-xy" },
    });
    const openEffect = openRequested.effects[0];

    expect(
      openEffect?.type,
      "Sketch fixture should emit an open-session effect.",
    ).toBe("sketch.openSession");

    const opened = transitionEditorState(openRequested.state, {
      type: "effect.sketchSessionOpened",
      requestId: openEffect.requestId,
      documentId: "doc_workspace",
      revisionId: "rev_1",
      commandSessionId: openEffect.commandSessionId,
      session: createNewSketchSession(createStandardPlaneDefinition("xy")),
    });
    const withTool = transitionEditorState(opened.state, {
      type: "tool.activated",
      toolId: "line",
    });

    expect(
      withTool.state.kind,
      "Sketch tool fixture should enter sketch editing.",
    ).toBe("editingSketch");

    const passiveSketchToolIds = [
      "fill",
      "stroke",
    ] as const satisfies readonly ToolId[];

    for (const toolId of passiveSketchToolIds) {
      const disabledResult = transitionEditorState(withTool.state, {
        type: "tool.activated",
        toolId,
      });

      expect(
        disabledResult.state.kind === "editingSketch" &&
          disabledResult.state.session.activeStyleFocus === null,
        `${toolId} should stay inactive while SVG rendering is disabled.`,
      ).toBeTruthy();
    }

    expect(
      withTool.state.kind === "editingSketch" &&
        !isSketchSvgRenderingEnabled(withTool.state.session),
      "New sketch sessions should start with SVG rendering disabled.",
    ).toBeTruthy();

    const svgEnabled = transitionEditorState(withTool.state, {
      type: "tool.activated",
      toolId: "svgRendering",
    });

    expect(
      svgEnabled.state.kind === "editingSketch" &&
        isSketchSvgRenderingEnabled(svgEnabled.state.session),
      "SVG rendering activation should explicitly enable sketch style tools.",
    ).toBeTruthy();

    for (const toolId of passiveSketchToolIds) {
      const result = transitionEditorState(svgEnabled.state, {
        type: "tool.activated",
        toolId,
      });
      const viewState = getEditorViewState(result.state);

      expect(
        result.effects.length,
        `${toolId} should not emit effects while editing a sketch.`,
      ).toBe(0);
      expect(
        result.state.kind,
        `${toolId} should keep the editor in sketch editing.`,
      ).toBe("editingSketch");
      expect(
        result.state.mode,
        `${toolId} should keep sketch toolbar mode.`,
      ).toBe("sketch");
      expect(
        viewState.sketchSession,
        `${toolId} should keep the sketch session visible to the UI.`,
      ).not.toBe(null);
      expect(viewState.mode, `${toolId} should keep sketch view mode.`).toBe(
        "sketch",
      );
      expect(
        result.state.command.toolId,
        `${toolId} should not replace the active sketch command.`,
      ).toBe("line");
      expect(
        result.state.session.activeTool,
        `${toolId} should not clear the active sketch tool.`,
      ).toBe("line");
      expect(
        result.state.session.activeStyleFocus?.toolId,
        `${toolId} should open style focus state.`,
      ).toBe(toolId);
      expect(
        result.state.session.activeStyleFocus.target,
        `${toolId} should show target guidance without a selection.`,
      ).toBe(null);
      expect(
        getSketchToolPresentation(result.state.session)?.selectionGuide
          ?.requiredCount,
        `${toolId} should expose style target guidance.`,
      ).toBe(1);
    }

    let styledSession = toggleSketchSvgRendering(
      createNewSketchSession(createStandardPlaneDefinition("xy")),
    );
    styledSession = beginSketchTool(styledSession, "line");
    styledSession = startSketchDraw(styledSession, [0, 0]);
    styledSession = acceptSketchDraw(styledSession, [8, 0]);

    const target = styledSession.definition.entities[0]?.target;
    expect(
      target,
      "Style focus fixture should create a selectable local sketch entity.",
    ).toBeTruthy();
    const pointTarget = styledSession.definition.points[0]?.target;
    expect(
      pointTarget,
      "Style focus fixture should create a selectable local sketch point.",
    ).toBeTruthy();

    const styledBaseState: SketchEditorState = {
      ...initialEditorState,
      kind: "editingSketch",
      mode: "sketch",
      document: {
        documentId: "doc_workspace",
        revisionId: "rev_1",
      },
      snapshot: createSnapshot(),
      selection: [target],
      hoverTarget: target,
      selectionFilter: getDefaultSelectionFilterForMode("sketch"),
      selectionCatalog: null,
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(styledSession),
        target: styledSession.planeTarget,
      },
      command: {
        commandSessionId: "command_sketch-style-1",
        toolId: "line",
        phase: "editing",
      },
      session: styledSession,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    };

    for (const toolId of passiveSketchToolIds) {
      const result = transitionEditorState(styledBaseState, {
        type: "tool.activated",
        toolId,
      });

      expect(
        result.state.kind,
        `${toolId} with a target should keep sketch editing.`,
      ).toBe("editingSketch");
      expect(
        result.state.session.activeStyleFocus?.toolId,
        `${toolId} should become the active style focus.`,
      ).toBe(toolId);
      if (toolId === "stroke") {
        expect(
          result.state.session.activeStyleFocus.target?.kind,
          `${toolId} should bind the selected style target.`,
        ).toBe("sketchEntity");
        expect(
          (getSketchToolPresentation(result.state.session)?.controlGroups?.[0]
            ?.controls.length ?? 0) > 0,
          `${toolId} should expose focused style controls for the selected target.`,
        ).toBeTruthy();
      } else {
        expect(
          result.state.session.activeStyleFocus.target,
          `${toolId} should reject a non-region style target.`,
        ).toBe(null);
        expect(
          getSketchToolPresentation(
            result.state.session,
          )?.selectionGuide?.acceptedKinds.includes("region"),
          `${toolId} should request an enclosed region target.`,
        ).toBeTruthy();
      }
    }

    const pointSelected = transitionEditorState(
      {
        ...styledBaseState,
        selection: [],
        hoverTarget: null,
      },
      {
        type: "viewport.selectionRequested",
        target: pointTarget,
      },
    );

    expect(
      pointSelected.state.kind,
      "Sketch point selection should keep sketch editing active.",
    ).toBe("editingSketch");
    expect(
      pointSelected.state.session.activeEditTarget?.pointId,
      "Sketch point selection should select the point edit target.",
    ).toBe(pointTarget.pointId);
    expect(
      getSketchToolPresentation(
        pointSelected.state.session,
      )?.controlGroups?.some((group) => group.id === "sketch-style-controls"),
      "Sketch point selection should not open SVG style controls.",
    ).toBeFalsy();
  }

  function createConstraintAuthoringEditorState(
    toolId: "dimensionDistance" | "dimensionHorizontal" = "dimensionDistance",
  ): {
    state: SketchEditorState;
    pointTarget: PrimitiveRef;
    secondPointTarget: PrimitiveRef;
    lineTarget: PrimitiveRef;
  } {
    let session = createNewSketchSession(createStandardPlaneDefinition("xy"));
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [10, 0]);
    session = beginSketchTool(session, toolId);

    const pointTarget = session.definition.points[0]?.target;
    const secondPointTarget = session.definition.points[1]?.target;
    const lineTarget = session.definition.entities[0]?.target;

    expect(
      pointTarget,
      "Constraint routing fixture should create a selectable sketch point.",
    ).toBeTruthy();
    expect(
      secondPointTarget,
      "Constraint routing fixture should create a second selectable sketch point.",
    ).toBeTruthy();
    expect(
      lineTarget,
      "Constraint routing fixture should create a selectable sketch entity.",
    ).toBeTruthy();

    return {
      pointTarget,
      secondPointTarget,
      lineTarget,
      state: {
        ...initialEditorState,
        kind: "editingSketch",
        mode: "sketch",
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot: createSnapshot(),
        selection: [],
        hoverTarget: null,
        selectionFilter: getDefaultSelectionFilterForMode("sketch"),
        selectionCatalog: null,
        preview: {
          kind: "sketch",
          label: getSketchSessionPreviewLabel(session),
          target: session.planeTarget,
        },
        command: {
          commandSessionId: `command_${toolId}-1` as CommandSessionId,
          toolId,
          phase: "editing",
        },
        session,
        pendingCommitRequestId: null,
      },
    };
  }

  function testConstraintAuthoringReceivesViewportHoverAndSelection() {
    const { state, pointTarget } = createConstraintAuthoringEditorState();

    const hovered = transitionEditorState(state, {
      type: "viewport.hovered",
      target: pointTarget,
    });

    expect(
      hovered.state.kind,
      "Hover fixture should remain in sketch editing.",
    ).toBe("editingSketch");
    expect(
      hovered.state.session.constraintAuthoring?.hoverTarget?.target &&
        primitiveRefEquals(
          hovered.state.session.constraintAuthoring.hoverTarget.target,
          pointTarget,
        ),
      "Active constraint authoring should record valid viewport hover targets.",
    ).toBeTruthy();

    const selected = transitionEditorState(hovered.state, {
      type: "viewport.selectionRequested",
      target: pointTarget,
    });

    expect(
      selected.state.kind,
      "Selection fixture should remain in sketch editing.",
    ).toBe("editingSketch");
    expect(
      selected.state.session.constraintAuthoring?.selectedTargets.length ===
        1 &&
        primitiveRefEquals(
          selected.state.session.constraintAuthoring.selectedTargets[0]!.target,
          pointTarget,
        ),
      "Active constraint authoring should record valid viewport click targets.",
    ).toBeTruthy();
  }

  function testDimensionSelectionClickPinsReadyValuePreview() {
    const { state, pointTarget, secondPointTarget, lineTarget } =
      createConstraintAuthoringEditorState();

    const selectedFirst = transitionEditorState(state, {
      type: "viewport.selectionRequested",
      target: pointTarget,
    });
    expect(
      selectedFirst.state.kind,
      "First dimension target selection should keep sketch editing.",
    ).toBe("editingSketch");

    const selectedSecond = transitionEditorState(selectedFirst.state, {
      type: "viewport.selectionRequested",
      target: secondPointTarget,
    });
    expect(
      selectedSecond.state.kind,
      "Second dimension target selection should keep sketch editing.",
    ).toBe("editingSketch");

    const moved = transitionEditorState(selectedSecond.state, {
      type: "sketch.pointerMoved",
      point: mapSketchPointToWorld(selectedSecond.state.session.plane, [5, 3]),
    });
    expect(
      moved.state.kind,
      "Pointer movement over ready dimension preview should keep sketch editing.",
    ).toBe("editingSketch");

    const clickedGeometry = transitionEditorState(moved.state, {
      type: "viewport.selectionRequested",
      target: lineTarget,
    });

    expect(
      clickedGeometry.state.kind,
      "Dimension placement click fixture should keep sketch editing.",
    ).toBe("editingSketch");
    expect(
      clickedGeometry.state.session.constraintAuthoring?.isPreviewPinned ===
        true &&
        clickedGeometry.state.session.constraintAuthoring.selectedTargets
          .length === 2,
      "Clicking geometry while a value-backed dimension is ready should pin placement instead of replacing operands.",
    ).toBeTruthy();
    expect(
      getSketchToolPresentation(clickedGeometry.state.session)?.floatingInput
        ?.label,
      "Pinning placement from a target click should open the floating value-entry input.",
    ).toBe("Distance");
  }

  function testDimensionReleaseOverSecondLineDefersToAngleSelection() {
    let session = createNewSketchSession(createStandardPlaneDefinition("xy"));
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [10, 0]);
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [5, -5]);
    session = acceptSketchDraw(session, [5, 5]);
    session = beginSketchTool(session, "dimensionDistance");

    const [firstLineTarget, secondLineTarget] = session.definition.entities.map(
      (entity) => entity.target,
    );
    expect(
      firstLineTarget && secondLineTarget,
      "Angle dimension release fixture should create two selectable lines.",
    ).toBeTruthy();

    const state: SketchEditorState = {
      ...initialEditorState,
      kind: "editingSketch",
      mode: "sketch",
      document: {
        documentId: "doc_workspace",
        revisionId: "rev_1",
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode("sketch"),
      selectionCatalog: null,
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId:
          "command_dimension-angle-release-1" as CommandSessionId,
        toolId: "dimensionDistance",
        phase: "editing",
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    };

    const selectedFirst = transitionEditorState(state, {
      type: "viewport.selectionRequested",
      target: firstLineTarget,
    });
    expect(
      selectedFirst.state.kind,
      "First line selection should keep sketch editing.",
    ).toBe("editingSketch");

    const releaseOverSecond = transitionEditorState(selectedFirst.state, {
      type: "sketch.pointerReleased",
      point: mapSketchPointToWorld(selectedFirst.state.session.plane, [5, 0]),
      target: secondLineTarget,
    });
    expect(
      releaseOverSecond.state.kind,
      "Release over second line should keep sketch editing.",
    ).toBe("editingSketch");
    expect(
      releaseOverSecond.state.session.constraintAuthoring?.isPreviewPinned ===
        false &&
        releaseOverSecond.state.session.constraintAuthoring.selectedTargets
          .length === 1,
      "Pointer release over a selectable second line should not pin the first line length preview before click selection.",
    ).toBeTruthy();

    const selectedSecond = transitionEditorState(releaseOverSecond.state, {
      type: "viewport.selectionRequested",
      target: secondLineTarget,
    });
    expect(
      selectedSecond.state.kind,
      "Second line selection should keep sketch editing.",
    ).toBe("editingSketch");

    let anglePreview = getSketchToolPresentation(
      selectedSecond.state.session,
    )?.overlays?.find((overlay) => overlay.kind === "angleArc");
    expect(
      selectedSecond.state.session.constraintAuthoring?.selectedTargets
        .length === 2 && anglePreview?.kind === "angleArc",
      "Selecting the second non-parallel line should preserve the two-line angle preview.",
    ).toBeTruthy();

    const moved = transitionEditorState(selectedSecond.state, {
      type: "sketch.pointerMoved",
      point: mapSketchPointToWorld(selectedSecond.state.session.plane, [8, 3]),
    });
    expect(
      moved.state.kind,
      "Pointer movement after angle selection should keep sketch editing.",
    ).toBe("editingSketch");
    anglePreview = getSketchToolPresentation(
      moved.state.session,
    )?.overlays?.find((overlay) => overlay.kind === "angleArc");
    const lengthPreview = getSketchToolPresentation(
      moved.state.session,
    )?.overlays?.find(
      (overlay) =>
        overlay.kind === "dimensionLine" &&
        overlay.referenceKind === "lineLength",
    );
    expect(
      anglePreview?.kind === "angleArc" && !lengthPreview,
      "Pointer movement after two selected lines should not fall back to the first line length dimension.",
    ).toBeTruthy();

    const placed = transitionEditorState(moved.state, {
      type: "sketch.pointerReleased",
      point: mapSketchPointToWorld(moved.state.session.plane, [4, -1]),
      target: null,
    });
    expect(
      placed.state.kind,
      "Angle placement click should keep sketch editing.",
    ).toBe("editingSketch");
    expect(
      placed.state.session.constraintAuthoring?.isPreviewPinned === true &&
        getSketchToolPresentation(placed.state.session)?.floatingInput
          ?.label === "Angle",
      "Clicking the primary viewport after angle preview should pin placement and keep the value entry open.",
    ).toBeTruthy();
  }

  function testConstraintAuthoringIgnoresInvalidViewportSelection() {
    const { state, lineTarget } = createConstraintAuthoringEditorState(
      "dimensionHorizontal",
    );

    const selected = transitionEditorState(state, {
      type: "viewport.selectionRequested",
      target: lineTarget,
    });

    expect(
      selected.state.kind,
      "Invalid constraint selection fixture should remain in sketch editing.",
    ).toBe("editingSketch");
    expect(
      selected.state.session.constraintAuthoring?.selectedTargets.length,
      "Dimension point authoring should ignore viewport clicks on rejected sketch entity targets.",
    ).toBe(0);
  }

  function createConnectedSelectionEditorState(): {
    state: SketchEditorState;
    localTarget: PrimitiveRef;
    projectedTarget: PrimitiveRef;
  } {
    const sketchId = "sketch_draft" as SketchId;
    const pointA = "sketch_point_a" as SketchPointId;
    const pointB = "sketch_point_b" as SketchPointId;
    const pointC = "sketch_point_c" as SketchPointId;
    const entityAB = "sketch_entity_ab" as SketchEntityId;
    const entityBC = "sketch_entity_bc" as SketchEntityId;
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [pointA, pointB, pointC],
      points: [
        {
          pointId: pointA,
          label: "A",
          target: { kind: "sketchPoint", sketchId, pointId: pointA },
          position: [0, 0],
          isConstruction: false,
        },
        {
          pointId: pointB,
          label: "B",
          target: { kind: "sketchPoint", sketchId, pointId: pointB },
          position: [1, 0],
          isConstruction: false,
        },
        {
          pointId: pointC,
          label: "C",
          target: { kind: "sketchPoint", sketchId, pointId: pointC },
          position: [2, 0],
          isConstruction: false,
        },
      ],
      entityIds: [entityAB, entityBC],
      entities: [
        {
          kind: "lineSegment",
          entityId: entityAB,
          label: "AB",
          target: { kind: "sketchEntity", sketchId, entityId: entityAB },
          isConstruction: false,
          startPointId: pointA,
          endPointId: pointB,
        },
        {
          kind: "lineSegment",
          entityId: entityBC,
          label: "BC",
          target: { kind: "sketchEntity", sketchId, entityId: entityBC },
          isConstruction: false,
          startPointId: pointB,
          endPointId: pointC,
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const session = {
      ...createNewSketchSession(createStandardPlaneDefinition("xy")),
      sketchId,
      definition,
      fullDefinition: definition,
    };
    const localTarget = definition.entities[0]!.target;
    const projectedTarget: PrimitiveRef = {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_projected",
      geometryId: "projected_geometry_line",
      geometryKind: "lineSegment",
    };

    return {
      localTarget,
      projectedTarget,
      state: {
        ...initialEditorState,
        kind: "editingSketch",
        mode: "sketch",
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot: createSnapshot(),
        selection: [],
        hoverTarget: null,
        selectionFilter: getDefaultSelectionFilterForMode("sketch"),
        selectionCatalog: null,
        preview: {
          kind: "sketch",
          label: getSketchSessionPreviewLabel(session),
          target: session.planeTarget,
        },
        command: {
          commandSessionId: "command_sketch-connected-selection-1",
          toolId: "sketch",
          phase: "editing",
        },
        session,
        pendingCommitRequestId: null,
        pendingProjectionRequestId: null,
        pendingImportRequestId: null,
      },
    };
  }

  function testConnectedSketchSelectionEventUpdatesNormalSelectionState() {
    const { state, localTarget } = createConnectedSelectionEditorState();
    const selected = transitionEditorState(state, {
      type: "sketch.connectedSelectionRequested",
      target: localTarget,
    });

    expect(
      selected.state.kind,
      "Connected selection should stay in sketch editing.",
    ).toBe("editingSketch");
    expect(
      selected.state.selection.length === 2 &&
        selected.state.selection.every(
          (target) => target.kind === "sketchEntity",
        ),
      "Connected selection should update the normal editor selection with the connected sketch entities.",
    ).toBeTruthy();
  }

  function testConnectedSketchSelectionEventWorksAfterRectangleToolAcceptsShape() {
    let session = createNewSketchSession(createStandardPlaneDefinition("xy"));
    session = beginSketchTool(session, "rectangle");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 3]);
    const localTarget = session.definition.entities[0]?.target;
    expect(
      localTarget,
      "Rectangle fixture should create a selectable sketch entity.",
    ).toBeTruthy();

    const selected = transitionEditorState(
      {
        ...initialEditorState,
        kind: "editingSketch",
        mode: "sketch",
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot: createSnapshot(),
        selection: [],
        hoverTarget: null,
        selectionFilter: getDefaultSelectionFilterForMode("sketch"),
        selectionCatalog: null,
        preview: {
          kind: "sketch",
          label: getSketchSessionPreviewLabel(session),
          target: session.planeTarget,
        },
        command: {
          commandSessionId: "command_sketch-connected-rectangle-1",
          toolId: "rectangle",
          phase: "editing",
        },
        session,
        pendingCommitRequestId: null,
        pendingProjectionRequestId: null,
        pendingImportRequestId: null,
      },
      {
        type: "sketch.connectedSelectionRequested",
        target: localTarget,
      },
    );

    expect(
      selected.state.kind,
      "Connected rectangle selection should stay in sketch editing.",
    ).toBe("editingSketch");
    expect(
      selected.state.selection.length === 4 &&
        selected.state.selection.every(
          (target) => target.kind === "sketchEntity",
        ),
      "Double-clicking one accepted rectangle edge while Rectangle remains active should select all four rectangle edges.",
    ).toBeTruthy();
  }

  function testConnectedSketchSelectionEventRejectsUnsupportedTargets() {
    const { state, projectedTarget } = createConnectedSelectionEditorState();
    const selected = transitionEditorState(state, {
      type: "sketch.connectedSelectionRequested",
      target: projectedTarget,
    });

    expect(
      selected.state.kind,
      "Unsupported connected selection should stay in sketch editing.",
    ).toBe("editingSketch");
    expect(
      selected.state.selection.length,
      "Projected reference geometry should not expand through the connected selection event.",
    ).toBe(0);
  }

  function testCommittedAnnotationSelectionAndDeletionRoutesThroughSketchMutation() {
    let session = createNewSketchSession(createStandardPlaneDefinition("xy"));
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [10, 1]);
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 5]);
    session = acceptSketchDraw(session, [10, 6]);

    const [firstLineId, secondLineId] = session.definition.entityIds;
    expect(
      firstLineId && secondLineId,
      "Annotation deletion fixture should create two sketch lines.",
    ).toBeTruthy();

    session = beginSketchTool(session, "constraintParallel");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: firstLineId,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: secondLineId,
    });

    const annotation = getSketchAnnotationDescriptors(session)[0];
    expect(
      annotation,
      "Annotation deletion fixture should create a committed annotation descriptor.",
    ).toBeTruthy();

    const selected = transitionEditorState(
      {
        ...initialEditorState,
        kind: "editingSketch",
        mode: "sketch",
        document: {
          documentId: "doc_workspace",
          revisionId: "rev_1",
        },
        snapshot: createSnapshot(),
        selection: [],
        hoverTarget: null,
        selectionFilter: getDefaultSelectionFilterForMode("sketch"),
        selectionCatalog: null,
        preview: {
          kind: "sketch",
          label: getSketchSessionPreviewLabel(session),
          target: session.planeTarget,
        },
        command: {
          commandSessionId: "command_sketch-annotation-1",
          toolId: "sketch",
          phase: "editing",
        },
        session,
        pendingCommitRequestId: null,
      },
      {
        type: "viewport.selectionRequested",
        target: annotation.target,
      },
    );

    expect(
      selected.state.kind,
      "Selecting an annotation should stay in sketch editing.",
    ).toBe("editingSketch");
    expect(
      selected.state.session.selectedAnnotation &&
        primitiveRefEquals(
          selected.state.session.selectedAnnotation,
          annotation.target,
        ),
      "Viewport annotation selection should select the durable annotation target.",
    ).toBeTruthy();
    expect(
      selected.state.session.definition.constraintIds.length,
      "Selecting an annotation should not select or delete affected geometry.",
    ).toBe(1);

    const deleted = transitionEditorState(selected.state, {
      type: "sketch.annotationDeleteRequested",
    });

    expect(
      deleted.state.kind,
      "Deleting an annotation should stay in sketch editing.",
    ).toBe("editingSketch");
    expect(
      deleted.state.session.definition.constraintIds.length,
      "Annotation deletion should remove the durable constraint record from sketch state.",
    ).toBe(0);
    expect(
      deleted.state.session.commitRequest?.definition.constraintIds.length,
      "Annotation deletion should update the durable sketch commit request.",
    ).toBe(0);
  }

  function testSketchHistoryDeleteStaysDistinctFromLiveSelectionDelete() {
    const baseSession = appendReferenceImageOperations(
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
    );
    const operationId =
      baseSession.fullDefinition.authoringOperations?.[0]?.operationId;
    expect(
      operationId,
      "History-delete fixture should create a committed reference-image operation.",
    ).toBeTruthy();

    const baseState: SketchEditorState = {
      ...initialEditorState,
      kind: "editingSketch",
      mode: "sketch",
      document: {
        documentId: "doc_workspace",
        revisionId: "rev_1",
      },
      snapshot: createSnapshot(),
      selection: [
        {
          kind: "sketchOperation",
          sketchId: "sketch_draft",
          operationId,
        },
      ],
      hoverTarget: {
        kind: "sketchOperation",
        sketchId: "sketch_draft",
        operationId,
      },
      selectionFilter: getDefaultSelectionFilterForMode("sketch"),
      selectionCatalog: null,
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(baseSession),
        target: baseSession.planeTarget,
      },
      command: {
        commandSessionId: "command_sketch-history-delete-1",
        toolId: "sketch",
        phase: "editing",
      },
      session: baseSession,
      pendingCommitRequestId: null,
    };

    const deletedFromHistory = transitionEditorState(baseState, {
      type: "sketch.historyOperationDeleteRequested",
      operationId,
    });
    expect(
      deletedFromHistory.state.kind,
      "History-row deletion should keep the sketch editor active.",
    ).toBe("editingSketch");
    expect(
      deletedFromHistory.state.session.fullDefinition.authoringOperations
        ?.length,
      "History-row deletion should remove the targeted authored operation instead of appending a delete row.",
    ).toBe(0);
    expect(
      deletedFromHistory.state.selection.length,
      "History-row deletion should clear live selection state after the rewrite.",
    ).toBe(0);

    const liveDelete = transitionEditorState(baseState, {
      type: "sketch.annotationDeleteRequested",
    });
    expect(
      liveDelete.state.kind,
      "Live selection deletion should keep the sketch editor active.",
    ).toBe("editingSketch");
    expect(
      liveDelete.state.session.fullDefinition.authoringOperations?.length,
      "Live selection deletion of a reference image should append a durable delete operation.",
    ).toBe(2);
    expect(
      liveDelete.state.session.fullDefinition.authoringOperations?.at(-1)?.kind,
      "Live selection deletion should preserve the existing append-delete semantics for viewport-selected reference images.",
    ).toBe("delete");
  }

  function testCommittedDimensionAnnotationEditRequestOpensAndCommitsValueForm() {
    let session = createNewSketchSession(createStandardPlaneDefinition("xy"));
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [10, 0]);
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 5]);
    session = acceptSketchDraw(session, [10, 5]);

    const [firstPointId, , , diagonalPointId] = session.definition.pointIds;
    expect(
      firstPointId && diagonalPointId,
      "Annotation edit fixture should create selectable sketch points.",
    ).toBeTruthy();

    session = beginSketchTool(session, "dimensionDistance");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: firstPointId,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: diagonalPointId,
    });
    session = patchSketchConstraintValue(session, { value: 24 });
    session = patchSketchConstraintValue(session, {
      intent: "commitConstraintValue",
    });

    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) => entry.target.kind === "dimension",
    );
    expect(
      annotation?.target.kind,
      "Annotation edit fixture should create a committed dimension annotation.",
    ).toBe("dimension");

    const baseState: SketchEditorState = {
      ...initialEditorState,
      kind: "editingSketch",
      mode: "sketch",
      document: {
        documentId: "doc_workspace",
        revisionId: "rev_1",
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode("sketch"),
      selectionCatalog: null,
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: "command_sketch-annotation-edit-1",
        toolId: "sketch",
        phase: "editing",
      },
      session,
      pendingCommitRequestId: null,
    };

    const opened = transitionEditorState(baseState, {
      type: "sketch.annotationEditRequested",
      target: annotation.target,
    });

    expect(
      opened.state.kind,
      "Annotation edit request should stay in sketch editing.",
    ).toBe("editingSketch");
    expect(
      opened.state.session.activeAnnotationEdit?.target.kind,
      "Annotation edit request should open a committed dimension edit session.",
    ).toBe("dimension");
    expect(
      opened.state.session.toolPresentation?.floatingInput?.value,
      "Committed dimension edit form should open with the durable dimension value.",
    ).toBe("24");

    const changed = transitionEditorState(opened.state, {
      type: "sketch.toolPatched",
      patch: { value: 33 },
    });
    const committed = transitionEditorState(changed.state, {
      type: "sketch.toolPatched",
      patch: { intent: "commitAnnotationValue" },
    });

    expect(
      committed.state.kind,
      "Committed dimension edit should stay in sketch editing.",
    ).toBe("editingSketch");
    expect(
      committed.state.session.definition.dimensions[0]?.kind === "distance" &&
        committed.state.session.definition.dimensions[0].value.source === "literal" &&
        committed.state.session.definition.dimensions[0].value.value === 33,
      "Committed dimension edit should update the existing durable dimension record.",
    ).toBeTruthy();
  }

  function testSketchStylePatchRoutesThroughSelectionAndUpdatesCommitRequest() {
    let session = createNewSketchSession(createStandardPlaneDefinition("xy"));
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [8, 0]);

    const target = session.definition.entities[0]?.target;
    expect(
      target,
      "Style patch routing fixture should create a selectable local sketch entity.",
    ).toBeTruthy();

    const baseState: SketchEditorState = {
      ...initialEditorState,
      kind: "editingSketch",
      mode: "sketch",
      document: {
        documentId: "doc_workspace",
        revisionId: "rev_1",
      },
      snapshot: createSnapshot(),
      selection: [target],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode("sketch"),
      selectionCatalog: null,
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: "command_sketch-style-patch-1",
        toolId: "line",
        phase: "editing",
      },
      session,
      pendingCommitRequestId: null,
    };

    const patched = transitionEditorState(baseState, {
      type: "sketch.toolPatched",
      patch: {
        intent: "patchSketchStyle",
        field: "strokeColor",
        value: "#ff00ff",
      },
    });

    expect(
      patched.state.kind,
      "Sketch style patch event should remain in sketch editing.",
    ).toBe("editingSketch");
    expect(
      patched.state.session.definition.entities[0]?.style?.strokeColor,
      "Sketch style patch should update the selected local entity style via sketch.toolPatched routing.",
    ).toBe("#ff00ff");
    expect(
      patched.state.session.commitRequest?.definition.entities[0]?.style
        ?.strokeColor,
      "Sketch style patch should rebuild the durable commit request payload.",
    ).toBe("#ff00ff");
  }

  function testRejectedSketchCommitShowsValidationMessage() {
    const session = createNewSketchSession(createStandardPlaneDefinition("xy"));
    const diagnostic: ModelingDiagnostic = {
      code: "mock-invalid-sketch",
      severity: "error",
      message: "Sketch solve ended with residual 12.",
      target: null,
      detail: null,
    };
    const state: SketchEditorState = {
      ...initialEditorState,
      kind: "editingSketch",
      mode: "sketch",
      document: {
        documentId: "doc_workspace",
        revisionId: "rev_1",
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode("sketch"),
      selectionCatalog: null,
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: "command_sketch-commit-1",
        toolId: "finishSketch",
        phase: "awaitingEffect",
      },
      session,
      pendingCommitRequestId: "request_sketch-commit-1",
    };

    const rejected = transitionEditorState(state, {
      type: "effect.sketchCommitted",
      requestId: "request_sketch-commit-1",
      documentId: "doc_workspace",
      commandSessionId: "command_sketch-commit-1",
      baseRevisionId: "rev_1",
      revisionId: "rev_1",
      accepted: false,
      diagnostics: [diagnostic],
    });

    expect(
      rejected.state.kind,
      "Rejected sketch commit should keep the sketch open.",
    ).toBe("editingSketch");
    expect(
      rejected.state.session.validationMessage,
      "Rejected sketch commit diagnostics should surface in the visible sketch validation message.",
    ).toBe(diagnostic.message);
  }

  function testSketchCommitConflictRefreshesBeforeRetry() {
    let session = createNewSketchSession(createStandardPlaneDefinition("xy"));
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [8, 0]);
    expect(
      session.commitRequest,
      "Sketch conflict fixture should have a commit payload.",
    ).toBeTruthy();

    const staleSnapshot = createSnapshot();
    staleSnapshot.document.revisionId = "rev_0001";
    staleSnapshot.document.revisionId = "rev_0001";
    const diagnostic: ModelingDiagnostic = {
      code: "occ-revision-conflict",
      severity: "error",
      message:
        "Request revision rev_0001 does not match current revision rev_0002.",
      target: null,
      detail: {
        kind: "revisionConflict",
        expectedRevisionId: "rev_0001",
        actualRevisionId: "rev_0002",
      },
    };
    const state: SketchEditorState = {
      ...initialEditorState,
      kind: "editingSketch",
      mode: "sketch",
      document: {
        documentId: "doc_workspace",
        revisionId: "rev_0001",
      },
      snapshot: staleSnapshot,
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode("sketch"),
      selectionCatalog: null,
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: "command_sketch-commit-1",
        toolId: "finishSketch",
        phase: "awaitingEffect",
      },
      session,
      pendingCommitRequestId: "request_sketch-commit-1",
    };

    const conflicted = transitionEditorState(state, {
      type: "effect.sketchCommitted",
      requestId: "request_sketch-commit-1",
      documentId: "doc_workspace",
      commandSessionId: "command_sketch-commit-1",
      baseRevisionId: "rev_0001",
      revisionId: "rev_0002",
      accepted: false,
      actualRevisionId: "rev_0002",
      diagnostics: [diagnostic],
    });

    const refreshEffect = conflicted.effects[0];
    expect(
      refreshEffect?.type,
      "Sketch commit conflicts should request a snapshot refresh.",
    ).toBe("document.fetchSnapshot");
    expect(
      conflicted.state.kind,
      "Sketch commit conflicts should keep the sketch open.",
    ).toBe("editingSketch");
    expect(
      conflicted.state.document.revisionId,
      "Sketch commit conflicts should advance the editor revision.",
    ).toBe("rev_0002");
    expect(
      conflicted.state.pendingSnapshotRequestId,
      "Conflict refresh should be tracked as pending.",
    ).toBe(refreshEffect.requestId);

    const refreshedSnapshot = createSnapshot();
    refreshedSnapshot.document.revisionId = "rev_0002";
    refreshedSnapshot.document.revisionId = "rev_0002";
    const refreshed = transitionEditorState(conflicted.state, {
      type: "effect.snapshotLoaded",
      payload: {
        requestId: refreshEffect.requestId,
        documentId: refreshedSnapshot.document.documentId,
        revisionId: refreshedSnapshot.document.revisionId,
        snapshot: refreshedSnapshot,
        selectionCatalog: buildSelectionTargetCatalog(refreshedSnapshot),
      },
    });
    const retry = transitionEditorState(refreshed.state, {
      type: "tool.activated",
      toolId: "finishSketch",
    });
    const retryEffect = retry.effects[0];

    expect(
      retryEffect?.type,
      "Retrying Finish Sketch should emit another sketch commit.",
    ).toBe("sketch.commit");
    expect(
      retryEffect.baseRevisionId,
      "Sketch commit retries should use the refreshed revision.",
    ).toBe("rev_0002");
  }

  async function testModelingServiceRuntimePreservesResultRejections() {
    const appError = createAppError({
      code: "modeling/diagnostic",
      message:
        "The authored document changed after the current snapshot was loaded.",
      context: [
        { key: "diagnosticCode", value: "repository-head-conflict" },
        { key: "reasonCode", value: "repositoryChanged" },
        { key: "diagnosticCount", value: 2 },
        {
          key: "diagnosticCodes",
          value: "feature-warning,repository-head-conflict",
        },
        { key: "actualRevisionId", value: "rev_2" },
      ],
    });
    const runtime = createModelingServiceEditorEffectRuntime({
      async getCurrentDocumentSnapshot() {
        return createSnapshot();
      },
      async projectSketchExternalReferences() {
        return { projectedReferences: [], diagnostics: [] };
      },
      sketchSolver: null,
      commitSketch() {
        throw new Error("Sketch commit is not used by this test.");
      },
      evaluatePreview() {
        throw new Error("Feature preview is not used by this test.");
      },
      createFeature() {
        throw new Error("Feature create is not used by this test.");
      },
      updateFeature() {
        throw new Error("Feature update is not used by this test.");
      },
      setFeatureCursor() {
        return ResultAsync.fromPromise(
          Promise.reject(appError),
          (error) => error as AppError,
        );
      },
    });

    expect(
      runtime.setDocumentCursor,
      "Modeling service runtime should expose document cursor mutation.",
    ).toBeTruthy();
    const rejected = await runtime.setDocumentCursor({
      baseRevisionId: "rev_1",
      cursor: { kind: "feature", featureId: "feature_a" },
    });

    expect(
      rejected.accepted,
      "Modeling service Result Errs should become typed rejected mutation results.",
    ).toBeFalsy();
    expect(
      rejected.revisionId,
      "Rejected mutation results should retain actual revision ids.",
    ).toBe("rev_2");
    expect(
      rejected.diagnostics[0]?.code,
      "Rejected mutation diagnostics should retain the modeling diagnostic code.",
    ).toBe("repository-head-conflict");
    expect(
      rejected.errorContext?.some(
        (entry) =>
          entry.key === "diagnosticCodes" &&
          entry.value === "feature-warning,repository-head-conflict",
      ),
      "Rejected mutation results should retain structured modeling error context.",
    ).toBeTruthy();
  }

  testSketchActivationEmitsCorrelatedOpenEffect();
  testSketchActivationAcceptsAllPrimaryConstructionPlanes();
  testSketchActivationReusesCompatiblePreselectionAndClearsInvalidSelection();
  testSketchActivationAcceptsPlanarFaces();
  testSectionViewActivationCollectsPlanarSeeds();
  testSectionViewRejectsUnsupportedOrCameraLessSeeds();
  testSectionViewFlipAndClearPreservePlanePosition();
  await testMeasureActivationPairsSelectionsAndCleansUp();
  testSketchSessionPreservesStoredPlaneDefinition();
  testFeaturePreviewIgnoresStaleResponseIds();
  testRevolveActivationStartsFeaturePreviewFlow();
  testRevolveActivationSupportsFaceThenEdgeSelection();
  testShellActivationSeedsBodyFromSelectedFace();
  testThickenActivationSeedsFaceTargetsFromSelection();
  testSplitAndDeleteSolidActivationStartFeatureSessions();
  testFeatureActivationReusesCompatibleSelectionAndClearsInvalidSelection();
  testMirrorAndTransformActivationStartFeatureSessions();
  testActiveReferencePickerRoutesSingleAndMultiSelections();
  testReferencePickerCancellationAndSessionCleanup();
  await testImportSessionAutoArmsSinglePlanePicker();
  await testImportPlaneSelectionCompletesSinglePlanePicker();
  async function testSketchImageImportUsesEditorRuntime() {
    const snapshot = (
      await new MockKernelAdapter().getDocumentSnapshot({
        contractVersion: "modeling-contract/v1alpha1",
        documentId: "doc_workspace",
      })
    ).snapshot;
    const session = createNewSketchSession(createStandardPlaneDefinition("xy"));
    const sketchState: SketchEditorState = {
      ...initialEditorState,
      kind: "editingSketch",
      mode: "sketch",
      document: {
        documentId: snapshot.document.documentId,
        revisionId: snapshot.document.revisionId,
      },
      snapshot,
      selection: [session.planeTarget],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode("sketch"),
      selectionCatalog: buildSelectionTargetCatalog(snapshot),
      preview: {
        kind: "sketch",
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: "command_sketch-import-1",
        toolId: "sketch",
        phase: "editing",
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    };

    const reopenedSession = {
      ...session,
      sketchId: "sketch_imported" as SketchId,
      sketchLabel: "Imported Sketch",
    };
    const runtime: EditorEffectRuntime = {
      async getCurrentDocumentSnapshot() {
        return snapshot;
      },
      async commitSketch() {
        return null;
      },
      async projectSketchReferences() {
        return { projectedReferences: [], diagnostics: [] };
      },
      async importSketchReferenceImages() {
        return {
          status: "committed" as const,
          revisionId: snapshot.document.revisionId,
          snapshot,
          selectionCatalog: buildSelectionTargetCatalog(snapshot),
          session: reopenedSession,
          importedCount: 1,
        };
      },
      async evaluatePreview() {
        throw new Error("Feature preview is not used by this test.");
      },
      async commitFeature() {
        throw new Error("Feature commit is not used by this test.");
      },
    };

    const importing = transitionEditorState(sketchState, {
      type: "tool.activated",
      toolId: "importImage",
    });

    expect(
      importing.effects.length === 0 &&
        importing.state.preview?.label === "Select reference images",
      "Import Image should wait for direct user-gesture file selection before emitting the sketch import effect.",
    ).toBeTruthy();
    expect(
      importing.state.kind,
      "Import Image should preserve sketch editing state while awaiting file selection.",
    ).toBe("editingSketch");

    const selected = transitionEditorState(importing.state, {
      type: "sketch.referenceImagePayloadsPicked",
      payloads: [
        {
          mediaType: "image/png",
          fileName: "reference.png",
          pixelWidth: 640,
          pixelHeight: 480,
          base64Data: "cG5n",
        },
      ],
    });

    expect(
      selected.effects[0]?.type,
      "Selected reference-image payloads should emit a sketch-owned import effect.",
    ).toBe("sketch.importReferenceImages");

    const completedEvent = await runEditorEffect(selected.effects[0]!, runtime);
    const completed = transitionEditorState(selected.state, completedEvent);

    expect(
      completed.state.kind,
      "Successful import should keep the reopened sketch session active.",
    ).toBe("editingSketch");
    expect(
      completed.state.selection[0]?.kind,
      "Successful import should select the reopened sketch target.",
    ).toBe("sketch");
    expect(
      completed.state.selection[0]?.kind === "sketch" &&
        completed.state.selection[0].sketchId === "sketch_imported",
      "Successful import should reopen the imported sketch through the editor runtime rather than the workbench shell.",
    ).toBeTruthy();
    expect(
      completed.state.pendingImportRequestId,
      "Import completion should clear the pending import request.",
    ).toBe(null);
  }

  function testSketchImageImportCanStartFromSketchSelectionCommand() {
    const commandState = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: "doc_workspace" as const,
          revisionId: "rev_1" as const,
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: "tool.activated",
        toolId: "sketch",
      },
    );

    expect(
      commandState.state.kind,
      "Sketch activation should arm the sketch selection command.",
    ).toBe("selectionCommand");

    const selected = transitionEditorState(commandState.state, {
      type: "viewport.selectionRequested",
      target: { kind: "construction", constructionId: "construction_plane-xy" },
    });

    expect(
      selected.state.kind,
      "Selecting the sketch plane should keep the sketch command active until the draft opens.",
    ).toBe("selectionCommand");

    const importing = transitionEditorState(selected.state, {
      type: "tool.activated",
      toolId: "importImage",
    });

    expect(
      importing.state.kind === "selectionCommand" &&
        importing.state.preview?.label === "Select reference images",
      "Import Image should arm file selection from the sketch-entry command state.",
    ).toBeTruthy();

    const payloadSelected = transitionEditorState(importing.state, {
      type: "sketch.referenceImagePayloadsPicked",
      payloads: [
        {
          mediaType: "image/png",
          fileName: "reference.png",
          pixelWidth: 640,
          pixelHeight: 480,
          base64Data: "cG5n",
        },
      ],
    });

    expect(
      payloadSelected.state.kind,
      "Picking reference-image payloads should open a draft sketch session.",
    ).toBe("editingSketch");
    expect(
      payloadSelected.effects[0]?.type,
      "Picking reference-image payloads from sketch entry should emit the sketch import effect.",
    ).toBe("sketch.importReferenceImages");
  }

  function testSketchImagePayloadSelectionAcceptsImportImageOwnedSelectionCommand() {
    const importingState = {
      ...initialEditorState,
      kind: "selectionCommand" as const,
      mode: "part" as const,
      document: {
        documentId: "doc_workspace" as const,
        revisionId: "rev_1" as const,
      },
      snapshot: createSnapshot(),
      selection: [
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        } as PrimitiveRef,
      ],
      selectionCatalog: createSelectionCatalog(),
      preview: {
        kind: "sketch" as const,
        label: "Select reference images",
        target: {
          kind: "construction",
          constructionId: "construction_plane-xy",
        } as PrimitiveRef,
      },
      command: {
        commandSessionId: "command_import-image-1",
        toolId: "importImage" as const,
        phase: "collecting" as const,
      },
      pendingRequestId: null,
    };

    const payloadSelected = transitionEditorState(importingState, {
      type: "sketch.referenceImagePayloadsPicked",
      payloads: [
        {
          mediaType: "image/png",
          fileName: "reference.png",
          pixelWidth: 640,
          pixelHeight: 480,
          base64Data: "cG5n",
        },
      ],
    });

    expect(
      payloadSelected.state.kind,
      "Import-image-owned sketch selection commands should open a draft sketch session when payloads are picked.",
    ).toBe("editingSketch");
    expect(
      payloadSelected.effects[0]?.type,
      "Import-image-owned sketch selection commands should emit the sketch import effect.",
    ).toBe("sketch.importReferenceImages");
  }

  testSelectionClearEventClearsSelectionAndPreservesActiveState();
  testSketchToolClearStaysInSketchEditing();
  testRemainingSketchToolsActivateWithoutDroppingSketchSession();
  testSketchEditToolActivationReusesCompatibleSelectionAndClearsInvalidSelection();
  testPassiveSketchStyleToolsDoNotDropSketchSession();
  testConstraintAuthoringReceivesViewportHoverAndSelection();
  testDimensionSelectionClickPinsReadyValuePreview();
  testDimensionReleaseOverSecondLineDefersToAngleSelection();
  testConstraintAuthoringIgnoresInvalidViewportSelection();
  testConnectedSketchSelectionEventUpdatesNormalSelectionState();
  testConnectedSketchSelectionEventWorksAfterRectangleToolAcceptsShape();
  testConnectedSketchSelectionEventRejectsUnsupportedTargets();
  testCommittedAnnotationSelectionAndDeletionRoutesThroughSketchMutation();
  testSketchHistoryDeleteStaysDistinctFromLiveSelectionDelete();
  testCommittedDimensionAnnotationEditRequestOpensAndCommitsValueForm();
  testSketchStylePatchRoutesThroughSelectionAndUpdatesCommitRequest();
  testRejectedSketchCommitShowsValidationMessage();
  testSketchCommitConflictRefreshesBeforeRetry();
  await testModelingServiceRuntimePreservesResultRejections();
  testReplayIsDeterministic();
  testDirectSnapshotLoadUpdatesDocumentWithoutFetch();
  testSelectionKeyUsesDurableRefs();
  await testRuntimeLoopProcessesSketchOpen();
  await testRuntimeLoopOpensSketchFromPlanarFace();
  await testRuntimeLoopOpensSketchFromNonXYConstruction();
  await testRuntimeLoopReopensStoredSketchPlane();
  await testRuntimeLoopReopensCommittedFeatureFromExplicitIntent();
  await testRuntimeLoopReopensSketchFromExplicitIntent();
  await testSketchImageImportUsesEditorRuntime();
  testSketchImageImportCanStartFromSketchSelectionCommand();
  testSketchImagePayloadSelectionAcceptsImportImageOwnedSelectionCommand();
  await testFeatureEditEntryRollsBackBeforeHydrationFromTail();
  await testSketchEditEntryRollsBackBeforeOpenFromTail();
  await testTailSketchReopenSkipsRollbackAndOpensImmediately();
  await testFeatureEditCancelRestoresTailCursor();
  await testFeatureEditCommitRestoresNonTailCursor();
  await testSketchAbortRestoresTailCursor();
  await testFinishSketchAtCurrentSketchCursorSkipsRestore();
  await testRepositoryBackedFeatureEditCommitRefreshesBeforeRestore();
  await testDocumentCursorRequestUsesSnapshotBasisAndRefreshesOnConflict();
  testSnapshotRefreshCanPreserveRenderRecordsForFeatureDiagnostics();
  testDocumentReplacementResetsIntoPartIdleState();
  await testEditorEventLoopBootstrapsAndLoadsSnapshot();
  await testEditorEventLoopCancelsObsoleteSketchOpenEffects();
});
