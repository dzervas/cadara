import { expect, it } from "vitest";

import {
  createTestErrorReporter,
  normalizeUnknownError,
} from "@/contracts/errors";
import {
  OccKernelVersionRetiredError,
  withoutOccKernelVersionRetiredReports,
} from "./kernel-version-retired";

it("a failure caused by a retired kernel is not reported; other failures are", () => {
  const inner = createTestErrorReporter();
  const reporter = withoutOccKernelVersionRetiredReports(inner);
  const retired = new OccKernelVersionRetiredError();
  const normalize = (error: unknown) =>
    normalizeUnknownError(error, { fallbackMessage: "Failed." });

  expect(reporter.report(normalize(retired), { source: "direct" })).toBeNull();
  expect(
    reporter.report(
      normalize(new Error("Snapshot failed", { cause: retired })),
      { source: "wrapped" },
    ),
  ).toBeNull();
  reporter.report(normalize(new Error("Engine crashed")), {
    source: "engine",
  });

  expect(inner.reports.map((record) => record.metadata.source)).toEqual([
    "engine",
  ]);
});
