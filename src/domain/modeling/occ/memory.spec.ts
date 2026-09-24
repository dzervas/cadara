import { expect, test, vi } from "vitest";

const executeFeatureResult = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/domain/modeling/occ/features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domain/modeling/occ/features")>();
  return {
    ...actual,
    executeOccFeature: (...args: Parameters<typeof actual.executeOccFeature>) =>
      executeFeatureResult.current ?? actual.executeOccFeature(...args),
  };
});

import {
  applyOccFeatureToAuthoringState,
  createOccAuthoringState,
} from "@/domain/modeling/occ/authoring-state";
import {
  releaseDiscardedOccAuthoringStateObjects,
  releaseOccAuthoringStateObjects,
} from "@/domain/modeling/occ/memory";

// Lane: logic. Seam: disposing an isolated OCC authoring state releases all
// embind topology wrappers without double-deleting wrappers shared by body/cache views.
test("releasing a discarded state preserves every wrapper retained by replacement and rollback states", () => {
  const deleteCalls = new Map<string, number>();
  const object = (name: string) => ({
    delete: () => deleteCalls.set(name, (deleteCalls.get(name) ?? 0) + 1),
  });
  const sharedBaseShape = object("shared-base-shape");
  const sharedBaseFace = object("shared-base-face");
  const discardedShape = object("discarded-shape");
  const discardedEdge = object("discarded-edge");
  const replacementShape = object("replacement-shape");
  const stageOnlyShape = object("stage-only-shape");
  const previousStageOnlyShape = object("previous-stage-only-shape");
  const sharedCacheShape = object("shared-cache-shape");
  const discardedCacheShape = object("discarded-cache-shape");
  const body = (
    shape: ReturnType<typeof object>,
    faces: ReturnType<typeof object>[] = [],
    edges: ReturnType<typeof object>[] = [],
  ) => ({
    shape,
    facesById: new Map(faces.map((value, index) => [index, value])),
    edgesById: new Map(edges.map((value, index) => [index, value])),
    verticesById: new Map(),
  });
  const sharedBaseBody = body(sharedBaseShape, [sharedBaseFace]);
  const discardedBody = body(discardedShape, [], [discardedEdge]);
  const replacementBody = body(replacementShape);
  const stageOnlyBody = body(stageOnlyShape);
  const previousStageOnlyBody = body(previousStageOnlyShape);
  const discardedCache = new Map([
    ["shared", [{ shape: sharedCacheShape }]],
    ["discarded", [{ shape: discardedCacheShape }]],
  ]);
  const replacementCache = new Map([["shared", [{ shape: sharedCacheShape }]]]);
  const stage = (stageBody: ReturnType<typeof body>) =>
    new Map([
      ["feature", { outputs: new Map([["output", { body: stageBody }]]) }],
    ]);

  releaseDiscardedOccAuthoringStateObjects(
    {
      baseBodies: [sharedBaseBody],
      bodies: [discardedBody],
      bakedShapeCache: discardedCache,
      featureTopologyStages: stage(stageOnlyBody),
      previousFeatureTopologyStages: stage(previousStageOnlyBody),
    },
    [
      {
        baseBodies: [sharedBaseBody],
        bodies: [replacementBody],
        bakedShapeCache: replacementCache,
        featureTopologyStages: new Map(),
        previousFeatureTopologyStages: new Map(),
      },
      {
        baseBodies: [sharedBaseBody],
        bodies: [],
        bakedShapeCache: new Map(),
        featureTopologyStages: stage(stageOnlyBody),
        previousFeatureTopologyStages: stage(previousStageOnlyBody),
      },
    ],
  );

  expect(Object.fromEntries(deleteCalls)).toEqual({
    "discarded-shape": 1,
    "discarded-edge": 1,
    "discarded-cache-shape": 1,
  });
  expect(discardedCache.size).toBe(0);
  expect(replacementCache.get("shared")).toEqual([{ shape: sharedCacheShape }]);
});

