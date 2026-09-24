import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";

import { PLANE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

const applyFeatureSpy = vi.hoisted(() => vi.fn());
const referenceStateFailure = vi.hoisted(() => ({ callsUntilFailure: -1 }));
const releaseDiscardedSpy = vi.hoisted(() => vi.fn());
const releaseAllSpy = vi.hoisted(() => vi.fn());
const releaseAllFailure = vi.hoisted(() => ({ current: null as unknown }));
const releaseBehavior = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/domain/modeling/occ/memory", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domain/modeling/occ/memory")>();
  return {
    ...actual,
    releaseDiscardedOccAuthoringStateObjects: (
      ...args: Parameters<
        typeof actual.releaseDiscardedOccAuthoringStateObjects
      >
    ) => {
      releaseDiscardedSpy(...args);
      if (releaseBehavior.enabled) {
        return actual.releaseDiscardedOccAuthoringStateObjects(...args);
      }
    },
    releaseOccAuthoringStateObjects: (
      ...args: Parameters<typeof actual.releaseOccAuthoringStateObjects>
    ) => {
      releaseAllSpy(...args);
      if (releaseAllFailure.current) {
        const error = releaseAllFailure.current;
        releaseAllFailure.current = null;
        throw error;
      }
      return actual.releaseOccAuthoringStateObjects(...args);
    },
  };
});

vi.mock("@/domain/modeling/occ/topology", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domain/modeling/occ/topology")>();
  return {
    ...actual,
    createOccReferenceState: (
      ...args: Parameters<typeof actual.createOccReferenceState>
    ) => {
      if (referenceStateFailure.callsUntilFailure === 0) {
        referenceStateFailure.callsUntilFailure = -1;
        throw new Error(
          "injected reference-state failure after body allocation",
        );
      }
      if (referenceStateFailure.callsUntilFailure > 0) {
        referenceStateFailure.callsUntilFailure -= 1;
      }
      return actual.createOccReferenceState(...args);
    },
  };
});

vi.mock("@/domain/modeling/occ/authoring-state", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/domain/modeling/occ/authoring-state")
    >();
  return {
    ...actual,
    applyOccFeatureToAuthoringState: (
      ...args: Parameters<typeof actual.applyOccFeatureToAuthoringState>
    ) => {
      applyFeatureSpy(...args);
      return actual.applyOccFeatureToAuthoringState(...args);
    },
  };
});

const { OpenCascadeKernelAdapter } =
  await import("@/domain/modeling/opencascade-kernel-adapter");

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

function createDeferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function loadOpenCascade() {
  const module = (await import("../../../public/cadara-occ.js")) as {
    default: CustomOpenCascadeMainJSForTest;
  };
  const wasmBinary = new Uint8Array(
    await readFile(new URL("../../../public/cadara-occ.wasm", import.meta.url)),
  );
  return new module.default({ wasmBinary });
}

async function createAdapter() {
  const oc = await loadOpenCascade();
  const createSolver = (revisionId: string | null) =>
    new SketchConstraintSolverAdapter({ revisionId });
  return new OpenCascadeKernelAdapter({
    solverAdapter: createSolver(null),
    solverAdapterFactory: createSolver,
    getOpenCascadeInstance: async () => oc,
  });
}

type NamingOwners = {
  document: { delete(): void; isDeleted(): boolean };
  bodyLabel: { delete(): void; isDeleted(): boolean };
  topologyLabelsByKey: ReadonlyMap<
    unknown,
    { delete(): void; isDeleted(): boolean }
  >;
  selectorLabelsByKey: ReadonlyMap<
    unknown,
    { delete(): void; isDeleted(): boolean }
  >;
};

type OwnedBody = {
  shape?: { isDeleted(): boolean };
  naming?: NamingOwners;
};
type OwnedState = {
  features: readonly unknown[];
  bodies: readonly OwnedBody[];
  sketches: readonly unknown[];
  featureTopologyStages?: ReadonlyMap<
    unknown,
    { outputs: ReadonlyMap<unknown, { body: OwnedBody }> }
  >;
  previousFeatureTopologyStages?: ReadonlyMap<
    unknown,
    { outputs: ReadonlyMap<unknown, { body: OwnedBody }> }
  >;
};

function ownedBodies(state: OwnedState) {
  const bodies = [...state.bodies];
  for (const stages of [
    state.featureTopologyStages,
    state.previousFeatureTopologyStages,
  ]) {
    for (const stage of stages?.values() ?? []) {
      for (const output of stage.outputs.values()) bodies.push(output.body);
    }
  }
  return bodies;
}

function namedBody(state: OwnedState) {
  const body = ownedBodies(state).find((candidate) => candidate.naming);
  if (body) return body;
  throw new Error("Expected a real body with OCAF naming owners.");
}

function namedBodyOwners(state: OwnedState) {
  return namedBody(state).naming!;
}

function uniqueNamingOwners(state: OwnedState): NamingOwners[] {
  const seenDocuments = new Set<object>();
  return ownedBodies(state).flatMap((body) => {
    if (!body.naming || seenDocuments.has(body.naming.document)) return [];
    seenDocuments.add(body.naming.document);
    return [body.naming];
  });
}

function discardedNamingOwners(
  state: OwnedState,
  retained: NamingOwners,
): NamingOwners {
  const naming = uniqueNamingOwners(state).find(
    (candidate) => candidate.document !== retained.document,
  );
  if (naming) return naming;
  throw new Error("Expected distinct discarded OCAF naming owners.");
}

