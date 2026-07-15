import { expect, test } from "vitest";

import type { OnshapeFeatureNode } from "@/domain/import/onshape/bundle-reader";
import { readTopologyQueryRefs, type TopologyQuerySlot } from "@/domain/import/onshape/topology-query-reader";

const bodySlot = (parameterId: string): TopologyQuerySlot => ({
  key: "bodies",
  parameterId,
  role: "body",
  expectedKinds: ["body"],
  cardinality: { min: 1, max: null },
});

const deletePart1: OnshapeFeatureNode = {
  featureId: "FBJ2f99buwMPxgO_1",
  featureType: "deleteBodies",
  parameters: [
    {
      btType: "BTMParameterQueryList-148",
      parameterId: "entities",
      queries: [
        { btType: "BTMIndividualQuery-138", queryString: "query=qCompressed(...);", deterministicIds: ["J5D"] },
        { btType: "BTMIndividualQuery-138", queryString: "query=qCompressed(...);", deterministicIds: ["J5H"] },
      ],
    },
    {
      btType: "BTMParameterQueryList-148",
      parameterId: "nonCompositeEntities",
      queries: [
        { btType: "BTMIndividualQuery-138", queryString: "query=qCompressed(...);", deterministicIds: ["J5D"] },
        { btType: "BTMIndividualQuery-138", queryString: "query=qCompressed(...);", deterministicIds: ["J5H"] },
      ],
    },
  ],
};

test("preserves chamfer query order and deterministic-ID order", () => {
  const feature: OnshapeFeatureNode = {
    featureId: "FqXExmahcCNDI8A_1",
    featureType: "chamfer",
    parameters: [{
      btType: "BTMParameterQueryList-148",
      parameterId: "entities",
      queries: [{
        btType: "BTMIndividualQuery-138",
        queryStatement: null,
        queryString: "query=qCompressed(...);",
        nodeId: "FC0Sfh6tzxLeC7w",
        deterministicIds: ["KMhB", "second-edge"],
      }],
    }],
  };
  const result = readTopologyQueryRefs(feature, [{
    key: "edgeTargets",
    parameterId: "entities",
    role: "edge",
    expectedKinds: ["edge"],
    cardinality: { min: 1, max: null },
  }]);
  expect(result.refs.map((ref) => ref.deterministicId)).toEqual(["KMhB", "second-edge"]);
  expect(result.diagnostics).toEqual([]);
});

test("reads only active Boolean 1 slots and ignores inactive offset queries", () => {
  const feature: OnshapeFeatureNode = {
    featureId: "FThhOjyWzjnevIO_1",
    featureType: "booleanBodies",
    parameters: [
      { btType: "BTMParameterQueryList-148", parameterId: "tools", queries: [{ deterministicIds: ["JbD"] }] },
      { btType: "BTMParameterQueryList-148", parameterId: "targets", queries: [{ deterministicIds: ["JbH"] }] },
      { btType: "BTMParameterBoolean-144", parameterId: "offset", value: false },
      { btType: "BTMParameterQueryList-148", parameterId: "entitiesToOffset", queries: [{ deterministicIds: ["J1q"] }, { deterministicIds: ["J1S"] }] },
    ],
  };
  const result = readTopologyQueryRefs(feature, [
    { ...bodySlot("tools"), key: "tools", role: "toolBody" },
    { ...bodySlot("targets"), key: "targets", role: "targetBody" },
  ]);
  expect(result.refs.map((ref) => ref.deterministicId)).toEqual(["JbD", "JbH"]);
});

test("deduplicates Delete part 1 aliases by semantic role without changing order", () => {
  const result = readTopologyQueryRefs(deletePart1, [
    bodySlot("entities"),
    bodySlot("nonCompositeEntities"),
  ]);
  expect(result.refs.map((ref) => ref.deterministicId)).toEqual(["J5D", "J5H"]);
  expect(result.diagnostics).toEqual([]);
});

test("reports malformed deterministic IDs and cardinality mismatches", () => {
  const result = readTopologyQueryRefs({
    featureId: "bad",
    featureType: "chamfer",
    parameters: [{ parameterId: "entities", queries: [{ deterministicIds: [42] }] }],
  }, [{
    key: "edges",
    parameterId: "entities",
    role: "edge",
    expectedKinds: ["edge"],
    cardinality: { min: 2, max: 2 },
  }]);
  expect(result.refs).toEqual([]);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "topology-query-unreadable",
    "topology-query-unreadable",
  ]);
});
