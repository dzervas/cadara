import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

async function ready(page: Page) {
  await expect(
    page.getByRole("button", { name: "File", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
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

async function settledTabs(page: Page, names: string[]) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((key) =>
          key.startsWith("cad.workbench.tabs.project.v1:"),
        );
        return key
          ? JSON.parse(localStorage.getItem(key)!).tabs.map(
              (tab: { title: string }) => tab.title,
            )
          : [];
      }),
    )
    .toEqual(names);
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).toBeEnabled();
}

test("a local project retains part identities and renamed tabs across reload and project switches", async ({
  page,
}) => {
  await page.goto("/app?cadTestMode=1");
  await ready(page);
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue("My project");
  await expect(page.locator("[data-document-tab]")).toHaveCount(1);
  const firstId = await page
    .locator("[data-document-tab]")
    .getAttribute("data-document-id");
  await settledTabs(page, ["Workspace"]);
  await page.reload();
  await ready(page);
  await expect(page.locator("[data-document-tab]")).toHaveAttribute(
    "data-document-id",
    firstId!,
  );

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New", exact: true }).click();
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);
  const second = page.locator('[data-document-tab][aria-selected="true"]');
  const secondId = await second.getAttribute("data-document-id");
  expect(secondId).not.toBe(firstId);
  await ready(page);
  await second.locator("[data-document-tab-title]").dblclick();
  const rename = page.getByRole("textbox", {
    name: "Rename document",
    exact: true,
  });
  await expect(rename).toBeFocused();
  await rename.fill("Lid");
  await rename.press("Enter");
  await expect(second.locator("[data-document-tab-title]")).toHaveText("Lid");
  await settledTabs(page, ["Workspace", "Lid"]);
  await page.reload();
  await ready(page);
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);
  await expect(
    page.locator(`[data-document-id="${secondId}"] [data-document-tab-title]`),
  ).toHaveText("Lid");
  await expect(page.locator(`[data-document-id="${firstId}"]`)).toBeVisible();

  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Bracket");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await ready(page);
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue("Bracket");
  await expect(page.locator("[data-document-tab]")).toHaveCount(1);
  await page.reload();
  await ready(page);
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue("Bracket");
  await page.getByRole("combobox", { name: "Project", exact: true }).click();
  await page.getByRole("option", { name: "My project", exact: true }).click();
  await ready(page);
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);
  await expect(
    page.locator(`[data-document-id="${secondId}"] [data-document-tab-title]`),
  ).toHaveText("Lid");
});