function expectNamingOwnersLive(naming: NamingOwners) {
  expect(naming.document.isDeleted()).toBe(false);
  expect(naming.bodyLabel.isDeleted()).toBe(false);
  expect(naming.topologyLabelsByKey.size).toBeGreaterThan(0);
  expect(naming.selectorLabelsByKey.size).toBeGreaterThan(0);
  for (const label of naming.topologyLabelsByKey.values()) {
    expect(label.isDeleted()).toBe(false);
  }
  for (const label of naming.selectorLabelsByKey.values()) {
    expect(label.isDeleted()).toBe(false);
  }
}

function expectNamingOwnersDeleted(naming: NamingOwners) {
  expect(naming.document.isDeleted()).toBe(true);
  expect(naming.bodyLabel.isDeleted()).toBe(true);
  expect(naming.topologyLabelsByKey.size).toBeGreaterThan(0);
  expect(naming.selectorLabelsByKey.size).toBeGreaterThan(0);
  for (const label of naming.topologyLabelsByKey.values()) {
    expect(label.isDeleted()).toBe(true);
  }
  for (const label of naming.selectorLabelsByKey.values()) {
    expect(label.isDeleted()).toBe(true);
  }
}

function reachableErrors(error: unknown): unknown[] {
  if (!(error instanceof AggregateError)) return [error];
  return [error, ...error.errors.flatMap(reachableErrors)];
}

// Lane: logic (docs/testing.md — domain orchestration at a mocked module seam).
// Seam: the OCC authoring-state feature executor called by adapter tail appends.

test("appending a tail sketch preserves built feature state without replaying features", async () => {
  const adapter = await createAdapter();
  const seed = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const sourceSketch = seed.snapshot.document.sketches[0];
  if (!sourceSketch) {
    throw new Error("Seed sketch is required for tail-append coverage.");
  }
  const empty = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const seededSketch = await adapter.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: empty.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_occ_seed_sketch",
      projectionRequestId: "request_occ_seed_sketch:project",
      validationRequestId: "request_occ_seed_sketch:validate",
      solveRequestId: "request_occ_seed_sketch:solve",
      regionRequestId: "request_occ_seed_sketch:regions",
    },
    sketchId: sourceSketch.sketchId,
    restoreRecordedSketchId: true,
    sketchLabel: sourceSketch.label,
    plane: sourceSketch.plane,
    definition: sourceSketch.sketch.definition,
  });
  const seededFeature = await adapter.createFeature({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: seededSketch.revisionId,
    definition: {
      kind: "plane",
      featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
      parameters: {
        mode: "explicitFrame",
        frame: {
          origin: [0, 0, 12],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
          linearUnit: "documentLength",
          handedness: "rightHanded",
        },
      },
    },
  });
  expect(seededFeature.revisionState.kind).toBe("accepted");
  const before = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const beforeFeatureIds = before.snapshot.document.features.map(
    (feature) => feature.featureId,
  );
  const beforeConstructionIds = before.snapshot.document.constructions.map(
    (construction) => construction.constructionId,
  );
  expect(beforeConstructionIds.length).toBeGreaterThan(0);

  applyFeatureSpy.mockClear();
  const committed = await adapter.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: before.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_occ_tail_sketch",
      projectionRequestId: "request_occ_tail_sketch:project",
      validationRequestId: "request_occ_tail_sketch:validate",
      solveRequestId: "request_occ_tail_sketch:solve",
      regionRequestId: "request_occ_tail_sketch:regions",
    },
    sketchId: null,
    sketchLabel: "Tail Sketch",
    plane: sourceSketch.plane,
    definition: sourceSketch.sketch.definition,
  });
  const after = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });

  expect(committed.revisionState.kind).toBe("accepted");
  expect(applyFeatureSpy).not.toHaveBeenCalled();
  expect(
    after.snapshot.document.features.map((feature) => feature.featureId),
  ).toEqual(beforeFeatureIds);
  expect(
    after.snapshot.document.constructions.map(
      (construction) => construction.constructionId,
    ),
  ).toEqual(beforeConstructionIds);
});

test("appending a tail feature executes that feature exactly once", async () => {
  const adapter = await createAdapter();
  const before = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });

  applyFeatureSpy.mockClear();
  const created = await adapter.createFeature({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: before.snapshot.document.revisionId,
    definition: {
      kind: "plane",
      featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
      parameters: {
        mode: "explicitFrame",
        frame: {
          origin: [0, 0, 12],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
          linearUnit: "documentLength",
          handedness: "rightHanded",
        },
      },
    },
  });

  expect(created.revisionState.kind).toBe("accepted");
  expect(applyFeatureSpy).toHaveBeenCalledTimes(1);
});

