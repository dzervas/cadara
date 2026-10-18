import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { openDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.use({ viewport: { width: 1280, height: 720 } });

test("populated example parts stay bounded and scroll beneath the header", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const document: unknown = JSON.parse(
    await readFile("landing/examples/enclosure/model.cadara", "utf8"),
  );
  await openDocumentCopy(page, document, "enclosure.cadara");
  await workbench.waitForRenderIdle(30_000);

  const tree = page.getByRole("complementary", { name: "Parts and objects" });
  const header = tree.locator("header");
  const rows = tree.getByRole("treeitem");
  const list = tree.locator(".mantine-ScrollArea-viewport");
  await expect(
    tree.getByText("Black socket-head screw 4", { exact: true }),
  ).toBeAttached({ timeout: 60_000 });
  expect(await rows.count()).toBeGreaterThan(20);

  const workbenchBox = await page.locator("main").boundingBox();
  const treeBox = await tree.boundingBox();
  const headerBox = await header.boundingBox();
  if (!workbenchBox || !treeBox || !headerBox) {
    throw new Error(
      "Expected the workbench and parts tree to have layout boxes.",
    );
  }
  expect.soft(treeBox.y).toBeGreaterThanOrEqual(workbenchBox.y);
  expect
    .soft(treeBox.y + treeBox.height, "tree fits inside the workbench")
    .toBeLessThanOrEqual(workbenchBox.y + workbenchBox.height);
  expect
    .soft(treeBox.y + treeBox.height, "tree fits inside the viewport")
    .toBeLessThanOrEqual(720);
  const historyBox = await page
    .getByRole("region", { name: "Feature timeline", exact: true })
    .boundingBox();
  if (!historyBox)
    throw new Error("Expected the bottom history to be available.");
  expect
    .soft(treeBox.y + treeBox.height, "tree does not overlap bottom history")
    .toBeLessThanOrEqual(historyBox.y);

  const scrolling = await list.evaluate((element) => ({
    overflows: element.scrollHeight > element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect
    .soft(scrolling.overflows, "example requires list scrolling")
    .toBe(true);
  expect.soft(scrolling.overflowY).toMatch(/^(auto|scroll)$/);
  await expect.soft(rows.last()).not.toBeInViewport();

  // Wheel over the visible list, not locator.scrollIntoViewIfNeeded(): the
  // latter can scroll the page instead and conceal a broken sidebar.
  const firstRowBox = await rows.first().boundingBox();
  if (!firstRowBox) throw new Error("Expected a visible first object row.");
  await page.mouse.move(
    firstRowBox.x + firstRowBox.width / 2,
    firstRowBox.y + firstRowBox.height / 2,
  );
  const scrollbar = tree.locator(
    '.mantine-ScrollArea-scrollbar[data-orientation="vertical"]',
  );
  await expect(scrollbar).toBeVisible();
  await expect(scrollbar.locator(".mantine-ScrollArea-thumb")).toBeVisible();
  await page.mouse.wheel(0, 10_000);
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  // Scroll extents round to CSS pixels; allow subpixel clipping at the edge.
  await expect(rows.last()).toBeInViewport({ ratio: 0.99 });
  const lastRowBox = await rows.last().boundingBox();
  if (!lastRowBox)
    throw new Error("Expected the last object row to be measurable.");
  expect(lastRowBox.y + lastRowBox.height).toBeLessThanOrEqual(historyBox.y);
  const debuggerBox = await page
    .locator("[data-workbench-state-debugger]")
    .boundingBox();
  if (!debuggerBox) throw new Error("Expected the bottom debugger chip.");
  expect(lastRowBox.y + lastRowBox.height).toBeLessThanOrEqual(debuggerBox.y);
  await expect(header).toBeInViewport({ ratio: 1 });
  expect(
    (await header.boundingBox())?.y,
    "header stays available while scrolling",
  ).toBe(headerBox.y);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
