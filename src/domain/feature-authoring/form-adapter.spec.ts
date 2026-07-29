import { test, expect } from "vitest";

import {
  createFeatureEditorExpressionControlFormValue,
  createFeatureEditorFormValues,
  createFeatureEditorPatchFromExpression,
  createFeatureEditorPatchFromFormValue,
  featureEditorFormValuesEqual,
  featureEditorFormValuesMissingSchemaFields,
  getFeatureEditorExpressionSourceState,
  normalizeFeatureEditorFormValues,
} from "@/core/feature-authoring/form-adapter";
import { getFeatureEditorFormSchema } from "@/domain/editor/feature-editing";
import {
  createFeatureEditSession,
  patchFeatureEditSession,
} from "@/domain/editor/feature-editing";
import {
  createExpressionAuthoredValue,
  isExpressionAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";

test("src/domain/feature-authoring/form-adapter.spec.ts", async () => {
  const shellSession = createFeatureEditSession({
    featureType: "shell",
    selectedTarget: { kind: "face", bodyId: "body_a", faceId: "face_top" },
  });
  const shellSchema = getFeatureEditorFormSchema(shellSession);
  const shellThicknessField = shellSchema.sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === "shell-thickness");

  expect(
    shellThicknessField?.kind,
    "Shell form should expose a numeric thickness field for RHF adaptation.",
  ).toBe("numeric");

  const shellFormValues = createFeatureEditorFormValues(shellSchema);
  const shellThicknessSource = getFeatureEditorExpressionSourceState(
    shellThicknessField,
    shellFormValues["shell-thickness"],
  );
  expect(
    shellThicknessSource?.source === "literal" &&
      shellThicknessSource.value.length > 0,
    "Adapter form values should keep numeric literal source state in RHF values.",
  ).toBeTruthy();

  const numericPatch = createFeatureEditorPatchFromFormValue(
    shellThicknessField,
    "1.25",
  );
  expect(
    numericPatch?.thickness,
    "Adapter numeric values should translate valid RHF strings back into the existing feature patch shape.",
  ).toBe(1.25);
  const expressionPatch = createFeatureEditorPatchFromExpression(
    shellThicknessField,
    "wall + 1",
  );
  expect(
    isExpressionAuthoredValue(expressionPatch?.thickness) &&
      expressionPatch.thickness.valueText === "wall + 1",
    "Adapter numeric values should preserve non-literal text as authored expression patches.",
  ).toBeTruthy();
  const numericLookingExpressionPatch = createFeatureEditorPatchFromFormValue(
    shellThicknessField,
    createFeatureEditorExpressionControlFormValue("10", "10"),
  );
  expect(
    isExpressionAuthoredValue(numericLookingExpressionPatch?.thickness) &&
      numericLookingExpressionPatch.thickness.valueText === "10",
    "Adapter source state should preserve numeric-looking expression text as an authored expression.",
  ).toBeTruthy();

  const shellOperationField = shellSchema.sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === "shell-operation");
  expect(
    shellOperationField?.kind,
    "Shell form should expose an enum operation field for RHF adaptation.",
  ).toBe("enum");

  const enumLiteralPatch = createFeatureEditorPatchFromFormValue(
    shellOperationField,
    "join",
  );
  expect(
    enumLiteralPatch?.operation,
    "Adapter enum literal values should patch as literal enum strings.",
  ).toBe("join");

  const enumExpressionPatch = createFeatureEditorPatchFromFormValue(
    shellOperationField,
    createFeatureEditorExpressionControlFormValue("join", '"join"'),
  );
  expect(
    isExpressionAuthoredValue(enumExpressionPatch?.operation) &&
      enumExpressionPatch.operation.valueText === '"join"',
    "Adapter source state should preserve enum expression text even when it resolves to an existing option.",
  ).toBeTruthy();

  const expressionShellSchema = getFeatureEditorFormSchema(
    patchFeatureEditSession(shellSession, {
      thickness: createExpressionAuthoredValue("10"),
      operation: createExpressionAuthoredValue('"join"'),
    }),
  );
  const expressionThicknessField = expressionShellSchema.sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === "shell-thickness");
  expect(
    expressionThicknessField?.kind,
    "Expression shell form should expose thickness.",
  ).toBe("numeric");
  const expressionShellValues = createFeatureEditorFormValues(
    expressionShellSchema,
  );
  const expressionThicknessSource = getFeatureEditorExpressionSourceState(
    expressionThicknessField,
    expressionShellValues["shell-thickness"],
  );
  expect(
    expressionThicknessSource?.source === "expression" &&
      expressionThicknessSource.expressionText === "10",
    "Adapter form values should distinguish expression-authored numeric values from literal values.",
  ).toBeTruthy();

  const revolveSession = createFeatureEditSession({
    featureType: "revolve",
    selectedTarget: null,
  });
  const revolveAngleField = getFeatureEditorFormSchema(revolveSession)
    .sections.flatMap((section) => section.fields)
    .find((field) => field.id === "revolve-angle");

  expect(
    revolveAngleField?.kind,
    "Revolve form should expose an angle numeric field for adapter coercion.",
  ).toBe("numeric");

  const patchedRevolve = patchFeatureEditSession(
    revolveSession,
    createFeatureEditorPatchFromFormValue(revolveAngleField, "180") ?? {},
  );
  expect(
    patchedRevolve.featureType === "revolve" &&
      patchedRevolve.draft.firstEnd.kind === "blind" &&
      Math.abs(patchedRevolve.draft.firstEnd.angle - Math.PI) < 0.000001,
    "Adapter angle values should preserve the degree-to-radian patch translation owned by the feature domain.",
  ).toBeTruthy();

  const surfaceRevolveSession = patchFeatureEditSession(revolveSession, {
    resultBodyType: "surface",
  });
  const surfaceRevolveValues = createFeatureEditorFormValues(
    getFeatureEditorFormSchema(surfaceRevolveSession),
  );
  const solidRevolveSchema = getFeatureEditorFormSchema(
    patchFeatureEditSession(surfaceRevolveSession, {
      resultBodyType: "solid",
    }),
  );

  expect(
    featureEditorFormValuesMissingSchemaFields(
      solidRevolveSchema,
      surfaceRevolveValues,
    ),
    "Adapter should report missing form values when a variant toggle re-adds fields such as the revolve boolean operation.",
  ).toBeTruthy();
  expect(
    featureEditorFormValuesMissingSchemaFields(
      solidRevolveSchema,
      createFeatureEditorFormValues(solidRevolveSchema),
    ),
    "Adapter should report no missing form values when every schema field already has a form value.",
  ).toBeFalsy();

  const populatedShellSession = patchFeatureEditSession(shellSession, {
    faceTargets: [
      { kind: "face", bodyId: "body_a", faceId: "face_top" },
      { kind: "face", bodyId: "body_a", faceId: "face_side" },
    ],
  });
  const populatedShellSchema = getFeatureEditorFormSchema(
    populatedShellSession,
  );
  const populatedShellValues =
    createFeatureEditorFormValues(populatedShellSchema);
  const normalizedShellValues = normalizeFeatureEditorFormValues(
    populatedShellSchema,
    {
      ...populatedShellValues,
      "shell-faces": [
        { kind: "face", bodyId: "body_a", faceId: "face_top" },
        { kind: "face", bodyId: "body_a", faceId: "face_side" },
      ],
    },
  );

  expect(
    featureEditorFormValuesEqual(
      populatedShellSchema,
      populatedShellValues,
      normalizedShellValues,
    ),
    "Adapter form values should normalize reference selections by durable identity rather than object identity.",
  ).toBeTruthy();

  const shellFacesField = populatedShellSchema.sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === "shell-faces");
  expect(
    shellFacesField?.kind === "referenceCollection" &&
      !("authoredValue" in shellFacesField),
    "Reference collection fields should not expose expression source metadata.",
  ).toBeTruthy();

  const conditionalSchema = {
    sections: [
      {
        id: "advanced",
        title: "Advanced",
        fields: [
          {
            kind: "optionGroup",
            id: "loft-path-options",
            label: "Path options",
            fields: [
              {
                kind: "numeric",
                id: "loft-section-count",
                label: "Section count",
                value: 4,
                input: "number",
                authoredValue: {
                  expressionCapable: true,
                  valueKind: { kind: "positiveInteger" },
                },
                patch: {
                  patchKey: "options",
                  valuePath: ["path", "sectionCount"],
                },
              },
            ],
          },
          {
            kind: "discriminatedOptionGroup",
            id: "extent-options",
            label: "Extent",
            discriminant: {
              kind: "enum",
              id: "extent-mode",
              label: "Extent mode",
              value: "distance",
              options: [
                { value: "distance", label: "Distance" },
                { value: "throughAll", label: "Through all" },
              ],
              patch: { patchKey: "options", valuePath: ["extentMode"] },
            },
            variants: [
              {
                value: "distance",
                label: "Distance",
                fields: [
                  {
                    kind: "numeric",
                    id: "extent-distance",
                    label: "Distance",
                    value: 12,
                    input: "number",
                    patch: { patchKey: "options", valuePath: ["distance"] },
                  },
                ],
              },
              {
                value: "throughAll",
                label: "Through all",
                fields: [
                  {
                    kind: "numeric",
                    id: "through-all-offset",
                    label: "Offset",
                    value: 0,
                    input: "number",
                    hidden: true,
                    patch: { patchKey: "options", valuePath: ["offset"] },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } satisfies FeatureEditorFormSchema;
  const conditionalValues = createFeatureEditorFormValues(conditionalSchema);
  expect(
    "loft-section-count" in conditionalValues &&
      "extent-mode" in conditionalValues &&
      "extent-distance" in conditionalValues &&
      !("through-all-offset" in conditionalValues),
    "Adapter form values should recurse into groups and active discriminated variants only.",
  ).toBeTruthy();

  const sectionCountField = conditionalSchema.sections[0]!.fields[0]!;
  expect(
    sectionCountField.kind,
    "Conditional schema should contain a grouped option field.",
  ).toBe("optionGroup");
  const nestedPatch = createFeatureEditorPatchFromFormValue(
    sectionCountField.fields[0]!,
    "6",
  );
  expect(
    nestedPatch?.options &&
      typeof nestedPatch.options === "object" &&
      (
        (nestedPatch.options as Record<string, unknown>).path as Record<
          string,
          unknown
        >
      ).sectionCount === 6,
    "Adapter nested option fields should emit nested option patches without feature-specific branching.",
  ).toBeTruthy();

  const discriminatedField = conditionalSchema.sections[0]!.fields[1]!;
  expect(
    discriminatedField.kind,
    "Conditional schema should contain a discriminated option field.",
  ).toBe("discriminatedOptionGroup");
  const discriminantPatch = createFeatureEditorPatchFromFormValue(
    discriminatedField.discriminant,
    "throughAll",
  );
  expect(
    discriminantPatch?.options &&
      typeof discriminantPatch.options === "object" &&
      (discriminantPatch.options as Record<string, unknown>).extentMode ===
        "throughAll",
    "Adapter discriminant fields should patch through their declared nested option target.",
  ).toBeTruthy();
});