test("cleanup-bearing aggregates bypass adapter diagnostics and retain every retry", async () => {
  const { combineOccCleanupError, releaseDiscardedOccAuthoringStateObjects } =
    await import("@/domain/modeling/occ/memory");
  const primary = new Error("injected primary modeling failure");
  const deletedFirst = { delete: vi.fn() };
  const deletedSecond = { delete: vi.fn() };
  let firstAttempts = 0;
  let secondAttempts = 0;
  const retryFirst = {
    delete: vi.fn(() => {
      firstAttempts += 1;
      if (firstAttempts < 3) throw new Error("first cleanup retry failed");
    }),
  };
  const retrySecond = {
    delete: vi.fn(() => {
      secondAttempts += 1;
      if (secondAttempts < 2) throw new Error("second cleanup retry failed");
    }),
  };
  const makeCleanupError = (
    failing: typeof retryFirst,
    successful: typeof deletedFirst,
  ) => {
    try {
      releaseDiscardedOccAuthoringStateObjects(
        {
          bodies: [
            {
              shape: successful,
              facesById: new Map([["failing", failing]]),
              edgesById: new Map(),
              verticesById: new Map(),
            },
          ],
        },
        [],
      );
    } catch (error) {
      return error;
    }
    throw new Error("Expected injected cleanup to fail.");
  };
  const firstCleanup = makeCleanupError(retryFirst, deletedFirst);
  const secondCleanup = makeCleanupError(retrySecond, deletedSecond);
  const nested = combineOccCleanupError(
    primary,
    new AggregateError([firstCleanup, new AggregateError([secondCleanup])]),
  );
  const adapter = await createAdapter();
  const before = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });

  applyFeatureSpy.mockImplementationOnce(() => {
    throw nested;
  });
  let observed: unknown;
  try {
    await adapter.createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: {
        kind: "plane",
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: "explicitFrame",
          frame: {
            origin: [0, 0, 12],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
            normal: [0, 0, 1],
            linearUnit: "documentLength",
            handedness: "rightHanded",
          },
        },
      },
    });
  } catch (error) {
    observed = error;
  }

  expect(observed).toBe(nested);
  expect(reachableErrors(observed)).toContain(primary);
  expect(() => adapter.dispose()).toThrow("could not release every resource");
  expect(() => adapter.dispose()).not.toThrow();
  expect(deletedFirst.delete).toHaveBeenCalledTimes(1);
  expect(deletedSecond.delete).toHaveBeenCalledTimes(1);
  expect(retryFirst.delete).toHaveBeenCalledTimes(3);
  expect(retrySecond.delete).toHaveBeenCalledTimes(2);
});

test("cleanup-bearing aggregates bypass restore, rebuild, and preview fallback catches", async () => {
  const { OccCleanupError } = await import("@/domain/modeling/occ/memory");
  const document = await new MockKernelAdapter().exportAuthoredModelDocument(
    "doc_workspace",
  );
  const operations = [
    {
      prepare: async (
        _adapter: InstanceType<typeof OpenCascadeKernelAdapter>,
      ) => undefined,
      run: async (adapter: InstanceType<typeof OpenCascadeKernelAdapter>) =>
        adapter.restoreAuthoredModelDocument(document),
    },
    {
      prepare: async (adapter: InstanceType<typeof OpenCascadeKernelAdapter>) =>
        adapter.restoreAuthoredModelDocument(document),
      run: async (adapter: InstanceType<typeof OpenCascadeKernelAdapter>) => {
        const sourceFeature = document.features[0]!;
        return adapter.updateFeature({
          contractVersion: "modeling-contract/v1alpha1",
          documentId: "doc_workspace",
          baseRevisionId: document.revisionId,
          featureId: sourceFeature.featureId,
          definition: sourceFeature.definition,
        });
      },
    },
    {
      prepare: async (adapter: InstanceType<typeof OpenCascadeKernelAdapter>) =>
        adapter.restoreAuthoredModelDocument(document),
      run: async (adapter: InstanceType<typeof OpenCascadeKernelAdapter>) => {
        const sourceFeature = document.features[0]!;
        return adapter.evaluatePreview({
          contractVersion: "modeling-contract/v1alpha1",
          documentId: "doc_workspace",
          baseRevisionId: document.revisionId,
          previewId: "preview_cleanup_error",
          replacesFeatureId: sourceFeature.featureId,
          definition: sourceFeature.definition,
        });
      },
    },
  ];

  for (const operation of operations) {
    const adapter = await createAdapter();
    await operation.prepare(adapter);
    const primary = new Error("nested operation failure");
    const retry = vi.fn();
    const nested = new AggregateError([
      primary,
      new AggregateError([new OccCleanupError([new Error("cleanup")], retry)]),
    ]);
    applyFeatureSpy.mockImplementationOnce(() => {
      throw nested;
    });
    await expect(operation.run(adapter)).rejects.toBe(nested);
    adapter.dispose();
    expect(retry).toHaveBeenCalledTimes(1);
  }
});

