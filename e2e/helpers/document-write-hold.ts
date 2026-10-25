import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __e2eHoldDocumentWrites?: boolean;
    __e2eHeldDocumentWrites?: (() => void)[];
  }
}

/**
 * Holds the document sync worker's repository writes while
 * `__e2eHoldDocumentWrites` is set: the edit is accepted but not yet stored,
 * so the local save stays underway until `releaseDocumentWrites`.
 */
export async function installDocumentWriteHold(page: Page) {
  await page.addInitScript(() => {
    const postMessage = Worker.prototype.postMessage;
    window.__e2eHeldDocumentWrites = [];
    Worker.prototype.postMessage = function (
      this: Worker,
      ...args: Parameters<Worker["postMessage"]>
    ) {
      const message = args[0] as { kind?: unknown; expected?: unknown } | null;
      if (
        window.__e2eHoldDocumentWrites &&
        message?.kind === "mutate" &&
        message.expected !== undefined
      ) {
        window.__e2eHeldDocumentWrites!.push(() =>
          postMessage.apply(this, args),
        );
        return;
      }
      postMessage.apply(this, args);
    } as Worker["postMessage"];
  });
}

export async function holdDocumentWrites(page: Page) {
  await page.evaluate(() => {
    window.__e2eHoldDocumentWrites = true;
  });
}

export async function countHeldDocumentWrites(page: Page) {
  return page.evaluate(() => window.__e2eHeldDocumentWrites!.length);
}

export async function releaseDocumentWrites(page: Page) {
  await page.evaluate(() => {
    window.__e2eHoldDocumentWrites = false;
    for (const write of window.__e2eHeldDocumentWrites!.splice(0)) write();
  });
}
