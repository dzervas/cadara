import { expect, test, type Page } from "@playwright/test";

import {
  readEmulatedSavedFile,
  saveDocumentCopy,
} from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

// Lane: e2e (docs/testing.md). Seam: a .cadara file the operating system
// opens in the installed app (manifest `file_handlers`). Real OS
// integration cannot be automated, so the browser's `launchQueue` is
// emulated: the app's consumer is captured and handed a real file handle in
// the origin-private file system, whose `readwrite` permission answers come
// from the row (environment emulation, like `emulateSaveFilePicker`).
// Branches: (b) without write access a browser copy opens at once with a
// persistent "Allow saving" offer whose click links the tab and writes the
// current state to the file; (c) denying or dismissing it keeps the browser
// copy; (d) closing the launched tab withdraws the offer, so nothing is
// written from a document no tab shows. Branch (a), write access already granted, opens through the linked
// Open… path and is proven in
// src/workbench/document/document-file-actions.spec.ts only: a tab that
// opens already linked makes the document-sync worker read the bound handle
// back from IndexedDB, and this Chromium build (1243) crashes the browser
// when a worker reads an origin-private file system handle from IndexedDB,
// the only kind of handle a headless row can create.

const FILE_NAME = "launched.cadara";

type PermissionState = "granted" | "denied" | "prompt";

/**
 * Captures the app's `launchQueue` consumer and answers `readwrite`
 * permission queries/requests on file handles with `query`/`request` (a
 * granted request also answers later queries).
 */
async function emulateLaunchQueue(
  page: Page,
  permission: { query: PermissionState; request: PermissionState },
) {
  await page.addInitScript((initial) => {
    type Consumer = (params: { files: FileSystemFileHandle[] }) => void;
    const target = window as unknown as {
      __cadaraLaunchConsumer?: Consumer;
      __cadaraFilePermission: typeof initial;
    };
    target.__cadaraFilePermission = { ...initial };
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: {
        setConsumer(consumer: Consumer) {
          target.__cadaraLaunchConsumer = consumer;
        },
      },
    });
    const prototype = FileSystemFileHandle.prototype as unknown as {
      queryPermission(descriptor: { mode: string }): Promise<string>;
      requestPermission(descriptor: { mode: string }): Promise<string>;
    };
    prototype.queryPermission = async ({ mode }) =>
      mode === "readwrite" ? target.__cadaraFilePermission.query : "granted";
    prototype.requestPermission = async ({ mode }) => {
      if (mode !== "readwrite") return "granted";
      const answer = target.__cadaraFilePermission.request;
      if (answer === "granted") target.__cadaraFilePermission.query = answer;
      return answer;
    };
  }, permission);
}

/** Writes `contents` to the OPFS file and launches the app with it. */
async function launchWithFile(page: Page, contents: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            typeof (window as { __cadaraLaunchConsumer?: unknown })
              .__cadaraLaunchConsumer === "function",
        ),
      { message: "the app consumes the launch queue" },
    )
    .toBe(true);
  await page.evaluate(
    async ({ name, text }) => {
      const directory = await navigator.storage.getDirectory();
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      (
        window as unknown as {
          __cadaraLaunchConsumer: (params: {
            files: FileSystemFileHandle[];
          }) => void;
        }
      ).__cadaraLaunchConsumer({ files: [handle] });
    },
    { name: FILE_NAME, text: contents },
  );
}

/** A valid document named "Launched part", as a file on disk would hold. */
async function launchedDocument(page: Page) {
  const document = await saveDocumentCopy<Record<string, unknown>>(page);
  return JSON.stringify({ ...document, name: "Launched part" });
}

const activeTab = (page: Page) =>
  page.locator('[data-document-tab][aria-selected="true"]');

async function expectActiveLaunchedTab(
  page: Page,
  storage: "browser" | "filesystem",
) {
  await expect(activeTab(page)).toContainText("Launched part", {
    timeout: 15_000,
  });
  await expect(
    activeTab(page).locator(`[data-storage-glyph="${storage}"]`),
  ).toHaveCount(1, { timeout: 15_000 });
}

const offer = (page: Page) =>
  page.getByRole("status").filter({
    hasText: `${FILE_NAME} opened from your computer. Allow CADara to save changes back to this file?`,
  });
const kept = (page: Page) =>
  page.getByRole("status").filter({
    hasText: "Changes are kept in CADara. Use Save As to write them to a file.",
  });

test.setTimeout(120_000);

test("(b) a launched file without write access opens as a browser copy at once; Allow saving links the tab and writes the current state to the file", async ({
  page,
}) => {
  await emulateLaunchQueue(page, { query: "prompt", request: "granted" });
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const original = await launchedDocument(page);
  await launchWithFile(page, original);

  await expectActiveLaunchedTab(page, "browser");
  await expect(offer(page)).toBeVisible();
  // Info notices auto-dismiss after 5 s; the offer waits for an answer.
  await page.waitForTimeout(6_000);
  await expect(offer(page)).toBeVisible();

  await offer(page).getByRole("button", { name: "Allow saving" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: `Saved ${FILE_NAME}. Future changes will save to that file.`,
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(offer(page)).toHaveCount(0);
  await expectActiveLaunchedTab(page, "filesystem");
  const tabDocumentId = await activeTab(page).getAttribute("data-document-id");
  const written = JSON.parse(await readEmulatedSavedFile(page, FILE_NAME)) as {
    documentId: string;
    name: string;
  };
  expect(written, "the tab's current state was written").toMatchObject({
    documentId: tabDocumentId,
    name: "Launched part",
  });
  expect(
    (JSON.parse(original) as { documentId: string }).documentId,
    "premise: the file held another document identity before",
  ).not.toBe(tabDocumentId);
});

test("(c) denying write access, or dismissing the offer, keeps the browser copy and says how to save it", async ({
  page,
}) => {
  await emulateLaunchQueue(page, { query: "prompt", request: "denied" });
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const original = await launchedDocument(page);

  await launchWithFile(page, original);
  await expectActiveLaunchedTab(page, "browser");
  await offer(page).getByRole("button", { name: "Allow saving" }).click();
  await expect(kept(page)).toBeVisible({ timeout: 15_000 });
  await expect(offer(page)).toHaveCount(0);
  await expectActiveLaunchedTab(page, "browser");
  expect(await readEmulatedSavedFile(page, FILE_NAME)).toBe(original);

  // Dismissing the offer is a "no" too.
  await expect(kept(page)).toHaveCount(0, { timeout: 15_000 });
  await launchWithFile(page, original);
  await offer(page)
    .getByRole("button", { name: "Dismiss notification" })
    .click();
  await expect(kept(page)).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
  await expectActiveLaunchedTab(page, "browser");
});

test("(d) closing the launched tab withdraws the Allow saving offer and leaves the file untouched", async ({
  page,
}) => {
  await emulateLaunchQueue(page, { query: "prompt", request: "granted" });
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const original = await launchedDocument(page);
  await launchWithFile(page, original);
  await expectActiveLaunchedTab(page, "browser");
  await expect(offer(page)).toBeVisible();

  await activeTab(page)
    .getByRole("button", { name: "Close Launched part" })
    .click();
  await page.getByRole("button", { name: "Close without saving" }).click();
  await expect(
    page.locator("[data-document-tab]").filter({ hasText: "Launched part" }),
  ).toHaveCount(0);
  await expect(offer(page)).toHaveCount(0);
  expect(await readEmulatedSavedFile(page, FILE_NAME)).toBe(original);
});
