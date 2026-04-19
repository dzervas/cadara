import { ActionIcon, Button, Paper, Text, ThemeIcon, Tooltip } from '@mantine/core'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Controller, type Control, type ControllerRenderProps, useForm } from 'react-hook-form'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import { Input } from '@/components/ui/input'
import type { DocumentVariableRecord, FeatureSnapshotRecord, ModelingDiagnostic } from '@/contracts/modeling/schema'
import { getPrimitiveRefLabel, primitiveRefEquals, type PrimitiveRef } from '@/domain/editor/schema'
import { getFeatureEditorFormSchema } from '@/domain/editor/feature-editing'
import {
  createFeatureEditorExpressionControlFormValue,
  createFeatureEditorLiteralControlFormValue,
  createFeatureEditorFormValues,
  createFeatureEditorPatchFromExpression,
  createFeatureEditorPatchFromFormValue,
  getFeatureEditorControlFormValueText,
  getFeatureEditorExpressionSourceState,
  normalizeFeatureEditorFormValues,
  previewFeatureEditorFieldExpression,
  shouldResetFeatureEditorFormValues,
  type FeatureEditorExpressionField,
  type FeatureEditorExpressionPreview,
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
          className="rounded-lg border border-[var(--workbench-shell-border)] bg-[var(--workbench-shell-surface)] px-3 py-2"
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
    return 'border-[var(--workbench-shell-danger-border)] text-[var(--workbench-shell-danger-text)]'
  }

  if (isActive) {
    return 'border-[var(--mantine-color-workbench-4)] text-[var(--mantine-color-workbench-4)]'
  }

  return 'border-[var(--mantine-color-dark-5)] text-[var(--mantine-color-dark-0)]'
}

function FieldMessage(props: { helper?: string; error?: { message: string } | null }) {
  if (props.error) {
    return <p className="text-xs text-[var(--workbench-shell-danger-text)]">{props.error.message}</p>
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

function FunctionIcon() {
  return (
    <span
      aria-hidden="true"
      className="block h-4 w-4"
      style={{
        backgroundColor: 'currentColor',
        maskImage: 'url(/icons/function.svg)',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        maskSize: 'contain',
      }}
    />
  )
}

function ExpressionAffordance(props: {
  fieldLabel: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <ActionIcon
      component="button"
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={`Edit ${props.fieldLabel} expression`}
      aria-pressed={props.active}
      variant="default"
      size={40}
      styles={{
        root: {
          backgroundColor: 'var(--workbench-shell-surface)',
          borderColor: props.active ? 'var(--mantine-color-workbench-5)' : 'var(--workbench-shell-border)',
          color: props.active ? 'var(--mantine-color-workbench-4)' : 'var(--workbench-shell-text-muted)',
          flex: '0 0 auto',
        },
      }}
    >
      <FunctionIcon />
    </ActionIcon>
  )
}

export function FeatureExpressionEditorControl(props: {
  id: string
  fieldLabel: string
  expressionText: string
  preview: FeatureEditorExpressionPreview
  hasError: boolean
  onChangeText: (nextText: string) => void
  onAccept: () => void
  onClear: () => void
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="relative min-w-0 flex-1">
        <Input
          id={props.id}
          aria-label={`${props.fieldLabel} expression`}
          value={props.expressionText}
          onBlur={props.onAccept}
          onChange={(event) => props.onChangeText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              props.onAccept()
            }
          }}
          aria-invalid={props.hasError || undefined}
          error={props.hasError}
          className={`h-10 rounded-md bg-[var(--workbench-shell-surface)] pr-20 ${fieldBorderClass({ error: props.hasError ? { message: '' } : null })}`}
        />
        {props.preview.ok ? (
          <span className="pointer-events-none absolute right-2 top-1/2 max-w-[45%] -translate-y-1/2 truncate rounded bg-[var(--workbench-shell-overlay)] px-2 py-0.5 text-xs text-[var(--mantine-color-dark-1)]">
            {props.preview.displayText}
          </span>
        ) : null}
      </div>
      <ActionIcon
        component="button"
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.onClear}
        aria-label={`Clear ${props.fieldLabel} expression`}
        variant="default"
        color="red"
        size={40}
        styles={{
          root: {
            backgroundColor: 'var(--workbench-shell-surface)',
            borderColor: 'var(--workbench-shell-danger-border)',
            color: 'var(--workbench-shell-danger-text)',
            flex: '0 0 auto',
          },
        }}
      >
        <WorkbenchIcon name="close" className="h-4 w-4" />
      </ActionIcon>
    </div>
  )
}

