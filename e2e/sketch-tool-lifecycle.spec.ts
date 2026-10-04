import { expect, test } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the browser workbench's drawing-tool
// lifecycle (T11g; T11-D9, D10, D19): discrete tools repeat, Escape cancels
// an incomplete draft and keeps the tool armed, a second Escape returns to
// Select, and Point places one point per click. Only the browser runs the
// real Escape key through the window shortcut listener to the reducer.
test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 900 } });

const circleTool = "Create circular geometry.";
const pointTool = "Create a sketch point.";

test("Circle stays armed: two circles in a row, then a cancelled draft, then Escape to Select", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  const circleButton = workbench.toolbarButton(circleTool);

  await workbench.activateTool(circleTool);
  await workbench.clickViewportAt({ x: 600, y: 400 });
  await workbench.clickViewportAt({ x: 660, y: 400 });
  await expectStaged(workbench, 1);
  await workbench.clickViewportAt({ x: 900, y: 400 });
  await workbench.clickViewportAt({ x: 960, y: 400 });
  await expectStaged(workbench, 2);
  await expect(circleButton, "Circle stays armed.").toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await expect.poll(() => workbench.currentPhase()).toBe("collecting");

  // Start a third circle: a draft with its center placed.
  await workbench.clickViewportAt({ x: 750, y: 600 });
  await expect
    .poll(() => workbench.currentPhase(), {
      message: "The center click starts a draft.",
    })
    .toBe("editing");
  await expect
    .poll(() => previewState(workbench))
    .not.toBe("Pick circle center");

  await page.keyboard.press("Escape");
  await expect
    .poll(() => previewState(workbench), {
      message: "The first Escape cancels the draft; Circle asks for a center.",
    })
    .toBe("Pick circle center");
  await expect.poll(() => workbench.currentPhase()).toBe("collecting");
  await expect(circleButton, "Circle is still armed.").toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => command(workbench)).toBe("circle");
  await expectStaged(workbench, 2);

  await page.keyboard.press("Escape");
  await expect
    .poll(() => command(workbench), {
      message: "The second Escape returns to Select.",
    })
    .toBe("sketch");
  await expect(circleButton).toHaveAttribute("aria-pressed", "false");
  await expectStaged(workbench, 2);
  await workbench.expectSketchSessionActive();
});

test("Point places one point per click", async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);

  await workbench.activateTool(pointTool);
  await workbench.clickViewportAt({ x: 600, y: 300 });
  await expectStaged(workbench, 1);
  await workbench.clickViewportAt({ x: 800, y: 300 });
  await expectStaged(workbench, 2);
  await workbench.clickViewportAt({ x: 1000, y: 300 });
  await expectStaged(workbench, 3);
  await expect(workbench.toolbarButton(pointTool)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

async function openSketch(workbench: SketchWorkbenchHarness) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await workbench.page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
}

async function expectStaged(workbench: SketchWorkbenchHarness, count: number) {
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toBe(`${count} entities staged`);
}

function previewState(workbench: SketchWorkbenchHarness) {
  return workbench.page.evaluate(
    () => window.__cadaraDebug?.getState()?.previewState ?? "",
  );
}

function command(workbench: SketchWorkbenchHarness) {
  return workbench.page.evaluate(
    () => window.__cadaraDebug?.getState()?.command ?? "",
  );
}
