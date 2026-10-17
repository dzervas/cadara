import { expect, test } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";

const profiles = [
  { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
  { kind: "face", bodyId: "body_b", faceId: "face_b" },
];
const participants = [{ role: "profile", targets: profiles }];
const path = {
  role: "path",
  targets: [{ kind: "edge", bodyId: "body_b", edgeId: "edge_b" }],
};
test("loft commands accept canonical ordered sections and exclude inert native controls", () => {
  for (const operation of ["loft.create", "loft.update"]) {
    const command = {
      version: 1,
      commandId: "loft",
      operation,
      basis: { documentId: "doc_a", revisionId: "rev_a", repositoryHeads: [] },
      intent: "fulfill",
      ...(operation.endsWith("update") ? { featureId: "feature_a" } : {}),
    };
    for (const parameters of [
      { participants },
      {
        participants: [...participants, path],
        options: { path: { sectionCount: 3 } },
      },
      {
        participants: [...participants, path],
        options: {
          path: { sectionCount: { source: "expression", valueText: "3" } },
        },
      },
    ])
      expect(validateSemanticCommand({ ...command, parameters }).success).toBe(
        true,
      );
    for (const parameters of [
      { participants, options: { sectionCount: 3 } },
      { participants, options: { guideContinuity: "none" } },
      {
        participants,
        options: {
          profileConditions: { startCondition: "normal", endCondition: "none" },
        },
      },
      { participants, options: { matchConnections: [] } },
      {
        participants: [
          ...participants,
          { role: "guideCurve", targets: path.targets },
        ],
      },
      {
        participants: [
          ...participants,
          {
            ...path,
            targets: [
              {
                kind: "sketchEntity",
                sketchId: "sketch_a",
                entityId: "entity_a",
              },
            ],
          },
        ],
      },
      { participants, options: { path: { sectionCount: 2, extra: true } } },
    ])
      expect(
        validateSemanticCommand({ ...command, parameters }).success,
        JSON.stringify(parameters),
      ).toBe(false);
  }
});
