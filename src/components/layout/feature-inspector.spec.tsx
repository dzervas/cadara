import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FeatureExpressionEditorControl,
  FeatureInspector,
} from "@/components/layout/feature-inspector";
import {
  initialEditorState,
  type EditorViewState,
} from "@/domain/editor/state-machine";
import { createExpressionAuthoredValue } from "@/contracts/modeling/authored-values";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import {
  createFeatureEditorFormValues,
  previewFeatureEditorFieldExpression,
  shouldResetFeatureEditorFormValues,
} from "@/core/feature-authoring/form-adapter";
import {
  createFeatureEditSession,
  getFeatureEditorFormSchema,
  patchFeatureEditSession,
} from "@/domain/editor/feature-editing";
import type { ToolId } from "@/core/tools/tool-registry";
import { EditorContext } from "@/hooks/editor-context";
import { workbenchTheme } from "@/theme/workbench-theme";

test("src/components/layout/feature-inspector.spec.tsx", async () => {
  function renderInspector(input: {
    activeEditSession: NonNullable<EditorViewState["activeEditSession"]>;
    activeReferencePickerFieldId?: string | null;
    snapshot?: WorkspaceSnapshot | null;
  }) {
    const viewState: EditorViewState = {
      mode: "part",
      activeCommand: {
        commandSessionId: "command_shell-1",
        toolId: input.activeEditSession.featureType as ToolId,
        phase: "editing",
      },
      selection: [],
      selectionCatalog: null,
      selectionFilter: null,
      hoverTarget: null,
      preview: null,
      activeEditSession: input.activeEditSession,
      activeReferencePickerFieldId: input.activeReferencePickerFieldId ?? null,
      sketchSession: null,
      snapshot: input.snapshot ?? null,
      previewRenderables: null,
    };

    return renderToStaticMarkup(
      <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
        <EditorContext.Provider
          value={{
            machineState: initialEditorState,
            state: viewState,
            dispatch: () => undefined,
          }}
        >
          <FeatureInspector
            featureSnapshot={null}
            onPatch={() => undefined}
            onCommit={() => undefined}
            onCancel={() => undefined}
          />
        </EditorContext.Provider>
      </MantineProvider>,
    );
  }

  const incompleteRevolveMarkup = renderInspector({
    activeEditSession: createFeatureEditSession({
      featureType: "revolve",
      selectedTarget: null,
    }),
  });

  expect(
    incompleteRevolveMarkup.includes("Select at least one profile target."),
    "Feature inspector should render field-level required-reference errors.",
  ).toBeTruthy();
  expect(
    incompleteRevolveMarkup.includes("Select at least one profile target."),
    "Feature inspector should render the validation message for missing required references.",
  ).toBeTruthy();
  expect(
    incompleteRevolveMarkup.includes("Clear Profile targets"),
    "Feature inspector should render a clear control for single-reference fields.",
  ).toBeTruthy();
  expect(
    incompleteRevolveMarkup.includes("Edit Angle (degrees) expression") &&
      incompleteRevolveMarkup.includes("Edit Operation expression"),
    "Feature inspector should render f(x) affordances for expression-capable numeric and enum fields.",
  ).toBeTruthy();
  expect(
    incompleteRevolveMarkup.includes('role="combobox"') &&
      !incompleteRevolveMarkup.includes("grid grid-cols-4 gap-2"),
    "Feature inspector enum fields should render as dropdown selections instead of fixed option button grids.",
  ).toBeTruthy();
  expect(
    incompleteRevolveMarkup.includes("w-[320px]") &&
      incompleteRevolveMarkup.includes("min-w-0") &&
      incompleteRevolveMarkup.includes("max-w-full") &&
      !incompleteRevolveMarkup.includes("min-w-[320px]"),
    "Feature inspector should fit inside narrow viewport overlays instead of enforcing a hard minimum width.",
  ).toBeTruthy();
  expect(
    incompleteRevolveMarkup.includes("Edit Profile targets expression"),
    "Feature inspector should not render expression affordances for reference fields.",
  ).toBeFalsy();

  const baseShellSession = createFeatureEditSession({
    featureType: "shell",
    selectedTarget: { kind: "face", bodyId: "body_a", faceId: "face_top" },
  });
  const shellSession = patchFeatureEditSession(baseShellSession, {
    faceTargets: [
      { kind: "face", bodyId: "body_a", faceId: "face_top" },
      { kind: "face", bodyId: "body_a", faceId: "face_side" },
    ],
  });

  const activeShellMarkup = renderInspector({
    activeEditSession: shellSession,
    activeReferencePickerFieldId: "shell-faces",
  });

  expect(
    activeShellMarkup.includes('aria-pressed="true"'),
    "Feature inspector should expose the active reference picker as pressed.",
  ).toBeTruthy();
  expect(
    activeShellMarkup.includes("Face: body_a.face_top") &&
      activeShellMarkup.includes("Face: body_a.face_side"),
    "Feature inspector should list every selected instance for multi-instance reference fields.",
  ).toBeTruthy();
  expect(
    activeShellMarkup.includes("Required; 2 selected; expected 1+."),
    "Feature inspector should render participant required status, cardinality, and selected count without feature-specific branching.",
  ).toBeTruthy();
  expect(
    activeShellMarkup.includes("Clear Removable faces") &&
      activeShellMarkup.includes("Remove body_a.face_side"),
    "Feature inspector should render clear-all and per-instance remove controls for multi-instance fields.",
  ).toBeTruthy();
  expect(
    activeShellMarkup.includes("Flip Thickness direction"),
    "Feature inspector should render numeric direction flip buttons for fields that support directional magnitudes.",
  ).toBeTruthy();

  const linearPatternMarkup = renderInspector({
    activeEditSession: patchFeatureEditSession(
      createFeatureEditSession({
        featureType: "linearPattern",
        selectedTarget: { kind: "body", bodyId: "body_pattern" },
      }),
      {
        directionTarget: {
          kind: "edge",
          bodyId: "body_pattern",
          edgeId: "edge_direction",
        },
      },
    ),
  });

  expect(
    linearPatternMarkup.includes("Seed bodies") &&
      linearPatternMarkup.includes("Linear direction") &&
      linearPatternMarkup.includes("Instance count") &&
      linearPatternMarkup.includes("Spacing") &&
      linearPatternMarkup.includes("Opposite direction"),
    "Feature inspector should render pattern participant and option fields from the authoring schema.",
  ).toBeTruthy();
  expect(
    linearPatternMarkup.includes("Required; 1 selected; expected 1+.") &&
      linearPatternMarkup.includes("Required; 1 selected; expected 1-1."),
    "Feature inspector should render advanced participant metadata for pattern bodies and direction references.",
  ).toBeTruthy();
  expect(
    linearPatternMarkup.includes("Centered"),
    "Linear pattern should not expose centered because the executor rejects centered=true.",
  ).toBeFalsy();

  const shellSchema = getFeatureEditorFormSchema(baseShellSession);
  const activeShellSchema = getFeatureEditorFormSchema(
    patchFeatureEditSession(baseShellSession, {
      faceTargets: [
        { kind: "face", bodyId: "body_a", faceId: "face_top" },
        { kind: "face", bodyId: "body_a", faceId: "face_side" },
      ],
    }),
  );
  const shellValues = createFeatureEditorFormValues(shellSchema);
  const activeShellValues = createFeatureEditorFormValues(activeShellSchema);

  expect(
    shouldResetFeatureEditorFormValues({
      schema: shellSchema,
      sessionKey: "command_shell-1",
      lastSessionKey: "command_shell-1",
      currentValues: { ...shellValues, "shell-thickness": "1.0" },
      lastSyncedValues: { ...shellValues, "shell-thickness": "0.5" },
      nextValues: shellValues,
    }),
    "Feature inspector should preserve locally typed numeric values when the synced draft already matches semantically.",
  ).toBeFalsy();
  expect(
    shouldResetFeatureEditorFormValues({
      schema: activeShellSchema,
      sessionKey: "command_shell-1",
      lastSessionKey: "command_shell-1",
      currentValues: shellValues,
      lastSyncedValues: shellValues,
      nextValues: activeShellValues,
    }),
    "Feature inspector should reset RHF values when the editor session changes externally, such as after reference picking.",
  ).toBeTruthy();

  const expressionShellSession = patchFeatureEditSession(baseShellSession, {
    thickness: createExpressionAuthoredValue("wall + 1"),
    operation: createExpressionAuthoredValue('"join"'),
  });
  const expressionShellMarkup = renderInspector({
    activeEditSession: expressionShellSession,
    snapshot: {
      document: {
        variables: [
          { variableId: "variable_wall", name: "wall", valueText: "2" },
        ],
      },
    } as WorkspaceSnapshot,
  });

  expect(
    expressionShellMarkup.includes('aria-pressed="true"') &&
      expressionShellMarkup.includes('value="3"') &&
      expressionShellMarkup.includes('disabled=""'),
    "Feature inspector should reopen expression-authored fields as active disabled controls with calculated previews.",
  ).toBeTruthy();

  const expressionShellSchema = getFeatureEditorFormSchema(
    expressionShellSession,
  );
  const thicknessField = expressionShellSchema.sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === "shell-thickness");
  expect(
    thicknessField?.kind,
    "Expression editor tests need the shell thickness numeric field.",
  ).toBe("numeric");

  const validPreview = previewFeatureEditorFieldExpression({
    field: thicknessField,
    expressionText: "wall + 1",
    variables: [{ variableId: "variable_wall", name: "wall", valueText: "2" }],
  });
  const expressionEditorMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <FeatureExpressionEditorControl
        id="shell-thickness-expression"
        fieldLabel="Thickness"
        expressionText="wall + 1"
        preview={validPreview}
        hasError={!validPreview.ok}
        onAccept={() => undefined}
        onChangeText={() => undefined}
        onClear={() => undefined}
      />
    </MantineProvider>,
  );
  expect(
    expressionEditorMarkup.includes('aria-label="Thickness expression"') &&
      expressionEditorMarkup.includes("Clear Thickness expression") &&
      expressionEditorMarkup.includes(">3</span>"),
    "Expression editor should render edit mode with live preview and a red clear action.",
  ).toBeTruthy();

  const invalidPreview = previewFeatureEditorFieldExpression({
    field: thicknessField,
    expressionText: "wall + * 2",
    variables: [{ variableId: "variable_wall", name: "wall", valueText: "2" }],
  });
  expect(
    invalidPreview.ok,
    "Expression preview test should use invalid expression text.",
  ).toBeFalsy();
  const invalidEditorMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <FeatureExpressionEditorControl
        id="shell-thickness-expression"
        fieldLabel="Thickness"
        expressionText="wall + * 2"
        preview={invalidPreview}
        hasError={!invalidPreview.ok}
        onAccept={() => undefined}
        onChangeText={() => undefined}
        onClear={() => undefined}
      />
    </MantineProvider>,
  );
  expect(
    invalidEditorMarkup.includes('aria-invalid="true"') &&
      !invalidEditorMarkup.includes("pointer-events-none absolute right-2"),
    "Expression editor should render invalid preview feedback without replacing authored text.",
  ).toBeTruthy();
});
