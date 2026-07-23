import { test, expect } from "vitest";

import { isExpressionAuthoredValue } from "@/contracts/modeling/authored-values";
import {
  normalizeRegionRecords,
  normalizeShellFeatureParameters,
  normalizeSketchDerivationDefinition,
} from "@/domain/modeling/modeling-service/normalization";

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

function makeShellPayload(overrides: Record<string, unknown> = {}) {
  return {
    bodyTarget: { kind: "body", bodyId: "body_shell" },
    faceTargets: [{ kind: "face", bodyId: "body_shell", faceId: "face_top" }],
    thickness: 1,
    direction: "inside",
    operation: "join",
    booleanScope: { kind: "targetBody", bodyId: "body_shell" },
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
        makeOffsetPayload({
          jointOutputs: [{ firstSeedEntityId: "sketch_entity_seed" }],
        }),
      ),
    "A malformed joint output payload should be rejected at the normalization boundary.",
  ).toThrow();

  expect(
    () =>
      normalizeSketchDerivationDefinition(makeOffsetPayload({ jointOutputs: "nope" })),
    "A non-array jointOutputs field should be rejected at the normalization boundary.",
  ).toThrow();
});

// Lane: logic (per docs/testing.md — shell parameter normalization is a domain
// contract boundary with no UI or browser dependency).
// Seam: normalizeShellFeatureParameters distinguishes legacy open-face shells,
// closed cavities, and whole-solid offsets before OCC execution.
test("normalizes split-boundary positions without accepting partial positions", () => {
  const payload = [{
    ownerDocumentId: "doc_workspace",
    ownerRevisionId: "rev_0001",
    ownerFeatureId: null,
    ownerSketchId: "sketch_split",
    ownerBodyId: null,
    regionId: "region_split",
    label: "Split region",
    target: { kind: "region", sketchId: "sketch_split", regionId: "region_split" },
    sourceSketch: { kind: "sketch", sketchId: "sketch_split" },
    loops: [{
      loopId: "region_loop_split_0",
      role: "outer",
      orientation: "counterClockwise",
      segments: [{
        source: { kind: "entity", entityId: "sketch_entity_circle" },
        startPointId: null,
        endPointId: null,
        sourceSegmentOrdinal: 1,
        startPosition: [2, 0],
        endPosition: [-2, 0],
      }],
      boundaryPointIds: [],
      isClosed: true,
    }],
    isClosed: true,
  }];
  const normalized = normalizeRegionRecords(payload);
  expect(normalized[0]?.loops[0]?.segments[0]?.startPosition).toEqual([2, 0]);
  expect(normalized[0]?.loops[0]?.segments[0]?.endPosition).toEqual([-2, 0]);
  expect(normalized[0]?.loops[0]?.segments[0]?.sourceSegmentOrdinal).toBe(1);
  expect(() => normalizeRegionRecords([{
    ...payload[0],
    loops: [{ ...payload[0]!.loops[0], segments: [{ ...payload[0]!.loops[0]!.segments[0], endPosition: undefined }] }],
  }])).toThrow("Invalid region boundary segment payload");
});

test("normalizes shell closedHollow and offsetAllFaces without weakening open-face validation", () => {
  const openFaces = normalizeShellFeatureParameters(makeShellPayload());
  expect(openFaces.mode, "Legacy shell payloads should remain open-face shells.").toBeUndefined();
  expect(openFaces.faceTargets.length).toBe(1);

  const closedHollow = normalizeShellFeatureParameters(
    makeShellPayload({ mode: "closedHollow", faceTargets: [] }),
  );
  expect(closedHollow.mode).toBe("closedHollow");
  expect(closedHollow.faceTargets).toEqual([]);
  expect(closedHollow.direction).toBe("inside");

  const offsetAll = normalizeShellFeatureParameters(
    makeShellPayload({ mode: "offsetAllFaces", faceTargets: [] }),
  );
  expect(offsetAll.mode).toBe("offsetAllFaces");
  expect(offsetAll.faceTargets).toEqual([]);
  expect(offsetAll.direction).toBe("inside");

  expect(() =>
    normalizeShellFeatureParameters(
      makeShellPayload({ mode: "offsetAllFaces" }),
    ),
  ).toThrow("cannot include face targets");
  expect(() =>
    normalizeShellFeatureParameters(
      makeShellPayload({ mode: "closedHollow", faceTargets: [], direction: "outside" }),
    ),
  ).toThrow("requires an inside direction");
  expect(() =>
    normalizeShellFeatureParameters(makeShellPayload({ faceTargets: [] })),
  ).toThrow("at least one removable face");
});
