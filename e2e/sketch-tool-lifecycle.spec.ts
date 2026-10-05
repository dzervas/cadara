import { expect, test } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the browser workbench's drawing-tool
// lifecycle (T11g; T11-D9, D10, D19): discrete tools repeat, Escape cancels
// an incomplete draft and keeps the tool armed, a second Escape returns to
// Select, and Point places one point per click. Only the browser runs the
// real Escape key through the window shortcut listener to the reducer, and
// the real pointer-up/click/dblclick sequence of a spline double-click
// (T11i, T11-D13).
test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 900 } });

const circleTool = "Create circular geometry.";
const lineTool = "Create line geometry.";
const MODELING_OPERATION_HISTORY_STORAGE_KEY =
  "cad.modeling.operationHistory.doc_workspace.v1";
const pointTool = "Create a sketch point.";
const splineTool = "Create spline geometry.";

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

// T11h (T11-D11, D12): Line chains connected segments; Undo and Redo move
// the chain anchor with Line armed; Escape ends the chain, then leaves Line.
test("Line chain: three segments, Undo twice, Redo, continue, Escape ends the chain, Escape leaves Line", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  const lineButton = workbench.toolbarButton(lineTool);

  await workbench.activateTool(lineTool);
  await workbench.clickViewportAt({ x: 500, y: 300 });
  await workbench.clickViewportAt({ x: 700, y: 300 });
  await expectStaged(workbench, 1);
  await workbench.clickViewportAt({ x: 700, y: 500 });
  await expectStaged(workbench, 2);
  await workbench.clickViewportAt({ x: 500, y: 500 });
  await expectStaged(workbench, 3);
  await expect
    .poll(() => workbench.currentPhase(), {
      message: "The chain continues from the last end.",
    })
    .toBe("editing");

  await page.keyboard.press("Control+z");
  await expectStaged(workbench, 2);
  await page.keyboard.press("Control+z");
  await expectStaged(workbench, 1);
  await expect(lineButton, "Undo keeps Line armed.").toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => command(workbench)).toBe("line");
  await expect
    .poll(() => workbench.currentPhase(), {
      message: "The chain is still active from the moved-back anchor.",
    })
    .toBe("editing");

  await page.keyboard.press("Control+y");
  await expectStaged(workbench, 2);
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  // Continue from the re-extended anchor (the second segment's end).
  await workbench.clickViewportAt({ x: 900, y: 500 });
  await expectStaged(workbench, 3);

  await page.keyboard.press("Escape");
  await expect
    .poll(() => workbench.currentPhase(), {
      message: "The first Escape ends the chain.",
    })
    .toBe("collecting");
  await expect.poll(() => command(workbench)).toBe("line");
  await expect(lineButton).toHaveAttribute("aria-pressed", "true");
  await expectStaged(workbench, 3);

  await page.keyboard.press("Escape");
  await expect
    .poll(() => command(workbench), {
      message: "The second Escape returns to Select.",
    })
    .toBe("sketch");
  await expect(lineButton).toHaveAttribute("aria-pressed", "false");

  const lines = await finishAndReadLines(workbench);
  expect(lines.segments, "Three committed segments.").toHaveLength(3);
  expect(
    [lines.segments[1]![0], lines.segments[2]![0]],
    "Each segment starts on the previous end point id; the segment drawn after Redo starts on the re-extended anchor.",
  ).toEqual([lines.segments[0]![1], lines.segments[1]![1]]);
  expect(
    lines.points,
    "4 points: the undone (not redone) third end point is gone.",
  ).toBe(4);
});

test("closing a Line chain onto its first point ends the chain and keeps Line armed", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);

  await workbench.activateTool(lineTool);
  for (const point of [
    { x: 500, y: 300 },
    { x: 700, y: 300 },
    { x: 700, y: 500 },
    { x: 500, y: 500 },
    { x: 500, y: 300 },
  ]) {
    await workbench.clickViewportAt(point);
  }
  await expectStaged(workbench, 4);
  await expect
    .poll(() => workbench.currentPhase(), {
      message: "Closing the loop ends the chain.",
    })
    .toBe("collecting");
  await expect.poll(() => command(workbench)).toBe("line");
  await expect(workbench.toolbarButton(lineTool)).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("Escape");
  await expect
    .poll(() => command(workbench), {
      message: "With no chain, one Escape leaves Line.",
    })
    .toBe("sketch");

  const lines = await finishAndReadLines(workbench);
  expect(lines.segments).toHaveLength(4);
  expect(
    lines.segments[3]![1],
    "The closing segment ends on the chain's first point id.",
  ).toBe(lines.segments[0]![0]);
  expect(lines.points, "A closed 4-segment loop has 4 points.").toBe(4);
});

