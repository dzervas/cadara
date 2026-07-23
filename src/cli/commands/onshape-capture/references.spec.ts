import { expect, test } from "vitest";

import {
  classifyExactProfileQuery,
  planExactProfileEvidence,
  resolveImmutableHistoryEvidence,
  type SolidExtrudeProfileQueryConsumer,
} from "@/cli/commands/onshape-capture/references";

function fsEncode(value: unknown): unknown {
  if (typeof value === "number" || typeof value === "string") {
    return { btType: `BTFSValue${typeof value === "number" ? "Number" : "String"}`, value };
  }
  if (Array.isArray(value)) {
    return { btType: "BTFSValueArray", value: value.map(fsEncode) };
  }
  return {
    btType: "BTFSValueMap",
    value: Object.entries(value as Record<string, unknown>).map(([key, entry]) => ({
      key: fsEncode(key), value: fsEncode(entry),
    })),
  };
}

function opaqueProfile(rollbackIndex: number): SolidExtrudeProfileQueryConsumer {
  return {
    consumingFeatureId: `E_PROFILE_${rollbackIndex}`,
    queryIndex: 0,
    queryString: 'query = qCompressed(1.0, "opaque-payload", id);',
    rollbackIndex,
    priorSketchFeatureIds: ["S1"],
  };
}

test("references.spec.ts classifies only exact qSketchRegion and opaque qCompressed syntax", () => {
  expect(classifyExactProfileQuery('query = qSketchRegion(id + "S1", true);')).toEqual({
    kind: "sketchRegionSet", sourceSketchFeatureId: "S1", filterInnerLoops: true,
  });
  expect(classifyExactProfileQuery('query = qSketchRegion(id + "S1", false);')).toEqual({
    kind: "sketchRegionSet", sourceSketchFeatureId: "S1", filterInnerLoops: false,
  });
  expect(classifyExactProfileQuery('query = qCompressed(1.0, "opaque-S1-wire", id);')).toEqual({
    kind: "opaque",
  });
  expect(classifyExactProfileQuery('query = qSketchRegion(id + "S1", false)')).toMatchObject({
    kind: "unresolved",
  });
  expect(classifyExactProfileQuery("query = qEverything();")).toMatchObject({ kind: "unresolved" });
});

test("references.spec.ts plans readable and unsupported profiles locally without evaluation", async () => {
  const consumers: SolidExtrudeProfileQueryConsumer[] = [
    { ...opaqueProfile(1), queryString: 'query = qSketchRegion(id + "S1", false);' },
    { ...opaqueProfile(2), queryString: "query = qEverything();" },
  ];
  expect(planExactProfileEvidence(consumers).map(({ plan }) => plan.kind)).toEqual([
    "sketchRegionSet", "unresolved",
  ]);

  const calls: number[] = [];
  const result = await resolveImmutableHistoryEvidence({
    client: {} as never,
    partStudioPath: "/immutable",
    deterministicIdConsumers: [],
    queryStringConsumers: [],
    profileConsumers: consumers,
    evaluate: async (rollbackIndex) => {
      calls.push(rollbackIndex);
      return { result: fsEncode({ entityRecords: [], queryGroups: [], profileGroups: [] }) };
    },
  });

  expect(calls).toEqual([]);
  expect(result.profileEvidence).toEqual([
    expect.objectContaining({ kind: "sketchRegionSet", filterInnerLoops: false }),
    expect.objectContaining({ kind: "unresolved" }),
  ]);
});

test("references.spec.ts retains final records and captures surviving deterministic IDs at their consumer point", async () => {
  const calls: number[] = [];
  const result = await resolveImmutableHistoryEvidence({
    client: {} as never,
    partStudioPath: "/immutable",
    deterministicIdConsumers: [
      { deterministicId: "SURVIVES", consumingFeatureId: "E_CONSUMER", rollbackIndex: 4 },
    ],
    queryStringConsumers: [],
    profileConsumers: [],
    evaluate: async (rollbackIndex) => {
      calls.push(rollbackIndex);
      return {
        result: fsEncode(
          rollbackIndex === -1
            ? [{ id: "SURVIVES", entityClass: "face", geometryType: "plane" }]
            : {
                entityRecords: [{ id: "SURVIVES", entityClass: "face", geometryType: "cylinder" }],
                queryGroups: [],
                profileGroups: [],
              },
        ),
      };
    },
  });

  expect(calls).toEqual([-1, 4]);
  expect(result.resolvedReferences).toEqual([
    expect.objectContaining({
      deterministicId: "SURVIVES",
      evaluatedAt: "finalState",
      signature: expect.objectContaining({ geometryType: "plane" }),
    }),
    expect.objectContaining({
      deterministicId: "SURVIVES",
      consumingFeatureId: "E_CONSUMER",
      evaluatedAt: "historyPoint",
      signature: expect.objectContaining({ geometryType: "cylinder" }),
    }),
  ]);
});

test("references.spec.ts batches all history evidence at shared indices and separates distinct ones", async () => {
  const calls: Array<{ rollbackIndex: number; script: string }> = [];
  await resolveImmutableHistoryEvidence({
    client: {} as never,
    partStudioPath: "/immutable",
    deterministicIdConsumers: [
      { deterministicId: "MISSING", consumingFeatureId: "E_ID", rollbackIndex: 2 },
    ],
    queryStringConsumers: [
      {
        consumingFeatureId: "E_QUERY_SHARED",
        parameterId: "entities",
        queryIndex: 0,
        queryString: 'query = qCompressed(1.0, "query-shared", id);',
        rollbackIndex: 2,
      },
      {
        consumingFeatureId: "E_QUERY_DISTINCT",
        parameterId: "entities",
        queryIndex: 0,
        queryString: 'query = qCompressed(1.0, "query-distinct", id);',
        rollbackIndex: 3,
      },
    ],
    profileConsumers: [opaqueProfile(2)],
    evaluate: async (rollbackIndex, script) => {
      calls.push({ rollbackIndex, script });
      if (rollbackIndex === -1) return { result: fsEncode([]) };
      return {
        result: fsEncode({
          entityRecords: rollbackIndex === 2 ? [{ id: "MISSING", entityClass: "face" }] : [],
          queryGroups: [{ index: 0, records: [{ id: `Q${rollbackIndex}`, entityClass: "edge" }] }],
          profileGroups: rollbackIndex === 2
            ? [{ index: 0, records: [{ resultIndex: 0, id: "P2", kind: "unresolved", reason: "fixture" }] }]
            : [],
        }),
      };
    },
  });

  expect(calls.map((call) => call.rollbackIndex)).toEqual([-1, 2, 3]);
  expect(calls[1]!.script).toContain("query-shared");
  expect(calls[1]!.script).toContain("opaque-payload");
  expect(calls[1]!.script.match(/qEverything/g)).toHaveLength(1);
  expect(calls[2]!.script).toContain("query-distinct");
  expect(calls[2]!.script).not.toContain("query-shared");
});
