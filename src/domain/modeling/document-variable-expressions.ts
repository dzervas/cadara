import * as math from "mathjs";

import type {
  DocumentVariableRecord,
  ModelingDiagnostic,
} from "@/contracts/modeling/schema";

const DOCUMENT_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MATH_GLOBAL_SYMBOLS = new Set(["Infinity", "NaN"]);

export type DocumentVariableExpressionDiagnosticCode =
  | "document-variable-invalid-name"
  | "document-variable-duplicate-name"
  | "document-variable-invalid-expression"
  | "document-variable-unresolved-reference"
  | "document-variable-cycle"
  | "document-variable-non-finite-result";

export interface DocumentVariableExpressionDiagnostic {
  code: DocumentVariableExpressionDiagnosticCode;
  variableId: DocumentVariableRecord["variableId"];
  name: string;
  message: string;
}

export type DocumentVariableExpressionEvaluation =
  | {
      ok: true;
      valuesById: ReadonlyMap<DocumentVariableRecord["variableId"], number>;
      valuesByName: ReadonlyMap<string, number>;
      dependenciesByName: ReadonlyMap<string, readonly string[]>;
    }
  | {
      ok: false;
      diagnostics: readonly DocumentVariableExpressionDiagnostic[];
    };

interface ParsedDocumentVariable {
  variable: DocumentVariableRecord;
  node: math.MathNode;
}

export function isValidDocumentVariableName(name: string) {
  return DOCUMENT_VARIABLE_NAME_PATTERN.test(name);
}

export function createDocumentVariableExpressionDiagnostics(
  diagnostics: readonly DocumentVariableExpressionDiagnostic[],
): ModelingDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: "error",
    message: diagnostic.message,
    target: null,
    detail: null,
  }));
}

