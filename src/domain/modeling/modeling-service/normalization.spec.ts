import { test, expect } from "vitest";

import { isExpressionAuthoredValue } from "@/contracts/modeling/authored-values";
import {
  normalizeRegionRecords,
  normalizeShellFeatureParameters,
  normalizeSketchDerivationDefinition,
  normalizeSketchEntityDefinition,
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
    piecewiseCubicOutputs: [],
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

function makeSplinePayload() {
  return {
    kind: "spline",
    entityId: "sketch_entity_spline",
    label: "Spline",
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_normalization",
      entityId: "sketch_entity_spline",
    },
    isConstruction: false,
    pointOccurrenceIds: [
      "occurrence-start",
      "occurrence-middle",
      "occurrence-end",
    ],
    pointOccurrences: [
      {
        occurrenceId: "occurrence-middle",
        pointId: "sketch_point_middle",
        tangent: { kind: "authored", vector: [0, 0] },
      },
      {
        occurrenceId: "occurrence-end",
        pointId: "sketch_point_alias",
        tangent: { kind: "automatic" },
      },
      {
        occurrenceId: "occurrence-start",
        pointId: "sketch_point_alias",
        tangent: { kind: "automatic" },
      },
    ],
    closure: "positional",
    interpolationPolicy: "centripetal-mean-arm-v1",
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
    normalized.kind === "offset" &&
      isExpressionAuthoredValue(normalized.distance),
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
      normalizeSketchDerivationDefinition(
        makeOffsetPayload({ jointOutputs: "nope" }),
      ),
    "A non-array jointOutputs field should be rejected at the normalization boundary.",
  ).toThrow();
});

test("spline normalization rejects unknown fields without changing authored ordering or tangent intent", () => {
  const payload = makeSplinePayload();
  const normalized = normalizeSketchEntityDefinition(payload);
  expect(normalized).toEqual(payload);
  expect(normalized.kind).toBe("spline");
  if (normalized.kind !== "spline") return;
  expect(normalized.pointOccurrenceIds).toEqual([
    "occurrence-start",
    "occurrence-middle",
    "occurrence-end",
  ]);
  expect(
    normalized.pointOccurrences.map(({ occurrenceId }) => occurrenceId),
  ).toEqual(["occurrence-middle", "occurrence-end", "occurrence-start"]);
  expect(normalized.pointOccurrences[0]?.tangent).toEqual({
    kind: "authored",
    vector: [0, 0],
  });
  expect(normalized.pointOccurrences[1]?.pointId).toBe("sketch_point_alias");
  expect(normalized.pointOccurrences[2]?.pointId).toBe("sketch_point_alias");
  expect(normalized.closure).toBe("positional");

  expect(() =>
    normalizeSketchEntityDefinition({ ...payload, unknownEntityField: true }),
  ).toThrow();
  expect(() =>
    normalizeSketchEntityDefinition({
      ...payload,
      pointOccurrences: [
        { ...payload.pointOccurrences[0], unknownOccurrenceField: true },
        ...payload.pointOccurrences.slice(1),
      ],
    }),
  ).toThrow();
  expect(() =>
    normalizeSketchEntityDefinition({
      ...payload,
      pointOccurrences: [
        {
          ...payload.pointOccurrences[0],
          tangent: {
            ...payload.pointOccurrences[0]!.tangent,
            unknownTangentField: true,
          },
        },
        ...payload.pointOccurrences.slice(1),
      ],
    }),
  ).toThrow();
});

// Lane: logic (per docs/testing.md — shell parameter normalization is a domain
// contract boundary with no UI or browser dependency).
// Seam: normalizeShellFeatureParameters distinguishes legacy open-face shells,
// closed cavities, and whole-solid offsets before OCC execution.
test("normalizes split-boundary vertex records without accepting partial or legacy segments", () => {
  const circleBranch = {
    source: { kind: "entity", entityId: "sketch_entity_circle" },
    spanId: "whole",
  };
  const chordBranch = {
    source: { kind: "entity", entityId: "sketch_entity_chord" },
    spanId: "whole",
  };
  const crossing = (position: [number, number], key: string) => ({
    kind: "verifiedIntersection",
    key,
    position,
    witness: {
      first: { branch: chordBranch, parameter: 0, parameterBounds: [0, 0] },
      second: {
        branch: circleBranch,
        parameter: Math.PI,
        parameterBounds: [Math.PI, Math.PI],
      },
      classification: "crossing",
      proof: "exactImplicitLineRootSet",
    },
  });
  const segment = {
    branch: circleBranch,
    sourceParameterInterval: [0, Math.PI],
    traversalDirection: "forward",
    start: crossing([2, 0], "x-right"),
    end: crossing([-2, 0], "x-left"),
    sourceSegmentOrdinal: 1,
  };
  const payload = [
    {
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_split",
      ownerBodyId: null,
      regionId: "region_split",
      signature: "split region signature",
      label: "Split region",
      target: {
        kind: "region",
        sketchId: "sketch_split",
        regionId: "region_split",
      },
      sourceSketch: { kind: "sketch", sketchId: "sketch_split" },
      loops: [
        {
          loopId: "region_loop_split_0",
          role: "outer",
          orientation: "counterClockwise",
          segments: [segment],
          isClosed: true,
        },
      ],
      isClosed: true,
    },
  ];
  const withSegment = (replacement: Record<string, unknown>) => [
    {
      ...payload[0],
      loops: [{ ...payload[0]!.loops[0], segments: [replacement] }],
    },
  ];
  const normalized = normalizeRegionRecords(payload);
  expect(normalized[0]?.loops[0]?.segments[0]?.start?.position).toEqual([2, 0]);
  expect(normalized[0]?.loops[0]?.segments[0]?.end?.position).toEqual([-2, 0]);
  expect(normalized[0]?.loops[0]?.segments[0]?.sourceSegmentOrdinal).toBe(1);
  expect(
    () => normalizeRegionRecords(withSegment({ ...segment, end: undefined })),
    "A split boundary segment without its end vertex is rejected.",
  ).toThrow("Invalid region record payload");
  expect(
    () =>
      normalizeRegionRecords(
        withSegment({
          ...segment,
          startPosition: [2, 0],
          endPosition: [-2, 0],
        }),
      ),
    "The removed position fields are rejected: there is no dual representation.",
  ).toThrow("Invalid region record payload");
});

test("normalizes shell closedHollow and offsetAllFaces without weakening open-face validation", () => {
  const openFaces = normalizeShellFeatureParameters(makeShellPayload());
  expect(
    openFaces.mode,
    "Legacy shell payloads should remain open-face shells.",
  ).toBeUndefined();
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
      makeShellPayload({
        mode: "closedHollow",
        faceTargets: [],
        direction: "outside",
      }),
    ),
  ).toThrow("requires an inside direction");
  expect(() =>
    normalizeShellFeatureParameters(makeShellPayload({ faceTargets: [] })),
  ).toThrow("at least one removable face");
});
