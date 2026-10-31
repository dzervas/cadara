import { readFileSync, statSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

// Project sync rows need a local API with the memory mailer and its stdout
// file (see account-sign-in.spec.ts). Run them with one worker: the log does
// not name a link's recipient, so concurrent sign-ins can take each other's.
export const mailerLog = process.env.CADARA_AUTH_MAILER_LOG;

export async function openWorkbench(page: Page, url: string) {
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

/** Signs in through the emailed magic link; resolves to the API origin it points at. */
export async function signIn(page: Page, email: string) {
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
  return new URL(link).origin;
}

export function syncStatus(page: Page, label: string) {
  return page.getByRole("status", { name: `Sync status: ${label}` });
}

export async function openCadaraMenuItem(page: Page, item: string) {
  await page.bringToFront();
  await page.getByRole("button", { name: "CADara", exact: true }).click();
  const menuItem = page.getByRole("menuitem", { name: item });
  await expect(menuItem).toBeEnabled({ timeout: 15_000 });
  await menuItem.click();
}

export async function createProject(page: Page, name: string) {
  await page.bringToFront();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill(name);
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue(name, { timeout: 30_000 });
}

export async function openVariables(page: Page) {
  await page.bringToFront();
  await page.locator("[data-workbench-variables-fab]").click();
  await expect(
    page.getByRole("button", { name: "Add variable", exact: true }),
  ).toBeVisible();
}

export async function addVariable(page: Page, variableId: string) {
  await page.bringToFront();
  await page.getByRole("button", { name: "Add variable", exact: true }).click();
  await page
    .getByRole("textbox", { name: `Variable name ${variableId}` })
    .press("Enter");
}

export function documentTabs(page: Page) {
  return page.locator("[data-document-tab]");
}

export function variableRow(page: Page, variableId: string) {
  return page.locator(`[data-variable-row="${variableId}"]`);
}
