import { expect, test, type Page, type Route } from "@playwright/test";

test.setTimeout(120_000);

async function ready(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__cadaraDebug?.getState()?.revision ?? "loading",
        ),
      { timeout: 30_000 },
    )
    .not.toBe("loading");
}

// Lane: e2e. Seam: the document tab bar while the active document failed to
// open early (no first snapshot, so the loading cover stays over the
// viewport). The tabs are navigation between documents, not part of the
// failed one: they stay usable so the user can switch to another document.
test("the document tabs stay usable while the active document could not be opened", async ({
  page,
}) => {
  await page.goto("/app?cadTestMode=1");
  await ready(page);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New", exact: true }).click();
  const tabs = page.locator("[data-document-tab]");
  await expect(tabs).toHaveCount(2);
  await ready(page);
  // Both parts are stored in the project before the failing reload.
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).toBeEnabled({ timeout: 30_000 });
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");

  // The geometry engine now fails to start, so the active part never opens.
  const failEngineDownload = (route: Route) =>
    route.fulfill({ status: 500, body: "Internal error" });
  await page.route("**/kernels/**/cadara-occ.wasm", failEngineDownload);
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Document could not be opened" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("status", { name: "Initial model render pending" }),
  ).toBeVisible();

  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
});