test("adapter wires rebuild replacement, rollback cleanup, and final disposal", async () => {
  const adapter = await createAdapter();
  const before = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const definition = {
    kind: "plane" as const,
    featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
    parameters: {
      mode: "explicitFrame" as const,
      frame: {
        origin: [0, 0, 12] as [number, number, number],
        xAxis: [1, 0, 0] as [number, number, number],
        yAxis: [0, 1, 0] as [number, number, number],
        normal: [0, 0, 1] as [number, number, number],
        linearUnit: "documentLength" as const,
        handedness: "rightHanded" as const,
      },
    },
  };
  const created = await adapter.createFeature({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: before.snapshot.document.revisionId,
    definition,
  });
  expect(created.revisionState.kind).toBe("accepted");

  const runtimeBeforeUpdate = (
    adapter as unknown as { runtimeState: { authoringState: unknown } }
  ).runtimeState;
  releaseDiscardedSpy.mockClear();
  const updated = await adapter.updateFeature({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: created.revisionId,
    featureId: created.featureId,
    definition: {
      ...definition,
      parameters: {
        ...definition.parameters,
        frame: { ...definition.parameters.frame, origin: [0, 0, 24] },
      },
    },
  });

  expect(updated.revisionState.kind).toBe("accepted");
  expect(releaseDiscardedSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  const replacementCall = releaseDiscardedSpy.mock.calls.at(-1)!;
  const runtimeAfterUpdate = (
    adapter as unknown as { runtimeState: { authoringState: unknown } }
  ).runtimeState;
  expect(replacementCall[0]).toBe(runtimeBeforeUpdate.authoringState);
  expect(replacementCall[1]).toEqual([runtimeAfterUpdate.authoringState]);

  releaseDiscardedSpy.mockClear();
  applyFeatureSpy.mockImplementationOnce(() => {
    throw new Error("injected rebuild failure");
  });
  const rejected = await adapter.updateFeature({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: updated.revisionId,
    featureId: created.featureId,
    definition,
  });
  expect(rejected.revisionState.kind).toBe("rejected");
  expect(releaseDiscardedSpy).toHaveBeenCalled();
  const afterRejected = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  expect(afterRejected.snapshot.document.revisionId).toBe(updated.revisionId);

  releaseAllSpy.mockClear();
  adapter.dispose();
  adapter.dispose();
  expect(releaseAllSpy).toHaveBeenCalledTimes(1);
});

test("restore releases successful and asynchronously rejected projection ownership", async () => {
  const document = await new MockKernelAdapter().exportAuthoredModelDocument(
    "doc_workspace",
  );

  const successful = await createAdapter();
  await successful.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  releaseDiscardedSpy.mockClear();
  await successful.restoreAuthoredModelDocument(document);
  const successfulRuntime = (
    successful as unknown as {
      runtimeState: {
        authoringState: {
          oc: { HEAPU8: Uint8Array };
          bakedShapeCache: Map<unknown, unknown>;
        };
      };
    }
  ).runtimeState;
  expect(
    releaseDiscardedSpy.mock.calls.some(([, retained]) =>
      retained.includes(successfulRuntime.authoringState),
    ),
  ).toBe(true);
  expect(
    releaseDiscardedSpy.mock.calls.some(
      ([discarded, retained]) =>
        retained.includes(successfulRuntime.authoringState) &&
        discarded.bakedShapeCache ===
          successfulRuntime.authoringState.bakedShapeCache,
    ),
  ).toBe(true);
  const realNamedBody = (
    successfulRuntime.authoringState as unknown as {
      bodies: readonly {
        naming?: {
          document: { delete(): void };
          bodyLabel: { delete(): void };
          topologyLabelsByKey: ReadonlyMap<unknown, { delete(): void }>;
          selectorLabelsByKey: ReadonlyMap<unknown, { delete(): void }>;
        };
      }[];
    }
  ).bodies.find((body) => body.naming);
  expect(realNamedBody?.naming).toBeDefined();
  const realDeletionOrder: string[] = [];
  const recordRealDelete = (name: string, wrapper: { delete(): void }) => {
    const originalDelete = wrapper.delete.bind(wrapper);
    wrapper.delete = () => {
      realDeletionOrder.push(name);
      originalDelete();
    };
  };
  recordRealDelete("document", realNamedBody!.naming!.document);
  recordRealDelete("body-label", realNamedBody!.naming!.bodyLabel);
  for (const label of realNamedBody!.naming!.topologyLabelsByKey.values()) {
    recordRealDelete("topology-label", label);
  }
  for (const label of realNamedBody!.naming!.selectorLabelsByKey.values()) {
    recordRealDelete("selector-label", label);
  }
  await successful.restoreAuthoredModelDocument(document);
  expect(realDeletionOrder).toEqual(
    expect.arrayContaining([
      "body-label",
      "topology-label",
      "selector-label",
      "document",
    ]),
  );
  expect(realDeletionOrder.indexOf("body-label")).toBeLessThan(
    realDeletionOrder.indexOf("document"),
  );
  expect(realDeletionOrder.lastIndexOf("topology-label")).toBeLessThan(
    realDeletionOrder.indexOf("document"),
  );
  expect(realDeletionOrder.lastIndexOf("selector-label")).toBeLessThan(
    realDeletionOrder.indexOf("document"),
  );

  const initialHeapBytes =
    successfulRuntime.authoringState.oc.HEAPU8.buffer.byteLength;
  for (let rebuild = 0; rebuild < 8; rebuild += 1) {
    await successful.restoreAuthoredModelDocument(document);
  }
  const repeatedRuntime = (
    successful as unknown as {
      runtimeState: { authoringState: { oc: { HEAPU8: Uint8Array } } };
    }
  ).runtimeState;
  expect(
    repeatedRuntime.authoringState.oc.HEAPU8.buffer.byteLength -
      initialHeapBytes,
  ).toBeLessThan(256 * 1024 * 1024);
  successful.dispose();

  class RejectingSolverAdapter extends SketchConstraintSolverAdapter {
    rejectValidation = false;

    override async validateSketch(
      request: Parameters<SketchConstraintSolverAdapter["validateSketch"]>[0],
    ) {
      if (this.rejectValidation) {
        throw new Error("injected asynchronous sketch rejection");
      }
      return super.validateSketch(request);
    }
  }
  const oc = await (async () => {
    const module = (await import("../../../public/cadara-occ.js")) as {
      default: CustomOpenCascadeMainJSForTest;
    };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );
    return new module.default({ wasmBinary });
  })();
  const rejectingSolver = new RejectingSolverAdapter({ revisionId: null });
  const rejected = new OpenCascadeKernelAdapter({
    solverAdapter: rejectingSolver,
    solverAdapterFactory: () => rejectingSolver,
    getOpenCascadeInstance: async () => oc,
  });
  const bodyDocument = structuredClone(document);
  const bodyFeature = bodyDocument.features[0]!;
  bodyDocument.features = [bodyFeature];
  bodyDocument.featureOrder = [bodyFeature.featureId];
  bodyDocument.historyOrder = bodyDocument.historyOrder.filter(
    (item) =>
      item.kind === "sketch" || item.featureId === bodyFeature.featureId,
  );
  bodyDocument.cursor = { kind: "feature", featureId: bodyFeature.featureId };
  await rejected.restoreAuthoredModelDocument(bodyDocument);
  const acceptedPlane = await rejected.createFeature({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: bodyDocument.revisionId,
    definition: {
      kind: "plane",
      featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
      parameters: {
        mode: "explicitFrame",
        frame: {
          origin: [0, 0, 21],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
          linearUnit: "documentLength",
          handedness: "rightHanded",
        },
      },
    },
  });
  expect(acceptedPlane.revisionState.kind).toBe("accepted");
  rejectingSolver.rejectValidation = true;
  const acceptedBefore = await rejected.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const acceptedRuntime = (
    rejected as unknown as {
      runtimeState: {
        authoringState: {
          featureTopologyStages: ReadonlyMap<unknown, unknown>;
        };
      };
    }
  ).runtimeState;
  expect(
    acceptedRuntime.authoringState.featureTopologyStages.size,
  ).toBeGreaterThan(0);
  const acceptedState = acceptedRuntime.authoringState as unknown as OwnedState;
  const acceptedBody = namedBody(acceptedState);
  const acceptedNamingOwners = uniqueNamingOwners(acceptedState);
  expect(acceptedNamingOwners.length).toBeGreaterThan(0);
  const acceptedOwnerIdentities = new Set(
    acceptedNamingOwners.flatMap((naming) => [
      naming.document,
      naming.bodyLabel,
      ...naming.topologyLabelsByKey.values(),
      ...naming.selectorLabelsByKey.values(),
    ]),
  );
  const sourceFeature = acceptedBefore.snapshot.document.features.find(
    (feature) => feature.featureId === bodyFeature.featureId,
  );
  if (sourceFeature?.definition.kind !== "extrude") {
    throw new Error("Expected the real extrusion for rollback coverage.");
  }
  releaseDiscardedSpy.mockReset();
  const rollbackDeletionOrder: object[] = [];
  const instrumentedRollbackOwners = new Set<object>();
  releaseDiscardedSpy.mockImplementation((discarded: OwnedState) => {
    for (const naming of uniqueNamingOwners(discarded)) {
      if (acceptedOwnerIdentities.has(naming.document)) continue;
      for (const owner of [
        naming.bodyLabel,
        ...naming.topologyLabelsByKey.values(),
        ...naming.selectorLabelsByKey.values(),
        naming.document,
      ]) {
        if (instrumentedRollbackOwners.has(owner)) continue;
        instrumentedRollbackOwners.add(owner);
        const original = owner.delete.bind(owner);
        owner.delete = () => {
          rollbackDeletionOrder.push(owner);
          original();
        };
      }
    }
  });
  referenceStateFailure.callsUntilFailure = 1;
  const rolledBack = await rejected.updateFeature({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: acceptedBefore.snapshot.document.revisionId,
    featureId: sourceFeature.featureId,
    definition: {
      ...sourceFeature.definition,
      parameters: {
        ...sourceFeature.definition.parameters,
        extent: {
          mode: "oneSide",
          end: { kind: "blind", direction: "positive", distance: 47 },
        },
      },
    },
  });
  expect(referenceStateFailure.callsUntilFailure).toBe(-1);
  expect(rolledBack.revisionState.kind).toBe("rejected");
  expect(rolledBack.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: "injected reference-state failure after body allocation",
      }),
    ]),
  );
  expect((rejected as unknown as { runtimeState: unknown }).runtimeState).toBe(
    acceptedRuntime,
  );
  const rollbackCleanup = releaseDiscardedSpy.mock.calls.at(-1)!;
  const rejectedCandidate = rollbackCleanup[0] as OwnedState;
  expect(rejectedCandidate).not.toBe(acceptedState);
  expect(rollbackCleanup[1]).toEqual([acceptedState]);
  const ownerCleanup = releaseDiscardedSpy.mock.calls.find(([discarded]) =>
    uniqueNamingOwners(discarded as OwnedState).some(
      (naming) => !acceptedOwnerIdentities.has(naming.document),
    ),
  );
  expect(ownerCleanup).toBeDefined();
  const discardedOwnerState = ownerCleanup![0] as OwnedState;
  const discardedBody = ownedBodies(discardedOwnerState).find(
    (body) => body.shape && body.shape !== acceptedBody.shape,
  );
  expect(discardedBody?.shape?.isDeleted()).toBe(true);
  const seenRejectedDocuments = new Set<object>();
  const rejectedNamingOwners = releaseDiscardedSpy.mock.calls.flatMap(
    ([discarded]) =>
      uniqueNamingOwners(discarded as OwnedState).filter((naming) => {
        if (
          acceptedOwnerIdentities.has(naming.document) ||
          seenRejectedDocuments.has(naming.document)
        ) {
          return false;
        }
        seenRejectedDocuments.add(naming.document);
        return true;
      }),
  );
  expect(rejectedNamingOwners.length).toBeGreaterThan(0);
  for (const rejectedOwners of rejectedNamingOwners) {
    expectNamingOwnersDeleted(rejectedOwners);
    const documentDeletionIndex = rollbackDeletionOrder.indexOf(
      rejectedOwners.document,
    );
    expect(documentDeletionIndex).toBeGreaterThanOrEqual(0);
    for (const label of [
      rejectedOwners.bodyLabel,
      ...rejectedOwners.topologyLabelsByKey.values(),
      ...rejectedOwners.selectorLabelsByKey.values(),
    ]) {
      const labelDeletionIndex = rollbackDeletionOrder.indexOf(label);
      expect(labelDeletionIndex).toBeGreaterThanOrEqual(0);
      expect(labelDeletionIndex).toBeLessThan(documentDeletionIndex);
    }
  }
  expect(acceptedBody.shape?.isDeleted()).toBe(false);
  for (const acceptedOwners of acceptedNamingOwners) {
    expectNamingOwnersLive(acceptedOwners);
  }

  releaseDiscardedSpy.mockReset();
  await expect(
    rejected.restoreAuthoredModelDocument(bodyDocument),
  ).rejects.toThrow("injected asynchronous sketch rejection");
  expect(
    releaseDiscardedSpy.mock.calls.some(([, retained]) =>
      retained.includes(acceptedRuntime.authoringState),
    ),
  ).toBe(true);
  const acceptedAfter = await rejected.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  expect(acceptedAfter.snapshot.document.revisionId).toBe(
    acceptedBefore.snapshot.document.revisionId,
  );
  rejected.dispose();
});

