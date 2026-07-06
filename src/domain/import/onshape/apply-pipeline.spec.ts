import { test, expect } from "vitest";

import type { ResolvedImportSource } from "@/contracts/import/source";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { assembleFixtureCaptureBundle } from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import { onshapeImportProvider } from "@/domain/import/onshape/provider";
import {
  applyImportPreparedActions,
  createImportCapabilities,
  prepareImportActions,
} from "@/domain/import/orchestrator";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";

// Use the REAL sketch constraint solver (pure TS, always available). It solves
// against any revision, so we delegate each call to an instance configured for
// that request's revision. The mock solver previously masked commit-seam
// defects (dropped geometry, id mismatch) that only the real solver surfaces.
function createRevisionAgnosticRealSolver(): SketchSolverAdapter {
  return new Proxy({} as SketchSolverAdapter, {
    get(_target, property) {
      return (request: { documentId: DocumentId; revisionId: RevisionId }) => {
        const adapter = new SketchConstraintSolverAdapter({
          documentId: request.documentId,
          revisionId: request.revisionId,
        });
        const method = (adapter as unknown as Record<string, unknown>)[
          property as string
        ] as (input: unknown) => unknown;
        return method.call(adapter, request);
      };
    },
  });
}

function sourceFromBundle(bundle: unknown): ResolvedImportSource {
  return {
    name: "mounts.onshape-capture.json",
    origin: { kind: "localFile", fileName: "mounts.onshape-capture.json" },
    mediaType: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify(bundle)),
    fingerprint: `sha256:${"a".repeat(64)}`,
  };
}

// Seam test: prepared actions from a fixture bundle must apply cleanly through
// the *real* modeling service against the mock kernel adapter — the same path
// the workbench commit uses. This is what catches provider-side defects (e.g.
// a null solver correlation) before any UI smoke run.
test("src/domain/import/onshape/apply-pipeline.spec.ts", async () => {
  const adapter = new MockKernelAdapter({
    solverAdapter: createRevisionAgnosticRealSolver(),
  });
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });
  const snapshotResponse = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  });
  const snapshot = snapshotResponse.snapshot;
  const capabilities = createImportCapabilities(service, snapshot);

  const bundle = await assembleFixtureCaptureBundle();
  const source = sourceFromBundle(bundle);

  const review = await onshapeImportProvider.review({ source, capabilities });
  const selections = onshapeImportProvider.createDefaultSelections(review);
  const actions = await prepareImportActions({
    provider: onshapeImportProvider,
    source,
    review,
    selections,
    capabilities,
  });

  // The provider must own solver correlation ids for every sketch commit.
  for (const commit of actions.commitSketches ?? []) {
    expect(
      commit.solverCorrelation !== null &&
        commit.solverCorrelation.requestId.startsWith("request_import_"),
      "Each imported sketch commit should carry provider-owned request_import_ correlation ids.",
    ).toBeTruthy();
  }

  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: snapshot.document.revisionId,
    actions,
  });

  expect(
    result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    "Applying imported actions through the real service must not surface adapter errors.",
  ).toBeTruthy();

  const committedSketches = actions.commitSketches?.length ?? 0;
  expect(
    result.createdEntityIds.sketchIds.length,
    "Every prepared sketch commit should produce a durable sketch through the adapter.",
  ).toBe(committedSketches);
  expect(
    committedSketches,
    "The Mounts fixture should yield at least one parametric sketch commit.",
  ).toBeGreaterThanOrEqual(1);

  // Prove real solved geometry survives translation+projection (not an empty
  // sketch): at least one committed sketch carries a circle entity.
  const hasCircle = (actions.commitSketches ?? []).some((commit) =>
    commit.definition.entities.some((entity) => entity.kind === "circle"),
  );
  expect(
    hasCircle,
    "The translated sketch should contain the circle parsed from the real solved-sketch payload.",
  ).toBeTruthy();
});
