import * as math from "mathjs";

import {
  isAuthoredValue,
  isExpressionAuthoredValue,
  validateFeatureValueKind,
  type AuthoredValue,
  type FeatureValueKindDescriptor,
} from "@/contracts/modeling/authored-values";
import type {
  DocumentVariableRecord,
  ModelingDiagnostic,
} from "@/contracts/modeling/schema";
import type {
  DimensionDefinition,
  NumericDimensionDefinition,
  NumericSketchDefinition,
  NumericSketchDerivationDefinition,
  OffsetResolvedSketchDefinition,
  SketchDefinition,
  SketchDerivationDefinition,
} from "@/contracts/sketch/schema";
import {
  isReferenceDimension,
  resolvedReferenceDimension,
} from "@/contracts/sketch/schema";
import {
  evaluateSketchDerivations,
  type SketchDerivationEvaluationResult,
  type SketchDerivationInput,
  type SketchDerivationSettings,
} from "@/contracts/sketch/derived-geometry";
import {
  createDocumentVariableExpressionDiagnostics,
  evaluateDocumentVariableExpressions,
} from "@/core/modeling/document-variable-expressions";

const MATH_GLOBAL_SYMBOLS = new Set(["Infinity", "NaN"]);

export type SketchDimensionExpressionResolution =
  | { ok: true; definition: NumericSketchDefinition }
  | { ok: false; diagnostics: ModelingDiagnostic[] };

const resolvedDistanceViews = new WeakMap<
  SketchDefinition,
  {
    variables: readonly DocumentVariableRecord[];
    view: OffsetResolvedSketchDefinition;
  }
>();

/**
 * T17p3: the resolve boundary of offset distances. Every offset
 * relationship's authored distance becomes a number; one that does not
 * resolve (an expression with an unresolved symbol, or document variables
 * that do not evaluate) becomes `NaN`, which the derivation evaluator reports
 * as the structured unresolved-distance diagnostic while the outputs keep
 * their last resolvable state. Memoized on (definition, variables) identity,
 * so the derivation evaluator's identity cache keeps hitting.
 */
export function resolveSketchDerivationDistances(input: {
  definition: SketchDefinition;
  variables: readonly DocumentVariableRecord[];
}): OffsetResolvedSketchDefinition {
  const cached = resolvedDistanceViews.get(input.definition);
  if (cached && cached.variables === input.variables) return cached.view;

  const { derivedRelationships, ...rest } = input.definition;
  // Document variables are evaluated once, and only for an expression.
  let variablesByName: ReadonlyMap<string, number> | null | undefined;
  const resolveDistance = (
    relationship: Extract<SketchDerivationDefinition, { kind: "offset" }>,
  ) => {
    if (isExpressionAuthoredValue(relationship.distance)) {
      if (variablesByName === undefined) {
        const evaluation = evaluateDocumentVariableExpressions(input.variables);
        variablesByName = evaluation.ok ? evaluation.valuesByName : null;
      }
      if (variablesByName === null) return Number.NaN;
    }
    const resolved = resolveAuthoredNumber({
      value: relationship.distance,
      label: relationship.label,
      valueKind: { kind: "finiteNumber" },
      variablesByName: variablesByName ?? new Map(),
    });
    return resolved.ok ? resolved.value : Number.NaN;
  };
  const view: OffsetResolvedSketchDefinition = derivedRelationships
    ? {
        ...rest,
        derivedRelationships: derivedRelationships.map(
          (relationship): NumericSketchDerivationDefinition =>
            relationship.kind === "offset"
              ? { ...relationship, distance: resolveDistance(relationship) }
              : relationship,
        ),
      }
    : rest;
  resolvedDistanceViews.set(input.definition, {
    variables: input.variables,
    view,
  });
  return view;
}

/**
 * T17p3: derivation settings for an authored definition: τ, the plan hints
 * and the document variables its offset distances resolve against.
 */
export type AuthoredSketchDerivationSettings = SketchDerivationSettings & {
  readonly documentVariables: readonly DocumentVariableRecord[];
};

