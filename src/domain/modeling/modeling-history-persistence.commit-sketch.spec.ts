import { test, expect } from "vitest";
import {
  createCreateFeatureHistoryEntry,
  createEmptyOperationHistory,
} from "@/contracts/modeling/operation-history";
import type { ModelingKernelAdapter } from "@/contracts/modeling/adapter";
import type {
  CommitSketchRequest,
  WorkspaceSnapshot,
  FeatureSnapshotRecord,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import { SOLVED_SKETCH_SCHEMA_VERSION } from "@/contracts/sketch/schema";
import {
  CONTRACT_VERSION,
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import type { AppResultAsync } from "@/contracts/errors";
import { createMemoryOperationHistoryStore } from "@/domain/modeling/modeling-history-persistence";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import type { ModelingCommitSketchResult } from "@/domain/modeling/modeling-service";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

const regionSolver = new SketchConstraintSolverAdapter({ revisionId: null });

test("src/domain/modeling/modeling-history-persistence.commit-sketch.spec.ts", async () => {
  async function unwrapModelingResult<T>(
    result: AppResultAsync<T>,
  ): Promise<T> {
    const resolved = await result;
    expect(
      resolved.isOk(),
      resolved.isErr()
        ? resolved.error.message
        : "Modeling result should be ok.",
    ).toBeTruthy();
    return resolved.value;
  }

  function createDraftSketchDefinition(sketchId: `sketch_${string}`) {
    return {
      schemaVersion: "sketch-definition/v1alpha1" as const,
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_1_rect-bottom-left",
        "sketch_point_1_rect-bottom-right",
        "sketch_point_1_rect-top-right",
        "sketch_point_1_rect-top-left",
      ] as const,
      points: [
        {
          pointId: "sketch_point_1_rect-bottom-left",
          label: "Rectangle 1 bottom left",
          target: {
            kind: "sketchPoint" as const,
            sketchId,
            pointId: "sketch_point_1_rect-bottom-left",
          },
          position: [-15.5, -5] as const,
          isConstruction: false,
        },
        {
          pointId: "sketch_point_1_rect-bottom-right",
          label: "Rectangle 1 bottom right",
          target: {
            kind: "sketchPoint" as const,
            sketchId,
            pointId: "sketch_point_1_rect-bottom-right",
          },
          position: [-5, -5] as const,
          isConstruction: false,
        },
        {
          pointId: "sketch_point_1_rect-top-right",
          label: "Rectangle 1 top right",
          target: {
            kind: "sketchPoint" as const,
            sketchId,
            pointId: "sketch_point_1_rect-top-right",
          },
          position: [-5, 4.5] as const,
          isConstruction: false,
        },
        {
          pointId: "sketch_point_1_rect-top-left",
          label: "Rectangle 1 top left",
          target: {
            kind: "sketchPoint" as const,
            sketchId,
            pointId: "sketch_point_1_rect-top-left",
          },
          position: [-15.5, 4.5] as const,
          isConstruction: false,
        },
      ],
      entityIds: [
        "sketch_entity_1_rect-bottom",
        "sketch_entity_1_rect-right",
        "sketch_entity_1_rect-top",
        "sketch_entity_1_rect-left",
      ] as const,
      entities: [
        {
          kind: "lineSegment" as const,
          entityId: "sketch_entity_1_rect-bottom",
          label: "Rectangle 1 bottom",
          target: {
            kind: "sketchEntity" as const,
            sketchId,
            entityId: "sketch_entity_1_rect-bottom",
          },
          isConstruction: false,
          startPointId: "sketch_point_1_rect-bottom-left",
          endPointId: "sketch_point_1_rect-bottom-right",
        },
        {
          kind: "lineSegment" as const,
          entityId: "sketch_entity_1_rect-right",
          label: "Rectangle 1 right",
          target: {
            kind: "sketchEntity" as const,
            sketchId,
            entityId: "sketch_entity_1_rect-right",
          },
          isConstruction: false,
          startPointId: "sketch_point_1_rect-bottom-right",
          endPointId: "sketch_point_1_rect-top-right",
        },
        {
          kind: "lineSegment" as const,
          entityId: "sketch_entity_1_rect-top",
          label: "Rectangle 1 top",
          target: {
            kind: "sketchEntity" as const,
            sketchId,
            entityId: "sketch_entity_1_rect-top",
          },
          isConstruction: false,
          startPointId: "sketch_point_1_rect-top-right",
          endPointId: "sketch_point_1_rect-top-left",
        },
        {
          kind: "lineSegment" as const,
          entityId: "sketch_entity_1_rect-left",
          label: "Rectangle 1 left",
          target: {
            kind: "sketchEntity" as const,
            sketchId,
            entityId: "sketch_entity_1_rect-left",
          },
          isConstruction: false,
          startPointId: "sketch_point_1_rect-top-left",
          endPointId: "sketch_point_1_rect-bottom-left",
        },
      ],
      constraintIds: [
        "constraint_1_bottom-horizontal",
        "constraint_1_top-horizontal",
        "constraint_1_right-vertical",
        "constraint_1_left-vertical",
      ] as const,
      constraints: [
        {
          constraintId: "constraint_1_bottom-horizontal",
          kind: "horizontal" as const,
          label: "Rectangle 1 bottom horizontal",
          entityId: "sketch_entity_1_rect-bottom",
        },
        {
          constraintId: "constraint_1_top-horizontal",
          kind: "horizontal" as const,
          label: "Rectangle 1 top horizontal",
          entityId: "sketch_entity_1_rect-top",
        },
        {
          constraintId: "constraint_1_right-vertical",
          kind: "vertical" as const,
          label: "Rectangle 1 right vertical",
          entityId: "sketch_entity_1_rect-right",
        },
        {
          constraintId: "constraint_1_left-vertical",
          kind: "vertical" as const,
          label: "Rectangle 1 left vertical",
          entityId: "sketch_entity_1_rect-left",
        },
      ],
      dimensionIds: ["dimension_1_width", "dimension_1_height"] as const,
      dimensions: [
        {
          dimensionId: "dimension_1_width",
          kind: "distance" as const,
          label: "Rectangle 1 width",
          axis: "horizontal" as const,
          pointIds: [
            "sketch_point_1_rect-bottom-left",
            "sketch_point_1_rect-bottom-right",
          ] as const,
          value: 10.5,
        },
        {
          dimensionId: "dimension_1_height",
          kind: "distance" as const,
          label: "Rectangle 1 height",
          axis: "vertical" as const,
          pointIds: [
            "sketch_point_1_rect-bottom-right",
            "sketch_point_1_rect-top-right",
          ] as const,
          value: 9.5,
        },
      ],
    } satisfies CommitSketchRequest["definition"];
  }

  async function getFirstDerivedRegionId(
    documentId: "doc_workspace",
    revisionId: `rev_${string}`,
    sketchId: `sketch_${string}`,
    definition: ReturnType<typeof createDraftSketchDefinition>,
  ) {
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: "failOnConflict",
    });
    const regions = (await regionSolver.deriveSketchRegions({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: "request_regions",
      documentId,
      revisionId,
      sketchId,
      definition,
      solvedSnapshot: solved.solvedSnapshot,
      projectedReferences: [],
    })).regions;
    const regionId = regions[0]?.regionId;
    expect(
      regionId,
      "Draft sketch should derive a region for persisted feature replay.",
    ).toBeTruthy();
    return regionId;
  }

  function createLegacyCommitSketchHistory() {
    return {
      ...createEmptyOperationHistory("doc_workspace"),
      entries: [
        {
          kind: "commitSketch" as const,
          payload: {
            sketchId: null,
            sketchLabel: "Legacy Draft Sketch",
            plane: {
              key: "xy" as const,
              support: {
                kind: "construction" as const,
                constructionId: "construction_plane-xy" as const,
              },
              frame: {
                origin: [0, 0, 0] as const,
                xAxis: [1, 0, 0] as const,
                yAxis: [0, 1, 0] as const,
                normal: [0, 0, 1] as const,
                linearUnit: "documentLength" as const,
                handedness: "rightHanded" as const,
              },
            },
            definition: createDraftSketchDefinition("sketch_draft"),
          },
        },
      ],
    };
  }

  function normalizeDefinitionForSketchId(
    definition: CommitSketchRequest["definition"],
    sketchId: `sketch_${string}`,
  ): CommitSketchRequest["definition"] {
    return {
      ...definition,
      points: definition.points.map((point) => ({
        ...point,
        target: {
          ...point.target,
          sketchId,
        },
      })),
      entities: definition.entities.map((entity) => ({
        ...entity,
        target: {
          ...entity.target,
          sketchId,
        },
      })),
    };
  }

  function createWorkspaceSnapshot(
    revisionId: `rev_${string}`,
    sketches: WorkspaceSnapshot["sketches"] = [],
    features: WorkspaceSnapshot["features"] = [],
  ): WorkspaceSnapshot {
    const document = {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      documentId: "doc_workspace" as const,
      name: "Workspace",
      revisionId,
      settings: {
        linearUnit: "millimeter" as const,
        modelingTolerance: 0.001,
        angularToleranceRadians: 0.0001,
      },
      capabilities: {
        supportedFeatureKinds: [],
        previewableFeatureKinds: [],
        supportedProfileKinds: [],
        supportsFaceBackedSketchPlanes: true,
        supportsDurableTopologyNaming: false,
      },
      featureTree: [],
      objects: [],
      features,
      cursor: { kind: "empty" as const },
      sketches,
      bodies: [],
      constructions: [],
      variables: [],
      entities: [],
      references: [],
      diagnostics: [],
      render: {
        schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
        records: [],
      },
    };

    return {
      document,
      presentation: {
        featureTree: [],
        objects: [],
        documentHistory: [],
        entities: [],
      },
      provenance: null,
    };
  }

  function createLegacyReplayAdapter(): ModelingKernelAdapter {
    let currentSnapshot = createWorkspaceSnapshot("rev_0001");
    let revisionCounter = 1;

    return {
      async getDocumentSnapshot() {
        return {
          contractVersion: CONTRACT_VERSION,
          snapshot: currentSnapshot,
        };
      },
      async commitSketch(request) {
        revisionCounter += 1;
        const revisionId =
          `rev_${String(revisionCounter).padStart(4, "0")}` as const;
        const sketchId =
          request.sketchId ?? ("sketch_legacy_replayed" as const);
        const normalizedDefinition = normalizeDefinitionForSketchId(
          request.definition,
          sketchId,
        );
        const sketch: SketchSnapshotRecord = {
          ownerDocumentId: "doc_workspace",
          ownerRevisionId: revisionId,
          ownerFeatureId: null,
          ownerSketchId: sketchId,
          ownerBodyId: null,
          sketchId,
          label: request.sketchLabel,
          plane: request.plane,
          sketch: {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: revisionId,
            ownerFeatureId: null,
            ownerSketchId: sketchId,
            ownerBodyId: null,
            sketchId,
            label: request.sketchLabel,
            planeSupport: request.plane.support,
            definition: normalizedDefinition,
            solvedSnapshot: {
              schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
              status: {
                solveState: "solved",
                constraintState: "wellConstrained",
              },
              solvedEntities: [],
              solvedPoints: [],
              constraintStatuses: [],
              dimensionStatuses: [],
              diagnostics: [],
            },
            derivedValidity: { state: "current", diagnostics: [] },
            regions: [],
          },
        };
        currentSnapshot = createWorkspaceSnapshot(revisionId, [sketch]);

        return {
          contractVersion: CONTRACT_VERSION,
          documentId: "doc_workspace",
          revisionId,
          sketchId,
          revisionState: {
            kind: "accepted" as const,
            baseRevisionId: request.baseRevisionId,
          },
          rebuildResult: {
            kind: "rebuilt" as const,
            revisionId,
            invalidatedTargets: [],
            diagnostics: [],
          },
          changedTargets: [],
          diagnostics: [],
        };
      },
      async createFeature() {
        throw new Error("Not implemented for legacy commitSketch replay test.");
      },
      async updateFeature() {
        throw new Error("Not implemented for legacy commitSketch replay test.");
      },
      async deleteFeature() {
        throw new Error("Not implemented for legacy commitSketch replay test.");
      },
      async deleteTarget() {
        throw new Error("Not implemented for legacy commitSketch replay test.");
      },
      async renameBody() {
        throw new Error("Not implemented for legacy commitSketch replay test.");
      },
      async reorderFeature() {
        throw new Error("Not implemented for legacy commitSketch replay test.");
      },
      async setFeatureCursor() {
        throw new Error("Not implemented for legacy commitSketch replay test.");
      },
      async addDocumentVariable() {
        throw new Error("Not implemented for legacy commitSketch replay test.");
      },
      async updateDocumentVariable() {
        throw new Error("Not implemented for legacy commitSketch replay test.");
      },
      async evaluatePreview() {
        throw new Error("Not implemented for legacy commitSketch replay test.");
      },
      async resolveReference() {
        throw new Error("Not implemented for legacy commitSketch replay test.");
      },
    };
  }

  function createStrictReplayAdapter(): ModelingKernelAdapter {
    let currentSnapshot = createWorkspaceSnapshot("rev_0001");
    let revisionCounter = 1;
    let allocationCounter = 0;
    const issuedSketchIds = new Set<string>();

    function nextRevisionId() {
      revisionCounter += 1;
      return `rev_${String(revisionCounter).padStart(4, "0")}` as const;
    }

    function allocateSketchId() {
      let sketchId: `sketch_${string}`;
      do {
        allocationCounter += 1;
        sketchId = `sketch_00000000-0000-4000-8000-${String(
          allocationCounter,
        ).padStart(12, "0")}`;
      } while (issuedSketchIds.has(sketchId));
      issuedSketchIds.add(sketchId);
      return sketchId;
    }

    return {
      async getDocumentSnapshot() {
        return {
          contractVersion: CONTRACT_VERSION,
          snapshot: currentSnapshot,
        };
      },
      async commitSketch(request) {
        const existingSketch = currentSnapshot.document.sketches.find(
          (entry) => entry.sketchId === request.sketchId,
        );
        const invalidRestore =
          request.restoreRecordedSketchId === true &&
          (request.sketchId === null || existingSketch !== undefined);
        const missingOrdinaryEdit =
          request.restoreRecordedSketchId !== true &&
          request.sketchId !== null &&
          existingSketch === undefined;
        if (invalidRestore || missingOrdinaryEdit) {
          return {
            contractVersion: CONTRACT_VERSION,
            documentId: "doc_workspace",
            revisionId: currentSnapshot.document.revisionId,
            sketchId: request.sketchId ?? "sketch_invalid_restore",
            revisionState: {
              kind: "rejected" as const,
              reasonCode: invalidRestore
                ? "occ-sketch-id-collision"
                : "occ-missing-sketch",
            },
            rebuildResult: {
              kind: "skipped" as const,
              reasonCode: "validationRejected" as const,
              invalidatedTargets: [],
              diagnostics: [],
            },
            changedTargets: [],
            diagnostics: [],
          };
        }

        const revisionId = nextRevisionId();
        const sketchId = request.sketchId ?? allocateSketchId();
        issuedSketchIds.add(sketchId);
        const normalizedDefinition = normalizeDefinitionForSketchId(
          request.definition,
          sketchId,
        );
        const solvedSnapshot = solveSketchDefinitionCore({
          definition: normalizedDefinition,
          tolerances: {
            coincidence: 1e-6,
            angleRadians: 1e-6,
            minimumSegmentLength: 1e-6,
          },
          partialSolvePolicy: "failOnConflict",
        }).solvedSnapshot;
        const regions = (await regionSolver.deriveSketchRegions({
          contractVersion: CONTRACT_VERSION,
          solverSchemaVersion: SOLVER_SCHEMA_VERSION,
          requestId: "request_regions",
          documentId: "doc_workspace",
          revisionId,
          sketchId,
          definition: normalizedDefinition,
          solvedSnapshot,
          projectedReferences: [],
        })).regions;
        const sketch: SketchSnapshotRecord = {
          ownerDocumentId: "doc_workspace",
          ownerRevisionId: revisionId,
          ownerFeatureId: null,
          ownerSketchId: sketchId,
          ownerBodyId: null,
          sketchId,
          label: request.sketchLabel,
          plane: request.plane,
          sketch: {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: revisionId,
            ownerFeatureId: null,
            ownerSketchId: sketchId,
            ownerBodyId: null,
            sketchId,
            label: request.sketchLabel,
            planeSupport: request.plane.support,
            definition: normalizedDefinition,
            solvedSnapshot,
            derivedValidity: { state: "current", diagnostics: [] },
            regions,
          },
        };
        currentSnapshot = createWorkspaceSnapshot(
          revisionId,
          existingSketch
            ? currentSnapshot.document.sketches.map((entry) =>
                entry.sketchId === sketchId ? sketch : entry,
              )
            : [...currentSnapshot.document.sketches, sketch],
          currentSnapshot.document.features,
        );

        return {
          contractVersion: CONTRACT_VERSION,
          documentId: "doc_workspace",
          revisionId,
          sketchId,
          revisionState: {
            kind: "accepted" as const,
            baseRevisionId: request.baseRevisionId,
          },
          rebuildResult: {
            kind: "rebuilt" as const,
            revisionId,
            invalidatedTargets: [],
            diagnostics: [],
          },
          changedTargets: [],
          diagnostics: [],
        };
      },
      async createFeature(request) {
        const revisionId = nextRevisionId();
        const feature: FeatureSnapshotRecord = {
          ownerDocumentId: "doc_workspace",
          ownerRevisionId: revisionId,
          ownerFeatureId: "feature_extrude-1",
          ownerSketchId: null,
          ownerBodyId: null,
          featureId: "feature_extrude-1",
          label: "Extrude 1",
          suppressed: false,
          producedTargets: [],
          definition: request.definition,
        };
        currentSnapshot = createWorkspaceSnapshot(
          revisionId,
          currentSnapshot.document.sketches,
          [...currentSnapshot.document.features, feature],
        );

        return {
          contractVersion: CONTRACT_VERSION,
          documentId: "doc_workspace",
          revisionId,
          featureId: "feature_extrude-1",
          revisionState: {
            kind: "accepted" as const,
            baseRevisionId: request.baseRevisionId,
          },
          rebuildResult: {
            kind: "rebuilt" as const,
            revisionId,
            invalidatedTargets: [],
            diagnostics: [],
          },
          changedTargets: [],
          diagnostics: [],
        };
      },
      async updateFeature() {
        throw new Error("Not implemented for strict replay test.");
      },
      async deleteFeature() {
        throw new Error("Not implemented for strict replay test.");
      },
      async deleteTarget(request) {
        if (request.target.kind !== "sketch") {
          throw new Error(
            "Only sketch deletes are implemented for strict replay test.",
          );
        }

        if (
          !currentSnapshot.document.sketches.some(
            (entry) => entry.sketchId === request.target.sketchId,
          )
        ) {
          return {
            contractVersion: CONTRACT_VERSION,
            documentId: "doc_workspace",
            revisionId: currentSnapshot.document.revisionId,
            deletedTarget: request.target,
            revisionState: {
              kind: "rejected" as const,
              reasonCode: "occ-missing-sketch",
            },
            rebuildResult: {
              kind: "skipped" as const,
              reasonCode: "validationRejected" as const,
              invalidatedTargets: [],
              diagnostics: [],
            },
            changedTargets: [],
            diagnostics: [],
          };
        }

        const revisionId = nextRevisionId();
        currentSnapshot = createWorkspaceSnapshot(
          revisionId,
          currentSnapshot.document.sketches.filter(
            (entry) => entry.sketchId !== request.target.sketchId,
          ),
          currentSnapshot.document.features,
        );

        return {
          contractVersion: CONTRACT_VERSION,
          documentId: "doc_workspace",
          revisionId,
          deletedTarget: request.target,
          revisionState: {
            kind: "accepted" as const,
            baseRevisionId: request.baseRevisionId,
          },
          rebuildResult: {
            kind: "rebuilt" as const,
            revisionId,
            invalidatedTargets: [],
            diagnostics: [],
          },
          changedTargets: [request.target],
          diagnostics: [],
        };
      },
      async renameBody() {
        throw new Error("Not implemented for strict replay test.");
      },
      async reorderFeature() {
        throw new Error("Not implemented for strict replay test.");
      },
      async setFeatureCursor() {
        throw new Error("Not implemented for strict replay test.");
      },
      async addDocumentVariable() {
        throw new Error("Not implemented for strict replay test.");
      },
      async updateDocumentVariable() {
        throw new Error("Not implemented for strict replay test.");
      },
      async evaluatePreview() {
        throw new Error("Not implemented for strict replay test.");
      },
      async resolveReference() {
        throw new Error("Not implemented for strict replay test.");
      },
    };
  }

  async function testCommitSketchPersistenceNormalizesSketchIds() {
    const store = createMemoryOperationHistoryStore(
      createEmptyOperationHistory("doc_workspace"),
    );
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: store,
    });

    const result: ModelingCommitSketchResult = await unwrapModelingResult(
      service.commitSketch({
        baseRevisionId: "rev_0001",
        solverCorrelation: {
          requestId: "request_commit_history",
          projectionRequestId: "request_commit_history:project",
          validationRequestId: "request_commit_history:validate",
          solveRequestId: "request_commit_history:solve",
          regionRequestId: "request_commit_history:regions",
        },
        sketchId: null,
        sketchLabel: "History Sketch",
        plane: {
          key: "xy",
          support: {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
          frame: {
            origin: [0, 0, 0],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
            normal: [0, 0, 1],
            linearUnit: "documentLength",
            handedness: "rightHanded",
          },
        },
        definition: createDraftSketchDefinition("sketch_draft"),
      }),
    );

    expect(result.revisionState.kind, "Sketch commit should be accepted.").toBe(
      "accepted",
    );

    const savedHistory = store.savedPayloads.at(-1);
    expect(
      savedHistory,
      "Accepted commitSketch mutations should persist history.",
    ).toBeTruthy();
    const persistedEntry = savedHistory.entries[0];
    expect(
      persistedEntry?.kind,
      "Persisted history entry must remain commitSketch.",
    ).toBe("commitSketch");
    expect(
      persistedEntry?.kind === "commitSketch" &&
        persistedEntry.payload.sketchId === result.sketchId,
      "Persisted commitSketch entries must store the committed sketch id.",
    ).toBeTruthy();
    expect(
      persistedEntry?.kind === "commitSketch" &&
        !("restoreRecordedSketchId" in persistedEntry.payload),
      "Replay-only restoration intent must not be persisted in operation history.",
    ).toBeTruthy();
    expect(
      persistedEntry?.kind === "commitSketch" &&
        persistedEntry.payload.definition.points.every(
          (point) => point.target.sketchId === result.sketchId,
        ),
      "Persisted commitSketch point targets must be normalized to the committed sketch id.",
    ).toBeTruthy();
    expect(
      persistedEntry?.kind === "commitSketch" &&
        persistedEntry.payload.definition.entities.every(
          (entity) => entity.target.sketchId === result.sketchId,
        ),
      "Persisted commitSketch entity targets must be normalized to the committed sketch id.",
    ).toBeTruthy();

    const reloadedStore = createMemoryOperationHistoryStore(savedHistory);
    const loadResult = reloadedStore.load();
    expect(
      loadResult.ok,
      "Persisted commitSketch history should remain loadable after save.",
    ).toBeTruthy();
  }

  async function testLegacyCommitSketchHistoryRestores() {
    const service = createModelingService(createLegacyReplayAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: createMemoryOperationHistoryStore(
        createLegacyCommitSketchHistory(),
      ),
    });

    const restoreState = await service.getHistoryRestoreState();
    expect(
      restoreState.kind,
      "Legacy commitSketch history should still restore successfully.",
    ).toBe("restored");
    expect(
      restoreState.entriesReplayed,
      "Legacy commitSketch history should replay its single entry.",
    ).toBe(1);

    const snapshot = await service.getCurrentDocumentSnapshot();
    expect(
      snapshot.document.sketches.some(
        (entry) =>
          entry.label === "Legacy Draft Sketch" &&
          entry.sketchId === "sketch_legacy_replayed",
      ),
      "Legacy commitSketch history should rebuild the committed sketch snapshot.",
    ).toBeTruthy();
    expect(
      snapshot.document.sketches[0]?.sketch.definition.points.every(
        (point) => point.target.sketchId === "sketch_legacy_replayed",
      ),
      "Legacy commitSketch replay should normalize point targets to the committed sketch id.",
    ).toBeTruthy();
    expect(
      snapshot.document.sketches[0]?.sketch.definition.entities.every(
        (entity) => entity.target.sketchId === "sketch_legacy_replayed",
      ),
      "Legacy commitSketch replay should normalize entity targets to the committed sketch id.",
    ).toBeTruthy();
  }

  async function testRecordedSketchUuidAndDependentReferencesReplayExactly() {
    const recordedSketchId =
      "sketch_550e8400-e29b-41d4-a716-446655440000" as const;
    const draftDefinition = createDraftSketchDefinition(recordedSketchId);
    const replayRegionId = await getFirstDerivedRegionId(
      "doc_workspace",
      "rev_0002",
      recordedSketchId,
      draftDefinition,
    );
    const persistedHistory = {
      ...createEmptyOperationHistory("doc_workspace"),
      entries: [
        {
          kind: "commitSketch" as const,
          payload: {
            sketchId: recordedSketchId,
            sketchLabel: "Recorded UUID Sketch",
            plane: {
              key: "xy" as const,
              support: {
                kind: "construction" as const,
                constructionId: "construction_plane-xy" as const,
              },
              frame: {
                origin: [0, 0, 0] as const,
                xAxis: [1, 0, 0] as const,
                yAxis: [0, 1, 0] as const,
                normal: [0, 0, 1] as const,
                linearUnit: "documentLength" as const,
                handedness: "rightHanded" as const,
              },
            },
            definition: draftDefinition,
          },
        },
        createCreateFeatureHistoryEntry({
          contractVersion: "modeling-contract/v1alpha1",
          documentId: "doc_workspace",
          baseRevisionId: "rev_0002",
          definition: {
            kind: "extrude",
            featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
            parameters: {
              resultBodyType: "solid",
              profiles: [
                {
                  kind: "region",
                  sketchId: recordedSketchId,
                  regionId: replayRegionId,
                },
              ],
              startExtent: { kind: "profilePlane" },
              extent: {
                mode: "oneSide",
                end: {
                  kind: "blind",
                  direction: "positive",
                  distance: 10,
                },
              },
              operation: "newBody",
              booleanScope: { kind: "standalone" },
            },
          },
        }),
      ],
    };
    const service = createModelingService(createStrictReplayAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore:
        createMemoryOperationHistoryStore(persistedHistory),
    });

    const restoreState = await service.getHistoryRestoreState();

    expect(
      restoreState.kind,
      "Replay should restore an absent recorded UUID through explicit restore intent.",
    ).toBe("restored");
    expect(
      restoreState.entriesReplayed,
      "Replay should apply the recorded sketch before its dependent feature.",
    ).toBe(2);

    const snapshot = await service.getCurrentDocumentSnapshot();
    const restoredSketch = snapshot.document.sketches.find(
      (entry) => entry.sketchId === recordedSketchId,
    );
    expect(
      restoredSketch?.sketch.regions.some(
        (region) => region.regionId === replayRegionId,
      ),
      "Replay should derive the recorded region under the exact recorded sketch identity.",
    ).toBeTruthy();
    expect(
      restoredSketch?.sketch.definition.points.every(
        (point) => point.target.sketchId === recordedSketchId,
      ) &&
        restoredSketch.sketch.definition.entities.every(
          (entity) => entity.target.sketchId === recordedSketchId,
        ),
      "Replay should preserve exact dependent point and entity sketch references.",
    ).toBeTruthy();

    const restoredExtrude = snapshot.document.features.find(
      (entry) => entry.featureId === "feature_extrude-1",
    );
    expect(
      restoredExtrude?.definition.kind === "extrude" &&
        restoredExtrude.definition.parameters.profiles[0],
      "Replay should continue into the downstream feature after restoring the sketch.",
    ).toEqual({
      kind: "region",
      sketchId: recordedSketchId,
      regionId: replayRegionId,
    });
  }

  await testCommitSketchPersistenceNormalizesSketchIds();
  await testLegacyCommitSketchHistoryRestores();
  await testRecordedSketchUuidAndDependentReferencesReplayExactly();
});
