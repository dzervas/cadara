import { err, ok } from "neverthrow";
import { expect, test } from "vitest";

import boxFixture from "@/domain/modeling/occ/fixtures/topology-signatures/box.payload.json";
import {
  createKernelHistoryProbeSession,
  createMemoizedHistoryProbe,
} from "@/domain/import/kernel-history-probe";
import {
  createOccNativeExactBrepPayloadFromShimPayload,
  parseNativeShimPayloadJson,
} from "@/domain/modeling/occ/native-topology-payload";
import { createImportCapabilities } from "@/domain/import/orchestrator";
import type { BodyId, DocumentId, RevisionId } from "@/contracts/shared/ids";

import type { ImportPreparedActions } from "@/contracts/import/actions";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import { translateSketch } from "@/domain/import/onshape/sketch-translator";
function makeSnapshot(revisionId: RevisionId, bodies: readonly { bodyId: BodyId }[]) {
  return {
    document: {
      documentId: "doc_probe" as DocumentId,
      revisionId,
      bodies: bodies.map((body) => ({ bodyId: body.bodyId })),
    },
  } as never;
}

function makeExactPayload(bodyId: BodyId) {
  return createOccNativeExactBrepPayloadFromShimPayload({
    revisionId: "rev_probe_exact" as RevisionId,
    target: { kind: "body", bodyId },
    bodyId,
    bodyLabel: bodyId,
    nativePayload: parseNativeShimPayloadJson(JSON.stringify(boxFixture.exactBrep)),
  });
}

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

function sketchExtrudeCandidate(documentId: DocumentId): ImportPreparedActions {
  const translation = translateSketch({
    featureId: "probe_square",
    label: "Probe square",
    planeKey: "xy",
    entities: [
      { entityId: "e1", entityType: "lineSegment", start: [-1, -1], end: [1, -1] },
      { entityId: "e2", entityType: "lineSegment", start: [1, -1], end: [1, 1] },
      { entityId: "e3", entityType: "lineSegment", start: [1, 1], end: [-1, 1] },
      { entityId: "e4", entityType: "lineSegment", start: [-1, 1], end: [-1, -1] },
    ],
  });
  return {
    commitSketches: [
      {
        contractVersion: CONTRACT_VERSION,
        documentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        solverCorrelation: {
          requestId: "request_probe_sketch" as never,
          projectionRequestId: "request_probe_sketch_project" as never,
          validationRequestId: "request_probe_sketch_validate" as never,
          solveRequestId: "request_probe_sketch_solve" as never,
          regionRequestId: "request_probe_sketch_regions" as never,
        },
        sketchId: null,
        sketchLabel: "Probe square",
        plane: translation.plane,
        definition: translation.definition,
      },
    ],
    createFeatures: [
      {
        contractVersion: CONTRACT_VERSION,
        documentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        featureLabel: "Probe extrude",
        definition: {
          kind: "extrude",
          featureTypeVersion: "feature-type/extrude/v1alpha2",
          parameters: {
            resultBodyType: "solid",
            profiles: [
              {
                kind: "regionOf",
                actionIndex: 0,
                selector: { kind: "interiorPoint", point: [0, 0] },
              },
            ],
            startExtent: { kind: "profilePlane" },
            extent: {
              mode: "oneSide",
              end: {
                kind: "blind",
                direction: "positive",
                distance: { source: "literal", value: 1 },
              },
            },
            operation: { source: "literal", value: "newBody" },
            booleanScope: { kind: "standalone" },
          },
        },
      },
    ],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
    ],
  };
}


test("kernel history probe materializes deferred sketch-region extrudes", async () => {
  const documentId = "doc_workspace" as DocumentId;
  const service = createModelingService(
    new MockKernelAdapter({ solverAdapter: createRevisionAgnosticRealSolver() }),
    { currentDocumentId: documentId },
  );
  const probe = createKernelHistoryProbeSession({
    service: {
      ...service,
      async buildNativeExactBrepPayload(_input) {
        return {
          kind: "nativeTopologyPayload" as const,
          payload: makeExactPayload("body_signature_fixture_box" as BodyId),
          diagnostics: [],
        };
      },
    },
  });

  const result = await probe.evaluateHistoryProbe({
    actions: sketchExtrudeCandidate(documentId),
  });

  expect(result.steps).toHaveLength(2);
  expect(result.steps[0]?.status).toBe("rebuilt");
  expect(result.steps[1]?.status).toBe("rebuilt");
  expect(
    result.steps[1]?.status === "rebuilt" &&
      result.steps[1].signatures.some((signature) => signature.entityClass === "face"),
    "The extrude step should materialize regionOf inside the probe and contribute solid topology signatures.",
  ).toBeTruthy();
});

