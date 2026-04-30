import type { FeatureEditorFormField, FeatureEditorPatch } from '@/core/feature-authoring/form-schema'
import { primitiveRefEquals, type PrimitiveRef } from '@/core/editor/schema'
import { createLiteralAuthoredValue, isLiteralAuthoredValue } from '@/contracts/modeling/authored-values'

type FeatureEditorPatchableField = Extract<FeatureEditorFormField, { kind: 'numeric' | 'enum' | 'referencePicker' | 'referenceCollection' }>
type FeatureEditorReferenceField = Extract<FeatureEditorFormField, { kind: 'referencePicker' | 'referenceCollection' }>

export function createFeatureEditorFieldPatch(
  field: FeatureEditorPatchableField,
  value: unknown,
): FeatureEditorPatch {
  const nextValue = field.kind === 'numeric' && field.input === 'angleDegrees' && isLiteralAuthoredValue(value)
    ? createLiteralAuthoredValue(
        typeof value.value === 'number' ? value.value * (Math.PI / 180) : value.value,
      )
    : field.kind === 'numeric' && field.input === 'angleDegrees' && typeof value === 'number'
      ? value * (Math.PI / 180)
      : value

  if (field.patch.valuePath) {
    return createNestedPatch(field.patch.patchKey, field.patch.valuePath, nextValue)
  }

  return { [field.patch.patchKey]: nextValue }
}

function createNestedPatch(
  patchKey: string,
  valuePath: readonly (string | number)[],
  value: unknown,
): FeatureEditorPatch {
  if (valuePath.length === 0) {
    return { [patchKey]: value }
  }

  const root: Record<string, unknown> = {}
  let current = root
  for (const segment of valuePath.slice(0, -1)) {
    const next: Record<string, unknown> = {}
    current[String(segment)] = next
    current = next
  }

  current[String(valuePath[valuePath.length - 1])] = value
  return { [patchKey]: root }
}

function getReferenceArray(field: FeatureEditorReferenceField) {
  return field.kind === 'referenceCollection'
    ? field.value
    : field.value
      ? [field.value]
      : []
}

export function createFeatureEditorReferenceSelectionPatch(
  field: FeatureEditorReferenceField,
  target: PrimitiveRef,
): FeatureEditorPatch {
  const role = field.advancedParticipant?.role

  if (!field.picker.allowsMultiple) {
    return role
      ? { participantRole: role, [field.patch.patchKey]: target }
      : createFeatureEditorFieldPatch(field, target)
  }

  if (field.picker.mode === 'replace') {
    return role
      ? { participantRole: role, [field.patch.patchKey]: [target] }
      : createFeatureEditorFieldPatch(field, [target])
  }

  const current = getReferenceArray(field)
  const next = current.some((entry) => primitiveRefEquals(entry, target))
    ? current
    : [...current, target]

  return role
    ? { participantRole: role, [field.patch.patchKey]: next }
    : createFeatureEditorFieldPatch(field, next)
}

export function createFeatureEditorClearReferencePatch(field: FeatureEditorReferenceField): FeatureEditorPatch {
  return createFeatureEditorFieldPatch(field, field.picker.allowsMultiple ? [] : null)
}

export function createFeatureEditorRemoveReferenceItemPatch(
  field: FeatureEditorReferenceField,
  target: PrimitiveRef,
): FeatureEditorPatch {
  const next = getReferenceArray(field).filter((entry) => !primitiveRefEquals(entry, target))
  return createFeatureEditorFieldPatch(field, next)
}
