import { test, expect } from "vitest";

import { runSketchImageImportFlow } from "@/domain/reference-image/import-flow";
import { ResultAsync, createAppError } from "@/contracts/errors";
import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import type { ReferenceImagePayload } from "@/contracts/reference-image/schema";
import type { RevisionId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import {
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
} from "@/domain/editor/sketch-session";
import {
  createModelingService,
  type ModelingCommitSketchInput,
  type ModelingService,
} from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { OCC_KERNEL_DOCUMENT_ID } from "@/domain/modeling/opencascade-kernel-seed";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

test("src/app/cad-workbench-sketch-image-import.spec.ts", async () => {
  const seedService = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
  });
  const snapshot = await seedService.getCurrentDocumentSnapshot();
  const sourceSketch = snapshot.document.sketches[0];
  expect(
    sourceSketch,
    "Seed sketch should exist for sketch image-import coverage.",
  ).toBeTruthy();

  const session = createSketchSessionFromSnapshot(sourceSketch);
  expect(
    session.commitRequest,
    "Active sketch sessions should expose a commit request.",
  ).toBeTruthy();

  const expectedPayload: ReferenceImagePayload = {
    mediaType: "image/png",
    fileName: "reference.png",
    pixelWidth: 640,
    pixelHeight: 480,
    base64Data: "cG5n",
  };
  const callOrder: string[] = [];
  const pickerCalls: Array<{
    multiple?: boolean;
    acceptedFileTypes: ReadonlyArray<{ extension: string; mediaType: string }>;
  }> = [];
  let capturedCommitInput: ModelingCommitSketchInput | null = null;

  const wrappedModelingService: Pick<
    ModelingService,
    "commitSketch" | "getCurrentDocumentSnapshot" | "sketchSolver"
  > = {
    sketchSolver: null,
    commitSketch(input) {
      callOrder.push("commitSketch");
      capturedCommitInput = input;
      return ResultAsync.fromPromise(
        Promise.resolve({
          revisionId: "rev_0002",
          sketchId: input.sketchId ?? sourceSketch.sketchId,
          revisionState: { kind: "accepted" as const },
          rebuildResult: "reused" as const,
          changedTargets: [],
          diagnostics: [],
        }),
        (error) =>
          createAppError({
            code: "test/commit-sketch",
            message: String(error),
          }),
      );
    },
    getCurrentDocumentSnapshot() {
      callOrder.push("getCurrentDocumentSnapshot");
      expect(
        capturedCommitInput,
        "Committed sketch input should exist before refreshing the snapshot.",
      ).toBeTruthy();
      const nextSketches = snapshot.document.sketches.map((sketch) =>
        sketch.sketchId === sourceSketch.sketchId
          ? {
              ...sketch,
              sketch: {
                ...sketch.sketch,
                definition: capturedCommitInput.definition,
              },
            }
          : sketch,
      );

      return Promise.resolve({
        ...snapshot,
        revisionId: "rev_0002",
        sketches: nextSketches,
        document: {
          ...snapshot.document,
          revisionId: "rev_0002",
          sketches: nextSketches,
        },
      });
    },
  };

  const result = await runSketchImageImportFlow({
    session,
    snapshot,
    modelingService: wrappedModelingService,
    pickFiles: async (input) => {
      callOrder.push("pickFiles");
      pickerCalls.push(input);
      return {
        ok: true,
        files: [new File(["png"], "reference.png", { type: "image/png" })],
      };
    },
    readPayload: async () => {
      callOrder.push("readPayload");
      return expectedPayload;
    },
  });

  expect(
    pickerCalls[0]?.multiple === true &&
      pickerCalls[0]?.acceptedFileTypes.length > 0,
    "Sketch image import should open the direct reference-image picker with multi-file support.",
  ).toBeTruthy();
  const pickFilesIndex = callOrder.indexOf("pickFiles");
  const readPayloadIndex = callOrder.indexOf("readPayload");
  const commitSketchIndex = callOrder.indexOf("commitSketch");
  const snapshotRefreshIndex = callOrder.indexOf("getCurrentDocumentSnapshot");
  expect(
    pickFilesIndex === 0 &&
      readPayloadIndex > pickFilesIndex &&
      commitSketchIndex > readPayloadIndex &&
      snapshotRefreshIndex > commitSketchIndex,
    "Sketch image import should read inline payloads, commit the sketch, then refresh the snapshot.",
  ).toBeTruthy();
  expect(
    result.kind,
    "Sketch image import should commit accepted inline reference images.",
  ).toBe("committed");
  expect(
    capturedCommitInput,
    "Sketch image import should commit through modelingService.commitSketch.",
  ).toBeTruthy();
  const committedInput = capturedCommitInput;

  const baselineDefinition = session.commitRequest.definition;
  expect(
    committedInput.definition.pointIds.length ===
      baselineDefinition.pointIds.length &&
      committedInput.definition.entityIds.length ===
        baselineDefinition.entityIds.length &&
      committedInput.definition.constraintIds.length ===
        baselineDefinition.constraintIds.length &&
      committedInput.definition.dimensionIds.length ===
        baselineDefinition.dimensionIds.length,
    "Sketch image import should not route through sketch point/entity/constraint materialization.",
  ).toBeTruthy();

  const importedOperation = committedInput.definition.authoringOperations?.find(
    (operation) => operation.kind === "referenceImage",
  );
  expect(
    importedOperation?.kind,
    "Sketch image import should commit a reference-image authoring operation in the sketch payload.",
  ).toBe("referenceImage");
  expect(
    JSON.stringify({
      operationId: importedOperation?.operationId,
      label: "reference.png",
      kind: "referenceImage",
      targets: {
        created: [
          {
            kind: "operation",
            operationId: importedOperation?.operationId,
          },
        ],
      },
      ownedState: {
        kind: "referenceImage",
        image: expectedPayload,
        placement: {
          center: [0, 0],
          width: 200,
          height: 150,
          rotationRadians: 0,
        },
      },
    }),
    "Sketch image import should commit the full inline reference-image payload and centered placement state.",
  ).toBe(
    JSON.stringify({
      operationId: importedOperation?.operationId,
      label: importedOperation?.label,
      kind: importedOperation?.kind,
      targets: importedOperation?.targets,
      ownedState: importedOperation?.ownedState && {
        kind: importedOperation.ownedState.kind,
        image: importedOperation.ownedState.image,
        placement: importedOperation.ownedState.placement,
      },
    }),
  );
  expect(
    result.reopenRequest.type === "authoring.reopenRequested" &&
      result.reopenRequest.target.kind === "sketch" &&
      result.reopenRequest.target.sketchId === result.sketchId &&
      result.reopenRequest.toolId === "sketch",
    "Sketch image import should return the sketch reopen request needed to keep the editor in sketch mode after commit.",
  ).toBeTruthy();
  expect(
    result.snapshot.document.sketches.some(
      (sketch) =>
        sketch.sketchId === result.sketchId &&
        sketch.sketch.definition.authoringOperations?.some(
          (operation) =>
            operation.kind === "referenceImage" &&
            operation.ownedState?.kind === "referenceImage" &&
            operation.ownedState.image.base64Data ===
              expectedPayload.base64Data,
        ),
    ),
    "Sketch image import should refresh to a snapshot that preserves the committed inline reference-image payload.",
  ).toBeTruthy();
});

