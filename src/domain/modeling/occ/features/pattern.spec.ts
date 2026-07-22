import { readFile } from "node:fs/promises";
import { test, expect } from "vitest";

import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  type AdvancedSolidFeatureDefinition,
} from "@/contracts/modeling/advanced-solid";
import { createExpressionAuthoredValue } from "@/contracts/modeling/authored-values";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import {
  applyOccFeatureToAuthoringState,
  createOccAuthoringState,
  rebuildOccAuthoringState,
  type OccAuthoringFeatureRecord,
} from "@/domain/modeling/occ/authoring-state";
import { getShapeVertexPoints } from "@/domain/modeling/occ/features/extrude";
import {
  executeCircularPatternFeature,
  executeLinearPatternFeature,
} from "@/domain/modeling/occ/features/pattern";
import { executeOccFeature } from "@/domain/modeling/occ/features";
import { toGpPnt } from "@/domain/modeling/occ/planes";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { trackNewSolidBody } from "@/domain/modeling/occ/topology";
import { OCC_KERNEL_CAPABILITIES } from "@/domain/modeling/opencascade-kernel-seed";

// Lane: logic (per docs/testing.md).
// Seam: exported OCC advanced-solid pattern execution, generated body identity,
// and conservative topology output stage around real OpenCascade transforms.

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

async function loadCustomOpenCascadeForTest() {
  const module = (await import("../../../../../public/cadara-occ.js")) as {
    default: CustomOpenCascadeMainJSForTest;
  };
  const wasmBinary = new Uint8Array(
    await readFile(
      new URL("../../../../../public/cadara-occ.wasm", import.meta.url),
    ),
  );

  return new module.default({ wasmBinary });
}

function makeTrackedBox(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  ownerFeatureId: FeatureId,
  origin: readonly [number, number, number] = [0, 0, 0],
  size: readonly [number, number, number] = [4, 4, 4],
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(
    toGpPnt(oc, [origin[0], origin[1], origin[2]]),
    size[0],
    size[1],
    size[2],
  );
  box.Build(new oc.Message_ProgressRange_1());
  expect(box.IsDone(), `Expected ${bodyId} box to build.`).toBeTruthy();

  return trackNewSolidBody(oc, {
    bodyId,
    label: bodyId,
    ownerFeatureId,
    shape: box.Shape(),
  });
}

function getShapeBounds(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const points = getShapeVertexPoints(oc, shape);
  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxY: Math.max(...points.map(([, y]) => y)),
    minZ: Math.min(...points.map(([, , z]) => z)),
    maxZ: Math.max(...points.map(([, , z]) => z)),
  };
}

function getBoundsCenter(bounds: ReturnType<typeof getShapeBounds>) {
  return [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ] as const;
}

function expectBoundsClose(
  bounds: ReturnType<typeof getShapeBounds>,
  expected: ReturnType<typeof getShapeBounds>,
) {
  expect(bounds.minX).toBeCloseTo(expected.minX, 5);
  expect(bounds.maxX).toBeCloseTo(expected.maxX, 5);
  expect(bounds.minY).toBeCloseTo(expected.minY, 5);
  expect(bounds.maxY).toBeCloseTo(expected.maxY, 5);
  expect(bounds.minZ).toBeCloseTo(expected.minZ, 5);
  expect(bounds.maxZ).toBeCloseTo(expected.maxZ, 5);
}

function expectCenterClose(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
) {
  expect(actual[0]).toBeCloseTo(expected[0], 5);
  expect(actual[1]).toBeCloseTo(expected[1], 5);
  expect(actual[2]).toBeCloseTo(expected[2], 5);
}

function rotateZ(
  point: readonly [number, number, number],
  degrees: number,
) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    point[0] * cos - point[1] * sin,
    point[0] * sin + point[1] * cos,
    point[2],
  ] as const;
}

function linearDefinition(input: {
  bodyIds: readonly BodyId[];
  direction: DurableRef;
  instanceCount?: unknown;
  spacing?: unknown;
  centered?: unknown;
  oppositeDirection?: unknown;
}) {
  return {
    kind: "linearPattern",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        {
          role: "body" as const,
          targets: input.bodyIds.map((bodyId) => ({ kind: "body" as const, bodyId })),
        },
        { role: "direction" as const, targets: [input.direction] },
      ],
      options: {
        instanceCount: input.instanceCount ?? 3,
        spacing: input.spacing ?? 10,
        centered: input.centered ?? false,
        oppositeDirection: input.oppositeDirection ?? false,
      },
    },
  } satisfies AdvancedSolidFeatureDefinition & { kind: "linearPattern" };
}

