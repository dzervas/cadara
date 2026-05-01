import { ActionIcon, Button, Paper, Select, Text, Tooltip } from '@mantine/core'
import { useMemo, useState, type ReactNode } from 'react'
import { Controller, type Control, type ControllerRenderProps, useForm } from 'react-hook-form'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import { Input } from '@/components/ui/input'
import {
  SECTION_HEADER_CLASSES,
  compactActionIconStyles,
  compactInputStyles,
  compactSelectStyles,
  fieldSurfaceStyle,
} from '@/components/ui/workbench-panel-styles'
import type { DocumentVariableRecord, FeatureSnapshotRecord, ModelingDiagnostic } from '@/contracts/modeling/schema'
import { getPrimitiveRefLabel, primitiveRefEquals, type PrimitiveRef } from '@/core/editor/schema'
import { formatInspectorDiagnosticDetail } from '@/domain/modeling/diagnostic-formatting'
import { getFeatureEditorFormSchema } from '@/domain/editor/feature-editing'
import {
  createFeatureEditorExpressionControlFormValue,
  createFeatureEditorLiteralControlFormValue,
  createFeatureEditorFormValues,
  createFeatureEditorPatchFromExpression,
  createFeatureEditorPatchFromFormValue,
  getFeatureEditorControlFormValueText,
  getFeatureEditorExpressionSourceState,
  previewFeatureEditorFieldExpression,
  type FeatureEditorExpressionField,
  type FeatureEditorExpressionPreview,
  type FeatureEditorFormValues,
} from '@/core/feature-authoring/form-adapter'
import { useFeatureEditorFormSync } from '@/hooks/use-feature-editor-form-sync'
import {
  createFeatureEditorClearReferencePatch,
  createFeatureEditorRemoveReferenceItemPatch,
} from '@/core/feature-authoring/form-events'
import type {
  FeatureEditorFormField,
  FeatureEditorFormSection,
  FeatureNumericField,
} from '@/core/feature-authoring/form-schema'
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
          className="rounded-[6px] px-3 py-2"
          style={{ background: 'var(--workbench-shell-overlay-soft)' }}
        >
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--mantine-color-dark-3)]">
            {diagnostic.severity}
          </p>
          <p className="mt-1 text-sm text-[var(--mantine-color-dark-0)]">{diagnostic.message}</p>
          {diagnostic.detail ? (
            <p className="mt-1 text-xs text-[var(--mantine-color-dark-2)]">
              {formatInspectorDiagnosticDetail(diagnostic)}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-[var(--mantine-color-dark-2)]">{diagnostic.code}</p>
        </div>
      ))}
    </div>
  )
}


function renderReference(value: unknown) {
  return value && typeof value === 'object' && 'kind' in value
    ? getPrimitiveRefLabel(value as Parameters<typeof getPrimitiveRefLabel>[0])
    : 'None selected'
}

function isPrimitiveRefValue(value: unknown): value is PrimitiveRef {
  return !!value && typeof value === 'object' && 'kind' in value
}


function compactFieldLabel(label: string) {
  return label
    .replace(/\s*\(degrees\)$/i, '')
    .replace(/\s+mode$/i, '')
    .replace(/\s+targets$/i, '')
}

function getNumericUnit(field: FeatureNumericField) {
  return field.input === 'angleDegrees' ? '°' : null
}

interface VisualFormSection {
  id: string
  title: string
  hint?: string
  fields: readonly FeatureEditorFormField[]
}

function getSectionSelectedCount(fields: readonly FeatureEditorFormField[]) {
  return fields.reduce((count, field) => count + (field.advancedParticipant?.selectedCount ?? 0), 0)
}

function isReferenceCollectionField(
  field: FeatureEditorFormField,
): field is Extract<FeatureEditorFormField, { kind: 'referenceCollection' }> {
  return field.kind === 'referenceCollection'
}

