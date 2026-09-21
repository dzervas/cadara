import { expect, test, type Page } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 960 } });

test("two sessions keep drafts private, publish once, retain reentry history, and block conflicting compensation", async ({
  context,
}, testInfo) => {
  const channel = `cad-e2e-sketch-publication-${testInfo.workerIndex}-${Date.now()}`;
  const first = await context.newPage();
  const second = await context.newPage();
  const firstWorkbench = new SketchWorkbenchHarness(first);
  const secondWorkbench = new SketchWorkbenchHarness(second);

  await firstWorkbench.openPreservingStorage(syncUrl(channel, `${channel}-a`));
  await waitForRepositoryUrl(first, channel);
  await secondWorkbench.openPreservingStorage(syncUrl(channel, `${channel}-b`));

  await firstWorkbench.activateTool("Start a new sketch.");
  await first
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await firstWorkbench.activateTool("Create line geometry.");
  const firstCanvas = first.locator("main canvas").first();
  await firstCanvas.click({ position: { x: 360, y: 260 }, force: true });
  await firstCanvas.click({ position: { x: 420, y: 320 }, force: true });
  await expect
    .poll(() => firstWorkbench.currentSketchSession())
    .toContain("1 entities staged");

  await refreshDocument(second);
  await expect.poll(() => revisionLabel(second)).toBe("rev_0001");
  await expect(
    second.getByRole("button", { name: /Sketch Draft.*reopen/ }),
  ).toHaveCount(0);

  await firstWorkbench.activateTool("Exit the active sketch.");
  await firstWorkbench.expectMachine("idle");
  const firstPublishedRevision = await revisionLabel(first);
  await refreshDocument(second);
  const published = second.getByRole("button", {
    name: "Select Sketch Draft. Double-click to reopen.",
  });
  await expect(published).toBeVisible({ timeout: 30_000 });

  await published.dblclick({ force: true });
  await secondWorkbench.expectSketchSessionActive();
  await second.getByRole("button", { name: "Select Line 1." }).click();
  await second.keyboard.press("Delete");
  await expect(
    second.getByRole("button", { name: "Undo Delete Sketch Item" }),
  ).toBeVisible();
  await secondWorkbench.activateTool("Create line geometry.");
  const secondCanvas = second.locator("main canvas").first();
  await secondCanvas.click({ position: { x: 500, y: 300 }, force: true });
  await secondCanvas.click({ position: { x: 570, y: 350 }, force: true });
  await secondWorkbench.activateTool("Exit the active sketch.");
  await secondWorkbench.expectMachine("idle");

  await refreshDocument(first);
  await expect
    .poll(() => revisionLabel(first), { timeout: 30_000 })
    .not.toBe(firstPublishedRevision);
  await first
    .getByRole("button", {
      name: "Select Sketch Draft. Double-click to reopen.",
    })
    .dblclick({ force: true });
  await firstWorkbench.expectSketchSessionActive();
  const retainedAction = first
    .locator(
      '[data-history-action-direction="undo"][data-history-action-sequence]',
    )
    .first();
  await expect(retainedAction).toBeVisible();
  await retainedAction.click();
  await expect(
    first.getByText(/Cannot undo: expected-state-changed/),
  ).toBeVisible({ timeout: 10_000 });
  await expect(retainedAction).toBeVisible();

  await second.close();
  await first.close();
});

test("document Undo/Redo preserves the original identity and later sketch history stays independent", async ({
  page,
}, testInfo) => {
  const databaseName = `cad-e2e-sketch-identity-${testInfo.workerIndex}-${Date.now()}`;
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.openPreservingStorage(
    `/?${new URLSearchParams({ cadRepositoryDbName: databaseName, cadTestMode: "1" })}`,
  );

  const createPublishedLine = async (offset: number) => {
    await workbench.activateTool("Start a new sketch.");
    await page.getByRole("button", { name: /Top Plane/ }).first().click();
    await workbench.activateTool("Create line geometry.");
    const canvas = page.locator("main canvas").first();
    await canvas.click({ position: { x: 360 + offset, y: 260 }, force: true });
    await canvas.click({ position: { x: 420 + offset, y: 320 }, force: true });
    await workbench.activateTool("Exit the active sketch.");
    await workbench.expectMachine("idle");
  };

  await createPublishedLine(0);
  const firstSketch = page.getByRole("button", {
    name: "Select Sketch Draft. Double-click to reopen.",
  });
  await expect(firstSketch).toBeVisible();
  const firstSketchId = await firstSketch.getAttribute("data-history-sketch-id");
  expect(firstSketchId).toMatch(/^sketch_[0-9a-f-]{36}$/);

  const cadToolbar = page.getByRole("toolbar", { name: "CAD tools" });
  await cadToolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(firstSketch).toHaveCount(0, { timeout: 30_000 });

  await cadToolbar.getByRole("button", { name: "Redo", exact: true }).click();
  const restoredFirst = page.getByRole("button", {
    name: "Select Sketch Draft. Double-click to reopen.",
  });
  await expect(restoredFirst).toBeVisible({ timeout: 30_000 });
  expect(await restoredFirst.getAttribute("data-history-sketch-id")).toBe(
    firstSketchId,
  );

  await cadToolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(restoredFirst).toHaveCount(0, { timeout: 30_000 });
  await createPublishedLine(80);
  const secondSketch = page.getByRole("button", {
    name: "Select Sketch Draft. Double-click to reopen.",
  });
  await expect(secondSketch).toBeVisible({ timeout: 30_000 });
  const secondSketchId = await secondSketch.getAttribute(
    "data-history-sketch-id",
  );
  expect(secondSketchId).toMatch(/^sketch_[0-9a-f-]{36}$/);
  expect(secondSketchId).not.toBe(firstSketchId);

  await secondSketch.dblclick({ force: true });
  await workbench.expectSketchSessionActive();
  const originalAction = page
    .locator('[data-history-action-direction="undo"]')
    .filter({ hasText: "Create Sketch Geometry" });
  await expect(originalAction).toBeVisible();
  await originalAction.click();
  const originalRedo = page
    .locator('[data-history-action-direction="redo"]')
    .filter({ hasText: "Create Sketch Geometry" });
  await expect(originalRedo).toBeVisible();
  await originalRedo.click();
  await expect(originalAction).toBeVisible();
});

function syncUrl(channelName: string, databaseName: string) {
  const params = new URLSearchParams({
    cadLocalPeerSync: "1",
    cadLocalPeerSyncChannel: channelName,
    cadRepositoryDbName: databaseName,
    cadTestMode: "1",
  });
  return `/?${params}`;
}

async function waitForRepositoryUrl(page: Page, channelName: string) {
  const namespace = `cad-local-peer-channel:${encodeURIComponent(channelName)}`;
  const key = `cad.documentRepository.automergeUrls.v1:${namespace}`;
  await expect
    .poll(
      () =>
        page.evaluate((storageKey) => localStorage.getItem(storageKey), key),
      {
        timeout: 30_000,
      },
    )
    .toContain("doc_workspace");
}

async function refreshDocument(page: Page) {
  await page.evaluate(() => {
    window.__cadaraDebug?.refreshDocument();
  });
}

async function revisionLabel(page: Page) {
  return page.evaluate(
    () => window.__cadaraDebug?.getState()?.revision ?? "loading",
  );
}
