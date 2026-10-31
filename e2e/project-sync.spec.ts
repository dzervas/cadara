import { readFileSync, statSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Opt-in: this row needs a local API with the memory mailer and its stdout
// file, like account-sign-in.spec.ts.
const mailerLog = process.env.CADARA_AUTH_MAILER_LOG;

test.setTimeout(240_000);

async function openWorkbench(page: Page, url: string) {
  await page.goto(url);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__cadaraDebug?.getState()?.machineState ?? "",
        ),
      { timeout: 60_000 },
    )
    .not.toBe("");
}

async function signIn(page: Page, email: string) {
  const logOffset = statSync(mailerLog!).size;
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Email sign-in link", exact: true })
    .click();
  let link = "";
  await expect
    .poll(
      () => {
        const output = readFileSync(mailerLog!, "utf8").slice(logOffset);
        link = output.match(/Magic link: (http\S+)/)?.[1] ?? "";
        return Boolean(link);
      },
      { message: "Memory mailer emitted a sign-in link", timeout: 30_000 },
    )
    .toBe(true);
  await openWorkbench(page, link);
}

function syncStatus(page: Page, label: string) {
  return page.getByRole("status", { name: `Sync status: ${label}` });
}

async function openCadaraMenuItem(page: Page, item: string) {
  await page.bringToFront();
  await page.getByRole("button", { name: "CADara", exact: true }).click();
  const menuItem = page.getByRole("menuitem", { name: item });
  await expect(menuItem).toBeEnabled({ timeout: 15_000 });
  await menuItem.click();
}

async function openVariables(page: Page) {
  await page.bringToFront();
  await page.locator("[data-workbench-variables-fab]").click();
  await expect(
    page.getByRole("button", { name: "Add variable", exact: true }),
  ).toBeVisible();
}

async function addVariable(page: Page, variableId: string) {
  await page.bringToFront();
  await page.getByRole("button", { name: "Add variable", exact: true }).click();
  await page
    .getByRole("textbox", { name: `Variable name ${variableId}` })
    .press("Enter");
}

function documentTabs(page: Page) {
  return page.locator("[data-document-tab]");
}

async function newPart(page: Page) {
  await page.bringToFront();
  const before = await documentTabs(page).count();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New", exact: true }).click();
  await expect(documentTabs(page)).toHaveCount(before + 1);
}

function variableRow(page: Page, variableId: string) {
  return page.locator(`[data-variable-row="${variableId}"]`);
}

test("two signed-in browsers edit one synced project live, see each other, and merge offline work", async ({
  browser,
}, testInfo) => {
  test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");
  const baseURL = testInfo.project.use.baseURL!;
  const appUrl = new URL("/app?cadTestMode=1", baseURL).href;
  const email = `cadara-sync-${Date.now()}@example.test`;
  const projectName = `Shared bracket ${Date.now()}`;
  const ownerContext = await browser.newContext({ baseURL });
  const guestContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await openWorkbench(owner, appUrl);
    await signIn(owner, email);
    await openWorkbench(guest, appUrl);
    await signIn(guest, email);

    // The owner uploads its browser's first project; the guest browser has a
    // first project of its own, so their first parts must not share an id.
    await openCadaraMenuItem(owner, "Upload to CADara…");
    await owner
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(projectName);
    await owner.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(syncStatus(owner, "Synced")).toBeVisible({ timeout: 30_000 });

    // The second browser downloads it from the service.
    await openCadaraMenuItem(guest, "Open from CADara…");
    await guest
      .getByRole("list", { name: "CADara projects" })
      .getByRole("listitem")
      .filter({ hasText: projectName })
      .click();
    await expect(syncStatus(guest, "Synced")).toBeVisible({ timeout: 60_000 });
    const ownerParts = await documentTabs(owner).evaluateAll((tabs) =>
      tabs.map((tab) => tab.getAttribute("data-document-id")),
    );
    await expect
      .poll(
        () =>
          documentTabs(guest).evaluateAll((tabs) =>
            tabs.map((tab) => tab.getAttribute("data-document-id")),
          ),
        { message: "the guest shows the owner's first part", timeout: 30_000 },
      )
      .toEqual(ownerParts);

    // Presence: each sees the other participant.
    for (const page of [owner, guest])
      await expect(
        page
          .getByRole("list", { name: "People in this project" })
          .getByRole("listitem"),
      ).toHaveCount(1, { timeout: 30_000 });

    // Live edits in both directions.
    await openVariables(owner);
    await openVariables(guest);
    await addVariable(owner, "variable_1");
    await expect(variableRow(guest, "variable_1")).toContainText("var1", {
      timeout: 30_000,
    });
    await guest.bringToFront();
    await variableRow(guest, "variable_1").dblclick();
    await guest
      .getByRole("textbox", { name: "Variable name variable_1" })
      .fill("width");
    await guest.keyboard.press("Enter");
    await expect(variableRow(owner, "variable_1")).toContainText("width", {
      timeout: 30_000,
    });

    // The owner works offline while the guest keeps editing.
    await ownerContext.setOffline(true);
    await expect(syncStatus(owner, "Offline")).toBeVisible({ timeout: 30_000 });
    await addVariable(owner, "variable_2");
    await expect(variableRow(owner, "variable_2")).toBeVisible();
    await guest.bringToFront();
    await variableRow(guest, "variable_1").dblclick();
    await guest
      .getByRole("textbox", { name: "Variable name variable_1" })
      .fill("depth");
    await guest.keyboard.press("Enter");
    await expect(variableRow(guest, "variable_1")).toContainText("depth");
    await expect(variableRow(guest, "variable_2")).toHaveCount(0);
    await expect(variableRow(owner, "variable_1")).toContainText("width");

    // Back online, both browsers converge on the merged document.
    await ownerContext.setOffline(false);
    await expect(syncStatus(owner, "Synced")).toBeVisible({ timeout: 60_000 });
    for (const page of [owner, guest]) {
      await expect(variableRow(page, "variable_2")).toBeVisible({
        timeout: 30_000,
      });
      await expect(variableRow(page, "variable_1")).toContainText("depth", {
        timeout: 30_000,
      });
    }

    // Both add a part while the owner is offline, and the guest switches
    // tabs: after reconnecting, neither part list overwrites the other.
    await ownerContext.setOffline(true);
    await expect(syncStatus(owner, "Offline")).toBeVisible({ timeout: 30_000 });
    await newPart(owner);
    await newPart(guest);
    await documentTabs(guest).first().click();
    await ownerContext.setOffline(false);
    for (const page of [owner, guest])
      await expect(documentTabs(page)).toHaveCount(3, { timeout: 60_000 });
    await owner.bringToFront();
    await documentTabs(owner).first().click();
    await expect(syncStatus(owner, "Synced")).toBeVisible({ timeout: 60_000 });
    for (const page of [owner, guest])
      await expect(documentTabs(page)).toHaveCount(3);
  } finally {
    await ownerContext.close();
    await guestContext.close();
  }
});
