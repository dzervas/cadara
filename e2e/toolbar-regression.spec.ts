import { expect, test, type Page } from "@playwright/test";

const shortcutProfileStorageKey = "cadara.shortcutProfile.v1";

type ShortcutLoadWindow = Window & {
  __shortcutProfileLoadCount?: number;
};

function getShortcutProfileLoadCount(page: Page) {
  return page
    .evaluate(() => {
      const trackedWindow = window as ShortcutLoadWindow;
      return trackedWindow.__shortcutProfileLoadCount ?? 0;
    })
    .catch(async (error) => {
      if (!isNavigationContextError(error)) {
        throw error;
      }

      await page.waitForLoadState("domcontentloaded");
      return page.evaluate(() => {
        const trackedWindow = window as ShortcutLoadWindow;
        return trackedWindow.__shortcutProfileLoadCount ?? 0;
      });
    });
}

test("pattern dropdown stays responsive without restarting shortcut profile loads", async ({
  page,
}) => {
  await page.addInitScript((storageKey) => {
    const originalGetItem = Storage.prototype.getItem;

    Storage.prototype.getItem = function getItemWithShortcutLoadCount(
      key: string,
    ) {
      if (key === storageKey) {
        const trackedWindow = window as ShortcutLoadWindow;
        trackedWindow.__shortcutProfileLoadCount =
          (trackedWindow.__shortcutProfileLoadCount ?? 0) + 1;
      }

      return originalGetItem.call(this, key);
    };
  }, shortcutProfileStorageKey);

  await page.goto("/");

  const patternButton = page.locator('button[data-tool-id="pattern"]');
  await expect(patternButton).toBeVisible();

  const beforeOpenLoadCount = await getShortcutProfileLoadCount(page);

  /*
   * Regression coverage for the Pattern dropdown freeze: an unstable default
   * shortcut command list once made ShortcutProvider rebuild its registry on
   * every render, reload the shortcut profile, set state, and render again.
   * Opening this dropdown renders shortcut hints, so it exposed the loop as a
   * browser hang and eventual crash.
   */
  for (let index = 0; index < 3; index += 1) {
    await patternButton.hover();
    await expect(
      page.getByRole("tooltip").filter({ hasText: "Pattern" }),
    ).toBeVisible();
    await patternButton.click({ timeout: 5_000 });

    const circularPatternItem = page
      .getByRole("menuitem")
      .filter({ hasText: "Circular Pattern" });
    await expect(circularPatternItem).toBeVisible();

    if (index === 2) {
      await circularPatternItem.click({ timeout: 5_000 });
    } else {
      await page.keyboard.press("Escape");
    }

    await page.waitForLoadState("load");
  }

  await expect(patternButton).toHaveAttribute("aria-pressed", "true");

  await page.waitForTimeout(1_000);
  const afterOpenLoadCount = await getShortcutProfileLoadCount(page);

  expect(afterOpenLoadCount - beforeOpenLoadCount).toBeLessThanOrEqual(2);
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