function circularDefinition(input: {
  bodyIds: readonly BodyId[];
  axis: DurableRef;
  instanceCount?: unknown;
  angleDegrees?: unknown;
  equalSpace?: unknown;
  oppositeDirection?: unknown;
}) {
  return {
    kind: "circularPattern",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        {
          role: "body" as const,
          targets: input.bodyIds.map((bodyId) => ({ kind: "body" as const, bodyId })),
        },
        { role: "axis" as const, targets: [input.axis] },
      ],
      options: {
        instanceCount: input.instanceCount ?? 4,
        angleDegrees: input.angleDegrees ?? 360,
        equalSpace: input.equalSpace ?? true,
        oppositeDirection: input.oppositeDirection ?? false,
      },
    },
  } satisfies AdvancedSolidFeatureDefinition & { kind: "circularPattern" };
}

const xDirection = {
  kind: "construction",
  constructionId: "construction_plane-yz",
} as const satisfies DurableRef;

const zAxis = {
  kind: "construction",
  constructionId: "construction_plane-xy",
} as const satisfies DurableRef;

test("executeLinearPatternFeature copies count-1 bodies at deterministic X offsets and output ids", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const seed = makeTrackedBox(
    oc,
    "body_linear_seed" as BodyId,
    "feature_linear_seed" as FeatureId,
  );
  const context = createOccAuthoringState(oc, { bodies: [seed] });

  const result = executeLinearPatternFeature(
    context,
    "feature_linear_count3" as FeatureId,
    linearDefinition({ bodyIds: [seed.bodyId], direction: xDirection }),
  );

  expect(result.bodies.map((body) => body.bodyId)).toEqual([
    seed.bodyId,
    "body_feature_linear_count3_linear_seed1_instance1",
    "body_feature_linear_count3_linear_seed1_instance2",
  ]);
  expect(result.producedTargets).toEqual([
    { kind: "body", bodyId: "body_feature_linear_count3_linear_seed1_instance1" },
    { kind: "body", bodyId: "body_feature_linear_count3_linear_seed1_instance2" },
  ]);
  expectBoundsClose(getShapeBounds(oc, result.bodies[0]!.shape), {
    minX: 0,
    maxX: 4,
    minY: 0,
    maxY: 4,
    minZ: 0,
    maxZ: 4,
  });
  expectBoundsClose(getShapeBounds(oc, result.bodies[1]!.shape), {
    minX: 10,
    maxX: 14,
    minY: 0,
    maxY: 4,
    minZ: 0,
    maxZ: 4,
  });
  expectBoundsClose(getShapeBounds(oc, result.bodies[2]!.shape), {
    minX: 20,
    maxX: 24,
    minY: 0,
    maxY: 4,
    minZ: 0,
    maxZ: 4,
  });
});

test("executeLinearPatternFeature honors oppositeDirection", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const seed = makeTrackedBox(
    oc,
    "body_linear_opposite_seed" as BodyId,
    "feature_linear_opposite_seed" as FeatureId,
  );
  const context = createOccAuthoringState(oc, { bodies: [seed] });

  const result = executeLinearPatternFeature(
    context,
    "feature_linear_opposite" as FeatureId,
    linearDefinition({
      bodyIds: [seed.bodyId],
      direction: xDirection,
      instanceCount: 2,
      oppositeDirection: true,
    }),
  );

  expectBoundsClose(getShapeBounds(oc, result.bodies[1]!.shape), {
    minX: -10,
    maxX: -6,
    minY: 0,
    maxY: 4,
    minZ: 0,
    maxZ: 4,
  });
});

test("executeCircularPatternFeature full 360 equal-space produces quadrants without duplicating the seed", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const seed = makeTrackedBox(
    oc,
    "body_circular_seed" as BodyId,
    "feature_circular_seed" as FeatureId,
    [10, 0, 0],
    [2, 2, 2],
  );
  const context = createOccAuthoringState(oc, { bodies: [seed] });

  const result = executeCircularPatternFeature(
    context,
    "feature_circular_full" as FeatureId,
    circularDefinition({ bodyIds: [seed.bodyId], axis: zAxis }),
  );

  expect(result.producedTargets).toHaveLength(3);
  expectBoundsClose(getShapeBounds(oc, result.bodies[1]!.shape), {
    minX: -2,
    maxX: 0,
    minY: 10,
    maxY: 12,
    minZ: 0,
    maxZ: 2,
  });
  expectBoundsClose(getShapeBounds(oc, result.bodies[2]!.shape), {
    minX: -12,
    maxX: -10,
    minY: -2,
    maxY: 0,
    minZ: 0,
    maxZ: 2,
  });
  expectBoundsClose(getShapeBounds(oc, result.bodies[3]!.shape), {
    minX: 0,
    maxX: 2,
    minY: -12,
    maxY: -10,
    minZ: 0,
    maxZ: 2,
  });
});

