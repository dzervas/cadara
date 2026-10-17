import { expect, test } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";
const literal = <T>(value: T) => ({ source: "literal", value });
const body = { kind: "body", bodyId: "body_part" };
const face = { kind: "face", bodyId: "body_part", faceId: "face_top" };
test("shell/thicken create and update retain exact canonical options and refuse unsupported participant shapes", () => {
  for (const operation of [
    "shell.create",
    "shell.update",
    "thicken.create",
    "thicken.update",
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
      ...(operation.endsWith("update") ? { featureId: "feature_shell" } : {}),
    };
    const parameters = operation.startsWith("shell")
      ? [
          {
            bodyTarget: body,
            faceTargets: [face],
            thickness: literal(1),
            operation: literal("newBody"),
            booleanScope: { kind: "standalone" },
          },
          ...["closedHollow", "offsetAllFaces"].map((mode) => ({
            mode,
            direction: "inside",
            bodyTarget: body,
            faceTargets: [],
            thickness: literal(1),
            operation: literal("newBody"),
            booleanScope: { kind: "standalone" },
          })),
        ]
      : [
          {
            participants: [{ role: "face", targets: [face] }],
            options: {
              thickness: literal(1),
              side: literal("oneSide"),
              direction: "positive",
            },
          },
          {
            participants: [
              { role: "face", targets: [body] },
              { role: "targetBody", targets: [body] },
            ],
            operationIntent: literal("add"),
            options: {
              thickness: literal(2),
              side: literal("symmetric"),
              direction: "negative",
            },
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
    if (operation.startsWith("thicken")) {
      for (const participants of [
        [{ role: "face", targets: [body, body] }],
        [{ role: "face", targets: [face, body] }],
        [
          { role: "face", targets: [face] },
          { role: "path", targets: [body] },
        ],
      ])
        expect(
          validateSemanticCommand({
            ...command,
            parameters: { ...parameters[0], participants },
          }).success,
        ).toBe(false);
      expect(
        validateSemanticCommand({
          ...command,
          parameters: {
            ...parameters[0],
            options: {
              thickness: literal(1),
              side: literal("unknown"),
              direction: "positive",
            },
          },
        }).success,
      ).toBe(false);
    } else {
      for (const patch of [
        { mode: "closedHollow", direction: "outside", faceTargets: [] },
        { mode: "offsetAllFaces", faceTargets: [face] },
      ])
        expect(
          validateSemanticCommand({
            ...command,
            parameters: { ...parameters[0], ...patch },
          }).success,
        ).toBe(false);
    }
  }
});
