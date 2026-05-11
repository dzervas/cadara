import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import { createWorkbenchDocumentOwner } from "@/application/workbench/document-owner";
import { createAppError, err, ok } from "@/contracts/errors";
import type { ImportProvider } from "@/contracts/import/provider";
import type { ImportReviewEnvelope } from "@/contracts/import/review";
import type { ResolvedImportSource } from "@/contracts/import/source";
import type {
  DocumentHistoryOrderEntry,
  ModelingDiagnostic,
} from "@/contracts/modeling/schema";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { EditorEvent, EditorState } from "@/domain/editor/state-machine";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import type {
  ModelingCommitSketchCorrelation,
  ModelingService,
} from "@/domain/modeling/modeling-service";

function createDiagnostic(
  message: string,
  severity: ModelingDiagnostic["severity"] = "error",
): ModelingDiagnostic {
  return {
    code: `diagnostic-${message.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
    severity,
    message,
    target: null,
    detail: null,
  };
}

function createImportReview(): ImportReviewEnvelope<{ units: "mm" }> {
  return {
    providerReview: { units: "mm" },
    proposedActionKinds: ["addDocumentVariable"],
    diagnostics: [],
  };
}

function createResolvedImportSource(): ResolvedImportSource {
  return {
    name: "fixture.step",
    origin: { kind: "localFile", fileName: "fixture.step" },
    mediaType: "model/step",
    bytes: new Uint8Array([1, 2, 3]),
    fingerprint: "sha256:fixture-import",
  };
}

function createImportProvider(
  overrides: Partial<
    ImportProvider<
      { units: "mm" },
      { enabled: boolean },
      FeatureEditorFormSchema
    >
  > = {},
): ImportProvider<
  { units: "mm" },
  { enabled: boolean },
  FeatureEditorFormSchema
> {
  return {
    id: "step",
    label: "STEP",
    acceptedFileTypes: [{ extension: ".step", mediaType: "model/step" }],
    accepts: () => true,
    review: async () => createImportReview(),
    createDefaultSelections: () => ({ enabled: true }),
    getReviewFormSchema: () => ({}) as FeatureEditorFormSchema,
    applySelectionPatch: (_review, selections) => selections,
    prepare: async () => ({
      addDocumentVariables: [
        {
          name: "scale",
          valueText: "1",
        },
      ],
      diagnostics: [],
    }),
    ...overrides,
  };
}

function createOwner(input: {
  machineState: EditorState;
  modelingService: Partial<ModelingService>;
  dispatch?: (event: EditorEvent) => void;
  importProvider?: ImportProvider<
    unknown,
    unknown,
    FeatureEditorFormSchema
  > | null;
}) {
  return createWorkbenchDocumentOwner({
    machineState: input.machineState,
    dispatch: input.dispatch ?? (() => {}),
    modelingService: input.modelingService as ModelingService,
    runtimeExtensionRegistries: {
      importProviders: { getById: () => input.importProvider ?? null },
    } as never,
  });
}

test("document owner accepts variable mutations and refreshes the snapshot", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const nextSnapshot = await createSeedDocumentSnapshot();
  const dispatched: EditorEvent[] = [];
  const addCalls: Array<{
    baseRevisionId: string;
    name: string;
    valueText: string;
  }> = [];

  const owner = createOwner({
    machineState: { snapshot } as EditorState,
    dispatch: (event) => dispatched.push(event),
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: null,
      async getCurrentDocumentSnapshot() {
        return nextSnapshot;
      },
      async addDocumentVariable(input) {
        addCalls.push(input);
        return ok({
          revisionState: { kind: "accepted" as const },
          diagnostics: [],
        });
      },
    },
  });

  const result = await owner.addDocumentVariable({
    operation: "Add variable",
    fallbackMessage: "Add variable failed.",
  });

  expectTrue(
    result.isOk(),
    "Accepted variable mutations should resolve successfully through the document owner seam.",
  );
  expectTrue(
    addCalls[0]?.baseRevisionId === snapshot.document.revisionId &&
      addCalls[0]?.name === `var${snapshot.document.variables.length + 1}` &&
      addCalls[0]?.valueText === "0",
    "Document owner should derive variable defaults from the active snapshot revision and variable count.",
  );
  expectTrue(
    dispatched[0]?.type === "document.snapshotLoaded" &&
      dispatched[0].snapshot === nextSnapshot,
    "Accepted variable mutations should refresh and dispatch the next snapshot.",
  );
});

test("document owner preserves rejected and errored variable mutations without refreshing", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const dispatched: EditorEvent[] = [];
  const rejectedDiagnostic = createDiagnostic(
    "Variable expressions must stay valid.",
  );
  const actionError = createAppError({
    code: "app/operation-failed",
    message: "Repository offline.",
  });

  const rejectedOwner = createOwner({
    machineState: { snapshot } as EditorState,
    dispatch: (event) => dispatched.push(event),
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: null,
      async getCurrentDocumentSnapshot() {
        throw new Error("Rejected mutations should not refresh the snapshot.");
      },
      async addDocumentVariable() {
        return ok({
          revisionState: {
            kind: "rejected" as const,
            reasonCode: "invalid-variable",
          },
          diagnostics: [rejectedDiagnostic],
        });
      },
    },
  });

  const rejectedResult = await rejectedOwner.addDocumentVariable({
    operation: "Add variable",
    fallbackMessage: "Add variable failed.",
  });

  expectTrue(
    rejectedResult.isErr(),
    "Rejected modeling results should propagate as workbench errors.",
  );
  expectTrue(
    dispatched.length === 0,
    "Rejected mutations should not dispatch a refreshed snapshot.",
  );

  const erroredOwner = createOwner({
    machineState: { snapshot } as EditorState,
    dispatch: (event) => dispatched.push(event),
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: null,
      async getCurrentDocumentSnapshot() {
        throw new Error("Errored mutations should not refresh the snapshot.");
      },
      async addDocumentVariable() {
        return err(actionError);
      },
    },
  });

  const erroredResult = await erroredOwner.addDocumentVariable({
    operation: "Add variable",
    fallbackMessage: "Add variable failed.",
  });

  expectTrue(
    erroredResult.isErr(),
    "Upstream AppError results should pass through the document owner seam.",
  );
  expectTrue(
    erroredResult.isErr() &&
      erroredResult.error.message === "Repository offline.",
    "The owner should not wrap modeling AppErrors when the modeling service already normalized them.",
  );
  expectTrue(
    dispatched.length === 0,
    "Errored mutations should not dispatch a refreshed snapshot.",
  );
});

test("document owner covers snapshot replacement and loading guards", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const nextSnapshot = await createSeedDocumentSnapshot();
  const dispatched: EditorEvent[] = [];

  const owner = createOwner({
    machineState: { snapshot } as EditorState,
    dispatch: (event) => dispatched.push(event),
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: null,
      async getCurrentDocumentSnapshot() {
        return nextSnapshot;
      },
    },
  });

  const replaced = await owner.replaceActiveDocumentBasis();
  expectTrue(
    replaced === nextSnapshot,
    "Replacing the active document basis should return the fetched snapshot.",
  );
  expectTrue(
    dispatched[0]?.type === "document.replaced" &&
      dispatched[0].snapshot === nextSnapshot,
    "Replacing the active document basis should dispatch the replacement event.",
  );

  const loadingOwner = createOwner({
    machineState: { snapshot: null } as EditorState,
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: null,
      async addDocumentVariable() {
        throw new Error(
          "Loading guards should stop before hitting the modeling service.",
        );
      },
    },
  });

  let message: string | null = null;
  try {
    await loadingOwner.addDocumentVariable({
      operation: "Add variable",
      fallbackMessage: "Add variable failed.",
    });
  } catch (error: unknown) {
    message = error instanceof Error ? error.message : String(error);
  }
  expectTrue(
    message === "The current document is still loading.",
    "Mutation entrypoints should guard against missing snapshots.",
  );
});

test("document owner routes durable document rename through the modeling seam and refreshes the snapshot", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const nextSnapshot = await createSeedDocumentSnapshot();
  nextSnapshot.document.name = "Bracket v3";
  const dispatched: EditorEvent[] = [];
  const renameCalls: string[] = [];

  const owner = createOwner({
    machineState: { snapshot } as EditorState,
    dispatch: (event) => dispatched.push(event),
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: null,
      async getCurrentDocumentSnapshot() {
        return nextSnapshot;
      },
      async renameDocument(input) {
        renameCalls.push(input.name);
        return {
          ok: true as const,
          revisionId: nextSnapshot.document.revisionId,
          diagnostics: [],
        };
      },
    },
  });

  const result = await owner.renameDocument("Bracket v3", {
    operation: "Rename document",
    fallbackMessage: "Rename document failed.",
  });

  expectTrue(
    result.isOk(),
    "Accepted document rename mutations should resolve successfully through the document owner seam.",
  );
  expectTrue(
    renameCalls[0] === "Bracket v3",
    "Document owner should pass the durable document name through to the modeling service.",
  );
  expectTrue(
    dispatched[0]?.type === "document.snapshotLoaded" &&
      dispatched[0].snapshot === nextSnapshot,
    "Accepted document renames should refresh and dispatch the next snapshot through the shared snapshot-loaded handoff.",
  );
});

test("document owner routes rename operations for bodies, features, and sketches", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const nextSnapshot = await createSeedDocumentSnapshot();
  const dispatched: EditorEvent[] = [];
  const body = snapshot.document.bodies[0]!;
  const feature = snapshot.document.features[0]!;
  const sketch = snapshot.document.sketches[0]!;
  const correlations: ModelingCommitSketchCorrelation[] = [];
  const renameBodyCalls: Array<{
    bodyId: string;
    bodyLabel: string;
    baseRevisionId: string;
  }> = [];
  const updateFeatureCalls: Array<{
    featureId: string;
    featureLabel: string;
    definition: typeof feature.definition;
  }> = [];
  const commitSketchCalls: Array<{
    sketchId: string;
    sketchLabel: string;
    solverCorrelation: ModelingCommitSketchCorrelation | null;
  }> = [];

  const owner = createOwner({
    machineState: { snapshot } as EditorState,
    dispatch: (event) => dispatched.push(event),
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: {
        createCommitCorrelation(requestId) {
          const correlation = {
            requestId,
            projectionRequestId: `${requestId}_project`,
            validationRequestId: `${requestId}_validate`,
            solveRequestId: `${requestId}_solve`,
            regionRequestId: `${requestId}_regions`,
          } as ModelingCommitSketchCorrelation;
          correlations.push(correlation);
          return correlation;
        },
      },
      async getCurrentDocumentSnapshot() {
        return nextSnapshot;
      },
      async renameBody(input) {
        renameBodyCalls.push(input);
        return ok({
          revisionState: { kind: "accepted" as const },
          diagnostics: [],
        });
      },
      async updateFeature(input) {
        updateFeatureCalls.push({
          featureId: input.featureId,
          featureLabel: input.featureLabel,
          definition: input.definition,
        });
        return ok({
          revisionState: { kind: "accepted" as const },
          diagnostics: [],
        });
      },
      async commitSketch(input) {
        commitSketchCalls.push({
          sketchId: input.sketchId,
          sketchLabel: input.sketchLabel,
          solverCorrelation: input.solverCorrelation,
        });
        return ok({
          revisionState: { kind: "accepted" as const },
          diagnostics: [],
        });
      },
    },
  });

  const bodyRename = await owner.renameTarget(
    { kind: "body", bodyId: body.bodyId },
    "Renamed body",
    { operation: "Rename body", fallbackMessage: "Rename body failed." },
  );
  const featureRename = await owner.renameTarget(
    { kind: "feature", featureId: feature.featureId },
    "Renamed feature",
    { operation: "Rename feature", fallbackMessage: "Rename feature failed." },
  );
  const sketchRename = await owner.renameTarget(
    { kind: "sketch", sketchId: sketch.sketchId },
    "Renamed sketch",
    { operation: "Rename sketch", fallbackMessage: "Rename sketch failed." },
  );

  expectTrue(
    bodyRename.isOk() && featureRename.isOk() && sketchRename.isOk(),
    "Accepted rename flows should resolve successfully.",
  );
  expectTrue(
    renameBodyCalls[0]?.bodyId === body.bodyId &&
      renameBodyCalls[0]?.bodyLabel === "Renamed body" &&
      renameBodyCalls[0]?.baseRevisionId === snapshot.document.revisionId,
    "Body renames should forward the body id, new label, and active base revision.",
  );
  expectTrue(
    updateFeatureCalls[0]?.featureId === feature.featureId &&
      updateFeatureCalls[0]?.featureLabel === "Renamed feature" &&
      updateFeatureCalls[0]?.definition === feature.definition,
    "Feature renames should preserve the existing definition while updating the label.",
  );
  expectTrue(
    commitSketchCalls[0]?.sketchId === sketch.sketchId &&
      commitSketchCalls[0]?.sketchLabel === "Renamed sketch" &&
      commitSketchCalls[0]?.solverCorrelation === correlations[0],
    "Sketch renames should hand the sketch solver correlation through the modeling service port.",
  );
  expectTrue(
    dispatched.filter((event) => event.type === "document.snapshotLoaded")
      .length === 3,
    "Accepted rename mutations should refresh the snapshot after each accepted operation.",
  );
});

test("document owner enforces rename and delete guardrails", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const owner = createOwner({
    machineState: { snapshot } as EditorState,
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: null,
      async getCurrentDocumentSnapshot() {
        return snapshot;
      },
      async deleteTarget() {
        throw new Error(
          "Delete guardrails should stop before the modeling service.",
        );
      },
    },
  });

  let deleteMessage: string | null = null;
  try {
    await owner.deleteTarget(
      {
        kind: "projectedReferenceGeometry",
        referenceId: "ref_projected" as PrimitiveRef["kind"] extends never
          ? never
          : never,
        geometryId: "projected_geometry_1" as never,
        geometryKind: "lineSegment",
      } as PrimitiveRef,
      { operation: "Delete target", fallbackMessage: "Delete target failed." },
    );
  } catch (error: unknown) {
    deleteMessage = error instanceof Error ? error.message : String(error);
  }
  expectTrue(
    deleteMessage === "Only durable document targets can be deleted.",
    "Delete should reject non-durable targets.",
  );

  let featureMissingMessage: string | null = null;
  try {
    await owner.renameTarget(
      {
        kind: "feature",
        featureId:
          "feature_missing" as (typeof snapshot.document.features)[number]["featureId"],
      },
      "Missing feature",
      {
        operation: "Rename feature",
        fallbackMessage: "Rename feature failed.",
      },
    );
  } catch (error: unknown) {
    featureMissingMessage =
      error instanceof Error ? error.message : String(error);
  }
  expectTrue(
    featureMissingMessage === "Could not find feature_missing.",
    "Feature rename should fail when the selected feature is missing.",
  );

  let sketchMissingMessage: string | null = null;
  try {
    await owner.renameTarget(
      {
        kind: "sketch",
        sketchId:
          "sketch_missing" as (typeof snapshot.document.sketches)[number]["sketchId"],
      },
      "Missing sketch",
      { operation: "Rename sketch", fallbackMessage: "Rename sketch failed." },
    );
  } catch (error: unknown) {
    sketchMissingMessage =
      error instanceof Error ? error.message : String(error);
  }
  expectTrue(
    sketchMissingMessage === "Could not find sketch_missing.",
    "Sketch rename should fail when the selected sketch is missing.",
  );

  let unsupportedMessage: string | null = null;
  try {
    await owner.renameTarget(
      {
        kind: "edge",
        bodyId: "body_part-1",
        edgeId: "edge_outer-0",
      } as PrimitiveRef,
      "Unsupported rename",
      { operation: "Rename edge", fallbackMessage: "Rename edge failed." },
    );
  } catch (error: unknown) {
    unsupportedMessage = error instanceof Error ? error.message : String(error);
  }
  expectTrue(
    unsupportedMessage ===
      "Only sketches, features, and bodies can be renamed.",
    "Rename should reject unsupported durable target kinds.",
  );
});

test("document owner forwards history reorder, variable update, and durable delete mutations", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const nextSnapshot = await createSeedDocumentSnapshot();
  const historyItem: DocumentHistoryOrderEntry = {
    kind: "sketch",
    sketchId: snapshot.document.sketches[0]!.sketchId,
  };
  const deleteCalls: PrimitiveRef[] = [];
  const variableUpdates: Array<{
    variableId: string;
    name: string;
    valueText: string;
  }> = [];
  const reorderCalls: Array<{
    item: DocumentHistoryOrderEntry;
    beforeItem: DocumentHistoryOrderEntry | null;
  }> = [];

  const owner = createOwner({
    machineState: { snapshot } as EditorState,
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: null,
      async getCurrentDocumentSnapshot() {
        return nextSnapshot;
      },
      async updateDocumentVariable(input) {
        variableUpdates.push(input);
        return ok({
          revisionState: { kind: "accepted" as const },
          diagnostics: [],
        });
      },
      async reorderDocumentHistory(input) {
        reorderCalls.push({ item: input.item, beforeItem: input.beforeItem });
        return ok({
          revisionState: { kind: "accepted" as const },
          diagnostics: [],
        });
      },
      async deleteTarget(input) {
        deleteCalls.push(input.target);
        return ok({
          revisionState: { kind: "accepted" as const },
          diagnostics: [],
        });
      },
    },
  });

  const variableId =
    "variable_test" as (typeof snapshot.document.variables)[number]["variableId"];
  const variableResult = await owner.updateDocumentVariable(
    variableId,
    { name: "width", valueText: "42 mm" },
    {
      operation: "Update variable",
      fallbackMessage: "Update variable failed.",
    },
  );
  expectTrue(
    variableResult.isOk(),
    "Variable updates should resolve through the accepted mutation path.",
  );
  expectTrue(
    variableUpdates[0]?.variableId === variableId &&
      variableUpdates[0]?.name === "width" &&
      variableUpdates[0]?.valueText === "42 mm",
    "Variable updates should forward the active variable id and requested patch values.",
  );

  const reorderResult = await owner.reorderDocumentHistory(historyItem, null, {
    operation: "Reorder history",
    fallbackMessage: "Reorder history failed.",
  });
  const deleteResult = await owner.deleteTarget(
    { kind: "body", bodyId: snapshot.document.bodies[0]!.bodyId },
    { operation: "Delete body", fallbackMessage: "Delete body failed." },
  );

  expectTrue(
    reorderResult.isOk() && deleteResult.isOk(),
    "History reorder and durable delete flows should resolve successfully.",
  );
  expectTrue(
    reorderCalls[0]?.item === historyItem &&
      reorderCalls[0]?.beforeItem === null,
    "History reorders should forward the selected item and anchor to the modeling service.",
  );
  expectTrue(
    deleteCalls[0]?.kind === "body" &&
      deleteCalls[0].bodyId === snapshot.document.bodies[0]!.bodyId,
    "Durable delete should forward the selected durable target unchanged.",
  );
});

test("document owner handles import provider lookup, diagnostic failures, and successful replay", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const nextSnapshot = await createSeedDocumentSnapshot();
  const provider = createImportProvider({
    prepare: async ({ source, review, selections, capabilities }) => {
      expectTrue(
        source.name === "fixture.step",
        "Import source should be forwarded to the provider.",
      );
      expectTrue(
        (review as ImportReviewEnvelope<{ units: "mm" }>).providerReview
          .units === "mm",
        "Provider review should be forwarded unchanged.",
      );
      expectTrue(
        (selections as { enabled: boolean }).enabled === true,
        "Import selections should be forwarded unchanged.",
      );
      expectTrue(
        capabilities.context.baseRevisionId === snapshot.document.revisionId,
        "Import capabilities should target the active snapshot revision.",
      );
      return {
        addDocumentVariables: [
          {
            name: "scale",
            valueText: "1",
          },
        ],
      };
    },
  });

  const activeImportSession = {
    providerId: provider.id,
    resolvedSource: createResolvedImportSource(),
    review: createImportReview(),
    selections: { enabled: true },
    formSchema: {} as FeatureEditorFormSchema,
    diagnostics: [],
  };

  const mutationCalls: string[] = [];
  const successfulOwner = createOwner({
    machineState: { snapshot } as EditorState,
    importProvider: provider,
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: null,
      async getCurrentDocumentSnapshot() {
        return nextSnapshot;
      },
      async addDocumentVariable(input) {
        mutationCalls.push(input.baseRevisionId);
        return ok({
          revisionId: "rev_after_import",
          variableId: "variable_scale",
          revisionState: "advanced" as const,
          rebuildResult: "reused" as const,
          changedTargets: [],
          diagnostics: [],
        });
      },
      async createFeature() {
        throw new Error(
          "No feature mutations were prepared for this import test.",
        );
      },
      async commitSketch() {
        throw new Error(
          "No sketch mutations were prepared for this import test.",
        );
      },
    },
  });

  const success = await successfulOwner.commitPartImport(activeImportSession);
  expectTrue(
    success.ok,
    "Successful imports should return a committed import result.",
  );
  expectTrue(
    success.ok &&
      success.createdEntityIds.variableIds[0] === "variable_scale" &&
      success.snapshot === nextSnapshot,
    "Successful imports should replay created ids and refresh the snapshot.",
  );
  expectTrue(
    mutationCalls[0] === snapshot.document.revisionId,
    "Prepared import actions should start from the active snapshot revision.",
  );

  const diagnosticsOwner = createOwner({
    machineState: { snapshot } as EditorState,
    importProvider: createImportProvider({
      prepare: async () => ({
        diagnostics: [
          {
            code: "import-blocked",
            severity: "error",
            message: "Geometry could not be reconstructed.",
          },
        ],
      }),
    }),
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: null,
      async getCurrentDocumentSnapshot() {
        throw new Error("Blocked imports should not refresh the snapshot.");
      },
      async addDocumentVariable() {
        throw new Error(
          "Blocked imports should stop before replaying actions.",
        );
      },
      async createFeature() {
        throw new Error(
          "Blocked imports should stop before replaying actions.",
        );
      },
      async commitSketch() {
        throw new Error(
          "Blocked imports should stop before replaying actions.",
        );
      },
    },
  });

  const blocked = await diagnosticsOwner.commitPartImport(activeImportSession);
  expectTrue(
    !blocked.ok,
    "Error-severity import diagnostics should block a successful import result.",
  );
  expectTrue(
    !blocked.ok &&
      blocked.diagnostics[0]?.message ===
        "Geometry could not be reconstructed.",
    "Blocked imports should return the provider diagnostics to the caller.",
  );

  const missingProviderOwner = createOwner({
    machineState: { snapshot } as EditorState,
    importProvider: null,
    modelingService: {
      currentDocumentId: snapshot.document.documentId,
      sketchSolver: null,
    },
  });

  let missingProviderMessage: string | null = null;
  try {
    await missingProviderOwner.commitPartImport(activeImportSession);
  } catch (error: unknown) {
    missingProviderMessage =
      error instanceof Error ? error.message : String(error);
  }
  expectTrue(
    missingProviderMessage ===
      "The selected import provider is no longer registered.",
    "Import commit should fail when the selected provider is no longer registered.",
  );
});