test("cleanup attempts every independent wrapper and retries only failed deletions", () => {
  const first = { delete: vi.fn() };
  let middleAttempts = 0;
  const middle = {
    delete: vi.fn(() => {
      middleAttempts += 1;
      if (middleAttempts === 1) throw new Error("middle delete failed");
    }),
  };
  const last = { delete: vi.fn() };
  const discarded = {
    bodies: [
      {
        shape: first,
        facesById: new Map([["middle", middle]]),
        edgesById: new Map([["last", last]]),
        verticesById: new Map(),
      },
    ],
    bakedShapeCache: new Map([["middle", [{ shape: middle }]]]),
  };

  let cleanupError: unknown;
  try {
    releaseDiscardedOccAuthoringStateObjects(discarded, []);
  } catch (error) {
    cleanupError = error;
  }

  expect(cleanupError).toMatchObject({ name: "OccCleanupError" });
  expect(first.delete).toHaveBeenCalledTimes(1);
  expect(middle.delete).toHaveBeenCalledTimes(1);
  expect(last.delete).toHaveBeenCalledTimes(1);
  expect(discarded.bakedShapeCache.size).toBe(1);

  expect(cleanupError).toHaveProperty("retry");
  (cleanupError as { retry(): void }).retry();

  expect(first.delete).toHaveBeenCalledTimes(1);
  expect(middle.delete).toHaveBeenCalledTimes(2);
  expect(last.delete).toHaveBeenCalledTimes(1);
  expect(discarded.bakedShapeCache.size).toBe(0);
});

test("a cache map shared with a retained state is not mutated", () => {
  const shape = { delete: vi.fn() };
  const sharedCache = new Map([["asset", [{ shape }]]]);
  const state = {
    baseBodies: [],
    bodies: [],
    bakedShapeCache: sharedCache,
    featureTopologyStages: new Map(),
    previousFeatureTopologyStages: new Map(),
  };

  releaseDiscardedOccAuthoringStateObjects(state, [state]);

  expect(shape.delete).not.toHaveBeenCalled();
  expect(sharedCache.size).toBe(1);
});

test("authoring result handoff releases partial wrappers, preserves accepted owners, and rethrows", () => {
  const acceptedCacheShape = { delete: vi.fn() };
  const partialShape = { delete: vi.fn() };
  const partialBody = {
    bodyId: "body_partial",
    label: "Partial",
    bodyKind: "solid",
    ownerFeatureId: "feature_partial",
    topologyToken: "t0001",
    shape: partialShape,
    topology: { faceIds: [], edgeIds: [], vertexIds: [] },
    contributingFeatureIds: [],
    facesById: new Map(),
    faceContributingFeatureIdsById: new Map(),
    edgesById: new Map(),
    edgeContributingFeatureIdsById: new Map(),
    verticesById: new Map(),
    vertexContributingFeatureIdsById: new Map(),
  };
  const state = createOccAuthoringState({} as never, {
    bakedShapeCache: new Map([
      ["asset_accepted", [{ shape: acceptedCacheShape, meshTriangles: [] }]],
    ]),
  });
  executeFeatureResult.current = {
    bodies: [partialBody],
    constructions: state.constructions,
    constructionPlanes: state.constructionPlanes,
    producedTargets: [],
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map(),
    topologyStage: {
      featureId: "feature_wrong",
      outputs: new Map([
        [
          partialBody.bodyId,
          {
            outputSlot: partialBody.bodyId,
            body: partialBody,
            sourceTargets: new Map(),
            unsupportedSourceKeys: new Set(),
          },
        ],
      ]),
    },
  };

  try {
    expect(() =>
      applyOccFeatureToAuthoringState(state, {
        featureId: "feature_partial",
        suppressed: false,
        definition: {
          kind: "plane",
          featureTypeVersion: "plane-feature/v1alpha1",
          parameters: {
            mode: "explicitFrame",
            frame: {
              origin: [0, 0, 0],
              xAxis: [1, 0, 0],
              yAxis: [0, 1, 0],
              normal: [0, 0, 1],
              linearUnit: "documentLength",
              handedness: "rightHanded",
            },
          },
        },
      }),
    ).toThrow("Feature feature_partial returned topology stage feature_wrong.");
  } finally {
    executeFeatureResult.current = null;
  }

  expect(partialShape.delete).toHaveBeenCalledTimes(1);
  expect(acceptedCacheShape.delete).not.toHaveBeenCalled();
  expect(state.bakedShapeCache.size).toBe(1);
});

