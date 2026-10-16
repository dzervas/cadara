import { expect, test } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";

test("sweep create/update validate exact shared controls, roles and inactive twist fields", () => {
  const participants = [
    {
      role: "profile",
      targets: [
        {
          kind: "region",
          sketchId: "sketch_profile",
          regionId: "region_profile",
        },
      ],
    },
    {
      role: "path",
      targets: [{ kind: "edge", bodyId: "body_tool", edgeId: "edge_path" }],
    },
  ];
  for (const operation of ["sweep.create", "sweep.update"]) {
    const base = {
      version: 1,
      commandId: "sweep",
      basis: {
        documentId: "doc_part",
        revisionId: "rev_part",
        repositoryHeads: [],
      },
      intent: "fulfill",
      operation,
      ...(operation.endsWith("update") ? { featureId: "feature_sweep" } : {}),
    };
    for (const twist of [
      { type: "none" },
      { type: "angle", angle: Math.PI / 6 },
      { type: "turns", turns: 0.25 },
      { type: "pitch", pitch: 40 },
    ]) {
      const parameters = {
        participants,
        options: { profileControl: "none", twist, endScale: 1 },
      };
      expect(validateSemanticCommand({ ...base, parameters }).success).toBe(
        true,
      );
      for (const options of [
        { ...parameters.options, extra: true },
        { ...parameters.options, profileControl: "bogus" },
        { ...parameters.options, twist: { type: "none", angle: 1 } },
        { ...parameters.options, twist: { type: "pitch" } },
      ])
        expect(
          validateSemanticCommand({
            ...base,
            parameters: { ...parameters, options },
          }).success,
        ).toBe(false);
      expect(
        validateSemanticCommand({
          ...base,
          parameters: {
            ...parameters,
            participants: [...participants, { role: "unknown", targets: [] }],
          },
        }).success,
      ).toBe(false);
      expect(
        validateSemanticCommand({
          ...base,
          parameters: {
            ...parameters,
            participants: [
              { role: "profile", targets: participants[1]!.targets },
              participants[1],
            ],
          },
        }).success,
      ).toBe(false);
    }
  }
});
