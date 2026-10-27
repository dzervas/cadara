import { readFile } from "node:fs/promises";

import { expect, type Page } from "@playwright/test";

import { foregroundPeerPage } from "./peer-page";

/**
 * The user-facing file workflow (File menu): Save As → "Download a copy"
 * and Open… → "Open a copy" through the browser's file chooser. The saved
 * document is returned parsed, as written to disk.
 */
/**
 * The File menu button. Exact: a substring match also finds any button whose
 * name contains "file", e.g. a feature's repair guidance ("…the profile
 * will resolve again", T17k).
 */
const fileMenu = (page: Page) =>
  page.getByRole("button", { name: "File", exact: true });

export async function saveDocumentCopy<Document = unknown>(
  page: Page,
): Promise<Document> {
  await foregroundPeerPage(page);
  await fileMenu(page).click();
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
  await foregroundPeerPage(page);
  await fileMenu(page).click();
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

/**
 * File → Save As → "Save and keep linked" (the File System Access path).
 * Headless Chromium has no usable save picker, so rows first emulate the
 * browser's picker with `emulateSaveFilePicker`.
 */
export async function saveDocumentLinked(page: Page) {
  await foregroundPeerPage(page);
  await fileMenu(page).click();
  await page.getByRole("menuitem", { name: "Save As" }).click();
  await page.getByRole("button", { name: "Save and keep linked" }).click();
}

/**
 * Environment emulation (like `context.setOffline`), not a debug action:
 * headless Chromium has no save dialog, so the browser's
 * `showSaveFilePicker` returns a real file handle named `name` in the
 * page's origin-private file system. While
 * `window.__cadaraEmulatedWriteFailure` holds a message, opening a writable
 * on any file handle rejects with it (a disk or permission failure).
 */
export async function emulateSaveFilePicker(page: Page, name: string) {
  await page.addInitScript((fileName) => {
    const target = window as unknown as {
      __cadaraEmulatedWriteFailure?: string;
      showSaveFilePicker: () => Promise<FileSystemFileHandle>;
    };
    target.showSaveFilePicker = async () =>
      (await navigator.storage.getDirectory()).getFileHandle(fileName, {
        create: true,
      });
    const createWritable = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = function (
      this: FileSystemFileHandle,
      ...options
    ) {
      const failure = target.__cadaraEmulatedWriteFailure;
      return failure === undefined
        ? createWritable.apply(this, options)
        : Promise.reject(
            new DOMException(failure, "NoModificationAllowedError"),
          );
    };
  }, name);
}

/** The text of the emulated picker's file `name` (empty if never written). */
export function readEmulatedSavedFile(page: Page, name: string) {
  return page.evaluate(async (fileName) => {
    const directory = await navigator.storage.getDirectory();
    const handle = await directory.getFileHandle(fileName, { create: true });
    return (await handle.getFile()).text();
  }, name);
}