function isProfileReferenceCollectionField(
  field: FeatureEditorFormField,
): field is Extract<FeatureEditorFormField, { kind: 'referenceCollection' }> {
  return isReferenceCollectionField(field) && field.advancedParticipant?.role === 'profile'
}

function getReferenceSectionTitle(section: FeatureEditorFormSection) {
  const participantRole = section.fields.find((field) => field.advancedParticipant)?.advancedParticipant?.role

  if (participantRole === 'profile') {
    return 'Profile'
  }

  return section.title
}

function isOutputField(field: FeatureEditorFormField) {
  return field.label === 'Operation' || field.id.endsWith('-operation') || field.id.endsWith('-operation-intent')
    || field.id.endsWith('-target-bodies')
}

function isEmptyDiagnosticsSection(section: FeatureEditorFormSection) {
  return section.fields.every((field) => field.kind === 'diagnostics' && field.diagnostics.length === 0)
}

function getVisualFormSections(sections: readonly FeatureEditorFormSection[]): VisualFormSection[] {
  return sections.flatMap((section) => {
    if (isEmptyDiagnosticsSection(section)) {
      return []
    }

    if (section.id === 'references') {
      const selectedCount = getSectionSelectedCount(section.fields)
      const isProfileSection = section.fields.some(isProfileReferenceCollectionField)
      return [{
        id: section.id,
        title: getReferenceSectionTitle(section),
        hint: !isProfileSection && selectedCount > 0 ? `${selectedCount} selected` : undefined,
        fields: section.fields,
      }]
    }

    if (section.id === 'parameters') {
      const geometryFields = section.fields.filter((field) => !isOutputField(field))
      const outputFields = section.fields.filter(isOutputField)
      return [
        ...(geometryFields.length > 0 ? [{ id: `${section.id}-geometry`, title: 'Geometry', fields: geometryFields }] : []),
        ...(outputFields.length > 0 ? [{ id: `${section.id}-output`, title: 'Output', fields: outputFields }] : []),
      ]
    }

    return [{ id: section.id, title: section.title, fields: section.fields }]
  })
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
      size={28}
      styles={compactActionIconStyles({ active: props.active })}
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
    <div className="flex items-center gap-1">
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
          className="h-7 rounded-[3px] pr-16"
          styles={compactInputStyles({ hasError: props.hasError })}
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
        size={28}
        styles={compactActionIconStyles({ danger: true })}
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

  const rowStyle = fieldSurfaceStyle({ error: fieldError }, activeExpression || editingExpression)

  return (
    <section className="space-y-1">
      <div
        className="flex min-h-7 items-stretch rounded-[3px] transition-colors hover:bg-[var(--workbench-shell-overlay)]"
        style={rowStyle}
      >
        <label
          className="flex w-[88px] shrink-0 items-center pl-2 pr-2 text-[11px] font-medium text-[var(--workbench-shell-text-dim)]"
          htmlFor={editingExpression ? `${props.field.id}-expression` : props.field.id}
        >
          {compactFieldLabel(props.field.label)}
        </label>

        {editingExpression ? (
          <div className="min-w-0 flex-1 py-0">
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
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      <div className="px-2">
        <FieldMessage helper={formatParticipantHelper(props.field)} error={fieldError} />
      </div>
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
          size={28}
          styles={compactActionIconStyles({ active: !isForward })}
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
        <div className="flex min-w-0 items-center">
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
              className="h-7 rounded-[3px]"
              styles={compactInputStyles({ disabled, hasError })}
            />
          </div>
          {getNumericUnit(props.field) ? (
            <span className="flex h-7 items-center px-1 font-mono text-[10.5px] text-[var(--workbench-shell-text-dim)]">
              {getNumericUnit(props.field)}
            </span>
          ) : null}
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
      renderControl={({ id, value, disabled, hasError, onBlur, onLiteralChange }) => (
        <Select
          id={id}
          aria-label={props.field.label}
          aria-invalid={hasError || undefined}
          data={props.field.options.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          value={value}
          disabled={disabled}
          onBlur={onBlur}
          onChange={(nextValue) => {
            if (nextValue !== null) {
              onLiteralChange(nextValue)
            }
          }}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
          styles={compactSelectStyles({ disabled })}
        />
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
  const surfaceStyle = fieldSurfaceStyle({ error: props.error }, props.isActive)
  const className = 'w-full rounded-[3px] px-2 py-1.5 text-left transition hover:bg-[var(--workbench-shell-overlay)]'
  const labelContent = (
    <div className="flex min-h-6 min-w-0 items-center gap-2">
      <p className="w-[88px] shrink-0 truncate text-[11px] font-medium text-[var(--workbench-shell-text-dim)]">
        {compactFieldLabel(props.title)}
      </p>
      <p className={`min-w-0 flex-1 truncate text-[12.5px] ${props.error ? 'text-[var(--workbench-shell-danger-text)]' : props.isActive ? 'text-[var(--mantine-color-workbench-4)]' : 'text-[var(--mantine-color-dark-0)]'}`}>
        {props.value}
      </p>
    </div>
  )

  if (props.onActivate) {
    return (
      <Paper className={className} style={surfaceStyle}>
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
              variant="subtle"
              color="gray"
              size={24}
              styles={compactActionIconStyles()}
            >
              <WorkbenchIcon name="close" className="h-3.5 w-3.5" />
            </ActionIcon>
          ) : null}
        </div>
        <div className="mt-1 px-2">
          <FieldMessage helper={props.helper} error={props.error} />
        </div>
      </Paper>
    )
  }

  return (
    <Paper className={className} style={surfaceStyle}>
      <div className="flex items-start justify-between gap-2">
        <div>{labelContent}</div>
        {props.onClear ? (
          <ActionIcon
            component="button"
            onClick={props.onClear}
            disabled={props.clearDisabled}
            aria-label={`Clear ${props.title}`}
            variant="subtle"
            color="gray"
            size={24}
            styles={compactActionIconStyles()}
          >
            <WorkbenchIcon name="close" className="h-3.5 w-3.5" />
          </ActionIcon>
        ) : null}
      </div>
      <div className="mt-1 px-2">
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

        const isProfileCollection = props.field.advancedParticipant?.role === 'profile'

        if (isProfileCollection) {
          return (
            <div>
              {hasSelection ? (
                <div className="space-y-1">
                  {selected.map((target) => (
                    <div
                      key={getPrimitiveRefLabel(target)}
                      className="flex min-h-7 items-center justify-between gap-2 rounded-[3px] px-2"
                      style={{ background: 'var(--workbench-shell-overlay)' }}
                    >
                      <span className="min-w-0 truncate text-[12px] text-[var(--mantine-color-dark-0)]">
                        {getPrimitiveRefLabel(target)}
                      </span>
                      <ActionIcon
                        component="button"
                        onClick={() => {
                          field.onChange(selected.filter((entry) => !primitiveRefEquals(entry, target)))
                          props.onPatch(createFeatureEditorRemoveReferenceItemPatch(props.field, target))
                        }}
                        aria-label={`Remove ${getPrimitiveRefLabel(target)}`}
                        variant="default"
                        color="red"
                        size={22}
                        styles={compactActionIconStyles()}
                      >
                        <WorkbenchIcon name="close" className="h-3 w-3" />
                      </ActionIcon>
                    </div>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={props.onActivate}
                className="mt-1 flex h-6 w-full items-center justify-center rounded-[3px] text-[11px] text-[var(--workbench-shell-text-muted)] transition-colors hover:bg-[var(--workbench-shell-overlay)]"
                aria-pressed={props.isActive}
              >
                + Add Profile
              </button>
              {props.field.error ? (
                <div className="mt-1 px-1">
                  <FieldMessage error={props.field.error} />
                </div>
              ) : null}
            </div>
          )
        }

        return (
          <Paper
            className="rounded-[3px] px-2 py-1.5 transition-colors hover:bg-[var(--workbench-shell-overlay)]"
            style={fieldSurfaceStyle(props.field, props.isActive)}
          >
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={props.onActivate}
                className="min-w-0 flex-1 text-left"
                aria-pressed={props.isActive}
              >
                <p className="sr-only">{props.field.label}</p>
                <p className={`min-h-6 truncate text-[12.5px] leading-6 ${props.isActive ? 'text-[var(--mantine-color-workbench-4)]' : 'text-[var(--mantine-color-dark-0)]'}`}>
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
                size={24}
                styles={compactActionIconStyles()}
              >
                <WorkbenchIcon name="close" className="h-3.5 w-3.5" />
              </ActionIcon>
            </div>
            {hasSelection ? (
              <div className="mt-1 space-y-1">
                {selected.map((target) => (
                  <div
                    key={getPrimitiveRefLabel(target)}
                    className="flex min-h-7 items-center justify-between gap-2 rounded-[3px] px-2"
                    style={{ background: 'var(--workbench-shell-overlay)' }}
                  >
                    <span className="min-w-0 truncate text-[12px] text-[var(--mantine-color-dark-0)]">
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
                              size={22}
                              styles={compactActionIconStyles()}
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
                              size={22}
                              styles={compactActionIconStyles()}
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
                          size={22}
                          styles={compactActionIconStyles()}
                        >
                          <WorkbenchIcon name="close" className="h-3 w-3" />
                        </ActionIcon>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={props.onActivate}
              className="mt-1 flex h-6 w-full items-center justify-center rounded-[3px] text-[11px] text-[var(--workbench-shell-text-muted)] transition-colors hover:bg-[var(--workbench-shell-overlay)]"
            >
              + Pick from viewport
            </button>
            <div className="mt-1 px-1">
              <FieldMessage helper={formatParticipantHelper(props.field)} error={props.field.error} />
            </div>
          </Paper>
        )
      }}
    />
  )
}

export function FeatureFormFieldRenderer(props: {
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
    case 'optionGroup':
      return (
        <div className="space-y-1 rounded-[3px] px-2 py-1.5" style={{ background: 'var(--workbench-shell-overlay-soft)' }}>
          <p className={SECTION_HEADER_CLASSES}>
            {props.field.label}
          </p>
          <FieldMessage helper={formatParticipantHelper(props.field)} error={props.field.error} />
          {props.field.fields.map((field) => (
            <FeatureFormFieldRenderer
              key={field.id}
              control={props.control}
              field={field}
              documentVariables={props.documentVariables}
              activeReferencePickerFieldId={props.activeReferencePickerFieldId}
              onReferencePickerActivate={props.onReferencePickerActivate}
              onPatch={props.onPatch}
            />
          ))}
        </div>
      )
    case 'discriminatedOptionGroup': {
      const field = props.field
      const variants = field.showInactiveFields
        ? field.variants
        : field.variants.filter((variant) => variant.value === field.discriminant.value)

      return (
        <div className="space-y-1 rounded-[3px] px-2 py-1.5" style={{ background: 'var(--workbench-shell-overlay-soft)' }}>
          <p className={SECTION_HEADER_CLASSES}>
            {field.label}
          </p>
          <FieldMessage helper={formatParticipantHelper(field)} error={field.error} />
          <FeatureFormFieldRenderer
            control={props.control}
            field={field.discriminant}
            documentVariables={props.documentVariables}
            activeReferencePickerFieldId={props.activeReferencePickerFieldId}
            onReferencePickerActivate={props.onReferencePickerActivate}
            onPatch={props.onPatch}
          />
          {variants.map((variant) => (
            <div key={variant.value} className="space-y-1">
              {field.showInactiveFields ? (
                <p className="text-[11px] text-[var(--mantine-color-dark-2)]">{variant.label}</p>
              ) : null}
              {variant.fields.map((field) => (
                <FeatureFormFieldRenderer
                  key={field.id}
                  control={props.control}
                  field={field}
                  documentVariables={props.documentVariables}
                  activeReferencePickerFieldId={props.activeReferencePickerFieldId}
                  onReferencePickerActivate={props.onReferencePickerActivate}
                  onPatch={props.onPatch}
                />
              ))}
            </div>
          ))}
        </div>
      )
    }
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
  const documentVariables = editor.state.snapshot?.document?.variables ?? []
  const initialFormValues = formSchema ? createFeatureEditorFormValues(formSchema) : {}
  const form = useForm<FeatureEditorFormValues>({ defaultValues: initialFormValues })
  useFeatureEditorFormSync({ sessionKey: activeCommandSessionId, formSchema, form })

  if (!activeEditSession || !formSchema) {
    return null
  }

  const title =
    activeEditSession.mode === 'edit'
      ? featureSnapshot?.label ?? activeEditSession.featureId ?? `Edit ${activeEditSession.featureType}`
      : `Create ${activeEditSession.featureType[0]!.toUpperCase()}${activeEditSession.featureType.slice(1)}`

  const featureIdShortCode = activeEditSession.mode === 'edit' && activeEditSession.featureId
    ? `F${activeEditSession.featureId.slice(-2).toUpperCase()}`
    : null
  const visualSections = getVisualFormSections(formSchema.sections)

  return (
    <Paper
      component="aside"
      className="flex max-h-[70vh] w-[320px] min-w-0 max-w-full flex-col overflow-hidden rounded-[6px]"
      style={{
        background: 'var(--workbench-shell-surface-panel-elev)',
        boxShadow: 'var(--workbench-shell-elevation-md)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header className="px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
            style={{ background: 'var(--workbench-shell-accent-surface)', color: 'var(--workbench-shell-accent)' }}
          >
            <WorkbenchIcon name="layers" className="h-3.5 w-3.5" />
          </span>
          <Text size="13px" fw={500} c="dark.0" className="min-w-0 flex-1 truncate">{title}</Text>
          {featureIdShortCode ? (
            <Text size="11px" ff="monospace" c="dimmed" className="shrink-0">{featureIdShortCode}</Text>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-1">
        {visualSections.map((section) => {
          const profileReferenceField = section.fields.find(isProfileReferenceCollectionField)
          const hasProfileSelection = (profileReferenceField?.value.length ?? 0) > 0

          return (
            <section key={section.id} className="pb-1">
              <div className="flex items-center justify-between px-3 pb-1 pt-3">
                <p className={SECTION_HEADER_CLASSES}>
                  {section.title}
                </p>
                {profileReferenceField ? (
                  <button
                    type="button"
                    onClick={() => {
                      form.setValue(profileReferenceField.id, [])
                      onPatch(createFeatureEditorClearReferencePatch(profileReferenceField))
                    }}
                    disabled={!hasProfileSelection}
                    aria-label={`Clear ${profileReferenceField.label}`}
                    className="rounded-[3px] px-1.5 py-0.5 text-[10px] font-medium text-[var(--workbench-shell-text-muted)] transition-colors enabled:hover:bg-[var(--workbench-shell-overlay)] disabled:opacity-40"
                  >
                    Clear
                  </button>
                ) : section.hint ? (
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
                    documentVariables={documentVariables}
                    activeReferencePickerFieldId={activeReferencePickerFieldId}
                    onReferencePickerActivate={(fieldId) => dispatch({ type: 'form.referencePickerActivated', fieldId })}
                    onPatch={onPatch}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      <footer className="flex items-center gap-2 px-3 py-2.5">
        <span
          className="flex items-center gap-1.5 text-[10px] font-mono"
          style={{ color: 'var(--workbench-shell-success)' }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
          idle
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          onClick={onCancel}
          variant="subtle"
          color="gray"
          size="xs"
          styles={{
            root: {
              color: 'var(--workbench-shell-text-muted)',
            },
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onCommit}
          size="xs"
          styles={{
            root: {
              backgroundColor: 'var(--workbench-shell-accent)',
              color: 'var(--mantine-color-dark-9)',
            },
          }}
        >
          Commit
        </Button>
      </footer>
    </Paper>
  )
}
