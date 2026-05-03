import { useForm } from 'react-hook-form'

import { SECTION_HEADER_CLASSES } from '@/components/ui/workbench-panel-styles'
import { WorkbenchInspectorPanel } from '@/components/layout/workbench-inspector-panel'
import { getVisualFormSections } from '@/components/layout/feature-inspector-sections'
import {
  FeatureFormFieldRenderer,
} from '@/components/layout/feature-inspector'
import {
  createFeatureEditorFormValues,
  type FeatureEditorFormValues,
} from '@/core/feature-authoring/form-adapter'
import { useFeatureEditorFormSync } from '@/hooks/use-feature-editor-form-sync'
import { useEditorState } from '@/hooks/use-editor-state'
import {
  getSketchPlaneEditFormSchema,
  getSketchPlaneEditSelectionTarget,
  hasSketchPlaneEditChanges,
  type SketchPlaneEditSessionState,
} from '@/domain/editor/sketch-plane-editing'

interface SketchPlaneInspectorProps {
  onCancel: () => void
  onCommit: () => void
  onPatch: (patch: Record<string, unknown>) => void
  session: SketchPlaneEditSessionState | null
}

export function SketchPlaneInspector({
  onCancel,
  onCommit,
  onPatch,
  session,
}: SketchPlaneInspectorProps) {
  const editor = useEditorState()
  const {
    activeCommand,
    activeReferencePickerFieldId,
  } = editor.state
  const { dispatch } = editor
  const formSchema = session ? getSketchPlaneEditFormSchema(session) : null
  const initialFormValues = formSchema ? createFeatureEditorFormValues(formSchema) : {}
  const form = useForm<FeatureEditorFormValues>({ defaultValues: initialFormValues })
  useFeatureEditorFormSync({
    sessionKey: activeCommand?.commandSessionId ?? null,
    formSchema,
    form,
  })

  if (!session || !formSchema) {
    return null
  }

  const visualSections = getVisualFormSections(formSchema.sections)
  const shortCode = `S${session.sketchId.slice(-2).toUpperCase()}`

  return (
    <WorkbenchInspectorPanel
      iconName="pencilRuler"
      title={`Change Plane: ${session.sketchLabel}`}
      shortCode={shortCode}
      statusLabel={session.status}
      commitDisabled={!hasSketchPlaneEditChanges(session)}
      onCancel={onCancel}
      onCommit={onCommit}
    >
      <div className="px-3 pb-1">
        <p className={SECTION_HEADER_CLASSES}>
          Sketch
        </p>
        <p className="mt-1 text-[12px] text-[var(--workbench-shell-text-muted)]">
          {getSketchPlaneEditSelectionTarget(session).sketchId}
        </p>
      </div>
      {visualSections.map((section) => (
        <section key={section.id} className="pb-1">
          <div className="flex items-center justify-between px-3 pb-1 pt-3">
            <p className={SECTION_HEADER_CLASSES}>
              {section.title}
            </p>
            {section.hint ? (
              <p className="font-mono text-[10px] text-[var(--workbench-shell-text-dim)]">
                {section.hint}
              </p>
            ) : null}
          </div>
          <div className="space-y-0.5 px-2">
            {section.fields.map((field) => (
              <FeatureFormFieldRenderer
                key={field.id}
                control={form.control}
                field={field}
                documentVariables={[]}
                activeReferencePickerFieldId={activeReferencePickerFieldId}
                onReferencePickerActivate={(fieldId) => dispatch({ type: 'form.referencePickerActivated', fieldId })}
                onPatch={onPatch}
              />
            ))}
          </div>
        </section>
      ))}
    </WorkbenchInspectorPanel>
  )
}
