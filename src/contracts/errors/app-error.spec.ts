import { test, expect } from "vitest";

import {
  appErrorFromModelingDiagnostic,
  appErrorFromModelingResult,
  appErrorFromValidationIssues,
  appErrorToModelingDiagnostic,
  createAppError,
  createConsoleErrorReporter,
  createTestErrorReporter,
  normalizeUnknownError,
  describeUnknownError,
} from "@/contracts/errors";

test("src/contracts/errors/app-error.spec.ts", () => {
  const cause = new Error("Kernel refused the operation.");
  const normalized = normalizeUnknownError(cause, {
    fallbackMessage: "Fallback message.",
    requestId: "request_preview-1",
    context: [{ key: "operation", value: "Preview feature" }],
  });

  expect(
    normalized.message,
    "Normalization should preserve Error messages.",
  ).toBe(cause.message);
  expect(
    normalized.cause,
    "Normalization should preserve the original cause.",
  ).toBe(cause);
  expect(
    normalized.requestId,
    "Normalization should preserve request ids.",
  ).toBe("request_preview-1");
  expect(
    normalized.context.some(
      (entry) => entry.key === "operation" && entry.value === "Preview feature",
    ),
    "Normalization should preserve structured context.",
  ).toBeTruthy();

  const nonError = normalizeUnknownError("bad value", {
    fallbackMessage: "Non-Error throw fell back.",
  });
  expect(
    nonError.message,
    "Non-Error throws should use fallback messages.",
  ).toBe("Non-Error throw fell back.");
  expect(
    nonError.cause,
    "Non-Error throws should still be retained as causes.",
  ).toBe("bad value");

  const plainObjectFailure = {
    message: "Browser worker could not clone the render snapshot.",
    context: [{ key: "stage", value: "post-commit-handoff" }],
  };
  const malformed = normalizeUnknownError(plainObjectFailure, {
    fallbackMessage: "Plain object failure fell back.",
  });
  expect(
    malformed.message,
    "Plain object failures with messages should not be replaced by a generic fallback.",
  ).toBe("Browser worker could not clone the render snapshot.");
  expect(
    malformed.context,
    "Plain object failure context should survive normalization for reporting.",
  ).toEqual([{ key: "stage", value: "post-commit-handoff" }]);
  expect(
    malformed.cause,
    "Plain object failures should still be retained as causes.",
  ).toBe(plainObjectFailure);

  expect(
    describeUnknownError(
      createAppError({ code: "app/unknown", message: "App error message." }),
    ),
    "describeUnknownError should surface AppError messages, not [object Object].",
  ).toBe("App error message.");
  expect(
    describeUnknownError(new Error("Plain error.")),
    "describeUnknownError should surface Error messages.",
  ).toBe("Plain error.");
  expect(
    describeUnknownError(plainObjectFailure, "Custom fallback."),
    "describeUnknownError should surface message-bearing plain objects.",
  ).toBe("Browser worker could not clone the render snapshot.");
  expect(
    describeUnknownError({ weird: true }, "Custom fallback."),
    "describeUnknownError should fall back for non-message-bearing values.",
  ).toBe("Custom fallback.");

  const validationError = appErrorFromValidationIssues(
    [
      {
        path: "width",
        expected: "number",
        value: "wide",
        message: "width must be a number.",
      },
    ],
    {
      operation: "Parse dimensions",
    },
  );
  expect(
    validationError.code,
    "Validation failures should get validation codes.",
  ).toBe("app/validation-failed");
  expect(
    validationError.message.length > 0,
    "Validation failures should expose a human message.",
  ).toBeTruthy();

  const diagnosticError = appErrorFromModelingDiagnostic(
    {
      code: "document-variable-unresolved-reference",
      severity: "error",
      message: "Variable x references missing.",
      target: null,
      detail: null,
    },
    { operation: "Update variable" },
  );
  expect(
    diagnosticError.message,
    "Diagnostic messages should be preserved.",
  ).toBe("Variable x references missing.");
  expect(
    diagnosticError.context.some((entry) => entry.key === "diagnosticCode"),
    "Diagnostic codes should be preserved as structured context.",
  ).toBeTruthy();

  const conflictError = appErrorFromModelingResult({
    operation: "Create feature",
    fallbackMessage: "Feature rejected.",
    diagnostics: [
      {
        code: "feature-warning",
        severity: "warning",
        message: "Feature warning.",
        target: null,
        detail: null,
      },
      {
        code: "repository-head-conflict",
        severity: "error",
        message: "Refresh before retrying this mutation.",
        target: null,
        detail: null,
      },
    ],
    revisionState: {
      kind: "conflict",
      actualRevisionId: "rev_2",
    },
  });
  expect(
    conflictError.message,
    "Repository head conflicts should be the primary modeling boundary error.",
  ).toBe("Refresh before retrying this mutation.");
  expect(
    conflictError.context.some(
      (entry) => entry.key === "actualRevisionId" && entry.value === "rev_2",
    ),
    "Modeling boundary errors should retain revision conflict context.",
  ).toBeTruthy();

  const modelingDiagnostic = appErrorToModelingDiagnostic(
    createAppError({
      code: "workbench/action-failed",
      severity: "fatal",
      message: "Render subtree crashed.",
    }),
  );
  expect(
    modelingDiagnostic.severity,
    "Fatal app errors should become error diagnostics.",
  ).toBe("error");

  const testReporter = createTestErrorReporter();
  const report = testReporter.report(normalized, {
    source: "unit",
    visibility: "user",
    dedupeKey: "same-error",
  });
  const duplicate = testReporter.report(normalized, {
    source: "unit",
    visibility: "user",
    dedupeKey: "same-error",
  });
  expect(
    report,
    "Test reporter should keep the first deduped report.",
  ).not.toBe(null);
  expect(
    duplicate,
    "Test reporter should suppress duplicate dedupe keys.",
  ).toBe(null);
  expect(
    testReporter.reports.length,
    "Test reporter should store reports.",
  ).toBe(1);

  const consoleRecords: unknown[][] = [];
  const consoleReporter = createConsoleErrorReporter({
    error: (...args: unknown[]) => {
      consoleRecords.push(args);
    },
  });
  consoleReporter.report(normalized, { source: "unit" });
  expect(
    String(consoleRecords[0]?.[0]),
    "Console reporter should emit actionable records.",
  ).toBe("[app-error]");
});