test("executeCircularPatternFeature implements partial equal-space endpoint and step-angle modes", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const seed = makeTrackedBox(
    oc,
    "body_circular_modes_seed" as BodyId,
    "feature_circular_modes_seed" as FeatureId,
    [10, 0, 0],
    [2, 2, 2],
  );
  const context = createOccAuthoringState(oc, { bodies: [seed] });
  const seedCenter = getBoundsCenter(getShapeBounds(oc, seed.shape));

  const equalPartial = executeCircularPatternFeature(
    context,
    "feature_circular_equal_partial" as FeatureId,
    circularDefinition({
      bodyIds: [seed.bodyId],
      axis: zAxis,
      instanceCount: 3,
      angleDegrees: 90,
      equalSpace: true,
    }),
  );
  expectCenterClose(
    getBoundsCenter(getShapeBounds(oc, equalPartial.bodies[1]!.shape)),
    rotateZ(seedCenter, 45),
  );
  expectCenterClose(
    getBoundsCenter(getShapeBounds(oc, equalPartial.bodies[2]!.shape)),
    rotateZ(seedCenter, 90),
  );

  const stepMode = executeCircularPatternFeature(
    context,
    "feature_circular_step" as FeatureId,
    circularDefinition({
      bodyIds: [seed.bodyId],
      axis: zAxis,
      instanceCount: 3,
      angleDegrees: 30,
      equalSpace: false,
    }),
  );
  expectCenterClose(
    getBoundsCenter(getShapeBounds(oc, stepMode.bodies[1]!.shape)),
    rotateZ(seedCenter, 30),
  );
  expectCenterClose(
    getBoundsCenter(getShapeBounds(oc, stepMode.bodies[2]!.shape)),
    rotateZ(seedCenter, 60),
  );
});

test("pattern output order and deterministic ids are seed-order outer then instance-index inner", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const seedA = makeTrackedBox(
    oc,
    "body_pattern_seed_a" as BodyId,
    "feature_pattern_seed_a" as FeatureId,
  );
  const seedB = makeTrackedBox(
    oc,
    "body_pattern_seed_b" as BodyId,
    "feature_pattern_seed_b" as FeatureId,
    [0, 20, 0],
  );
  const context = createOccAuthoringState(oc, { bodies: [seedA, seedB] });

  const result = executeLinearPatternFeature(
    context,
    "feature_linear_multi" as FeatureId,
    linearDefinition({ bodyIds: [seedA.bodyId, seedB.bodyId], direction: xDirection }),
  );

  expect(result.producedTargets.map((target) => target.kind === "body" && target.bodyId)).toEqual([
    "body_feature_linear_multi_linear_seed1_instance1",
    "body_feature_linear_multi_linear_seed1_instance2",
    "body_feature_linear_multi_linear_seed2_instance1",
    "body_feature_linear_multi_linear_seed2_instance2",
  ]);
});

test("pattern rebuilds retain deterministic body ids and changed count removes obsolete slots", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const seed = makeTrackedBox(
    oc,
    "body_rebuild_seed" as BodyId,
    "feature_rebuild_seed" as FeatureId,
  );
  const initialState = createOccAuthoringState(oc, { bodies: [seed] });
  const featureId = "feature_rebuild_pattern" as FeatureId;
  const feature = {
    featureId,
    label: "Pattern",
    suppressed: false,
    definition: linearDefinition({ bodyIds: [seed.bodyId], direction: xDirection }),
  } satisfies OccAuthoringFeatureRecord;

  const first = applyOccFeatureToAuthoringState(initialState, feature);
  const second = rebuildOccAuthoringState(first, [feature]);
  expect(first.bodies.map((body) => body.bodyId)).toEqual(
    second.bodies.map((body) => body.bodyId),
  );

  const changed = rebuildOccAuthoringState(first, [
    {
      ...feature,
      definition: linearDefinition({
        bodyIds: [seed.bodyId],
        direction: xDirection,
        instanceCount: 2,
      }),
    },
  ]);
  expect(changed.bodies.map((body) => body.bodyId)).toEqual([
    seed.bodyId,
    "body_feature_rebuild_pattern_linear_seed1_instance1",
  ]);
});

