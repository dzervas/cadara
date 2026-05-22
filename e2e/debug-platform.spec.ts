import { expect, test, type Page } from "@playwright/test";

async function evaluateAfterNavigation<T>(
  page: Page,
  callback: () => T,
  fallback: T,
) {
  try {
    return await page.evaluate(callback);
  } catch (error) {
    if (!isNavigationContextError(error)) {
      throw error;
    }

    await page.waitForLoadState("domcontentloaded");
    return fallback;
  }
}

test("dev debug namespace exposes structured state, trace, and session export", async ({
  page,
}) => {
  await page.goto("/?cadTestMode=true");

  await expect
    .poll(
      () =>
        evaluateAfterNavigation(
          page,
          () => window.__cadaraDebug?.getState()?.machineState ?? "",
          "",
        ),
      { timeout: 10_000 },
    )
    .not.toBe("");

  await expect
    .poll(
      () =>
        evaluateAfterNavigation(
          page,
          () => window.__cadaraDebug?.getTrace().entries.length ?? 0,
          0,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);

  const exportedSession = await page.evaluate(
    () => window.__cadaraDebug?.exportSession() ?? null,
  );

  expect(exportedSession?.state?.revision).toBeTruthy();
  expect(exportedSession?.trace.entries.length).toBeGreaterThan(0);
  expect(exportedSession?.replay.status).toBe("partial");
  expect(exportedSession?.replay.unsupportedSteps[0]?.code).toBe(
    "browser-coordination-not-captured",
  );
});

function isNavigationContextError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return [
    "Execution context was destroyed",
    "Cannot find context with specified id",
    "Frame was detached",
  ].some((message) => error.message.includes(message));
}
