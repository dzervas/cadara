import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import { FeatureExpressionEditorControl, FeatureInspector } from '@/components/layout/feature-inspector'
import { initialEditorState, type EditorViewState } from '@/contracts/editor/state-machine'
import { createExpressionAuthoredValue } from '@/contracts/modeling/authored-values'
import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import {
  createFeatureEditorFormValues,
  previewFeatureEditorFieldExpression,
  shouldResetFeatureEditorFormValues,
} from '@/domain/feature-authoring/form-adapter'
import {
  createFeatureEditSession,
  getFeatureEditorFormSchema,
  patchFeatureEditSession,
} from '@/domain/editor/feature-editing'
import type { ToolId } from '@/domain/tools/tool-registry'
import { EditorContext } from '@/hooks/editor-context'
import { workbenchTheme } from '@/theme/workbench-theme'

test('src/components/layout/feature-inspector.spec.tsx', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function renderInspector(input: {
    activeEditSession: NonNullable<EditorViewState['activeEditSession']>
    activeReferencePickerFieldId?: string | null
    snapshot?: DocumentSnapshot | null
  }) {
    const viewState: EditorViewState = {
      mode: 'part',
      activeCommand: {
        commandSessionId: 'command_shell-1',
        toolId: input.activeEditSession.featureType as ToolId,
        phase: 'editing',
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
    }

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
    )
  }

  const incompleteRevolveMarkup = renderInspector({
    activeEditSession: createFeatureEditSession({
      featureType: 'revolve',
      selectedTarget: null,
    }),
  })

  assert(
    incompleteRevolveMarkup.includes('Select at least one profile target.'),
    'Feature inspector should render field-level required-reference errors.',
  )
  assert(
    incompleteRevolveMarkup.includes('Select at least one profile target.'),
    'Feature inspector should render the validation message for missing required references.',
  )
  assert(
    incompleteRevolveMarkup.includes('Clear Profile targets'),
    'Feature inspector should render a clear control for single-reference fields.',
  )
  assert(
    incompleteRevolveMarkup.includes('Edit Angle (degrees) expression') &&
      incompleteRevolveMarkup.includes('Edit Operation expression'),
    'Feature inspector should render f(x) affordances for expression-capable numeric and enum fields.',
  )
  assert(
    !incompleteRevolveMarkup.includes('Edit Profile targets expression'),
    'Feature inspector should not render expression affordances for reference fields.',
  )

  const baseShellSession = createFeatureEditSession({
    featureType: 'shell',
    selectedTarget: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
  })
  const shellSession = patchFeatureEditSession(baseShellSession, {
    faceTargets: [
      { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
      { kind: 'face', bodyId: 'body_a', faceId: 'face_side' },
    ],
  })

  const activeShellMarkup = renderInspector({
    activeEditSession: shellSession,
    activeReferencePickerFieldId: 'shell-faces',
  })

  assert(
    activeShellMarkup.includes('aria-pressed="true"'),
    'Feature inspector should expose the active reference picker as pressed.',
  )
  assert(
    activeShellMarkup.includes('Face: body_a.face_top') && activeShellMarkup.includes('Face: body_a.face_side'),
    'Feature inspector should list every selected instance for multi-instance reference fields.',
  )
  assert(
    activeShellMarkup.includes('Required; 2 selected; expected 1+.'),
    'Feature inspector should render participant required status, cardinality, and selected count without feature-specific branching.',
  )
  assert(
    activeShellMarkup.includes('Clear Removable faces') && activeShellMarkup.includes('Remove body_a.face_side'),
    'Feature inspector should render clear-all and per-instance remove controls for multi-instance fields.',
  )

  const shellSchema = getFeatureEditorFormSchema(baseShellSession)
  const activeShellSchema = getFeatureEditorFormSchema(
    patchFeatureEditSession(baseShellSession, {
      faceTargets: [
        { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
        { kind: 'face', bodyId: 'body_a', faceId: 'face_side' },
      ],
    }),
  )
  const shellValues = createFeatureEditorFormValues(shellSchema)
  const activeShellValues = createFeatureEditorFormValues(activeShellSchema)

  assert(
    shouldResetFeatureEditorFormValues({
      schema: shellSchema,
      sessionKey: 'command_shell-1',
      lastSessionKey: 'command_shell-1',
      currentValues: { ...shellValues, 'shell-thickness': '1.0' },
      lastSyncedValues: { ...shellValues, 'shell-thickness': '0.5' },
      nextValues: shellValues,
    }) === false,
    'Feature inspector should preserve locally typed numeric values when the synced draft already matches semantically.',
  )
  assert(
    shouldResetFeatureEditorFormValues({
      schema: activeShellSchema,
      sessionKey: 'command_shell-1',
      lastSessionKey: 'command_shell-1',
      currentValues: shellValues,
      lastSyncedValues: shellValues,
      nextValues: activeShellValues,
    }),
    'Feature inspector should reset RHF values when the editor session changes externally, such as after reference picking.',
  )

  const expressionShellSession = patchFeatureEditSession(baseShellSession, {
    thickness: createExpressionAuthoredValue('wall + 1'),
    operation: createExpressionAuthoredValue('"join"'),
  })
  const expressionShellMarkup = renderInspector({
    activeEditSession: expressionShellSession,
    snapshot: {
      variables: [{ variableId: 'variable_wall', name: 'wall', valueText: '2' }],
    } as DocumentSnapshot,
  })

  assert(
    expressionShellMarkup.includes('aria-pressed="true"') &&
      expressionShellMarkup.includes('value="3"') &&
      expressionShellMarkup.includes('disabled=""'),
    'Feature inspector should reopen expression-authored fields as active disabled controls with calculated previews.',
  )

  const expressionShellSchema = getFeatureEditorFormSchema(expressionShellSession)
  const thicknessField = expressionShellSchema.sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === 'shell-thickness')
  assert(thicknessField?.kind === 'numeric', 'Expression editor tests need the shell thickness numeric field.')

  const validPreview = previewFeatureEditorFieldExpression({
    field: thicknessField,
    expressionText: 'wall + 1',
    variables: [{ variableId: 'variable_wall', name: 'wall', valueText: '2' }],
  })
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
  )
  assert(
    expressionEditorMarkup.includes('aria-label="Thickness expression"') &&
      expressionEditorMarkup.includes('Clear Thickness expression') &&
      expressionEditorMarkup.includes('>3</span>'),
    'Expression editor should render edit mode with live preview and a red clear action.',
  )

  const invalidPreview = previewFeatureEditorFieldExpression({
    field: thicknessField,
    expressionText: 'wall + * 2',
    variables: [{ variableId: 'variable_wall', name: 'wall', valueText: '2' }],
  })
  assert(!invalidPreview.ok, 'Expression preview test should use invalid expression text.')
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
  )
  assert(
    invalidEditorMarkup.includes('aria-invalid="true"') &&
      !invalidEditorMarkup.includes('pointer-events-none absolute right-2'),
    'Expression editor should render invalid preview feedback without replacing authored text.',
  )
})