test.each([
  ["preload", "restore"],
  ["read", "rebuild"],
] as const)(
  "%s initialization cannot overwrite a newer %s runtime",
  async (initializer, replacement) => {
    const document = await new MockKernelAdapter().exportAuthoredModelDocument(
      "doc_workspace",
    );
    const oc = await loadOpenCascade();
    const firstLoad = createDeferred<OpenCascadeInstance>();
    let loads = 0;
    const adapter = new OpenCascadeKernelAdapter({
      solverAdapter: new SketchConstraintSolverAdapter({ revisionId: null }),
      solverAdapterFactory: (revisionId) =>
        new SketchConstraintSolverAdapter({ revisionId }),
      getOpenCascadeInstance: () => {
        loads += 1;
        return loads === 1 ? firstLoad.promise : Promise.resolve(oc);
      },
    });
    releaseDiscardedSpy.mockClear();
    const pending =
      initializer === "preload"
        ? adapter.preloadRuntime()
        : adapter.exportAuthoredModelDocument("doc_workspace");
    await Promise.resolve();

    if (replacement === "restore") {
      await adapter.restoreAuthoredModelDocument(document);
    } else {
      await adapter.executeNativeFeatureHistoryRebuild(document);
    }
    const acceptedRuntime = (
      adapter as unknown as {
        runtimeState: { authoringState: OwnedState };
      }
    ).runtimeState;
    const acceptedState = acceptedRuntime.authoringState;
    const acceptedOwners = namedBodyOwners(acceptedState);
    expect(acceptedState.features.length).toBeGreaterThan(0);
    expect(acceptedState.bodies.length).toBeGreaterThan(0);
    expect(acceptedState.sketches.length).toBeGreaterThan(0);

    firstLoad.resolve(oc);
    const initializedResult = await pending;
    if (initializer === "read") {
      expect(
        (initializedResult as Awaited<typeof document>).features.length,
      ).toBe(document.features.length);
    }
    const installedRuntime = (
      adapter as unknown as {
        runtimeState: { authoringState: OwnedState };
      }
    ).runtimeState;
    expect(installedRuntime).toBe(acceptedRuntime);
    expect(installedRuntime.authoringState.features).toHaveLength(
      acceptedState.features.length,
    );
    expect(installedRuntime.authoringState.bodies).toHaveLength(
      acceptedState.bodies.length,
    );
    expect(installedRuntime.authoringState.sketches).toHaveLength(
      acceptedState.sketches.length,
    );
    expectNamingOwnersLive(acceptedOwners);
    const staleRelease = releaseDiscardedSpy.mock.calls.find(
      ([discarded, retained]) =>
        discarded !== acceptedState &&
        retained.length === 1 &&
        retained[0] === acceptedState,
    );
    expect(staleRelease).toBeDefined();
    adapter.dispose();
  },
);

