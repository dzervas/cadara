import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import {
  requireAcceptedModelingResult,
  runReportedAction as runWorkbenchAction,
} from "@/lib/reported-action";
import {
  appErrorToModelingDiagnostic,
  createTestErrorReporter,
} from "@/contracts/errors";

test("src/app/workbench-action.spec.ts", async () => {
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

  expectTrue(
    rejected.isErr(),
    "Rejected modeling results should return an error result.",
  );
  expectTrue(
    uiMessage === "Variable width references missing.",
    "Rejected modeling diagnostics should update UI-facing error state.",
  );
  expectTrue(
    reporter.reports.length === 0,
    "Expected rejected modeling results should not be reported by default.",
  );

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

  expectTrue(
    thrown.isErr(),
    "Rejected promises should return an error result.",
  );
  expectTrue(
    thrownMessage === "IndexedDB is unavailable.",
    "Rejected promises should preserve human messages.",
  );
  expectTrue(
    thrownReporter.reports[0]?.error.cause instanceof Error,
    "Rejected promises should preserve causes.",
  );

  const diagnostic = appErrorToModelingDiagnostic(rejected.error, {
    target: { kind: "feature", featureId: "feature_extrude-1" },
  });
  expectTrue(
    diagnostic.message === uiMessage,
    "UI diagnostics should render normalized messages.",
  );
  expectTrue(
    diagnostic.target?.kind === "feature",
    "AppError diagnostics should preserve diagnostic targets when provided.",
  );
});
