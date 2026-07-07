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
