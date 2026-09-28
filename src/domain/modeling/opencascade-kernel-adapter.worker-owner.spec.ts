import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { test, expect } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type {
  CommitSketchResponse,
  GetDocumentSnapshotResponse,
} from "@/contracts/modeling/schema";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import type { OccWorkerSnapshotClient } from "@/domain/modeling/occ/worker-client";
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
} from "@/domain/modeling/opencascade-kernel-seed";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";

test("src/domain/modeling/opencascade-kernel-adapter.worker-owner.spec.ts", async () => {
  async function testWorkerOwnedWarmupAndMutationsBypassLocalOcc() {
    let localOccLoads = 0;
    let warmupCalls = 0;
    let commitSketchCalls = 0;
    let restoreCalls = 0;
    let snapshotCalls = 0;
    const workerClient: OccWorkerSnapshotClient = {
      async warmup() {
        warmupCalls += 1;
      },
      async preload() {
        warmupCalls += 1;
      },
      async restoreAuthoredModelDocument() {
        restoreCalls += 1;
      },
      async validateAuthoredModelDocument() {},
      async exportAuthoredModelDocument(documentId) {
        return {
          contractVersion: "modeling-contract/v1alpha1",
          schemaVersion: "authored-model-document/v1alpha1",
          documentId,
          revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
          settings: {
            linearUnit: "millimeter",
            modelingTolerance: 0.001,
            angularToleranceRadians: 0.01,
          },
          variables: [],
          sketches: [],
          features: [],
          featureOrder: [],
          historyOrder: [],
          cursor: { kind: "empty" },
          bodyLabels: [],
          assets: { records: [] },
          embeddedBinaryAssets: [],
        };
      },
      async releaseDocument() {},
      async getDocumentSnapshot() {
        snapshotCalls += 1;
        return {
          contractVersion: "modeling-contract/v1alpha1",
          snapshot: {
            document: {
              documentId: OCC_KERNEL_DOCUMENT_ID,
              revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
              diagnostics: [],
              settings: {
                linearUnit: "millimeter",
                modelingTolerance: 0.001,
                angularToleranceRadians: 0.01,
              },
              variables: [],
              features: [],
              sketches: [],
              bodies: [],
              constructions: [],
              references: [],
              objects: [],
              featureTree: [],
              documentHistory: [],
              cursor: { kind: "empty" },
              render: { records: [] },
            },
            render: { schemaVersion: "render-export/v1alpha1", records: [] },
          },
        } as GetDocumentSnapshotResponse;
      },
      async projectSketchExternalReferences() {
        return {
          contractVersion: "modeling-contract/v1alpha1",
          projectedReferences: [],
          diagnostics: [],
        };
      },
      async commitSketch() {
        commitSketchCalls += 1;
        return {
          contractVersion: "modeling-contract/v1alpha1",
          documentId: OCC_KERNEL_DOCUMENT_ID,
          revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
          sketchId: "sketch_1",
          changedTargets: [],
          revisionState: {
            kind: "accepted",
            baseRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
          },
          rebuildResult: {
            kind: "rebuilt",
            revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
            invalidatedTargets: [],
            diagnostics: [],
          },
          diagnostics: [],
        } as CommitSketchResponse;
      },
      async createFeature() {
        throw new Error("unused");
      },
      async updateFeature() {
        throw new Error("unused");
      },
      async deleteFeature() {
        throw new Error("unused");
      },
      async deleteTarget() {
        throw new Error("unused");
      },
      async renameBody() {
        throw new Error("unused");
      },
      async reorderFeature() {
        throw new Error("unused");
      },
      async reorderDocumentHistory() {
        throw new Error("unused");
      },
      async setFeatureCursor() {
        throw new Error("unused");
      },
      async addDocumentVariable() {
        throw new Error("unused");
      },
      async updateDocumentVariable() {
        throw new Error("unused");
      },
      async evaluatePreview() {
        throw new Error("unused");
      },
      async resolveReference() {
        throw new Error("unused");
      },
      async getExportCapabilities() {
        throw new Error("unused");
      },
    };

    const adapter = new OpenCascadeKernelAdapter({
      createSolverAdapter: () => new SketchConstraintSolverAdapter({
        neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      }),
      workerSnapshotClient: workerClient,
      getOpenCascadeInstance: async () => {
        localOccLoads += 1;
        throw new Error("local OCC should not load");
      },
      initialSnapshotRequiresRuntime: true,
    });

    await adapter.preloadRuntime();
    const validDocument: AuthoredModelDocument = {
      contractVersion: "modeling-contract/v1alpha1",
      schemaVersion: "authored-model-document/v1alpha1",
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      name: "Untitled",
      settings: {
        linearUnit: "millimeter",
        modelingTolerance: 0.001,
        angularToleranceRadians: 0.01,
      },
      variables: [],
      sketches: [],
      features: [],
      featureOrder: [],
      historyOrder: [],
      cursor: { kind: "empty" },
      bodyLabels: [],
      assets: { schemaVersion: "geometry-asset-manifest/v1alpha1", records: [] },
      embeddedBinaryAssets: [],
    };
    const invalidDocument = structuredClone(validDocument);
    invalidDocument.topologyLineage = [{
      featureId: "feature_missing" as never,
      outputs: [],
    }];
    await expect(
      adapter.restoreAuthoredModelDocument(invalidDocument),
      "The public adapter restore boundary must validate authored invariants before worker delegation.",
    ).rejects.toThrow("Authored topology lineage");
    expect(restoreCalls).toBe(0);

    await adapter.restoreAuthoredModelDocument(validDocument);
    await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: OCC_KERNEL_DOCUMENT_ID,
    });
    await adapter.commitSketch({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: OCC_KERNEL_DOCUMENT_ID,
      requestId: "request_commit_worker_owned",
      baseRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      sketchId: null,
      sketchLabel: "Sketch 1",
      plane: {
        key: "sketch-plane:xy",
        support: { kind: "construction", constructionId: "construction_xy" },
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
        },
      },
      planeTarget: { kind: "construction", constructionId: "construction_xy" },
      planeKey: "sketch-plane:xy",
      definition: {
        schemaVersion: "sketch/v1alpha1",
        points: [],
        entities: [],
        constraints: [],
        dimensions: [],
        referenceIds: [],
        references: [],
      },
      solverCorrelation: null,
    });

    expect(warmupCalls, "Worker-owned preload should warm the shared worker runtime.").toBe(1);
    expect(restoreCalls, "Worker-owned restores should delegate to the worker runtime.").toBe(1);
    expect(
      snapshotCalls,
      "Worker-owned snapshots after restore should delegate to the retained worker runtime.",
    ).toBe(1);
    expect(
      commitSketchCalls,
      "Worker-owned commitSketch should delegate to the worker runtime.",
    ).toBe(1);
    expect(
      localOccLoads,
      "Worker-owned browser mutations should not initialize a local OCC runtime.",
    ).toBe(0);
  }

  async function testEmptySnapshotsDoNotRequireNativeSolidTopologySupport() {
    const adapter = new OpenCascadeKernelAdapter({
      createSolverAdapter: () => new SketchConstraintSolverAdapter({
        neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      }),
      getOpenCascadeInstance: async () => ({}) as never,
      initialSnapshotRequiresRuntime: true,
    });

    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: OCC_KERNEL_DOCUMENT_ID,
    });
    const nativeSnapshot = await adapter.buildNativeTopologySnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: OCC_KERNEL_DOCUMENT_ID,
    });

    expect(
      snapshot.snapshot.document.bodies.length,
      "Empty snapshots should not require solid topology payloads.",
    ).toBe(0);
    expect(
      nativeSnapshot.kind,
      "Explicit native topology requests should still fail loudly when native support is missing.",
    ).toBe("nativeTopologyUnavailable");
  }

  async function testNativeFeatureHistoryRebuildDoesNotCallPublicRestore() {
    let publicRestoreCalls = 0;
    class AdapterWithRejectedPublicRestore extends OpenCascadeKernelAdapter {
      override async restoreAuthoredModelDocument(): Promise<void> {
        publicRestoreCalls += 1;
        throw new Error(
          "executeNativeFeatureHistoryRebuild must not delegate through public restore.",
        );
      }
    }

    const adapter = new AdapterWithRejectedPublicRestore({
      createSolverAdapter: (_revisionId, neutralCurveQueries) =>
        new SketchConstraintSolverAdapter({
          documentId: OCC_KERNEL_DOCUMENT_ID,
          revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
          neutralCurveQueries,
        }),
      getOpenCascadeInstance: async () => ({}) as never,
      initialSnapshotRequiresRuntime: true,
    });
    const document: AuthoredModelDocument = {
      contractVersion: "modeling-contract/v1alpha1",
      schemaVersion: "authored-model-document/v1alpha1",
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      settings: {
        linearUnit: "millimeter",
        modelingTolerance: 0.001,
        angularToleranceRadians: 0.01,
      },
      variables: [],
      sketches: [],
      features: [],
      featureOrder: [],
      historyOrder: [],
      cursor: { kind: "empty" },
      bodyLabels: [],
      assets: { records: [] },
      embeddedBinaryAssets: [],
    };

    const result = await adapter.executeNativeFeatureHistoryRebuild(document);

    expect(
      publicRestoreCalls,
      "Native feature-history rebuild should not call the public restore path.",
    ).toBe(0);
    expect(
      result.kind,
      "Explicit native feature-history rebuild requests should still fail loudly when native support is missing.",
    ).toBe("nativeTopologyUnavailable");
  }

  // Seam: with a worker client, the main-thread adapter answers every
  // neutral-curve query through the worker and never loads OCC for queries.
  async function testNeutralCurveQueriesDelegateToTheWorker() {
    let localOccLoads = 0;
    const forwarded: string[] = [];
    const result = { kind: "uncertain", code: "from-worker", message: "worker" } as const;
    const workerClient = new Proxy({} as OccWorkerSnapshotClient, {
      get(_target, property) {
        if (
          property === "queryNeutralCurves" ||
          property === "queryNeutralCurveSelfIntersections" ||
          property === "queryNeutralCurveJoin"
        ) {
          return async (request: { modelingTolerance: number }) => {
            forwarded.push(`${String(property)}@${request.modelingTolerance}`);
            return result;
          };
        }
        return undefined;
      },
    });
    const adapter = new OpenCascadeKernelAdapter({
      createSolverAdapter: (revisionId, neutralCurveQueries) =>
        new SketchConstraintSolverAdapter({
          documentId: OCC_KERNEL_DOCUMENT_ID,
          revisionId,
          neutralCurveQueries,
        }),
      workerSnapshotClient: workerClient,
      getOpenCascadeInstance: async () => {
        localOccLoads += 1;
        throw new Error("local OCC should not load for queries");
      },
    });
    const circle = {
      curveId: "c",
      provenance: { sourceEntityId: "c", sourceSpanId: "whole" },
      kind: "circle",
      center: [0, 0],
      radius: 1,
      xAxis: [1, 0],
      sourceDomain: { kind: "fullTurn", seam: 0 },
    } as const;
    const other = { ...circle, curveId: "d", center: [1, 0] } as const;
    expect(
      await adapter.queryNeutralCurves({
        modelingTolerance: 0.003,
        first: circle,
        second: other,
      }),
    ).toBe(result);
    expect(
      await adapter.queryNeutralCurveSelfIntersections({
        modelingTolerance: 0.003,
        curve: circle,
      }),
    ).toBe(result);
    expect(
      await adapter.queryNeutralCurveJoin({
        modelingTolerance: 0.003,
        first: circle,
        second: other,
        joins: [{ first: { interior: 1 }, second: { interior: 2 } }],
      }),
    ).toBe(result);
    expect(
      forwarded,
      "All three query operations reach the worker with the request unchanged.",
    ).toEqual([
      "queryNeutralCurves@0.003",
      "queryNeutralCurveSelfIntersections@0.003",
      "queryNeutralCurveJoin@0.003",
    ]);
    expect(
      localOccLoads,
      "Queries on the main thread never initialize a local OCC runtime.",
    ).toBe(0);

    // The production composition (workbench-app): the modeling service's
    // solver takes the kernel adapter as its queries, so a live region
    // derivation reaches the worker through solver -> adapter.
    forwarded.length = 0;
    const solver = new SketchConstraintSolverAdapter({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: null,
      neutralCurveQueries: adapter,
    });
    const sketch = makeSketchFixture();
    sketch.point("p", 0, 0);
    sketch.point("q", 1, 0);
    sketch.circle("c", "p", 1);
    sketch.circle("d", "q", 1);
    const input = sketch.build({ modelingTolerance: 0.003 });
    await solver.deriveSketchRegions({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: "request_worker_owner_regions" as never,
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      sketchId: input.sketchId as never,
      solvedSnapshot: input.solvedSnapshot,
      definition: input.definition,
      projectedReferences: input.projectedReferences,
      modelingTolerance: input.modelingTolerance,
    });
    expect(
      forwarded,
      "deriveSketchRegions through the solver reaches the worker's pair query.",
    ).toContain("queryNeutralCurves@0.003");
    expect(
      localOccLoads,
      "A live region derivation through the solver never loads a local OCC runtime.",
    ).toBe(0);
  }

  await testWorkerOwnedWarmupAndMutationsBypassLocalOcc();
  await testEmptySnapshotsDoNotRequireNativeSolidTopologySupport();
  await testNeutralCurveQueriesDelegateToTheWorker();
  await testNativeFeatureHistoryRebuildDoesNotCallPublicRestore();
});
