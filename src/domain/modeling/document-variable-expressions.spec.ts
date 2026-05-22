import { test, expect } from "vitest";

import type { DocumentVariableRecord } from "@/contracts/modeling/schema";
import {
  evaluateDocumentVariableExpressions,
  isValidDocumentVariableName,
  type DocumentVariableExpressionDiagnosticCode,
} from "@/domain/modeling/document-variable-expressions";

test("src/domain/modeling/document-variable-expressions.spec.ts", () => {
  function variable(
    name: string,
    valueText: string,
    ordinal = name,
  ): DocumentVariableRecord {
    return {
      variableId: `variable_${ordinal}` as const,
      name,
      valueText,
    };
  }

  function evaluate(variables: readonly DocumentVariableRecord[]) {
    const result = evaluateDocumentVariableExpressions(variables);

    expect(
      result.ok,
      result.ok
        ? "Expected expression evaluation to pass."
        : (result.diagnostics[0]?.message ??
            "Expected expression evaluation to pass."),
    ).toBeTruthy();

    return result;
  }

  function assertRejectsWith(
    variables: readonly DocumentVariableRecord[],
    code: DocumentVariableExpressionDiagnosticCode,
    message: string,
  ) {
    const result = evaluateDocumentVariableExpressions(variables);

    expect(result.ok, message).toBeFalsy();
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === code),
      message,
    ).toBeTruthy();
  }

  expect(
    isValidDocumentVariableName("width_1"),
    "Identifier-style variable names should be valid.",
  ).toBeTruthy();
  expect(
    isValidDocumentVariableName("1_width"),
    "Names that cannot parse as math identifiers should be invalid.",
  ).toBeFalsy();

  const literals = evaluate([variable("x", "50")]);
  expect(
    literals.valuesByName.get("x"),
    "Simple numeric literals should evaluate.",
  ).toBe(50);

  const complex = evaluate([variable("area", "(10 + 5) * 2 ^ 3")]);
  expect(
    complex.valuesByName.get("area"),
    "Complex expressions should use math.js precedence.",
  ).toBe(120);

  const builtin = evaluate([variable("height", "sqrt(81) + sin(pi / 2)")]);
  expect(
    builtin.valuesByName.get("height"),
    "Built-in math.js functions and constants should evaluate.",
  ).toBe(10);

  const dependent = evaluate([variable("x", "50"), variable("y", "x + 50")]);
  expect(
    dependent.valuesByName.get("y"),
    "Dependent expressions should evaluate from document variables.",
  ).toBe(100);
  expect(
    dependent.dependenciesByName.get("y")?.includes("x"),
    "Document-variable references should be collected as dependencies.",
  ).toBeTruthy();

  const chained = evaluate([
    variable("base", "25"),
    variable("width", "base * 2"),
    variable("area", "width ^ 2"),
  ]);
  expect(
    chained.valuesByName.get("area"),
    "Chained dependencies should evaluate in dependency order.",
  ).toBe(2500);

  assertRejectsWith(
    [variable("bad", "1 +")],
    "document-variable-invalid-expression",
    "Invalid syntax should be rejected.",
  );
  assertRejectsWith(
    [variable("bad", "x = 1")],
    "document-variable-invalid-expression",
    "Assignment expressions should be rejected.",
  );
  assertRejectsWith(
    [variable("x", "missing + 1")],
    "document-variable-unresolved-reference",
    "Unknown symbols should be rejected.",
  );
  assertRejectsWith(
    [variable("x", "y + 1"), variable("y", "x + 1")],
    "document-variable-cycle",
    "Cycles should be rejected.",
  );
  assertRejectsWith(
    [variable("", "1")],
    "document-variable-invalid-name",
    "Empty names should be rejected.",
  );
  assertRejectsWith(
    [variable("1_width", "1")],
    "document-variable-invalid-name",
    "Invalid identifier names should be rejected.",
  );
  assertRejectsWith(
    [variable("width", "1", "width_a"), variable("width", "2", "width_b")],
    "document-variable-duplicate-name",
    "Duplicate names should be rejected.",
  );
  assertRejectsWith(
    [variable("x", "1 / 0")],
    "document-variable-non-finite-result",
    "Infinite results should be rejected.",
  );
  assertRejectsWith(
    [variable("x", "sqrt(-1)")],
    "document-variable-non-finite-result",
    "Complex results should be rejected.",
  );
});
