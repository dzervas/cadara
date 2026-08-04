import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";

import { PLANE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

const applyFeatureSpy = vi.hoisted(() => vi.fn());

vi.mock("@/domain/modeling/occ/authoring-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/domain/modeling/occ/authoring-state")
  >();
  return {
    ...actual,
    applyOccFeatureToAuthoringState: (
      ...args: Parameters<typeof actual.applyOccFeatureToAuthoringState>
    ) => {
      applyFeatureSpy();
      return actual.applyOccFeatureToAuthoringState(...args);
    },
  };
});

const { OpenCascadeKernelAdapter } = await import(
  "@/domain/modeling/opencascade-kernel-adapter"
);

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

async function createAdapter() {
  const module = (await import("../../../public/cadara-occ.js")) as {
    default: CustomOpenCascadeMainJSForTest;
  };
  const wasmBinary = new Uint8Array(
    await readFile(new URL("../../../public/cadara-occ.wasm", import.meta.url)),
  );
  const oc = await new module.default({ wasmBinary });
  const createSolver = (revisionId: string | null) =>
    new SketchConstraintSolverAdapter({ revisionId });
  return new OpenCascadeKernelAdapter({
    solverAdapter: createSolver(null),
    solverAdapterFactory: createSolver,
    getOpenCascadeInstance: async () => oc,
  });
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
  expect(after.snapshot.document.features.map((feature) => feature.featureId)).toEqual(
    beforeFeatureIds,
  );
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
