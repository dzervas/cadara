import { expect, test } from "vitest";

import type { ImportPreparedActions } from "@/contracts/import/actions";
import { TopologyApplyRematchError } from "@/domain/import/orchestrator";
import { probeTopologyConsumerPrefixes } from "@/domain/import/onshape/topology-resolution-planner";

test("probes each topology consumer's prefix with stable consumer correlation", async () => {
  const actions: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }, { name: "b" }, { name: "c" }] as never,
    orderedActions: [
      { kind: "addDocumentVariable", index: 0 },
      { kind: "addDocumentVariable", index: 1 },
      { kind: "addDocumentVariable", index: 2 },
    ],
  };
  const calls: { consumerFeatureId: string | undefined; count: number; final: boolean | undefined }[] = [];
  const results = await probeTopologyConsumerPrefixes({
    actions,
    featureIdToOrderedPrefixPosition: new Map([
      ["consumer-a", 1],
      ["consumer-b", 3],
    ]),
    consumerFeatureIds: ["consumer-a", "consumer-a", "consumer-b"],
    history: {
      async evaluateHistoryProbe(input) {
        const count = input.actions.orderedActions?.length ?? 0;
        calls.push({
          consumerFeatureId: input.consumerFeatureId,
          count,
          final: input.includeFinalTessellation,
        });
        return {
          steps: Array.from({ length: count }, () => ({
            status: "rebuilt" as const,
            signatures: [],
          })),
        };
      },
    },
  });

  expect(calls).toEqual([
    { consumerFeatureId: "consumer-a", count: 1, final: false },
    { consumerFeatureId: "consumer-a", count: 1, final: false },
    { consumerFeatureId: "consumer-b", count: 3, final: false },
  ]);
  expect(results.map((result) => result.orderedPosition)).toEqual([1, 1, 3]);
});

// A pre-consumer prefix is a reduced action list (bake checkpoints are
// suppressed for sub-topology consumers), so an unrelated feature's apply-time
// rematch failing inside it is a probe-session artifact. It must be reported as
// a failed prefix for the probed consumer instead of propagating, which would
// force-bake that unrelated feature for the whole studio.
test("contains an unrelated feature's apply-time rematch failure as a failed prefix", async () => {
  const actions: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }] as never,
    orderedActions: [{ kind: "addDocumentVariable", index: 0 }],
  };
  const selector = {
    kind: "topologyOf" as const,
    expectedKind: "body" as const,
    capturedSignature: {} as never,
    tolerance: {} as never,
    source: {
      consumerFeatureId: "other-feature",
      parameterId: "parts",
      deterministicId: "JND",
    },
  };
  const results = await probeTopologyConsumerPrefixes({
    actions,
    featureIdToOrderedPrefixPosition: new Map([["consumer-a", 1]]),
    consumerFeatureIds: ["consumer-a"],
    history: {
      async evaluateHistoryProbe() {
        throw new TopologyApplyRematchError(selector, "live prefix 0: empty");
      },
    },
  });

  expect(results).toEqual([
    {
      consumerFeatureId: "consumer-a",
      orderedPosition: 1,
      status: "failed",
      signatures: [],
      diagnostics: [
        {
          severity: "error",
          code: "topology-apply-rematch-failed",
          message:
            "The pre-consumer prefix probe could not materialize other-feature:parts:JND: live prefix 0: empty",
        },
      ],
    },
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
