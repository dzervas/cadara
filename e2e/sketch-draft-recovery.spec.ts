import { expect, test } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";
import { glideClick, glidePress } from "./helpers/mirror-workbench";
import { currentRevision } from "./helpers/acceptance";

test.setTimeout(240_000);
test.use({ viewport: { width: 1440, height: 960 } });

const draftRecoveryKey = (documentId: string | null) => `cad.sketchDraftRecovery.${documentId}.v1`;

async function drawPrivateDraft(workbench: SketchWorkbenchHarness) {
  const { page } = workbench;
  await workbench.openWithRepository();
  await glidePress(page, workbench.toolbarButton("Start a new sketch."));
  await glidePress(page, page.getByRole("button", { name: /Top Plane/ }).first());
  await workbench.expectSketchSessionActive();
  const revision = await currentRevision(page);
  await workbench.activateTool("Create line geometry.", control => glidePress(page, control));
  await page.keyboard.down("Shift");
  for (let i = 0; i <= 10; i++) await glideClick(workbench, { x: 340 + i * 42, y: i % 2 ? 380 : 290 });
  await page.keyboard.up("Shift");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__cadaraDebug?.getSketchSnapshot()?.entities.length), { timeout: 30_000 }).toBe(10);
  // Assert the action trigger BEFORE navigating: pagehide alone must not make this green.
  const draftKey = draftRecoveryKey(await workbench.activeDocumentId());
  await expect.poll(() => page.evaluate((draftKey) => {
    const key = localStorage.getItem(draftKey);
    const record = JSON.parse(key ? localStorage.getItem(key) ?? "null" : "null");
    return record ? { actions: record.completedActions, entities: record.definition.entities.length } : null;
  }, draftKey), { timeout: 65_000 }).toEqual({ actions: 10, entities: 10 });
  expect(await currentRevision(page)).toBe(revision);
  return revision;
}

test("reload offers Resume, restores geometry privately, and only Finish publishes it", async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page);
  const revision = await drawPrivateDraft(workbench);
  await page.reload();
  await workbench.expectMachine("idle", 30_000);
  await expect(page.getByText("Recover sketch draft", { exact: true })).toBeVisible({ timeout: 30_000 });
  await workbench.expectMachine("idle");
  expect(await page.evaluate(() => window.__cadaraDebug?.getSketchSnapshot())).toBeNull();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await workbench.expectSketchSessionActive();
  await expect.poll(() => page.evaluate(() => window.__cadaraDebug?.getSketchSnapshot()?.entities.length)).toBe(10);
  await expect(workbench.viewport()).toBeVisible();
  expect(await currentRevision(page)).toBe(revision);
  await expect(page.locator("[data-history-sketch-id]")).toHaveCount(0);
  await glidePress(page, workbench.toolbarButton("Exit the active sketch."));
  await workbench.expectMachine("idle", 30_000);
  await expect(page.locator("[data-history-sketch-id]")).toHaveCount(1);
  await expect.poll(() => currentRevision(page), { timeout: 30_000 }).not.toBe(revision);
  const draftKey = draftRecoveryKey(await workbench.activeDocumentId());
  await expect.poll(() => page.evaluate((draftKey) => localStorage.getItem(draftKey), draftKey)).toBeNull();
});

test("Discard removes the recovered draft without publishing or offering it again", async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page);
  const revision = await drawPrivateDraft(workbench);
  await page.reload();
  await workbench.expectMachine("idle", 30_000);
  await expect(page.getByText("Recover sketch draft", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByText("Recover sketch draft", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__cadaraDebug?.getSketchSnapshot())).toBeNull();
  expect(await currentRevision(page)).toBe(revision);
  await expect(page.locator("[data-history-sketch-id]")).toHaveCount(0);
  await page.reload();
  await workbench.expectMachine("idle", 30_000);
  await workbench.expectMachine("idle");
  await expect(page.getByText("Recover sketch draft", { exact: true })).toHaveCount(0);
});