export type AuthoredSketchDerivationEvaluation = Omit<
  SketchDerivationEvaluationResult<OffsetResolvedSketchDefinition>,
  "definition"
> & { definition: SketchDefinition };

const authoredEvaluations = new WeakMap<
  OffsetResolvedSketchDefinition,
  { authored: SketchDefinition; definition: SketchDefinition }
>();

/**
 * T17p3: derivation of an authored definition. It evaluates the definition's
 * resolved-distance view (`resolveSketchDerivationDistances`) and returns
 * the evaluated points and entities with the authored relationship records,
 * so expression distances survive. The input itself comes back when
 * nothing moved; a repeated evaluation returns the same definition.
 */
export function evaluateAuthoredSketchDerivations(
  input: Omit<SketchDerivationInput, "definition"> &
    AuthoredSketchDerivationSettings & {
      readonly definition: SketchDefinition;
    },
): AuthoredSketchDerivationEvaluation {
  const { definition: authored, documentVariables, ...settings } = input;
  const view = resolveSketchDerivationDistances({
    definition: authored,
    variables: documentVariables,
  });
  const result = evaluateSketchDerivations({ ...settings, definition: view });
  return {
    ...result,
    definition: withAuthoredRelationships(authored, view, result.definition),
  };
}

function withAuthoredRelationships(
  authored: SketchDefinition,
  view: OffsetResolvedSketchDefinition,
  evaluated: OffsetResolvedSketchDefinition,
): SketchDefinition {
  if (evaluated === view) return authored;
  const cached = authoredEvaluations.get(evaluated);
  if (cached?.authored === authored) return cached.definition;
  // Only points and entities moved: an unchanged view is returned above, so
  // the authored definition has relationships here.
  const definition: SketchDefinition = {
    ...evaluated,
    derivedRelationships: authored.derivedRelationships,
  };
  authoredEvaluations.set(evaluated, { authored, definition });
  return definition;
}

export function resolveSketchDimensionValues(input: {
  definition: SketchDefinition;
  variables: readonly DocumentVariableRecord[];
}): SketchDimensionExpressionResolution {
  const variableEvaluation = evaluateDocumentVariableExpressions(input.variables);
  if (!variableEvaluation.ok) {
    return {
      ok: false,
      diagnostics: createDocumentVariableExpressionDiagnostics(
        variableEvaluation.diagnostics,
      ),
    };
  }

  const diagnostics: ModelingDiagnostic[] = [];
  const dimensions: NumericDimensionDefinition[] = [];

  for (const dimension of input.definition.dimensions) {
    const resolved = resolveDimension(dimension, variableEvaluation.valuesByName);
    if (resolved.ok) {
      dimensions.push(resolved.dimension);
    } else {
      diagnostics.push(...resolved.diagnostics);
    }
  }

  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : {
        ok: true,
        definition: {
          ...resolveSketchDerivationDistances(input),
          dimensions,
        },
      };
}

function resolveDimension(
  dimension: DimensionDefinition,
  variablesByName: ReadonlyMap<string, number>,
):
  | { ok: true; dimension: NumericDimensionDefinition }
  | { ok: false; diagnostics: ModelingDiagnostic[] } {
  // T13d (D9): a reference dimension has no value to resolve.
  if (isReferenceDimension(dimension)) {
    return { ok: true, dimension: resolvedReferenceDimension(dimension) };
  }
  switch (dimension.kind) {
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return { ok: true, dimension };
    case "lineAngle": {
      const value = resolveAuthoredNumber({
        value: dimension.valueRadians,
        label: dimension.label,
        valueKind: { kind: "angle" },
        variablesByName,
      });
      return value.ok
        ? { ok: true, dimension: { ...dimension, valueRadians: value.value } }
        : { ok: false, diagnostics: [value.diagnostic] };
    }
    case "horizontalDistance":
    case "verticalDistance": {
      const value = resolveAuthoredNumber({
        value: dimension.value,
        label: dimension.label,
        valueKind: { kind: "finiteNumber" },
        variablesByName,
      });
      return value.ok
        ? { ok: true, dimension: { ...dimension, value: value.value } }
        : { ok: false, diagnostics: [value.diagnostic] };
    }
    default: {
      const value = resolveAuthoredNumber({
        value: dimension.value,
        label: dimension.label,
        valueKind: { kind: "positiveNumber" },
        variablesByName,
      });
      return value.ok
        ? { ok: true, dimension: { ...dimension, value: value.value } }
        : { ok: false, diagnostics: [value.diagnostic] };
    }
  }
}

