import { expect, test } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";

const parameters = {
  resultBodyType: "solid",
  profiles: [
    { kind: "region", sketchId: "sketch_profile", regionId: "region_profile" },
  ],
  axis: {
    kind: "sketchEntity",
    sketchId: "sketch_profile",
    entityId: "sketch_entity_axis",
  },
  startAngle: { source: "literal", value: 0 },
  extent: { mode: "oneSide", end: { kind: "full" } },
  operation: { source: "literal", value: "newBody" },
  booleanScope: { kind: "standalone" },
};
test("revolve create/update validate canonical extents and reject unsupported input shapes without coercion", () => {
  for (const operation of ["revolve.create", "revolve.update"]) {
    const command = {
      version: 1,
      commandId: operation,
      operation,
      basis: {
        documentId: "doc_part",
        revisionId: "rev_1",
        repositoryHeads: [],
      },
      parameters,
      intent: "fulfill",
      ...(operation.endsWith("update") ? { featureId: "feature_revolve" } : {}),
    };
    expect(validateSemanticCommand(command).success).toBe(true);
    for (const patch of [
      { extent: { mode: "symmetric", end: { kind: "full" } } },
      {
        extent: {
          mode: "twoSide",
          firstEnd: { kind: "full" },
          secondEnd: { kind: "full" },
        },
      },
      {
        axis: {
          kind: "sketchPoint",
          sketchId: "sketch_profile",
          pointId: "sketch_point_axis",
        },
      },
      { profiles: [] },
      {
        profiles: [
          {
            kind: "sketchEntity",
            sketchId: "sketch_profile",
            entityId: "sketch_entity_curve",
          },
        ],
      },
    ])
      expect(
        validateSemanticCommand({
          ...command,
          parameters: { ...parameters, ...patch },
        }).success,
      ).toBe(false);
    expect(validateSemanticCommand({ ...command, depth: 7 }).success).toBe(
      false,
    );
    expect(
      validateSemanticCommand({
        ...command,
        parameters: { ...parameters, resultBodyType: "surface" },
      }).success,
    ).toBe(false);
    const sheet = {
      profiles: parameters.profiles,
      axis: parameters.axis,
      startAngle: parameters.startAngle,
      extent: parameters.extent,
    };
    expect(
      validateSemanticCommand({
        ...command,
        parameters: { ...sheet, resultBodyType: "surface" },
      }).success,
    ).toBe(true);
  }
});