test("pattern features do not cross-associate stable output slots when feature order changes", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const seed = makeTrackedBox(
    oc,
    "body_reorder_seed" as BodyId,
    "feature_reorder_seed" as FeatureId,
  );
  const initialState = createOccAuthoringState(oc, { bodies: [seed] });
  const firstFeature = {
    featureId: "feature_reorder_a" as FeatureId,
    label: "Pattern A",
    suppressed: false,
    definition: linearDefinition({ bodyIds: [seed.bodyId], direction: xDirection, instanceCount: 2 }),
  } satisfies OccAuthoringFeatureRecord;
  const secondFeature = {
    featureId: "feature_reorder_b" as FeatureId,
    label: "Pattern B",
    suppressed: false,
    definition: linearDefinition({ bodyIds: [seed.bodyId], direction: xDirection, instanceCount: 2 }),
  } satisfies OccAuthoringFeatureRecord;

  const ordered = rebuildOccAuthoringState(initialState, [firstFeature, secondFeature]);
  const reordered = rebuildOccAuthoringState(ordered, [secondFeature, firstFeature]);

  expect(reordered.bodies.map((body) => body.bodyId)).toEqual([
    seed.bodyId,
    "body_feature_reorder_b_linear_seed1_instance1",
    "body_feature_reorder_a_linear_seed1_instance1",
  ]);
});

test("pattern execution rejects unsupported centered, direction, axis, and expression options structurally", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const seed = makeTrackedBox(
    oc,
    "body_invalid_pattern_seed" as BodyId,
    "feature_invalid_pattern_seed" as FeatureId,
  );
  const context = createOccAuthoringState(oc, { bodies: [seed] });

  expect(() =>
    executeLinearPatternFeature(
      context,
      "feature_invalid_centered" as FeatureId,
      linearDefinition({ bodyIds: [seed.bodyId], direction: xDirection, centered: true }),
    ),
  ).toThrow(/advanced-feature-unsupported-kernel-case: .*centered=true/);

  expect(() =>
    executeLinearPatternFeature(
      context,
      "feature_invalid_direction" as FeatureId,
      linearDefinition({
        bodyIds: [seed.bodyId],
        direction: { kind: "body", bodyId: seed.bodyId },
      }),
    ),
  ).toThrow(/advanced-feature-unsupported-kernel-case:/);

  expect(() =>
    executeCircularPatternFeature(
      context,
      "feature_invalid_axis" as FeatureId,
      circularDefinition({
        bodyIds: [seed.bodyId],
        axis: { kind: "body", bodyId: seed.bodyId },
      }),
    ),
  ).toThrow(/advanced-feature-unsupported-kernel-case:/);

  expect(() =>
    executeCircularPatternFeature(
      context,
      "feature_invalid_expression" as FeatureId,
      circularDefinition({
        bodyIds: [seed.bodyId],
        axis: zAxis,
        angleDegrees: createExpressionAuthoredValue("angle"),
      }),
    ),
  ).toThrow(/advanced-feature-unsupported-kernel-case: .*literal angleDegrees/);
});

test("copied pattern topology publishes conservative unsupported producer stage", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const seed = makeTrackedBox(
    oc,
    "body_topology_pattern_seed" as BodyId,
    "feature_topology_pattern_seed" as FeatureId,
  );
  const context = createOccAuthoringState(oc, { bodies: [seed] });

  const result = executeLinearPatternFeature(
    context,
    "feature_topology_pattern" as FeatureId,
    linearDefinition({ bodyIds: [seed.bodyId], direction: xDirection, instanceCount: 2 }),
  );
  const copiedBodyId = "body_feature_topology_pattern_linear_seed1_instance1";
  const output = result.topologyStage?.outputs.get(copiedBodyId as BodyId);

  expect(output, "Copied pattern body should have an explicit topology-stage output.").toBeDefined();
  expect(output?.sourceTargets.size).toBe(0);
  expect(output?.unsupportedSourceKeys.size).toBe(0);
  expect(result.producedTargets).toEqual([{ kind: "body", bodyId: copiedBodyId }]);
});

test("executeOccFeature dispatch and OCC capabilities include body pattern features", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const seed = makeTrackedBox(
    oc,
    "body_dispatch_pattern_seed" as BodyId,
    "feature_dispatch_pattern_seed" as FeatureId,
  );
  const context = createOccAuthoringState(oc, { bodies: [seed] });
  const definition = linearDefinition({
    bodyIds: [seed.bodyId],
    direction: xDirection,
    instanceCount: 2,
  }) as FeatureDefinition;

  const result = executeOccFeature(
    context,
    "feature_dispatch_pattern" as FeatureId,
    definition,
  );

  expect(result.producedTargets).toEqual([
    { kind: "body", bodyId: "body_feature_dispatch_pattern_linear_seed1_instance1" },
  ]);
  expect(OCC_KERNEL_CAPABILITIES.supportedFeatureKinds).toEqual(
    expect.arrayContaining(["linearPattern", "circularPattern"]),
  );
  expect(OCC_KERNEL_CAPABILITIES.previewableFeatureKinds).toEqual(
    expect.arrayContaining(["linearPattern", "circularPattern"]),
  );
});
