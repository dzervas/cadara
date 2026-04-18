import * as math from 'mathjs'

import type { DocumentVariableRecord, FeatureDefinition, ModelingDiagnostic } from '@/contracts/modeling/schema'
import {
  createExpressionAuthoredValue,
  isAuthoredValue,
  isExpressionAuthoredValue,
  validateFeatureValueKind,
  type FeatureValueKindDescriptor,
} from '@/contracts/modeling/authored-values'
import {
  getFeatureValueExpressionFields,
  type FeatureValueExpressionFieldDescriptor,
} from '@/contracts/modeling/feature-authored-values'
import { createDocumentVariableExpressionDiagnostics, evaluateDocumentVariableExpressions } from '@/domain/modeling/document-variable-expressions'

type MutableRecord = Record<string, unknown>

export type FeatureValueExpressionDiagnosticCode =
  | 'feature-value-expression-invalid-syntax'
  | 'feature-value-expression-unresolved-symbol'
  | 'feature-value-expression-type-mismatch'
  | 'feature-value-expression-non-finite-number'
  | 'feature-value-expression-not-positive'
  | 'feature-value-expression-not-integer'
  | 'feature-value-expression-invalid-enum-value'
  | 'feature-value-expression-evaluation-failed'

export type FeatureValueExpressionResolution =
  | { ok: true; definition: FeatureDefinition }
  | { ok: false; diagnostics: ModelingDiagnostic[] }

export type FeatureValueExpressionPreview =
  | { ok: true; value: unknown }
  | { ok: false; diagnostic: ModelingDiagnostic }

const MATH_GLOBAL_SYMBOLS = new Set(['Infinity', 'NaN'])

export function resolveFeatureDefinitionValues(input: {
  definition: FeatureDefinition
  variables: readonly DocumentVariableRecord[]
}): FeatureValueExpressionResolution {
  const variableEvaluation = evaluateDocumentVariableExpressions(input.variables)
  if (!variableEvaluation.ok) {
    return { ok: false, diagnostics: createDocumentVariableExpressionDiagnostics(variableEvaluation.diagnostics) }
  }

  const resolved = structuredClone(input.definition) as FeatureDefinition
  const diagnostics: ModelingDiagnostic[] = []

  for (const field of getFeatureValueExpressionFields(resolved)) {
    const authoredValue = getPathValue(resolved as unknown as MutableRecord, field.path)

    if (authoredValue === undefined) {
      continue
    }

    const resolution = resolveAuthoredFeatureValue({
      value: authoredValue,
      field,
      variablesByName: variableEvaluation.valuesByName,
    })

    if (resolution.ok) {
      setPathValue(resolved as unknown as MutableRecord, field.path, resolution.value)
    } else {
      diagnostics.push(resolution.diagnostic)
    }
  }

  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, definition: resolved }
}

export function previewFeatureValueExpression(input: {
  expressionText: string
  label: string
  valueKind: FeatureValueKindDescriptor
  variables: readonly DocumentVariableRecord[]
}): FeatureValueExpressionPreview {
  const variableEvaluation = evaluateDocumentVariableExpressions(input.variables)
  if (!variableEvaluation.ok) {
    return {
      ok: false,
      diagnostic: createDocumentVariableExpressionDiagnostics(variableEvaluation.diagnostics)[0] ?? createDiagnostic(
        'feature-value-expression-evaluation-failed',
        `${input.label} could not evaluate document variables.`,
      ),
    }
  }

  return resolveAuthoredFeatureValue({
    value: createExpressionAuthoredValue(input.expressionText),
    field: {
      path: [],
      label: input.label,
      valueKind: input.valueKind,
    },
    variablesByName: variableEvaluation.valuesByName,
  })
}

