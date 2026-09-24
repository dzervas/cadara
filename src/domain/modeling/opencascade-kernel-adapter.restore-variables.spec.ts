import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import {
  createExpressionAuthoredValue,
  isExpressionAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { DocumentVariableId } from "@/contracts/shared/ids";
import type {
  ProjectSketchExternalReferencesRequest,
  ProjectSketchExternalReferencesResponse,
  SolverTolerancePolicy,
} from "@/contracts/solver/schema";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

async function loadCustomOpenCascadeForTest() {
  const module = (await import("../../../public/cadara-occ.js")) as {
    default: CustomOpenCascadeMainJSForTest;
  };
  const wasmBinary = new Uint8Array(
    await readFile(new URL("../../../public/cadara-occ.wasm", import.meta.url)),
  );

  return new module.default({ wasmBinary });
}

class CapturingToleranceSolverAdapter extends SketchConstraintSolverAdapter {
  readonly requests: {
    kind: "validate" | "solve";
    requestId: string;
    tolerances: SolverTolerancePolicy;
  }[] = [];

  override async validateSketch(
    request: Parameters<SketchConstraintSolverAdapter["validateSketch"]>[0],
  ) {
    this.requests.push({
      kind: "validate",
      requestId: request.requestId,
      tolerances: structuredClone(request.tolerances),
    });
    return super.validateSketch(request);
  }

  override async solveSketch(
    request: Parameters<SketchConstraintSolverAdapter["solveSketch"]>[0],
  ) {
    this.requests.push({
      kind: "solve",
      requestId: request.requestId,
      tolerances: structuredClone(request.tolerances),
    });
    return super.solveSketch(request);
  }
}

class CapturingProjectionOpenCascadeKernelAdapter extends OpenCascadeKernelAdapter {
  readonly projectionRequests: {
    requestId: string;
    tolerances: SolverTolerancePolicy;
  }[] = [];

  protected override projectSketchReferencesFromSnapshot(
    snapshot: WorkspaceSnapshot,
    request: ProjectSketchExternalReferencesRequest,
  ): ProjectSketchExternalReferencesResponse {
    this.projectionRequests.push({
      requestId: request.requestId,
      tolerances: structuredClone(request.tolerances),
    });
    return super.projectSketchReferencesFromSnapshot(snapshot, request);
  }
}

class PartiallySolvedRestoreSolverAdapter extends SketchConstraintSolverAdapter {
  override async solveSketch(
    request: Parameters<SketchConstraintSolverAdapter["solveSketch"]>[0],
  ) {
    const response = await super.solveSketch(request);

    return {
      ...response,
      status: {
        ...response.status,
        solveState: "partiallySolved" as const,
        constraintState: "underConstrained" as const,
      },
      solvedSnapshot: {
        ...response.solvedSnapshot,
        status: {
          ...response.solvedSnapshot.status,
          solveState: "partiallySolved" as const,
          constraintState: "underConstrained" as const,
        },
      },
    };
  }
}

test("OCC preserves document tolerance through variable rebuild, snapshot, export, and commit without native WASM", async () => {
  const seedAdapter = new MockKernelAdapter();
  const document =
    await seedAdapter.exportAuthoredModelDocument("doc_workspace");
  const expected = {
    coincidence: 0.02,
    angleRadians: 0.004,
    minimumSegmentLength: 0.02,
  };
  const variableId = "variable_tolerance_width" as DocumentVariableId;
  const sourceSketch = document.sketches[0]!;
  const freshDefinition = structuredClone(sourceSketch.definition);
  const widthDimension = sourceSketch.definition.dimensions.find(
    (dimension) => dimension.dimensionId === "dimension_1_width",
  );
  if (widthDimension?.kind !== "distance") {
    throw new Error("Seed sketch must expose the width dimension.");
  }
  widthDimension.value = createExpressionAuthoredValue("toleranceWidth");
  document.variables = [
    ...document.variables,
    { variableId, name: "toleranceWidth", valueText: "8" },
  ];
  document.settings.modelingTolerance = expected.coincidence;
  document.settings.angularToleranceRadians = expected.angleRadians;
  document.features = [];
  document.featureOrder = [];
  document.historyOrder = document.historyOrder.filter(
    (item) => item.kind === "sketch",
  );
  document.cursor = { kind: "sketch", sketchId: sourceSketch.sketchId };
  document.bodyLabels = [];

  let fakeOccInitializations = 0;
  const solverAdapter = new CapturingToleranceSolverAdapter({
    revisionId: null,
  });
  const adapter = new CapturingProjectionOpenCascadeKernelAdapter({
    solverAdapter,
    getOpenCascadeInstance: async () => {
      fakeOccInitializations += 1;
      return {} as OpenCascadeInstance;
    },
  });

  await adapter.restoreAuthoredModelDocument(document);
  const restoredSnapshot = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: document.documentId,
  });
  expect(restoredSnapshot.snapshot.document.settings).toMatchObject({
    modelingTolerance: expected.coincidence,
    angularToleranceRadians: expected.angleRadians,
  });

  solverAdapter.requests.length = 0;
  adapter.projectionRequests.length = 0;
  const updated = await adapter.updateDocumentVariable({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: document.documentId,
    baseRevisionId: document.revisionId,
    variableId,
    name: "toleranceWidth",
    valueText: "12",
  });
  expect(updated.revisionState.kind).toBe("accepted");
  expect(
    adapter.projectionRequests.map((request) => request.tolerances),
    "OCC variable rebuild projection must preserve restored settings.",
  ).toEqual([expected]);
  expect(
    solverAdapter.requests.map((request) => [request.kind, request.tolerances]),
    "OCC variable rebuild validation and solve must preserve restored settings.",
  ).toEqual([
    ["validate", expected],
    ["solve", expected],
  ]);

  const exported = await adapter.exportAuthoredModelDocument(
    document.documentId,
  );
  expect(exported.settings).toMatchObject({
    modelingTolerance: expected.coincidence,
    angularToleranceRadians: expected.angleRadians,
  });

  solverAdapter.requests.length = 0;
  adapter.projectionRequests.length = 0;
  const committed = await adapter.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: exported.documentId,
    baseRevisionId: exported.revisionId,
    solverCorrelation: {
      requestId: "request_occ_tolerance_commit",
      projectionRequestId: "request_occ_tolerance_commit:project",
      validationRequestId: "request_occ_tolerance_commit:validate",
      solveRequestId: "request_occ_tolerance_commit:solve",
      regionRequestId: "request_occ_tolerance_commit:regions",
    },
    sketchId: sourceSketch.sketchId,
    sketchLabel: sourceSketch.label,
    plane: sourceSketch.plane,
    definition: exported.sketches[0]!.definition,
  });
  expect(committed.revisionState.kind).toBe("accepted");
  expect(
    adapter.projectionRequests.map((request) => request.tolerances),
  ).toEqual([expected]);
  expect(
    solverAdapter.requests.map((request) => [request.kind, request.tolerances]),
  ).toEqual([
    ["validate", expected],
    ["solve", expected],
  ]);

  const freshSolver = new CapturingToleranceSolverAdapter({ revisionId: null });
  const fresh = new CapturingProjectionOpenCascadeKernelAdapter({
    solverAdapter: freshSolver,
    getOpenCascadeInstance: async () => {
      fakeOccInitializations += 1;
      return {} as OpenCascadeInstance;
    },
  });
  const freshSnapshot = await fresh.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: document.documentId,
  });
  const freshExpected = {
    coincidence: freshSnapshot.snapshot.document.settings.modelingTolerance,
    angleRadians:
      freshSnapshot.snapshot.document.settings.angularToleranceRadians,
    minimumSegmentLength:
      freshSnapshot.snapshot.document.settings.modelingTolerance,
  };
  await fresh.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: document.documentId,
    baseRevisionId: freshSnapshot.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_occ_fresh_tolerance_commit",
      projectionRequestId: "request_occ_fresh_tolerance_commit:project",
      validationRequestId: "request_occ_fresh_tolerance_commit:validate",
      solveRequestId: "request_occ_fresh_tolerance_commit:solve",
      regionRequestId: "request_occ_fresh_tolerance_commit:regions",
    },
    sketchId: null,
    sketchLabel: "Fresh tolerance sketch",
    plane: sourceSketch.plane,
    definition: freshDefinition,
  });
  expect(fresh.projectionRequests.map((request) => request.tolerances)).toEqual(
    [freshExpected],
  );
  expect(
    freshSolver.requests.map((request) => [request.kind, request.tolerances]),
  ).toEqual([
    ["validate", freshExpected],
    ["solve", freshExpected],
  ]);
  expect(fakeOccInitializations).toBeGreaterThan(0);
  fresh.dispose();
  adapter.dispose();
});

