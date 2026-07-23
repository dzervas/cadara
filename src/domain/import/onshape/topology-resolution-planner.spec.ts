import { expect, test } from "vitest";

import type { ImportPreparedActions } from "@/contracts/import/actions";
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
