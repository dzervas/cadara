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
    const face = { kind: "face", bodyId: "body_stop", faceId: "face_top" };
    const vertex = { kind: "vertex", bodyId: "body_stop", vertexId: "vertex_top" };
    const offset = { distance: { source: "literal", value: 1 }, direction: "extend" };
    for (const options of [
      { mainDiameter: 2, termination: "upToNext" },
      { mainDiameter: 2, termination: "upToNext", upToOffset: offset },
      { mainDiameter: 2, termination: "upToFace", upToTarget: face, upToOffset: offset },
      { mainDiameter: 2, termination: "upToPart", upToTarget: { kind: "body", bodyId: "body_stop" } },
      { mainDiameter: 2, termination: "upToVertex", upToTarget: vertex },
      { mainDiameter: 2, termination: "upToVertex", upToTarget: location },
      { style: "counterbore", mainDiameter: 2, counterboreDiameter: 4, counterboreDepth: 2, termination: "upToFace", upToTarget: face },
    ])
      expect(
        validateSemanticCommand({ ...command, parameters: { participants, options } }).success,
        `Extrude end condition ${options.termination} should be a valid hole termination.`,
      ).toBe(true);
    for (const options of [
      { mainDiameter: 2, termination: "upToFace" },
      { mainDiameter: 2, termination: "upToFace", upToTarget: vertex },
      { mainDiameter: 2, termination: "upToPart", upToTarget: face },
      { mainDiameter: 2, termination: "upToNext", upToTarget: face },
      { mainDiameter: 2, termination: "upToNext", depth: 3 },
      { mainDiameter: 2, termination: "blind", depth: 3, upToOffset: offset },
      { mainDiameter: 2, termination: "throughAll", upToTarget: face },
    ])
      expect(
        validateSemanticCommand({ ...command, parameters: { participants, options } }).success,
        `Hole options ${JSON.stringify(options)} must be refused.`,
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
