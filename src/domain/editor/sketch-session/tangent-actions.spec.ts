import { describe, expect, test } from "vitest";

import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { PrimitiveRef } from "@/core/editor/schema";

import type { SplinePointOccurrence } from "@/contracts/sketch/spline-geometry";

import {
  isResetTangentEnabled,
  isSetTangentToZeroEnabled,
  resetTangentsToAutomatic,
  resolveTangentActionTargets,
  setTangentsToZero,
} from "./tangent-actions";

type SplineEntity = Extract<
  SketchDefinition["entities"][number],
  { kind: "spline" }
>;

function getSplineOccurrences(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): readonly SplinePointOccurrence<SketchPointId>[] {
  const entity = definition.entities.find(
    (e) => e.entityId === entityId,
  ) as SplineEntity;
  return entity.pointOccurrences;
}

// ── Fixtures ─────────────────────────────────────────────────────────────

const SKETCH_ID = "sketch_1";
const ENTITY_ID = "spline_1" as SketchEntityId;
const POINT_A = "pt_a" as SketchPointId;
const POINT_B = "pt_b" as SketchPointId;
const POINT_C = "pt_c" as SketchPointId;
const OCC_A = "occ_a";
const OCC_B = "occ_b";
const OCC_C = "occ_c";

function makeSplineDefinition(
  occurrences: {
    occurrenceId: string;
    pointId: SketchPointId;
    tangent:
      | { kind: "automatic" }
      | { kind: "authored"; vector: readonly [number, number] };
  }[],
): SketchDefinition {
  return {
    points: occurrences.map((occ) => ({
      pointId: occ.pointId,
      position: [0, 0] as readonly [number, number],
    })),
    entities: [
      {
        entityId: ENTITY_ID,
        kind: "spline",
        isConstruction: false,
        style: {},
        pointOccurrenceIds: occurrences.map((o) => o.occurrenceId),
        pointOccurrences: occurrences,
        closure: "open",
        interpolationPolicy: "centripetal-mean-arm-v1",
      } as SketchDefinition["entities"][number],
    ],
    constraints: [],
    dimensions: [],
    referenceImages: [],
    references: [],
    relationships: [],
  } as unknown as SketchDefinition;
}

const MIXED_DEFINITION = makeSplineDefinition([
  { occurrenceId: OCC_A, pointId: POINT_A, tangent: { kind: "automatic" } },
  {
    occurrenceId: OCC_B,
    pointId: POINT_B,
    tangent: { kind: "authored", vector: [1, 2] },
  },
  {
    occurrenceId: OCC_C,
    pointId: POINT_C,
    tangent: { kind: "authored", vector: [0, 0] },
  },
]);

// ── Target resolution ────────────────────────────────────────────────────

