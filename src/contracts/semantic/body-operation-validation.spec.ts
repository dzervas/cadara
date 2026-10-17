import { expect, test } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";

const body = { kind: "body", bodyId: "body_seed" };
const plane = { kind: "construction", constructionId: "construction_plane-xy" };
const participants = [{ role: "body", targets: [body] }];
test("body operation contracts reject unsupported kinds, booleans and inactive options exactly", () => {
  const cases = [
    [
      "mirror",
      {
        participants: [...participants, { role: "plane", targets: [plane] }],
        options: { copy: true },
      },
    ],
    ["transform", { participants, options: { vector: [1, 2, 3] } }],
    [
      "transform",
      {
        participants: [
          ...participants,
          { role: "transformReference", targets: [plane] },
        ],
        options: {
          distance: { source: "expression", valueText: "4" },
          direction: "negative",
        },
      },
    ],
    [
      "transform",
      {
        participants: [...participants, { role: "axis", targets: [plane] }],
        options: {
          transformType: "rotation",
          angle: { source: "literal", value: 90 },
        },
      },
    ],
    [
      "linearPattern",
      {
        participants: [
          ...participants,
          { role: "direction", targets: [plane] },
        ],
        options: { instanceCount: 3, spacing: 10, oppositeDirection: false },
      },
    ],
    [
      "circularPattern",
      {
        participants: [...participants, { role: "axis", targets: [plane] }],
        options: {
          instanceCount: 3,
          angleDegrees: 360,
          equalSpace: true,
          oppositeDirection: false,
        },
      },
    ],
  ] as const;
  for (const [family, parameters] of cases)
    for (const action of ["create", "update"]) {
      const c = {
        version: 1,
        commandId: "body-op",
        operation: `${family}.${action}`,
        basis: {
          documentId: "doc_test",
          revisionId: "rev_test",
          repositoryHeads: [],
        },
        intent: "fulfill",
        ...(action === "update" ? { featureId: "feature_test" } : {}),
        parameters,
      };
      expect(validateSemanticCommand(c).success, JSON.stringify(c)).toBe(true);
      for (const extra of [
        { unknown: true },
        { options: { ...parameters.options, unknown: true } },
        {
          participants: [
            {
              role: "body",
              targets: [
                { kind: "face", bodyId: "body_seed", faceId: "face_seed" },
              ],
            },
          ],
        },
        {
          participants: [
            {
              role: "feature",
              targets: [{ kind: "feature", featureId: "feature_seed" }],
            },
          ],
        },
        ...(family !== "mirror"
          ? [{ operationIntent: { source: "literal", value: "add" } }]
          : []),
        ...(family === "linearPattern"
          ? [{ options: { ...parameters.options, centered: true } }]
          : []),
        ...(family === "transform"
          ? [
              {
                options: {
                  transformType: "rotation",
                  angle: { source: "expression", valueText: "90" },
                },
              },
              {
                options: { transformType: "rotation", angle: 90, distance: 2 },
              },
              { options: { vector: [1, 2, 3], distance: 2 } },
            ]
          : []),
      ])
        expect(
          validateSemanticCommand({
            ...c,
            parameters: { ...parameters, ...extra },
          }).success,
          JSON.stringify(extra),
        ).toBe(false);
    }
});
