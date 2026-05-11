import { expect, test } from "@playwright/test";

test("dev debug namespace exposes structured state, trace, and session export", async ({
  page,
}) => {
  await page.goto("/?cadTestMode=true");

  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__cadaraDebug?.getState()?.machineState ?? "",
        ),
      { timeout: 10_000 },
    )
    .not.toBe("");

  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__cadaraDebug?.getTrace().entries.length ?? 0,
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