describe("T12e: resolveTangentActionTargets", () => {
  test("sketchTangentHandle maps to its occurrence", () => {
    const ref: PrimitiveRef = {
      kind: "sketchTangentHandle",
      sketchId: SKETCH_ID,
      entityId: ENTITY_ID,
      occurrenceId: OCC_B,
      pointId: POINT_B,
    };
    const targets = resolveTangentActionTargets(
      [ref],
      MIXED_DEFINITION,
      SKETCH_ID,
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]!.entityId).toBe(ENTITY_ID);
    expect(targets[0]!.occurrenceId).toBe(OCC_B);
  });

  test("sketchPoint maps to every occurrence using that point", () => {
    const ref: PrimitiveRef = {
      kind: "sketchPoint",
      sketchId: SKETCH_ID,
      pointId: POINT_B,
    };
    const targets = resolveTangentActionTargets(
      [ref],
      MIXED_DEFINITION,
      SKETCH_ID,
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]!.occurrenceId).toBe(OCC_B);
  });

  test("multiple selected targets are deduplicated", () => {
    const refs: PrimitiveRef[] = [
      {
        kind: "sketchTangentHandle",
        sketchId: SKETCH_ID,
        entityId: ENTITY_ID,
        occurrenceId: OCC_B,
        pointId: POINT_B,
      },
      {
        kind: "sketchPoint",
        sketchId: SKETCH_ID,
        pointId: POINT_B,
      },
    ];
    const targets = resolveTangentActionTargets(
      refs,
      MIXED_DEFINITION,
      SKETCH_ID,
    );
    expect(targets).toHaveLength(1);
  });

  test("multiple targets from different occurrences", () => {
    const refs: PrimitiveRef[] = [
      {
        kind: "sketchTangentHandle",
        sketchId: SKETCH_ID,
        entityId: ENTITY_ID,
        occurrenceId: OCC_A,
        pointId: POINT_A,
      },
      {
        kind: "sketchTangentHandle",
        sketchId: SKETCH_ID,
        entityId: ENTITY_ID,
        occurrenceId: OCC_B,
        pointId: POINT_B,
      },
    ];
    const targets = resolveTangentActionTargets(
      refs,
      MIXED_DEFINITION,
      SKETCH_ID,
    );
    expect(targets).toHaveLength(2);
  });

  test("non-spline-related selection yields empty", () => {
    const ref: PrimitiveRef = {
      kind: "sketchEntity",
      sketchId: SKETCH_ID,
      entityId: "line_1" as SketchEntityId,
    };
    const targets = resolveTangentActionTargets(
      [ref],
      MIXED_DEFINITION,
      SKETCH_ID,
    );
    expect(targets).toHaveLength(0);
  });

  test("wrong sketch ID yields empty", () => {
    const ref: PrimitiveRef = {
      kind: "sketchTangentHandle",
      sketchId: "other_sketch",
      entityId: ENTITY_ID,
      occurrenceId: OCC_B,
      pointId: POINT_B,
    };
    const targets = resolveTangentActionTargets(
      [ref],
      MIXED_DEFINITION,
      SKETCH_ID,
    );
    expect(targets).toHaveLength(0);
  });
});

// ── Enabled-state rules ──────────────────────────────────────────────────

describe("T12e: enabled-state rules", () => {
  test("resetTangent enabled when at least one target is authored", () => {
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_B }];
    expect(isResetTangentEnabled(targets, MIXED_DEFINITION)).toBe(true);
  });

  test("resetTangent disabled when all targets are automatic", () => {
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_A }];
    expect(isResetTangentEnabled(targets, MIXED_DEFINITION)).toBe(false);
  });

  test("resetTangent enabled for mixed targets (one automatic, one authored)", () => {
    const targets = [
      { entityId: ENTITY_ID, occurrenceId: OCC_A },
      { entityId: ENTITY_ID, occurrenceId: OCC_B },
    ];
    expect(isResetTangentEnabled(targets, MIXED_DEFINITION)).toBe(true);
  });

  test("setTangentToZero enabled when at least one target is not exactly [0,0]", () => {
    // OCC_B has [1, 2], not [0, 0].
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_B }];
    expect(isSetTangentToZeroEnabled(targets, MIXED_DEFINITION)).toBe(true);
  });

  test("setTangentToZero enabled for automatic targets (they are not [0,0])", () => {
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_A }];
    expect(isSetTangentToZeroEnabled(targets, MIXED_DEFINITION)).toBe(true);
  });

  test("setTangentToZero disabled when all targets are already exactly [0,0]", () => {
    // OCC_C has [0, 0].
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_C }];
    expect(isSetTangentToZeroEnabled(targets, MIXED_DEFINITION)).toBe(false);
  });
});

// ── Definition edits ─────────────────────────────────────────────────────

describe("T12e: resetTangentsToAutomatic", () => {
  test("authored → automatic", () => {
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_B }];
    const result = resetTangentsToAutomatic(MIXED_DEFINITION, targets);
    expect(result).not.toBe(MIXED_DEFINITION);
    const occs = getSplineOccurrences(result, ENTITY_ID);
    const occ = occs.find((o) => o.occurrenceId === OCC_B)!;
    expect(occ.tangent).toEqual({ kind: "automatic" });
  });

  test("already automatic → no-op (same reference)", () => {
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_A }];
    const result = resetTangentsToAutomatic(MIXED_DEFINITION, targets);
    expect(result).toBe(MIXED_DEFINITION);
  });

  test("multiple targets: authored and zero → both automatic", () => {
    const targets = [
      { entityId: ENTITY_ID, occurrenceId: OCC_B },
      { entityId: ENTITY_ID, occurrenceId: OCC_C },
    ];
    const result = resetTangentsToAutomatic(MIXED_DEFINITION, targets);
    expect(result).not.toBe(MIXED_DEFINITION);
    const occs = getSplineOccurrences(result, ENTITY_ID);
    for (const t of targets) {
      const occ = occs.find((o) => o.occurrenceId === t.occurrenceId)!;
      expect(occ.tangent).toEqual({ kind: "automatic" });
    }
    // OCC_A should remain automatic (untouched).
    const occA = occs.find((o) => o.occurrenceId === OCC_A)!;
    expect(occA.tangent).toEqual({ kind: "automatic" });
  });
});

