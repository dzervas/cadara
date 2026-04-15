import { ActionIcon, Button, Paper, Text, ThemeIcon } from '@mantine/core'
import { useEffect, useRef } from 'react'
import { Check, CircleSlash, Layers3, X } from 'lucide-react'
import { Controller, type Control, useForm } from 'react-hook-form'

import { Input } from '@/components/ui/input'
import type { FeatureSnapshotRecord, ModelingDiagnostic } from '@/contracts/modeling/schema'
import { getPrimitiveRefLabel, primitiveRefEquals, type PrimitiveRef } from '@/domain/editor/schema'
import { getFeatureEditorFormSchema } from '@/domain/editor/feature-editing'
import {
  createFeatureEditorFormValues,
  createFeatureEditorPatchFromFormValue,
  normalizeFeatureEditorFormValues,
  shouldResetFeatureEditorFormValues,
  type FeatureEditorFormValues,
} from '@/domain/feature-authoring/form-adapter'
import {
  createFeatureEditorClearReferencePatch,
  createFeatureEditorRemoveReferenceItemPatch,
} from '@/domain/feature-authoring/form-events'
import type { FeatureEditorFormField, FeatureNumericField } from '@/domain/feature-authoring/form-schema'
import { useEditorState } from '@/hooks/use-editor-state'

interface FeatureInspectorProps {
  featureSnapshot: FeatureSnapshotRecord | null
  onPatch: (patch: Record<string, unknown>) => void
  onCommit: () => void
  onCancel: () => void
}

function DiagnosticsList({ diagnostics }: { diagnostics: readonly ModelingDiagnostic[] }) {
  if (diagnostics.length === 0) {
    return (
      <p className="text-xs text-[var(--mantine-color-dark-2)]">
        No diagnostics reported for the current preview.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {diagnostics.map((diagnostic, index) => (
        <div
          key={`${diagnostic.code}-${diagnostic.message}-${index}`}
          className="rounded-lg border border-[var(--mantine-color-dark-5)] bg-[rgba(12,16,22,0.8)] px-3 py-2"
        >
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--mantine-color-dark-3)]">
            {diagnostic.severity}
          </p>
          <p className="mt-1 text-sm text-[var(--mantine-color-dark-0)]">{diagnostic.message}</p>
          {diagnostic.detail ? (
            <p className="mt-1 text-xs text-[var(--mantine-color-dark-2)]">
              {formatDiagnosticDetail(diagnostic)}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-[var(--mantine-color-dark-2)]">{diagnostic.code}</p>
        </div>
      ))}
    </div>
  )
}

function formatDiagnosticDetail(diagnostic: ModelingDiagnostic) {
  const detail = diagnostic.detail

  if (!detail) {
    return null
  }

  switch (detail.kind) {
    case 'invalidReference':
      return `Broken ref ${getPrimitiveRefLabel(detail.reference.target)}: ${detail.reference.reason}`
    case 'revisionConflict':
      return `Expected ${detail.expectedRevisionId}, current ${detail.actualRevisionId}`
    case 'stalePreview':
      return `Preview ${detail.previewId} used ${detail.requestedRevisionId}; current is ${detail.currentRevisionId}`
    case 'rebuildFailure':
      return `Affected features: ${detail.affectedFeatureIds.join(', ') || 'none'}`
    case 'advancedFeatureValidation':
      return detail.diagnostic.role
        ? `${detail.diagnostic.role}: ${detail.diagnostic.message}`
        : detail.diagnostic.message
  }
}

function renderReference(value: unknown) {
  return value && typeof value === 'object' && 'kind' in value
    ? getPrimitiveRefLabel(value as Parameters<typeof getPrimitiveRefLabel>[0])
    : 'None selected'
}

function isPrimitiveRefValue(value: unknown): value is PrimitiveRef {
  return !!value && typeof value === 'object' && 'kind' in value
}

function fieldBorderClass(field: Pick<FeatureEditorFormField, 'error'>, isActive = false) {
  if (field.error) {
    return 'border-red-500 text-red-100'
  }

  if (isActive) {
    return 'border-[var(--mantine-color-workbench-4)] text-[var(--mantine-color-workbench-4)]'
  }

  return 'border-[var(--mantine-color-dark-5)] text-[var(--mantine-color-dark-0)]'
}

function FieldMessage(props: { helper?: string; error?: { message: string } | null }) {
  if (props.error) {
    return <p className="text-xs text-red-300">{props.error.message}</p>
  }

  return props.helper ? (
    <p className="text-xs text-[var(--mantine-color-dark-2)]">{props.helper}</p>
  ) : null
}

function formatParticipantHelper(field: FeatureEditorFormField) {
  const participant = field.advancedParticipant
  if (!participant) {
    return field.helper
  }

  const max = participant.cardinality.max === null ? '+' : `-${participant.cardinality.max}`
  const status = participant.required ? 'Required' : 'Optional'
  const participantStatus = `${status}; ${participant.selectedCount} selected; expected ${participant.cardinality.min}${max}.`
  return field.helper ? `${participantStatus} ${field.helper}` : participantStatus
}

function NumericField(props: {
  control: Control<FeatureEditorFormValues>
  field: FeatureNumericField
  onPatch: (patch: Record<string, unknown>) => void
}) {
  return (
    <Controller
      control={props.control}
      name={props.field.id}
      render={({ field }) => (
        <section className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mantine-color-dark-3)]" htmlFor={props.field.id}>
            {props.field.label}
          </label>
          <Input
            id={props.field.id}
            type="number"
            value={typeof field.value === 'string' ? field.value : ''}
            step={props.field.step ?? 0.1}
            disabled={props.field.disabled}
            onBlur={field.onBlur}
            onChange={(event) => {
              const nextValue = event.target.value
              field.onChange(nextValue)

              const patch = createFeatureEditorPatchFromFormValue(props.field, nextValue)
              if (patch) {
                props.onPatch(patch)
              }
            }}
            aria-invalid={props.field.error ? true : undefined}
            className={`h-10 rounded-md bg-[rgba(12,16,22,0.8)] ${fieldBorderClass(props.field)}`}
          />
          <FieldMessage helper={formatParticipantHelper(props.field)} error={props.field.error} />
        </section>
      )}
    />
  )
}

