import { expect, test } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";

for (const operation of ["extrude.create", "extrude.update"] as const) {
  test(`${operation} validates exactly one extrusion input form`, () => {
    const identity = {
      version: 1,
      commandId: "extrusion-validation",
      basis: {
        documentId: "doc_test",
        revisionId: "rev_test",
        repositoryHeads: [],
      },
      intent: "fulfill",
      operation,
    };
    const profile = {
      kind: "region",
      sketchId: "sketch_test",
      regionId: "region_test",
    };
    const target =
      operation === "extrude.update" ? { featureId: "feature_test" } : {};
    const parameters = {
      resultBodyType: "solid",
      profiles: [profile],
      startExtent: { kind: "profilePlane" },
      extent: {
        mode: "oneSide",
        end: { kind: "blind", direction: "positive", distance: literal(7) },
      },
      operation: literal("newBody"),
      booleanScope: { kind: "standalone" },
    };
    const shorthand = {
      ...identity,
      ...target,
      ...(operation === "extrude.create" ? { profile } : {}),
      depth: 7,
    };
    const canonical = { ...identity, ...target, parameters };
    expect(validateSemanticCommand(shorthand).success).toBe(true);
    expect(validateSemanticCommand(canonical).success).toBe(true);
    expect(validateSemanticCommand({ ...shorthand, parameters }).success).toBe(
      false,
    );
    expect(validateSemanticCommand({ ...identity, ...target }).success).toBe(
      false,
    );
    expect(
      validateSemanticCommand({
        ...canonical,
        parameters: {
          ...parameters,
          extent: {
            mode: "symmetric",
            end: {
              kind: "upToFace",
              direction: "positive",
              target: {
                kind: "face",
                bodyId: "body_test",
                faceId: "face_test",
              },
            },
          },
        },
      }).success,
    ).toBe(false);
  });
}
