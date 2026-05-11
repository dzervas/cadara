import { test } from "bun:test";
import { expectTrue } from "@/testing/expect.spec";
import { MockKernelAdapter } from "./mock-kernel-adapter";
import {
  createModelingService,
  modelingRuntimeValidators,
} from "./modeling-service";
import { MockSketchSolverAdapter } from "@/domain/solver/mock-sketch-solver-adapter";
import {
  bindRenderableObject,
  resolvePickTarget,
} from "@/infrastructure/viewport/render-picking";
import * as THREE from "three";
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import type {
  BodyId,
  FeatureId,
  ObjectTreeNodeId,
} from "@/contracts/shared/ids";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import {
  combineAdvancedFeatureExample,
  deleteSolidAdvancedFeatureExample,
  mirrorAdvancedFeatureExample,
  splitAdvancedFeatureExample,
  transformAdvancedFeatureExample,
} from "@/contracts/modeling/advanced-solid";

test("src/domain/modeling/mock-kernel-adapter.spec.ts", async () => {
  function getPrimaryRegionTarget(snapshot: WorkspaceSnapshot) {
    const sketch = snapshot.document.sketches.find(
      (entry) => entry.sketchId === "sketch_primary",
    );
    const region = sketch?.sketch.regions[0];
    expectTrue(
      sketch && region,
      "Mock fixture should expose a primary sketch region.",
    );
    return {
      kind: "region" as const,
      sketchId: sketch.sketchId,
      regionId: region.regionId,
    };
  }

  async function addMockToolBody(adapter: MockKernelAdapter, bodyId: BodyId) {
    const snapshot = await (
      adapter as unknown as { getSnapshot(): Promise<WorkspaceSnapshot> }
    ).getSnapshot();
    const sourceBody = snapshot.document.bodies.find(
      (body) => body.bodyId === "body_part-1",
    );
    const sourceObject = snapshot.presentation.objects.find(
      (item) =>
        item.target.kind === "body" && item.target.bodyId === "body_part-1",
    );

    expectTrue(
      sourceBody,
      "Mock fixture should expose a source body to clone for multi-body tests.",
    );
    expectTrue(
      sourceObject,
      "Mock fixture should expose a source body object row to clone for multi-body tests.",
    );

    snapshot.document.bodies = [
      ...snapshot.document.bodies,
      {
        ...structuredClone(sourceBody),
        bodyId,
        label: "Mock tool body",
        ownerFeatureId: "feature_mock_tool" as FeatureId,
      },
    ];
    snapshot.presentation.objects = [
      ...snapshot.presentation.objects,
      {
        ...structuredClone(sourceObject),
        id: `object_tree_node_${bodyId}` as ObjectTreeNodeId,
        label: "Mock tool body",
        target: { kind: "body", bodyId },
        ownerBodyId: bodyId,
        ownerFeatureId: "feature_mock_tool" as FeatureId,
      },
    ];
    snapshot.document.objects = snapshot.presentation.objects;
  }

  async function testSourceBackedSketchReferenceProjection() {
    const adapter = new MockKernelAdapter();
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const sketch = snapshot.snapshot.document.sketches.find(
      (entry) => entry.sketchId === "sketch_primary",
    );
    expectTrue(
      sketch,
      "Seed sketch must be available for source-backed projection tests.",
    );

    const projection = await adapter.projectSketchExternalReferences({
      contractVersion: "modeling-contract/v1alpha1",
      solverSchemaVersion: "sketch-solver/v1alpha1",
      requestId: "request_source_projection",
      documentId: "doc_workspace",
      revisionId: snapshot.snapshot.document.revisionId,
      sketchId: sketch.sketchId,
      plane: sketch.plane.frame,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      references: [
        {
          referenceId: "ref_project_vertex" as const,
          reference: {
            referenceId: "ref_project_vertex" as const,
            kind: "modelReference",
            label: "Projected vertex",
            source: {
              kind: "vertex",
              bodyId: "body_part-1",
              vertexId: "vertex_front-right",
            },
            projectionMode: "projectAlongPlaneNormal",
          },
        },
        {
          referenceId: "ref_project_edge" as const,
          reference: {
            referenceId: "ref_project_edge" as const,
            kind: "modelReference",
            label: "Projected edge",
            source: {
              kind: "edge",
              bodyId: "body_part-1",
              edgeId: "edge_outer-0",
            },
            projectionMode: "projectAlongPlaneNormal",
          },
        },
        {
          referenceId: "ref_project_face" as const,
          reference: {
            referenceId: "ref_project_face" as const,
            kind: "modelReference",
            label: "Projected face",
            source: { kind: "face", bodyId: "body_part-1", faceId: "face_top" },
            projectionMode: "projectAlongPlaneNormal",
          },
        },
        {
          referenceId: "ref_project_sketch_point" as const,
          reference: {
            referenceId: "ref_project_sketch_point" as const,
            kind: "sketchReference",
            label: "Projected sketch point",
            source: {
              kind: "sketchPoint",
              sketchId: "sketch_primary",
              pointId: "sketch_point_1_rect-bottom-left",
            },
            projectionMode: "useExistingCoplanarGeometry",
          },
        },
        {
          referenceId: "ref_project_sketch_entity" as const,
          reference: {
            referenceId: "ref_project_sketch_entity" as const,
            kind: "sketchReference",
            label: "Projected sketch entity",
            source: {
              kind: "sketchEntity",
              sketchId: "sketch_primary",
              entityId: "sketch_entity_1_rect-bottom",
            },
            projectionMode: "useExistingCoplanarGeometry",
          },
        },
      ],
    });

    const byId = new Map(
      projection.projectedReferences.map((reference) => [
        reference.referenceId,
        reference,
      ]),
    );
    expectTrue(
      byId.get("ref_project_vertex")?.geometry[0]?.kind === "point",
      "Model vertices should project to points.",
    );
    expectTrue(
      byId.get("ref_project_edge")?.geometry[0]?.kind === "lineSegment",
      "Model edges should project to line segments.",
    );
    expectTrue(
      (byId.get("ref_project_face")?.geometry.length ?? 0) >= 3 &&
        byId
          .get("ref_project_face")
          ?.geometry.every((geometry) => geometry.kind === "lineSegment"),
      "Planar faces should project to representable boundary line segments.",
    );
    expectTrue(
      byId.get("ref_project_sketch_point")?.geometry[0]?.kind === "point",
      "Existing sketch points should project to points.",
    );
    expectTrue(
      byId.get("ref_project_sketch_entity")?.geometry[0]?.kind ===
        "lineSegment",
      "Existing sketch entities should project to supported geometry.",
    );
    expectTrue(
      projection.projectedReferences.every(
        (reference) => reference.status === "projected",
      ),
      "Supported source-backed references should all project successfully.",
    );
  }

  async function testExtrudePreviewDependsOnDefinition() {
    const adapter = new MockKernelAdapter();
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const existingExtrude = snapshot.snapshot.document.features.find(
      (feature) =>
        feature.featureId === "feature_extrude-1" &&
        feature.definition.kind === "extrude",
    );

    if (!existingExtrude || existingExtrude.definition.kind !== "extrude") {
      throw new Error(
        "Mock snapshot must expose the seeded extrude feature definition.",
      );
    }

    const valid = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: "rev_0001",
      previewId: "preview_extrude_valid",
      definition: {
        kind: "extrude",
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: existingExtrude.definition.parameters.profiles,
          startExtent: { kind: "profilePlane" },
          extent: {
            mode: "oneSide",
            end: { kind: "blind", direction: "positive", distance: 12 },
          },
          operation: "newBody",
          booleanScope: { kind: "standalone" },
        },
      },
    });

    expectTrue(
      valid.render.records.length > 0,
      "Valid extrude previews should return preview renderables.",
    );
    expectTrue(
      valid.diagnostics.length === 0,
      "Valid extrude previews should not emit diagnostics.",
    );
    expectTrue(
      valid.render.records.every((renderable) => {
        if (renderable.binding.topology === null) {
          return (
            renderable.binding.target.kind === "construction" ||
            renderable.binding.target.kind === "sketchEntity" ||
            renderable.binding.target.kind === "sketchPoint"
          );
        }

        return renderable.binding.target.kind === renderable.binding.topology;
      }),
      "Preview renderables must bind selection through durable refs rather than geometry shortcuts.",
    );
    expectTrue(
      valid.render.records.some(
        (renderable) =>
          renderable.binding.semanticClass === "planarFace" &&
          renderable.geometry.kind === "mesh",
      ),
      "Preview renderables must expose face semantics independently from the mesh geometry payload.",
    );

    const invalid = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: "rev_0001",
      previewId: "preview_extrude_invalid",
      definition: {
        kind: "extrude",
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: existingExtrude.definition.parameters.profiles,
          startExtent: { kind: "profilePlane" },
          extent: {
            mode: "oneSide",
            end: { kind: "blind", direction: "positive", distance: 0 },
          },
          operation: "newBody",
          booleanScope: { kind: "standalone" },
        },
      },
    });

    expectTrue(
      invalid.render.records.length === 0,
      "Invalid extrude previews must not return authoritative preview geometry.",
    );
    expectTrue(
      invalid.diagnostics.some(
        (diagnostic) => diagnostic.code === "mock-invalid-extrude",
      ),
      "Invalid extrude previews must emit structured diagnostics.",
    );
  }

  async function testProfileCollectionContractBoundaryRejectsInvalidPayloads() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const existingExtrude = snapshot.document.features.find(
      (feature) =>
        feature.featureId === "feature_extrude-1" &&
        feature.definition.kind === "extrude",
    );

    if (!existingExtrude || existingExtrude.definition.kind !== "extrude") {
      throw new Error(
        "Mock snapshot must expose the seeded extrude feature definition.",
      );
    }

    const profile = existingExtrude.definition.parameters.profiles[0];
    const invalidCases = [
      {
        parameters: {
          ...existingExtrude.definition.parameters,
          profiles: undefined,
          profile,
        },
        message:
          "Legacy singular profile payloads should be rejected before preview.",
      },
      {
        parameters: {
          ...existingExtrude.definition.parameters,
          profiles: [],
        },
        message: "Empty profile arrays should be rejected before preview.",
      },
      {
        parameters: {
          ...existingExtrude.definition.parameters,
          profiles: [{ kind: "sketch", sketchId: "sketch_primary" }],
        },
        message:
          "Whole-sketch profile seeds should be rejected before preview.",
      },
      {
        parameters: {
          ...existingExtrude.definition.parameters,
          profiles: [profile, profile],
        },
        message:
          "Duplicate profile references should be rejected before preview.",
      },
    ] as const;

    for (const testCase of invalidCases) {
      let rejected = false;
      try {
        await service.evaluatePreview({
          baseRevisionId: snapshot.document.revisionId,
          previewId: "preview_invalid_profiles",
          definition: {
            kind: "extrude",
            featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
            parameters: testCase.parameters,
          } as never,
        });
      } catch {
        rejected = true;
      }
      expectTrue(rejected, testCase.message);
    }
  }

  async function testUnsupportedFeatureDefinitionsAreRejectedByMock() {
    const adapter = new MockKernelAdapter();

    const plane = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: "rev_0001",
      definition: {
        kind: "plane",
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: "coplanar",
          reference: {
            target: {
              kind: "construction",
              constructionId: "construction_plane-xy",
            },
          },
        },
      },
    });

    expectTrue(
      plane.diagnostics.some(
        (diagnostic) => diagnostic.code === "mock-unsupported-plane",
      ),
      "Unsupported plane features must report explicit mock diagnostics.",
    );
    expectTrue(
      plane.changedTargets.length === 0,
      "Unsupported plane features must not report changed targets.",
    );
    expectTrue(
      plane.rebuildResult.kind === "skipped" &&
        plane.rebuildResult.reasonCode === "validationRejected",
      "Rejected feature requests must report an explicit skipped rebuild result.",
    );
  }

  async function testMutationResponsesReportRebuildResults() {
    const adapter = new MockKernelAdapter();
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const initialRevisionId = snapshot.snapshot.document.revisionId;
    const extrude = snapshot.snapshot.document.features.find(
      (feature) =>
        feature.featureId === "feature_extrude-1" &&
        feature.definition.kind === "extrude",
    );

    if (!extrude || extrude.definition.kind !== "extrude") {
      throw new Error(
        "Mock snapshot must expose the seeded extrude feature definition.",
      );
    }

    const accepted = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: "rev_0001",
      definition: {
        kind: "extrude",
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          ...extrude.definition.parameters,
          startExtent: { kind: "profilePlane" },
          extent: {
            mode: "oneSide",
            end: { kind: "blind", direction: "positive", distance: 8 },
          },
        },
      },
    });

    expectTrue(
      accepted.rebuildResult.kind === "rebuilt",
      "Accepted feature creates must report a rebuilt result.",
    );
    expectTrue(
      accepted.rebuildResult.revisionId === accepted.revisionId &&
        accepted.revisionId !== initialRevisionId,
      "Accepted feature creates must report the new rebuild revision ID.",
    );

    const conflict = await adapter.deleteFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: "rev_stale",
      featureId: "feature_extrude-1",
    });

    expectTrue(
      conflict.rebuildResult.kind === "skipped" &&
        conflict.rebuildResult.reasonCode === "revisionConflict",
      "Revision conflicts must report a skipped rebuild result.",
    );
  }

  async function testAcceptedCreateMutatesCommittedSnapshot() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const beforeRevisionId = before.snapshot.document.revisionId;
    const seedExtrude = before.snapshot.document.features.find(
      (feature) =>
        feature.featureId === "feature_extrude-1" &&
        feature.definition.kind === "extrude",
    );

    if (!seedExtrude || seedExtrude.definition.kind !== "extrude") {
      throw new Error(
        "Seed extrude feature must exist for create-mutation coverage.",
      );
    }

    const created = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: {
        kind: "extrude",
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          ...seedExtrude.definition.parameters,
          startExtent: { kind: "profilePlane" },
          extent: {
            mode: "oneSide",
            end: { kind: "blind", direction: "positive", distance: 16 },
          },
        },
      },
    });

    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    expectTrue(
      created.revisionState.kind === "accepted",
      "Accepted creates must report accepted revision state.",
    );
    expectTrue(
      created.revisionId === after.snapshot.document.revisionId,
      "Accepted creates must advance the committed snapshot revision.",
    );
    expectTrue(
      after.snapshot.document.revisionId !== beforeRevisionId,
      "Accepted creates must change the committed revision basis.",
    );
    expectTrue(
      after.snapshot.document.features.some(
        (feature) => feature.featureId === created.featureId,
      ),
      "Accepted creates must appear in subsequent committed snapshots.",
    );
  }

  async function testRollbackCursorPreservesAndInsertsFeatureAfterCursor() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    const rollback = await adapter.setFeatureCursor({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      cursor: { kind: "feature", featureId: "feature_extrude-1" },
    });

    expectTrue(
      rollback.revisionState.kind === "accepted",
      "Rollback cursor changes must be accepted for valid features.",
    );
    expectTrue(
      rollback.cursor.kind === "feature" &&
        rollback.cursor.featureId === "feature_extrude-1",
      "Rollback must target the requested feature.",
    );
    const seedExtrude = before.snapshot.document.features.find(
      (feature) =>
        feature.featureId === "feature_extrude-1" &&
        feature.definition.kind === "extrude",
    );

    if (!seedExtrude || seedExtrude.definition.kind !== "extrude") {
      throw new Error(
        "Seed extrude feature must exist for rollback insertion coverage.",
      );
    }

    const created = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: rollback.revisionId,
      definition: {
        kind: "extrude",
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          ...seedExtrude.definition.parameters,
          startExtent: { kind: "profilePlane" },
          extent: {
            mode: "oneSide",
            end: { kind: "blind", direction: "positive", distance: 18 },
          },
        },
      },
    });

    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const featureOrder = after.snapshot.document.features.map(
      (feature) => feature.featureId,
    );

    expectTrue(
      created.revisionState.kind === "accepted",
      "Feature creation after rollback must be accepted.",
    );
    expectTrue(
      featureOrder.join(">") ===
        `feature_extrude-1>${created.featureId}>feature_fillet-1`,
      "Feature creation after rollback must insert immediately after the cursor and preserve later features.",
    );
    expectTrue(
      after.snapshot.document.cursor.kind === "feature" &&
        after.snapshot.document.cursor.featureId === created.featureId,
      "Feature creation after rollback must advance the cursor to the new feature.",
    );
  }

  async function testRollbackCursorHidesFutureSketchPresentation() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const rollback = await adapter.setFeatureCursor({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      cursor: { kind: "empty" },
    });
    expectTrue(
      rollback.revisionState.kind === "accepted",
      "Mock cursor rollback before the first item should be accepted.",
    );

    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    expectTrue(
      after.snapshot.document.sketches.some(
        (sketch) => sketch.sketchId === "sketch_primary",
      ),
      "Cursor rollback should retain future sketches in durable document state.",
    );
    expectTrue(
      !after.snapshot.document.render.records.some(
        (record) =>
          record.binding.target.kind === "sketch" ||
          ("sketchId" in record.binding.target &&
            record.binding.target.sketchId === "sketch_primary"),
      ),
      "Cursor rollback should hide future sketch renderables.",
    );
    expectTrue(
      !after.snapshot.presentation.entities.some(
        (entity) => entity.ownerSketchId === "sketch_primary",
      ),
      "Cursor rollback should hide future sketch selection entities.",
    );
    expectTrue(
      !after.snapshot.presentation.objects.some(
        (object) => object.ownerSketchId === "sketch_primary",
      ),
      "Cursor rollback should hide future sketch object rows.",
    );
  }

  async function testAcceptedSketchCommitMutatesCommittedSnapshot() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const beforeRevisionId = before.snapshot.document.revisionId;
    const sourceSketch = before.snapshot.document.sketches[0];

    if (!sourceSketch) {
      throw new Error("Seed sketch must exist for sketch commit coverage.");
    }

    const committed = await adapter.commitSketch({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      solverCorrelation: {
        requestId: "request_commit_1",
        projectionRequestId: "request_commit_1:project",
        validationRequestId: "request_commit_1:validate",
        solveRequestId: "request_commit_1:solve",
        regionRequestId: "request_commit_1:regions",
      },
      sketchId: "sketch_phase8",
      sketchLabel: "Phase 8 Sketch",
      plane: sourceSketch.plane,
      definition: sourceSketch.sketch.definition,
    });

    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    expectTrue(
      committed.revisionState.kind === "accepted",
      "Accepted sketch commits must report accepted revision state.",
    );
    expectTrue(
      after.snapshot.document.revisionId === committed.revisionId,
      "Committed sketch revisions must match the observed snapshot revision.",
    );
    expectTrue(
      after.snapshot.document.revisionId !== beforeRevisionId,
      "Accepted sketch commits must change the committed revision basis.",
    );
    expectTrue(
      after.snapshot.document.sketches.some(
        (sketch) => sketch.sketchId === committed.sketchId,
      ),
      "Accepted sketch commits must appear in subsequent committed snapshots.",
    );

    const reopenedSketch = after.snapshot.document.sketches.find(
      (sketch) => sketch.sketchId === committed.sketchId,
    );
    expectTrue(
      reopenedSketch,
      "Committed sketch snapshots must remain available for reopen flows.",
    );
    expectTrue(
      reopenedSketch.plane.support.kind === sourceSketch.plane.support.kind &&
        reopenedSketch.plane.key === sourceSketch.plane.key,
      "Committed sketch snapshots must preserve their stored plane identity for later reopen.",
    );
    expectTrue(
      reopenedSketch.plane.frame.normal.every(
        (component, index) =>
          component === sourceSketch.plane.frame.normal[index],
      ),
      "Committed sketch snapshots must preserve the authored plane orientation.",
    );
  }

  async function testAcceptedSketchCommitNormalizesAuthoringOperationTargets() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const sourceSketch = before.snapshot.document.sketches[0];

    if (!sourceSketch) {
      throw new Error(
        "Seed sketch must exist for authoring operation commit coverage.",
      );
    }

    const committed = await adapter.commitSketch({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      solverCorrelation: {
        requestId: "request_commit_authoring_operations",
        projectionRequestId: "request_commit_authoring_operations:project",
        validationRequestId: "request_commit_authoring_operations:validate",
        solveRequestId: "request_commit_authoring_operations:solve",
        regionRequestId: "request_commit_authoring_operations:regions",
      },
      sketchId: null,
      sketchLabel: "Authoring Operation Sketch",
      plane: sourceSketch.plane,
      definition: {
        schemaVersion: "sketch-definition/v1alpha1",
        referenceIds: [],
        references: [],
        pointIds: ["sketch_point_1_a", "sketch_point_1_b"],
        points: [
          {
            pointId: "sketch_point_1_a",
            label: "A",
            target: {
              kind: "sketchPoint",
              sketchId: "sketch_draft",
              pointId: "sketch_point_1_a",
            },
            position: [0, 0],
            isConstruction: false,
          },
          {
            pointId: "sketch_point_1_b",
            label: "B",
            target: {
              kind: "sketchPoint",
              sketchId: "sketch_draft",
              pointId: "sketch_point_1_b",
            },
            position: [1, 0],
            isConstruction: false,
          },
        ],
        entityIds: ["sketch_entity_1_line"],
        entities: [
          {
            kind: "lineSegment",
            entityId: "sketch_entity_1_line",
            label: "Line 1",
            target: {
              kind: "sketchEntity",
              sketchId: "sketch_draft",
              entityId: "sketch_entity_1_line",
            },
            isConstruction: false,
            startPointId: "sketch_point_1_a",
            endPointId: "sketch_point_1_b",
          },
        ],
        constraintIds: [],
        constraints: [],
        dimensionIds: [],
        dimensions: [],
        authoringOperations: [
          {
            operationId: "sketch_operation_1_line",
            label: "Line 1",
            kind: "line",
            targets: {
              created: [
                { kind: "point", pointId: "sketch_point_1_a" },
                { kind: "point", pointId: "sketch_point_1_b" },
                { kind: "entity", entityId: "sketch_entity_1_line" },
              ],
            },
            createdGraph: {
              points: [
                {
                  pointId: "sketch_point_1_a",
                  label: "A",
                  target: {
                    kind: "sketchPoint",
                    sketchId: "sketch_draft",
                    pointId: "sketch_point_1_a",
                  },
                  position: [0, 0],
                  isConstruction: false,
                },
                {
                  pointId: "sketch_point_1_b",
                  label: "B",
                  target: {
                    kind: "sketchPoint",
                    sketchId: "sketch_draft",
                    pointId: "sketch_point_1_b",
                  },
                  position: [1, 0],
                  isConstruction: false,
                },
              ],
              entities: [
                {
                  kind: "lineSegment",
                  entityId: "sketch_entity_1_line",
                  label: "Line 1",
                  target: {
                    kind: "sketchEntity",
                    sketchId: "sketch_draft",
                    entityId: "sketch_entity_1_line",
                  },
                  isConstruction: false,
                  startPointId: "sketch_point_1_a",
                  endPointId: "sketch_point_1_b",
                },
              ],
            },
          },
        ],
      },
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const reopenedSketch = after.snapshot.document.sketches.find(
      (sketch) => sketch.sketchId === committed.sketchId,
    );

    expectTrue(
      committed.revisionState.kind === "accepted",
      "Sketch with authoring operation metadata should commit.",
    );
    expectTrue(
      reopenedSketch,
      "Committed sketch should be available for reopen.",
    );
    expectTrue(
      reopenedSketch.sketch.definition.points.every(
        (point) => point.target.sketchId === committed.sketchId,
      ),
      "Committed mock sketch points should be normalized to the committed sketch id.",
    );
    expectTrue(
      reopenedSketch.sketch.definition.authoringOperations?.[0]?.createdGraph?.points?.every(
        (point) => point.target.sketchId === committed.sketchId,
      ),
      "Committed mock sketch operation point snapshots should be normalized to the committed sketch id.",
    );
    expectTrue(
      reopenedSketch.sketch.definition.authoringOperations?.[0]?.createdGraph?.entities?.every(
        (entity) => entity.target.sketchId === committed.sketchId,
      ),
      "Committed mock sketch operation entity snapshots should be normalized to the committed sketch id.",
    );
  }

  async function testAcceptedSketchCommitPersistsActiveProjectionData() {
    class ProjectingSolverAdapter extends MockSketchSolverAdapter {
      override async projectExternalReferences(
        request: Parameters<
          MockSketchSolverAdapter["projectExternalReferences"]
        >[0],
      ) {
        const response = await super.projectExternalReferences(request);
        return {
          ...response,
          projectedReferences: request.references.map((reference) => ({
            referenceId: reference.referenceId,
            status: "projected" as const,
            geometry: [
              {
                geometryId:
                  `projected_geometry_${reference.referenceId}` as const,
                kind: "point" as const,
                position: [1, 1] as const,
              },
            ],
            diagnostics: [],
          })),
        };
      }
    }

    const adapter = new MockKernelAdapter({
      solverAdapter: new ProjectingSolverAdapter(),
    });
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const sourceSketch = before.snapshot.document.sketches[0];

    if (!sourceSketch) {
      throw new Error(
        "Seed sketch must exist for projected sketch commit coverage.",
      );
    }

    const referenceId = "ref_mock_projection" as const;
    const definition = {
      ...sourceSketch.sketch.definition,
      referenceIds: [
        ...sourceSketch.sketch.definition.referenceIds,
        referenceId,
      ],
      references: [
        ...sourceSketch.sketch.definition.references,
        {
          referenceId,
          kind: "modelReference" as const,
          label: "Mock projected vertex",
          source: {
            kind: "vertex" as const,
            bodyId: "body_part-1",
            vertexId: "vertex_front-right",
          },
          projectionMode: "projectAlongPlaneNormal" as const,
        },
      ],
    };

    const committed = await adapter.commitSketch({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      solverCorrelation: {
        requestId: "request_commit_projection",
        projectionRequestId: "request_commit_projection:project",
        validationRequestId: "request_commit_projection:validate",
        solveRequestId: "request_commit_projection:solve",
        regionRequestId: "request_commit_projection:regions",
      },
      sketchId: "sketch_projected_snapshot",
      sketchLabel: "Projected Snapshot Sketch",
      plane: sourceSketch.plane,
      definition,
    });

    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const reopenedSketch = after.snapshot.document.sketches.find(
      (sketch) => sketch.sketchId === committed.sketchId,
    );

    expectTrue(
      committed.revisionState.kind === "accepted",
      "Projected sketch commits should be accepted.",
    );
    const persistedProjection =
      reopenedSketch?.sketch.projectedReferences?.find(
        (reference) => reference.referenceId === referenceId,
      );
    expectTrue(
      persistedProjection,
      "Mock committed sketch snapshots must preserve active projection data.",
    );
    expectTrue(
      persistedProjection.referenceId === referenceId,
      "Persisted projection data must retain the authored reference identity.",
    );
    expectTrue(
      reopenedSketch.sketch.definition.points.every(
        (point) => point.pointId !== "projected_geometry_ref_mock_projection",
      ),
      "Persisted projection data must not be copied into sketch-owned points.",
    );
  }

  async function testMissingMutationTargetsAreRejected() {
    const adapter = new MockKernelAdapter();
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    const missingUpdate = await adapter.updateFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: snapshot.snapshot.document.revisionId,
      featureId: "feature_missing",
      definition: {
        kind: "plane",
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: "coplanar",
          reference: {
            target: {
              kind: "construction",
              constructionId: "construction_plane-xy",
            },
          },
        },
      },
    });

    const missingDelete = await adapter.deleteFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: snapshot.snapshot.document.revisionId,
      featureId: "feature_missing",
    });

    const missingReorder = await adapter.reorderFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: snapshot.snapshot.document.revisionId,
      featureId: "feature_extrude-1",
      beforeFeatureId: "feature_missing",
    });

    expectTrue(
      missingUpdate.revisionState.kind === "rejected",
      "Updates targeting missing features must be rejected.",
    );
    expectTrue(
      missingDelete.revisionState.kind === "rejected",
      "Deletes targeting missing features must be rejected.",
    );
    expectTrue(
      missingReorder.revisionState.kind === "rejected",
      "Reorders targeting missing anchors must be rejected.",
    );
  }

  async function testGenericDeleteTargetsAcceptRejectAndConflict() {
    const featureAdapter = new MockKernelAdapter();
    const initialFeature = await featureAdapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const deletedFeature = await featureAdapter.deleteTarget({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: initialFeature.snapshot.document.revisionId,
      target: { kind: "feature", featureId: "feature_extrude-1" },
    });
    expectTrue(
      deletedFeature.revisionState.kind === "accepted",
      "Generic feature deletion should be accepted.",
    );
    const afterFeatureDelete = await featureAdapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    expectTrue(
      afterFeatureDelete.snapshot.document.features.every(
        (feature) => feature.featureId !== "feature_extrude-1",
      ),
      "Generic feature deletion should remove the feature from authored history.",
    );
    expectTrue(
      afterFeatureDelete.snapshot.presentation.documentHistory.every(
        (item) =>
          item.target.kind !== "feature" ||
          item.target.featureId !== "feature_extrude-1",
      ),
      "Generic feature deletion should remove the feature timeline item.",
    );

    const sketchAdapter = new MockKernelAdapter();
    const initialSketch = await sketchAdapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const deletedSketch = await sketchAdapter.deleteTarget({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: initialSketch.snapshot.document.revisionId,
      target: { kind: "sketch", sketchId: "sketch_primary" },
    });
    expectTrue(
      deletedSketch.revisionState.kind === "accepted",
      "Generic sketch deletion should be accepted.",
    );
    const afterSketchDelete = await sketchAdapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    expectTrue(
      afterSketchDelete.snapshot.document.sketches.every(
        (sketch) => sketch.sketchId !== "sketch_primary",
      ),
      "Generic sketch deletion should remove the sketch from authored history.",
    );

    const bodyAdapter = new MockKernelAdapter();
    const initialBody = await bodyAdapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const deletedBody = await bodyAdapter.deleteTarget({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: initialBody.snapshot.document.revisionId,
      target: { kind: "body", bodyId: "body_part-1" },
    });
    expectTrue(
      deletedBody.revisionState.kind === "accepted",
      "Generic body deletion should be accepted.",
    );
    const afterBodyDelete = await bodyAdapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    expectTrue(
      afterBodyDelete.snapshot.presentation.objects.every(
        (item) =>
          item.target.kind !== "body" || item.target.bodyId !== "body_part-1",
      ),
      "Generic body deletion should remove the body object row.",
    );

    const unsupported = await bodyAdapter.deleteTarget({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: afterBodyDelete.snapshot.document.revisionId,
      target: { kind: "face", bodyId: "body_part-1", faceId: "face_top" },
    });
    expectTrue(
      unsupported.revisionState.kind === "rejected",
      "Unsupported generic delete targets should be rejected.",
    );

    const conflict = await bodyAdapter.deleteTarget({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: "rev_stale",
      target: { kind: "body", bodyId: "body_part-1" },
    });
    expectTrue(
      conflict.revisionState.kind === "conflict",
      "Stale generic delete requests should conflict.",
    );
  }

  async function testDocumentHistoryReorderAcceptsRejectsAndConflicts() {
    const adapter = new MockKernelAdapter();
    const initial = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const sketch = initial.snapshot.presentation.documentHistory.find(
      (item) => item.kind === "sketch",
    );
    const feature = initial.snapshot.presentation.documentHistory.find(
      (item) => item.kind === "feature",
    );
    expectTrue(
      sketch?.kind === "sketch",
      "Mock fixture should expose a sketch history item.",
    );
    expectTrue(
      feature?.kind === "feature",
      "Mock fixture should expose a feature history item.",
    );
    const seedFeature = initial.snapshot.document.features.find(
      (entry) => entry.featureId === feature.featureId,
    );
    expectTrue(
      seedFeature?.definition.kind === "extrude",
      "Mock fixture should expose the seeded extrude definition.",
    );

    const secondFeature = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: initial.snapshot.document.revisionId,
      definition: {
        ...seedFeature.definition,
        parameters: {
          ...seedFeature.definition.parameters,
          extent: {
            mode: "oneSide",
            end: { kind: "blind", direction: "positive", distance: 14 },
          },
        },
      },
    });
    expectTrue(
      secondFeature.revisionState.kind === "accepted",
      "Mock fixture should accept a second feature for reorder coverage.",
    );

    const featureReorder = await adapter.reorderDocumentHistory({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: secondFeature.revisionId,
      item: { kind: "feature", featureId: secondFeature.featureId },
      beforeItem: { kind: "feature", featureId: feature.featureId },
    });
    expectTrue(
      featureReorder.revisionState.kind === "accepted",
      "Mock document history reorder should accept valid feature moves.",
    );

    const featureReordered = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    expectTrue(
      featureReordered.snapshot.document.features[0]?.featureId ===
        secondFeature.featureId &&
        featureReordered.snapshot.document.features[1]?.featureId ===
          feature.featureId,
      "Mock document history feature reorders should update feature execution order.",
    );
    const cursorBeforeSketchReorder = featureReordered.snapshot.document.cursor;

    const invalidSketchMove = await adapter.reorderDocumentHistory({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: featureReorder.revisionId,
      item: { kind: "sketch", sketchId: sketch.sketchId },
      beforeItem: null,
    });
    expectTrue(
      invalidSketchMove.revisionState.kind === "rejected",
      "Mock document history reorder should reject features before their sketch dependencies.",
    );
    expectTrue(
      invalidSketchMove.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "mock-document-history-dependency-order",
      ),
      "Rejected dependency-order reorders should return a visible diagnostic.",
    );

    const reordered = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    expectTrue(
      JSON.stringify(reordered.snapshot.document.cursor) ===
        JSON.stringify(cursorBeforeSketchReorder),
      "Rejected document history reorder should preserve the durable cursor target.",
    );

    const missingItem = await adapter.reorderDocumentHistory({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: featureReorder.revisionId,
      item: { kind: "sketch", sketchId: "sketch_missing" },
      beforeItem: { kind: "feature", featureId: feature.featureId },
    });
    expectTrue(
      missingItem.revisionState.kind === "rejected",
      "Missing moved document history items should be rejected.",
    );

    const missingAnchor = await adapter.reorderDocumentHistory({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: featureReorder.revisionId,
      item: { kind: "feature", featureId: feature.featureId },
      beforeItem: { kind: "sketch", sketchId: "sketch_missing" },
    });
    expectTrue(
      missingAnchor.revisionState.kind === "rejected",
      "Missing document history anchors should be rejected.",
    );

    const conflict = await adapter.reorderDocumentHistory({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: initial.snapshot.document.revisionId,
      item: { kind: "feature", featureId: feature.featureId },
      beforeItem: null,
    });
    expectTrue(
      conflict.revisionState.kind === "conflict",
      "Stale document history reorders should report conflicts.",
    );
  }

  async function testPreviewStalenessReportsObservedRevision() {
    const adapter = new MockKernelAdapter();

    const stalePreview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: "rev_stale",
      previewId: "preview_stale_1",
      definition: {
        kind: "plane",
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: "coplanar",
          reference: {
            target: {
              kind: "construction",
              constructionId: "construction_plane-xy",
            },
          },
        },
      },
    });

    expectTrue(
      stalePreview.freshness.kind === "stale",
      "Stale previews must report stale freshness explicitly.",
    );
    expectTrue(
      stalePreview.freshness.currentRevisionId === stalePreview.revisionId,
      "Stale preview freshness must report the same observed current revision as the response revision.",
    );
  }

  async function testResolveReferenceReportsMissingTargetsExplicitly() {
    const adapter = new MockKernelAdapter();

    const resolution = await adapter.resolveReference({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      target: { kind: "face", bodyId: "body_part-1", faceId: "face_missing" },
    });

    expectTrue(
      resolution.resolution.invalidation?.reason === "mock-missing-reference",
      "Missing durable references must carry explicit invalidation payloads.",
    );
    expectTrue(
      resolution.diagnostics.some(
        (diagnostic) => diagnostic.code === "mock-invalid-reference",
      ),
      "Missing durable references must emit machine-readable diagnostics.",
    );
  }

  async function testMockKernelRejectsUnsupportedContractEnvelope() {
    const adapter = new MockKernelAdapter();
    let contractRejected = false;

    try {
      await adapter.getDocumentSnapshot({
        contractVersion: "modeling-contract/v0" as never,
        documentId: "doc_workspace",
      });
    } catch (error) {
      contractRejected =
        error instanceof Error &&
        error.message.includes("Unsupported contract version");
    }

    expectTrue(
      contractRejected,
      "Mock kernel must reject unsupported contract versions.",
    );

    let documentRejected = false;

    try {
      await adapter.getDocumentSnapshot({
        contractVersion: "modeling-contract/v1alpha1",
        documentId: "doc_other" as never,
      });
    } catch (error) {
      documentRejected =
        error instanceof Error &&
        error.message.includes("Unsupported document");
    }

    expectTrue(
      documentRejected,
      "Mock kernel must reject unsupported document IDs.",
    );
  }

  async function testAdvancedPreviewReturnsStructuredUnsupportedDiagnosticsWithoutMutation() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    const preview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_split_unsupported",
      definition: splitAdvancedFeatureExample,
    });
    const create = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: splitAdvancedFeatureExample,
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    expectTrue(
      preview.render.records.length === 0,
      "Unsupported advanced previews must not return preview geometry.",
    );
    expectTrue(
      preview.diagnostics.some(
        (diagnostic) => diagnostic.detail?.kind === "advancedFeatureValidation",
      ),
      "Unsupported advanced previews must return structured advanced-feature diagnostics.",
    );
    expectTrue(
      create.revisionState.kind === "rejected",
      "Unsupported advanced create requests should be rejected.",
    );
    expectTrue(
      after.snapshot.document.revisionId ===
        before.snapshot.document.revisionId,
      "Rejected advanced create requests must not mutate the committed document revision.",
    );
    expectTrue(
      after.snapshot.document.features.length ===
        before.snapshot.document.features.length,
      "Rejected advanced create requests must not add committed features.",
    );
  }

  async function testSweepPreviewAndCommitUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const primaryRegion = getPrimaryRegionTarget(before.snapshot);
    const sweepDefinition = {
      kind: "sweep",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: "create",
        participants: [
          { role: "profile", targets: [primaryRegion] },
          {
            role: "path",
            targets: [
              { kind: "edge", bodyId: "body_part-1", edgeId: "edge_outer-0" },
            ],
          },
        ],
      },
    } as const;

    const preview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_sweep_valid",
      definition: sweepDefinition,
    });
    const created = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: sweepDefinition,
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const committedSweep = after.snapshot.document.features.find(
      (feature) => feature.featureId === created.featureId,
    );

    expectTrue(
      preview.render.records.length > 0,
      "Supported mock sweep previews should return transient renderables.",
    );
    expectTrue(
      preview.diagnostics.length === 0,
      "Supported mock sweep previews should not emit diagnostics.",
    );
    expectTrue(
      created.revisionState.kind === "accepted",
      "Supported mock sweep create requests should be accepted.",
    );
    expectTrue(
      committedSweep?.definition.kind === "sweep",
      "Committed mock sweep should be present in the next snapshot.",
    );
    expectTrue(
      committedSweep.definition.parameters.participants.some(
        (participant) => participant.role === "path",
      ),
      "Committed mock sweep should preserve the path participant role.",
    );
  }

  async function testSweepUnsupportedCasesReturnStructuredDiagnosticsWithoutMutation() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const primaryRegion = getPrimaryRegionTarget(before.snapshot);
    const guideCurveDefinition = {
      kind: "sweep",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: "create",
        participants: [
          { role: "profile", targets: [primaryRegion] },
          {
            role: "path",
            targets: [
              { kind: "edge", bodyId: "body_part-1", edgeId: "edge_outer-0" },
            ],
          },
          {
            role: "guideCurve",
            targets: [
              { kind: "edge", bodyId: "body_part-1", edgeId: "edge_outer-1" },
            ],
          },
        ],
      },
    } as const;
    const booleanDefinition = {
      ...guideCurveDefinition,
      parameters: {
        operationIntent: "subtract" as const,
        participants: [
          { role: "profile" as const, targets: [primaryRegion] },
          {
            role: "path" as const,
            targets: [
              {
                kind: "edge" as const,
                bodyId: "body_part-1" as const,
                edgeId: "edge_outer-0" as const,
              },
            ],
          },
          {
            role: "targetBody" as const,
            targets: [
              { kind: "body" as const, bodyId: "body_part-1" as const },
            ],
          },
        ],
      },
    } as const;

    const guidePreview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_sweep_guide_unsupported",
      definition: guideCurveDefinition,
    });
    const booleanCreate = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: booleanDefinition,
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    expectTrue(
      guidePreview.render.records.length === 0,
      "Unsupported sweep previews must not return transient renderables.",
    );
    expectTrue(
      guidePreview.diagnostics.some(
        (diagnostic) => diagnostic.detail?.kind === "advancedFeatureValidation",
      ),
      "Unsupported sweep previews must return structured advanced-feature diagnostics.",
    );
    expectTrue(
      booleanCreate.revisionState.kind === "rejected",
      "Unsupported sweep boolean create requests should be rejected.",
    );
    expectTrue(
      after.snapshot.document.revisionId ===
        before.snapshot.document.revisionId,
      "Rejected sweep create requests must not mutate committed document state.",
    );
  }

  async function testLoftPreviewAndCommitUseOrderedAdvancedParticipants() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const primaryRegion = getPrimaryRegionTarget(before.snapshot);
    const loftDefinition = {
      kind: "loft",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: "create",
        participants: [
          {
            role: "profile",
            targets: [
              primaryRegion,
              { kind: "face", bodyId: "body_part-1", faceId: "face_top" },
            ],
          },
        ],
      },
    } as const;

    const preview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_loft_valid",
      definition: loftDefinition,
    });
    const created = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: loftDefinition,
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const committedLoft = after.snapshot.document.features.find(
      (feature) => feature.featureId === created.featureId,
    );

    expectTrue(
      preview.render.records.length > 0,
      "Supported mock loft previews should return transient renderables.",
    );
    expectTrue(
      preview.diagnostics.length === 0,
      "Supported mock loft previews should not emit diagnostics.",
    );
    expectTrue(
      created.revisionState.kind === "accepted",
      "Supported mock loft create requests should be accepted.",
    );
    expectTrue(
      committedLoft?.definition.kind === "loft",
      "Committed mock loft should be present in the next snapshot.",
    );
    expectTrue(
      committedLoft.definition.parameters.participants.find(
        (participant) => participant.role === "profile",
      )?.targets[1]?.kind === "face",
      "Committed mock loft should preserve ordered profile participants.",
    );
  }

  async function testLoftAdvancedControlsAndUnsupportedCasesReturnStructuredDiagnosticsWithoutMutation() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const primaryRegion = getPrimaryRegionTarget(before.snapshot);
    const guideCurveDefinition = {
      kind: "loft",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: "create",
        participants: [
          {
            role: "profile",
            targets: [
              primaryRegion,
              { kind: "face", bodyId: "body_part-1", faceId: "face_top" },
            ],
          },
          {
            role: "guideCurve",
            targets: [
              { kind: "edge", bodyId: "body_part-1", edgeId: "edge_outer-1" },
            ],
          },
        ],
        options: {
          guideContinuity: "normalToGuide",
          profileConditions: {
            startCondition: "normal",
            startMagnitude: 1,
            endCondition: "tangent",
            endMagnitude: 1,
          },
        },
      },
    } as const;
    const pathAndGuideDefinition = {
      ...guideCurveDefinition,
      parameters: {
        ...guideCurveDefinition.parameters,
        participants: [
          ...guideCurveDefinition.parameters.participants,
          {
            role: "path" as const,
            targets: [
              {
                kind: "edge" as const,
                bodyId: "body_part-1" as const,
                edgeId: "edge_outer-0" as const,
              },
            ],
          },
        ],
        options: {
          ...guideCurveDefinition.parameters.options,
          path: { sectionCount: 5 },
        },
      },
    } as const;
    const booleanDefinition = {
      kind: "loft",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: "subtract" as const,
        participants: [
          {
            role: "profile" as const,
            targets: [
              primaryRegion,
              {
                kind: "face" as const,
                bodyId: "body_part-1" as const,
                faceId: "face_top" as const,
              },
            ],
          },
          {
            role: "targetBody" as const,
            targets: [
              { kind: "body" as const, bodyId: "body_part-1" as const },
            ],
          },
        ],
      },
    } as const;

    const guidePreview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_loft_guide_supported",
      definition: guideCurveDefinition,
    });
    const pathGuidePreview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_loft_path_guide_unsupported",
      definition: pathAndGuideDefinition,
    });
    const booleanCreate = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: booleanDefinition,
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    expectTrue(
      guidePreview.render.records.length > 0,
      "Supported guide-curve loft previews should return transient renderables.",
    );
    expectTrue(
      guidePreview.diagnostics.length === 0,
      "Supported guide-curve loft previews should not emit diagnostics.",
    );
    expectTrue(
      pathGuidePreview.diagnostics.some(
        (diagnostic) => diagnostic.detail?.kind === "advancedFeatureValidation",
      ),
      "Unsupported loft previews must return structured advanced-feature diagnostics.",
    );
    expectTrue(
      booleanCreate.revisionState.kind === "rejected",
      "Unsupported loft boolean create requests should be rejected.",
    );
    expectTrue(
      after.snapshot.document.revisionId ===
        before.snapshot.document.revisionId,
      "Rejected loft create requests must not mutate committed document state.",
    );
  }

  async function testChamferPreviewCommitAndUnsupportedCasesUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const chamferDefinition = {
      kind: "chamfer",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          {
            role: "edge",
            targets: [
              { kind: "edge", bodyId: "body_part-1", edgeId: "edge_outer-1" },
            ],
          },
        ],
        options: { distance: 0.5 },
      },
    } as const;
    const invalidDistanceDefinition = {
      ...chamferDefinition,
      parameters: {
        ...chamferDefinition.parameters,
        options: { distance: 0 },
      },
    } as const;

    const preview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_chamfer_valid",
      definition: chamferDefinition,
    });
    const created = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: chamferDefinition,
    });
    const invalid = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: created.revisionId,
      definition: invalidDistanceDefinition,
    });
    const afterInvalid = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const committedChamfer = afterInvalid.snapshot.document.features.find(
      (feature) => feature.featureId === created.featureId,
    );

    expectTrue(
      preview.render.records.length > 0,
      "Supported mock chamfer previews should return transient renderables.",
    );
    expectTrue(
      preview.diagnostics.length === 0,
      "Supported mock chamfer previews should not emit diagnostics.",
    );
    expectTrue(
      created.revisionState.kind === "accepted",
      "Supported mock chamfer create requests should be accepted.",
    );
    expectTrue(
      committedChamfer?.definition.kind === "chamfer",
      "Committed mock chamfer should be present in the next snapshot.",
    );
    expectTrue(
      committedChamfer.definition.parameters.participants.some(
        (participant) => participant.role === "edge",
      ),
      "Committed mock chamfer should preserve the edge participant role.",
    );
    expectTrue(
      committedChamfer.definition.parameters.options?.distance === 0.5,
      "Committed mock chamfer should preserve the distance option.",
    );
    expectTrue(
      invalid.revisionState.kind === "rejected",
      "Invalid chamfer distance should reject explicitly.",
    );
    expectTrue(
      afterInvalid.snapshot.document.revisionId === created.revisionId,
      "Rejected chamfer create requests must not mutate committed document state.",
    );
  }

  async function testThickenPreviewCommitAndUnsupportedCasesUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const thickenDefinition = {
      kind: "thicken",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: "create",
        participants: [
          {
            role: "face",
            targets: [
              { kind: "face", bodyId: "body_part-1", faceId: "face_top" },
            ],
          },
        ],
        options: { thickness: 0.5, side: "oneSide" },
      },
    } as const;
    const invalidThicknessDefinition = {
      ...thickenDefinition,
      parameters: {
        ...thickenDefinition.parameters,
        options: { thickness: 0, side: "oneSide" },
      },
    } as const;
    const booleanDefinition = {
      kind: "thicken",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: "subtract" as const,
        participants: [
          {
            role: "face" as const,
            targets: [
              {
                kind: "face" as const,
                bodyId: "body_part-1" as const,
                faceId: "face_top" as const,
              },
            ],
          },
          {
            role: "targetBody" as const,
            targets: [
              { kind: "body" as const, bodyId: "body_part-1" as const },
            ],
          },
        ],
        options: { thickness: 0.5, side: "symmetric" as const },
      },
    } as const;

    const preview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_thicken_valid",
      definition: thickenDefinition,
    });
    const created = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: thickenDefinition,
    });
    const invalid = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: created.revisionId,
      definition: invalidThicknessDefinition,
    });
    const booleanCreate = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: created.revisionId,
      definition: booleanDefinition,
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const committedThicken = after.snapshot.document.features.find(
      (feature) => feature.featureId === created.featureId,
    );

    expectTrue(
      preview.render.records.length > 0,
      "Supported mock thicken previews should return transient renderables.",
    );
    expectTrue(
      preview.diagnostics.length === 0,
      "Supported mock thicken previews should not emit diagnostics.",
    );
    expectTrue(
      created.revisionState.kind === "accepted",
      "Supported mock thicken create requests should be accepted.",
    );
    expectTrue(
      committedThicken?.definition.kind === "thicken",
      "Committed mock thicken should be present in the next snapshot.",
    );
    expectTrue(
      committedThicken.definition.parameters.participants.some(
        (participant) => participant.role === "face",
      ),
      "Committed mock thicken should preserve the face participant role.",
    );
    expectTrue(
      committedThicken.definition.parameters.options?.thickness === 0.5,
      "Committed mock thicken should preserve the thickness option.",
    );
    expectTrue(
      invalid.revisionState.kind === "rejected",
      "Invalid thicken thickness should reject explicitly.",
    );
    expectTrue(
      booleanCreate.revisionState.kind === "rejected",
      "Unsupported thicken boolean create requests should reject explicitly.",
    );
    expectTrue(
      after.snapshot.document.revisionId === created.revisionId,
      "Rejected thicken create requests must not mutate committed document state.",
    );
  }

  async function testSplitPreviewCommitAndUnsupportedCasesUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const splitDefinition = {
      kind: "split",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          {
            role: "targetBody",
            targets: [{ kind: "body", bodyId: "body_part-1" }],
          },
          {
            role: "toolBody",
            targets: [{ kind: "body", bodyId: "body_part-1" }],
          },
        ],
      },
    } as const;
    const unsupportedPlaneDefinition = {
      kind: "split",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          {
            role: "targetBody",
            targets: [{ kind: "body", bodyId: "body_part-1" }],
          },
          {
            role: "plane",
            targets: [
              { kind: "construction", constructionId: "construction_plane-xy" },
            ],
          },
        ],
      },
    } as const;

    const preview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_split_valid",
      definition: splitDefinition,
    });
    const created = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: splitDefinition,
    });
    const unsupported = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: created.revisionId,
      definition: unsupportedPlaneDefinition,
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const committedSplit = after.snapshot.document.features.find(
      (feature) => feature.featureId === created.featureId,
    );

    expectTrue(
      preview.render.records.length > 0,
      "Supported mock split previews should return transient renderables.",
    );
    expectTrue(
      preview.diagnostics.length === 0,
      "Supported mock split previews should not emit diagnostics.",
    );
    expectTrue(
      created.revisionState.kind === "accepted",
      "Supported mock split create requests should be accepted.",
    );
    expectTrue(
      committedSplit?.definition.kind === "split",
      "Committed mock split should be present in the next snapshot.",
    );
    expectTrue(
      committedSplit.definition.parameters.participants.some(
        (participant) => participant.role === "toolBody",
      ),
      "Committed mock split should preserve the explicit toolBody participant role.",
    );
    expectTrue(
      unsupported.revisionState.kind === "rejected",
      "Unsupported plane-based split create requests should reject explicitly.",
    );
    expectTrue(
      after.snapshot.document.revisionId === created.revisionId,
      "Rejected split create requests must not mutate committed document state.",
    );
  }

  async function testCombinePreviewCommitAndValidationUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter();
    await addMockToolBody(adapter, "body_part-2" as BodyId);
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const combineDefinition = {
      ...combineAdvancedFeatureExample,
      parameters: {
        operationIntent: "subtract" as const,
        participants: [
          {
            role: "targetBody" as const,
            targets: [
              { kind: "body" as const, bodyId: "body_part-1" as BodyId },
            ],
          },
          {
            role: "toolBody" as const,
            targets: [
              { kind: "body" as const, bodyId: "body_part-2" as BodyId },
            ],
          },
        ],
      },
    };
    const invalidDefinition = {
      ...combineDefinition,
      parameters: {
        ...combineDefinition.parameters,
        participants: [
          {
            role: "targetBody" as const,
            targets: [
              { kind: "body" as const, bodyId: "body_part-1" as BodyId },
            ],
          },
          {
            role: "toolBody" as const,
            targets: [
              { kind: "body" as const, bodyId: "body_part-1" as BodyId },
            ],
          },
        ],
      },
    };

    const preview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_combine_valid",
      definition: combineDefinition,
    });
    const created = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: combineDefinition,
    });
    const invalid = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: created.revisionId,
      definition: invalidDefinition,
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const committedCombine = after.snapshot.document.features.find(
      (feature) => feature.featureId === created.featureId,
    );
    const targetBody = after.snapshot.document.bodies.find(
      (body) => body.bodyId === "body_part-1",
    );

    expectTrue(
      preview.render.records.length > 0,
      "Supported mock combine previews should return transient renderables.",
    );
    expectTrue(
      preview.diagnostics.length === 0,
      "Supported mock combine previews should not emit diagnostics.",
    );
    expectTrue(
      created.revisionState.kind === "accepted",
      "Supported mock combine create requests should be accepted.",
    );
    expectTrue(
      committedCombine?.definition.kind === "combine",
      "Committed mock combine should be present in the next snapshot.",
    );
    expectTrue(
      committedCombine.definition.parameters.operationIntent === "subtract",
      "Committed mock combine should preserve the operation intent.",
    );
    expectTrue(
      targetBody?.label.includes("(subtract)") === true,
      "Committed mock combine should visibly relabel the target body output.",
    );
    expectTrue(
      !after.snapshot.document.bodies.some(
        (body) => body.bodyId === "body_part-2",
      ),
      "Committed mock combine should consume the tool body row.",
    );
    expectTrue(
      !after.snapshot.presentation.objects.some(
        (item) =>
          item.target.kind === "body" && item.target.bodyId === "body_part-2",
      ),
      "Committed mock combine should remove the consumed tool body from object navigation.",
    );
    expectTrue(
      invalid.revisionState.kind === "rejected",
      "Invalid combine role overlap should reject explicitly.",
    );
    expectTrue(
      after.snapshot.document.revisionId === created.revisionId,
      "Rejected combine create requests must not mutate committed document state.",
    );
  }

  async function testDeleteSolidPreviewCommitAndValidationUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const deleteDefinition = {
      kind: "deleteSolid",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          {
            role: "body",
            targets: [{ kind: "body", bodyId: "body_part-1" }],
          },
        ],
      },
    } as const;
    const invalidDefinition = {
      ...deleteSolidAdvancedFeatureExample,
      parameters: {
        participants: [
          {
            role: "body" as const,
            targets: [
              {
                kind: "face" as const,
                bodyId: "body_part-1" as const,
                faceId: "face_top" as const,
              },
            ],
          },
        ],
      },
    };

    const preview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_delete_solid_valid",
      definition: deleteDefinition,
    });
    const created = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: deleteDefinition,
    });
    const invalid = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: created.revisionId,
      definition: invalidDefinition,
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const committedDelete = after.snapshot.document.features.find(
      (feature) => feature.featureId === created.featureId,
    );

    expectTrue(
      preview.render.records.length > 0,
      "Supported mock delete-solid previews should return transient renderables.",
    );
    expectTrue(
      preview.diagnostics.length === 0,
      "Supported mock delete-solid previews should not emit diagnostics.",
    );
    expectTrue(
      created.revisionState.kind === "accepted",
      "Supported mock delete-solid create requests should be accepted.",
    );
    expectTrue(
      committedDelete?.definition.kind === "deleteSolid",
      "Committed mock delete-solid should be present in the next snapshot.",
    );
    expectTrue(
      committedDelete.definition.parameters.participants[0]?.targets.length ===
        1,
      "Committed mock delete-solid should preserve the selected body participants.",
    );
    expectTrue(
      invalid.revisionState.kind === "rejected",
      "Invalid delete-solid body targets should reject explicitly.",
    );
    expectTrue(
      after.snapshot.document.revisionId === created.revisionId,
      "Rejected delete-solid create requests must not mutate committed document state.",
    );
  }

  async function testMirrorPreviewCommitAndUnsupportedCasesUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    const mirrorDefinition = {
      ...mirrorAdvancedFeatureExample,
      parameters: {
        participants: [
          { role: "body", targets: [{ kind: "body", bodyId: "body_part-1" }] },
          {
            role: "plane",
            targets: [
              { kind: "construction", constructionId: "construction_plane-xy" },
            ],
          },
        ],
        options: { copy: true },
      },
    } as const;
    const unsupportedDefinition = {
      ...mirrorDefinition,
      parameters: {
        ...mirrorDefinition.parameters,
        options: { copy: false },
      },
    } as const;

    const preview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_mirror_valid",
      definition: mirrorDefinition,
    });
    const created = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: mirrorDefinition,
    });
    const unsupported = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: created.revisionId,
      definition: unsupportedDefinition,
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const committedMirror = after.snapshot.document.features.find(
      (feature) => feature.featureId === created.featureId,
    );

    expectTrue(
      preview.render.records.length > 0,
      "Supported mock mirror previews should return transient renderables.",
    );
    expectTrue(
      preview.diagnostics.length === 0,
      "Supported mock mirror previews should not emit diagnostics.",
    );
    expectTrue(
      created.revisionState.kind === "accepted",
      "Supported mock mirror create requests should be accepted.",
    );
    expectTrue(
      committedMirror?.definition.kind === "mirror",
      "Committed mock mirror should be present in the next snapshot.",
    );
    expectTrue(
      committedMirror.definition.parameters.participants.some(
        (participant) => participant.role === "plane",
      ),
      "Committed mock mirror should preserve the explicit plane participant.",
    );
    expectTrue(
      committedMirror.definition.parameters.options?.copy === true,
      "Committed mock mirror should preserve the copy option.",
    );
    expectTrue(
      unsupported.revisionState.kind === "rejected",
      "Unsupported mirror replace requests should reject explicitly.",
    );
    expectTrue(
      after.snapshot.document.revisionId === created.revisionId,
      "Rejected mirror create requests must not mutate committed document state.",
    );
  }

  async function testTransformPreviewCommitAndValidationUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter();
    const before = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    const transformDefinition = {
      ...transformAdvancedFeatureExample,
      parameters: {
        participants: [
          { role: "body", targets: [{ kind: "body", bodyId: "body_part-1" }] },
          {
            role: "transformReference",
            targets: [
              { kind: "construction", constructionId: "construction_plane-xy" },
            ],
          },
        ],
        options: { distance: 2 },
      },
    } as const;
    const invalidDefinition = {
      ...transformDefinition,
      parameters: {
        ...transformDefinition.parameters,
        options: { distance: 0 },
      },
    } as const;

    const preview = await adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      previewId: "preview_transform_valid",
      definition: transformDefinition,
    });
    const created = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: transformDefinition,
    });
    const invalid = await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: created.revisionId,
      definition: invalidDefinition,
    });
    const after = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const committedTransform = after.snapshot.document.features.find(
      (feature) => feature.featureId === created.featureId,
    );

    expectTrue(
      preview.render.records.length > 0,
      "Supported mock transform previews should return transient renderables.",
    );
    expectTrue(
      preview.diagnostics.length === 0,
      "Supported mock transform previews should not emit diagnostics.",
    );
    expectTrue(
      created.revisionState.kind === "accepted",
      "Supported mock transform create requests should be accepted.",
    );
    expectTrue(
      committedTransform?.definition.kind === "transform",
      "Committed mock transform should be present in the next snapshot.",
    );
    expectTrue(
      committedTransform.definition.parameters.participants.some(
        (participant) => participant.role === "transformReference",
      ),
      "Committed mock transform should preserve the explicit transform reference.",
    );
    expectTrue(
      committedTransform.definition.parameters.options?.distance === 2,
      "Committed mock transform should preserve the typed distance option.",
    );
    expectTrue(
      invalid.revisionState.kind === "rejected",
      "Invalid transform distance requests should reject explicitly.",
    );
    expectTrue(
      after.snapshot.document.revisionId === created.revisionId,
      "Rejected transform create requests must not mutate committed document state.",
    );
  }

  async function testSnapshotRenderablesExposeSemanticBindings() {
    const adapter = new MockKernelAdapter();
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    const planarFace = snapshot.snapshot.document.render.records.find(
      (renderable) => renderable.binding.semanticClass === "planarFace",
    );

    expectTrue(
      planarFace !== undefined,
      "Seed snapshot must contain a planar face binding.",
    );
    expectTrue(
      planarFace.geometry.kind === "mesh",
      "Planar face exports must use mesh geometry.",
    );
    expectTrue(
      planarFace.binding.target.kind === "face",
      "Planar face bindings must round-trip through a durable face ref.",
    );

    const topFaceEntity = snapshot.snapshot.presentation.entities.find(
      (entity) =>
        entity.target.kind === "face" && entity.target.faceId === "face_top",
    );

    expectTrue(
      topFaceEntity?.selectionSemantics.includes("planarFace") === true,
      "Planar-face selection semantics must live on durable snapshot entities.",
    );
  }

  async function testConstructionPlanesExposeFilledRenderSurfaces() {
    const adapter = new MockKernelAdapter();
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });

    const constructionMeshTargets = snapshot.snapshot.document.render.records
      .filter(
        (record) =>
          record.binding.semanticClass === "construction" &&
          record.geometry.kind === "mesh",
      )
      .map((record) => record.binding.target);

    expectTrue(
      constructionMeshTargets.length >= 3,
      "Construction planes should expose filled mesh records for viewport picking.",
    );
    expectTrue(
      constructionMeshTargets.some(
        (target) =>
          target.kind === "construction" &&
          target.constructionId === "construction_plane-xy",
      ),
      "The XY construction plane should expose a filled mesh render record.",
    );
    expectTrue(
      constructionMeshTargets.some(
        (target) =>
          target.kind === "construction" &&
          target.constructionId === "construction_plane-yz",
      ),
      "The YZ construction plane should expose a filled mesh render record.",
    );
    expectTrue(
      constructionMeshTargets.some(
        (target) =>
          target.kind === "construction" &&
          target.constructionId === "construction_plane-xz",
      ),
      "The XZ construction plane should expose a filled mesh render record.",
    );

    const yzPlane = snapshot.snapshot.document.constructions.find(
      (construction) => construction.constructionId === "construction_plane-yz",
    )?.plane;

    expectTrue(
      yzPlane?.frame.normal[0] === 1,
      "Construction snapshots should expose explicit plane definitions for sketch entry.",
    );
    expectTrue(
      yzPlane?.key === "yz",
      "Construction snapshot plane definitions should preserve their primary-plane key when available.",
    );
  }

  function testResolvePickTargetUsesKernelPriority() {
    const edgeRenderable = {
      id: "renderable_edge_priority",
      label: "Priority edge",
      ownerBodyId: "body_test",
      ownerFeatureId: null,
      binding: {
        pickId: "pick_edge_priority",
        pickPriority: 10,
        target: { kind: "edge", bodyId: "body_test", edgeId: "edge_test" },
        topology: "edge",
        semanticClass: "featureEdge",
      },
      geometry: {
        kind: "polyline",
        points: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        isClosed: false,
      },
    } as const;

    const faceRenderable = {
      id: "renderable_face_priority",
      label: "Priority face",
      ownerBodyId: "body_test",
      ownerFeatureId: null,
      binding: {
        pickId: "pick_face_priority",
        pickPriority: 20,
        target: { kind: "face", bodyId: "body_test", faceId: "face_test" },
        topology: "face",
        semanticClass: "planarFace",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2]],
      },
    } as const;

    const faceObject = new THREE.Object3D();
    bindRenderableObject(
      faceObject,
      faceRenderable.binding.pickId,
      faceRenderable.binding.target,
      faceRenderable.binding.semanticClass,
      "document",
      faceRenderable,
    );
    const edgeObject = new THREE.Object3D();
    bindRenderableObject(
      edgeObject,
      edgeRenderable.binding.pickId,
      edgeRenderable.binding.target,
      edgeRenderable.binding.semanticClass,
      "document",
      edgeRenderable,
    );

    const intersections = [
      {
        distance: 1,
        object: faceObject,
      },
      {
        distance: 2,
        object: edgeObject,
      },
    ] as THREE.Intersection<THREE.Object3D>[];

    const result = resolvePickTarget(intersections);

    expectTrue(
      result?.pickId === "pick_face_priority",
      "Pick resolution must prefer nearer geometry before pickPriority.",
    );
  }

  function testRenderValidatorRejectsInvalidGeometry() {
    const validFace = {
      id: "renderable_test_face",
      label: "Test face",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_test_face",
        pickPriority: 20,
        target: { kind: "face", bodyId: "body_test", faceId: "face_test" },
        topology: "face",
        semanticClass: "planarFace",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [],
        vertexNormals: null,
        triangleIndices: [],
      },
    } as const;

    let meshRejected = false;

    try {
      modelingRuntimeValidators.renderables([validFace]);
    } catch {
      meshRejected = true;
    }

    expectTrue(
      meshRejected,
      "Render validator must reject empty mesh exports.",
    );

    const invalidPolyline = {
      id: "renderable_test_curve",
      label: "Test curve",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_test_curve",
        pickPriority: 10,
        target: { kind: "edge", bodyId: "body_test", edgeId: "edge_test" },
        topology: "edge",
        semanticClass: "featureEdge",
      },
      geometry: {
        kind: "polyline",
        points: [[0, 0, 0]],
        isClosed: false,
      },
    } as const;

    let polylineRejected = false;

    try {
      modelingRuntimeValidators.renderables([invalidPolyline]);
    } catch {
      polylineRejected = true;
    }

    expectTrue(
      polylineRejected,
      "Render validator must reject degenerate open polylines.",
    );

    const invalidMarker = {
      id: "renderable_test_point",
      label: "Test point",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_test_point",
        pickPriority: 0,
        target: {
          kind: "vertex",
          bodyId: "body_test",
          vertexId: "vertex_test",
        },
        topology: "vertex",
        semanticClass: "featureVertex",
      },
      geometry: {
        kind: "marker",
        position: [0, 0, 0],
        displayRadius: 0,
      },
    } as const;

    let markerRejected = false;

    try {
      modelingRuntimeValidators.renderables([invalidMarker]);
    } catch {
      markerRejected = true;
    }

    expectTrue(
      markerRejected,
      "Render validator must reject non-positive marker radius.",
    );
  }

  function testFeatureSnapshotValidatorPreservesMirrorAndTransformDefinitions() {
    const features = modelingRuntimeValidators.features([
      {
        ownerDocumentId: "doc_workspace",
        ownerRevisionId: "rev_1",
        ownerFeatureId: "feature_mirror-1",
        ownerSketchId: null,
        ownerBodyId: null,
        featureId: "feature_mirror-1",
        label: "Mirror 1",
        suppressed: false,
        definition: {
          kind: "mirror",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            participants: [
              { role: "body", targets: [{ kind: "body", bodyId: "body_a" }] },
              {
                role: "plane",
                targets: [
                  {
                    kind: "construction",
                    constructionId: "construction_plane-xy",
                  },
                ],
              },
            ],
            options: { copy: true },
          },
        },
        producedTargets: [{ kind: "body", bodyId: "body_mirror-1" }],
      },
      {
        ownerDocumentId: "doc_workspace",
        ownerRevisionId: "rev_1",
        ownerFeatureId: "feature_transform-1",
        ownerSketchId: null,
        ownerBodyId: null,
        featureId: "feature_transform-1",
        label: "Transform 1",
        suppressed: false,
        definition: {
          kind: "transform",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            participants: [
              { role: "body", targets: [{ kind: "body", bodyId: "body_a" }] },
              {
                role: "transformReference",
                targets: [
                  {
                    kind: "construction",
                    constructionId: "construction_plane-xy",
                  },
                ],
              },
            ],
            options: { distance: 2 },
          },
        },
        producedTargets: [{ kind: "body", bodyId: "body_a" }],
      },
    ]);

    expectTrue(
      features[0]?.definition.kind === "mirror",
      "Feature snapshot normalization should preserve mirror definitions.",
    );
    expectTrue(
      features[0]?.definition.parameters.options?.copy === true,
      "Feature snapshot normalization should preserve mirror copy options.",
    );
    expectTrue(
      features[1]?.definition.kind === "transform",
      "Feature snapshot normalization should preserve transform definitions.",
    );
    expectTrue(
      features[1]?.definition.parameters.options?.distance === 2,
      "Feature snapshot normalization should preserve transform distance options.",
    );
  }

  async function testMockSnapshotSurfacesSketchNavigationAndHistory() {
    const adapter = new MockKernelAdapter();
    const response = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const snapshot = response.snapshot;

    expectTrue(
      snapshot.presentation.objects.some(
        (item) =>
          item.kind === "sketch" &&
          item.target.kind === "sketch" &&
          item.target.sketchId === "sketch_primary",
      ),
      "Mock snapshot object navigation must include committed sketch rows.",
    );
    expectTrue(
      snapshot.presentation.documentHistory.some(
        (item) =>
          item.kind === "sketch" &&
          item.target.kind === "sketch" &&
          item.target.sketchId === "sketch_primary",
      ),
      "Mock snapshot document history must include committed sketch items.",
    );
  }

  async function testDocumentVariableExpressionsValidateBeforeMutation() {
    const adapter = new MockKernelAdapter();
    const initial = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const initialVariables = [...initial.snapshot.document.variables];

    const x = await adapter.addDocumentVariable({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: initial.snapshot.document.revisionId,
      variableId: "variable_x",
      name: "x",
      valueText: "50",
    });
    expectTrue(
      x.revisionState.kind === "accepted",
      "Valid variable literals should be accepted.",
    );

    const y = await adapter.addDocumentVariable({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: x.revisionId,
      variableId: "variable_y",
      name: "y",
      valueText: "x + 50",
    });
    expectTrue(
      y.revisionState.kind === "accepted",
      "Dependent variable expressions should be accepted.",
    );

    const acceptedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    expectTrue(
      acceptedSnapshot.snapshot.document.variables.some(
        (variable) =>
          variable.variableId === "variable_y" &&
          variable.name === "y" &&
          variable.valueText === "x + 50",
      ),
      "Accepted variable expressions should persist raw valueText.",
    );

    const rejected = await adapter.updateDocumentVariable({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: y.revisionId,
      variableId: "variable_y",
      name: "y",
      valueText: "missing + 1",
    });
    expectTrue(
      rejected.revisionState.kind === "rejected",
      "Invalid variable expressions should be rejected.",
    );
    expectTrue(
      rejected.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "document-variable-unresolved-reference",
      ),
      "Rejected variable expressions should report expression diagnostics.",
    );

    const rejectedSnapshot = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    expectTrue(
      rejectedSnapshot.snapshot.document.variables
        .map(
          (variable) =>
            `${variable.variableId}:${variable.name}:${variable.valueText}`,
        )
        .join("|") ===
        acceptedSnapshot.snapshot.document.variables
          .map(
            (variable) =>
              `${variable.variableId}:${variable.name}:${variable.valueText}`,
          )
          .join("|"),
      "Rejected variable expressions should leave document variables unchanged.",
    );
    expectTrue(
      initialVariables.every((variable) =>
        rejectedSnapshot.snapshot.document.variables.some(
          (next) =>
            next.variableId === variable.variableId &&
            next.name === variable.name &&
            next.valueText === variable.valueText,
        ),
      ),
      "Existing variable records should remain present after expression validation.",
    );
  }

  await testExtrudePreviewDependsOnDefinition();
  await testProfileCollectionContractBoundaryRejectsInvalidPayloads();
  await testUnsupportedFeatureDefinitionsAreRejectedByMock();
  await testMutationResponsesReportRebuildResults();
  await testAcceptedCreateMutatesCommittedSnapshot();
  await testSourceBackedSketchReferenceProjection();
  await testRollbackCursorPreservesAndInsertsFeatureAfterCursor();
  await testRollbackCursorHidesFutureSketchPresentation();
  await testAcceptedSketchCommitMutatesCommittedSnapshot();
  await testAcceptedSketchCommitNormalizesAuthoringOperationTargets();
  await testAcceptedSketchCommitPersistsActiveProjectionData();
  await testMissingMutationTargetsAreRejected();
  await testGenericDeleteTargetsAcceptRejectAndConflict();
  await testDocumentHistoryReorderAcceptsRejectsAndConflicts();
  await testPreviewStalenessReportsObservedRevision();
  await testResolveReferenceReportsMissingTargetsExplicitly();
  await testMockKernelRejectsUnsupportedContractEnvelope();
  await testAdvancedPreviewReturnsStructuredUnsupportedDiagnosticsWithoutMutation();
  await testSweepPreviewAndCommitUseAdvancedParticipants();
  await testSweepUnsupportedCasesReturnStructuredDiagnosticsWithoutMutation();
  await testLoftPreviewAndCommitUseOrderedAdvancedParticipants();
  await testLoftAdvancedControlsAndUnsupportedCasesReturnStructuredDiagnosticsWithoutMutation();
  await testChamferPreviewCommitAndUnsupportedCasesUseAdvancedParticipants();
  await testThickenPreviewCommitAndUnsupportedCasesUseAdvancedParticipants();
  await testSplitPreviewCommitAndUnsupportedCasesUseAdvancedParticipants();
  await testCombinePreviewCommitAndValidationUseAdvancedParticipants();
  await testDeleteSolidPreviewCommitAndValidationUseAdvancedParticipants();
  await testMirrorPreviewCommitAndUnsupportedCasesUseAdvancedParticipants();
  await testTransformPreviewCommitAndValidationUseAdvancedParticipants();
  await testSnapshotRenderablesExposeSemanticBindings();
  await testConstructionPlanesExposeFilledRenderSurfaces();
  testResolvePickTargetUsesKernelPriority();
  testRenderValidatorRejectsInvalidGeometry();
  testFeatureSnapshotValidatorPreservesMirrorAndTransformDefinitions();
  await testMockSnapshotSurfacesSketchNavigationAndHistory();
  await testDocumentVariableExpressionsValidateBeforeMutation();
});
