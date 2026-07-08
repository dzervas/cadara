import { err, ok } from "neverthrow";
import { expect, test } from "vitest";

import boxFixture from "@/domain/modeling/occ/fixtures/topology-signatures/box.payload.json";
import { createKernelHistoryProbeSession } from "@/domain/import/kernel-history-probe";
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
          featureTypeVersion: "feature-type/extrude/v1alpha1",
          parameters: {
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
