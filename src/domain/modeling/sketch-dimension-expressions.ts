import * as math from "mathjs";

import {
  ensureLiteralAuthoredValue,
  isExpressionAuthoredValue,
  validateFeatureValueKind,
  type MaybeAuthoredValue,
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
  SketchDefinition,
} from "@/contracts/sketch/schema";
import {
  createDocumentVariableExpressionDiagnostics,
  evaluateDocumentVariableExpressions,
} from "@/domain/modeling/document-variable-expressions";

const MATH_GLOBAL_SYMBOLS = new Set(["Infinity", "NaN"]);

export type SketchDimensionExpressionResolution =
  | { ok: true; definition: NumericSketchDefinition }
  | { ok: false; diagnostics: ModelingDiagnostic[] };

/**
 * Resolves expression-authored offset derivation distances to numeric
 * literals so derivation evaluation sees concrete values. Best-effort: an
 * unresolvable distance stays authored and the derivation evaluator reports
 * the structured unresolved-distance diagnostic while outputs keep their last
 * resolvable state.
 */
export function resolveSketchDerivationDistances(input: {
  definition: SketchDefinition;
  variables: readonly DocumentVariableRecord[];
}): SketchDefinition {
  const relationships = input.definition.derivedRelationships ?? [];
  if (
    !relationships.some(
      (relationship) =>
        relationship.kind === "offset" &&
        typeof relationship.distance !== "number",
    )
  ) {
    return input.definition;
  }

  const variableEvaluation = evaluateDocumentVariableExpressions(
    input.variables,
  );
  if (!variableEvaluation.ok) {
    return input.definition;
  }

  let changed = false;
  const resolvedRelationships = relationships.map((relationship) => {
    if (
      relationship.kind !== "offset" ||
      typeof relationship.distance === "number"
    ) {
      return relationship;
    }

    const resolved = resolveAuthoredNumber({
      value: relationship.distance,
      label: relationship.label,
      valueKind: { kind: "finiteNumber" },
      variablesByName: variableEvaluation.valuesByName,
    });
    if (!resolved.ok) {
      return relationship;
    }

    changed = true;
    return { ...relationship, distance: resolved.value };
  });

  return changed
    ? { ...input.definition, derivedRelationships: resolvedRelationships }
    : input.definition;
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
  value: MaybeAuthoredValue<number>;
  label: string;
  valueKind: FeatureValueKindDescriptor;
  variablesByName: ReadonlyMap<string, number>;
}): { ok: true; value: number } | { ok: false; diagnostic: ModelingDiagnostic } {
  const authoredValue = ensureLiteralAuthoredValue(input.value);
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
