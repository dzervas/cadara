import { primitiveRefEquals, type PrimitiveRef } from '@/domain/editor/schema'
import { createExpressionAuthoredValue, isExpressionAuthoredValue } from '@/contracts/modeling/authored-values'

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

export type FeatureEditorFormValue = string | PrimitiveRef | PrimitiveRef[] | null

export type FeatureEditorFormValues = Record<string, FeatureEditorFormValue>

export function getFeatureEditorInputFields(schema: FeatureEditorFormSchema): FeatureEditorPatchableField[] {
  return schema.sections.flatMap((section) =>
    section.fields.filter((field): field is FeatureEditorPatchableField =>
      field.kind === 'numeric'
      || field.kind === 'enum'
      || field.kind === 'referencePicker'
      || field.kind === 'referenceCollection',
    ),
  )
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
      if (!numericFormValuesEqual(leftValue, rightValue)) {
        return false
      }

      continue
    }

    if (field.kind === 'enum') {
      if (leftValue !== rightValue) {
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
      const parsed = parseNumericFormValue(value)
      if (parsed !== null) {
        return createFeatureEditorFieldPatch(field, parsed)
      }

      if (field.authoredValue?.expressionCapable && typeof value === 'string' && value.trim().length > 0) {
        return createFeatureEditorFieldPatch(field, createExpressionAuthoredValue(value.trim()))
      }

      return null
    }
    case 'enum':
      if (typeof value === 'string') {
        const literal = field.options.some((option) => option.value === value)
        return createFeatureEditorFieldPatch(
          field,
          field.authoredValue?.expressionCapable && !literal
            ? createExpressionAuthoredValue(value.trim())
            : value,
        )
      }

      return createFeatureEditorFieldPatch(field, field.value)
    case 'referencePicker':
      return createFeatureEditorFieldPatch(field, normalizeReferenceFormValue(value))
    case 'referenceCollection':
      return createFeatureEditorFieldPatch(field, normalizeReferenceCollectionFormValue(value))
  }
}

function getFeatureEditorFieldValue(field: FeatureEditorPatchableField): FeatureEditorFormValue {
  switch (field.kind) {
    case 'numeric':
      return String(field.value)
    case 'enum':
      return field.value
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
      return normalizeNumericFormValue(value)
    case 'enum':
      return typeof value === 'string' ? value : field.value
    case 'referencePicker':
      return normalizeReferenceFormValue(value)
    case 'referenceCollection':
      return normalizeReferenceCollectionFormValue(value)
  }
}

function normalizeNumericFormValue(value: unknown): string {
  if (isExpressionAuthoredValue(value)) {
    return value.valueText
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return ''
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
  if (typeof left !== 'string' || typeof right !== 'string') {
    return left === right
  }

  const leftNumber = parseNumericFormValue(left)
  const rightNumber = parseNumericFormValue(right)

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber
  }

  return left === right
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
