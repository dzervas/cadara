// T17k2 (review A-5): importing reference images inside a sketch is a
// private sketch edit (`sketch.referenceImagePayloadsPicked`, pinned in
// `state-machine.spec.ts`); Finish publishes the draft. These rows keep the
// kernel/service side: a draft whose content is an imported image publishes
// and restores. (The import-and-commit flow they used to drive is gone.)
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { test, expect } from "vitest";

import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import type { RevisionId, SketchId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import {
  appendReferenceImageOperations,
  createNewSketchSessionFromSupport,
} from "@/core/editor/sketch-session";
import {
  createModelingService,
  type ModelingService,
} from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { createReferenceImageOperation } from "@/core/reference-image/operations";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";

/** A new Top-plane draft holding one imported image, finished through `service`. */
async function finishImageDraft(service: ModelingService) {
  const snapshot = await service.getCurrentDocumentSnapshot();
  const draft = createNewSketchSessionFromSupport(
    { kind: "construction", constructionId: "construction_plane-xy" },
    OCC_KERNEL_SETTINGS,
  );
  const session = appendReferenceImageOperations(draft, [
    createReferenceImageOperation({
      sequence: draft.sequence + 1,
      sketchId: "sketch_draft" as SketchId,
      payload: {
        mediaType: "image/png",
        fileName: "reference.png",
        pixelWidth: 640,
        pixelHeight: 480,
        base64Data: "cG5n",
      },
    }),
  ]);
  const requestId = "request_sketch-image-draft-finish" as const;
  const committed = await service.commitSketch({
    requestId,
    baseRevisionId: snapshot.document.revisionId,
    ...session.commitRequest!,
    solverCorrelation: service.sketchSolver
      ? service.sketchSolver.createCommitCorrelation(requestId)
      : null,
  });
  if (committed.isErr()) throw new Error(committed.error.message);
  return {
    committed: committed.value,
    snapshot: await service.getCurrentDocumentSnapshot(),
  };
}

test("a finished draft holding an imported image publishes it through the real modeling service", async () => {
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    sketchSolver: new SketchConstraintSolverAdapter({
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
      documentId: "doc_workspace",
      revisionId: null,
    }),
  });
  const { committed, snapshot } = await finishImageDraft(service);

  expect(
    committed.revisionState.kind,
    "A draft holding an imported image should publish through the modeling service.",
  ).toBe("accepted");
  expect(
    snapshot.document.sketches.some(
      (sketch) =>
        sketch.sketchId === committed.sketchId &&
        sketch.sketch.definition.referenceImages?.some(
          (operation) => operation.kind === "referenceImage",
        ),
    ),
    "The published sketch keeps the reference-image operation.",
  ).toBeTruthy();
});

test("OpenCascade publishes and restores an image-only draft sketch", async () => {
  const createSolver = (revisionId: RevisionId | null) =>
    new SketchConstraintSolverAdapter({
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId,
    });
  const createAdapter = () =>
    new OpenCascadeKernelAdapter({
      createSolverAdapter: createSolver,
    });
  const service = createModelingService(createAdapter(), {
    currentDocumentId: OCC_KERNEL_DOCUMENT_ID,
    sketchSolver: createSolver(null),
  });
  const { committed, snapshot } = await finishImageDraft(service);

  expect(
    committed.revisionState.kind,
    "OpenCascade should accept reference-image-only sketch commits.",
  ).toBe("accepted");
  const committedSketch = snapshot.document.sketches.find(
    (sketch) => sketch.sketchId === committed.sketchId,
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
    committedSketch.sketch.definition.referenceImages?.some(
      (operation) => operation.kind === "referenceImage",
    ),
    "OpenCascade snapshot should preserve the reference-image authoring operation.",
  ).toBeTruthy();

  const restoredAdapter = createAdapter();
  await restoredAdapter.restoreAuthoredModelDocument(
    createAuthoredModelDocumentFromSnapshot(snapshot),
  );
  const restoredSnapshot = await restoredAdapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: OCC_KERNEL_DOCUMENT_ID,
  });
  const restoredSketch = restoredSnapshot.snapshot.document.sketches.find(
    (sketch) => sketch.sketchId === committed.sketchId,
  );
  expect(
    restoredSketch?.sketch.definition.referenceImages?.some(
      (operation) => operation.kind === "referenceImage",
    ),
    "OpenCascade authored-document restore should preserve reference-image-only sketches.",
  ).toBeTruthy();
});
