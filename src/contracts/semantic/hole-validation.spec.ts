import { expect, test } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";
const location = {
  kind: "sketchPoint",
  sketchId: "sketch_locations",
  pointId: "sketch_point_center",
};
const body = { kind: "body", bodyId: "body_part" };
const participants = [
  { role: "location", targets: [location] },
  { role: "body", targets: [body] },
];
test("hole create/update use exact canonical style and termination options without ignored inputs", () => {
  for (const operation of ["hole.create", "hole.update"]) {
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
      ...(operation.endsWith("update") ? { featureId: "feature_hole" } : {}),
    };
    for (const style of ["simple", "counterbore", "countersink"])
      for (const termination of ["blind", "throughAll"])
        for (const direction of ["forward", "reverse"]) {
          const options = {
            style,
            termination,
            direction,
            mainDiameter: 2,
            ...(termination === "blind" ? { depth: 6 } : {}),
            ...(style === "counterbore"
              ? { counterboreDiameter: 4, counterboreDepth: 2 }
              : style === "countersink"
                ? { countersinkDiameter: 6, countersinkAngleDegrees: 90 }
                : {}),
          };
          const checked = validateSemanticCommand({
            ...command,
            parameters: { participants, options },
          });
          expect(checked.success, JSON.stringify(checked)).toBe(true);
          expect(
            validateSemanticCommand({
              ...command,
              parameters: {
                participants,
                options: { ...options, unknown: true },
              },
            }).success,
          ).toBe(false);
        }
    for (const options of [
      { mainDiameter: 2, termination: "blind" },
      { mainDiameter: 2, termination: "throughAll", depth: 5 },
      {
        style: "counterbore",
        mainDiameter: 2,
        termination: "blind",
        depth: 6,
        counterboreDiameter: 4,
      },
      {
        style: "countersink",
        mainDiameter: 2,
        termination: "throughAll",
        countersinkDiameter: 6,
      },
      {
        style: "simple",
        mainDiameter: 2,
        termination: "throughAll",
        counterboreDiameter: 4,
      },
      { mainDiameter: 2, termination: "throughAll", direction: "sideways" },
    ])
      expect(
        validateSemanticCommand({
          ...command,
          parameters: { participants, options },
        }).success,
      ).toBe(false);
    for (const bad of [
      [{ role: "location", targets: [body] }, participants[1]],
      [participants[0], { role: "targetBody", targets: [body] }],
      [...participants, { role: "path", targets: [body] }],
    ])
      expect(
        validateSemanticCommand({
          ...command,
          parameters: {
            participants: bad,
            options: { mainDiameter: 2, termination: "throughAll" },
          },
        }).success,
      ).toBe(false);
    expect(
      validateSemanticCommand({
        ...command,
        parameters: {
          participants,
          options: { mainDiameter: 2, termination: "throughAll" },
          operationIntent: "create",
        },
      }).success,
    ).toBe(false);
  }
});
