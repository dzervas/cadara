import { primitiveRefEquals, type PrimitiveRef } from '@/domain/editor/schema'
import { createExpressionAuthoredValue, isExpressionAuthoredValue } from '@/contracts/modeling/authored-values'
import type { DocumentVariableRecord } from '@/contracts/modeling/schema'
import { previewFeatureValueExpression } from '@/domain/modeling/feature-value-expressions'

import { createFeatureEditorFieldPatch } from '@/domain/feature-authoring/form-events'
import type {
  FeatureEditorFormField,
  FeatureEditorFormSchema,
  FeatureEditorPatch,
} from '@/domain/feature-authoring/form-schema'

type FeatureEditorPatchableField = Extract<
  FeatureEditorFormField,
  { kind: 'numeric' | 'enum' | 'referencePicker' | 'referenceCollection' }
>

export type FeatureEditorExpressionField = Extract<FeatureEditorFormField, { kind: 'numeric' | 'enum' }>

export interface FeatureEditorControlFormValue {
  formValueKind: 'featureEditorControl'
  source: 'literal' | 'expression'
  value: string
  expressionText: string | null
}

export type FeatureEditorExpressionPreview =
  | { ok: true; value: unknown; formValue: string; displayText: string }
  | { ok: false; message: string }

export type FeatureEditorFormValue = FeatureEditorControlFormValue | string | PrimitiveRef | PrimitiveRef[] | null

export type FeatureEditorFormValues = Record<string, FeatureEditorFormValue>

export function getFeatureEditorInputFields(schema: FeatureEditorFormSchema): FeatureEditorPatchableField[] {
  return schema.sections.flatMap((section) => section.fields.flatMap(getFeatureEditorInputFieldsFromField))
}

export function createFeatureEditorFormValues(schema: FeatureEditorFormSchema): FeatureEditorFormValues {
  const values: FeatureEditorFormValues = {}

  for (const field of getFeatureEditorInputFields(schema)) {
    values[field.id] = getFeatureEditorFieldValue(field)
  }

  return values
}

export function normalizeFeatureEditorFormValues(
  schema: FeatureEditorFormSchema,
  values: Record<string, unknown>,
): FeatureEditorFormValues {
  const normalized: FeatureEditorFormValues = {}

  for (const field of getFeatureEditorInputFields(schema)) {
    normalized[field.id] = normalizeFeatureEditorFieldValue(field, values[field.id])
  }

  return normalized
}

export function featureEditorFormValuesEqual(
  schema: FeatureEditorFormSchema,
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const normalizedLeft = normalizeFeatureEditorFormValues(schema, left)
  const normalizedRight = normalizeFeatureEditorFormValues(schema, right)

  for (const field of getFeatureEditorInputFields(schema)) {
    const leftValue = normalizedLeft[field.id]
    const rightValue = normalizedRight[field.id]

    if (field.kind === 'numeric') {
      if (!controlFormValuesEqual(field, leftValue, rightValue)) {
        return false
      }

      continue
    }

    if (field.kind === 'enum') {
      if (!controlFormValuesEqual(field, leftValue, rightValue)) {
        return false
      }

      continue
    }

    if (field.kind === 'referencePicker') {
      if (!referenceFormValuesEqual(leftValue, rightValue)) {
        return false
      }

      continue
    }

    if (!referenceCollectionFormValuesEqual(leftValue, rightValue)) {
      return false
    }
  }

  return true
}

export function shouldResetFeatureEditorFormValues(input: {
  schema: FeatureEditorFormSchema
  sessionKey: string
  lastSessionKey: string | null
  currentValues: Record<string, unknown>
  lastSyncedValues: Record<string, unknown>
  nextValues: Record<string, unknown>
}): boolean {
  if (input.sessionKey !== input.lastSessionKey) {
    return true
  }

  if (featureEditorFormValuesEqual(input.schema, input.nextValues, input.lastSyncedValues)) {
    return false
  }

  return !featureEditorFormValuesEqual(input.schema, input.currentValues, input.nextValues)
}

