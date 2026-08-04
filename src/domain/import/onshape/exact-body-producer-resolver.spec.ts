import { expect, test } from "vitest";

import { resolveExactBodyProducerBindings } from "@/domain/import/onshape/exact-body-producer-resolver";
import { createRollbackTopologyTimeline } from "@/domain/import/onshape/rollback-topology-reader";

const snapshotBodies = (bodyIds: readonly string[], faceSuffix: string) => ({
  bodies: bodyIds.map((id) => ({
    id,
    faces: [{
      id: `${id}-${faceSuffix}`,
      facets: [{ vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ] }],
    }],
  })),
});

function resolve(input: {
  featureIds: readonly string[];
  snapshots: readonly { featureId: string; bodyIds: readonly string[]; faceSuffix: string }[];
  deterministicId?: string;
  actions?: ReadonlyMap<string, number>;
}) {
  return resolveExactBodyProducerBindings({
    featureIds: input.featureIds,
    consumerFeatureId: "consumer",
    queries: [{
      consumerFeatureId: "consumer",
      slotKey: "targetBody",
      parameterId: "targetBody",
      queryIndex: 0,
      deterministicId: input.deterministicId ?? "JND",
      queryString: null,
      expectedKinds: ["body"],
    }],
    rollback: createRollbackTopologyTimeline({
      featureIds: input.featureIds,
      snapshots: input.snapshots.map((snapshot) => ({
        featureId: snapshot.featureId,
        tessellationTolerance: 0.001,
        tessellatedFaces: snapshotBodies(snapshot.bodyIds, snapshot.faceSuffix),
      })),
    }),
    isParametric: (featureId) => featureId !== "baked",
    featureIdToOrderedActionIndex: input.actions ?? new Map([["producer", 4], ["changer", 6]]),
  });
}

test("binds an introduced exact body to its producer action before prepare", () => {
  expect(resolve({
    featureIds: ["base", "producer", "consumer"],
    snapshots: [
      { featureId: "base", bodyIds: ["base"], faceSuffix: "a" },
      { featureId: "producer", bodyIds: ["JND"], faceSuffix: "b" },
    ],
  })).toMatchObject([{ producerFeatureId: "producer", deferred: { kind: "bodyOf", actionIndex: 4 } }]);
});

test("chooses the latest exact changed-body owner", () => {
  expect(resolve({
    featureIds: ["base", "producer", "changer", "consumer"],
    snapshots: [
      { featureId: "base", bodyIds: ["JND"], faceSuffix: "a" },
      { featureId: "producer", bodyIds: ["JND"], faceSuffix: "b" },
      { featureId: "changer", bodyIds: ["JND"], faceSuffix: "c" },
    ],
  })).toMatchObject([{ producerFeatureId: "changer", deferred: { kind: "bodyOf", actionIndex: 6 } }]);
});

test("review mode proves exact ownership without an exploratory action index", () => {
  const featureIds = ["Sketch3", "Extrude3", "Sketch4", "Extrude4", "Split1"];
  const bindings = resolveExactBodyProducerBindings({
    featureIds,
    consumerFeatureId: "Split1",
    queries: [
      { consumerFeatureId: "Split1", slotKey: "targetBody", parameterId: "targets", queryIndex: 0, deterministicId: "JND", queryString: null, expectedKinds: ["body"] },
      { consumerFeatureId: "Split1", slotKey: "toolBody", parameterId: "tool", queryIndex: 0, deterministicId: "JaD", queryString: null, expectedKinds: ["body"] },
    ],
    rollback: createRollbackTopologyTimeline({
      featureIds,
      snapshots: [
        { featureId: "Sketch3", tessellationTolerance: 0.001, tessellatedFaces: snapshotBodies([], "a") },
        { featureId: "Extrude3", tessellationTolerance: 0.001, tessellatedFaces: snapshotBodies(["JND"], "b") },
        { featureId: "Sketch4", tessellationTolerance: 0.001, tessellatedFaces: snapshotBodies(["JND"], "b") },
        { featureId: "Extrude4", tessellationTolerance: 0.001, tessellatedFaces: { bodies: [...snapshotBodies(["JND"], "b").bodies, ...snapshotBodies(["JaD"], "c").bodies] } },
      ],
    }),
    isParametric: (featureId) => featureId === "Extrude3" || featureId === "Extrude4",
    reviewMode: true,
  });

  expect(bindings).toMatchObject([
    { producerFeatureId: "Extrude3", deferred: { kind: "bodyOfSourceFeature", producerSourceFeatureId: "Extrude3", deterministicId: "JND" } },
    { producerFeatureId: "Extrude4", deferred: { kind: "bodyOfSourceFeature", producerSourceFeatureId: "Extrude4", deterministicId: "JaD" } },
  ]);
});