// T11g review V-1 / T11h review A-4: mid-chain, Enter on a toolbar dropdown
// item activates that item (a tool switch, which ends the chain); the
// window Enter shortcut does not swallow it. The Distance dimension family
// is used because its trigger only opens the menu (the Line family trigger
// also activates Line, which would end the chain before the menu opens).
test("mid-chain, Enter on a toolbar dropdown item activates the item instead of ending the chain", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);

  await workbench.activateTool(lineTool);
  await workbench.clickViewportAt({ x: 500, y: 300 });
  await workbench.clickViewportAt({ x: 700, y: 300 });
  await expectStaged(workbench, 1);
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  await page.locator('[data-tool-dropdown-trigger="dimension"]').click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect
    .poll(() => command(workbench), {
      message: "premise: opening the Distance menu keeps the chain",
    })
    .toBe("line");
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  await page.keyboard.press("ArrowDown");
  const focusedItem = page.locator('[role="menuitem"]:focus');
  await expect(focusedItem).toHaveCount(1);
  const variantId = await focusedItem.getAttribute("data-tool-id");
  expect(variantId, "premise: a dimension variant item has focus").toMatch(
    /^dimension/,
  );

  await page.keyboard.press("Enter");
  await expect
    .poll(() => command(workbench), {
      message: "Enter activates the focused menu item (a tool switch).",
    })
    .toBe(variantId);
  await expect(page.getByRole("menu")).toBeHidden();
  await expectStaged(workbench, 1);
});

// T11i (T11-D10, D13, D14): each spline click adds a fit point; Enter,
// double-click or Escape (with >= 2 points) finalizes the spline and keeps
// Spline armed; Escape with 1 point cancels; a tool switch discards an
// unfinalized spline.
test("Spline: 4 points finalized by a double-click onto a committed line, then Escape leaves Spline", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  const splineButton = workbench.toolbarButton(splineTool);

  // A committed line under the final double-click (review A-2): the
  // double-click finalizes the spline and is not a connected selection of
  // the line. (The guard order is the viewport's: `dblclick` returns after
  // the finalize, before the connected-selection branch.)
  await workbench.activateTool(lineTool);
  await workbench.clickViewportAt({ x: 950, y: 250 });
  await workbench.clickViewportAt({ x: 950, y: 450 });
  await expectStaged(workbench, 1);

  await workbench.activateTool(splineTool);
  for (const point of [
    { x: 500, y: 500 },
    { x: 650, y: 350 },
    { x: 800, y: 500 },
  ]) {
    await workbench.clickViewportAt(point);
  }
  await expect
    .poll(() => workbench.currentPhase(), {
      message: "The third click no longer commits the spline.",
    })
    .toBe("editing");
  await expectStaged(workbench, 1);

  // The double-click's first click places the 4th fit point; its second
  // release is de-duplicated and the dblclick finalizes.
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport canvas is not visible.");
  await page.mouse.dblclick(box.x + 950, box.y + 350);
  await expect
    .poll(() => workbench.currentPhase(), {
      message: "The double-click finalizes the spline.",
    })
    .toBe("collecting");
  await expectStaged(workbench, 2);
  await expect.poll(() => command(workbench)).toBe("spline");
  await expect(splineButton, "Spline stays armed.").toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await workbench.currentEditorSelection(),
    "The double-click on the line is not a connected selection.",
  ).toBe("Nothing selected");

  await page.keyboard.press("Escape");
  await expect
    .poll(() => command(workbench), {
      message: "With no draft, Escape returns to Select.",
    })
    .toBe("sketch");
  await expect(splineButton).toHaveAttribute("aria-pressed", "false");

  const splines = await finishAndReadSplines(workbench);
  expect(
    splines.fitPointCounts,
    "One spline through all 4 fit points (the de-duplicated second release added none).",
  ).toEqual([4]);
  expect(splines.points, "The line's 2 points and the 4 fit points.").toBe(6);
});

