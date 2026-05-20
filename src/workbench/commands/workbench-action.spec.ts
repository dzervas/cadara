import { test, expect } from "vitest";

import {
  requireAcceptedModelingResult,
  runReportedAction as runWorkbenchAction,
} from "@/lib/reported-action";
import {
  appErrorToModelingDiagnostic,
  createTestErrorReporter,
} from "@/contracts/errors";

test("src/workbench/commands/workbench-action.spec.ts", async () => {
  const reporter = createTestErrorReporter();
  let uiMessage: string | null = null;
  const rejected = await runWorkbenchAction({
    operation: "Update variable",
    reporter,
    reporting: { mappedFailure: "expected" },
    action: async () => ({
      revisionState: {
        kind: "rejected" as const,
        reasonCode: "invalid-variable",
      },
      diagnostics: [
        {
          code: "document-variable-unresolved-reference",
          severity: "error" as const,
          message: "Variable width references missing.",
          target: null,
          detail: null,
        },
      ],
    }),
    mapSuccess: (result) =>
      requireAcceptedModelingResult(result, {
        operation: "Update variable",
        fallbackMessage: "Update variable failed.",
      }),
    onError: (error) => {
      uiMessage = error.message;
    },
  });

  expect(
    rejected.isErr(),
    "Rejected modeling results should return an error result.",
  ).toBeTruthy();
  expect(
    uiMessage,
    "Rejected modeling diagnostics should update UI-facing error state.",
  ).toBe("Variable width references missing.");
  expect(
    reporter.reports.length,
    "Expected rejected modeling results should not be reported by default.",
  ).toBe(0);

  const thrownReporter = createTestErrorReporter();
  let thrownMessage = "";
  const thrown = await runWorkbenchAction({
    operation: "Rename body",
    reporter: thrownReporter,
    reporting: { mappedFailure: "expected" },
    action: async () => {
      throw new Error("IndexedDB is unavailable.");
    },
    mapSuccess: (result: never) =>
      requireAcceptedModelingResult(result, {
        operation: "Rename body",
        fallbackMessage: "Rename body failed.",
      }),
    onError: (error) => {
      thrownMessage = error.message;
    },
  });

  expect(
    thrown.isErr(),
    "Rejected promises should return an error result.",
  ).toBeTruthy();
  expect(
    thrownMessage,
    "Rejected promises should preserve human messages.",
  ).toBe("IndexedDB is unavailable.");
  expect(
    thrownReporter.reports[0]?.error.cause instanceof Error,
    "Rejected promises should preserve causes.",
  ).toBeTruthy();

  const diagnostic = appErrorToModelingDiagnostic(rejected.error, {
    target: { kind: "feature", featureId: "feature_extrude-1" },
  });
  expect(
    diagnostic.message,
    "UI diagnostics should render normalized messages.",
  ).toBe(uiMessage);
  expect(
    diagnostic.target?.kind,
    "AppError diagnostics should preserve diagnostic targets when provided.",
  ).toBe("feature");
});
