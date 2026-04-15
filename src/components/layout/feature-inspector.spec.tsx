import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FeatureInspector } from '@/components/layout/feature-inspector'
import { initialEditorState, type EditorViewState } from '@/contracts/editor/state-machine'
import {
  createFeatureEditorFormValues,
  shouldResetFeatureEditorFormValues,
} from '@/domain/feature-authoring/form-adapter'
import {
  createFeatureEditSession,
  getFeatureEditorFormSchema,
  patchFeatureEditSession,
} from '@/domain/editor/feature-editing'
import type { ToolId } from '@/domain/tools/tool-registry'
import { EditorContext } from '@/hooks/editor-context'

test('src/components/layout/feature-inspector.spec.tsx', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function renderInspector(input: {
    activeEditSession: NonNullable<EditorViewState['activeEditSession']>
    activeReferencePickerFieldId?: string | null
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
      snapshot: null,
      previewRenderables: null,
    }

    return renderToStaticMarkup(
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
      </EditorContext.Provider>,
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
    incompleteRevolveMarkup.includes('border-red-500') && incompleteRevolveMarkup.includes('text-red-300'),
    'Feature inspector should render red invalid field styling and red error text.',
  )
  assert(
    incompleteRevolveMarkup.includes('Clear Profile targets'),
    'Feature inspector should render a clear control for single-reference fields.',
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
    activeShellMarkup.includes('border-[var(--cad-accent)]') && activeShellMarkup.includes('aria-pressed="true"'),
    'Feature inspector should render primary active picker styling for the active reference field.',
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
})