function resolveAuthoredNumber(input: {
  /**
   * T17p2 (F-2), T17p3: a dimension value or an offset distance; only the
   * authored wrapper resolves (a bare value is never converted).
   */
  value: AuthoredValue<number> | undefined;
  label: string;
  valueKind: FeatureValueKindDescriptor;
  variablesByName: ReadonlyMap<string, number>;
}): { ok: true; value: number } | { ok: false; diagnostic: ModelingDiagnostic } {
  const authoredValue = input.value;
  if (!isAuthoredValue(authoredValue)) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "sketch-dimension-expression-type-mismatch",
        `${input.label}: Value must be a literal or expression authored value.`,
      ),
    };
  }
  if (!isExpressionAuthoredValue(authoredValue)) {
    const validation = validateFeatureValueKind(authoredValue.value, input.valueKind);
    return validation.ok
      ? { ok: true, value: validation.value as number }
      : {
          ok: false,
          diagnostic: createDiagnostic(
            `sketch-dimension-expression-${validation.failure.code}`,
            `${input.label}: ${validation.failure.message}`,
          ),
        };
  }

  const expressionText = authoredValue.valueText.trim();
  if (expressionText.length === 0) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "sketch-dimension-expression-invalid-syntax",
        `${input.label} expression text is required.`,
      ),
    };
  }

  let node: math.MathNode;
  try {
    node = math.parse(expressionText);
  } catch (error) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "sketch-dimension-expression-invalid-syntax",
        `${input.label} has invalid expression syntax: ${formatErrorMessage(error)}.`,
      ),
    };
  }

  const nonValueNode = findNonValueNode(node);
  if (nonValueNode) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "sketch-dimension-expression-invalid-syntax",
        `${input.label} must be a value expression, not ${nonValueNode}.`,
      ),
    };
  }

  for (const symbolName of collectSymbolNames(node)) {
    if (input.variablesByName.has(symbolName) || isKnownMathSymbol(symbolName)) {
      continue;
    }

    return {
      ok: false,
      diagnostic: createDiagnostic(
        "sketch-dimension-expression-unresolved-symbol",
        `${input.label} references unknown symbol "${symbolName}".`,
      ),
    };
  }

  try {
    const rawValue = node.evaluate(Object.fromEntries(input.variablesByName));
    const validation = validateFeatureValueKind(rawValue, input.valueKind);
    return validation.ok
      ? { ok: true, value: validation.value as number }
      : {
          ok: false,
          diagnostic: createDiagnostic(
            `sketch-dimension-expression-${validation.failure.code}`,
            `${input.label}: ${validation.failure.message}`,
          ),
        };
  } catch (error) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "sketch-dimension-expression-evaluation-failed",
        `${input.label} could not be evaluated: ${formatErrorMessage(error)}.`,
      ),
    };
  }
}

function createDiagnostic(code: string, message: string): ModelingDiagnostic {
  return {
    code,
    severity: "error",
    message,
    target: null,
    detail: null,
  };
}

function findNonValueNode(node: math.MathNode) {
  return node.filter(
    (candidate) =>
      math.isAssignmentNode(candidate) ||
      math.isBlockNode(candidate) ||
      math.isFunctionAssignmentNode(candidate),
  )[0]?.type ?? null;
}

function collectSymbolNames(node: math.MathNode) {
  return node
    .filter((candidate) => math.isSymbolNode(candidate))
    .map((candidate) => (candidate as math.SymbolNode).name);
}

function isKnownMathSymbol(symbolName: string) {
  return symbolName in math || MATH_GLOBAL_SYMBOLS.has(symbolName);
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