type ControllerField = ControllerRenderProps<FeatureEditorFormValues, string>

interface ExpressionControlRenderInput {
  id: string
  value: string
  disabled: boolean
  hasError: boolean
  onBlur: () => void
  onLiteralChange: (nextValue: string) => void
}

function ExpressionFieldShell(props: {
  control: Control<FeatureEditorFormValues>
  field: FeatureEditorExpressionField
  documentVariables: readonly DocumentVariableRecord[]
  onPatch: (patch: Record<string, unknown>) => void
  renderControl: (input: ExpressionControlRenderInput) => ReactNode
}) {
  return (
    <Controller
      control={props.control}
      name={props.field.id}
      render={({ field }) => (
        <ExpressionFieldShellInner
          controllerField={field}
          documentVariables={props.documentVariables}
          field={props.field}
          onPatch={props.onPatch}
          renderControl={props.renderControl}
        />
      )}
    />
  )
}

function ExpressionFieldShellInner(props: {
  controllerField: ControllerField
  documentVariables: readonly DocumentVariableRecord[]
  field: FeatureEditorExpressionField
  onPatch: (patch: Record<string, unknown>) => void
  renderControl: (input: ExpressionControlRenderInput) => ReactNode
}) {
  const sourceState = getFeatureEditorExpressionSourceState(props.field, props.controllerField.value)
  const activeExpression = sourceState?.source === 'expression'
  const [editingExpression, setEditingExpression] = useState(false)
  const [expressionText, setExpressionText] = useState(() =>
    activeExpression ? sourceState.expressionText ?? '' : getFeatureEditorControlFormValueText(props.controllerField.value),
  )

  const preview = useMemo(
    () => previewFeatureEditorFieldExpression({
      field: props.field,
      expressionText,
      variables: props.documentVariables,
    }),
    [expressionText, props.documentVariables, props.field],
  )
  const normalValue = activeExpression && preview.ok
    ? preview.formValue
    : getFeatureEditorControlFormValueText(props.controllerField.value)
  const fieldError = editingExpression && !preview.ok ? { message: preview.message } : props.field.error
  const hasError = !!fieldError

  function patchLiteral(nextValue: string) {
    const nextFormValue = createFeatureEditorLiteralControlFormValue(nextValue)
    props.controllerField.onChange(nextFormValue)

    const patch = createFeatureEditorPatchFromFormValue(props.field, nextFormValue)
    if (patch) {
      props.onPatch(patch)
    }
  }

  function acceptExpression() {
    if (!preview.ok) {
      return
    }

    const trimmed = expressionText.trim()
    const patch = createFeatureEditorPatchFromExpression(props.field, trimmed)
    if (!patch) {
      return
    }

    props.controllerField.onChange(createFeatureEditorExpressionControlFormValue(preview.formValue, trimmed))
    props.onPatch(patch)
    setEditingExpression(false)
  }

  function clearExpression() {
    const nextValue = preview.ok ? preview.formValue : normalValue
    patchLiteral(nextValue)
    setEditingExpression(false)
  }

  return (
    <section className="space-y-2">
      <label
        className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mantine-color-dark-3)]"
        htmlFor={editingExpression ? `${props.field.id}-expression` : props.field.id}
      >
        {props.field.label}
      </label>

      {editingExpression ? (
        <FeatureExpressionEditorControl
          id={`${props.field.id}-expression`}
          fieldLabel={props.field.label}
          expressionText={expressionText}
          preview={preview}
          hasError={hasError}
          onAccept={acceptExpression}
          onChangeText={setExpressionText}
          onClear={clearExpression}
        />
      ) : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {props.renderControl({
              id: props.field.id,
              value: normalValue,
              disabled: !!props.field.disabled || activeExpression,
              hasError,
              onBlur: props.controllerField.onBlur,
              onLiteralChange: patchLiteral,
            })}
          </div>
          <ExpressionAffordance
            fieldLabel={props.field.label}
            active={activeExpression}
            disabled={props.field.disabled}
            onClick={() => {
              setExpressionText(activeExpression ? sourceState.expressionText ?? '' : normalValue)
              setEditingExpression(true)
            }}
          />
        </div>
      )}

      <FieldMessage helper={formatParticipantHelper(props.field)} error={fieldError} />
    </section>
  )
}