export function createFeatureEditorPatchFromFormValue(
  field: FeatureEditorPatchableField,
  value: unknown,
): FeatureEditorPatch | null {
  switch (field.kind) {
    case 'numeric': {
      const controlValue = normalizeControlFormValue(field, value)
      if (controlValue.source === 'expression') {
        return createFeatureEditorPatchFromExpression(field, controlValue.expressionText ?? '')
      }

      const parsed = parseNumericFormValue(controlValue.value)
      if (parsed !== null) {
        return createFeatureEditorFieldPatch(field, parsed)
      }

      return null
    }
    case 'enum': {
      const controlValue = normalizeControlFormValue(field, value)
      if (controlValue.source === 'expression') {
        return createFeatureEditorPatchFromExpression(field, controlValue.expressionText ?? '')
      }

      return createFeatureEditorFieldPatch(field, controlValue.value)
    }
    case 'referencePicker':
      return createFeatureEditorFieldPatch(field, normalizeReferenceFormValue(value))
    case 'referenceCollection':
      return createFeatureEditorFieldPatch(field, normalizeReferenceCollectionFormValue(value))
  }
}

export function createFeatureEditorPatchFromExpression(
  field: FeatureEditorExpressionField,
  expressionText: string,
): FeatureEditorPatch | null {
  const trimmed = expressionText.trim()
  return trimmed.length > 0
    ? createFeatureEditorFieldPatch(field, createExpressionAuthoredValue(trimmed))
    : null
}

export function createFeatureEditorLiteralControlFormValue(
  value: string,
): FeatureEditorControlFormValue {
  return {
    formValueKind: 'featureEditorControl',
    source: 'literal',
    value,
    expressionText: null,
  }
}

export function createFeatureEditorExpressionControlFormValue(
  value: string,
  expressionText: string,
): FeatureEditorControlFormValue {
  return {
    formValueKind: 'featureEditorControl',
    source: 'expression',
    value,
    expressionText,
  }
}

export function getFeatureEditorControlFormValueText(value: unknown): string {
  return isFeatureEditorControlFormValue(value)
    ? value.value
    : typeof value === 'string'
      ? value
      : typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : ''
}

export function getFeatureEditorExpressionSourceState(
  field: FeatureEditorExpressionField,
  value: unknown,
): FeatureEditorControlFormValue | null {
  return field.authoredValue?.expressionCapable ? normalizeControlFormValue(field, value) : null
}

export function previewFeatureEditorFieldExpression(input: {
  field: FeatureEditorExpressionField
  expressionText: string
  variables: readonly DocumentVariableRecord[]
}): FeatureEditorExpressionPreview {
  const preview = previewFeatureValueExpression({
    expressionText: input.expressionText,
    label: input.field.label,
    valueKind: input.field.authoredValue?.valueKind ?? { kind: 'string' },
    variables: input.variables,
  })

  if (!preview.ok) {
    return { ok: false, message: preview.diagnostic.message }
  }

  const formValue = formatResolvedExpressionFormValue(input.field, preview.value)
  return {
    ok: true,
    value: preview.value,
    formValue,
    displayText: formValue,
  }
}

function getFeatureEditorFieldValue(field: FeatureEditorPatchableField): FeatureEditorFormValue {
  switch (field.kind) {
    case 'numeric':
      return createControlFormValue(field, String(field.value))
    case 'enum':
      return createControlFormValue(field, field.value)
    case 'referencePicker':
      return field.value
    case 'referenceCollection':
      return [...field.value]
  }
}

function normalizeFeatureEditorFieldValue(
  field: FeatureEditorPatchableField,
  value: unknown,
): FeatureEditorFormValue {
  switch (field.kind) {
    case 'numeric':
      return normalizeControlFormValue(field, value)
    case 'enum':
      return normalizeControlFormValue(field, value)
    case 'referencePicker':
      return normalizeReferenceFormValue(value)
    case 'referenceCollection':
      return normalizeReferenceCollectionFormValue(value)
  }
}

function createControlFormValue(
  field: FeatureEditorExpressionField,
  value: string,
): FeatureEditorControlFormValue {
  const source = field.authoredValue?.source === 'expression' ? 'expression' : 'literal'
  const expressionText = source === 'expression'
    ? field.authoredValue?.expressionText ?? value
    : null

  return {
    formValueKind: 'featureEditorControl',
    source,
    value,
    expressionText,
  }
}