test("OCC restore/update rebuilds persisted expression-backed sketch and solid", async () => {
  const seedAdapter = new MockKernelAdapter();
  const document =
    await seedAdapter.exportAuthoredModelDocument("doc_workspace");
  const sketch = document.sketches.find(
    (entry) => entry.sketchId === "sketch_primary",
  );
  expect(
    sketch,
    "Seed document should include the primary sketch.",
  ).toBeTruthy();
  if (!sketch) return;

  const widthDimension = sketch.definition.dimensions.find(
    (dimension) => dimension.dimensionId === "dimension_1_width",
  );
  expect(widthDimension?.kind).toBe("distance");
  if (widthDimension?.kind !== "distance") return;

  // Simulate a persisted imported/profile sketch whose geometry is usable but
  // under-constrained when rebuilt from authored inputs.
  sketch.definition.constraintIds = [];
  sketch.definition.constraints = [];
  const variableId = "variable_import_width" as DocumentVariableId;
  widthDimension.value = createExpressionAuthoredValue("importWidth");
  document.variables = [
    ...document.variables,
    { variableId, name: "importWidth", valueText: "8" },
  ];

  const oc = await loadCustomOpenCascadeForTest();
  const adapter = new OpenCascadeKernelAdapter({
    solverAdapter: new PartiallySolvedRestoreSolverAdapter({
      revisionId: null,
    }),
    getOpenCascadeInstance: async () => oc,
  });

  await adapter.restoreAuthoredModelDocument(document);
  const before = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  expect(
    before.snapshot.document.features.some(
      (feature) => feature.featureId === "feature_extrude-1",
    ),
    "Restore should rebuild the solid feature that depends on the sketch.",
  ).toBe(true);

  const updated = await adapter.updateDocumentVariable({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: before.snapshot.document.revisionId,
    variableId,
    name: "importWidth",
    valueText: "12",
  });

  expect(updated.revisionState.kind).toBe("accepted");
  expect(
    updated.changedTargets.some(
      (target) =>
        target.kind === "sketch" && target.sketchId === "sketch_primary",
    ),
    "Variable update should invalidate the rebuilt authored sketch.",
  ).toBe(true);
  expect(
    updated.changedTargets.some(
      (target) =>
        target.kind === "feature" && target.featureId === "feature_extrude-1",
    ),
    "Variable update should invalidate the dependent solid.",
  ).toBe(true);

  const after = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const afterSketch = after.snapshot.document.sketches.find(
    (entry) => entry.sketchId === "sketch_primary",
  );
  const afterWidth = afterSketch?.sketch.solvedSnapshot.dimensionStatuses.find(
    (status) => status.dimensionId === "dimension_1_width",
  );
  expect(afterWidth?.solvedValue).toBeCloseTo(12, 5);
  const authoredWidth = afterSketch?.sketch.definition.dimensions.find(
    (dimension) => dimension.dimensionId === "dimension_1_width",
  );
  expect(
    authoredWidth?.kind === "distance" &&
      isExpressionAuthoredValue(authoredWidth.value),
    "Rebuild should keep persisted authored expressions in the sketch definition.",
  ).toBe(true);
  expect(
    after.snapshot.document.features.some(
      (feature) => feature.featureId === "feature_extrude-1",
    ),
    "Variable update should keep the dependent solid feature rebuilt.",
  ).toBe(true);
});
