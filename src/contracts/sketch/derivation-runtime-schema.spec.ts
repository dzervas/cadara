import { test, expect } from "vitest";

import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";

test("src/contracts/sketch/derivation-runtime-schema.spec.ts", () => {
  const baseDefinition: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha1",
    referenceIds: [],
    references: [],
    pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_oa", "sketch_point_ob"],
    points: (
      [
        ["sketch_point_a", [0, 0]],
        ["sketch_point_b", [4, 0]],
        ["sketch_point_oa", [0, 1]],
        ["sketch_point_ob", [4, 1]],
      ] as const
    ).map(([pointId, position]) => ({
      pointId,
      label: pointId,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId,
      },
      position,
      isConstruction: false,
    })),
    entityIds: ["sketch_entity_seed", "sketch_entity_offset"],
    entities: (
      [
        ["sketch_entity_seed", "sketch_point_a", "sketch_point_b"],
        ["sketch_entity_offset", "sketch_point_oa", "sketch_point_ob"],
      ] as const
    ).map(([entityId, startPointId, endPointId]) => ({
      kind: "lineSegment",
      entityId,
      label: entityId,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId,
      },
      isConstruction: false,
      startPointId,
      endPointId,
    })),
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };

  function withOffsetDistance(distance: unknown): SketchDefinition {
    return {
      ...baseDefinition,
      derivedRelationships: [
        {
          derivationId: "sketch_derivation_1_offset",
          label: "offset 1",
          kind: "offset",
          seedEntityIds: ["sketch_entity_seed"],
          distance,
          jointPolicy: "trimExtendArcFallback",
          jointOutputs: [],
          outputs: [
            {
              seedEntityId: "sketch_entity_seed",
              outputEntityId: "sketch_entity_offset",
              instanceIndex: 1,
              seedPointIds: ["sketch_point_a", "sketch_point_b"],
              outputPointIds: ["sketch_point_oa", "sketch_point_ob"],
            },
          ],
        },
      ],
    };
  }

  const numericDistance = validateSketchDefinition(withOffsetDistance(1.5));
  expect(
    numericDistance.success,
    "Runtime schema should accept offset derivations with a numeric distance.",
  ).toBeTruthy();

  const expressionDistance = validateSketchDefinition(
    withOffsetDistance({ source: "expression", valueText: "wall / 2" }),
  );
  expect(
    expressionDistance.success,
    "Runtime schema should accept offset derivations with an expression distance.",
  ).toBeTruthy();

  const literalDistance = validateSketchDefinition(
    withOffsetDistance({ source: "literal", value: 2 }),
  );
  expect(
    literalDistance.success,
    "Runtime schema should accept offset derivations with an authored literal distance.",
  ).toBeTruthy();

  const roundTrip = validateSketchDefinition(
    JSON.parse(JSON.stringify(withOffsetDistance(1.5))) as unknown,
  );
  expect(
    roundTrip.success,
    "Offset derivations should survive serialize/parse round-trips.",
  ).toBeTruthy();
  const relationship = roundTrip.data.derivedRelationships?.[0];
  expect(
    relationship?.kind === "offset" && relationship.jointPolicy,
    "Round-tripped offset derivations should preserve the joint policy.",
  ).toBe("trimExtendArcFallback");

  const stringDistance = validateSketchDefinition(withOffsetDistance("oops"));
  expect(
    stringDistance.success,
    "Runtime schema should reject offset derivations with a bare string distance.",
  ).toBeFalsy();

  const nonFiniteDistance = validateSketchDefinition(
    withOffsetDistance(Number.POSITIVE_INFINITY),
  );
  expect(
    nonFiniteDistance.success,
    "Runtime schema should reject offset derivations with a non-finite distance.",
  ).toBeFalsy();

  const invalidJointPolicy = validateSketchDefinition({
    ...withOffsetDistance(1),
    derivedRelationships: [
      {
        ...withOffsetDistance(1).derivedRelationships![0]!,
        jointPolicy: "bogusPolicy",
      },
    ],
  } as unknown);
  expect(
    invalidJointPolicy.success,
    "Runtime schema should reject unknown offset joint policies.",
  ).toBeFalsy();

  const offsetDefinition = withOffsetDistance(1);
  const missingJointOutputs = validateSketchDefinition({
    ...offsetDefinition,
    derivedRelationships: [
      (({ jointOutputs: _jointOutputs, ...rest }) => rest)(
        offsetDefinition.derivedRelationships![0]! as {
          jointOutputs: unknown;
        } & Record<string, unknown>,
      ),
    ],
  } as unknown);
  expect(
    missingJointOutputs.success,
    "Runtime schema should reject offset derivations missing joint outputs.",
  ).toBeFalsy();
});
