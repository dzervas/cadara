import { expect, test } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";

const edge = { kind: "edge", bodyId: "body_part", edgeId: "edge_side" };
test("edge treatments accept canonical inputs and refuse inactive fields, unknown roles and non-edges", () => {
  for (const operation of [
    "fillet.create",
    "fillet.update",
    "chamfer.create",
    "chamfer.update",
  ]) {
    const command = {
      version: 1,
      commandId: operation,
      operation,
      basis: {
        documentId: "doc_part",
        revisionId: "rev_1",
        repositoryHeads: [],
      },
      intent: "fulfill",
      ...(operation.endsWith("update") ? { featureId: "feature_edge" } : {}),
    };
    const parameters = operation.startsWith("fillet")
      ? [{ edgeTargets: [edge], radius: { source: "literal", value: 1 } }]
      : [
          {
            participants: [{ role: "edge", targets: [edge] }],
            options: { widthForm: "equalOffsets", distance: 1 },
          },
          {
            participants: [{ role: "edge", targets: [edge] }],
            options: { widthForm: "twoOffsets", distance1: 1, distance2: 2 },
          },
          {
            participants: [{ role: "edge", targets: [edge] }],
            options: { widthForm: "offsetAngle", distance: 1, angle: 30 },
          },
        ];
    for (const value of parameters) {
      const checked = validateSemanticCommand({
        ...command,
        parameters: value,
      });
      expect(checked.success, JSON.stringify(checked)).toBe(true);
      expect(
        validateSemanticCommand({
          ...command,
          parameters: { ...value, unexpected: true },
        }).success,
      ).toBe(false);
    }
    if (operation.startsWith("chamfer"))
      for (const options of [
        { widthForm: "twoOffsets", distance1: 1 },
        { widthForm: "twoOffsets", distance1: 1, distance2: 2, distance: 3 },
        { widthForm: "offsetAngle", distance: 1 },
        { widthForm: "equalOffsets", distance: 1, angle: 45 },
        { widthForm: "unknown", distance: 1 },
      ])
        expect(
          validateSemanticCommand({
            ...command,
            parameters: {
              participants: [{ role: "edge", targets: [edge] }],
              options,
            },
          }).success,
        ).toBe(false);
    if (operation.startsWith("chamfer")) {
      for (const participants of [
        [{ role: "face", targets: [edge] }],
        [{ role: "edge", targets: [{ kind: "body", bodyId: "body_part" }] }],
        [
          { role: "edge", targets: [edge] },
          { role: "path", targets: [edge] },
        ],
      ])
        expect(
          validateSemanticCommand({
            ...command,
            parameters: { participants, options: { distance: 1 } },
          }).success,
        ).toBe(false);
    }
  }
});
