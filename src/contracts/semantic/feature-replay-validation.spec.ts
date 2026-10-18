import { expect, test } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";

const plane = { kind: "construction", constructionId: "construction_plane-yz" };
test("replay commands use the exact canonical source and disjoint transform contracts", () => {
  for (const action of ["create", "update"])
    for (const transform of [
      { kind: "mirror", plane },
      {
        kind: "linear",
        direction: plane,
        instanceCount: literal(3),
        spacing: { source: "expression", valueText: "7" },
        oppositeDirection: literal(false),
      },
    ]) {
      const command = {
        version: 1,
        commandId: "replay",
        operation: `featureReplay.${action}`,
        basis: {
          documentId: "doc_test",
          revisionId: "rev_test",
          repositoryHeads: [],
        },
        intent: "fulfill",
        ...(action === "update" ? { featureId: "feature_replay" } : {}),
        parameters: { sourceFeatureIds: ["feature_source"], transform },
      };
      expect(validateSemanticCommand(command).success).toBe(true);
      expect(validateSemanticCommand({ ...command, parameters: {
        ...command.parameters, sourceFeatureIds: [{ kind: "feature", featureId: "feature_source" }],
      } }).success).toBe(true);
      for (const parameters of [
        { ...command.parameters, unknown: true },
        {
          ...command.parameters,
          sourceFeatureIds: [{ kind: "body", bodyId: "body_wrong_kind" }],
        },
        { ...command.parameters, transform: { ...transform, unknown: true } },
        {
          ...command.parameters,
          transform: { kind: "mirror", plane, spacing: literal(7) },
        },
        {
          ...command.parameters,
          transform: {
            kind: "linear",
            direction: {
              kind: "edge",
              bodyId: "body_test",
              edgeId: "edge_test",
            },
            instanceCount: literal(2),
            spacing: literal(7),
            oppositeDirection: literal(false),
          },
        },
        { ...command.parameters, operationIntent: literal("add") },
      ])
        expect(
          validateSemanticCommand({ ...command, parameters }).success,
          JSON.stringify(parameters),
        ).toBe(false);
    }
});
