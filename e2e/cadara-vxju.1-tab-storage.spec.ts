import { expect, test } from "@playwright/test";
import { makeAccount } from "../test/helpers/account-fixtures";
import {
  emulateSaveFilePicker,
  saveDocumentLinked,
} from "./helpers/document-files";
import { openCadaraMenuItem, openWorkbench } from "./helpers/project-sync";

test.setTimeout(90_000);

test("browser-only warning explains data loss and healthy linked files keep their file icon without a badge", async ({
  page,
}) => {
  await emulateSaveFilePicker(page, "tab-storage.cadara");
  await openWorkbench(page, "/app?cadTestMode=1");
  const tab = page.locator("[data-document-tab]");
  // The tab bar mounts once the document has opened.
  await expect(tab.locator('[data-icon="shell-warning.svg"]')).toBeVisible({
    timeout: 60_000,
  });
  await tab.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "could be lost if site data is cleared",
  );
  await expect(page.locator("[data-tab-storage-state]")).toHaveCount(0);
  await saveDocumentLinked(page);
  await expect(tab.locator('[data-storage-glyph="filesystem"]')).toBeVisible();
  await expect(page.locator("[data-tab-storage-state]")).toHaveCount(0);
});

test("upload progress/failure and sync failure drive tab badges; account-project storage survives new tabs and reload; a linked file keeps its icon there", async ({
  page,
}) => {
  await emulateSaveFilePicker(page, "account-tab.cadara");
  await page.addInitScript(() =>
    localStorage.setItem(
      "cad.projectSync.role.v1:personal/tab-project",
      JSON.stringify({ userId: "user", role: "editor" }),
    ),
  );
  const account = makeAccount();
  let uploadAttempts = 0;
  let syncAttempts = 0;
  let completeUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    completeUpload = resolve;
  });
  const accountApi = /^http:\/\/localhost:\d+\/(api\/auth\/|me$|orgs(?:\/|$))/;
  await page.route(accountApi, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    let status = 200;
    if (path === "/api/auth/get-session")
      body = {
        user: account.user,
        session: {
          id: "test-session",
          userId: account.user.id,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      };
    else if (path === "/me") body = account.me;
    else if (path === "/orgs") body = account.organizations;
    else if (path.endsWith("/sync-token")) {
      syncAttempts += 1;
      status = 403;
      body = { error: "forbidden" };
    } else if (path.endsWith("/manifest")) body = { ok: true };
    else if (path.endsWith("/projects")) {
      uploadAttempts += 1;
      if (uploadAttempts === 1) {
        await uploadGate;
        status = 503;
        body = { error: "unavailable" };
      } else
        body = {
          id: "tab-project",
          organization_id: account.organizations[0]!.id,
          name: "Tab project",
          slug: "tab-project",
          visibility: "private",
          manifest_doc_id: null,
        };
    } else {
      await route.abort();
      return;
    }
    await route.fulfill({ status, json: body });
  });
  await openWorkbench(page, "/app?cadTestMode=1");
  await openCadaraMenuItem(page, "Upload to CADara…");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.locator('[data-tab-storage-state="syncing"]')).toHaveCount(
    1,
  );
  completeUpload();
  await expect(page.locator('[data-tab-storage-state="error"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-tab-storage-state="error"]').click();
  await page.getByRole("button", { name: "Retry upload", exact: true }).click();
  await expect(page.locator('[data-storage-glyph="cloud"]')).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect.poll(() => syncAttempts).toBeGreaterThan(0);
  await expect(page.locator('[data-tab-storage-state="error"]')).toHaveCount(1);
  // Close the status popover before using the File menu.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New", exact: true }).click();
  await expect(page.locator('[data-storage-glyph="cloud"]')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('[data-storage-glyph="cloud"]')).toHaveCount(2, {
    timeout: 30_000,
  });
  await page.locator('[data-tab-storage-state="error"]').first().click();
  const before = syncAttempts;
  await page.getByRole("button", { name: "Retry sync", exact: true }).click();
  await expect.poll(() => syncAttempts).toBeGreaterThan(before);
  await page.keyboard.press("Escape");
  // Linking a file in an account project keeps the linked-file icon; the
  // project's sync error still badges that tab, with the sync fix.
  await saveDocumentLinked(page);
  await expect(page.locator('[data-storage-glyph="filesystem"]')).toHaveCount(
    1,
  );
  await expect(page.locator('[data-storage-glyph="cloud"]')).toHaveCount(1);
  await expect(page.locator('[data-tab-storage-state="error"]')).toHaveCount(2);
  await page
    .locator('[data-document-tab-slot][data-active="true"]')
    .locator('[data-tab-storage-state="error"]')
    .click();
  await expect(
    page.getByRole("button", { name: "Retry sync", exact: true }),
  ).toBeVisible();
});
