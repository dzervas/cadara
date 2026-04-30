import { Button, Paper, Text, ThemeIcon } from '@mantine/core'
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'

import { FeatureFormFieldRenderer } from '@/components/layout/feature-inspector'
import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import {
  createFeatureEditorFormValues,
  normalizeFeatureEditorFormValues,
  shouldResetFeatureEditorFormValues,
  type FeatureEditorFormValues,
} from '@/domain/feature-authoring/form-adapter'
import type { FeatureEditorFormField, FeatureEditorFormSchema } from '@/domain/feature-authoring/form-schema'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'
import { useEditorState } from '@/hooks/use-editor-state'
import { useRuntimeExtensionRegistry } from '@/hooks/use-runtime-extension-registry'

interface ImportInspectorProps {
  onCommit: () => void
}

export function ImportInspector({ onCommit }: ImportInspectorProps) {
  const editor = useEditorState()
  const {
    activeCommand,
    activeImportSession,
    activeReferencePickerFieldId,
    snapshot,
  } = editor.state
  const { dispatch } = editor
  const { importProviders } = useRuntimeExtensionRegistry()
  const provider = activeImportSession ? importProviders.getById(activeImportSession.providerId) : null
  const formSchema = useMemo(
    () => activeImportSession ? withSessionDiagnostics(activeImportSession.formSchema, activeImportSession.diagnostics) : null,
    [activeImportSession],
  )
  const documentVariables = snapshot?.variables ?? []
  const initialFormValues = formSchema ? createFeatureEditorFormValues(formSchema) : {}
  const form = useForm<FeatureEditorFormValues>({ defaultValues: initialFormValues })
  const lastSessionKeyRef = useRef<string | null>(null)
  const lastSyncedValuesRef = useRef<FeatureEditorFormValues>(initialFormValues)
  const activeCommandSessionId = activeCommand?.commandSessionId ?? null

  useEffect(() => {
    if (!activeCommandSessionId || !formSchema) {
      form.reset({})
      lastSessionKeyRef.current = null
      lastSyncedValuesRef.current = {}
      return
    }

    const nextValues = createFeatureEditorFormValues(formSchema)
    const currentValues = normalizeFeatureEditorFormValues(formSchema, form.getValues())

    if (shouldResetFeatureEditorFormValues({
      schema: formSchema,
      sessionKey: activeCommandSessionId,
      lastSessionKey: lastSessionKeyRef.current,
      currentValues,
      lastSyncedValues: lastSyncedValuesRef.current,
      nextValues,
    })) {
      form.reset(nextValues)
    }

    lastSessionKeyRef.current = activeCommandSessionId
    lastSyncedValuesRef.current = nextValues
  }, [activeCommandSessionId, form, formSchema])

  if (!activeImportSession || !formSchema) {
    return null
  }

  const commitDisabled = hasBlockingErrors(formSchema) || activeCommand?.phase === 'awaitingEffect'

  return (
    <Paper
      component="aside"
      className="flex h-full max-h-full w-[320px] min-w-0 max-w-full flex-col overflow-hidden"
      style={{
        background: 'var(--workbench-shell-surface-panel)',
        border: '1px solid var(--workbench-shell-border)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header className="px-4 py-4" style={{ borderBottom: '1px solid var(--workbench-shell-border)' }}>
        <div className="flex items-center gap-2">
          <ThemeIcon variant="light" color="workbench" size={20}>
            <WorkbenchIcon name="import" className="h-4 w-4" />
          </ThemeIcon>
          <Text size="11px" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.22em' }}>
            Import Session
          </Text>
        </div>
        <Text mt={8} size="sm" fw={500} c="dark.0">{provider?.label ?? 'Import'}</Text>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {formSchema.sections.map((section) => (
          <section key={section.id} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mantine-color-dark-3)]">
              {section.title}
            </p>
            {section.fields.map((field) => (
              <FeatureFormFieldRenderer
                key={field.id}
                control={form.control}
                field={field}
                documentVariables={documentVariables}
                activeReferencePickerFieldId={activeReferencePickerFieldId}
                onReferencePickerActivate={(fieldId) => dispatch({ type: 'form.referencePickerActivated', fieldId })}
                onPatch={(patch) => dispatch({ type: 'import.selectionPatched', patch })}
              />
            ))}
          </section>
        ))}
      </div>

      <footer className="grid grid-cols-2 gap-2 px-4 py-4" style={{ borderTop: '1px solid var(--workbench-shell-border)' }}>
        <Button
          type="button"
          onClick={() => dispatch({ type: 'import.cancelled' })}
          variant="default"
          leftSection={<WorkbenchIcon name="ban" className="h-4 w-4" />}
          styles={{
            root: {
              backgroundColor: 'var(--workbench-shell-surface)',
              borderColor: 'var(--workbench-shell-border)',
              color: 'var(--workbench-shell-text-muted)',
            },
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onCommit}
          disabled={commitDisabled}
          variant="light"
          color="workbench"
          leftSection={<WorkbenchIcon name="check" className="h-4 w-4" />}
          styles={{
            root: {
              backgroundColor: 'var(--workbench-shell-accent-surface)',
              borderColor: 'var(--workbench-shell-accent)',
              color: 'var(--workbench-shell-text)',
            },
          }}
        >
          Commit
        </Button>
      </footer>
    </Paper>
  )
}

function withSessionDiagnostics(
  schema: FeatureEditorFormSchema,
  diagnostics: readonly ModelingDiagnostic[],
): FeatureEditorFormSchema {
  if (diagnostics.length === 0) {
    return schema
  }

  return {
    sections: [
      ...schema.sections,
      createSessionDiagnosticsSection(diagnostics),
    ],
  }
}

function createSessionDiagnosticsSection(
  diagnostics: readonly ModelingDiagnostic[],
) {
  return {
    id: 'import-session-diagnostics',
    title: 'Diagnostics',
    fields: [{
      id: 'import-session-diagnostics-field',
      kind: 'diagnostics' as const,
      label: 'Session diagnostics',
      diagnostics,
    }],
  }
}

function hasBlockingErrors(schema: FeatureEditorFormSchema) {
  return schema.sections.some((section) => section.fields.some(fieldHasBlockingError))
}

function fieldHasBlockingError(field: FeatureEditorFormField): boolean {
  if (field.hidden) {
    return false
  }

  if (field.error) {
    return true
  }

  if (field.kind === 'optionGroup') {
    return field.fields.some(fieldHasBlockingError)
  }

  if (field.kind === 'discriminatedOptionGroup') {
    return fieldHasBlockingError(field.discriminant)
      || field.variants.some((variant) => variant.fields.some(fieldHasBlockingError))
  }

  return false
}