test("kernel history probe derives body-only checkpoint signatures from render meshes", async () => {
  const bodyId = "body_checkpoint" as BodyId;
  const probe = createKernelHistoryProbeSession({
    service: {
      async getCurrentDocumentSnapshot() {
        return {
          document: {
            revisionId: "rev_checkpoint" as RevisionId,
            bodies: [{ bodyId, topologyPresentation: "bodyOnlyMesh" }],
            render: {
              records: [{
                ownerBodyId: bodyId,
                geometry: {
                  kind: "mesh",
                  vertexPositions: [[0, 0, 0], [2, 4, 6]],
                },
              }],
            },
          },
        } as never;
      },
      async createFeature() {
        return ok({ changedTargets: [{ kind: "body", bodyId }] }) as never;
      },
      async commitSketch() {
        return ok({}) as never;
      },
      async addDocumentVariable() {
        return ok({}) as never;
      },
      async buildNativeExactBrepPayload() {
        throw new Error("body-only checkpoints must not request native topology");
      },
    },
  });

  const result = await probe.evaluateHistoryProbe({
    actions: { createFeatures: [{ requestId: "request_checkpoint" } as never] },
  });

  expect(result.steps).toEqual([{
    status: "rebuilt",
    signatures: [{
      entityClass: "body",
      geometryType: "solid",
      boundingBox: { low: [0, 0, 0], high: [2, 4, 6] },
      centroid: [1, 2, 3],
      reference: { kind: "body", bodyId },
    }],
  }]);
});

test("kernel history probe rebuilds in the provided isolated session without touching an open document", async () => {
  const openDocumentState = structuredClone(
    makeSnapshot("rev_open" as RevisionId, [{ bodyId: "body_open" as BodyId }]),
  );
  const isolatedCalls: string[] = [];
  let isolatedSnapshot = makeSnapshot("rev_probe_0" as RevisionId, []);
  const probe = createKernelHistoryProbeSession({
    service: {
      async getCurrentDocumentSnapshot() {
        isolatedCalls.push("snapshot");
        return isolatedSnapshot;
      },
      async createFeature() {
        isolatedCalls.push("createFeature");
        isolatedSnapshot = makeSnapshot("rev_probe_1" as RevisionId, [
          { bodyId: "body_probe" as BodyId },
        ]);
        return ok({}) as never;
      },
      async commitSketch() {
        isolatedCalls.push("commitSketch");
        return ok({}) as never;
      },
      async addDocumentVariable() {
        isolatedCalls.push("addDocumentVariable");
        return ok({}) as never;
      },
      async buildNativeExactBrepPayload() {
        isolatedCalls.push("exactBrep");
        return {
          kind: "nativeTopologyPayload",
          payload: makeExactPayload("body_probe" as BodyId),
          diagnostics: [],
        };
      },
    },
  });

  const result = await probe.evaluateHistoryProbe({
    actions: {
      createFeatures: [
        {
          requestId: "request_probe_feature",
          featureId: "feature_probe" as never,
          definition: { kind: "deleteSolid", target: { kind: "body", bodyId: "body_probe" as BodyId } } as never,
        },
      ],
    },
  });

  expect(result.steps).toHaveLength(1);
  expect(result.steps[0]?.status).toBe("rebuilt");
  expect(result.steps[0]?.status === "rebuilt" && result.steps[0].signatures.length > 0).toBeTruthy();
  expect(openDocumentState).toEqual(
    makeSnapshot("rev_open" as RevisionId, [{ bodyId: "body_open" as BodyId }]),
  );
  expect(isolatedCalls).toContain("createFeature");
  expect(isolatedCalls).toContain("exactBrep");
});

