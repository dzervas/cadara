// Lane: e2e. Seams: the workbench shell's New project modal (location cards,
// the requestSignIn seam answered by the account menu) and Move to project
// from a document tab's context menu through the document sync worker's
// history copy. Only the browser has the modal, the tab menu, the worker and
// the window following the moved part.
import { expect, test, type Page } from "@playwright/test";
import {
  addVariable,
  createProject,
  documentTabs,
  openVariables,
  variableRow,
} from "./helpers/project-sync";

test.setTimeout(120_000);
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
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).toBeEnabled({ timeout: 30_000 });
}

async function openAsGuest(page: Page) {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto("/app?cadTestMode=1");
  await ready(page);
}

function projectSelect(page: Page) {
  return page.getByRole("combobox", { name: "Project", exact: true });
}

test("a guest creates only Local projects, and the account cards' Sign in opens the modal", async ({
  page,
}) => {
  await openAsGuest(page);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(dialog.getByRole("radio", { name: /^Local/ })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: /^Private/ })).toBeDisabled();
  await expect(dialog.getByRole("radio", { name: /^Public/ })).toBeDisabled();
  await expect(
    dialog.getByText("Sign in to create an account project.", { exact: true }),
  ).toHaveCount(2);

  await dialog
    .getByRole("button", { name: "Sign in", exact: true })
    .first()
    .click();
  // The gated action opens the shared sign-in modal.
  const signInPanel = page
    .getByRole("dialog")
    .filter({ hasText: "Your local projects work without an account." });
  await expect(dialog).toBeHidden();
  await expect(signInPanel).toBeVisible();
  await signInPanel.getByRole("button", { name: "Close sign in" }).click();
  await expect(signInPanel).toBeHidden();

  await createProject(page, "Bracket");
  await ready(page);
  await projectSelect(page).click();
  const listbox = page.getByRole("listbox");
  await expect(
    listbox.getByText("On this device", { exact: true }),
  ).toBeVisible();
  await expect(
    listbox.getByRole("option", { name: "My project", exact: true }),
  ).toBeVisible();
  await expect(
    listbox.getByRole("option", { name: "Bracket", exact: true }),
  ).toBeVisible();
});

test("Move to project copies a part with an edit made just before, the window follows it, and the source keeps no copy", async ({
  page,
}) => {
  await openAsGuest(page);
  await expect(projectSelect(page)).toHaveValue("My project");
  await createProject(page, "Bracket");
  await ready(page);
  await projectSelect(page).click();
  await page.getByRole("option", { name: "My project", exact: true }).click();
  await ready(page);
  await expect(projectSelect(page)).toHaveValue("My project");
  const sourceId = await documentTabs(page)
    .first()
    .getAttribute("data-document-id");

  await openVariables(page);
  await addVariable(page, "variable_1");
  await documentTabs(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to project…" }).click();
  const dialog = page.getByRole("dialog", { name: "Move to project" });
  await expect(
    dialog.getByRole("button", { name: "Move", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("radio", { name: "Bracket", exact: true }).check();
  await dialog.getByRole("button", { name: "Move", exact: true }).click();

  await expect(projectSelect(page)).toHaveValue("Bracket", { timeout: 30_000 });
  await ready(page);
  await expect(documentTabs(page)).toHaveCount(2);
  const moved = page.locator('[data-document-tab][aria-selected="true"]');
  const movedId = await moved.getAttribute("data-document-id");
  expect(movedId, "The copy has a new document identity").not.toBe(sourceId);
  await openVariables(page);
  await expect(variableRow(page, "variable_1")).toContainText("var1");

  await page.reload();
  await ready(page);
  await expect(projectSelect(page)).toHaveValue("Bracket");
  await expect(
    page.locator('[data-document-tab][aria-selected="true"]'),
  ).toHaveAttribute("data-document-id", movedId!);
  await openVariables(page);
  await expect(variableRow(page, "variable_1")).toContainText("var1");

  await projectSelect(page).click();
  await page.getByRole("option", { name: "My project", exact: true }).click();
  await ready(page);
  await expect(documentTabs(page)).toHaveCount(1);
  await expect(documentTabs(page)).not.toHaveAttribute(
    "data-document-id",
    sourceId!,
  );
  await openVariables(page);
  await expect(variableRow(page, "variable_1")).toHaveCount(0);
});
