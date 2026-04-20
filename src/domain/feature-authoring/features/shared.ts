import type { ExtrudeProfileRef, RevolveAxisRef } from '@/contracts/modeling/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import { primitiveRefEquals } from '@/domain/editor/schema'

export {
  buildAdvancedSolidParticipants,
  isAdvancedOperationIntent,
  toFeaturePhaseDiagnostics,
  validateAdvancedSolidDraft,
} from '@/domain/feature-authoring/features/advanced-solid-helpers'
export {
  acceptAuthoredPatch,
  authoredBooleanLiteral,
  authoredDefinitionValue,
  authoredNumberFormValue,
  authoredNumberLiteral,
  authoredStringLiteral,
  expressionCapableAuthoredValue,
  isPositiveAuthoredNumber,
} from '@/domain/feature-authoring/features/authored-value-helpers'
export {
  createAdvancedOperationIntentFields,
  createBooleanOperationFields,
  createReferenceCollectionField,
} from '@/domain/feature-authoring/features/form-field-factories'

export function asExtrudeProfileRef(value: PrimitiveRef | null): ExtrudeProfileRef | null {
  if (!value) {
    return null
  }

  switch (value.kind) {
    case 'region':
    case 'face':
      return value
    default:
      return null
  }
}

export function asRevolveAxisRef(value: PrimitiveRef | null): RevolveAxisRef | null {
  if (!value) {
    return null
  }

  switch (value.kind) {
    case 'edge':
    case 'construction':
      return value
    default:
      return null
  }
}

export function asBodyRef(value: PrimitiveRef | null): Extract<PrimitiveRef, { kind: 'body' }> | null {
  return value?.kind === 'body' ? value : null
}

export function asFaceRef(value: PrimitiveRef | null): Extract<PrimitiveRef, { kind: 'face' }> | null {
  return value?.kind === 'face' ? value : null
}

export function asEdgeRef(value: PrimitiveRef | null): Extract<PrimitiveRef, { kind: 'edge' }> | null {
  return value?.kind === 'edge' ? value : null
}

export function asSweepPathRef(value: PrimitiveRef | null): Extract<PrimitiveRef, { kind: 'edge' | 'sketchEntity' }> | null {
  return value?.kind === 'edge' || value?.kind === 'sketchEntity' ? value : null
}

export function asPlaneReferenceTarget(
  value: PrimitiveRef | null,
): Extract<PrimitiveRef, { kind: 'construction' | 'face' }> | null {
  return value?.kind === 'construction' || value?.kind === 'face' ? value : null
}

export function filterTargets<TTarget extends PrimitiveRef>(
  value: unknown,
  coerce: (target: PrimitiveRef | null) => TTarget | null,
) {
  return Array.isArray(value)
    ? value.filter((entry): entry is TTarget => coerce(entry as PrimitiveRef) !== null)
    : []
}

export function appendUniqueTarget<TTarget extends PrimitiveRef>(
  current: readonly TTarget[],
  target: TTarget,
) {
  return current.some((entry) => primitiveRefEquals(entry, target)) ? current : [...current, target]
}

export function createMissingInputDiagnostic(input: {
  feature: string
  phase: 'preview' | 'commit'
  suffix: string
  message: string
}) {
  return {
    code: `feature-${input.phase}-missing-${input.suffix}`,
    severity: input.phase === 'preview' ? 'warning' as const : 'error' as const,
    message: input.message.replace('preview', input.phase).replace('Preview', input.phase === 'commit' ? 'Commit' : 'Preview'),
    target: null,
    detail: null,
  }
}

