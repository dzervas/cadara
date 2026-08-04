import { expect, test } from "vitest";

import type { ImportPreparedActions } from "@/contracts/import/actions";
import type { ImportHistoryProbeCapabilities } from "@/contracts/import/capabilities";
import { probeTopologyConsumerPrefixes } from "@/domain/import/onshape/topology-resolution-planner";

test("batches duplicate and zero consumer boundaries against one longest prefix", async () => {
  const actions: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }, { name: "b" }, { name: "c" }] as never,
    orderedActions: [
      { kind: "addDocumentVariable", index: 0 },
      { kind: "addDocumentVariable", index: 1 },
      { kind: "addDocumentVariable", index: 2 },
    ],
  };
  const calls: unknown[] = [];
  const results = await probeTopologyConsumerPrefixes({
    actions,
    featureIdToOrderedPrefixPosition: new Map([
      ["consumer-zero", 0],
      ["consumer-a", 1],
      ["consumer-b", 3],
    ]),
    consumerFeatureIds: ["consumer-zero", "consumer-a", "consumer-a", "consumer-b"],
    history: {
      async evaluateHistoryProbe(input) {
        calls.push({
          count: input.actions.orderedActions?.length ?? 0,
          requestedSignatureStepOrdinals: input.requestedSignatureStepOrdinals,
          containTopologyRematchFailures: input.containTopologyRematchFailures,
        });
        const actionCount = input.actions.orderedActions?.length ?? 0;
        return {
          steps: actionCount === 0
            ? [{ status: "rebuilt" as const, signatures: [{ baseline: true } as never] }]
            : Array.from({ length: actionCount }, (_, ordinal) => ({
                status: "rebuilt" as const,
                signatures: [{ ordinal } as never],
              })),
        };
      },
    },
  });

  expect(calls).toEqual([
    {
      count: 0,
      requestedSignatureStepOrdinals: [],
      containTopologyRematchFailures: true,
    },
    {
      count: 3,
      requestedSignatureStepOrdinals: [0, 2],
      containTopologyRematchFailures: true,
    },
  ]);
  expect(results).toMatchObject([
    { consumerFeatureId: "consumer-zero", orderedPosition: 0, status: "rebuilt", signatures: [{ baseline: true }] },
    { consumerFeatureId: "consumer-a", orderedPosition: 1, status: "rebuilt", signatures: [{ ordinal: 0 }] },
    { consumerFeatureId: "consumer-a", orderedPosition: 1, status: "rebuilt", signatures: [{ ordinal: 0 }] },
    { consumerFeatureId: "consumer-b", orderedPosition: 3, status: "rebuilt", signatures: [{ ordinal: 2 }] },
  ]);
});

test("preserves earlier sampled boundaries when the longest prefix fails later", async () => {
  const actions: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }, { name: "b" }, { name: "c" }] as never,
    orderedActions: [
      { kind: "addDocumentVariable", index: 0 },
      { kind: "addDocumentVariable", index: 1 },
      { kind: "addDocumentVariable", index: 2 },
    ],
  };
  const failure = {
    severity: "error" as const,
    code: "topology-apply-rematch-failed",
    message: "exact rematch detail",
  };
  const results = await probeTopologyConsumerPrefixes({
    actions,
    featureIdToOrderedPrefixPosition: new Map([
      ["before", 1],
      ["at-failure", 2],
      ["after-failure", 3],
    ]),
    consumerFeatureIds: ["before", "at-failure", "after-failure"],
    history: {
      async evaluateHistoryProbe() {
        return {
          steps: [
            { status: "rebuilt" as const, signatures: [{ ordinal: 0 } as never] },
            { status: "failed" as const, diagnostics: [failure] },
          ],
        };
      },
    },
  });

  expect(results).toMatchObject([
    { consumerFeatureId: "before", status: "rebuilt", signatures: [{ ordinal: 0 }] },
    { consumerFeatureId: "at-failure", status: "failed", diagnostics: [failure] },
    { consumerFeatureId: "after-failure", status: "failed", diagnostics: [failure] },
  ]);
});

test("propagates a non-rematch probe failure from a consumer prefix", async () => {
  const actions: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }] as never,
    orderedActions: [{ kind: "addDocumentVariable", index: 0 }],
  };
  await expect(
    probeTopologyConsumerPrefixes({
      actions,
      featureIdToOrderedPrefixPosition: new Map([["consumer-a", 1]]),
      consumerFeatureIds: ["consumer-a"],
      history: {
        async evaluateHistoryProbe() {
          throw new Error("kernel session lost");
        },
      },
    }),
  ).rejects.toThrow("kernel session lost");
});

// Lane: logic. Seam: prefix planning forwards fresh-service isolation independently
// from whether historical signature steps are requested.
test("forwards requireFreshExecution independently of historical sampling", async () => {
  const forwarded: Array<{ fresh: boolean | undefined; requested: number[] | null | undefined }> = [];
  const actions: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }] as never,
    orderedActions: [{ kind: "addDocumentVariable", index: 0 }],
  };
  const history = {
    async evaluateHistoryProbe(input: Parameters<NonNullable<ImportHistoryProbeCapabilities["evaluateHistoryProbe"]>>[0]) {
      forwarded.push({
        fresh: input.requireFreshExecution,
        requested: input.requestedSignatureStepOrdinals,
      });
      return { steps: [{ status: "rebuilt" as const, signatures: [] }] };
    },
  };

  await probeTopologyConsumerPrefixes({
    actions,
    featureIdToOrderedPrefixPosition: new Map([["consumer", 1]]),
    consumerFeatureIds: ["consumer"],
    history,
    includeHistoricalSignatures: false,
    requireFreshExecution: true,
  });
  await probeTopologyConsumerPrefixes({
    actions,
    featureIdToOrderedPrefixPosition: new Map([["consumer", 1]]),
    consumerFeatureIds: ["consumer"],
    history,
    includeHistoricalSignatures: true,
    requireFreshExecution: false,
  });

  expect(forwarded).toEqual([
    { fresh: true, requested: [0] },
    { fresh: false, requested: [0, 0] },
  ]);
});
