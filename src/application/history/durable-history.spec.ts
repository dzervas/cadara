import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { test, expect, vi } from "vitest";

import {
  createDurableHistoryService,
  DEFAULT_REPOSITORY_SYNCHRONIZATION_TIMEOUT_MS,
} from "@/application/history/durable-history";
import type { DocumentRepository } from "@/domain/modeling/document-repository";
import {
  createModelingService,
  type ModelingService,
} from "@/domain/modeling/modeling-service";
import { createMemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import type { AppResultAsync } from "@/contracts/errors";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

test("repository compensation synchronizes background document edits", async () => {
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
        : "Expected modeling result to be ok.",
    ).toBeTruthy();
    if (resolved.isErr()) throw new Error(resolved.error.message);
    return resolved.value;
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
      ...seedExtrude.definition,
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    };
  }

  async function createBackgroundDurableHistoryFixture(
    documentRepository: DocumentRepository = createMemoryDocumentRepository(),
  ) {
    const modelingService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      sketchSolver: new SketchConstraintSolverAdapter({
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
        documentId: "doc_workspace",
        revisionId: null,
      }),
      documentRepository,
      documentRepositoryPersistence: "background",
    });
    const durableHistory = createDurableHistoryService({
      documentRepository,
      modelingService,
    });

    return {
      documentRepository,
      modelingService,
      durableHistory,
    };
  }

  async function testImmediateUndoAfterBackgroundVariableUpdate() {
    const { modelingService, durableHistory } =
      await createBackgroundDurableHistoryFixture();
    const initial = await modelingService.getCurrentDocumentSnapshot();

    const added = await unwrapModelingResult(
      modelingService.addDocumentVariable({
        baseRevisionId: initial.document.revisionId,
        name: "Width",
        valueText: "10",
      }),
    );
    expect(added.revisionState.kind, "Variable setup should be accepted.").toBe(
      "accepted",
    );
    await modelingService.waitForPersistence();

    const withVariable = await modelingService.getCurrentDocumentSnapshot();
    const variable = withVariable.document.variables.find(
      (entry) => entry.name === "Width",
    );
    expect(
      variable,
      "Added variable should exist before update undo coverage runs.",
    ).toBeTruthy();
    if (!variable) throw new Error("Missing authored variable");

    const updated = await unwrapModelingResult(
      modelingService.updateDocumentVariable({
        baseRevisionId: withVariable.document.revisionId,
        variableId: variable.variableId,
        name: variable.name,
        valueText: "25",
      }),
    );
    expect(
      updated.revisionState.kind,
      "Variable update should be accepted.",
    ).toBe("accepted");

    const availability = await durableHistory.getAvailability({
      documentId: withVariable.document.documentId,
    });
    expect(
      availability.canUndo,
      "Immediate durable-history availability should reflect a background variable update.",
    ).toBeTruthy();

    const undone = await durableHistory.undo({
      documentId: withVariable.document.documentId,
    });
    expect(
      undone?.context,
      "Immediate undo after a variable update should restore a document snapshot.",
    ).toBe("document");
    expect(
      undone?.context === "document" &&
        undone.snapshot.document.variables.some(
          (entry) =>
            entry.variableId === variable.variableId &&
            entry.valueText === "10",
        ),
      "Immediate undo after a variable update should restore the prior variable value.",
    ).toBeTruthy();
  }

  async function testUndoRestoresDeletedVariableInPlace() {
    const { modelingService, durableHistory } =
      await createBackgroundDurableHistoryFixture();
    const variableIds = async () =>
      (await modelingService.getCurrentDocumentSnapshot()).document.variables.map(
        (variable) => variable.variableId,
      );
    for (const name of ["a", "b", "c"]) {
      const current = await modelingService.getCurrentDocumentSnapshot();
      await unwrapModelingResult(
        modelingService.addDocumentVariable({
          baseRevisionId: current.document.revisionId,
          name,
          valueText: "1",
        }),
      );
      await modelingService.waitForPersistence();
    }
    const before = await variableIds();
    const current = await modelingService.getCurrentDocumentSnapshot();
    await unwrapModelingResult(
      modelingService.removeDocumentVariable({
        baseRevisionId: current.document.revisionId,
        variableId: before[1]!,
      }),
    );
    await modelingService.waitForPersistence();

    await durableHistory.undo({ documentId: current.document.documentId });
    expect(
      await variableIds(),
      "Undoing a variable delete restores it at its original position (cadara-1ui8).",
    ).toEqual(before);
  }

  async function testImmediateUndoAfterBackgroundExtrudeUpdate() {
    const { modelingService, durableHistory } =
      await createBackgroundDurableHistoryFixture();
    const initial = await modelingService.getCurrentDocumentSnapshot();
    const definition = await getSeedExtrudeDefinition(modelingService);
    const initialExtrude = initial.document.features.find(
      (feature) => feature.featureId === "feature_extrude-1",
    );
    expect(
      initialExtrude?.definition.kind,
      "Seed extrude should exist before extrude undo coverage runs.",
    ).toBe("extrude");
    if (!initialExtrude || initialExtrude.definition.kind !== "extrude") throw new Error("Missing seed extrude");
    const initialDistance =
      initialExtrude.definition.parameters.extent.mode === "oneSide" &&
      initialExtrude.definition.parameters.extent.end.kind === "blind"
        ? initialExtrude.definition.parameters.extent.end.distance
        : null;

    const updated = await unwrapModelingResult(
      modelingService.updateFeature({
        baseRevisionId: initial.document.revisionId,
        featureId: "feature_extrude-1",
        featureLabel: "Extrude",
        definition: {
          ...definition,
          parameters: {
            ...definition.parameters,
            extent: {
              mode: "oneSide",
              end: {
                kind: "blind",
                direction: "positive",
                distance: { source: "literal", value: 23 },
              },
            },
          },
        },
      }),
    );
    expect(
      updated.revisionState.kind,
      "Extrude update should be accepted.",
    ).toBe("accepted");

    const availability = await durableHistory.getAvailability({
      documentId: initial.document.documentId,
    });
    expect(
      availability.canUndo,
      "Immediate durable-history availability should reflect a background extrude update.",
    ).toBeTruthy();

    const undone = await durableHistory.undo({
      documentId: initial.document.documentId,
    });
    const restoredExtrude =
      undone?.context === "document"
        ? undone.snapshot.document.features.find(
            (feature) => feature.featureId === "feature_extrude-1",
          )
        : null;
    expect(
      restoredExtrude?.definition.kind,
      "Immediate undo after an extrude update should restore the extrude feature.",
    ).toBe("extrude");
    expect(
      restoredExtrude?.definition.kind === "extrude" &&
        restoredExtrude.definition.parameters.extent.mode === "oneSide" &&
        restoredExtrude.definition.parameters.extent.end.kind === "blind" &&
        getAuthoredLiteralValue(
          restoredExtrude.definition.parameters.extent.end.distance,
        ) === getAuthoredLiteralValue(initialDistance),
      "Immediate undo after an extrude update should restore the prior extrude extent distance.",
    ).toBeTruthy();
  }

  async function testImmediateUndoAfterBackgroundSketchPlaneCommit() {
    const { modelingService, durableHistory } =
      await createBackgroundDurableHistoryFixture();
    const initial = await modelingService.getCurrentDocumentSnapshot();
    const sketch = initial.document.sketches[0];
    expect(
      sketch,
      "Seed sketch should exist for sketch-plane undo coverage.",
    ).toBeTruthy();

    const committed = await unwrapModelingResult(
      modelingService.commitSketch({
        baseRevisionId: initial.document.revisionId,
        sketchId: sketch.sketchId,
        sketchLabel: sketch.label,
        plane: createStandardPlaneDefinition("yz"),
        definition: sketch.sketch.definition,
        solverCorrelation:
          modelingService.sketchSolver?.createCommitCorrelation(
            "request_background_sketch_plane_undo",
          ) ?? null,
      }),
    );
    expect(
      committed.revisionState.kind,
      "Sketch-plane commit should be accepted.",
    ).toBe("accepted");

    const availability = await durableHistory.getAvailability({
      documentId: initial.document.documentId,
    });
    expect(
      availability.canUndo,
      "Immediate durable-history availability should reflect a background sketch-plane commit.",
    ).toBeTruthy();

    const undone = await durableHistory.undo({
      documentId: initial.document.documentId,
    });
    const restoredSketch =
      undone?.context === "document"
        ? undone.snapshot.document.sketches.find(
            (entry) => entry.sketchId === sketch.sketchId,
          )
        : null;
    expect(
      restoredSketch,
      "Immediate undo after a sketch-plane commit should restore the committed sketch.",
    ).toBeTruthy();
    expect(
      restoredSketch?.plane.key,
      "Immediate undo after a sketch-plane commit should restore the prior sketch plane.",
    ).toBe(sketch.plane.key);
  }

  async function testImmediateUndoWaitsForDelayedRepositoryUndoEvent() {
    const documentRepository = createDelayedUndoNotificationRepository();
    const { modelingService, durableHistory } =
      await createBackgroundDurableHistoryFixture(documentRepository);
    const initial = await modelingService.getCurrentDocumentSnapshot();

    const added = await unwrapModelingResult(
      modelingService.addDocumentVariable({
        baseRevisionId: initial.document.revisionId,
        name: "Depth",
        valueText: "5",
      }),
    );
    expect(
      added.revisionState.kind,
      "Delayed-notification variable setup should be accepted.",
    ).toBe("accepted");
    await modelingService.waitForPersistence();

    const withVariable = await modelingService.getCurrentDocumentSnapshot();
    const variable = withVariable.document.variables.find(
      (entry) => entry.name === "Depth",
    );
    expect(
      variable,
      "Delayed-notification variable should exist before undo coverage runs.",
    ).toBeTruthy();
    if (!variable) throw new Error("Missing authored variable");

    const updated = await unwrapModelingResult(
      modelingService.updateDocumentVariable({
        baseRevisionId: withVariable.document.revisionId,
        variableId: variable.variableId,
        name: variable.name,
        valueText: "15",
      }),
    );
    expect(
      updated.revisionState.kind,
      "Delayed-notification variable update should be accepted.",
    ).toBe("accepted");

    const undone = await durableHistory.undo({
      documentId: withVariable.document.documentId,
    });
    expect(
      undone?.context === "document" &&
        undone.snapshot.document.variables.some(
          (entry) =>
            entry.variableId === variable.variableId && entry.valueText === "5",
        ),
      "Document undo should wait for the delayed repository undo event before fetching the restored snapshot.",
    ).toBeTruthy();
  }

  async function testImmediateUndoDoesNotRequireLatestEventReplay() {
    const { documentRepository, modelingService: baseModelingService } =
      await createBackgroundDurableHistoryFixture();
    const durableHistory = createDurableHistoryService({
      documentRepository,
      modelingService: createNoReplayModelingService(baseModelingService),
    });
    const initial = await baseModelingService.getCurrentDocumentSnapshot();

    const added = await unwrapModelingResult(
      baseModelingService.addDocumentVariable({
        baseRevisionId: initial.document.revisionId,
        name: "Height",
        valueText: "30",
      }),
    );
    expect(
      added.revisionState.kind,
      "No-replay variable setup should be accepted.",
    ).toBe("accepted");
    await baseModelingService.waitForPersistence();

    const withVariable = await baseModelingService.getCurrentDocumentSnapshot();
    const variable = withVariable.document.variables.find(
      (entry) => entry.name === "Height",
    );
    expect(
      variable,
      "No-replay variable should exist before undo coverage runs.",
    ).toBeTruthy();
    if (!variable) throw new Error("Missing authored variable");

    const updated = await unwrapModelingResult(
      baseModelingService.updateDocumentVariable({
        baseRevisionId: withVariable.document.revisionId,
        variableId: variable.variableId,
        name: variable.name,
        valueText: "35",
      }),
    );
    expect(
      updated.revisionState.kind,
      "No-replay variable update should be accepted.",
    ).toBe("accepted");

    const undone = await durableHistory.undo({
      documentId: withVariable.document.documentId,
    });
    expect(
      undone?.context === "document" &&
        undone.snapshot.document.variables.some(
          (entry) =>
            entry.variableId === variable.variableId &&
            entry.valueText === "30",
        ),
      "Document undo should subscribe before mutating so synchronous repository events are not missed.",
    ).toBeTruthy();
  }

  async function testUndoAllowsSlowKernelBackedRepositorySynchronization() {
    const { documentRepository, modelingService } =
      await createBackgroundDurableHistoryFixture(
        createDelayedUndoNotificationRepository(15),
      );
    const durableHistory = createDurableHistoryService({
      documentRepository,
      modelingService,
      // Synthetic Taskariki-scale rebuild: longer than the former 2s policy,
      // compressed to milliseconds so this seam stays fast.
      repositorySynchronizationTimeoutMs: 30,
    });
    const initial = await modelingService.getCurrentDocumentSnapshot();
    const added = await unwrapModelingResult(
      modelingService.addDocumentVariable({
        baseRevisionId: initial.document.revisionId,
        name: "SlowSync",
        valueText: "1",
      }),
    );
    await modelingService.waitForPersistence();

    await unwrapModelingResult(
      modelingService.updateDocumentVariable({
        baseRevisionId: added.revisionId,
        variableId: added.variableId,
        name: "SlowSync",
        valueText: "2",
      }),
    );
    await modelingService.waitForPersistence();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const undoSettled = vi.fn();
      const undo = durableHistory.undo({
        documentId: initial.document.documentId,
      });
      void undo.then(undoSettled, undoSettled);

      // Advance the notification and deadline together without wall-clock races.
      await vi.advanceTimersByTimeAsync(14);
      expect(undoSettled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      const undone = await undo;
      expect(undone?.context).toBe("document");
      expect(
        undone?.context === "document" &&
          undone.snapshot.document.variables.find(
            (variable) => variable.variableId === added.variableId,
          )?.valueText,
      ).toBe("1");
    } finally {
      vi.useRealTimers();
    }
    expect(DEFAULT_REPOSITORY_SYNCHRONIZATION_TIMEOUT_MS).toBeGreaterThan(
      65_000,
    );
  }

  await testImmediateUndoAfterBackgroundVariableUpdate();
  await testUndoRestoresDeletedVariableInPlace();
  await testImmediateUndoAfterBackgroundExtrudeUpdate();
  await testImmediateUndoAfterBackgroundSketchPlaneCommit();
  await testImmediateUndoWaitsForDelayedRepositoryUndoEvent();
  await testImmediateUndoDoesNotRequireLatestEventReplay();
  await testUndoAllowsSlowKernelBackedRepositorySynchronization();
});