test("kernel history probe returns completed prefix results and failing-step diagnostics", async () => {
  let revision = 0;
  const probe = createKernelHistoryProbeSession({
    service: {
      async getCurrentDocumentSnapshot() {
        return makeSnapshot(`rev_probe_${revision}` as RevisionId, [
          { bodyId: "body_probe" as BodyId },
        ]);
      },
      async createFeature() {
        revision += 1;
        if (revision === 1) {
          return ok({}) as never;
        }
        return err(new Error("boom")) as never;
      },
      async commitSketch() {
        return ok({}) as never;
      },
      async addDocumentVariable() {
        return ok({}) as never;
      },
      async buildNativeExactBrepPayload() {
        return {
          kind: "nativeTopologyPayload",
          payload: makeExactPayload("body_probe" as BodyId),
          diagnostics: [],
        };
      },
    },
  });

  const result = await probe.evaluateHistoryProbe({
    actions: {
      createFeatures: [{ requestId: "request_ok" } as never, { requestId: "request_fail" } as never],
    },
  });

  expect(result.steps).toHaveLength(2);
  expect(result.steps[0]?.status).toBe("rebuilt");
  expect(result.steps[1]).toEqual({
    status: "failed",
    diagnostics: [
      {
        severity: "error",
        code: "kernel-history-probe-step-failed",
        message: "History probe failed at step 2: boom",
      },
    ],
  });
});


// Lane: logic (per docs/testing.md — non-UI behavior at an exported domain
// boundary). Seam: the probe's acceptance rule must equal apply's. A kernel
// result whose Result envelope is Ok but that carries an error diagnostic (or a
// non-accepted revision state) is REFUSED by apply via
// `requireAcceptedModelingResult`. If the probe accepted it, review would
// promote a feature that commit then rejects, aborting the whole studio instead
// of baking that one feature. This is the 9841 `Chamfer 2` class: an earlier
// feature's conservative stage history invalidates the edges it selects, which
// surfaces only as an `occ-topology-unsupported-history` error diagnostic.
test("kernel history probe fails a step whose result apply would refuse", async () => {
  const rejectingProbe = (value: unknown) =>
    createKernelHistoryProbeSession({
      service: {
        async getCurrentDocumentSnapshot() {
          return makeSnapshot("rev_probe_reject" as RevisionId, []);
        },
        async createFeature() {
          return ok(value) as never;
        },
        async commitSketch() {
          return ok({}) as never;
        },
        async addDocumentVariable() {
          return ok({}) as never;
        },
        async buildNativeExactBrepPayload() {
          return { kind: "nativeTopologyPayload", payload: makeExactPayload("body_probe" as BodyId), diagnostics: [] };
        },
      },
    });
  const actions = { createFeatures: [{ requestId: "request_rejected" } as never] };

  const invalidated = await rejectingProbe({
    revisionState: { kind: "accepted" },
    diagnostics: [
      {
        severity: "error",
        code: "occ-topology-unsupported-history",
        message: "Chamfer 2 edge selection is incorrect.",
        target: {
          kind: "edge",
          bodyId: "body_probe" as BodyId,
          edgeId: "edge_body_probe_g1",
        },
      },
    ],
  }).evaluateHistoryProbe({ actions });
  expect(invalidated.steps[0]?.status).toBe("failed");
  expect(
    invalidated.steps[0]?.status === "failed"
      ? invalidated.steps[0].diagnostics[0]?.message
      : null,
    "The kernel's own invalidation reason must survive into the probe diagnostic.",
  ).toContain("occ-topology-unsupported-history: Chamfer 2 edge selection is incorrect.");
  // The authored-field message names no reference, so a stage-lineage refusal is
  // unattributable without the refused durable target.
  expect(
    invalidated.steps[0]?.status === "failed"
      ? invalidated.steps[0].diagnostics[0]?.message
      : null,
    "The refused durable target must survive into the probe diagnostic, or the offending entity has to be guessed.",
  ).toContain("[refused target edge edge_body_probe_g1]");

  const rejectedRevision = await rejectingProbe({
    revisionState: { kind: "rejected" },
    diagnostics: [],
  }).evaluateHistoryProbe({ actions });
  expect(rejectedRevision.steps[0]?.status).toBe("failed");

  // An accepted result with only non-error diagnostics still rebuilds, so this
  // does not make the probe pessimistic.
  const accepted = await rejectingProbe({
    revisionState: { kind: "accepted" },
    diagnostics: [{ severity: "warning", code: "noise", message: "noise" }],
  }).evaluateHistoryProbe({ actions });
  expect(accepted.steps[0]?.status).toBe("rebuilt");
});
test("import capabilities expose the real kernel history probe when platform composition supplies it", async () => {
  const probe = createKernelHistoryProbeSession({
    service: {
      async getCurrentDocumentSnapshot() {
        return makeSnapshot("rev_probe_0" as RevisionId, []);
      },
      async createFeature() {
        return ok({}) as never;
      },
      async commitSketch() {
        return ok({}) as never;
      },
      async addDocumentVariable() {
        return ok({}) as never;
      },
      async buildNativeExactBrepPayload() {
        return {
          kind: "nativeTopologyPayload",
          payload: makeExactPayload("body_probe" as BodyId),
          diagnostics: [],
        };
      },
    },
  });
  const snapshot = makeSnapshot("rev_platform" as RevisionId, []);
  const capabilities = createImportCapabilities({} as never, snapshot, { history: probe });

  expect(capabilities.history).toBe(probe);
  await expect(capabilities.history?.evaluateHistoryProbe({ actions: {} })).resolves.toEqual({
    steps: [],
  });
});

