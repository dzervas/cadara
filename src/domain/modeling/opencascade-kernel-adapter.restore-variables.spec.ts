import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import {
  createExpressionAuthoredValue,
  isExpressionAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { DocumentVariableId } from "@/contracts/shared/ids";
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

test("OCC restore/update rebuilds persisted expression-backed sketch and solid", async () => {
  const seedAdapter = new MockKernelAdapter();
  const document = await seedAdapter.exportAuthoredModelDocument("doc_workspace");
  const sketch = document.sketches.find(
    (entry) => entry.sketchId === "sketch_primary",
  );
  expect(sketch, "Seed document should include the primary sketch.").toBeTruthy();
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
    solverAdapter: new PartiallySolvedRestoreSolverAdapter({ revisionId: null }),
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
      (target) => target.kind === "sketch" && target.sketchId === "sketch_primary",
    ),
    "Variable update should invalidate the rebuilt authored sketch.",
  ).toBe(true);
  expect(
    updated.changedTargets.some(
      (target) => target.kind === "feature" && target.featureId === "feature_extrude-1",
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
    authoredWidth?.kind === "distance" && isExpressionAuthoredValue(authoredWidth.value),
    "Rebuild should keep persisted authored expressions in the sketch definition.",
  ).toBe(true);
  expect(
    after.snapshot.document.features.some(
      (feature) => feature.featureId === "feature_extrude-1",
    ),
    "Variable update should keep the dependent solid feature rebuilt.",
  ).toBe(true);
});
