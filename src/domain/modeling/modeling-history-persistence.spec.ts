import { test, expect } from "vitest";
import { createEmptyOperationHistory } from "@/contracts/modeling/operation-history";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import type { AppResultAsync } from "@/contracts/errors";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import {
  createModelingService,
  type ModelingService,
} from "@/domain/modeling/modeling-service";
import { evaluateDocumentVariableExpressions } from "@/domain/modeling/document-variable-expressions";
import { createMemoryOperationHistoryStore } from "@/domain/modeling/modeling-history-persistence";
import { getAutoHiddenSketchTargetKeys } from "@/domain/editor/visibility";

test("src/domain/modeling/modeling-history-persistence.spec.ts", async () => {
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
          end: {
            kind: "blind",
            direction: "positive",
            distance: { source: "literal", value: 9 },
          },
        },
      },
    };
  }

  async function createServiceWithStore(
    initialHistory = createEmptyOperationHistory("doc_workspace"),
  ) {
    const store = createMemoryOperationHistoryStore(initialHistory);
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: store,
    });

    return { service, store };
  }

  async function testOnlyCommittedMutationsAreStored() {
    const { service, store } = await createServiceWithStore();
    const snapshot = await service.getCurrentDocumentSnapshot();
    const definition = await getSeedExtrudeDefinition(service);

    await service.evaluatePreview({
      baseRevisionId: snapshot.document.revisionId,
      previewId: "preview_history",
      definition,
    });

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
    expect(
      rejected.code,
      "A plane create whose construction reference does not resolve should be rejected.",
    ).toBe("modeling/diagnostic");

    const accepted = await unwrapModelingResult(
      service.createFeature({
        baseRevisionId: snapshot.document.revisionId,
        definition,
      }),
    );

    expect(
      accepted.revisionState.kind,
      "Valid feature create should commit.",
    ).toBe("accepted");
    expect(
      store.savedPayloads.length,
      "Only accepted mutations should write operation history.",
    ).toBe(1);
    expect(
      store.savedPayloads[0]?.entries.length,
      "Exactly one operation should be stored.",
    ).toBe(1);
    expect(
      store.savedPayloads[0]?.entries[0]?.kind,
      "Stored operation kind should match the committed mutation.",
    ).toBe("createFeature");
  }

  async function testPersistedHistoryReplaysSketchAndFeatureMutations() {
    const { service, store } = await createServiceWithStore();
    const before = await service.getCurrentDocumentSnapshot();
    const seedSketch = before.document.sketches[0];
    expect(seedSketch, "Seed sketch must exist.").toBeTruthy();

    const sketch = await unwrapModelingResult(
      service.commitSketch({
        baseRevisionId: before.document.revisionId,
        solverCorrelation: {
          requestId: "request_history_commit",
          projectionRequestId: "request_history_commit:project",
          validationRequestId: "request_history_commit:validate",
          solveRequestId: "request_history_commit:solve",
          regionRequestId: "request_history_commit:regions",
        },
        sketchId: "sketch_history",
        sketchLabel: "History Sketch",
        plane: seedSketch.plane,
        definition: seedSketch.sketch.definition,
      }),
    );
    expect(
      sketch.revisionState.kind,
      "Sketch commit should be stored for replay.",
    ).toBe("accepted");

    const renamedSketch = await unwrapModelingResult(
      service.commitSketch({
        baseRevisionId: sketch.revisionId,
        solverCorrelation: {
          requestId: "request_history_rename_sketch",
          projectionRequestId: "request_history_rename_sketch:project",
          validationRequestId: "request_history_rename_sketch:validate",
          solveRequestId: "request_history_rename_sketch:solve",
          regionRequestId: "request_history_rename_sketch:regions",
        },
        sketchId: "sketch_history",
        sketchLabel: "Renamed History Sketch",
        plane: seedSketch.plane,
        definition: seedSketch.sketch.definition,
      }),
    );
    expect(
      renamedSketch.revisionState.kind,
      "Sketch rename should be stored for replay.",
    ).toBe("accepted");

    const definition = await getSeedExtrudeDefinition(service);
    const created = await unwrapModelingResult(
      service.createFeature({
        baseRevisionId: renamedSketch.revisionId,
        definition,
      }),
    );
    expect(
      created.revisionState.kind,
      "Feature create should be stored for replay.",
    ).toBe("accepted");

    const updated = await unwrapModelingResult(
      service.updateFeature({
        baseRevisionId: created.revisionId,
        featureId: created.featureId,
        featureLabel: "Renamed Extrude",
        definition: {
          ...definition,
          parameters: {
            ...definition.parameters,
            extent: {
              mode: "oneSide",
              end: {
                kind: "blind",
                direction: "positive",
                distance: { source: "literal", value: 12 },
              },
            },
          },
        },
      }),
    );
    expect(
      updated.revisionState.kind,
      "Feature update should be stored for replay.",
    ).toBe("accepted");

    const reordered = await unwrapModelingResult(
      service.reorderFeature({
        baseRevisionId: updated.revisionId,
        featureId: created.featureId,
        beforeFeatureId: "feature_extrude-1",
      }),
    );
    expect(
      reordered.revisionState.kind,
      "Feature reorder should be stored for replay.",
    ).toBe("accepted");

    const documentHistoryReordered = await unwrapModelingResult(
      service.reorderDocumentHistory({
        baseRevisionId: reordered.revisionId,
        item: { kind: "feature", featureId: created.featureId },
        beforeItem: { kind: "sketch", sketchId: "sketch_history" },
      }),
    );
    expect(
      documentHistoryReordered.revisionState.kind,
      "Mixed document history reorder should be stored for replay.",
    ).toBe("accepted");

    const cursor = await unwrapModelingResult(
      service.setFeatureCursor({
        baseRevisionId: documentHistoryReordered.revisionId,
        cursor: { kind: "feature", featureId: "feature_extrude-1" },
      }),
    );
    expect(
      cursor.revisionState.kind,
      "Feature cursor rollback should be stored for replay.",
    ).toBe("accepted");

    const renamedBody = await unwrapModelingResult(
      service.renameBody({
        baseRevisionId: cursor.revisionId,
        bodyId: "body_part-1",
        bodyLabel: "Renamed Part",
      }),
    );
    expect(
      renamedBody.revisionState.kind,
      "Body rename should be stored for replay.",
    ).toBe("accepted");

    const originalSnapshot = await service.getCurrentDocumentSnapshot();
    const finalHistory = store.savedPayloads.at(-1);
    expect(
      finalHistory,
      "Committed mutations should save a final history payload.",
    ).toBeTruthy();

    const restoredStore = createMemoryOperationHistoryStore(finalHistory);
    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: restoredStore,
    });
    const restoreState = await restoredService.getHistoryRestoreState();
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot();
    const originalAutoHiddenSketchTargetKeys =
      getAutoHiddenSketchTargetKeys(originalSnapshot);
    const restoredAutoHiddenSketchTargetKeys =
      getAutoHiddenSketchTargetKeys(restoredSnapshot);

    expect(
      restoreState.kind,
      "Valid persisted history should restore explicitly.",
    ).toBe("restored");
    expect(
      restoreState.entriesReplayed,
      "Restore should replay every entry in order.",
    ).toBe(finalHistory.entries.length);
    expect(
      restoredSnapshot.document.sketches.some(
        (entry) => entry.sketchId === "sketch_history",
      ),
      "Replay should rebuild persisted sketches.",
    ).toBeTruthy();
    expect(
      originalAutoHiddenSketchTargetKeys["sketch:sketch_primary"] === true &&
        restoredAutoHiddenSketchTargetKeys["sketch:sketch_primary"] === true,
      "Replay should auto-hide the same consumed committed sketch rows after rebuild.",
    ).toBeTruthy();
    expect(
      Object.keys(restoredAutoHiddenSketchTargetKeys).join(","),
      "Replay should preserve the derived consumed-sketch auto-hide set.",
    ).toBe(Object.keys(originalAutoHiddenSketchTargetKeys).join(","));
    expect(
      restoredSnapshot.document.features
        .map((feature) => feature.featureId)
        .join(","),
      "Replay should preserve feature order.",
    ).toBe(
      originalSnapshot.document.features
        .map((feature) => feature.featureId)
        .join(","),
    );
    expect(
      finalHistory.entries.some(
        (entry) => entry.kind === "reorderDocumentHistory",
      ),
      "Accepted mixed document history reorders should be persisted.",
    ).toBeTruthy();
    expect(
      restoredSnapshot.presentation.documentHistory
        .map((item) =>
          item.kind === "sketch" ? item.sketchId : item.featureId,
        )
        .join(","),
      "Replay should preserve mixed sketch and feature document history order.",
    ).toBe(
      originalSnapshot.presentation.documentHistory
        .map((item) =>
          item.kind === "sketch" ? item.sketchId : item.featureId,
        )
        .join(","),
    );
    expect(
      restoredSnapshot.document.features.find(
        (feature) => feature.featureId === created.featureId,
      )?.definition.kind,
      "Replay should rebuild persisted feature definitions.",
    ).toBe("extrude");
    expect(
      originalSnapshot.document.features.find(
        (feature) => feature.featureId === created.featureId,
      )?.label === "Renamed Extrude" &&
        restoredSnapshot.document.features.find(
          (feature) => feature.featureId === created.featureId,
        )?.label === "Renamed Extrude",
      "Replay should preserve persisted feature rename labels.",
    ).toBeTruthy();
    expect(
      originalSnapshot.document.sketches.find(
        (entry) => entry.sketchId === "sketch_history",
      )?.label === "Renamed History Sketch" &&
        restoredSnapshot.document.sketches.find(
          (entry) => entry.sketchId === "sketch_history",
        )?.label === "Renamed History Sketch",
      "Replay should preserve persisted sketch rename labels.",
    ).toBeTruthy();
    expect(
      originalSnapshot.document.bodies.find(
        (entry) => entry.bodyId === "body_part-1",
      )?.label === "Renamed Part" &&
        restoredSnapshot.document.bodies.find(
          (entry) => entry.bodyId === "body_part-1",
        )?.label === "Renamed Part" &&
        restoredSnapshot.presentation.objects.find(
          (entry) =>
            entry.target.kind === "body" &&
            entry.target.bodyId === "body_part-1",
        )?.label === "Renamed Part",
      "Replay should preserve persisted body rename labels in body and object records.",
    ).toBeTruthy();
    expect(
      restoredSnapshot.document.cursor.kind ===
        originalSnapshot.document.cursor.kind &&
        restoredSnapshot.document.cursor.kind === "feature" &&
        originalSnapshot.document.cursor.kind === "feature" &&
        restoredSnapshot.document.cursor.featureId ===
          originalSnapshot.document.cursor.featureId,
      "Replay should preserve persisted document cursor state.",
    ).toBeTruthy();
  }

  async function testDeleteFeatureReplayMatchesFinalState() {
    const { service, store } = await createServiceWithStore();
    const snapshot = await service.getCurrentDocumentSnapshot();
    const definition = await getSeedExtrudeDefinition(service);
    const created = await unwrapModelingResult(
      service.createFeature({
        baseRevisionId: snapshot.document.revisionId,
        definition,
      }),
    );
    expect(
      created.revisionState.kind,
      "Feature create should commit before delete.",
    ).toBe("accepted");

    const deleted = await unwrapModelingResult(
      service.deleteFeature({
        baseRevisionId: created.revisionId,
        featureId: created.featureId,
      }),
    );
    expect(deleted.revisionState.kind, "Feature delete should commit.").toBe(
      "accepted",
    );

    const finalHistory = store.savedPayloads.at(-1);
    expect(
      finalHistory,
      "Create/delete sequence should save history.",
    ).toBeTruthy();

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: createMemoryOperationHistoryStore(finalHistory),
    });
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot();

    expect(
      restoredSnapshot.document.features.some(
        (feature) => feature.featureId === created.featureId,
      ),
      "Replay should apply persisted feature deletes.",
    ).toBeFalsy();
  }

  async function testGenericDeleteReplayMatchesFinalState() {
    const { service, store } = await createServiceWithStore();
    const snapshot = await service.getCurrentDocumentSnapshot();
    const deleted = await unwrapModelingResult(
      service.deleteTarget({
        baseRevisionId: snapshot.document.revisionId,
        target: { kind: "body", bodyId: "body_part-1" },
      }),
    );
    expect(
      deleted.revisionState.kind,
      "Generic body delete should commit.",
    ).toBe("accepted");

    const finalHistory = store.savedPayloads.at(-1);
    expect(
      finalHistory,
      "Generic delete should save operation history.",
    ).toBeTruthy();
    expect(
      finalHistory.entries.at(-1)?.kind,
      "Generic delete should persist as a generic delete entry.",
    ).toBe("deleteTarget");

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: createMemoryOperationHistoryStore(finalHistory),
    });
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot();

    expect(
      restoredSnapshot.presentation.objects.every(
        (item) =>
          item.target.kind !== "body" || item.target.bodyId !== "body_part-1",
      ),
      "Replay should apply persisted generic body deletes.",
    ).toBeTruthy();
  }

  async function testInvalidGenericDeleteReplayFailsRestore() {
    const { service } = await createServiceWithStore({
      ...createEmptyOperationHistory("doc_workspace"),
      entries: [
        {
          kind: "deleteTarget",
          payload: {
            target: { kind: "face", bodyId: "body_part-1", faceId: "face_top" },
          },
        },
      ],
    });

    const state = await service.getHistoryRestoreState();
    expect(
      state.kind,
      "Unsupported persisted generic delete targets should fail restore explicitly.",
    ).toBe("failed");
    expect(
      state.diagnostics[0]?.reasonCode,
      "Unsupported generic delete restore failures should expose adapter diagnostics.",
    ).toBe("mock-unsupported-delete-target");
  }

  async function testPersistedHistoryReplaysDocumentVariables() {
    const { service, store } = await createServiceWithStore();
    const snapshot = await service.getCurrentDocumentSnapshot();
    const added = await unwrapModelingResult(
      service.addDocumentVariable({
        baseRevisionId: snapshot.document.revisionId,
        variableId: "variable_width",
        name: "width",
        valueText: "12",
      }),
    );
    expect(
      added.revisionState.kind,
      "Variable add should be stored for replay.",
    ).toBe("accepted");

    const updated = await unwrapModelingResult(
      service.updateDocumentVariable({
        baseRevisionId: added.revisionId,
        variableId: added.variableId,
        name: "width",
        valueText: "18",
      }),
    );
    expect(
      updated.revisionState.kind,
      "Variable update should be stored for replay.",
    ).toBe("accepted");

    const dependent = await unwrapModelingResult(
      service.addDocumentVariable({
        baseRevisionId: updated.revisionId,
        variableId: "variable_depth",
        name: "depth",
        valueText: "width + 50",
      }),
    );
    expect(
      dependent.revisionState.kind,
      "Dependent variable add should be stored for replay.",
    ).toBe("accepted");

    const finalHistory = store.savedPayloads.at(-1);
    expect(
      finalHistory,
      "Variable mutations should save history.",
    ).toBeTruthy();
    expect(
      finalHistory.entries[0]?.kind,
      "Variable create should persist as document history.",
    ).toBe("addDocumentVariable");
    expect(
      finalHistory.entries[1]?.kind,
      "Variable edit should persist as document history.",
    ).toBe("updateDocumentVariable");
    expect(
      finalHistory.entries[2]?.kind,
      "Dependent variable create should persist as document history.",
    ).toBe("addDocumentVariable");
    expect(
      "isValid" in finalHistory.entries[1]!.payload,
      "Variable history must not persist validation state.",
    ).toBeFalsy();

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: createMemoryOperationHistoryStore(finalHistory),
    });
    const restoreState = await restoredService.getHistoryRestoreState();
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot();

    expect(
      restoreState.kind,
      "Variable history should restore explicitly.",
    ).toBe("restored");
    expect(
      restoredSnapshot.document.variables
        .map(
          (variable) =>
            `${variable.variableId}:${variable.name}:${variable.valueText}`,
        )
        .join(","),
      "Replay should restore ordered document variable records without expression evaluation.",
    ).toBe("variable_width:width:18,variable_depth:depth:width + 50");
    const evaluation = evaluateDocumentVariableExpressions(
      restoredSnapshot.document.variables,
    );
    expect(
      evaluation.ok && evaluation.valuesByName.get("depth") === 68,
      "Restored dependent variable expressions should remain evaluable.",
    ).toBeTruthy();
    expect(
      restoredSnapshot.document.references.length > 0,
      "Variable replay should preserve snapshot reference records.",
    ).toBeTruthy();
  }

  async function testUnsupportedHistoryVersionFailsRestore() {
    const store = createMemoryOperationHistoryStore({
      ...createEmptyOperationHistory("doc_workspace"),
      schemaVersion: "modeling-operation-history/v0" as never,
    });
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: store,
    });

    const state = await service.getHistoryRestoreState();
    expect(
      state.kind,
      "Unsupported history versions should fail restore explicitly.",
    ).toBe("failed");
    expect(
      state.diagnostics[0]?.reasonCode,
      "Unsupported history version restore failures should expose diagnostics.",
    ).toBe("unsupported-schema-version");
  }

  async function testInvalidCursorHistoryFailsRestore() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: createMemoryOperationHistoryStore({
        ...createEmptyOperationHistory("doc_workspace"),
        entries: [
          {
            kind: "setFeatureCursor",
            payload: {
              cursor: { kind: "feature", featureId: "feature_missing" },
            },
          },
        ],
      }),
    });

    const state = await service.getHistoryRestoreState();
    expect(
      state.kind,
      "Invalid persisted cursor references should fail restore explicitly.",
    ).toBe("failed");
    expect(
      state.diagnostics[0]?.reasonCode,
      "Invalid persisted cursor restore failures should expose cursor diagnostics.",
    ).toBe("mock-invalid-document-cursor");
  }

  async function testStartupSnapshotWaitsForReplay() {
    const { service, store } = await createServiceWithStore();
    const snapshot = await service.getCurrentDocumentSnapshot();
    const definition = await getSeedExtrudeDefinition(service);
    const created = await unwrapModelingResult(
      service.createFeature({
        baseRevisionId: snapshot.document.revisionId,
        definition,
      }),
    );
    expect(
      created.revisionState.kind,
      "Feature create should produce startup replay history.",
    ).toBe("accepted");

    const finalHistory = store.savedPayloads.at(-1);
    expect(finalHistory, "Feature create should save history.").toBeTruthy();

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      operationHistoryStore: createMemoryOperationHistoryStore(finalHistory),
    });
    const startupSnapshot = await restoredService.getCurrentDocumentSnapshot();

    expect(
      startupSnapshot.document.features.some(
        (feature) => feature.featureId === created.featureId,
      ),
      "Startup snapshot should include replayed history before editor exposure.",
    ).toBeTruthy();
  }

  await testOnlyCommittedMutationsAreStored();
  await testPersistedHistoryReplaysSketchAndFeatureMutations();
  await testDeleteFeatureReplayMatchesFinalState();
  await testGenericDeleteReplayMatchesFinalState();
  await testInvalidGenericDeleteReplayFailsRestore();
  await testPersistedHistoryReplaysDocumentVariables();
  await testUnsupportedHistoryVersionFailsRestore();
  await testInvalidCursorHistoryFailsRestore();
  await testStartupSnapshotWaitsForReplay();
});
