import { readFile } from "node:fs/promises";

import { expect, type Page } from "@playwright/test";

/**
 * The user-facing file workflow (File menu): Save As → "Download a copy"
 * and Open… → "Open a copy" through the browser's file chooser. The saved
 * document is returned parsed, as written to disk.
 */
export async function saveDocumentCopy<Document = unknown>(
  page: Page,
): Promise<Document> {
  await page.getByRole("button", { name: "File" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Save As" }).click();
  await page.getByRole("button", { name: "Download a copy" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Could not read the saved cadara document.");
  return JSON.parse(await readFile(path, "utf8")) as Document;
}

export async function openDocumentCopy(
  page: Page,
  document: unknown,
  name: string,
) {
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Open..." }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open a copy" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name,
    mimeType: "application/vnd.cadara+json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(
    page.getByRole("status").filter({ hasText: `Opened ${name}.` }),
  ).toBeVisible({ timeout: 15_000 });
}
