import { expect, test, type Page } from "@playwright/test";

const CATALOG_ID = "doc_project_catalog";

/**
 * Points the stored project catalog at a part document, so discovery fails
 * with "Invalid local project catalog." while the part itself still opens.
 * Returns the original catalog entry for {@link restoreCatalog}.
 */
function corruptCatalog(page: Page) {
  return page.evaluate((catalogId) => {
    const stores = Object.keys(localStorage).flatMap((key) => {
      try {
        const urls = JSON.parse(localStorage.getItem(key)!) as unknown;
        return urls && typeof urls === "object"
          ? [{ key, urls: urls as Record<string, string> }]
          : [];
      } catch {
        return [];
      }
    });
    const catalog = stores.find((store) => catalogId in store.urls)!;
    const partUrl = stores
      .flatMap((store) => Object.entries(store.urls))
      .find(
        ([id, url]) =>
          id.startsWith("doc_") &&
          id !== catalogId &&
          typeof url === "string" &&
          url.startsWith("automerge:"),
      )![1];
    const original = localStorage.getItem(catalog.key)!;
    localStorage.setItem(
      catalog.key,
      JSON.stringify({ ...catalog.urls, [catalogId]: partUrl }),
    );
    return { key: catalog.key, value: original };
  }, CATALOG_ID);
}

function restoreCatalog(page: Page, entry: { key: string; value: string }) {
  return page.evaluate(
    ({ key, value }) => localStorage.setItem(key, value),
    entry,
  );
}

// Lane: e2e. Seam: the workbench shell when initial project discovery fails
// for a reason other than its part document (here an invalid stored project
// catalog). Discovery runs only in the browser shell, and the outcome is the
// loading cover plus the notification column: the cover must stop saying
// "Opening the document." and a notice must offer the reload that recovers.
test("a project that could not be opened ends the opening cover with a reload notice", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/app");
  const newProject = page.getByRole("button", {
    name: "New project",
    exact: true,
  });
  // The first project is stored once its controls are usable.
  await expect(newProject).toBeEnabled({ timeout: 60_000 });
  const catalog = await corruptCatalog(page);

  await page.reload();
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "Project could not be opened" });
  await expect(notice).toBeVisible({ timeout: 60_000 });
  await expect(notice).toContainText("Invalid local project catalog.");
  const cover = page.getByRole("status", {
    name: "Initial model render pending",
  });
  await expect(cover).toContainText("Unable to prepare the document.");
  await expect(cover.getByRole("progressbar")).toHaveCount(0);

  // Once the cause is gone, the notice's reload recovers.
  await restoreCatalog(page, catalog);
  await Promise.all([
    page.waitForEvent("load", { timeout: 60_000 }),
    notice.getByRole("button", { name: "Reload" }).click(),
  ]);
  await expect(newProject).toBeEnabled({ timeout: 60_000 });
  await expect(cover).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Project could not be opened")).toHaveCount(0);
});

/** The active project's id from the workbench's stored project session. */
function activeProjectId(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("cad.workbench.activeProject.v1:"),
    );
    return key
      ? (JSON.parse(localStorage.getItem(key)!) as { projectId: string })
          .projectId
      : null;
  });
}

// Lane: e2e. Seam: the "Project could not be opened" notice's repair action
// in the workbench shell. The repository's rebuild is proven in the logic
// lane (local-project-repository.spec.ts); this row proves the button runs
// it against the browser's own storage and reloads into the same project.
test("repairing the project list from the failure notice reopens the stored project and its part", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/app");
  const newProject = page.getByRole("button", {
    name: "New project",
    exact: true,
  });
  await expect(newProject).toBeEnabled({ timeout: 60_000 });
  const projectId = await activeProjectId(page);
  expect(projectId).not.toBeNull();
  const partId = await page
    .locator("[data-document-tab]")
    .getAttribute("data-document-id");
  await corruptCatalog(page);

  await page.reload();
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "Project could not be opened" });
  await expect(notice).toBeVisible({ timeout: 60_000 });
  await Promise.all([
    page.waitForEvent("load", { timeout: 60_000 }),
    notice.getByRole("button", { name: "Repair project list" }).click(),
  ]);

  await expect(newProject).toBeEnabled({ timeout: 60_000 });
  await expect(
    page.getByRole("status", { name: "Initial model render pending" }),
  ).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Project could not be opened")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue("My project");
  expect(await activeProjectId(page)).toBe(projectId);
  await expect(page.locator("[data-document-tab]")).toHaveAttribute(
    "data-document-id",
    partId!,
  );
});