function resolveAuthoredFeatureValue(input: {
  value: unknown
  field: FeatureValueExpressionFieldDescriptor
  variablesByName: ReadonlyMap<string, number>
}): { ok: true; value: unknown } | { ok: false; diagnostic: ModelingDiagnostic } {
  if (!isExpressionAuthoredValue(input.value)) {
    if (!isAuthoredValue(input.value)) {
      return { ok: true, value: input.value }
    }

    const literalValue = input.value.source === 'literal' ? input.value.value : input.value
    const validation = validateFeatureValueKind(literalValue, input.field.valueKind)

    return validation.ok
      ? { ok: true, value: validation.value }
      : { ok: false, diagnostic: createValueKindDiagnostic(input.field, validation.failure.code, validation.failure.message) }
  }

  const expressionText = input.value.valueText.trim()
  if (expressionText.length === 0) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        'feature-value-expression-invalid-syntax',
        `${input.field.label} expression text is required.`,
      ),
    }
  }

  let node: math.MathNode
  try {
    node = math.parse(expressionText)
  } catch (error) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        'feature-value-expression-invalid-syntax',
        `${input.field.label} has invalid expression syntax: ${formatErrorMessage(error)}.`,
      ),
    }
  }

  const nonValueNode = findNonValueNode(node)
  if (nonValueNode) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        'feature-value-expression-invalid-syntax',
        `${input.field.label} must be a value expression, not ${nonValueNode}.`,
      ),
    }
  }

  for (const symbolName of collectSymbolNames(node)) {
    if (input.variablesByName.has(symbolName) || isKnownMathSymbol(symbolName)) {
      continue
    }

    return {
      ok: false,
      diagnostic: createDiagnostic(
        'feature-value-expression-unresolved-symbol',
        `${input.field.label} references unknown symbol "${symbolName}".`,
      ),
    }
  }

  try {
    const rawValue = node.evaluate(Object.fromEntries(input.variablesByName))
    const validation = validateFeatureValueKind(rawValue, input.field.valueKind)

    return validation.ok
      ? { ok: true, value: validation.value }
      : { ok: false, diagnostic: createValueKindDiagnostic(input.field, validation.failure.code, validation.failure.message) }
  } catch (error) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        'feature-value-expression-evaluation-failed',
        `${input.field.label} could not be evaluated: ${formatErrorMessage(error)}.`,
      ),
    }
  }
}

function createValueKindDiagnostic(
  field: FeatureValueExpressionFieldDescriptor,
  code: ReturnType<typeof validateFeatureValueKind> extends { ok: false; failure: { code: infer TCode } } ? TCode : string,
  message: string,
) {
  const diagnosticCode = `feature-value-expression-${code}` as FeatureValueExpressionDiagnosticCode
  return createDiagnostic(diagnosticCode, `${field.label}: ${message}`)
}

function createDiagnostic(code: FeatureValueExpressionDiagnosticCode, message: string): ModelingDiagnostic {
  return {
    code,
    severity: 'error',
    message,
    target: null,
    detail: null,
  }
}

function getPathValue(value: MutableRecord, path: readonly (string | number)[]) {
  let current: unknown = value
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }

    current = (current as MutableRecord)[segment]
  }

  return current
}

function setPathValue(value: MutableRecord, path: readonly (string | number)[], nextValue: unknown) {
  let current: MutableRecord = value
  for (const segment of path.slice(0, -1)) {
    const child = current[segment]
    if (typeof child !== 'object' || child === null) {
      return
    }

    current = child as MutableRecord
  }

  const last = path.at(-1)
  if (last !== undefined) {
    current[last] = nextValue
  }
}

function findNonValueNode(node: math.MathNode) {
  const nonValueNode = node.filter((candidate) =>
    math.isAssignmentNode(candidate)
    || math.isBlockNode(candidate)
    || math.isFunctionAssignmentNode(candidate),
  )[0]

  return nonValueNode?.type ?? null
}

function collectSymbolNames(node: math.MathNode) {
  return node
    .filter((candidate) => math.isSymbolNode(candidate))
    .map((candidate) => (candidate as math.SymbolNode).name)
}

function isKnownMathSymbol(symbolName: string) {
  return symbolName in math || MATH_GLOBAL_SYMBOLS.has(symbolName)
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}