test("serialized restore prevents a deferred solver from racing a competing replacement", async () => {
  class DeferredSolverAdapter extends SketchConstraintSolverAdapter {
    suspended = false;
    readonly entered = createDeferred<void>();
    readonly resume = createDeferred<void>();

    override async validateSketch(
      request: Parameters<SketchConstraintSolverAdapter["validateSketch"]>[0],
    ) {
      if (this.suspended) {
        this.entered.resolve();
        await this.resume.promise;
      }
      return super.validateSketch(request);
    }
  }

  const document = await new MockKernelAdapter().exportAuthoredModelDocument(
    "doc_workspace",
  );
  const oc = await loadOpenCascade();
  const solver = new DeferredSolverAdapter({ revisionId: null });
  const adapter = new OpenCascadeKernelAdapter({
    solverAdapter: solver,
    solverAdapterFactory: () => solver,
    getOpenCascadeInstance: async () => oc,
  });
  await adapter.restoreAuthoredModelDocument(document);
  const before = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });

  solver.suspended = true;
  const restoring = adapter.restoreAuthoredModelDocument(document);
  await solver.entered.promise;
  let competingSettled = false;
  const competing = adapter
    .createFeature({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: before.snapshot.document.revisionId,
      definition: {
        kind: "plane",
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: "explicitFrame",
          frame: {
            origin: [0, 0, 32],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
            normal: [0, 0, 1],
            linearUnit: "documentLength",
            handedness: "rightHanded",
          },
        },
      },
    })
    .finally(() => {
      competingSettled = true;
    });
  await Promise.resolve();
  expect(competingSettled).toBe(false);

  solver.suspended = false;
  solver.resume.resolve();
  await restoring;
  const created = await competing;
  expect(created.revisionState.kind).toBe("accepted");
  const installed = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  expect(installed.snapshot.document.revisionId).toBe(created.revisionId);
  adapter.dispose();
});