function createNoReplayModelingService(
  modelingService: ModelingService,
): ModelingService {
  return {
    ...modelingService,
    subscribeToDocumentChanges(listener) {
      let skippedReplayEvent = false;
      return modelingService.subscribeToDocumentChanges((event) => {
        if (!skippedReplayEvent) {
          skippedReplayEvent = true;
          return;
        }

        listener(event);
      });
    },
  };
}

function createDelayedUndoNotificationRepository(
  delayMs = 0,
): DocumentRepository {
  const repository = createMemoryDocumentRepository();

  return {
    load(input) {
      return repository.load(input);
    },
    initialize(input) {
      return repository.initialize(input);
    },
    mutate(input) {
      return repository.mutate(input);
    },
    subscribe(documentId, listener) {
      return repository.subscribe(documentId, (event) => {
        if (
          event.metadata.source === "undo" ||
          event.metadata.source === "redo"
        ) {
          setTimeout(() => {
            listener(event);
          }, delayMs);
          return;
        }

        listener(event);
      });
    },
    reset(documentId) {
      return repository.reset(documentId);
    },
    getRestoreStatus(documentId) {
      return repository.getRestoreStatus(documentId);
    },
    getMetadata(documentId) {
      return repository.getMetadata(documentId);
    },
    getDurableHistoryAvailability(documentId) {
      return repository.getDurableHistoryAvailability(documentId);
    },
    undoDurableHistory(documentId) {
      return repository.undoDurableHistory(documentId);
    },
    redoDurableHistory(documentId) {
      return repository.redoDurableHistory(documentId);
    },
  };
}