function EnumField(props: {
  control: Control<FeatureEditorFormValues>
  field: Extract<FeatureEditorFormField, { kind: 'enum' }>
  onPatch: (patch: Record<string, unknown>) => void
}) {
  return (
    <Controller
      control={props.control}
      name={props.field.id}
      render={({ field }) => (
        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mantine-color-dark-3)]">
            {props.field.label}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {props.field.options.map((option) => (
              <Button
                key={option.value}
                type="button"
                disabled={props.field.disabled}
                variant={field.value === option.value ? 'light' : 'default'}
                color="workbench"
                onClick={() => {
                  field.onChange(option.value)

                  const patch = createFeatureEditorPatchFromFormValue(props.field, option.value)
                  if (patch) {
                    props.onPatch(patch)
                  }
                }}
                styles={{
                  root: {
                    backgroundColor:
                      field.value === option.value ? 'rgba(94, 130, 171, 0.18)' : 'rgba(12, 16, 22, 0.8)',
                    borderColor:
                      field.value === option.value
                        ? 'var(--mantine-color-dark-4)'
                        : 'var(--mantine-color-dark-5)',
                    color:
                      field.value === option.value
                        ? 'var(--mantine-color-dark-0)'
                        : 'var(--mantine-color-dark-2)',
                  },
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <FieldMessage helper={formatParticipantHelper(props.field)} error={props.field.error} />
        </section>
      )}
    />
  )
}

function ReferenceCard(props: {
  title: string
  value: string
  helper?: string
  error?: { message: string } | null
  isActive?: boolean
  onActivate?: () => void
  onClear?: () => void
  clearDisabled?: boolean
}) {
  const className = `w-full rounded-md border bg-[rgba(12,16,22,0.8)] px-3 py-3 text-left transition ${fieldBorderClass({ error: props.error }, props.isActive)}`
  const labelContent = (
    <>
      <p className="text-xs text-[var(--mantine-color-dark-2)]">{props.title}</p>
      <p className={`mt-1 text-sm ${props.error ? 'text-red-100' : props.isActive ? 'text-[var(--mantine-color-workbench-4)]' : 'text-[var(--mantine-color-dark-0)]'}`}>
        {props.value}
      </p>
    </>
  )

  if (props.onActivate) {
    return (
      <Paper className={className}>
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={props.onActivate} className="min-w-0 flex-1 text-left" aria-pressed={props.isActive}>
            {labelContent}
          </button>
          {props.onClear ? (
            <ActionIcon
              component="button"
              onClick={props.onClear}
              disabled={props.clearDisabled}
              aria-label={`Clear ${props.title}`}
              variant="default"
              color="red"
              size={28}
              styles={{
                root: {
                  backgroundColor: 'rgba(12, 16, 22, 0.8)',
                  borderColor: 'var(--mantine-color-dark-5)',
                  color: 'var(--mantine-color-dark-2)',
                },
              }}
            >
              <X className="h-3.5 w-3.5" />
            </ActionIcon>
          ) : null}
        </div>
        <div className="mt-2">
          <FieldMessage helper={props.helper} error={props.error} />
        </div>
      </Paper>
    )
  }

  return (
    <Paper className={className}>
      <div className="flex items-start justify-between gap-2">
        <div>{labelContent}</div>
        {props.onClear ? (
          <ActionIcon
            component="button"
            onClick={props.onClear}
            disabled={props.clearDisabled}
            aria-label={`Clear ${props.title}`}
            variant="default"
            color="red"
            size={28}
            styles={{
              root: {
                backgroundColor: 'rgba(12, 16, 22, 0.8)',
                borderColor: 'var(--mantine-color-dark-5)',
                color: 'var(--mantine-color-dark-2)',
              },
            }}
          >
            <X className="h-3.5 w-3.5" />
          </ActionIcon>
        ) : null}
      </div>
      <div className="mt-2">
        <FieldMessage helper={props.helper} error={props.error} />
      </div>
    </Paper>
  )
}

function ReferenceCollectionCard(props: {
  control: Control<FeatureEditorFormValues>
  field: Extract<FeatureEditorFormField, { kind: 'referenceCollection' }>
  isActive: boolean
  onActivate: () => void
  onPatch: (patch: Record<string, unknown>) => void
}) {
  return (
    <Controller
      control={props.control}
      name={props.field.id}
      render={({ field }) => {
        const selected = Array.isArray(field.value) ? field.value.filter(isPrimitiveRefValue) : []
        const hasSelection = selected.length > 0

        function moveItem(target: PrimitiveRef, direction: 'up' | 'down') {
          const targetIndex = selected.findIndex((entry) => primitiveRefEquals(entry, target))
          if (targetIndex < 0) {
            return
          }

          const nextIndex = direction === 'up' ? targetIndex - 1 : targetIndex + 1
          if (nextIndex < 0 || nextIndex >= selected.length) {
            return
          }

          const next = [...selected]
          const [item] = next.splice(targetIndex, 1)
          next.splice(nextIndex, 0, item!)
          field.onChange(next)
        }

        return (
          <Paper
            className={`rounded-md border bg-[rgba(12,16,22,0.8)] px-3 py-3 ${fieldBorderClass(props.field, props.isActive)}`}
          >
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={props.onActivate}
                className="min-w-0 flex-1 text-left"
                aria-pressed={props.isActive}
              >
                <p className="text-xs text-[var(--mantine-color-dark-2)]">{props.field.label}</p>
                <p className={`mt-1 text-sm ${props.isActive ? 'text-[var(--mantine-color-workbench-4)]' : 'text-[var(--mantine-color-dark-0)]'}`}>
                  {hasSelection ? `${selected.length} selected` : props.field.emptyLabel}
                </p>
              </button>
              <ActionIcon
                component="button"
                onClick={() => {
                  field.onChange([])
                  props.onPatch(createFeatureEditorClearReferencePatch(props.field))
                }}
                disabled={!hasSelection}
                aria-label={`Clear ${props.field.label}`}
                variant="default"
                color="red"
                size={28}
                styles={{
                  root: {
                    backgroundColor: 'rgba(12, 16, 22, 0.8)',
                    borderColor: 'var(--mantine-color-dark-5)',
                    color: 'var(--mantine-color-dark-2)',
                  },
                }}
              >
                <X className="h-3.5 w-3.5" />
              </ActionIcon>
            </div>
            {hasSelection ? (
              <div className="mt-3 space-y-2">
                {selected.map((target) => (
                  <div
                    key={getPrimitiveRefLabel(target)}
                    className="flex items-center justify-between gap-2 rounded-md border border-[var(--mantine-color-dark-5)] bg-[rgba(7,10,14,0.72)] px-2 py-2"
                  >
                    <span className="min-w-0 truncate text-xs text-[var(--mantine-color-dark-0)]">
                      {props.field.picker.itemLabel ?? props.field.label}: {getPrimitiveRefLabel(target)}
                    </span>
                    {props.field.picker.allowsMultiple ? (
                      <div className="flex items-center gap-1">
                        {props.field.ordering ? (
                          <>
                            <ActionIcon
                              component="button"
                              onClick={() => {
                                moveItem(target, 'up')
                                props.onPatch({ [props.field.ordering!.moveUpPatchKey]: target })
                              }}
                              aria-label={`Move ${getPrimitiveRefLabel(target)} earlier`}
                              variant="default"
                              size={24}
                              styles={{
                                root: {
                                  backgroundColor: 'rgba(12, 16, 22, 0.8)',
                                  borderColor: 'var(--mantine-color-dark-5)',
                                  color: 'var(--mantine-color-dark-2)',
                                },
                              }}
                            >
                              <Check className="h-3 w-3 rotate-180" />
                            </ActionIcon>
                            <ActionIcon
                              component="button"
                              onClick={() => {
                                moveItem(target, 'down')
                                props.onPatch({ [props.field.ordering!.moveDownPatchKey]: target })
                              }}
                              aria-label={`Move ${getPrimitiveRefLabel(target)} later`}
                              variant="default"
                              size={24}
                              styles={{
                                root: {
                                  backgroundColor: 'rgba(12, 16, 22, 0.8)',
                                  borderColor: 'var(--mantine-color-dark-5)',
                                  color: 'var(--mantine-color-dark-2)',
                                },
                              }}
                            >
                              <Check className="h-3 w-3" />
                            </ActionIcon>
                          </>
                        ) : null}
                        <ActionIcon
                          component="button"
                          onClick={() => {
                            field.onChange(selected.filter((entry) => !primitiveRefEquals(entry, target)))
                            props.onPatch(createFeatureEditorRemoveReferenceItemPatch(props.field, target))
                          }}
                          aria-label={`Remove ${getPrimitiveRefLabel(target)}`}
                          variant="default"
                          color="red"
                          size={24}
                          styles={{
                            root: {
                              backgroundColor: 'rgba(12, 16, 22, 0.8)',
                              borderColor: 'var(--mantine-color-dark-5)',
                              color: 'var(--mantine-color-dark-2)',
                            },
                          }}
                        >
                          <X className="h-3 w-3" />
                        </ActionIcon>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-2">
              <FieldMessage helper={formatParticipantHelper(props.field)} error={props.field.error} />
            </div>
          </Paper>
        )
      }}
    />
  )
}

function FeatureFormFieldRenderer(props: {
  control: Control<FeatureEditorFormValues>
  field: FeatureEditorFormField
  activeReferencePickerFieldId: string | null
  onReferencePickerActivate: (fieldId: string) => void
  onPatch: (patch: Record<string, unknown>) => void
}) {
  if (props.field.hidden) {
    return null
  }

  switch (props.field.kind) {
    case 'numeric':
      return <NumericField control={props.control} field={props.field} onPatch={props.onPatch} />
    case 'enum':
      return <EnumField control={props.control} field={props.field} onPatch={props.onPatch} />
    case 'referencePicker': {
      const field = props.field
      return (
        <Controller
          control={props.control}
          name={field.id}
          render={({ field: controllerField }) => (
            <ReferenceCard
              title={field.label}
              value={renderReference(controllerField.value) || field.emptyLabel}
              helper={formatParticipantHelper(field)}
              error={field.error}
              isActive={props.activeReferencePickerFieldId === field.id}
              onActivate={() => props.onReferencePickerActivate(field.id)}
              onClear={() => {
                controllerField.onChange(null)
                props.onPatch(createFeatureEditorClearReferencePatch(field))
              }}
              clearDisabled={!controllerField.value}
            />
          )}
        />
      )
    }
    case 'referenceCollection':
      return (
        <ReferenceCollectionCard
          control={props.control}
          field={props.field}
          isActive={props.activeReferencePickerFieldId === props.field.id}
          onActivate={() => props.onReferencePickerActivate(props.field.id)}
          onPatch={props.onPatch}
        />
      )
    case 'summary':
      return <ReferenceCard title={props.field.label} value={props.field.value} helper={props.field.helper} />
    case 'diagnostics':
      return <DiagnosticsList diagnostics={props.field.diagnostics} />
    case 'custom':
      return (
        <ReferenceCard
          title={props.field.label}
          value={`Custom renderer: ${props.field.rendererId}`}
          helper={props.field.helper}
        />
      )
  }
}

export function FeatureInspector({
  featureSnapshot,
  onPatch,
  onCommit,
  onCancel,
}: FeatureInspectorProps) {
  const {
    state: { activeCommand, activeEditSession, activeReferencePickerFieldId },
    dispatch,
  } = useEditorState()
  const activeCommandSessionId = activeCommand?.commandSessionId ?? null
  const formSchema = activeEditSession ? getFeatureEditorFormSchema(activeEditSession) : null
  const initialFormValues = formSchema ? createFeatureEditorFormValues(formSchema) : {}
  const form = useForm<FeatureEditorFormValues>({ defaultValues: initialFormValues })
  const lastSessionKeyRef = useRef<string | null>(null)
  const lastSyncedValuesRef = useRef<FeatureEditorFormValues>(initialFormValues)

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
  }, [activeCommandSessionId, activeEditSession, form, formSchema])

  if (!activeEditSession || !formSchema) {
    return null
  }

  const title =
    activeEditSession.mode === 'edit'
      ? featureSnapshot?.label ?? activeEditSession.featureId ?? `Edit ${activeEditSession.featureType}`
      : `Create ${activeEditSession.featureType[0]!.toUpperCase()}${activeEditSession.featureType.slice(1)}`

  return (
    <Paper
      component="aside"
      className="flex h-full max-h-full w-[320px] min-w-[320px] flex-col overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, rgba(16, 21, 29, 0.98), rgba(10, 14, 20, 0.98))',
        border: '1px solid var(--mantine-color-dark-5)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header className="px-4 py-4" style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}>
        <div className="flex items-center gap-2">
          <ThemeIcon variant="light" color="workbench" size={20}>
            <Layers3 className="h-4 w-4" />
          </ThemeIcon>
          <Text size="11px" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.22em' }}>
            Feature Session
          </Text>
        </div>
        <Text mt={8} size="sm" fw={500} c="dark.0">{title}</Text>
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
                activeReferencePickerFieldId={activeReferencePickerFieldId}
                onReferencePickerActivate={(fieldId) => dispatch({ type: 'form.referencePickerActivated', fieldId })}
                onPatch={onPatch}
              />
            ))}
          </section>
        ))}
      </div>

      <footer className="grid grid-cols-2 gap-2 px-4 py-4" style={{ borderTop: '1px solid var(--mantine-color-dark-5)' }}>
        <Button
          type="button"
          onClick={onCancel}
          variant="default"
          leftSection={<CircleSlash className="h-4 w-4" />}
          styles={{
            root: {
              backgroundColor: 'rgba(12, 16, 22, 0.8)',
              borderColor: 'var(--mantine-color-dark-5)',
              color: 'var(--mantine-color-dark-2)',
            },
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onCommit}
          variant="light"
          color="workbench"
          leftSection={<Check className="h-4 w-4" />}
          styles={{
            root: {
              backgroundColor: 'rgba(94, 130, 171, 0.22)',
              borderColor: 'var(--mantine-color-workbench-4)',
              color: 'var(--mantine-color-dark-0)',
            },
          }}
        >
          Commit
        </Button>
      </footer>
    </Paper>
  )
}
