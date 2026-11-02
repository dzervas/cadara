import { readFileSync, statSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { SIGN_IN_OFFER_KEY } from "../../src/application/account/sign-in-offer";

// Project sync rows need a local API with the memory mailer and its stdout
// file (see account-sign-in.spec.ts). Run them with one worker: the log does
// not name a link's recipient, so concurrent sign-ins can take each other's.
export const mailerLog = process.env.CADARA_AUTH_MAILER_LOG;

export async function openWorkbench(
  page: Page,
  url: string,
  offerSignIn = false,
) {
  // Explicitly-created peer contexts do not inherit the configured storageState.
  if (!offerSignIn)
    await page.addInitScript(
      (key) => localStorage.setItem(key, "1"),
      SIGN_IN_OFFER_KEY,
    );
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

/**
 * Signs in through the emailed magic link; resolves to the API origin it
 * points at. `modalOpen`: an account-gated action already opened the modal.
 */
export async function signIn(page: Page, email: string, modalOpen = false) {
  const logOffset = statSync(mailerLog!).size;
  if (!modalOpen)
    await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  let link = "";
  await expect
    .poll(
      () => {
        // statSync reports byte offsets, not decoded character offsets.
        const output = readFileSync(mailerLog!)
          .subarray(logOffset)
          .toString("utf8");
        link = output.match(/Magic link: (http\S+)/)?.[1] ?? "";
        return Boolean(link);
      },
      { message: "Memory mailer emitted a sign-in link", timeout: 30_000 },
    )
    .toBe(true);
  const landing = await page.context().newPage();
  await landing.goto(link);
  await expect(landing.getByRole("status")).toHaveText(
    "Signed in, you can close this tab",
  );
  await expect(landing.getByText(`as ${email}`, { exact: true })).toBeVisible();
  await landing.close();
  await page.bringToFront();
  await expect(
    page.getByRole("dialog", { name: "Sign in to CADara" }),
  ).toHaveCount(0);
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

/** Creates a project on this device (the New project modal's Local card). */
export async function createProject(page: Page, name: string) {
  await page.bringToFront();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill(name);
  // A signed-in owner gets Private preselected; these rows upload explicitly.
  await page.getByRole("radio", { name: /^Local/ }).check();
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
