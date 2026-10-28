// Document rows of `bun run bench:mutation`: body rename/colour, variables,
// undo/redo of a rename, save, export, reload, new document and a peer
// session's write. variableAdd, reload, newDocument, peerWrite and the
// export rows are gated on the debug platform with the other new rows.
import type { Download, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  firstBodyRow,
  historySignature,
  now,
  openDocumentCopy,
  openFixture,
  partsTree,
  redoButton,
  renameBody,
  settleBeforeCleanup,
  timedSample,
  timelineCount,
  undoButton,
  undoUntimed,
  waitForHistoryChange,
  waitForOccQuiet,
  waitForRowLabel,
  waitInPage,
  SAMPLE_TIMEOUT_MS,
  type RowPreparation,
  type Session,
} from "./rows-shared.ts";

export const DOCUMENT_ROW_KINDS = [
  "rename",
  "colour",
  "variableEdit",
  "undo",
  "redo",
  "save",
  "variableAdd",
  "reload",
  "newDocument",
  "peerWrite",
  "exportStep",
  "exportStl",
] as const;
export type DocumentRowKind = (typeof DOCUMENT_ROW_KINDS)[number];

/** Untimed rename used as setup for undo/redo rows. */
async function renameUntimed(page: Page, target: string, next: string) {
  const before = await historySignature(page);
  const since = now();
  const input = await renameBody(page, target, next);
  await input.press("Enter");
  await waitForRowLabel(page, target, next);
  await waitForHistoryChange(page, before, since);
}

/** The app path of a local peer sync session (acceptance.ts peerSyncPath). */
function peerSyncPath(channel: string, databaseName: string) {
  const params = new URLSearchParams({
    cadLocalPeerSync: "1",
    cadLocalPeerSyncChannel: channel,
    cadRepositoryDbName: databaseName,
  });
  return `/app?${params}`;
}

/** The opened document is shown: no pending render, `count` timeline items, a body row. */
const documentShown = (count: number) =>
  !document.querySelector('[aria-label="Initial model render pending"]') &&
  document.querySelector('[data-parts-tree-target^="body:"]') !== null &&
  document.querySelectorAll(
    "button[data-history-feature-id], button[data-history-sketch-id]",
  ).length === count;

/**
 * Reflected/persisted of a download gesture: the browser received the
 * download, then its file is written. `arm()` must run inside the act,
 * before the click that starts the download.
 */
function downloadSignals(page: Page) {
  let download: Promise<Download> | null = null;
  let written: Promise<number> | null = null;
  return {
    arm: () => {
      download = page.waitForEvent("download", { timeout: SAMPLE_TIMEOUT_MS });
    },
    received: async () => {
      const file = await download!;
      const receivedAt = now();
      written = file.path().then(() => now());
      return receivedAt;
    },
    written: () => written!,
  };
}

