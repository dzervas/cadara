import { test, expect } from "vitest";

import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import type { FeatureSnapshotRecord } from "@/contracts/modeling/schema";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import { getFeatureAuthoringDefinition } from "@/core/feature-authoring/registry";
import { toolDefinitions } from "@/core/tools/tool-registry";
import {
  buildFeatureDefinition,
  createFeatureEditSession,
  getFeatureEditorFormSchema,
  hydrateFeatureEditSession,
  patchFeatureEditSession,
} from "@/domain/editor/feature-editing";

// Lane: logic (per docs/testing.md).
// Seam: feature authoring definition normalization/registry for body pattern tools.

test("linear and circular pattern authoring definitions build copy-only advanced-solid definitions", () => {
  const bodyTarget = { kind: "body", bodyId: "body_seed" as BodyId } as const;
  const directionTarget = {
    kind: "edge",
    bodyId: "body_seed" as BodyId,
    edgeId: "edge_x",
  } as const;
  const axisTarget = {
    kind: "construction",
    constructionId: "construction_plane-xy",
  } as const;

  const linearDefinition = getFeatureAuthoringDefinition("linearPattern");
  expect(linearDefinition.metadata.groupId).toBe("patterns");
  expect(linearDefinition.advancedOptions?.map((option) => option.key)).toEqual([
    "instanceCount",
    "spacing",
    "oppositeDirection",
  ]);

  const linearSession = patchFeatureEditSession(
    createFeatureEditSession({
      featureType: "linearPattern",
      selectedTarget: bodyTarget,
    }),
    {
      directionTarget,
      instanceCount: 5,
      spacing: 12,
      oppositeDirection: "true",
    },
  );
  const builtLinear = buildFeatureDefinition(linearSession);

  expect(builtLinear?.kind).toBe("linearPattern");
  expect(
    builtLinear?.kind === "linearPattern" &&
      builtLinear.parameters.operationIntent,
    "Linear pattern must not author an operation intent because the executor rejects it.",
  ).toBeUndefined();
  expect(
    builtLinear?.kind === "linearPattern" &&
      getAuthoredLiteralValue(builtLinear.parameters.options?.instanceCount),
  ).toBe(5);
  expect(
    builtLinear?.kind === "linearPattern" &&
      getAuthoredLiteralValue(builtLinear.parameters.options?.spacing),
  ).toBe(12);
  expect(
    builtLinear?.kind === "linearPattern" &&
      getAuthoredLiteralValue(builtLinear.parameters.options?.oppositeDirection),
  ).toBe(true);
  expect(
    builtLinear?.kind === "linearPattern" &&
      builtLinear.parameters.options?.centered,
    "Centered must stay unexposed because centered=true is not executable.",
  ).toBeUndefined();

  const circularSession = patchFeatureEditSession(
    createFeatureEditSession({
      featureType: "circularPattern",
      selectedTarget: bodyTarget,
    }),
    {
      axisTarget,
      instanceCount: 6,
      angleDegrees: 180,
      equalSpace: "false",
      oppositeDirection: "true",
    },
  );
  const builtCircular = buildFeatureDefinition(circularSession);

  expect(builtCircular?.kind).toBe("circularPattern");
  expect(
    builtCircular?.kind === "circularPattern" &&
      builtCircular.parameters.operationIntent,
    "Circular pattern must not author an operation intent because the executor rejects it.",
  ).toBeUndefined();
  expect(
    builtCircular?.kind === "circularPattern" &&
      getAuthoredLiteralValue(builtCircular.parameters.options?.instanceCount),
  ).toBe(6);
  expect(
    builtCircular?.kind === "circularPattern" &&
      getAuthoredLiteralValue(builtCircular.parameters.options?.angleDegrees),
  ).toBe(180);
  expect(
    builtCircular?.kind === "circularPattern" &&
      getAuthoredLiteralValue(builtCircular.parameters.options?.equalSpace),
  ).toBe(false);
});

test("pattern authoring registry exposes form fields, selection filters, hydration, and dropdown variants", () => {
  const bodyTarget = { kind: "body", bodyId: "body_seed" as BodyId } as const;
  const directionTarget = {
    kind: "sketchEntity",
    sketchId: "sketch_axis",
    entityId: "entity_axis",
  } as const;

  const linearSession = patchFeatureEditSession(
    createFeatureEditSession({
      featureType: "linearPattern",
      selectedTarget: bodyTarget,
    }),
    { directionTarget, instanceCount: 4, spacing: 8 },
  );
  const linearSchema = getFeatureEditorFormSchema(linearSession);
  const linearFields = linearSchema.sections.flatMap((section) => section.fields);

  expect(linearSession.draft.bodyTargets).toEqual([bodyTarget]);
  expect(linearSession.draft.directionTarget).toEqual(directionTarget);
  expect(linearFields.map((field) => field.id)).toEqual([
    "linear-pattern-bodies",
    "linear-pattern-direction",
    "linear-pattern-instance-count",
    "linear-pattern-spacing",
    "linear-pattern-opposite-direction",
    "linear-pattern-diagnostics",
  ]);
  expect(
    linearFields.find((field) => field.id === "linear-pattern-direction")
      ?.advancedParticipant?.role,
  ).toBe("direction");

  const builtLinear = buildFeatureDefinition(linearSession);
  const hydratedLinear = hydrateFeatureEditSession({
    featureId: "feature_linear" as FeatureId,
    label: "Linear pattern",
    suppressed: false,
    producedTargets: [],
    definition: builtLinear!,
  } as FeatureSnapshotRecord);

  expect(hydratedLinear?.featureType).toBe("linearPattern");
  expect(
    hydratedLinear?.featureType === "linearPattern" &&
      hydratedLinear.draft.directionTarget,
  ).toEqual(directionTarget);

  const circularSchema = getFeatureEditorFormSchema(
    patchFeatureEditSession(
      createFeatureEditSession({
        featureType: "circularPattern",
        selectedTarget: bodyTarget,
      }),
      { axisTarget: directionTarget },
    ),
  );
  const circularFields = circularSchema.sections.flatMap((section) => section.fields);
  expect(circularFields.map((field) => field.id)).toEqual([
    "circular-pattern-bodies",
    "circular-pattern-axis",
    "circular-pattern-instance-count",
    "circular-pattern-angle-degrees",
    "circular-pattern-equal-space",
    "circular-pattern-opposite-direction",
    "circular-pattern-diagnostics",
  ]);
  expect(
    circularFields.find((field) => field.id === "circular-pattern-axis")
      ?.advancedParticipant?.role,
  ).toBe("axis");

  const ids = toolDefinitions.map((tool) => tool.id);
  expect(new Set(ids).size, "Tool IDs must remain unique.").toBe(ids.length);
  expect(toolDefinitions.find((tool) => tool.id === "linearPattern")?.group).toBe(
    "patterns",
  );
  expect(toolDefinitions.find((tool) => tool.id === "circularPattern")?.group).toBe(
    "patterns",
  );
  expect(toolDefinitions.find((tool) => tool.id === "pattern")?.dropdown).toEqual({
    familyId: "pattern-family",
    variantIds: ["linearPattern", "circularPattern", "curvePattern"],
  });
});
