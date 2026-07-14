import { test, expect } from "vitest";

import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredModelDocument,
} from "@/contracts/modeling/authored-document";
import { createEmptyOperationHistory } from "@/contracts/modeling/operation-history";
import type {
  CreateFeatureRequest,
  CreateFeatureResponse,
  FeatureDefinition,
  GetDocumentSnapshotRequest,
  GetDocumentSnapshotResponse,
  ModelingDiagnostic,
} from "@/contracts/modeling/schema";
import type { GeometryAssetResolver } from "@/contracts/modeling/adapter";
import type { BodyId } from "@/contracts/shared/ids";
import {
  CONTRACT_VERSION,
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { SKETCH_SCHEMA_VERSION } from "@/contracts/sketch/schema";
import type { AppResultAsync } from "@/contracts/errors";
import { getDocumentHistoryCursorIndex } from "@/domain/modeling/document-history";
import { createMemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { createMemoryOperationHistoryStore } from "@/domain/modeling/modeling-history-persistence";
import {
  createModelingService,
  type ModelingService,
} from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createDeterministicGeometryAsset } from "@/domain/modeling/geometry-asset-test-helpers";
import type {
  DocumentRepository,
  DocumentRepositoryChangeEvent,
  DocumentRepositoryMetadata,
  DocumentRepositoryRestoreStatus,
} from "@/domain/modeling/document-repository";

test("src/domain/modeling/modeling-service-document-repository.spec.ts", async () => {
  type ExtrudeFeatureDefinition = Extract<
    FeatureDefinition,
    { kind: "extrude" }
  >;

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

  async function expectModelingError<T>(result: AppResultAsync<T>) {
    const resolved = await result;
    expect(
      resolved.isErr(),
      "Modeling result should be an error.",
    ).toBeTruthy();
    return resolved.error;
  }

  async function waitFor(condition: () => boolean, message: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (condition()) {
        return;
      }
      await Promise.resolve();
    }

    throw new Error(message);
  }

  async function getSeedExtrudeDefinition(
    service: ModelingService,
  ): Promise<ExtrudeFeatureDefinition> {
    const snapshot = await service.getCurrentDocumentSnapshot();
    const seedExtrude = snapshot.document.features.find(
      (feature) =>
        feature.featureId === "feature_extrude-1" &&
        feature.definition.kind === "extrude",
    );

    if (!seedExtrude || seedExtrude.definition.kind !== "extrude") {
      throw new Error("Seed extrude feature must exist.");
    }

    return {
      kind: "extrude",
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        ...seedExtrude.definition.parameters,
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: { kind: "blind", direction: "positive", distance: 7 },
        },
      },
    };
  }

  async function createSeedAuthoredDocument() {
    const snapshot = (
      await new MockKernelAdapter().getDocumentSnapshot({
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace",
      })
    ).snapshot;

    return createAuthoredModelDocumentFromSnapshot(snapshot);
  }

  function createInvalidOperationHistoryStore() {
    const historyStore = createMemoryOperationHistoryStore({
      ...createEmptyOperationHistory("doc_workspace"),
      entries: [
        ...Array.from({ length: 17 }, (_, index) => ({
          kind: "renameBody" as const,
          payload: {
            bodyId: "body_part-1",
            bodyLabel: `Stale History Body ${index + 1}`,
          },
        })),
        {},
      ] as never,
    });
    const clear = historyStore.clear.bind(historyStore);
    let clearCount = 0;

    historyStore.clear = () => {
      clearCount += 1;
      clear();
    };

    return {
      historyStore,
      getClearCount: () => clearCount,
    };
  }

  async function testAcceptedMutationsPersistButPreviewAndRejectedMutationsDoNot() {
    const documentRepository = createMemoryDocumentRepository();
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const definition = await getSeedExtrudeDefinition(service);

    await service.evaluatePreview({
      baseRevisionId: snapshot.document.revisionId,
      previewId: "preview_repository",
      definition,
    });
    expect(
      documentRepository.savedDocuments.length,
      "Preview evaluations should not persist authored documents.",
    ).toBe(0);

    const rejected = await expectModelingError(
      service.createFeature({
        baseRevisionId: snapshot.document.revisionId,
        definition: {
          kind: "plane",
          featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
          parameters: {
            mode: "coplanar",
            reference: {
              target: {
                kind: "construction",
                constructionId: "construction_nonexistent",
              },
            },
          },
        },
      }),
    );
    expect(rejected.code, "Invalid feature creation should be rejected.").toBe(
      "modeling/diagnostic",
    );
    expect(
      documentRepository.savedDocuments.length,
      "Rejected mutations should not persist authored documents.",
    ).toBe(0);

    const accepted = await unwrapModelingResult(
      service.createFeature({
        baseRevisionId: snapshot.document.revisionId,
        definition,
      }),
    );
    expect(
      accepted.revisionState.kind,
      "Accepted feature creation should commit.",
    ).toBe("accepted");
    expect(
      documentRepository.savedDocuments.length,
      "Accepted mutations should persist authored documents.",
    ).toBe(1);
    expect(
      documentRepository.savedDocuments[0]?.features.some(
        (feature) => feature.featureId === accepted.featureId,
      ),
      "Persisted authored documents should include the accepted feature rebuild input.",
    ).toBeTruthy();
  }

  async function testRepositoryCursorPersistenceExportsCompleteAuthoredState() {
    class AppliedOnlySnapshotAdapter extends MockKernelAdapter {
      override async getDocumentSnapshot(
        request: GetDocumentSnapshotRequest,
      ): Promise<GetDocumentSnapshotResponse> {
        const response = await super.getDocumentSnapshot(request);
        const snapshot = structuredClone(response.snapshot);
        const cursorIndex = getDocumentHistoryCursorIndex(
          snapshot.presentation.documentHistory,
          snapshot.document.cursor,
        );
        const appliedHistory =
          snapshot.document.cursor.kind === "empty"
            ? []
            : snapshot.presentation.documentHistory.slice(0, cursorIndex + 1);
        const appliedFeatureIds = new Set(
          appliedHistory.flatMap((item) =>
            item.kind === "feature" ? [item.featureId] : [],
          ),
        );
        const appliedSketchIds = new Set(
          appliedHistory.flatMap((item) =>
            item.kind === "sketch" ? [item.sketchId] : [],
          ),
        );

        snapshot.document.features = snapshot.document.features.filter(
          (feature) => appliedFeatureIds.has(feature.featureId),
        );
        snapshot.document.sketches = snapshot.document.sketches.filter(
          (sketch) => appliedSketchIds.has(sketch.sketchId),
        );
        snapshot.presentation.documentHistory = appliedHistory;

        return {
          ...response,
          snapshot,
        };
      }
    }

    const documentRepository = createMemoryDocumentRepository();
    const service = createModelingService(new AppliedOnlySnapshotAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const initial = await service.getCurrentDocumentSnapshot();
    const sourceSketch = initial.document.sketches[0];

    expect(
      sourceSketch,
      "Seed sketch should exist for repository cursor persistence coverage.",
    ).toBeTruthy();
    const secondSketch = await unwrapModelingResult(
      service.commitSketch({
        baseRevisionId: initial.document.revisionId,
        sketchId: "sketch_after_tail",
        sketchLabel: "Sketch After Tail",
        plane: sourceSketch.plane,
        solverCorrelation: {
          requestId: "request_repository_cursor_sketch",
          projectionRequestId: "request_repository_cursor_sketch:project",
          validationRequestId: "request_repository_cursor_sketch:validate",
          solveRequestId: "request_repository_cursor_sketch:solve",
          regionRequestId: "request_repository_cursor_sketch:regions",
        },
        definition: {
          schemaVersion: SKETCH_SCHEMA_VERSION,
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
      }),
    );
    expect(
      secondSketch.revisionState.kind,
      "Second sketch commit should be accepted.",
    ).toBe("accepted");

    const rollback = await unwrapModelingResult(
      service.setFeatureCursor({
        baseRevisionId: secondSketch.revisionId,
        cursor: { kind: "feature", featureId: "feature_extrude-1" },
      }),
    );
    expect(
      rollback.revisionState.kind,
      "Cursor rollback should be accepted.",
    ).toBe("accepted");

    const persisted = documentRepository.savedDocuments.at(-1);
    expect(
      persisted,
      "Accepted cursor rollback should persist an authored document.",
    ).toBeTruthy();
    expect(
      persisted.sketches.some(
        (sketch) => sketch.sketchId === "sketch_after_tail",
      ),
      "Persisted authored document should include future sketches after the cursor.",
    ).toBeTruthy();
    expect(
      persisted.features.some(
        (feature) => feature.featureId === "feature_fillet-1",
      ),
      "Persisted authored document should include future features after the cursor.",
    ).toBeTruthy();
    expect(
      persisted.featureOrder.join(">"),
      "Persisted authored document should keep the complete feature order.",
    ).toBe("feature_extrude-1>feature_fillet-1");
    expect(
      persisted.historyOrder
        ?.map((item) =>
          item.kind === "sketch" ? item.sketchId : item.featureId,
        )
        .join(">"),
      "Persisted authored document should keep the complete history order.",
    ).toBe(
      "sketch_primary>feature_extrude-1>feature_fillet-1>sketch_after_tail",
    );
    expect(
      persisted.cursor.kind === "feature" &&
        persisted.cursor.featureId === "feature_extrude-1",
      "Persisted authored document should keep the requested cursor.",
    ).toBeTruthy();
  }

  async function testRepositoryCursorMovesBackAndForthWithoutRefreshConflict() {
    const documentRepository = createMemoryDocumentRepository();
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const rollback = await unwrapModelingResult(
      service.setFeatureCursor({
        baseRevisionId: snapshot.document.revisionId,
        cursor: { kind: "feature", featureId: "feature_extrude-1" },
      }),
    );
    const forward = await unwrapModelingResult(
      service.setFeatureCursor({
        baseRevisionId: rollback.revisionId,
        cursor: { kind: "feature", featureId: "feature_fillet-1" },
      }),
    );
    const rollbackAgain = await unwrapModelingResult(
      service.setFeatureCursor({
        baseRevisionId: forward.revisionId,
        cursor: { kind: "feature", featureId: "feature_extrude-1" },
      }),
    );

    expect(
      rollback.revisionState.kind,
      "Repository-backed cursor rollback should be accepted.",
    ).toBe("accepted");
    expect(
      forward.revisionState.kind,
      "Repository-backed cursor redo should be accepted without a refresh.",
    ).toBe("accepted");
    expect(
      rollbackAgain.revisionState.kind,
      "Repository-backed repeated cursor rollback should be accepted without a refresh.",
    ).toBe("accepted");
    expect(
      documentRepository.savedDocuments.length,
      "Each accepted cursor move should persist the authored document.",
    ).toBe(3);
    expect(
      documentRepository.savedDocuments.at(-1)?.cursor.kind === "feature" &&
        documentRepository.savedDocuments.at(-1)?.cursor.featureId ===
          "feature_extrude-1",
      "The final persisted cursor should match the last requested rollback target.",
    ).toBeTruthy();
  }

  async function testRepositoryCursorMovesUseRefreshedHeadsAcrossRollbackRedoLoop() {
    const documentRepository = createMemoryDocumentRepository();
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const initial = await service.getCurrentDocumentSnapshot();
    const rollback = await unwrapModelingResult(
      service.setFeatureCursor({
        baseRevisionId: initial.document.revisionId,
        baseRepositoryHeads: initial.provenance?.repositoryHeads,
        cursor: { kind: "feature", featureId: "feature_extrude-1" },
      }),
    );
    const afterRollback = await service.getCurrentDocumentSnapshot();
    const redo = await unwrapModelingResult(
      service.setFeatureCursor({
        baseRevisionId: afterRollback.document.revisionId,
        baseRepositoryHeads: afterRollback.provenance?.repositoryHeads,
        cursor: { kind: "feature", featureId: "feature_fillet-1" },
      }),
    );
    const afterRedo = await service.getCurrentDocumentSnapshot();
    const rollbackAgain = await unwrapModelingResult(
      service.setFeatureCursor({
        baseRevisionId: afterRedo.document.revisionId,
        baseRepositoryHeads: afterRedo.provenance?.repositoryHeads,
        cursor: { kind: "feature", featureId: "feature_extrude-1" },
      }),
    );

    expect(
      rollback.revisionState.kind,
      "First rollback should be accepted against the loaded heads.",
    ).toBe("accepted");
    expect(
      redo.revisionState.kind,
      "Redo should be accepted against refreshed heads.",
    ).toBe("accepted");
    expect(
      rollbackAgain.revisionState.kind,
      "Second rollback should be accepted against refreshed heads.",
    ).toBe("accepted");
    expect(
      [
        ...rollback.diagnostics,
        ...redo.diagnostics,
        ...rollbackAgain.diagnostics,
      ].every((diagnostic) => diagnostic.code !== "repository-head-conflict"),
      "Refreshed repository heads should avoid repeated authored-document conflict diagnostics.",
    ).toBeTruthy();
    expect(
      documentRepository.savedDocuments
        .at(-1)
        ?.features.some((feature) => feature.featureId === "feature_fillet-1"),
      "Cursor rollback persistence should preserve future authored history for redo.",
    ).toBeTruthy();
  }

  async function testRepositoryRestoreHydratesFreshModelingService() {
    const documentRepository = createMemoryDocumentRepository();
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const renamed = await unwrapModelingResult(
      service.renameBody({
        baseRevisionId: snapshot.document.revisionId,
        bodyId: "body_part-1",
        bodyLabel: "Repository Restored Body",
      }),
    );
    expect(renamed.revisionState.kind, "Body rename should be accepted.").toBe(
      "accepted",
    );

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const restoredState = await restoredService.getHistoryRestoreState();
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot();
    expect(
      restoredState.kind,
      "Existing authored repository documents should restore on startup.",
    ).toBe("restored");
    expect(
      restoredSnapshot.document.bodies.find(
        (body) => body.bodyId === "body_part-1",
      )?.label,
      "Repository-authored state should hydrate the kernel snapshot before exposure.",
    ).toBe("Repository Restored Body");
  }

  async function testRepositoryRestorePreservesRepairableBrokenAuthoredDocument() {
    const repositoryDocument = await createSeedAuthoredDocument();
    const brokenExtrude = repositoryDocument.features.find(
      (feature) => feature.definition.kind === "extrude",
    );
    expect(
      brokenExtrude?.definition.kind,
      "Repository restore fixture should include an extrude feature.",
    ).toBe("extrude");
    repositoryDocument.features = repositoryDocument.features.map((feature) =>
      feature.featureId === brokenExtrude.featureId &&
      feature.definition.kind === "extrude"
        ? {
            ...feature,
            definition: {
              ...feature.definition,
              parameters: {
                ...feature.definition.parameters,
                operation: { source: "literal", value: "join" },
                booleanScope: {
                  kind: "targetBody",
                  bodyId: "body_missing_for_repair" as BodyId,
                },
              },
            },
          }
        : feature,
    );

    const documentRepository = createMemoryDocumentRepository([
      repositoryDocument,
    ]);
    const reset = documentRepository.reset.bind(documentRepository);
    let resetCount = 0;
    documentRepository.reset = async (documentId) => {
      resetCount += 1;
      return reset(documentId);
    };

    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const restoreState = await service.getHistoryRestoreState();
    const restoredSnapshot = await service.getCurrentDocumentSnapshot();

    expect(
      restoreState.kind,
      "Repairable broken authored documents should restore as authored state.",
    ).toBe("restored");
    expect(
      resetCount,
      "Repairable broken authored documents should not trigger repository reset.",
    ).toBe(0);
    expect(
      documentRepository.savedDocuments.length,
      "Repairable broken restore should not seed an empty replacement document.",
    ).toBe(0);
    expect(
      restoredSnapshot.document.features.some(
        (feature) => feature.featureId === brokenExtrude.featureId,
      ),
      "Repairable broken features should remain available in restored authored history.",
    ).toBeTruthy();
  }

  async function testRepositoryRestoreIgnoresStaleOperationHistory() {
    const historyStore = createMemoryOperationHistoryStore(
      createEmptyOperationHistory("doc_workspace"),
    );
    const historyService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
    });
    const historySnapshot = await historyService.getCurrentDocumentSnapshot();
    const historyRename = await unwrapModelingResult(
      historyService.renameBody({
        baseRevisionId: historySnapshot.document.revisionId,
        bodyId: "body_part-1",
        bodyLabel: "Stale History Body",
      }),
    );
    expect(
      historyRename.revisionState.kind,
      "History setup mutation should be accepted.",
    ).toBe("accepted");

    const repositoryDocument = await createSeedAuthoredDocument();
    repositoryDocument.bodyLabels = repositoryDocument.bodyLabels.map(
      (label) =>
        label.bodyId === "body_part-1"
          ? { ...label, label: "Repository Wins Body" }
          : label,
    );
    const documentRepository = createMemoryDocumentRepository([
      repositoryDocument,
    ]);

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
      documentRepository,
    });
    const restoreState = await restoredService.getHistoryRestoreState();
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot();
    expect(
      restoreState.kind,
      "Existing authored repository documents should restore on startup.",
    ).toBe("restored");
    expect(
      restoreState.entriesReplayed,
      "Repository restore should not replay stale operation history.",
    ).toBe(0);
    expect(
      documentRepository.savedDocuments.length,
      "Repository restore should not rewrite the restored document.",
    ).toBe(0);
    expect(
      restoredSnapshot.document.bodies.find(
        (body) => body.bodyId === "body_part-1",
      )?.label,
      "Repository restore should hydrate the authored document instead of replaying stale operation history.",
    ).toBe("Repository Wins Body");
  }

  async function testSeededRepositoryClearsInvalidOperationHistory() {
    const { historyStore, getClearCount } =
      createInvalidOperationHistoryStore();
    const documentRepository = createMemoryDocumentRepository();
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
      documentRepository,
    });

    const restoreState = await service.getHistoryRestoreState();
    expect(
      restoreState.kind,
      "Invalid stale operation history should not fail a freshly seeded repository.",
    ).toBe("empty");
    expect(
      restoreState.entriesReplayed,
      "Recovered stale history should not replay entries.",
    ).toBe(0);
    expect(
      getClearCount(),
      "Recovery should clear only the stale operation history store.",
    ).toBe(1);
    expect(
      documentRepository.savedDocuments.length,
      "Recovery should keep the seeded repository document without migration writes.",
    ).toBe(0);

    const snapshot = await service.getCurrentDocumentSnapshot();
    const renamed = await unwrapModelingResult(
      service.renameBody({
        baseRevisionId: snapshot.document.revisionId,
        bodyId: "body_part-1",
        bodyLabel: "Recovered Body",
      }),
    );

    expect(
      renamed.revisionState.kind,
      "Recovered services should continue accepting mutations.",
    ).toBe("accepted");
    expect(
      documentRepository.savedDocuments.length,
      "Recovered services should continue persisting authored documents.",
    ).toBe(1);
    expect(
      historyStore.savedPayloads.length,
      "Recovered services should append fresh operation history after clearing stale data.",
    ).toBe(1);
    expect(
      historyStore.savedPayloads[0]?.entries[0]?.kind,
      "Fresh operation history should start from the next accepted mutation.",
    ).toBe("renameBody");
  }

  async function testRestoredRepositoryLeavesInvalidOperationHistoryAlone() {
    const { historyStore, getClearCount } =
      createInvalidOperationHistoryStore();
    const repositoryDocument = await createSeedAuthoredDocument();
    repositoryDocument.bodyLabels = repositoryDocument.bodyLabels.map(
      (label) =>
        label.bodyId === "body_part-1"
          ? { ...label, label: "Repository Existing Body" }
          : label,
    );
    const documentRepository = createMemoryDocumentRepository([
      repositoryDocument,
    ]);
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
      documentRepository,
    });

    const restoreState = await service.getHistoryRestoreState();
    const restoredSnapshot = await service.getCurrentDocumentSnapshot();

    expect(
      restoreState.kind,
      "Existing authored repository documents should still ignore invalid stale history.",
    ).toBe("restored");
    expect(
      getClearCount(),
      "Existing authored repository restore should not clear ignored operation history.",
    ).toBe(0);
    expect(
      documentRepository.savedDocuments.length,
      "Existing authored repository restore should not rewrite the restored document.",
    ).toBe(0);
    expect(
      restoredSnapshot.document.bodies.find(
        (body) => body.bodyId === "body_part-1",
      )?.label,
      "Existing authored repository data should remain authoritative over invalid stale history.",
    ).toBe("Repository Existing Body");
  }

  async function testOperationHistoryMigratesOnlyWhenRepositoryIsMissing() {
    const historyStore = createMemoryOperationHistoryStore(
      createEmptyOperationHistory("doc_workspace"),
    );
    const documentRepository = createMemoryDocumentRepository();
    const firstService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
    });
    const firstSnapshot = await firstService.getCurrentDocumentSnapshot();
    const renamed = await unwrapModelingResult(
      firstService.renameBody({
        baseRevisionId: firstSnapshot.document.revisionId,
        bodyId: "body_part-1",
        bodyLabel: "Migrated Body",
      }),
    );
    expect(
      renamed.revisionState.kind,
      "History seed mutation should be accepted.",
    ).toBe("accepted");

    const migratingService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
      documentRepository,
    });
    const restoreState = await migratingService.getHistoryRestoreState();
    expect(
      restoreState.kind,
      "Valid operation history should migrate into a missing repository document.",
    ).toBe("restored");
    expect(
      documentRepository.savedDocuments.length,
      "Migration should write one authored repository document.",
    ).toBe(1);

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
      documentRepository,
    });
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot();
    expect(
      restoredSnapshot.document.bodies.find(
        (body) => body.bodyId === "body_part-1",
      )?.label,
      "Existing authored documents should be preferred over operation history after migration.",
    ).toBe("Migrated Body");
  }

  async function testSeedRepositoryRestoreReplaysOperationHistoryFallback() {
    const historyStore = createMemoryOperationHistoryStore(
      createEmptyOperationHistory("doc_workspace"),
    );
    const historyService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
    });
    const historySnapshot = await historyService.getCurrentDocumentSnapshot();
    const historyRename = await unwrapModelingResult(
      historyService.renameBody({
        baseRevisionId: historySnapshot.document.revisionId,
        bodyId: "body_part-1",
        bodyLabel: "Recovered History Body",
      }),
    );
    expect(
      historyRename.revisionState.kind,
      "History mutation should prepare a browser fallback payload.",
    ).toBe("accepted");

    const seedDocument = await createSeedAuthoredDocument();
    const documentRepository = createMemoryDocumentRepository([seedDocument]);
    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
      documentRepository,
    });
    const restoreState = await restoredService.getHistoryRestoreState();
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot();

    expect(
      restoreState.kind,
      "Seed repository restores should replay valid operation-history fallback entries.",
    ).toBe("restored");
    expect(
      restoreState.entriesReplayed,
      "Seed repository restore should replay the browser fallback operation.",
    ).toBe(1);
    expect(
      documentRepository.savedDocuments.length,
      "Recovered browser fallback history should migrate into the repository.",
    ).toBe(1);
    expect(
      restoredSnapshot.document.bodies.find(
        (body) => body.bodyId === "body_part-1",
      )?.label,
      "Restored seed repositories should recover the document from operation history before exposing snapshots.",
    ).toBe("Recovered History Body");
  }

  async function testRestoredRepositoryRestoreReplaysRepositoryBasedOperationHistoryFallback() {
    const repositoryDocument = await createSeedAuthoredDocument();
    repositoryDocument.bodyLabels = repositoryDocument.bodyLabels.map(
      (label) =>
        label.bodyId === "body_part-1"
          ? { ...label, label: "Repository Basis Body" }
          : label,
    );
    const documentRepository = createMemoryDocumentRepository([
      repositoryDocument,
    ]);
    const historyStore = createMemoryOperationHistoryStore({
      ...createEmptyOperationHistory(
        "doc_workspace",
        documentRepository.getMetadata("doc_workspace").heads,
      ),
      entries: [
        {
          kind: "renameBody",
          payload: {
            bodyId: "body_part-1",
            bodyLabel: "Recovered Repository Tail Body",
          },
        },
      ],
    });
    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
      documentRepository,
    });
    const restoreState = await restoredService.getHistoryRestoreState();
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot();

    expect(
      restoreState.kind,
      "Repository-based operation-history fallback should restore successfully.",
    ).toBe("restored");
    expect(
      restoreState.entriesReplayed,
      "Repository-based operation-history fallback should replay its pending entry.",
    ).toBe(1);
    expect(
      documentRepository.savedDocuments.length,
      "Recovered repository fallback history should migrate into the repository.",
    ).toBe(1);
    expect(
      restoredSnapshot.document.bodies.find(
        (body) => body.bodyId === "body_part-1",
      )?.label,
      "Restored repository documents should replay operation-history entries saved against the same repository heads.",
    ).toBe("Recovered Repository Tail Body");
  }

  async function testBackgroundRepositoryPersistenceDoesNotBlockAcceptedMutation() {
    const documentRepository = createMemoryDocumentRepository();
    const mutate = documentRepository.mutate.bind(documentRepository);
    let releaseMutate: (() => void) | null = null;
    let resolveMutateComplete: (() => void) | null = null;
    const mutateComplete = new Promise<void>((resolve) => {
      resolveMutateComplete = resolve;
    });
    let mutateStarted = false;
    const historyStore = createMemoryOperationHistoryStore(
      createEmptyOperationHistory("doc_workspace"),
    );
    documentRepository.mutate = async (input) => {
      mutateStarted = true;
      await new Promise<void>((resolve) => {
        releaseMutate = resolve;
      });
      const result = await mutate(input);
      resolveMutateComplete?.();
      return result;
    };
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
      documentRepository,
      documentRepositoryPersistence: "background",
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const definition = await getSeedExtrudeDefinition(service);

    const accepted = await unwrapModelingResult(
      service.createFeature({
        baseRevisionId: snapshot.document.revisionId,
        definition,
      }),
    );

    expect(
      accepted.revisionState.kind,
      "Background repository persistence should still accept the mutation.",
    ).toBe("accepted");
    expect(
      documentRepository.savedDocuments.length,
      "Accepted mutation should return before the repository write finishes.",
    ).toBe(0);
    const pendingHistory = historyStore.load();
    expect(
      pendingHistory.ok && pendingHistory.payload,
      "Background persistence should keep a browser fallback until the repository write finishes.",
    ).toBeTruthy();
    expect(
      pendingHistory.payload.baseRepositoryHeads?.join("|"),
      "Background persistence fallback should record the repository heads it extends.",
    ).toBe(snapshot.provenance?.repositoryHeads.join("|"));

    await Promise.resolve();
    expect(
      mutateStarted,
      "Background persistence should enqueue the repository write after accepting the mutation.",
    ).toBeTruthy();
    releaseMutate?.();
    await mutateComplete;
    await Promise.resolve();
    expect(
      documentRepository.savedDocuments.length,
      "Background repository persistence should still write the authored document.",
    ).toBe(1);
    const clearedHistory = historyStore.load();
    expect(
      clearedHistory.ok && clearedHistory.payload === null,
      "Completed background repository persistence should clear the browser fallback log.",
    ).toBeTruthy();
  }

  async function testBackgroundSketchCommitCompactsFallbackAuthoringOperations() {
    const documentRepository = createMemoryDocumentRepository();
    const mutate = documentRepository.mutate.bind(documentRepository);
    let releaseMutate: (() => void) | null = null;
    const historyStore = createMemoryOperationHistoryStore(
      createEmptyOperationHistory("doc_workspace"),
    );
    documentRepository.mutate = async (input) => {
      await new Promise<void>((resolve) => {
        releaseMutate = resolve;
      });
      return mutate(input);
    };
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
      documentRepository,
      documentRepositoryPersistence: "background",
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const sourceSketch = snapshot.document.sketches[0];
    expect(
      sourceSketch,
      "Seed sketch should exist for compact background sketch fallback coverage.",
    ).toBeTruthy();
    const firstPointId = sourceSketch.sketch.definition.pointIds[0];
    const firstEntityId = sourceSketch.sketch.definition.entityIds[0];
    expect(
      firstPointId && firstEntityId,
      "Seed sketch should expose graph members for compact fallback coverage.",
    ).toBeTruthy();

    const committed = await unwrapModelingResult(
      service.commitSketch({
        baseRevisionId: snapshot.document.revisionId,
        sketchId: sourceSketch.sketchId,
        sketchLabel: "Compacted Background Sketch",
        plane: sourceSketch.plane,
        solverCorrelation: {
          requestId: "request_compact_background_sketch",
          projectionRequestId: "request_compact_background_sketch:project",
          validationRequestId: "request_compact_background_sketch:validate",
          solveRequestId: "request_compact_background_sketch:solve",
          regionRequestId: "request_compact_background_sketch:regions",
        },
        definition: {
          ...sourceSketch.sketch.definition,
          authoringOperations: [
            {
              operationId: "sketch_operation_compact_background",
              label: "Compacted metadata",
              kind: "operation",
              targets: {
                created: [
                  { kind: "point", pointId: firstPointId },
                  { kind: "entity", entityId: firstEntityId },
                ],
              },
              createdGraph: {
                points: sourceSketch.sketch.definition.points.slice(0, 1),
                entities: sourceSketch.sketch.definition.entities.slice(0, 1),
              },
            },
          ],
        },
      }),
    );

    expect(
      committed.revisionState.kind,
      "Background sketch commit should still accept compact fallback payloads.",
    ).toBe("accepted");
    const pendingHistory = historyStore.load();
    expect(
      pendingHistory.ok &&
        pendingHistory.payload?.entries[0]?.kind === "commitSketch",
      "Background sketch commits should persist a fallback entry.",
    ).toBeTruthy();
    expect(
      pendingHistory.payload.entries[0].payload.definition.authoringOperations
        ?.length ?? 0,
      "Background sketch commit fallback should omit bulky sketch-local authoring operations.",
    ).toBe(0);
    releaseMutate?.();
  }

  async function testReferenceImageOperationsPersistAcrossRepositoryRestore() {
    const documentRepository = createMemoryDocumentRepository();
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const sourceSketch = snapshot.document.sketches[0];

    expect(
      sourceSketch,
      "Seed sketch should exist for reference-image persistence coverage.",
    ).toBeTruthy();
    const committed = await unwrapModelingResult(
      service.commitSketch({
        baseRevisionId: snapshot.document.revisionId,
        sketchId: "sketch_reference_image",
        sketchLabel: "Reference Image Sketch",
        plane: sourceSketch.plane,
        solverCorrelation: {
          requestId: "request_reference_image_persist",
          projectionRequestId: "request_reference_image_persist:project",
          validationRequestId: "request_reference_image_persist:validate",
          solveRequestId: "request_reference_image_persist:solve",
          regionRequestId: "request_reference_image_persist:regions",
        },
        definition: {
          schemaVersion: SKETCH_SCHEMA_VERSION,
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
          authoringOperations: [
            {
              operationId: "sketch_operation_1_reference-image",
              label: "reference.png",
              kind: "referenceImage",
              targets: {
                created: [
                  {
                    kind: "operation",
                    operationId: "sketch_operation_1_reference-image",
                  },
                ],
              },
              ownedState: {
                kind: "referenceImage",
                image: {
                  mediaType: "image/png",
                  fileName: "reference.png",
                  pixelWidth: 640,
                  pixelHeight: 480,
                  base64Data: "cG5n",
                },
                placement: {
                  center: [0, 0],
                  width: 200,
                  height: 150,
                  rotationRadians: 0,
                },
              },
            },
            {
              operationId: "sketch_operation_2_edit-reference-image",
              label: "reference-updated.png",
              kind: "edit",
              targets: {
                edited: [
                  {
                    kind: "operation",
                    operationId: "sketch_operation_1_reference-image",
                  },
                ],
              },
              ownedState: {
                kind: "referenceImage",
                image: {
                  mediaType: "image/png",
                  fileName: "reference-updated.png",
                  pixelWidth: 800,
                  pixelHeight: 600,
                  base64Data: "dXBkYXRlZA==",
                },
                placement: {
                  center: [16, -8],
                  width: 240,
                  height: 180,
                  rotationRadians: 0.35,
                },
              },
            },
          ],
        },
      }),
    );

    expect(
      committed.revisionState.kind,
      "Reference-image sketch commits should be accepted.",
    ).toBe("accepted");
    const persisted = documentRepository.savedDocuments.at(-1);
    const persistedSketch = persisted?.sketches.find(
      (sketch) => sketch.sketchId === "sketch_reference_image",
    );
    const expectedReferenceImageOperations = [
      {
        operationId: "sketch_operation_1_reference-image",
        label: "reference.png",
        kind: "referenceImage",
        targets: {
          created: [
            {
              kind: "operation",
              operationId: "sketch_operation_1_reference-image",
            },
          ],
        },
        ownedState: {
          kind: "referenceImage",
          image: {
            mediaType: "image/png",
            fileName: "reference.png",
            pixelWidth: 640,
            pixelHeight: 480,
            base64Data: "cG5n",
          },
          placement: {
            center: [0, 0],
            width: 200,
            height: 150,
            rotationRadians: 0,
          },
        },
      },
      {
        operationId: "sketch_operation_2_edit-reference-image",
        label: "reference-updated.png",
        kind: "edit",
        targets: {
          edited: [
            {
              kind: "operation",
              operationId: "sketch_operation_1_reference-image",
            },
          ],
        },
        ownedState: {
          kind: "referenceImage",
          image: {
            mediaType: "image/png",
            fileName: "reference-updated.png",
            pixelWidth: 800,
            pixelHeight: 600,
            base64Data: "dXBkYXRlZA==",
          },
          placement: {
            center: [16, -8],
            width: 240,
            height: 180,
            rotationRadians: 0.35,
          },
        },
      },
    ];

    expect(
      persistedSketch,
      "Persisted authored documents should include committed reference-image sketches.",
    ).toBeTruthy();
    expect(
      persistedSketch.definition.points.length,
      "Persisted reference-image sketches should not materialize sketch points.",
    ).toBe(0);
    expect(
      persistedSketch.definition.entities.length,
      "Persisted reference-image sketches should not materialize sketch entities.",
    ).toBe(0);
    assertReferenceImageOperationPayloads(
      persistedSketch.definition.authoringOperations,
      expectedReferenceImageOperations,
      "Persisted authored documents should keep the full inline reference-image operation payloads, including edit rows.",
    );

    const restoredRepository = createMemoryDocumentRepository(
      persisted ? [persisted] : [],
    );
    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository: restoredRepository,
    });
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot();
    const restoredSketch = restoredSnapshot.document.sketches.find(
      (sketch) => sketch.sketchId === "sketch_reference_image",
    );

    expect(
      restoredSketch,
      "Repository restore should reopen committed reference-image sketches.",
    ).toBeTruthy();
    expect(
      restoredSketch.sketch.definition.points.length,
      "Restored reference-image sketches should still avoid local points.",
    ).toBe(0);
    expect(
      restoredSketch.sketch.definition.entities.length,
      "Restored reference-image sketches should still avoid local entities.",
    ).toBe(0);
    assertReferenceImageOperationPayloads(
      restoredSketch.sketch.definition.authoringOperations,
      expectedReferenceImageOperations,
      "Repository restore should preserve the full inline reference-image operation payloads, including edit rows.",
    );
  }

  async function testBackgroundRepositoryPersistenceAdvancesFallbackTail() {
    const documentRepository = createMemoryDocumentRepository();
    const mutate = documentRepository.mutate.bind(documentRepository);
    const mutateCalls: Array<{
      release: () => void;
      complete: Promise<void>;
      resolveComplete: () => void;
    }> = [];
    const historyStore = createMemoryOperationHistoryStore(
      createEmptyOperationHistory("doc_workspace"),
    );
    documentRepository.mutate = async (input) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let resolveComplete = () => {};
      const complete = new Promise<void>((resolve) => {
        resolveComplete = resolve;
      });
      mutateCalls.push({ release, complete, resolveComplete });
      await gate;
      const result = await mutate(input);
      resolveComplete();
      return result;
    };
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
      documentRepository,
      documentRepositoryPersistence: "background",
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const first = await unwrapModelingResult(
      service.renameBody({
        baseRevisionId: snapshot.document.revisionId,
        bodyId: "body_part-1",
        bodyLabel: "First Background Body",
      }),
    );
    expect(
      first.revisionState.kind,
      "First background mutation should be accepted.",
    ).toBe("accepted");
    await waitFor(
      () => mutateCalls.length === 1,
      "First background repository write should start.",
    );

    const second = await unwrapModelingResult(
      service.renameBody({
        baseRevisionId: first.revisionId,
        bodyId: "body_part-1",
        bodyLabel: "Second Background Body",
      }),
    );
    expect(
      second.revisionState.kind,
      "Second background mutation should be accepted while the first write is pending.",
    ).toBe("accepted");

    mutateCalls[0]?.release();
    await mutateCalls[0]?.complete;
    await waitFor(
      () => mutateCalls.length === 2,
      "Second background repository write should start after the first completes.",
    );

    const pendingHistory = historyStore.load();
    expect(
      pendingHistory.ok && pendingHistory.payload,
      "Partial background writes should keep the unpersisted fallback tail.",
    ).toBeTruthy();
    expect(
      pendingHistory.payload.entries.length,
      "Partial background writes should trim only the persisted prefix.",
    ).toBe(1);
    expect(
      pendingHistory.payload.entries[0]?.kind === "renameBody" &&
        pendingHistory.payload.entries[0].payload.bodyLabel ===
          "Second Background Body",
      "Partial background writes should keep the newer pending operation.",
    ).toBeTruthy();
    expect(
      pendingHistory.payload.baseRepositoryHeads?.join("|"),
      "Partial background writes should advance the fallback basis to the repository heads that were written.",
    ).toBe(documentRepository.getMetadata("doc_workspace").heads.join("|"));

    mutateCalls[1]?.release();
    await mutateCalls[1]?.complete;
    await Promise.resolve();
    const clearedHistory = historyStore.load();
    expect(
      clearedHistory.ok && clearedHistory.payload === null,
      "Final background write should clear the fallback tail.",
    ).toBeTruthy();
  }

  async function testLocalRepositoryHeadAdvancesDoNotConflictWithCurrentRevisionMutation() {
    const documentRepository = createMemoryDocumentRepository();
    const historyStore = createMemoryOperationHistoryStore(
      createEmptyOperationHistory("doc_workspace"),
    );
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
      documentRepository,
      documentRepositoryPersistence: "background",
    });
    const initial = await service.getCurrentDocumentSnapshot();

    const renamed = await unwrapModelingResult(
      service.renameBody({
        baseRevisionId: initial.document.revisionId,
        baseRepositoryHeads: initial.provenance?.repositoryHeads,
        bodyId: "body_part-1",
        bodyLabel: "Local Background Body",
      }),
    );
    expect(
      renamed.revisionState.kind,
      "Local setup mutation should be accepted.",
    ).toBe("accepted");
    await waitFor(
      () => documentRepository.savedDocuments.length === 1,
      "Local background repository write should complete.",
    );

    const current = await service.getCurrentDocumentSnapshot();
    const definition = await getSeedExtrudeDefinition(service);
    const committed = await unwrapModelingResult(
      service.createFeature({
        baseRevisionId: current.document.revisionId,
        baseRepositoryHeads: initial.provenance?.repositoryHeads,
        definition,
      }),
    );

    expect(
      committed.revisionState.kind,
      "Mutations should not conflict with local background repository head advances.",
    ).toBe("accepted");
    expect(
      committed.diagnostics.every(
        (diagnostic) => diagnostic.code !== "repository-head-conflict",
      ),
      "Mutations after local background writes should not report repository head conflicts.",
    ).toBeTruthy();
  }

  async function testMigrationWriteFailureResetsSeededRepositoryForRetry() {
    const historyStore = createMemoryOperationHistoryStore(
      createEmptyOperationHistory("doc_workspace"),
    );
    const historyService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: historyStore,
    });
    const snapshot = await historyService.getCurrentDocumentSnapshot();
    const renamed = await unwrapModelingResult(
      historyService.renameBody({
        baseRevisionId: snapshot.document.revisionId,
        bodyId: "body_part-1",
        bodyLabel: "Retry Migrated Body",
      }),
    );
    expect(
      renamed.revisionState.kind,
      "History mutation should prepare a migration payload.",
    ).toBe("accepted");

    const documentRepository = createMemoryDocumentRepository();
    const mutate = documentRepository.mutate.bind(documentRepository);
    const reset = documentRepository.reset.bind(documentRepository);
    let failNextMutate = true;
    let resetCount = 0;

    documentRepository.mutate = async (input) => {
      if (!failNextMutate) {
        return mutate(input);
      }

      failNextMutate = false;
      return {
        ok: false,
        status: {
          kind: "failed",
          documentId: input.documentId,
          diagnostic: {
            reasonCode: "automerge-write-failed",
            message: "Migration write failed.",
          },
        },
      };
    };
    documentRepository.reset = async (documentId) => {
      resetCount += 1;
      return reset(documentId);
    };

    const failedMigrationService = createModelingService(
      new MockKernelAdapter(),
      {
        currentDocumentId: "doc_workspace",
        operationHistoryStore: historyStore,
        documentRepository,
      },
    );
    const failedRestore = await failedMigrationService.getHistoryRestoreState();
    expect(
      failedRestore.kind,
      "Migration write failures should surface as restore failures.",
    ).toBe("failed");
    expect(
      resetCount,
      "Migration write failures should reset the seeded repository document.",
    ).toBe(1);

    const retriedMigrationService = createModelingService(
      new MockKernelAdapter(),
      {
        currentDocumentId: "doc_workspace",
        operationHistoryStore: historyStore,
        documentRepository,
      },
    );
    const retriedRestore =
      await retriedMigrationService.getHistoryRestoreState();
    expect(
      retriedRestore.kind,
      "Resetting the seed should let the next startup retry migration.",
    ).toBe("restored");
    expect(
      documentRepository.savedDocuments.length,
      "Retried migration should write the authored repository document.",
    ).toBe(1);
  }

  async function testInvalidRepositoryDocumentBlocksFutureWrites() {
    const seedDocument = await createSeedAuthoredDocument();
    const invalidDocument: AuthoredModelDocument = {
      ...seedDocument,
      schemaVersion:
        "authored-model-document/v9" as AuthoredModelDocument["schemaVersion"],
    };
    const documentRepository = createMemoryDocumentRepository([
      invalidDocument,
    ]);
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });

    const restoreState = await service.getHistoryRestoreState();
    expect(
      restoreState.kind,
      "Unsupported repository documents should surface restore failure.",
    ).toBe("failed");
    expect(
      restoreState.diagnostics[0]?.reasonCode,
      "Unsupported repository documents should preserve the schema diagnostic.",
    ).toBe("unsupported-schema-version");

    const snapshot = await service.getCurrentDocumentSnapshot();
    const renamed = await unwrapModelingResult(
      service.renameBody({
        baseRevisionId: snapshot.document.revisionId,
        bodyId: "body_part-1",
        bodyLabel: "Must Not Overwrite Unsupported Document",
      }),
    );
    expect(
      renamed.revisionState.kind,
      "The active seed adapter may still accept local mutations.",
    ).toBe("accepted");
    expect(
      documentRepository.savedDocuments.length,
      "Restore failures should block later repository writes from the seed adapter.",
    ).toBe(0);
    expect(
      renamed.diagnostics.some(
        (diagnostic) => diagnostic.code === "unsupported-schema-version",
      ),
      "Blocked repository writes should keep surfacing the restore diagnostic.",
    ).toBeTruthy();
  }

  async function testPeerRepositoryChangesRefreshSnapshotsAndStaleMutationsConflict() {
    const documentRepository = createMemoryDocumentRepository();
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const definition = await getSeedExtrudeDefinition(service);
    const peerDocument = createAuthoredModelDocumentFromSnapshot(snapshot);
    peerDocument.revisionId = "rev_9999";
    peerDocument.bodyLabels = peerDocument.bodyLabels.map((label) =>
      label.bodyId === "body_part-1"
        ? { ...label, label: "Peer Synced Body" }
        : label,
    );

    let peerEventCount = 0;
    const unsubscribe = service.subscribeToDocumentChanges((event) => {
      if (event.metadata.source === "peer") {
        peerEventCount += 1;
      }
    });
    const peerResult =
      await documentRepository.receivePeerDocument(peerDocument);
    expect(
      peerResult.ok,
      "Test peer document should be accepted by the repository.",
    ).toBeTruthy();

    const staleMutation = await expectModelingError(
      service.createFeature({
        baseRevisionId: snapshot.document.revisionId,
        baseRepositoryHeads: snapshot.provenance?.repositoryHeads,
        definition,
      }),
    );
    expect(
      staleMutation.code,
      "Mutations against a peer-superseded snapshot should conflict.",
    ).toBe("modeling/diagnostic");
    expect(
      staleMutation.context.some(
        (entry) =>
          entry.key === "diagnosticCodes" &&
          typeof entry.value === "string" &&
          entry.value.includes("repository-head-conflict"),
      ),
      "Stale repository heads should be reported with a stable diagnostic code.",
    ).toBeTruthy();

    const refreshed = await service.getCurrentDocumentSnapshot();
    expect(
      peerEventCount,
      "Modeling service subscribers should receive peer repository events.",
    ).toBe(1);
    expect(
      refreshed.provenance?.repositorySource,
      "Peer-refreshed snapshots should carry peer provenance.",
    ).toBe("peer");
    expect(
      refreshed.document.bodies.find((body) => body.bodyId === "body_part-1")
        ?.label,
      "Peer repository changes should hydrate the modeling snapshot through the service.",
    ).toBe("Peer Synced Body");
    const accepted = await unwrapModelingResult(
      service.createFeature({
        baseRevisionId: refreshed.document.revisionId,
        baseRepositoryHeads: refreshed.provenance?.repositoryHeads,
        definition,
      }),
    );
    expect(
      accepted.revisionState.kind,
      "Fresh repository heads should allow the mutation.",
    ).toBe("accepted");
    unsubscribe();
  }

  async function testPeerRepositoryChangesQueuedDuringInitialRestore() {
    const seedDocument = await createSeedAuthoredDocument();
    const peerDocument = structuredClone(seedDocument);
    peerDocument.revisionId = "rev_9999";
    peerDocument.bodyLabels = peerDocument.bodyLabels.map((label) =>
      label.bodyId === "body_part-1"
        ? { ...label, label: "Peer During Restore Body" }
        : label,
    );

    let emitRepositoryEvent:
      | ((event: DocumentRepositoryChangeEvent) => void)
      | null = null;
    let resolveLoad:
      | ((result: Awaited<ReturnType<DocumentRepository["load"]>>) => void)
      | null = null;
    const pendingLoad = new Promise<
      Awaited<ReturnType<DocumentRepository["load"]>>
    >((resolve) => {
      resolveLoad = resolve;
    });
    const seedStatus: DocumentRepositoryRestoreStatus = {
      kind: "seeded",
      documentId: "doc_workspace",
    };
    const seedMetadata: DocumentRepositoryMetadata = {
      documentId: "doc_workspace",
      heads: ["head_seed"],
      source: "seed",
    };
    const peerStatus: DocumentRepositoryRestoreStatus = {
      kind: "restored",
      documentId: "doc_workspace",
    };
    const peerMetadata: DocumentRepositoryMetadata = {
      documentId: "doc_workspace",
      heads: ["head_peer"],
      source: "peer",
    };
    const documentRepository: DocumentRepository = {
      async load() {
        return pendingLoad;
      },
      async mutate() {
        throw new Error("Unexpected mutate call in queued peer restore test.");
      },
      subscribe(_documentId, listener) {
        emitRepositoryEvent = listener;
        return () => {
          emitRepositoryEvent = null;
        };
      },
      async reset(documentId) {
        return { kind: "reset", documentId };
      },
      getRestoreStatus(documentId) {
        return { kind: "pending", documentId };
      },
      getMetadata(documentId) {
        return { documentId, heads: [], source: "restore" };
      },
    };

    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });

    let peerEventCount = 0;
    service.subscribeToDocumentChanges((event) => {
      if (event.metadata.source === "peer") {
        peerEventCount += 1;
      }
    });

    emitRepositoryEvent?.({
      document: peerDocument,
      status: peerStatus,
      metadata: peerMetadata,
      diagnostics: [],
      assetAvailability: [],
    });
    resolveLoad?.({
      ok: true,
      document: seedDocument,
      status: seedStatus,
      metadata: seedMetadata,
      diagnostics: [],
      assetAvailability: [],
    });

    const snapshot = await service.getCurrentDocumentSnapshot();

    expect(
      peerEventCount,
      "Peer repository changes that arrive during initial restore should be replayed after restore completes.",
    ).toBe(1);
    expect(
      snapshot.document.bodies.find((body) => body.bodyId === "body_part-1")
        ?.label,
      "Initial restore should not drop queued peer-authored document updates.",
    ).toBe("Peer During Restore Body");
    expect(
      snapshot.provenance?.repositorySource,
      "Snapshots should report peer provenance after a queued peer-authored update wins over the initial seed restore.",
    ).toBe("peer");
  }

  async function testLateDocumentChangeSubscribersReplayLatestPeerEvent() {
    const documentRepository = createMemoryDocumentRepository();
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const peerDocument = createAuthoredModelDocumentFromSnapshot(snapshot);
    peerDocument.revisionId = "rev_9999";
    peerDocument.bodyLabels = peerDocument.bodyLabels.map((label) =>
      label.bodyId === "body_part-1"
        ? { ...label, label: "Late Subscriber Peer Body" }
        : label,
    );

    const peerResult =
      await documentRepository.receivePeerDocument(peerDocument);
    expect(
      peerResult.ok,
      "Late-subscriber peer document should be accepted by the repository.",
    ).toBeTruthy();
    const refreshed = await service.getCurrentDocumentSnapshot();
    expect(
      refreshed.document.bodies.find((body) => body.bodyId === "body_part-1")
        ?.label,
      "Peer restore should finish before the late-subscriber replay assertion runs.",
    ).toBe("Late Subscriber Peer Body");

    let replayedPeerEvents = 0;
    const unsubscribe = service.subscribeToDocumentChanges((event) => {
      if (event.metadata.source === "peer") {
        replayedPeerEvents += 1;
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      replayedPeerEvents,
      "Late modeling-service document-change subscribers should receive the latest peer event immediately.",
    ).toBe(1);
    unsubscribe();
  }

  async function testInFlightRepositoryHeadConflictSkipsPersistenceAndHistory() {
    const documentRepository = createMemoryDocumentRepository();
    const historyStore = createMemoryOperationHistoryStore(
      createEmptyOperationHistory("doc_workspace"),
    );
    let publishPeerDocument = async () => {};
    class PeerDuringAcceptedMutationAdapter extends MockKernelAdapter {
      override async createFeature(
        request: CreateFeatureRequest,
      ): Promise<CreateFeatureResponse> {
        const response = await super.createFeature(request);
        await publishPeerDocument();
        return response;
      }
    }
    const service = createModelingService(
      new PeerDuringAcceptedMutationAdapter(),
      {
        currentDocumentId: "doc_workspace",
        operationHistoryStore: historyStore,
        documentRepository,
      },
    );
    const snapshot = await service.getCurrentDocumentSnapshot();
    const definition = await getSeedExtrudeDefinition(service);
    const peerDocument = createAuthoredModelDocumentFromSnapshot(snapshot);
    peerDocument.revisionId = "rev_9999";
    peerDocument.bodyLabels = peerDocument.bodyLabels.map((label) =>
      label.bodyId === "body_part-1"
        ? { ...label, label: "In-flight Peer Body" }
        : label,
    );
    publishPeerDocument = async () => {
      publishPeerDocument = async () => {};
      const peerResult =
        await documentRepository.receivePeerDocument(peerDocument);
      expect(
        peerResult.ok,
        "In-flight peer document should be accepted by the repository.",
      ).toBeTruthy();
    };

    const result = await expectModelingError(
      service.createFeature({
        baseRevisionId: snapshot.document.revisionId,
        baseRepositoryHeads: snapshot.provenance?.repositoryHeads,
        definition,
      }),
    );
    expect(
      result.code,
      "In-flight repository head changes should convert accepted mutations to conflicts.",
    ).toBe("modeling/diagnostic");
    expect(
      result.context.some(
        (entry) =>
          entry.key === "diagnosticCodes" &&
          typeof entry.value === "string" &&
          entry.value.includes("repository-head-conflict"),
      ),
      "In-flight repository head conflicts should retain a stable diagnostic.",
    ).toBeTruthy();
    expect(
      documentRepository.savedDocuments.length,
      "Repository head conflicts should not persist stale authored documents.",
    ).toBe(0);
    expect(
      historyStore.savedPayloads.length,
      "Repository head conflicts should not append operation history.",
    ).toBe(0);

    const refreshed = await service.getCurrentDocumentSnapshot();
    expect(
      refreshed.document.bodies.find((body) => body.bodyId === "body_part-1")
        ?.label,
      "Repository head conflict handling should leave the service on the peer-authored snapshot.",
    ).toBe("In-flight Peer Body");
  }

  async function testPackagedAssetImportStoresAssetsBeforeRestore() {
    const documentRepository = createMemoryDocumentRepository();

    class AssetResolvingRestoreAdapter extends MockKernelAdapter {
      sawAssetBytes = false;

      override async restoreAuthoredModelDocument(
        document: AuthoredModelDocument,
        diagnostics: readonly ModelingDiagnostic[] = [],
        assetResolver?: GeometryAssetResolver,
      ) {
        const asset = document.assets.records[0];
        if (asset) {
          const bytes = await assetResolver?.getGeometryAssetBytes(asset.hash);
          this.sawAssetBytes = bytes?.byteLength === asset.byteLength;
        }

        await super.restoreAuthoredModelDocument(document, diagnostics);
      }
    }
    const adapter = new AssetResolvingRestoreAdapter();
    const service = createModelingService(adapter, {
      currentDocumentId: "doc_workspace",
      documentRepository,
    });
    const snapshot = await service.getCurrentDocumentSnapshot();
    const document = createAuthoredModelDocumentFromSnapshot(snapshot);
    const asset = await createDeterministicGeometryAsset({
      ownerFeatureIds: [document.features[0]!.featureId],
    });
    document.assets = {
      schemaVersion: "geometry-asset-manifest/v1alpha1",
      records: [asset.asset],
    };

    const result = await service.importDocument({ document });

    expect(
      result.ok,
      "JSON import should accept authored documents with embedded geometry data.",
    ).toBeTruthy();
    expect(
      adapter.sawAssetBytes,
      "Imported asset bytes should be stored before adapter restore resolves assets.",
    ).toBeTruthy();
    expect(
      await documentRepository.getGeometryAssetRecord(asset.asset),
      "Imported asset bytes should remain available from the repository after restore.",
    ).not.toBe(null);
    expect(
      (await adapter.exportAuthoredModelDocument(document.documentId)).assets
        .records[0]?.hash,
      "Adapter authored exports should preserve restored geometry asset manifests.",
    ).toBe(asset.asset.hash);
    const exportResult = await service.exportCurrentDocument();
    expect(
      typeof exportResult.payload,
      "Current document export should serialize documents with geometry assets as JSON.",
    ).toBe("string");
    expect(
      (JSON.parse(exportResult.payload) as AuthoredModelDocument).assets
        .records[0]?.data?.kind,
      "Current document export should include translated Cadara B-rep geometry inside the cadara JSON.",
    ).toBe("cadaraBrep");

    const snapshotAfterImport = await service.getCurrentDocumentSnapshot();
    const rename = await unwrapModelingResult(
      service.renameBody({
        baseRevisionId: snapshotAfterImport.document.revisionId,
        bodyId: "body_part-1",
        bodyLabel: "Asset Body",
      }),
    );
    expect(
      rename.revisionState.kind,
      "Post-import authored mutations should still be accepted.",
    ).toBe("accepted");
    expect(
      documentRepository.savedDocuments.at(-1)?.assets.records[0]?.hash,
      "Post-import repository mutations should not drop restored geometry asset manifests.",
    ).toBe(asset.asset.hash);
  }

  async function testFeatureSuppressionMutationsPersistAndSkipNoOps() {
    const documentRepository = createMemoryDocumentRepository();
    const historyStore = createMemoryOperationHistoryStore();
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
      operationHistoryStore: historyStore,
    });
    const initial = await service.getCurrentDocumentSnapshot();
    const feature = initial.document.features.find(
      (entry) => entry.featureId === "feature_extrude-1",
    );
    expect(
      feature?.suppressed,
      "Seed feature snapshots should start with explicit unsuppressed state.",
    ).toBeFalsy();

    const suppressed = await unwrapModelingResult(
      service.setFeatureSuppression({
        baseRevisionId: initial.document.revisionId,
        featureId: "feature_extrude-1",
        suppressed: true,
      }),
    );
    expect(
      suppressed.revisionState.kind,
      "Feature suppression should be accepted against the current revision.",
    ).toBe("accepted");
    expect(
      suppressed.changedTargets.some(
        (target) =>
          target.kind === "feature" && target.featureId === "feature_extrude-1",
      ),
      "Suppression should report the feature row as changed.",
    ).toBeTruthy();

    const suppressedSnapshot = await service.getCurrentDocumentSnapshot();
    const suppressedFeature = suppressedSnapshot.document.features.find(
      (entry) => entry.featureId === "feature_extrude-1",
    );
    expect(
      suppressedFeature?.suppressed,
      "Accepted suppression should refresh the snapshot feature row.",
    ).toBeTruthy();
    expect(
      suppressedFeature?.producedTargets.length,
      "Suppressed feature snapshots should not expose bypassed produced targets.",
    ).toBe(0);
    expect(
      suppressedSnapshot.presentation.documentHistory.find(
        (item) =>
          item.kind === "feature" && item.featureId === "feature_extrude-1",
      )?.suppressed,
      "Document history rows should expose suppressed feature state for presentation.",
    ).toBeTruthy();
    expect(
      historyStore.savedPayloads.at(-1)?.entries.at(-1)?.kind,
      "Accepted suppression should append a durable operation-history entry.",
    ).toBe("setFeatureSuppression");

    const savedHistoryCount =
      historyStore.savedPayloads.at(-1)?.entries.length ?? 0;
    await expectModelingError(
      service.setFeatureSuppression({
        baseRevisionId: suppressedSnapshot.document.revisionId,
        featureId: "feature_extrude-1",
        suppressed: true,
      }),
    );
    expect(
      historyStore.savedPayloads.at(-1)?.entries.length ?? 0,
      "No-op suppression requests should not append durable operation history.",
    ).toBe(savedHistoryCount);

    const unsuppressed = await unwrapModelingResult(
      service.setFeatureSuppression({
        baseRevisionId: suppressedSnapshot.document.revisionId,
        featureId: "feature_extrude-1",
        suppressed: false,
      }),
    );
    expect(
      unsuppressed.revisionState.kind,
      "Unsuppression should be accepted as a document mutation.",
    ).toBe("accepted");

    const restored = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository,
      operationHistoryStore: historyStore,
    });
    const restoredSnapshot = await restored.getCurrentDocumentSnapshot();
    expect(
      restoredSnapshot.document.features.find(
        (entry) => entry.featureId === "feature_extrude-1",
      )?.suppressed,
      "Repository restore plus operation-history replay should preserve the final unsuppressed state.",
    ).toBeFalsy();
  }

  await testAcceptedMutationsPersistButPreviewAndRejectedMutationsDoNot();
  await testRepositoryCursorPersistenceExportsCompleteAuthoredState();
  await testRepositoryCursorMovesBackAndForthWithoutRefreshConflict();
  await testRepositoryCursorMovesUseRefreshedHeadsAcrossRollbackRedoLoop();
  await testRepositoryRestoreHydratesFreshModelingService();
  await testRepositoryRestorePreservesRepairableBrokenAuthoredDocument();
  await testRepositoryRestoreIgnoresStaleOperationHistory();
  await testSeededRepositoryClearsInvalidOperationHistory();
  await testRestoredRepositoryLeavesInvalidOperationHistoryAlone();
  await testOperationHistoryMigratesOnlyWhenRepositoryIsMissing();
  await testSeedRepositoryRestoreReplaysOperationHistoryFallback();
  await testRestoredRepositoryRestoreReplaysRepositoryBasedOperationHistoryFallback();
  await testBackgroundRepositoryPersistenceDoesNotBlockAcceptedMutation();
  await testBackgroundSketchCommitCompactsFallbackAuthoringOperations();
  await testReferenceImageOperationsPersistAcrossRepositoryRestore();
  await testBackgroundRepositoryPersistenceAdvancesFallbackTail();
  await testLocalRepositoryHeadAdvancesDoNotConflictWithCurrentRevisionMutation();
  await testMigrationWriteFailureResetsSeededRepositoryForRetry();
  await testInvalidRepositoryDocumentBlocksFutureWrites();
  await testPeerRepositoryChangesRefreshSnapshotsAndStaleMutationsConflict();
  await testPeerRepositoryChangesQueuedDuringInitialRestore();
  await testLateDocumentChangeSubscribersReplayLatestPeerEvent();
  await testInFlightRepositoryHeadConflictSkipsPersistenceAndHistory();
  await testPackagedAssetImportStoresAssetsBeforeRestore();
  await testFeatureSuppressionMutationsPersistAndSkipNoOps();
});

function assertReferenceImageOperationPayloads(
  actual: unknown,
  expected: unknown,
  message: string,
): asserts actual {
  const normalize = (value: unknown) =>
    JSON.stringify(value, (key, fieldValue) =>
      key === "calibration" ? undefined : fieldValue,
    );

  if (normalize(actual) !== normalize(expected)) {
    throw new Error(message);
  }
}