test("src/app/cad-workbench-sketch-image-import.spec.ts imports into a new draft sketch through the real modeling service", async () => {
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    sketchSolver: new SketchConstraintSolverAdapter({
      documentId: "doc_workspace",
      revisionId: null,
    }),
  });
  const snapshot = await service.getCurrentDocumentSnapshot();
  const session = createNewSketchSessionFromSupport({
    kind: "construction",
    constructionId: "construction_plane-xy",
  });

  const result = await runSketchImageImportFlow({
    requestId: "request_sketch-reference-image-import-test" as const,
    baseRevisionId: snapshot.document.revisionId,
    session,
    snapshot,
    modelingService: service,
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
    result.kind,
    "Importing into a new draft sketch should commit successfully through the modeling service.",
  ).toBe("committed");
  expect(
    result.snapshot.document.sketches.some(
      (sketch) =>
        sketch.sketchId === result.sketchId &&
        sketch.sketch.definition.authoringOperations?.some(
          (operation) => operation.kind === "referenceImage",
        ),
    ),
    "A committed draft-sketch import should persist the reference-image operation into the reopened sketch snapshot.",
  ).toBeTruthy();
});

test("src/app/cad-workbench-sketch-image-import.spec.ts imports image-only draft sketches through OpenCascade", async () => {
  const createSolver = (revisionId: RevisionId | null) =>
    new SketchConstraintSolverAdapter({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId,
    });
  const createAdapter = () =>
    new OpenCascadeKernelAdapter({
      solverAdapter: createSolver(null),
      solverAdapterFactory: createSolver,
    });
  const service = createModelingService(createAdapter(), {
    currentDocumentId: OCC_KERNEL_DOCUMENT_ID,
    sketchSolver: createSolver(null),
  });
  const snapshot = await service.getCurrentDocumentSnapshot();
  const session = createNewSketchSessionFromSupport({
    kind: "construction",
    constructionId: "construction_plane-xy",
  });

  const result = await runSketchImageImportFlow({
    requestId: "request_sketch-reference-image-import-occ-test" as const,
    baseRevisionId: snapshot.document.revisionId,
    session,
    snapshot,
    modelingService: service,
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
    result.kind,
    "OpenCascade should accept reference-image-only sketch commits.",
  ).toBe("committed");
  const committedSketch = result.snapshot.document.sketches.find(
    (sketch) => sketch.sketchId === result.sketchId,
  );
  expect(
    committedSketch,
    "Committed reference-image sketch should exist in the refreshed OpenCascade snapshot.",
  ).toBeTruthy();
  expect(
    committedSketch.sketch.solvedSnapshot.status.solveState,
    "Reference-image-only sketches should persist without requiring solved sketch geometry.",
  ).toBe("notEvaluated");
  expect(
    committedSketch.sketch.definition.authoringOperations?.some(
      (operation) => operation.kind === "referenceImage",
    ),
    "OpenCascade snapshot should preserve the reference-image authoring operation.",
  ).toBeTruthy();

  const restoredAdapter = createAdapter();
  await restoredAdapter.restoreAuthoredModelDocument(
    createAuthoredModelDocumentFromSnapshot(result.snapshot),
  );
  const restoredSnapshot = await restoredAdapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: OCC_KERNEL_DOCUMENT_ID,
  });
  const restoredSketch = restoredSnapshot.snapshot.document.sketches.find(
    (sketch) => sketch.sketchId === result.sketchId,
  );
  expect(
    restoredSketch?.sketch.definition.authoringOperations?.some(
      (operation) => operation.kind === "referenceImage",
    ),
    "OpenCascade authored-document restore should preserve reference-image-only sketches.",
  ).toBeTruthy();
});

