import { test } from "bun:test";
import { expectTrue } from "@/testing/expect.spec";
import { z } from "zod";

import {
  appErrorFromModelingDiagnostic,
  appErrorFromModelingResult,
  appErrorFromZodError,
  appErrorToModelingDiagnostic,
  createAppError,
  createConsoleErrorReporter,
  createTestErrorReporter,
  normalizeUnknownError,
} from "@/contracts/errors";

test("src/contracts/errors/app-error.spec.ts", () => {
  const cause = new Error("Kernel refused the operation.");
  const normalized = normalizeUnknownError(cause, {
    fallbackMessage: "Fallback message.",
    requestId: "request_preview-1",
    context: [{ key: "operation", value: "Preview feature" }],
  });

  expectTrue(
    normalized.message === cause.message,
    "Normalization should preserve Error messages.",
  );
  expectTrue(
    normalized.cause === cause,
    "Normalization should preserve the original cause.",
  );
  expectTrue(
    normalized.requestId === "request_preview-1",
    "Normalization should preserve request ids.",
  );
  expectTrue(
    normalized.context.some(
      (entry) => entry.key === "operation" && entry.value === "Preview feature",
    ),
    "Normalization should preserve structured context.",
  );

  const nonError = normalizeUnknownError("bad value", {
    fallbackMessage: "Non-Error throw fell back.",
  });
  expectTrue(
    nonError.message === "Non-Error throw fell back.",
    "Non-Error throws should use fallback messages.",
  );
  expectTrue(
    nonError.cause === "bad value",
    "Non-Error throws should still be retained as causes.",
  );

  const malformedMarkedValue = {
    [Symbol.for("cadara.appError")]: true,
    message: "Malformed app error.",
  };
  const malformed = normalizeUnknownError(malformedMarkedValue, {
    fallbackMessage: "Malformed marker fell back.",
  });
  expectTrue(
    malformed.message === "Malformed marker fell back.",
    "Malformed marked objects should not escape normalization.",
  );
  expectTrue(
    malformed.cause === malformedMarkedValue,
    "Malformed marked objects should still be retained as causes.",
  );

  const zodResult = z
    .object({ width: z.number() })
    .safeParse({ width: "wide" });
  expectTrue(!zodResult.success, "Fixture should produce a zod error.");
  const zodError = appErrorFromZodError(zodResult.error, {
    operation: "Parse dimensions",
  });
  expectTrue(
    zodError.code === "app/validation-failed",
    "Zod failures should get validation codes.",
  );
  expectTrue(
    zodError.message.length > 0,
    "Zod failures should expose a human message.",
  );

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
  expectTrue(
    diagnosticError.message === "Variable x references missing.",
    "Diagnostic messages should be preserved.",
  );
  expectTrue(
    diagnosticError.context.some((entry) => entry.key === "diagnosticCode"),
    "Diagnostic codes should be preserved as structured context.",
  );

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
  expectTrue(
    conflictError.message === "Refresh before retrying this mutation.",
    "Repository head conflicts should be the primary modeling boundary error.",
  );
  expectTrue(
    conflictError.context.some(
      (entry) => entry.key === "actualRevisionId" && entry.value === "rev_2",
    ),
    "Modeling boundary errors should retain revision conflict context.",
  );

  const modelingDiagnostic = appErrorToModelingDiagnostic(
    createAppError({
      code: "workbench/action-failed",
      severity: "fatal",
      message: "Render subtree crashed.",
    }),
  );
  expectTrue(
    modelingDiagnostic.severity === "error",
    "Fatal app errors should become error diagnostics.",
  );

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
  expectTrue(
    report !== null,
    "Test reporter should keep the first deduped report.",
  );
  expectTrue(
    duplicate === null,
    "Test reporter should suppress duplicate dedupe keys.",
  );
  expectTrue(
    testReporter.reports.length === 1,
    "Test reporter should store reports.",
  );

  const consoleRecords: unknown[][] = [];
  const consoleReporter = createConsoleErrorReporter({
    error: (...args: unknown[]) => {
      consoleRecords.push(args);
    },
  });
  consoleReporter.report(normalized, { source: "unit" });
  expectTrue(
    String(consoleRecords[0]?.[0]) === "[app-error]",
    "Console reporter should emit actionable records.",
  );
});