// cadara-l99p review: the worker-backed repository sends the stored document
// URL with a compensation, and a New document still in flight stores a new
// one; reading it first would refuse this tab's own undo as superseded.
test("a durable undo requested while New document runs reaches the repository only after New's initialize", async () => {
  const repository = createMemoryDocumentRepository();
  const modelingService = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
    documentRepositoryPersistence: "background",
  });
  const durableHistory = createDurableHistoryService({
    documentRepository: repository,
    modelingService,
  });
  try {
    await modelingService.getCurrentDocumentSnapshot();
    await modelingService.waitForPersistence();
    const calls: string[] = [];
    let releaseInitialize!: () => void;
    const initialize = repository.initialize.bind(repository);
    repository.initialize = async (input) => {
      calls.push("initialize");
      await new Promise<void>((resolve) => (releaseInitialize = resolve));
      const result = await initialize(input);
      calls.push("initialized");
      return result;
    };
    const undoDurableHistory = repository.undoDurableHistory.bind(repository);
    repository.undoDurableHistory = (...args) => {
      calls.push("undo");
      return undoDurableHistory(...args);
    };

    const created = modelingService.createNewDocument();
    const undo = durableHistory.undo({ documentId: "doc_workspace" });
    await expect.poll(() => calls).toEqual(["initialize"]);
    // Give an undo that skipped the wait time to reach the repository.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls, "the undo waits for the in-flight New document").toEqual([
      "initialize",
    ]);
    releaseInitialize();
    expect((await created).ok, "premise: New document succeeded").toBe(true);
    await undo;
    expect(calls).toEqual(["initialize", "initialized", "undo"]);
  } finally {
    modelingService.dispose();
  }
});