test("src/app/cad-workbench-sketch-image-import.spec.ts refreshes stale revision basis and retries one conflict", async () => {
  const seedService = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
  });
  const seedSnapshot = await seedService.getCurrentDocumentSnapshot();
  const sourceSketch = seedSnapshot.document.sketches[0];
  expect(
    sourceSketch,
    "Seed sketch should exist for stale-basis import coverage.",
  ).toBeTruthy();

  const session = createSketchSessionFromSnapshot(sourceSketch);
  const importedPayload: ReferenceImagePayload = {
    mediaType: "image/png",
    fileName: "reference.png",
    pixelWidth: 640,
    pixelHeight: 480,
    base64Data: "cG5n",
  };
  const staleInputRevision = "rev_0001" as const;
  const commitBaseRevisionIds: string[] = [];
  let snapshotReads = 0;

  const currentSnapshot = {
    ...seedSnapshot,
    revisionId: "rev_0002" as const,
    provenance: {
      repositoryHeads: ["head_2"] as const,
    },
    document: {
      ...seedSnapshot.document,
      revisionId: "rev_0002" as const,
    },
  };
  const retrySnapshot = {
    ...currentSnapshot,
    revisionId: "rev_0003" as const,
    provenance: {
      repositoryHeads: ["head_3"] as const,
    },
    document: {
      ...currentSnapshot.document,
      revisionId: "rev_0003" as const,
    },
  };

  const wrappedModelingService: Pick<
    ModelingService,
    "commitSketch" | "getCurrentDocumentSnapshot" | "sketchSolver"
  > = {
    sketchSolver: null,
    commitSketch(input) {
      commitBaseRevisionIds.push(input.baseRevisionId);

      if (commitBaseRevisionIds.length === 1) {
        return ResultAsync.fromPromise(
          Promise.resolve({
            revisionId: "rev_0003" as const,
            sketchId: input.sketchId ?? sourceSketch.sketchId,
            revisionState: {
              kind: "conflict" as const,
              expectedRevisionId: input.baseRevisionId,
              actualRevisionId: "rev_0003" as const,
            },
            rebuildResult: {
              kind: "skipped" as const,
              reasonCode: "revisionConflict" as const,
              invalidatedTargets: [],
              diagnostics: [
                {
                  code: "repository-head-conflict",
                  severity: "error" as const,
                  message:
                    "Request revision rev_0002 does not match current revision rev_0003.",
                  target: null,
                  detail: {
                    kind: "revisionConflict" as const,
                    expectedRevisionId: "rev_0002" as const,
                    actualRevisionId: "rev_0003" as const,
                  },
                },
              ],
            },
            changedTargets: [],
            diagnostics: [
              {
                code: "repository-head-conflict",
                severity: "error" as const,
                message:
                  "Request revision rev_0002 does not match current revision rev_0003.",
                target: null,
                detail: {
                  kind: "revisionConflict" as const,
                  expectedRevisionId: "rev_0002" as const,
                  actualRevisionId: "rev_0003" as const,
                },
              },
            ],
          }),
          (error) =>
            createAppError({
              code: "test/commit-sketch",
              message: String(error),
            }),
        );
      }

      return ResultAsync.fromPromise(
        Promise.resolve({
          revisionId: "rev_0003" as const,
          sketchId: input.sketchId ?? sourceSketch.sketchId,
          revisionState: { kind: "accepted" as const },
          rebuildResult: "reused" as const,
          changedTargets: [],
          diagnostics: [],
        }),
        (error) =>
          createAppError({
            code: "test/commit-sketch",
            message: String(error),
          }),
      );
    },
    getCurrentDocumentSnapshot() {
      snapshotReads += 1;
      return Promise.resolve(
        snapshotReads === 1 ? retrySnapshot : retrySnapshot,
      );
    },
  };

  const result = await runSketchImageImportFlow({
    requestId: "request_sketch-reference-image-import-stale" as const,
    baseRevisionId: staleInputRevision,
    baseRepositoryHeads: ["head_1"] as const,
    session,
    snapshot: currentSnapshot,
    modelingService: wrappedModelingService,
    payloads: [importedPayload],
  });

  expect(
    result.kind,
    "A stale import basis should refresh and retry to complete the import.",
  ).toBe("committed");
  expect(
    JSON.stringify(commitBaseRevisionIds),
    "Sketch image import should commit against the current snapshot revision first, then retry once with the refreshed revision after a conflict.",
  ).toBe(JSON.stringify(["rev_0002", "rev_0003"]));
});