test("dispose is final while initialization and restore are suspended", async () => {
  const retrying = new OpenCascadeKernelAdapter({
    solverAdapter: new SketchConstraintSolverAdapter({ revisionId: null }),
    getOpenCascadeInstance: async () => {
      throw new Error("runtime should not initialize");
    },
  });
  let deleteAttempts = 0;
  const retryShape = {
    delete: vi.fn(() => {
      deleteAttempts += 1;
      if (deleteAttempts === 1)
        throw new Error("injected dispose cleanup failure");
    }),
  };
  (
    retrying as unknown as {
      runtimeState: {
        authoringState: {
          bodies: unknown[];
          baseBodies: unknown[];
          bakedShapeCache: Map<unknown, unknown>;
        };
        revisionSequence: number;
      };
    }
  ).runtimeState = {
    authoringState: {
      bodies: [
        {
          shape: retryShape,
          facesById: new Map(),
          edgesById: new Map(),
          verticesById: new Map(),
        },
      ],
      baseBodies: [],
      bakedShapeCache: new Map(),
    },
    revisionSequence: 0,
  };
  expect(() => retrying.dispose()).toThrow("could not release every resource");
  expect(() => retrying.dispose()).not.toThrow();
  expect(retryShape.delete).toHaveBeenCalledTimes(2);

  const oc = await loadOpenCascade();
  const deferredOc = createDeferred<OpenCascadeInstance>();
  const initializing = new OpenCascadeKernelAdapter({
    solverAdapter: new SketchConstraintSolverAdapter({ revisionId: null }),
    getOpenCascadeInstance: () => deferredOc.promise,
  });
  releaseAllSpy.mockClear();
  const preload = initializing.preloadRuntime();
  initializing.dispose();
  const { OccCleanupError } = await import("@/domain/modeling/occ/memory");
  const lateCandidateRetry = vi.fn();
  releaseAllFailure.current = new OccCleanupError(
    [new Error("late candidate cleanup failed")],
    lateCandidateRetry,
  );
  deferredOc.resolve(oc);
  let lateCandidateError: unknown;
  try {
    await preload;
  } catch (error) {
    lateCandidateError = error;
  }
  expect(
    reachableErrors(lateCandidateError).some(
      (error) =>
        error instanceof Error && error.message.includes("has been disposed"),
    ),
  ).toBe(true);
  expect(
    reachableErrors(lateCandidateError).some(
      (error) => error instanceof OccCleanupError,
    ),
  ).toBe(true);
  expect(
    (initializing as unknown as { runtimeState: unknown }).runtimeState,
  ).toBeNull();
  expect(releaseAllSpy).toHaveBeenCalledTimes(1);
  initializing.dispose();
  expect(lateCandidateRetry).toHaveBeenCalledTimes(1);

  class DeferredRestoreSolver extends SketchConstraintSolverAdapter {
    readonly entered = createDeferred<void>();
    readonly resume = createDeferred<void>();

    override async validateSketch(
      request: Parameters<SketchConstraintSolverAdapter["validateSketch"]>[0],
    ) {
      this.entered.resolve();
      await this.resume.promise;
      return super.validateSketch(request);
    }
  }
  const document = await new MockKernelAdapter().exportAuthoredModelDocument(
    "doc_workspace",
  );
  const restoreSolver = new DeferredRestoreSolver({ revisionId: null });
  const restoringAdapter = new OpenCascadeKernelAdapter({
    solverAdapter: restoreSolver,
    solverAdapterFactory: () => restoreSolver,
    getOpenCascadeInstance: async () => oc,
  });
  const restoring = restoringAdapter.restoreAuthoredModelDocument(document);
  await restoreSolver.entered.promise;
  restoringAdapter.dispose();
  restoreSolver.resume.resolve();
  await expect(restoring).rejects.toThrow("has been disposed");
  expect(
    (restoringAdapter as unknown as { runtimeState: unknown }).runtimeState,
  ).toBeNull();
  restoringAdapter.dispose();
});

