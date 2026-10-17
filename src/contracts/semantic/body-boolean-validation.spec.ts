import { expect, test } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";

const targets = [{ kind: "body", bodyId: "body_a" }];
const participants = [
  { role: "targetBody", targets },
  { role: "toolBody", targets: [{ kind: "body", bodyId: "body_b" }] },
];
test("body boolean contracts are exact about roles, intent and literal retention", () => {
  for (const family of ["combine", "split", "deleteSolid"])
    for (const suffix of ["create", "update"]) {
      const base = {
        version: 1,
        commandId: "body",
        operation: `${family}.${suffix}`,
        basis: {
          documentId: "doc_a",
          revisionId: "rev_a",
          repositoryHeads: [],
        },
        intent: "fulfill",
        ...(suffix === "update" ? { featureId: "feature_a" } : {}),
      };
      const parameters =
        family === "deleteSolid"
          ? { participants: [{ role: "body", targets }] }
          : {
              participants,
              ...(family === "combine"
                ? { operationIntent: { source: "literal", value: "subtract" } }
                : {}),
            };
      expect(validateSemanticCommand({ ...base, parameters }).success).toBe(
        true,
      );
      for (const extra of [
        { options: { keepTools: { source: "literal", value: true } } },
        { options: { unknown: true } },
        { operationIntent: { source: "literal", value: "create" } },
        { participants: [{ role: "plane", targets }] },
        {
          participants: [
            {
              role: "body",
              targets: [
                {
                  kind: "construction",
                  constructionId: "construction_plane-xy",
                },
              ],
            },
          ],
        },
      ]) {
        expect(
          validateSemanticCommand({
            ...base,
            parameters: { ...parameters, ...extra },
          }).success,
          JSON.stringify({ family, extra }),
        ).toBe(false);
      }
      if (family !== "deleteSolid")
        for (const keepTools of [true, false])
          expect(
            validateSemanticCommand({
              ...base,
              parameters: { ...parameters, options: { keepTools } },
            }).success,
          ).toBe(true);
      else
        expect(
          validateSemanticCommand({
            ...base,
            parameters: { ...parameters, options: { keepTools: true } },
          }).success,
        ).toBe(false);
    }
});