export async function prepareDocumentRow(
  session: Session,
  kind: DocumentRowKind,
): Promise<RowPreparation> {
  const { page } = session;
  switch (kind) {
    case "rename": {
      const body = await firstBodyRow(page);
      return async (_session, index) => {
        const next = `${body.label} r${index}`;
        const input = await renameBody(page, body.target, next);
        return timedSample(
          session,
          () => input.press("Enter"),
          () => waitForRowLabel(page, body.target, next),
        );
      };
    }
    case "colour": {
      const body = await firstBodyRow(page);
      const row = partsTree(page).locator(
        `[data-parts-tree-target="${body.target}"]`,
      );
      return async () => {
        await row.click({ button: "right" });
        const group = page.getByRole("group", { name: "Body color" });
        await group.waitFor();
        const swatch = group
          .locator('[role="menuitemradio"]:not([aria-checked="true"])')
          .first();
        const swatchName = (await swatch.getAttribute("aria-label"))!;
        // No DOM signal shows the applied appearance (the menu closes before
        // the mutation is dispatched), so reflected is null; the undo strip
        // still times persistence.
        const timing = await timedSample(session, () => swatch.click(), null);
        // Proof the colour was applied: the reopened menu checks the swatch.
        await row.click({ button: "right" });
        await page
          .getByRole("group", { name: "Body color" })
          .locator(
            `[role="menuitemradio"][aria-label="${swatchName}"][aria-checked="true"]`,
          )
          .waitFor({ timeout: SAMPLE_TIMEOUT_MS });
        await page.keyboard.press("Escape");
        await page
          .getByRole("group", { name: "Body color" })
          .waitFor({ state: "detached" });
        return timing;
      };
    }
    case "variableEdit": {
      const name = session.fixture.variable!;
      await page.locator("[data-workbench-variables-fab]").click();
      const panel = page.locator("[data-workbench-variables-panel]");
      const editButton = panel.getByRole("button", {
        name: `Edit variable ${name}`,
      });
      await editButton.waitFor({ timeout: SAMPLE_TIMEOUT_MS });
      const variableId = await editButton
        .locator("xpath=ancestor::*[@data-variable-row][1]")
        .getAttribute("data-variable-row");
      const expression = panel.locator(
        `[data-variable-expression="${variableId}"]`,
      );
      const original = Number.parseFloat(await expression.innerText());
      return async (_session, index) => {
        const next = String(
          Number((index % 2 === 0 ? original * 1.1 : original).toFixed(4)),
        );
        await editButton.click();
        await page.keyboard.press("F2");
        const input = panel.getByLabel(`Variable value ${variableId}`);
        await input.evaluate((element, value) => {
          const setValue = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!;
          setValue.call(element, value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
        }, next);
        return timedSample(
          session,
          () => input.press("Enter"),
          () =>
            waitInPage(
              page,
              ({ id, value }: { id: string; value: string }) =>
                document
                  .querySelector(`[data-variable-expression="${id}"]`)
                  ?.textContent?.trim() === value,
              { id: variableId!, value: next },
            ),
        );
      };
    }
    case "variableAdd": {
      await page.locator("[data-workbench-variables-fab]").click();
      const panel = page.locator("[data-workbench-variables-panel]");
      const add = panel.getByRole("button", { name: "Add variable" });
      await add.waitFor({ timeout: SAMPLE_TIMEOUT_MS });
      const rows = panel.locator("[data-variable-row]");
      return async () => {
        const count = await rows.count();
        const timing = await timedSample(
          session,
          () => add.click(),
          () =>
            waitInPage(
              page,
              (count: number) =>
                document.querySelectorAll(
                  "[data-workbench-variables-panel] [data-variable-row]",
                ).length > count,
              count,
            ),
        );
        await settleBeforeCleanup(page, timing);
        // Leave a value editor the new row may have opened, then undo the add.
        await page.keyboard.press("Escape");
        await undoUntimed(page);
        await waitInPage(
          page,
          (count: number) =>
            document.querySelectorAll(
              "[data-workbench-variables-panel] [data-variable-row]",
            ).length === count,
          count,
        );
        return timing;
      };
    }
    case "undo":
    case "redo": {
      const body = await firstBodyRow(page);
      // The undone action is an untimed body rename before every sample.
      return async (_session, index) => {
        const row = partsTree(page).locator(
          `[data-parts-tree-target="${body.target}"]`,
        );
        const original = (await row.innerText()).trim();
        const renamed = `${body.label} u${index}`;
        await renameUntimed(page, body.target, renamed);
        if (kind === "undo") {
          return timedSample(
            session,
            () => undoButton(page).click(),
            () => waitForRowLabel(page, body.target, original),
          );
        }
        const before = await historySignature(page);
        const since = now();
        await undoButton(page).click();
        await waitForRowLabel(page, body.target, original);
        await waitForHistoryChange(page, before, since);
        return timedSample(
          session,
          () => redoButton(page).click(),
          () => waitForRowLabel(page, body.target, renamed),
        );
      };
    }
    case "save":
      return async () => {
        await page.getByRole("button", { name: "File", exact: true }).click();
        await page.getByRole("menuitem", { name: "Save As" }).click();
        const downloadCopy = page.getByRole("button", {
          name: "Download a copy",
        });
        await downloadCopy.waitFor();
        const signals = downloadSignals(page);
        // Reflected: the browser received the download; persisted: its file is written.
        return timedSample(
          session,
          async () => {
            signals.arm();
            await downloadCopy.click();
          },
          signals.received,
          signals.written,
        );
      };
    case "exportStep":
    case "exportStl": {
      // The File menu has no export; a body exports from its Parts &
      // Objects menu through a format dialog. Its Export button (one click
      // and a download) is the timed gesture; the dialog is setup.
      const format = kind === "exportStep" ? "STEP" : "STL";
      const body = await firstBodyRow(page);
      const row = partsTree(page).locator(
        `[data-parts-tree-target="${body.target}"]`,
      );
      return async () => {
        await row.click({ button: "right", force: true });
        await page
          .getByRole("menuitem", { name: "Export", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: `Export ${body.label}`,
        });
        await dialog.waitFor({ timeout: SAMPLE_TIMEOUT_MS });
        const radio = dialog.getByRole("radio", { name: format, exact: true });
        if (!(await radio.isChecked())) {
          await dialog.getByText(format, { exact: true }).click();
          await page.waitForFunction(
            (format) =>
              Array.from(
                document.querySelectorAll<HTMLInputElement>(
                  '[role="dialog"] input[type="radio"]',
                ),
              ).some(
                (input) =>
                  input.checked &&
                  input.labels?.[0]?.textContent?.trim() === format,
              ),
            format,
            { timeout: SAMPLE_TIMEOUT_MS },
          );
        }
        const signals = downloadSignals(page);
        const timing = await timedSample(
          session,
          async () => {
            signals.arm();
            await dialog
              .getByRole("button", { name: "Export", exact: true })
              .click();
          },
          signals.received,
          signals.written,
        );
        await dialog.waitFor({ state: "detached", timeout: SAMPLE_TIMEOUT_MS });
        return timing;
      };
    }
    case "reload": {
      // With the repository on, the opened copy is stored: a reload is the
      // second-open cost of the same document.
      const count = await page.evaluate(timelineCount);
      return async () =>
        timedSample(
          session,
          async () => void (await page.reload()),
          () => waitInPage(page, documentShown, count),
          "none",
        );
    }
    case "newDocument": {
      const count = await page.evaluate(timelineCount);
      return async () => {
        await page.getByRole("button", { name: "File", exact: true }).click();
        const item = page.getByRole("menuitem", { name: "New", exact: true });
        await item.waitFor();
        const timing = await timedSample(
          session,
          () => item.click(),
          () =>
            waitInPage(
              page,
              () =>
                document.querySelectorAll(
                  "button[data-history-feature-id], button[data-history-sketch-id]",
                ).length === 0 &&
                document.querySelector('[data-parts-tree-target^="body:"]') ===
                  null &&
                String(
                  (
                    window as unknown as {
                      __cadaraDebug?: {
                        getState(): { machineState: string } | null;
                      };
                    }
                  ).__cadaraDebug?.getState()?.machineState ?? "",
                ).includes("idle"),
              null,
            ),
          "none",
        );
        await settleBeforeCleanup(page, timing);
        // Untimed: open the fixture again for the next sample.
        await waitForOccQuiet(page);
        await openDocumentCopy(page, session.fixture.name, session.document);
        await waitInPage(page, documentShown, count);
        return timing;
      };
    }
    case "peerWrite": {
      // Two sessions of one document on a local peer sync channel
      // (acceptance.ts openTwoSessions): this page opens the copy, a second
      // page of the context loads it from the channel and renames a body.
      const channel = `bench-${randomUUID()}`;
      const count = await page.evaluate(timelineCount);
      await openFixture(
        page,
        session.baseUrl,
        session.fixture.name,
        session.document,
        peerSyncPath(channel, `${channel}-a`),
      );
      await waitForOccQuiet(page);
      const peer = await page.context().newPage();
      await peer.goto(
        `${session.baseUrl}${peerSyncPath(channel, `${channel}-b`)}`,
      );
      try {
        await waitInPage(peer, documentShown, count);
      } catch (error) {
        const shown = await peer.evaluate(timelineCount);
        return `the peer page never showed the opened copy (${shown} of ${count} timeline items): ${(error as Error).message.split("\n")[0]}`;
      }
      await waitForOccQuiet(peer);
      const body = await firstBodyRow(page);
      return async (_session, index) => {
        const next = `${body.label} p${index}`;
        await peer.bringToFront();
        const input = await renameBody(peer, body.target, next);
        // The observing page renders in front; the peer's Enter is the write.
        await page.bringToFront();
        if (!(await input.isVisible())) {
          throw new Error(
            "the peer's rename input closed when the observing page came to the front",
          );
        }
        const peerBefore = await historySignature(peer);
        const since = now();
        return timedSample(
          session,
          () => input.press("Enter"),
          () => waitForRowLabel(page, body.target, next),
          () => waitForHistoryChange(peer, peerBefore, since),
        );
      };
    }
  }
}
