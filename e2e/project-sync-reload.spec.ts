// E2E lane: the real room handshake must converge after reopening IndexedDB documents.
import { expect, test } from "@playwright/test";
import {
  documentTabs,
  mailerLog,
  openCadaraMenuItem,
  openWorkbench,
  signIn,
} from "./helpers/project-sync";

test("an uploaded account project returns to synced after reload", async ({
  page,
}, testInfo) => {
  test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");
  test.setTimeout(180_000);
  await openWorkbench(
    page,
    new URL("/app?cadTestMode=1", testInfo.project.use.baseURL!).href,
  );
  await signIn(page, `sync-reload-${Date.now()}@example.test`);
  await openCadaraMenuItem(page, "Upload to CADara…");
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Reload project");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const presence = page.locator("[data-project-presence-row]");
  await expect(presence).toHaveAttribute("data-project-sync-state", "synced", {
    timeout: 30_000,
  });
  const part = await documentTabs(page)
    .first()
    .getAttribute("data-document-id");
  await page.reload();
  await expect(documentTabs(page).first()).toHaveAttribute(
    "data-document-id",
    part!,
  );
  await expect(presence).toHaveAttribute("data-project-sync-state", "synced", {
    timeout: 30_000,
  });
});
