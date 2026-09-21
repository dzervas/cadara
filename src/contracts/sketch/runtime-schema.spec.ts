import { expect, test } from "vitest";

import {
  validateSketchDefinition,
  validateSketchRecord,
} from "@/contracts/sketch/runtime-schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

// Lane: logic. Seam: strict current sketch-record runtime contract.
test("invalid and stale sketch derivations cannot carry consumable regions", async () => {
  const snapshot = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const current = snapshot.snapshot.document.sketches[0]!.sketch;
  expect(validateSketchRecord(current).success).toBe(true);

  const invalidWithCachedRegions = structuredClone(current);
  invalidWithCachedRegions.derivedValidity = {
    state: "invalid",
    diagnostics: [
      {
        code: "missing-geometry",
        severity: "error",
        message: "Missing geometry.",
        target: null,
      },
    ],
  };
  expect(validateSketchRecord(invalidWithCachedRegions).success).toBe(false);

  const staleWithCachedRegions = structuredClone(current);
  staleWithCachedRegions.derivedValidity = {
    state: "stale",
    diagnostics: [],
  };
  expect(validateSketchRecord(staleWithCachedRegions).success).toBe(false);
});

test("ordinary splines round-trip only in the current aggregate format", async () => {
  const snapshot = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const definition = structuredClone(
    snapshot.snapshot.document.sketches[0]!.sketch.definition,
  );
  const [first, second] = definition.pointIds;
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  definition.entityIds.push("sketch_entity_spline_contract");
  definition.entities.push({
    kind: "spline",
    entityId: "sketch_entity_spline_contract",
    label: "Spline contract",
    target: {
      kind: "sketchEntity",
      sketchId: definition.points[0]!.target.sketchId,
      entityId: "sketch_entity_spline_contract",
    },
    isConstruction: false,
    pointOccurrenceIds: ["occurrence-a", "occurrence-b"],
    pointOccurrences: [
      {
        occurrenceId: "occurrence-a",
        pointId: first!,
        tangent: { kind: "automatic" },
      },
      {
        occurrenceId: "occurrence-b",
        pointId: second!,
        tangent: { kind: "authored", vector: [0, 0] },
      },
    ],
    closure: "open",
    interpolationPolicy: "centripetal-mean-arm-v1",
  });

  const roundTrip = JSON.parse(JSON.stringify(definition));
  expect(validateSketchDefinition(roundTrip).success).toBe(true);

  const oldFormat = structuredClone(roundTrip) as Record<string, unknown>;
  const oldEntity = (oldFormat.entities as Array<Record<string, unknown>>).at(
    -1,
  )!;
  delete oldEntity.pointOccurrenceIds;
  delete oldEntity.pointOccurrences;
  delete oldEntity.closure;
  delete oldEntity.interpolationPolicy;
  oldEntity.fitPointIds = [first, second];
  oldEntity.degree = 3;
  expect(validateSketchDefinition(oldFormat).success).toBe(false);
});
