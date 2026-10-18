import { expect, test } from "@playwright/test";
import { expectStaged, openTopSketch } from "./helpers/mirror-workbench";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the toolbar search inside the browser
// workbench (O23). While a sketch is open, part tools stay listed in search
// but disabled with a reason tooltip, and clicking one keeps the unfinished
// draft instead of switching to the part workbench and discarding it.
test.setTimeout(90_000);

test("part tools in search are disabled while sketching and never discard the draft", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await openTopSketch(workbench);
  await workbench.activateTool("Create circular geometry.");
  await workbench.clickViewportAt({ x: 600, y: 400 });
  await workbench.clickViewportAt({ x: 660, y: 400 });
  await expectStaged(workbench, 1);

  await page.getByPlaceholder("Search tools").fill("split");
  const partSplit = page.locator(
    'button[data-tool-source="search"][data-tool-id="split"]',
  );
  const sketchSplit = page.locator(
    'button[data-tool-source="search"][data-tool-id="sketchSplit"]',
  );
  await expect(partSplit).toHaveAttribute("aria-disabled", "true");
  await expect(sketchSplit).not.toHaveAttribute("aria-disabled", "true");

  await partSplit.hover();
  await expect(
    page
      .getByRole("tooltip")
      .getByText(
        "Part tools are unavailable while sketching. Finish Sketch first.",
      ),
  ).toBeVisible();

  // Playwright refuses aria-disabled targets; a user can still click the row.
  await partSplit.click({ force: true });
  await workbench.expectSketchSessionActive();
  await expectStaged(workbench, 1);
});
