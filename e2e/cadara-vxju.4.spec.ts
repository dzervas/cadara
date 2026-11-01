import { expect, test, type Page } from "@playwright/test";
import {
  addVariable,
  mailerLog,
  openVariables,
  openWorkbench,
  signIn,
  variableRow,
} from "./helpers/project-sync";

const offer = (page: Page) =>
  page.getByRole("region", { name: "Local document account offer" });

test("sign-in offers the open local document; Move creates an account project, preselects it and moves the part there", async ({
  page,
}) => {
  test.skip(!mailerLog, "Requires local memory mailer");
  test.setTimeout(180_000);
  await openWorkbench(page, "/app?cadTestMode=1");
  await expect(offer(page)).toHaveCount(0);
  const email = `move-${Date.now()}@example.test`;
  await signIn(page, email);
  await expect(offer(page)).toBeVisible();
  await offer(page)
    .getByRole("button", { name: "Move to your account →" })
    .click();
  const move = page.getByRole("dialog", {
    name: "Move to project",
    exact: true,
  });
  await expect(move).toBeVisible();
  // A link someone else sent would sign in as them: the move names the account.
  await expect(
    move.getByText(`Signed in as ${email}`, { exact: true }),
  ).toBeVisible();
  await move.getByRole("button", { name: "New project…", exact: true }).click();
  const create = page.getByRole("dialog", { name: "New project", exact: true });
  // Cancelling returns to Move unchanged.
  await create.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(create).toBeHidden();
  await expect(move).toBeVisible();
  await move.getByRole("button", { name: "New project…", exact: true }).click();
  await expect(create.getByRole("radio", { name: /^Private/ })).toBeVisible();
  await expect(create.getByRole("radio", { name: /^Local/ })).toHaveCount(0);
  const name = `Account part ${Date.now()}`;
  await create
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill(name);
  await create.getByRole("radio", { name: /^Private/ }).check();
  await create
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(create).toBeHidden({ timeout: 60_000 });
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue("My project");
  await expect(move).toBeVisible();
  await expect(move.getByRole("radio", { name, exact: true })).toBeChecked();
  await move.getByRole("button", { name: "Move", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue(name, { timeout: 60_000 });
  await expect(
    page.locator(
      '[data-document-tab-slot][data-active="true"] [data-storage-glyph="cloud"]',
    ),
  ).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

// An edit has landed (its variable row exists) and no save is pending, so a
// bar it would raise has rendered before its absence is asserted.
async function editSettled(page: Page, variableId: string) {
  await expect(variableRow(page, variableId)).toBeVisible();
  await expect(
    page.locator("[data-workbench-file-menu] [data-save-activity-ring]"),
  ).toHaveAttribute("data-save-activity-ring", "idle");
  await page.waitForTimeout(500);
}

async function expectCanvasAt(page: Page, x: number, y: number) {
  expect(
    await page.evaluate(
      ([px, py]) => document.elementFromPoint(px!, py!)?.tagName,
      [x, y],
    ),
  ).toBe("CANVAS");
}

async function closeVariables(page: Page) {
  await page.locator("[data-workbench-variables-fab]").click();
  await expect(
    page.getByRole("button", { name: "Add variable", exact: true }),
  ).toBeHidden();
}

test("first edit offers once per local document; x lasts this session and don't ask survives reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openWorkbench(page, "/app?cadTestMode=1");
  await openVariables(page);
  await addVariable(page, "variable_1");
  await editSettled(page, "variable_1");
  // The open Variables panel holds the offer like an active tool: the bar
  // never covers the panel, and returns when it closes.
  await expect(offer(page)).toHaveCount(0);
  await closeVariables(page);
  await expect(offer(page)).toBeVisible();
  await openVariables(page);
  await expect(offer(page)).toHaveCount(0);
  await closeVariables(page);
  await expect(offer(page)).toBeVisible();
  await offer(page)
    .getByRole("button", { name: "Dismiss account move offer" })
    .click();
  await openVariables(page);
  await addVariable(page, "variable_2");
  await editSettled(page, "variable_2");
  await closeVariables(page);
  await page.waitForTimeout(500);
  await expect(offer(page)).toHaveCount(0);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New", exact: true }).click();
  await openVariables(page);
  await addVariable(page, "variable_1");
  await editSettled(page, "variable_1");
  await closeVariables(page);
  await expect(offer(page)).toBeVisible();
  await offer(page)
    .getByRole("button", { name: "Don't ask for this document", exact: true })
    .click();
  await expect(offer(page)).toHaveCount(0);
  await page.reload();
  await openVariables(page);
  await addVariable(page, "variable_2");
  await editSettled(page, "variable_2");
  await closeVariables(page);
  await page.waitForTimeout(500);
  await expect(offer(page)).toHaveCount(0);
});

test("an active tool hides the bar until it ends; a held pointer keeps it from appearing but not from staying", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openWorkbench(page, "/app?cadTestMode=1");
  await openVariables(page);
  await addVariable(page, "variable_1");
  await closeVariables(page);
  await expect(offer(page)).toBeVisible();
  const canvas = { x: 1000, y: 600 };
  await expectCanvasAt(page, canvas.x, canvas.y);
  // Once shown, a click or an orbit on the canvas leaves it in place.
  await page.mouse.move(canvas.x, canvas.y);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await expect(offer(page)).toBeVisible();
  await page.mouse.up();
  const sketch = page.getByRole("button", { name: "Sketch", exact: true });
  await sketch.click();
  await expect(offer(page)).toHaveCount(0);
  // The tool ends while the pointer is held: the bar waits for the release.
  await page.mouse.move(canvas.x, canvas.y);
  await page.mouse.down();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(sketch).toHaveAttribute("aria-pressed", "false", {
      timeout: 500,
    });
  }).toPass();
  await page.waitForTimeout(500);
  await expect(offer(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(offer(page)).toBeVisible();
});
