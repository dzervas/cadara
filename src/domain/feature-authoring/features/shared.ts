import type { ExtrudeProfileRef, RevolveAxisRef } from '@/contracts/modeling/schema'
import {
  getAuthoredFormText,
  getAuthoredLiteralValue,
  isAuthoredValue,
  isExpressionAuthoredValue,
  type MaybeAuthoredValue,
  type FeatureValueKindDescriptor,
} from '@/contracts/modeling/authored-values'
import type { FeatureEditorAuthoredValueBinding } from '@/domain/feature-authoring/form-schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import { primitiveRefEquals } from '@/domain/editor/schema'

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

export function acceptAuthoredPatch<T>(value: unknown, current: MaybeAuthoredValue<T>, isLiteral: (value: unknown) => value is T): MaybeAuthoredValue<T> {
  if (isAuthoredValue(value)) {
    return value as MaybeAuthoredValue<T>
  }

  return isLiteral(value) ? value : current
}

export function authoredNumberLiteral(value: MaybeAuthoredValue<number>): number | null {
  const literal = getAuthoredLiteralValue(value)
  return typeof literal === 'number' && Number.isFinite(literal) ? literal : null
}

export function authoredStringLiteral<T extends string>(value: MaybeAuthoredValue<T>, fallback: T): T {
  const literal = getAuthoredLiteralValue(value)
  return typeof literal === 'string' ? literal as T : fallback
}

export function authoredBooleanLiteral(value: MaybeAuthoredValue<boolean>, fallback: boolean): boolean {
  const literal = getAuthoredLiteralValue(value)
  return typeof literal === 'boolean' ? literal : fallback
}

export function authoredDefinitionValue<T>(value: MaybeAuthoredValue<T>, fallback: T): MaybeAuthoredValue<T> {
  return isExpressionAuthoredValue(value) ? value : getAuthoredLiteralValue(value) ?? fallback
}

export function authoredNumberFormValue(value: MaybeAuthoredValue<number>, mapLiteral?: (value: number) => number): string | number {
  return getAuthoredFormText(value, (literal) => String(mapLiteral ? mapLiteral(literal) : literal))
}

export function expressionCapableAuthoredValue(
  value: MaybeAuthoredValue<unknown>,
  valueKind: FeatureValueKindDescriptor,
): FeatureEditorAuthoredValueBinding {
  return {
    expressionCapable: true,
    valueKind,
    source: isExpressionAuthoredValue(value) ? 'expression' : 'literal',
    expressionText: isExpressionAuthoredValue(value) ? value.valueText : null,
  }
}

export function isPositiveAuthoredNumber(value: MaybeAuthoredValue<number>) {
  const literal = authoredNumberLiteral(value)
  return isExpressionAuthoredValue(value) || (literal !== null && literal > 0)
}