// Lane: logic (per docs/testing.md — exact rollback ownership resolver seam).
// Seam: Split promotes only when every body has one latest parametric producer;
// a later feature that did not change JND cannot replace Extrude 2's ownership.
test("binds Split's JND and JaD bodies to their actual latest parametric producers", () => {
  const featureIds = ["Sketch2", "Extrude2", "Extrude3", "Sketch4", "Extrude4", "Split1"];
  const rollback = createRollbackTopologyTimeline({
    featureIds,
    snapshots: [
      { featureId: "Sketch2", tessellationTolerance: 0.001, tessellatedFaces: snapshotBodies([], "a") },
      { featureId: "Extrude2", tessellationTolerance: 0.001, tessellatedFaces: snapshotBodies(["JND"], "b") },
      // Extrude 3 is present in Plan but did not own or reshape JND.
      { featureId: "Extrude3", tessellationTolerance: 0.001, tessellatedFaces: snapshotBodies(["JND"], "b") },
      { featureId: "Sketch4", tessellationTolerance: 0.001, tessellatedFaces: snapshotBodies(["JND"], "b") },
      { featureId: "Extrude4", tessellationTolerance: 0.001, tessellatedFaces: { bodies: [...snapshotBodies(["JND"], "b").bodies, ...snapshotBodies(["JaD"], "c").bodies] } },
    ],
  });

  expect(resolveExactBodyProducerBindings({
    featureIds,
    consumerFeatureId: "Split1",
    queries: [
      { consumerFeatureId: "Split1", slotKey: "targetBody", parameterId: "targets", queryIndex: 0, deterministicId: "JND", queryString: null, expectedKinds: ["body"] },
      { consumerFeatureId: "Split1", slotKey: "toolBody", parameterId: "tool", queryIndex: 0, deterministicId: "JaD", queryString: null, expectedKinds: ["body"] },
    ],
    rollback,
    isParametric: (featureId) => featureId === "Extrude2" || featureId === "Extrude4",
    featureIdToOrderedActionIndex: new Map([["Extrude2", 2], ["Extrude4", 4]]),
  })).toMatchObject([
    { producerFeatureId: "Extrude2", deferred: { kind: "bodyOf", actionIndex: 2 } },
    { producerFeatureId: "Extrude4", deferred: { kind: "bodyOf", actionIndex: 4 } },
  ]);
});

test("fails closed when the latest owner removes the selected body", () => {
  expect(resolve({
    featureIds: ["base", "producer", "remove", "consumer"],
    snapshots: [
      { featureId: "base", bodyIds: ["base"], faceSuffix: "a" },
      { featureId: "producer", bodyIds: ["JND"], faceSuffix: "b" },
      { featureId: "remove", bodyIds: ["base"], faceSuffix: "c" },
    ],
  })).toBeNull();
});

test("fails closed for multi-output, non-parametric, or missing-action producers", () => {
  expect(resolve({
    featureIds: ["base", "producer", "consumer"],
    snapshots: [
      { featureId: "base", bodyIds: ["base"], faceSuffix: "a" },
      { featureId: "producer", bodyIds: ["JND", "other"], faceSuffix: "b" },
    ],
  })).toBeNull();
  expect(resolve({
    featureIds: ["base", "baked", "consumer"],
    snapshots: [
      { featureId: "base", bodyIds: ["base"], faceSuffix: "a" },
      { featureId: "baked", bodyIds: ["JND"], faceSuffix: "b" },
    ],
    actions: new Map([["baked", 4]]),
  })).toBeNull();
  expect(resolve({
    featureIds: ["base", "producer", "consumer"],
    snapshots: [
      { featureId: "base", bodyIds: ["base"], faceSuffix: "a" },
      { featureId: "producer", bodyIds: ["JND"], faceSuffix: "b" },
    ],
    actions: new Map(),
  })).toBeNull();
});