test("evaluatePreview releases a real body/OCAF candidate while retaining every accepted owner", async () => {
  const document = await new MockKernelAdapter().exportAuthoredModelDocument(
    "doc_workspace",
  );
  const adapter = await createAdapter();
  await adapter.restoreAuthoredModelDocument(document);
  const acceptedState = (
    adapter as unknown as { runtimeState: { authoringState: OwnedState } }
  ).runtimeState.authoringState;
  const acceptedOwners = namedBodyOwners(acceptedState);
  const sourceFeature = document.features[0]!;
  const deletionOrder: string[] = [];
  const instrumented = new Set<object>();
  releaseDiscardedSpy.mockClear();
  releaseDiscardedSpy.mockImplementation((discarded: OwnedState) => {
    for (const body of ownedBodies(discarded)) {
      if (!body.naming || instrumented.has(body.naming.document)) continue;
      instrumented.add(body.naming.document);
      const wrap = (name: string, owner: { delete(): void }) => {
        const original = owner.delete.bind(owner);
        owner.delete = () => {
          deletionOrder.push(name);
          original();
        };
      };
      wrap("body-label", body.naming.bodyLabel);
      for (const label of body.naming.topologyLabelsByKey.values())
        wrap("topology-label", label);
      for (const label of body.naming.selectorLabelsByKey.values())
        wrap("selector-label", label);
      wrap("document", body.naming.document);
    }
  });

  const preview = await adapter.evaluatePreview({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: document.revisionId,
    previewId: "preview_cleanup",
    replacesFeatureId: sourceFeature.featureId,
    definition: sourceFeature.definition,
  });

  expect(preview.previewId).toBe("preview_cleanup");
  const previewCleanup = releaseDiscardedSpy.mock.calls.at(-1)!;
  const discardedPreview = previewCleanup[0] as OwnedState;
  expect(discardedPreview).not.toBe(acceptedState);
  expect(previewCleanup[1]).toEqual([acceptedState]);
  const discardedOwners = discardedNamingOwners(
    discardedPreview,
    acceptedOwners,
  );
  expectNamingOwnersDeleted(discardedOwners);
  expectNamingOwnersLive(acceptedOwners);
  expect(deletionOrder.indexOf("body-label")).toBeLessThan(
    deletionOrder.indexOf("document"),
  );
  expect(deletionOrder.lastIndexOf("topology-label")).toBeLessThan(
    deletionOrder.indexOf("document"),
  );
  expect(deletionOrder.lastIndexOf("selector-label")).toBeLessThan(
    deletionOrder.indexOf("document"),
  );
  expect(
    (adapter as unknown as { runtimeState: { authoringState: unknown } })
      .runtimeState.authoringState,
  ).toBe(acceptedState);
  releaseDiscardedSpy.mockReset();
  adapter.dispose();
});

test("real OCC restore lifecycle distinguishes old retention from bounded cleanup", async () => {
  const document = await new MockKernelAdapter().exportAuthoredModelDocument(
    "doc_workspace",
  );
  const countLiveBodyOwners = (calls: readonly unknown[][]) => {
    const owners = new Set<{ isDeleted?: () => boolean }>();
    for (const [discarded] of calls as Array<
      [
        {
          bodies?: readonly {
            shape: { isDeleted?: () => boolean };
            naming?: {
              document: { isDeleted?: () => boolean };
              bodyLabel: { isDeleted?: () => boolean };
              topologyLabelsByKey: ReadonlyMap<
                unknown,
                { isDeleted?: () => boolean }
              >;
              selectorLabelsByKey: ReadonlyMap<
                unknown,
                { isDeleted?: () => boolean }
              >;
            };
          }[];
        },
      ]
    >) {
      for (const body of discarded.bodies ?? []) {
        owners.add(body.shape);
        if (body.naming) {
          owners.add(body.naming.document);
          owners.add(body.naming.bodyLabel);
          for (const label of body.naming.topologyLabelsByKey.values())
            owners.add(label);
          for (const label of body.naming.selectorLabelsByKey.values())
            owners.add(label);
        }
      }
    }
    return [...owners].filter((owner) => !owner.isDeleted?.()).length;
  };

  const run = async (cleanupEnabled: boolean) => {
    const adapter = await createAdapter();
    releaseBehavior.enabled = cleanupEnabled;
    releaseDiscardedSpy.mockClear();
    for (let rebuild = 0; rebuild < 6; rebuild += 1) {
      await adapter.restoreAuthoredModelDocument(document);
    }
    const calls = [...releaseDiscardedSpy.mock.calls];
    const liveOwners = countLiveBodyOwners(calls);
    const currentState = (
      adapter as unknown as { runtimeState: { authoringState: unknown } }
    ).runtimeState.authoringState;

    if (!cleanupEnabled) {
      releaseBehavior.enabled = true;
      for (let index = 0; index < calls.length; index += 1) {
        const [discarded] = calls[index]!;
        const laterStates = calls
          .slice(index + 1)
          .map(([laterDiscarded]) => laterDiscarded);
        const { releaseDiscardedOccAuthoringStateObjects } =
          await import("@/domain/modeling/occ/memory");
        releaseDiscardedOccAuthoringStateObjects(discarded, [
          ...laterStates,
          currentState,
        ]);
      }
      expect(countLiveBodyOwners(calls)).toBe(0);
    }
    adapter.dispose();
    return { calls: calls.length, liveOwners };
  };

  try {
    const oldLifecycle = await run(false);
    const newLifecycle = await run(true);
    console.info("T08 OCC ownership differential", {
      old: oldLifecycle,
      new: newLifecycle,
      liveOwnerDelta: oldLifecycle.liveOwners - newLifecycle.liveOwners,
    });
    expect(oldLifecycle.liveOwners).toBeGreaterThan(newLifecycle.liveOwners);
    expect(newLifecycle.liveOwners).toBe(0);
  } finally {
    releaseBehavior.enabled = true;
  }
});