test("authoring handoff reports both reconciliation and cleanup failures", () => {
  const cleanupFailure = new Error("partial body delete failed");
  const partialShape = { delete: vi.fn() };
  const failingFace = {
    delete: vi.fn(() => {
      throw cleanupFailure;
    }),
  };
  const state = createOccAuthoringState({} as never);
  const partialBody = {
    bodyId: "body_partial_cleanup",
    label: "Partial cleanup",
    bodyKind: "solid",
    ownerFeatureId: "feature_partial_cleanup",
    topologyToken: "t0002",
    shape: partialShape,
    topology: { faceIds: ["face_partial"], edgeIds: [], vertexIds: [] },
    contributingFeatureIds: [],
    facesById: new Map([["face_partial", failingFace]]),
    faceContributingFeatureIdsById: new Map(),
    edgesById: new Map(),
    edgeContributingFeatureIdsById: new Map(),
    verticesById: new Map(),
    vertexContributingFeatureIdsById: new Map(),
  };
  executeFeatureResult.current = {
    bodies: [partialBody],
    constructions: state.constructions,
    constructionPlanes: state.constructionPlanes,
    producedTargets: [],
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map(),
    topologyStage: {
      featureId: "feature_wrong_cleanup",
      outputs: new Map(),
    },
  };

  try {
    expect(() =>
      applyOccFeatureToAuthoringState(state, {
        featureId: "feature_partial_cleanup",
        suppressed: false,
        definition: {
          kind: "plane",
          featureTypeVersion: "plane-feature/v1alpha1",
          parameters: {
            mode: "explicitFrame",
            frame: {
              origin: [0, 0, 0],
              xAxis: [1, 0, 0],
              yAxis: [0, 1, 0],
              normal: [0, 0, 1],
              linearUnit: "documentLength",
              handedness: "rightHanded",
            },
          },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({
            message:
              "Feature feature_partial_cleanup returned topology stage feature_wrong_cleanup.",
          }),
          expect.objectContaining({ name: "OccCleanupError" }),
        ]),
      }),
    );
  } finally {
    executeFeatureResult.current = null;
  }

  expect(partialShape.delete).toHaveBeenCalledTimes(1);
  expect(failingFace.delete).toHaveBeenCalledTimes(1);
});

test("releasing an OCC authoring state deletes labels before their naming document", () => {
  const deleteCalls = new Map<string, number>();
  const deletionOrder: string[] = [];
  const object = (name: string) => ({
    delete: () => {
      deletionOrder.push(name);
      deleteCalls.set(name, (deleteCalls.get(name) ?? 0) + 1);
    },
  });
  const shape = object("shape");
  const face = object("face");
  const edge = object("edge");
  const vertex = object("vertex");
  const namingDocument = object("naming-document");
  const bodyLabel = object("body-label");
  const topologyLabel = object("topology-label");
  const selectorLabel = object("selector-label");
  const body = {
    shape,
    facesById: new Map([["face", face]]),
    edgesById: new Map([["edge", edge]]),
    verticesById: new Map([["vertex", vertex]]),
    naming: {
      document: namingDocument,
      bodyLabel,
      topologyLabelsByKey: new Map([["face", topologyLabel]]),
      selectorLabelsByKey: new Map([["face", selectorLabel]]),
    },
  };
  const bakedShapeCache = new Map([["asset", [{ shape }]]]);

  releaseOccAuthoringStateObjects({
    baseBodies: [body],
    bodies: [body],
    bakedShapeCache,
  });

  expect(Object.fromEntries(deleteCalls)).toEqual({
    shape: 1,
    face: 1,
    edge: 1,
    vertex: 1,
    "naming-document": 1,
    "body-label": 1,
    "topology-label": 1,
    "selector-label": 1,
  });
  expect(bakedShapeCache.size).toBe(0);
  expect(deletionOrder.indexOf("body-label")).toBeLessThan(
    deletionOrder.indexOf("naming-document"),
  );
  expect(deletionOrder.indexOf("topology-label")).toBeLessThan(
    deletionOrder.indexOf("naming-document"),
  );
  expect(deletionOrder.indexOf("selector-label")).toBeLessThan(
    deletionOrder.indexOf("naming-document"),
  );
});