// Probe evaluation rebuilds the prefix in a fresh isolated session, so it is a
// pure function of the prepared-action payload. Review probes the same prefix
// many times, and the largest captures cannot afford redundant kernel rebuilds.
test("memoized history probe evaluates each distinct action payload exactly once", async () => {
  let evaluations = 0;
  const memoized = createMemoizedHistoryProbe({
    async evaluateHistoryProbe(input) {
      evaluations += 1;
      return {
        steps: (input.actions.orderedActions ?? []).map(() => ({
          status: "rebuilt" as const,
          signatures: [],
        })),
      };
    },
  });

  const prefix: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }] as never,
    orderedActions: [{ kind: "addDocumentVariable", index: 0 }],
  };
  const first = await memoized.evaluateHistoryProbe({
    actions: prefix,
    consumerFeatureId: "consumer-a",
  });
  const second = await memoized.evaluateHistoryProbe({
    actions: prefix,
    consumerFeatureId: "consumer-b",
  });
  expect(second).toEqual(first);
  expect(evaluations).toBe(1);

  // A changed plan is a changed payload and must miss the cache.
  await memoized.evaluateHistoryProbe({ actions: { ...prefix, commitSketches: [] } });
  expect(evaluations).toBe(2);
  // The whole-plan verification pass asks for tessellation; that is a different
  // request and must not be answered from the prefix entry.
  await memoized.evaluateHistoryProbe({ actions: prefix, includeFinalTessellation: true });
  expect(evaluations).toBe(3);
});

// A failed probe is the input to review's containment pass, which exists to
// change the conditions the probe failed under. Retaining it would freeze the
// failure and skip the re-probe that proves the contained prefix builds.
test("memoized history probe never retains a failed evaluation", async () => {
  let evaluations = 0;
  const memoized = createMemoizedHistoryProbe({
    async evaluateHistoryProbe() {
      evaluations += 1;
      return evaluations === 1
        ? {
            steps: [{
              status: "failed" as const,
              diagnostics: [{
                severity: "error" as const,
                code: "kernel-history-probe-step-failed",
                message: "A prefix feature the kernel refuses.",
              }],
            }],
          }
        : { steps: [{ status: "rebuilt" as const, signatures: [] }] };
    },
  });
  const actions: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }] as never,
    orderedActions: [{ kind: "addDocumentVariable", index: 0 }],
  };

  expect((await memoized.evaluateHistoryProbe({ actions })).steps[0]?.status).toBe("failed");
  expect((await memoized.evaluateHistoryProbe({ actions })).steps[0]?.status).toBe("rebuilt");
  await memoized.evaluateHistoryProbe({ actions });
  expect(evaluations).toBe(2);
});
