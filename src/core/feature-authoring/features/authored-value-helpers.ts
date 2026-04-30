import {
  getAuthoredFormText,
  getAuthoredLiteralValue,
  isAuthoredValue,
  isExpressionAuthoredValue,
  type FeatureValueKindDescriptor,
  type MaybeAuthoredValue,
} from '@/contracts/modeling/authored-values'
import type { FeatureEditorAuthoredValueBinding } from '@/core/feature-authoring/form-schema'

export function acceptAuthoredPatch<T>(
  value: unknown,
  current: MaybeAuthoredValue<T>,
  isLiteral: (value: unknown) => value is T,
): MaybeAuthoredValue<T> {
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

export function isFiniteAuthoredNumber(value: MaybeAuthoredValue<number>) {
  return isExpressionAuthoredValue(value) || authoredNumberLiteral(value) !== null
}
