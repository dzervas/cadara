import { expect, test } from "vitest";

import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import { transformAuthoringDefinition } from "@/core/feature-authoring/features/transform";

const axis = {
  kind: "sketchEntity" as const,
  sketchId: "sketch_imported_transform_axis" as const,
  entityId: "sketch_entity_imported_transform_axis" as const,
};

test("imported authored transform options hydrate their visible reference mode", () => {
  const rotation = {
    kind: "transform",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        {
          role: "body",
          targets: [{ kind: "body", bodyId: "body_imported_transform" }],
        },
        { role: "axis", targets: [axis] },
      ],
      options: {
        transformType: { source: "literal", value: "rotation" },
        angle: { source: "literal", value: 90 },
      },
    },
  } satisfies AdvancedSolidFeatureDefinition & { kind: "transform" };

  const rotationDraft = transformAuthoringDefinition.hydrateDraft(rotation);
  expect(rotationDraft.transformType).toBe("rotation");
  expect(rotationDraft.axisTarget).toEqual(axis);

  const translation = {
    kind: "transform",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        {
          role: "body",
          targets: [{ kind: "body", bodyId: "body_imported_transform" }],
        },
      ],
      options: {
        direction: { source: "literal", value: "negative" },
        distance: { source: "literal", value: 2 },
      },
    },
  } satisfies AdvancedSolidFeatureDefinition & { kind: "transform" };

  expect(transformAuthoringDefinition.hydrateDraft(translation).direction).toBe(
    "negative",
  );
});