function NumericField(props: {
  control: Control<FeatureEditorFormValues>
  field: FeatureNumericField
  documentVariables: readonly DocumentVariableRecord[]
  onPatch: (patch: Record<string, unknown>) => void
}) {
  function renderDirectionToggle() {
    const toggle = props.field.directionToggle
    if (!toggle) {
      return null
    }

    const isForward = toggle.value === toggle.forwardValue
    const nextValue = isForward ? toggle.reverseValue : toggle.forwardValue
    const currentLabel = isForward ? toggle.forwardLabel : toggle.reverseLabel
    const nextLabel = isForward ? toggle.reverseLabel : toggle.forwardLabel

    return (
      <Tooltip label={`Flip to ${nextLabel}`} withArrow>
        <ActionIcon
          component="button"
          type="button"
          onClick={() => props.onPatch({ [toggle.patch.patchKey]: nextValue })}
          aria-label={`Flip ${props.field.label} direction`}
          aria-pressed={!isForward}
          variant="default"
          size={40}
          styles={{
            root: {
              backgroundColor: 'var(--workbench-shell-surface)',
              borderColor: isForward ? 'var(--workbench-shell-border)' : 'var(--mantine-color-workbench-5)',
              color: isForward ? 'var(--workbench-shell-text-muted)' : 'var(--mantine-color-workbench-4)',
              flex: '0 0 auto',
            },
          }}
          title={currentLabel}
        >
          <WorkbenchIcon name="flipDirection" className="h-4 w-4" />
        </ActionIcon>
      </Tooltip>
    )
  }

  return (
    <ExpressionFieldShell
      control={props.control}
      field={props.field}
      documentVariables={props.documentVariables}
      onPatch={props.onPatch}
      renderControl={({ id, value, disabled, hasError, onBlur, onLiteralChange }) => (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Input
              id={id}
              type="number"
              value={value}
              step={props.field.step ?? 0.1}
              disabled={disabled}
              onBlur={onBlur}
              onChange={(event) => onLiteralChange(event.target.value)}
              aria-invalid={hasError || undefined}
              error={hasError}
              className={`h-10 rounded-md bg-[var(--workbench-shell-surface)] ${fieldBorderClass({ error: hasError ? props.field.error ?? { message: '' } : null })}`}
            />
          </div>
          {renderDirectionToggle()}
        </div>
      )}
    />
  )
}

