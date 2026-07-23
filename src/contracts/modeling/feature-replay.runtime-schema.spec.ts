import { expect, test } from "vitest";

import { validateFeatureDefinition } from "@/contracts/modeling/runtime-schema";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import { FEATURE_REPLAY_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";

test("feature replay contracts require exact unique sources and finite linear inputs", () => {
  const definition = {
    kind: "featureReplay" as const,
    featureTypeVersion: FEATURE_REPLAY_FEATURE_SCHEMA_VERSION,
    parameters: {
      sourceFeatureIds: ["feature_seed" as const],
      transform: {
        kind: "linear" as const,
        direction: { kind: "construction" as const, constructionId: "construction_plane-yz" as const },
        instanceCount: createLiteralAuthoredValue(3),
        spacing: createLiteralAuthoredValue(40.2),
        oppositeDirection: createLiteralAuthoredValue(true),
      },
    },
  };

  expect(validateFeatureDefinition(definition).success).toBe(true);
  const duplicateSource = validateFeatureDefinition({
    ...definition,
    parameters: {
      ...definition.parameters,
      sourceFeatureIds: ["feature_seed", "feature_seed"],
    },
  });
  expect(duplicateSource.success).toBe(false);
  expect(duplicateSource.issues?.[0]?.path).toBe("parameters.sourceFeatureIds");

  const nonFiniteSpacing = validateFeatureDefinition({
    ...definition,
    parameters: {
      ...definition.parameters,
      transform: {
        ...definition.parameters.transform,
        spacing: createLiteralAuthoredValue(Number.POSITIVE_INFINITY),
      },
    },
  });
  expect(nonFiniteSpacing.success).toBe(false);
});