export function evaluateDocumentVariableExpressions(
  variables: readonly DocumentVariableRecord[],
): DocumentVariableExpressionEvaluation {
  const diagnostics: DocumentVariableExpressionDiagnostic[] = [];
  const variablesByName = new Map<string, DocumentVariableRecord>();

  for (const variable of variables) {
    if (!isValidDocumentVariableName(variable.name)) {
      diagnostics.push({
        code: "document-variable-invalid-name",
        variableId: variable.variableId,
        name: variable.name,
        message: `Document variable ${variable.variableId} must use a non-empty math identifier name.`,
      });
      continue;
    }

    if (variablesByName.has(variable.name)) {
      diagnostics.push({
        code: "document-variable-duplicate-name",
        variableId: variable.variableId,
        name: variable.name,
        message: `Document variable name "${variable.name}" is already used.`,
      });
      continue;
    }

    variablesByName.set(variable.name, variable);
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  const parsedVariables = parseVariables(variables);

  if (!parsedVariables.ok) {
    return parsedVariables;
  }

  const dependenciesByName = collectDependencies(
    parsedVariables.variables,
    variablesByName,
  );

  if (!dependenciesByName.ok) {
    return dependenciesByName;
  }

  return evaluateInDependencyOrder(
    parsedVariables.variables,
    dependenciesByName.dependenciesByName,
  );
}

function parseVariables(
  variables: readonly DocumentVariableRecord[],
):
  | { ok: true; variables: readonly ParsedDocumentVariable[] }
  | {
      ok: false;
      diagnostics: readonly DocumentVariableExpressionDiagnostic[];
    } {
  const diagnostics: DocumentVariableExpressionDiagnostic[] = [];
  const parsedVariables: ParsedDocumentVariable[] = [];

  for (const variable of variables) {
    try {
      const node = math.parse(variable.valueText);
      const nonValueNode = findNonValueNode(node);

      if (nonValueNode) {
        diagnostics.push({
          code: "document-variable-invalid-expression",
          variableId: variable.variableId,
          name: variable.name,
          message: `Document variable "${variable.name}" must be a value expression, not ${nonValueNode}.`,
        });
        continue;
      }

      parsedVariables.push({ variable, node });
    } catch (error) {
      diagnostics.push({
        code: "document-variable-invalid-expression",
        variableId: variable.variableId,
        name: variable.name,
        message: `Document variable "${variable.name}" has invalid expression syntax: ${formatErrorMessage(error)}.`,
      });
    }
  }

  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : { ok: true, variables: parsedVariables };
}

function findNonValueNode(node: math.MathNode) {
  const nonValueNode = node.filter(
    (candidate) =>
      math.isAssignmentNode(candidate) ||
      math.isBlockNode(candidate) ||
      math.isFunctionAssignmentNode(candidate),
  )[0];

  return nonValueNode?.type ?? null;
}

function collectDependencies(
  parsedVariables: readonly ParsedDocumentVariable[],
  variablesByName: ReadonlyMap<string, DocumentVariableRecord>,
):
  | { ok: true; dependenciesByName: ReadonlyMap<string, readonly string[]> }
  | {
      ok: false;
      diagnostics: readonly DocumentVariableExpressionDiagnostic[];
    } {
  const diagnostics: DocumentVariableExpressionDiagnostic[] = [];
  const dependenciesByName = new Map<string, readonly string[]>();

  for (const { variable, node } of parsedVariables) {
    const dependencies = new Set<string>();

    for (const symbolName of collectSymbolNames(node)) {
      if (variablesByName.has(symbolName)) {
        dependencies.add(symbolName);
        continue;
      }

      if (isKnownMathSymbol(symbolName)) {
        continue;
      }

      diagnostics.push({
        code: "document-variable-unresolved-reference",
        variableId: variable.variableId,
        name: variable.name,
        message: `Document variable "${variable.name}" references unknown symbol "${symbolName}".`,
      });
    }

    dependenciesByName.set(variable.name, [...dependencies]);
  }

  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : { ok: true, dependenciesByName };
}

function collectSymbolNames(node: math.MathNode) {
  return node
    .filter((candidate) => math.isSymbolNode(candidate))
    .map((candidate) => (candidate as math.SymbolNode).name);
}

function isKnownMathSymbol(symbolName: string) {
  return symbolName in math || MATH_GLOBAL_SYMBOLS.has(symbolName);
}

function evaluateInDependencyOrder(
  parsedVariables: readonly ParsedDocumentVariable[],
  dependenciesByName: ReadonlyMap<string, readonly string[]>,
): DocumentVariableExpressionEvaluation {
  const parsedByName = new Map(
    parsedVariables.map((parsed) => [parsed.variable.name, parsed]),
  );
  const valuesByName = new Map<string, number>();
  const valuesById = new Map<DocumentVariableRecord["variableId"], number>();
  const visitingNames: string[] = [];
  const diagnostics: DocumentVariableExpressionDiagnostic[] = [];

  const evaluateName = (name: string): boolean => {
    if (valuesByName.has(name)) {
      return true;
    }

    const parsed = parsedByName.get(name);
    if (!parsed) {
      return false;
    }

    if (visitingNames.includes(name)) {
      const cycle = [
        ...visitingNames.slice(visitingNames.indexOf(name)),
        name,
      ].join(" -> ");
      diagnostics.push({
        code: "document-variable-cycle",
        variableId: parsed.variable.variableId,
        name: parsed.variable.name,
        message: `Document variable expressions contain a dependency cycle: ${cycle}.`,
      });
      return false;
    }

    visitingNames.push(name);

    for (const dependency of dependenciesByName.get(name) ?? []) {
      if (!evaluateName(dependency)) {
        visitingNames.pop();
        return false;
      }
    }

    try {
      const value = parsed.node.evaluate(Object.fromEntries(valuesByName));
      const numericValue = normalizeFiniteNumber(value);

      if (numericValue === null) {
        diagnostics.push({
          code: "document-variable-non-finite-result",
          variableId: parsed.variable.variableId,
          name: parsed.variable.name,
          message: `Document variable "${parsed.variable.name}" must evaluate to a finite number.`,
        });
        visitingNames.pop();
        return false;
      }

      valuesByName.set(name, numericValue);
      valuesById.set(parsed.variable.variableId, numericValue);
      visitingNames.pop();
      return true;
    } catch (error) {
      diagnostics.push({
        code: "document-variable-invalid-expression",
        variableId: parsed.variable.variableId,
        name: parsed.variable.name,
        message: `Document variable "${parsed.variable.name}" could not be evaluated: ${formatErrorMessage(error)}.`,
      });
      visitingNames.pop();
      return false;
    }
  };

  for (const { variable } of parsedVariables) {
    evaluateName(variable.name);
  }

  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : {
        ok: true,
        valuesById,
        valuesByName,
        dependenciesByName,
      };
}

function normalizeFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