function EnumField(props: {
  control: Control<FeatureEditorFormValues>
  field: Extract<FeatureEditorFormField, { kind: 'enum' }>
  documentVariables: readonly DocumentVariableRecord[]
  onPatch: (patch: Record<string, unknown>) => void
}) {
  return (
    <ExpressionFieldShell
      control={props.control}
      field={props.field}
      documentVariables={props.documentVariables}
      onPatch={props.onPatch}
      renderControl={({ value, disabled, onLiteralChange }) => (
        <div className="grid grid-cols-4 gap-2">
          {props.field.options.map((option) => (
            <Button
              key={option.value}
              type="button"
              disabled={disabled}
              variant={value === option.value ? 'light' : 'default'}
              color="workbench"
              onClick={() => onLiteralChange(option.value)}
              styles={{
                root: {
                  backgroundColor:
                    value === option.value
                      ? 'var(--workbench-shell-accent-surface)'
                      : 'var(--workbench-shell-surface)',
                  borderColor:
                    value === option.value
                      ? 'var(--workbench-shell-border-strong)'
                      : 'var(--workbench-shell-border)',
                  color:
                    value === option.value
                      ? 'var(--workbench-shell-text)'
                      : 'var(--workbench-shell-text-muted)',
                },
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
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
  const className = `w-full rounded-md border bg-[var(--workbench-shell-surface)] px-3 py-3 text-left transition ${fieldBorderClass({ error: props.error }, props.isActive)}`
  const labelContent = (
    <>
      <p className="text-xs text-[var(--mantine-color-dark-2)]">{props.title}</p>
      <p className={`mt-1 text-sm ${props.error ? 'text-[var(--workbench-shell-danger-text)]' : props.isActive ? 'text-[var(--mantine-color-workbench-4)]' : 'text-[var(--mantine-color-dark-0)]'}`}>
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
                  backgroundColor: 'var(--workbench-shell-surface)',
                  borderColor: 'var(--workbench-shell-border)',
                  color: 'var(--workbench-shell-text-muted)',
                },
              }}
            >
              <WorkbenchIcon name="close" className="h-3.5 w-3.5" />
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
                backgroundColor: 'var(--workbench-shell-surface)',
                borderColor: 'var(--workbench-shell-border)',
                color: 'var(--workbench-shell-text-muted)',
              },
            }}
          >
            <WorkbenchIcon name="close" className="h-3.5 w-3.5" />
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
            className={`rounded-md border bg-[var(--workbench-shell-surface)] px-3 py-3 ${fieldBorderClass(props.field, props.isActive)}`}
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
                    backgroundColor: 'var(--workbench-shell-surface)',
                    borderColor: 'var(--workbench-shell-border)',
                    color: 'var(--workbench-shell-text-muted)',
                  },
                }}
              >
                <WorkbenchIcon name="close" className="h-3.5 w-3.5" />
              </ActionIcon>
            </div>
            {hasSelection ? (
              <div className="mt-3 space-y-2">
                {selected.map((target) => (
                  <div
                    key={getPrimitiveRefLabel(target)}
                    className="flex items-center justify-between gap-2 rounded-md border border-[var(--workbench-shell-border)] bg-[var(--workbench-shell-overlay)] px-2 py-2"
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
                                  backgroundColor: 'var(--workbench-shell-surface)',
                                  borderColor: 'var(--workbench-shell-border)',
                                  color: 'var(--workbench-shell-text-muted)',
                                },
                              }}
                            >
                              <WorkbenchIcon name="check" className="h-3 w-3 rotate-180" />
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
                                  backgroundColor: 'var(--workbench-shell-surface)',
                                  borderColor: 'var(--workbench-shell-border)',
                                  color: 'var(--workbench-shell-text-muted)',
                                },
                              }}
                            >
                              <WorkbenchIcon name="check" className="h-3 w-3" />
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
                              backgroundColor: 'var(--workbench-shell-surface)',
                              borderColor: 'var(--workbench-shell-border)',
                              color: 'var(--workbench-shell-text-muted)',
                            },
                          }}
                        >
                          <WorkbenchIcon name="close" className="h-3 w-3" />
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
  documentVariables: readonly DocumentVariableRecord[]
  activeReferencePickerFieldId: string | null
  onReferencePickerActivate: (fieldId: string) => void
  onPatch: (patch: Record<string, unknown>) => void
}) {
  if (props.field.hidden) {
    return null
  }

  switch (props.field.kind) {
    case 'numeric':
      return <NumericField control={props.control} field={props.field} documentVariables={props.documentVariables} onPatch={props.onPatch} />
    case 'enum':
      return <EnumField control={props.control} field={props.field} documentVariables={props.documentVariables} onPatch={props.onPatch} />
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
  const editor = useEditorState()
  const { activeCommand, activeEditSession, activeReferencePickerFieldId } = editor.state
  const { dispatch } = editor
  const activeCommandSessionId = activeCommand?.commandSessionId ?? null
  const formSchema = activeEditSession ? getFeatureEditorFormSchema(activeEditSession) : null
  const documentVariables = editor.state.snapshot?.variables ?? []
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
        background: 'var(--workbench-shell-surface-panel)',
        border: '1px solid var(--workbench-shell-border)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header className="px-4 py-4" style={{ borderBottom: '1px solid var(--workbench-shell-border)' }}>
        <div className="flex items-center gap-2">
          <ThemeIcon variant="light" color="workbench" size={20}>
            <WorkbenchIcon name="layers" className="h-4 w-4" />
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
                documentVariables={documentVariables}
                activeReferencePickerFieldId={activeReferencePickerFieldId}
                onReferencePickerActivate={(fieldId) => dispatch({ type: 'form.referencePickerActivated', fieldId })}
                onPatch={onPatch}
              />
            ))}
          </section>
        ))}
      </div>

      <footer className="grid grid-cols-2 gap-2 px-4 py-4" style={{ borderTop: '1px solid var(--workbench-shell-border)' }}>
        <Button
          type="button"
          onClick={onCancel}
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
