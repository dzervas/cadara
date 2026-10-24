import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { openDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

interface ObservedLoadingProgress {
  label: string | null;
  visibleText: string | null;
  valueText: string | null;
  valueNow: string | null;
  valueMax: string | null;
}

// cadara-ku5k: opening a multi-feature document shows the OCC worker's real
// per-feature rebuild progress in the loading overlay. A recorder installed
// before the open captures every overlay update, so the row proves the count
// advances (not just that it appears) without timing guesses, then that the
// overlay goes away once the model is ready.
test("opening the wheel shows feature rebuild progress advancing, then clears it on ready", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  await workbench.waitForRenderIdle(30_000);
  await page.evaluate(() => {
    const observed: ObservedLoadingProgress[] = [];
    (window as unknown as { __loadingProgress: ObservedLoadingProgress[] })
      .__loadingProgress = observed;
    new MutationObserver(() => {
      const bar = document.querySelector(
        '[aria-label="Initial model render pending"] [data-loading-progress="determinate"]',
      );
      if (!bar) return;
      const entry = {
        label: bar.getAttribute("aria-label"),
        visibleText:
          bar.parentElement?.querySelector('[aria-hidden="true"]')
            ?.textContent ?? null,
        valueText: bar.getAttribute("aria-valuetext"),
        valueNow: bar.getAttribute("aria-valuenow"),
        valueMax: bar.getAttribute("aria-valuemax"),
      };
      const last = observed.at(-1);
      if (last?.valueNow !== entry.valueNow) observed.push(entry);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
  const wheel: unknown = JSON.parse(
    await readFile("landing/examples/wheel/model.cadara", "utf8"),
  );
  await openDocumentCopy(page, wheel, "wheel.cadara");
  await expect(
    page.getByRole("status", { name: "Initial model render pending" }),
  ).toHaveCount(0, { timeout: 90_000 });

  const observed = await page.evaluate(
    () =>
      (window as unknown as { __loadingProgress: ObservedLoadingProgress[] })
        .__loadingProgress,
  );
  const counts = observed.map((entry) => Number(entry.valueNow));
  expect(
    new Set(counts).size,
    `the rebuild count advanced through several values: ${JSON.stringify(observed)}`,
  ).toBeGreaterThan(2);
  expect(counts, "the count never goes backwards").toEqual(
    [...counts].sort((a, b) => a - b),
  );
  expect(observed.every((entry) => entry.valueMax === "31")).toBe(true);
  // The accessible name stays at the stage; the count is the bar's value text.
  for (const entry of observed) {
    expect(entry.label).toBe("Rebuilding features.");
    expect(entry.valueText).toBe(`${entry.valueNow} of 31 features`);
  }
  expect(observed[0]?.visibleText).toMatch(/^Rebuilding features \d+\/31 · \S/);
});