test("Spline: 2 points + Enter; then 1 point + Escape cancels and Escape leaves Spline", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);

  await workbench.activateTool(splineTool);
  await workbench.clickViewportAt({ x: 500, y: 500 });
  await workbench.clickViewportAt({ x: 700, y: 350 });
  await expect.poll(() => workbench.currentPhase()).toBe("editing");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => workbench.currentPhase(), {
      message: "Enter finalizes the 2-point spline.",
    })
    .toBe("collecting");
  await expectStaged(workbench, 1);
  await expect.poll(() => command(workbench)).toBe("spline");

  await workbench.clickViewportAt({ x: 900, y: 500 });
  await expect.poll(() => workbench.currentPhase()).toBe("editing");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => workbench.currentPhase(), {
      message: "Escape with 1 point cancels the draft.",
    })
    .toBe("collecting");
  await expect
    .poll(() => command(workbench), "Spline stays armed.")
    .toBe("spline");
  await expectStaged(workbench, 1);

  await page.keyboard.press("Escape");
  await expect
    .poll(() => command(workbench), {
      message: "The second Escape returns to Select.",
    })
    .toBe("sketch");

  const splines = await finishAndReadSplines(workbench);
  expect(splines.fitPointCounts, "Only the finalized spline.").toEqual([2]);
  expect(splines.points, "The cancelled point was never committed.").toBe(2);
});

test("Spline: a tool switch discards an unfinalized 3-point spline", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);

  await workbench.activateTool(splineTool);
  for (const point of [
    { x: 500, y: 500 },
    { x: 650, y: 350 },
    { x: 800, y: 500 },
  ]) {
    await workbench.clickViewportAt(point);
  }
  await expect.poll(() => workbench.currentPhase()).toBe("editing");
  await expectNothingCommitted(workbench);

  await workbench.activateTool(circleTool);
  await expect.poll(() => command(workbench)).toBe("circle");
  await expectNothingCommitted(workbench);

  const splines = await finishAndReadSplines(workbench);
  expect(splines.fitPointCounts, "No spline is committed.").toEqual([]);
  expect(splines.points).toBe(0);
});

/** Finish the sketch and read its committed splines' fit-point counts. */
async function finishAndReadSplines(workbench: SketchWorkbenchHarness) {
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");
  return workbench.page.evaluate((storageKey) => {
    const payload = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            points?: unknown[];
            entities?: Array<{
              kind: string;
              pointOccurrences?: unknown[];
            }>;
          };
        };
      }>;
    };
    const definition = payload.entries
      ?.filter((entry) => entry.kind === "commitSketch")
      .at(-1)?.payload?.definition;
    return {
      points: definition?.points?.length ?? 0,
      fitPointCounts: (definition?.entities ?? [])
        .filter((entity) => entity.kind === "spline")
        .map((entity) => entity.pointOccurrences?.length ?? 0),
    };
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);
}

/** Finish the sketch and read its committed line segments' point ids. */
async function finishAndReadLines(workbench: SketchWorkbenchHarness) {
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");
  return workbench.page.evaluate((storageKey) => {
    const payload = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            points?: unknown[];
            entities?: Array<{
              kind: string;
              startPointId?: string;
              endPointId?: string;
            }>;
          };
        };
      }>;
    };
    const definition = payload.entries
      ?.filter((entry) => entry.kind === "commitSketch")
      .at(-1)?.payload?.definition;
    return {
      points: definition?.points?.length ?? 0,
      segments: (definition?.entities ?? [])
        .filter((entity) => entity.kind === "lineSegment")
        .map((entity) => [entity.startPointId, entity.endPointId] as const),
    };
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);
}

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

/** No geometry has been committed to the new sketch yet. */
async function expectNothingCommitted(workbench: SketchWorkbenchHarness) {
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toBe("none");
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