function normalizeControlFormValue(
  field: FeatureEditorExpressionField,
  value: unknown,
): FeatureEditorControlFormValue {
  if (isFeatureEditorControlFormValue(value)) {
    return {
      formValueKind: 'featureEditorControl',
      source: value.source,
      value: value.value,
      expressionText: value.source === 'expression' ? value.expressionText ?? value.value : null,
    }
  }

  if (isExpressionAuthoredValue(value)) {
    return createFeatureEditorExpressionControlFormValue(value.valueText, value.valueText)
  }

  if (typeof value === 'string') {
    return createFeatureEditorLiteralControlFormValue(value)
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return createFeatureEditorLiteralControlFormValue(String(value))
  }

  return createControlFormValue(field, field.kind === 'numeric' ? String(field.value) : field.value)
}

function isFeatureEditorControlFormValue(value: unknown): value is FeatureEditorControlFormValue {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as { formValueKind?: unknown }).formValueKind === 'featureEditorControl'
    && ((value as { source?: unknown }).source === 'literal' || (value as { source?: unknown }).source === 'expression')
    && typeof (value as { value?: unknown }).value === 'string'
  )
}

function parseNumericFormValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function numericFormValuesEqual(left: FeatureEditorFormValue, right: FeatureEditorFormValue): boolean {
  const leftText = getFeatureEditorControlFormValueText(left)
  const rightText = getFeatureEditorControlFormValueText(right)

  if (leftText.length === 0 || rightText.length === 0) {
    return leftText === rightText
  }

  const leftNumber = parseNumericFormValue(leftText)
  const rightNumber = parseNumericFormValue(rightText)

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber
  }

  return leftText === rightText
}

function controlFormValuesEqual(
  field: FeatureEditorExpressionField,
  left: FeatureEditorFormValue,
  right: FeatureEditorFormValue,
): boolean {
  const leftValue = normalizeControlFormValue(field, left)
  const rightValue = normalizeControlFormValue(field, right)

  if (leftValue.source !== rightValue.source) {
    return false
  }

  if (leftValue.source === 'expression') {
    return leftValue.expressionText === rightValue.expressionText
  }

  return field.kind === 'numeric'
    ? numericFormValuesEqual(leftValue, rightValue)
    : leftValue.value === rightValue.value
}

function formatResolvedExpressionFormValue(field: FeatureEditorExpressionField, value: unknown): string {
  if (field.kind === 'numeric') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return ''
    }

    return String(field.input === 'angleDegrees' ? value * (180 / Math.PI) : value)
  }

  return typeof value === 'string' ? value : ''
}

function normalizeReferenceFormValue(value: unknown): PrimitiveRef | null {
  return isPrimitiveRef(value) ? value : null
}

function normalizeReferenceCollectionFormValue(value: unknown): PrimitiveRef[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isPrimitiveRef)
}

function referenceFormValuesEqual(left: FeatureEditorFormValue, right: FeatureEditorFormValue): boolean {
  if (left === null || right === null) {
    return left === right
  }

  return isPrimitiveRef(left) && isPrimitiveRef(right) && primitiveRefEquals(left, right)
}

function referenceCollectionFormValuesEqual(left: FeatureEditorFormValue, right: FeatureEditorFormValue): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false
  }

  return left.every((entry, index) => primitiveRefEquals(entry, right[index]!))
}

function isPrimitiveRef(value: unknown): value is PrimitiveRef {
  return !!value && typeof value === 'object' && 'kind' in value
}

function getFeatureEditorInputFieldsFromField(field: FeatureEditorFormField): FeatureEditorPatchableField[] {
  switch (field.kind) {
    case 'numeric':
    case 'enum':
    case 'referencePicker':
    case 'referenceCollection':
      return [field]
    case 'optionGroup':
      return field.fields.flatMap(getFeatureEditorInputFieldsFromField)
    case 'discriminatedOptionGroup': {
      const activeVariant = field.variants.find((variant) => variant.value === field.discriminant.value)
      const variantFields = field.showInactiveFields
        ? field.variants.flatMap((variant) => variant.fields)
        : activeVariant?.fields ?? []

      return [
        field.discriminant,
        ...variantFields.flatMap(getFeatureEditorInputFieldsFromField),
      ]
    }
    case 'summary':
    case 'diagnostics':
    case 'custom':
      return []
  }
}
