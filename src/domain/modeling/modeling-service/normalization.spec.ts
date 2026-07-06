import { test, expect } from "vitest";

import { isExpressionAuthoredValue } from "@/contracts/modeling/authored-values";
import { normalizeSketchDerivationDefinition } from "@/domain/modeling/modeling-service/normalization";

// Lane: logic (per docs/testing.md — normalization is a domain persistence/normalization
// seam under src/domain/, exercised through its exported entrypoint).
// Seam: normalizeSketchDerivationDefinition offset branch, the persistence boundary that
// re-parses stored offset payloads into a typed SketchDerivationDefinition.
function makeOffsetPayload(overrides: Record<string, unknown> = {}) {
  return {
    derivationId: "sketch_derivation_1_offset",
    label: "offset 1",
    kind: "offset",
    seedEntityIds: ["sketch_entity_seed"],
    distance: { source: "expression", valueText: "wall / 2" },
    jointPolicy: "trimExtendArcFallback",
    jointOutputs: [
      {
        firstSeedEntityId: "sketch_entity_seed",
        secondSeedEntityId: "sketch_entity_seed_b",
        outputEntityId: "sketch_entity_joint",
        centerPointId: "sketch_point_jc",
        startPointId: "sketch_point_js",
        endPointId: "sketch_point_je",
      },
    ],
    outputs: [
      {
        seedEntityId: "sketch_entity_seed",
        outputEntityId: "sketch_entity_offset",
        instanceIndex: 1,
        seedPointIds: ["sketch_point_a", "sketch_point_b"],
        outputPointIds: ["sketch_point_oa", "sketch_point_ob"],
      },
    ],
    ...overrides,
  };
}

test("src/domain/modeling/modeling-service/normalization.spec.ts", () => {
  const normalized = normalizeSketchDerivationDefinition(makeOffsetPayload());
  expect(
    normalized.kind === "offset" && normalized.jointPolicy,
    "A valid offset payload should normalize to the offset kind with its joint policy.",
  ).toBe("trimExtendArcFallback");
  expect(
    normalized.kind === "offset" && normalized.jointOutputs.length,
    "Joint outputs should survive normalization.",
  ).toBe(1);
  expect(
    normalized.kind === "offset" && isExpressionAuthoredValue(normalized.distance),
    "An authored expression distance should survive normalization.",
  ).toBeTruthy();

  expect(
    () =>
      normalizeSketchDerivationDefinition(
        makeOffsetPayload({ jointPolicy: "bogusPolicy" }),
      ),
    "An unknown joint policy should be rejected at the normalization boundary.",
  ).toThrow();

  expect(
    () =>
      normalizeSketchDerivationDefinition(
        makeOffsetPayload({ jointOutputs: [{ firstSeedEntityId: "sketch_entity_seed" }] }),
      ),
    "A malformed joint output payload should be rejected at the normalization boundary.",
  ).toThrow();

  expect(
    () =>
      normalizeSketchDerivationDefinition(makeOffsetPayload({ jointOutputs: "nope" })),
    "A non-array jointOutputs field should be rejected at the normalization boundary.",
  ).toThrow();
});