describe("T12e: setTangentsToZero", () => {
  test("automatic → authored [0,0]", () => {
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_A }];
    const result = setTangentsToZero(MIXED_DEFINITION, targets);
    expect(result).not.toBe(MIXED_DEFINITION);
    const occs = getSplineOccurrences(result, ENTITY_ID);
    const occ = occs.find((o) => o.occurrenceId === OCC_A)!;
    expect(occ.tangent).toEqual({ kind: "authored", vector: [0, 0] });
  });

  test("authored non-zero → authored [0,0]", () => {
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_B }];
    const result = setTangentsToZero(MIXED_DEFINITION, targets);
    expect(result).not.toBe(MIXED_DEFINITION);
    const occs = getSplineOccurrences(result, ENTITY_ID);
    const occ = occs.find((o) => o.occurrenceId === OCC_B)!;
    expect(occ.tangent).toEqual({ kind: "authored", vector: [0, 0] });
  });

  test("already [0,0] → no-op (same reference)", () => {
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_C }];
    const result = setTangentsToZero(MIXED_DEFINITION, targets);
    expect(result).toBe(MIXED_DEFINITION);
  });
});

// ── One action / no-op boundary ──────────────────────────────────────────

describe("T12e: no-op records nothing", () => {
  test("resetTangentsToAutomatic on already-automatic returns identity", () => {
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_A }];
    const result = resetTangentsToAutomatic(MIXED_DEFINITION, targets);
    expect(result).toBe(MIXED_DEFINITION);
  });

  test("setTangentsToZero on already-zero returns identity", () => {
    const targets = [{ entityId: ENTITY_ID, occurrenceId: OCC_C }];
    const result = setTangentsToZero(MIXED_DEFINITION, targets);
    expect(result).toBe(MIXED_DEFINITION);
  });
});

// ── A3: computeSketchTangentActionState exclusions ──────────────────────

import { computeSketchTangentActionState } from "./tangent-actions";

describe("T12e: computeSketchTangentActionState exclusions (A3)", () => {
  function makeSessionLike(overrides: Record<string, unknown>) {
    return {
      definition: MIXED_DEFINITION,
      sketchId: null,
      activeDrag: null,
      activeSpecialMode: null,
      activeTool: null,
      activeAnnotationEdit: null,
      ...overrides,
    } as unknown as import("./types").SketchSessionState;
  }

  const handleRef: PrimitiveRef = {
    kind: "sketchTangentHandle",
    sketchId: "sketch_draft",
    entityId: ENTITY_ID,
    occurrenceId: OCC_B,
    pointId: POINT_B,
  };

  test("returns state when idle with eligible selection", () => {
    const result = computeSketchTangentActionState(makeSessionLike({}), [
      handleRef,
    ]);
    expect(result).not.toBeNull();
    expect(result!.visible).toBe(true);
  });

  test("returns null during activeAnnotationEdit (A3)", () => {
    const result = computeSketchTangentActionState(
      makeSessionLike({ activeAnnotationEdit: { target: {} } }),
      [handleRef],
    );
    expect(result).toBeNull();
  });

  test("returns null during activeDrag", () => {
    const result = computeSketchTangentActionState(
      makeSessionLike({ activeDrag: {} }),
      [handleRef],
    );
    expect(result).toBeNull();
  });

  test("returns null during activeTool", () => {
    const result = computeSketchTangentActionState(
      makeSessionLike({ activeTool: "line" }),
      [handleRef],
    );
    expect(result).toBeNull();
  });
});
