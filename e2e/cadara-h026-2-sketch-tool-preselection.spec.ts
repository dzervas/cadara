import { expect as baseExpect, test } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: sketch tools acting on the browser
// multi-selection (cadara-h026.2): lines picked with real viewport clicks or
// a double-click chain, then a toolbar tool, without re-picking. The
// activation rules themselves (per corner, per item, chained, cleared) are
// covered in the logic lane (sketch-tool-preselection.spec.ts).

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 900 } });
const expect = baseExpect.configure({ timeout: 10_000 });

const LINE_TOOL = "Create line geometry.";
const FILLET_TOOL = "Round a supported sketch corner.";
const CHAMFER_TOOL = "Bevel a supported sketch corner.";
const PARALLEL_TOOL = "Constrain two lines to remain parallel.";
const HORIZONTAL_TOOL =
  "Constrain a line parallel to the sketch horizontal axis.";

type P = { x: number; y: number };
const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** A skewed closed quadrilateral (no side horizontal, vertical or parallel). */
const QUAD: readonly P[] = [
  { x: 760, y: 280 },
  { x: 1060, y: 340 },
  { x: 1100, y: 580 },
  { x: 720, y: 520 },
];

async function openTopSketch(workbench: SketchWorkbenchHarness) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await workbench.page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
}

/** Draws one Line chain through `points`, then leaves Line for Select. */
async function drawChain(
  workbench: SketchWorkbenchHarness,
  points: readonly P[],
  staged: string,
) {
  await workbench.activateTool(LINE_TOOL);
  for (const point of points) await workbench.clickViewportAt(point);
  await expect.poll(() => workbench.currentSketchSession()).toContain(staged);
  await workbench.page.keyboard.press("Escape");
  await workbench.page.keyboard.press("Escape");
  await expect.poll(() => command(workbench)).toBe("sketch");
  await workbench.page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await expect
    .poll(() => workbench.currentEditorSelection())
    .toBe("Nothing selected");
}

const command = (workbench: SketchWorkbenchHarness) =>
  workbench.page.evaluate(
    () => window.__cadaraDebug?.getState()?.command ?? "",
  );

const definition = (workbench: SketchWorkbenchHarness) =>
  workbench.page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot()?.definition ?? null,
  );

const countOf = async (
  workbench: SketchWorkbenchHarness,
  records: "entities" | "constraints",
  kind: string,
) =>
  ((await definition(workbench))?.[records] ?? []).filter(
    (record: { kind: string }) => record.kind === kind,
  ).length;

async function selectLines(
  workbench: SketchWorkbenchHarness,
  points: readonly P[],
) {
  for (const [index, point] of points.entries()) {
    await workbench.clickViewportAt(point);
    await expect
      .poll(() => workbench.currentMachineSelectionCount())
      .toBe(index + 1);
  }
}

async function createFromFloatingInput(workbench: SketchWorkbenchHarness) {
  const floatingInput = workbench.page.locator(
    "[data-sketch-viewport-floating-input]",
  );
  await expect(
    floatingInput,
    "The preview's value input is open without re-picking.",
  ).toBeVisible();
  await floatingInput.getByRole("button", { name: "Create" }).click();
}

test("two selected lines, then Chamfer: the corner previews at once and Create bevels it", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openTopSketch(workbench);
  await drawChain(workbench, [...QUAD, QUAD[0]!], "4 entities staged");

  await selectLines(workbench, [
    mid(QUAD[0]!, QUAD[1]!),
    mid(QUAD[1]!, QUAD[2]!),
  ]);
  await workbench.activateTool(CHAMFER_TOOL);
  await expect(page.getByText(/^Targets: \d+\/\d+$/)).toHaveText(
    "Targets: 2/2",
  );
  await createFromFloatingInput(workbench);
  await expect
    .poll(() => countOf(workbench, "entities", "lineSegment"))
    .toBe(5);
});

test("a selected closed chain, then Fillet: all 4 corners are rounded", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openTopSketch(workbench);
  await drawChain(workbench, [...QUAD, QUAD[0]!], "4 entities staged");

  // A double click selects the line's connected chain.
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport canvas is not visible.");
  const side = mid(QUAD[0]!, QUAD[1]!);
  await page.mouse.click(box.x + side.x, box.y + side.y, { clickCount: 2 });
  await expect.poll(() => workbench.currentMachineSelectionCount()).toBe(4);

  await workbench.activateTool(FILLET_TOOL);
  await createFromFloatingInput(workbench);
  await expect.poll(() => countOf(workbench, "entities", "arc")).toBe(4);

  // The four corners are one action: one Undo removes them all.
  await page.keyboard.press("Control+z");
  await expect.poll(() => countOf(workbench, "entities", "arc")).toBe(0);
  await expect
    .poll(() => countOf(workbench, "entities", "lineSegment"))
    .toBe(4);
});

test("an incompatible preselection is cleared at activation: one line, then Fillet", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openTopSketch(workbench);
  await drawChain(workbench, [...QUAD, QUAD[0]!], "4 entities staged");

  await selectLines(workbench, [mid(QUAD[0]!, QUAD[1]!)]);
  await workbench.activateTool(FILLET_TOOL);
  await expect
    .poll(() => workbench.currentEditorSelection())
    .toBe("Nothing selected");
  await expect(page.getByText(/^Targets: \d+\/\d+$/)).toHaveText(
    "Targets: 0/2",
  );
});

test("two selected lines, then Parallel: the constraint is applied and the tool ends", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openTopSketch(workbench);
  await drawChain(workbench, [...QUAD, QUAD[0]!], "4 entities staged");
  const parallelBefore = await countOf(workbench, "constraints", "parallel");

  await selectLines(workbench, [
    mid(QUAD[0]!, QUAD[1]!),
    mid(QUAD[2]!, QUAD[3]!),
  ]);
  await workbench.activateTool(PARALLEL_TOOL);
  await expect
    .poll(() => countOf(workbench, "constraints", "parallel"))
    .toBe(parallelBefore + 1);
  await expect.poll(() => command(workbench)).toBe("sketch");
});

test("three selected lines, then Horizontal: each line is constrained", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openTopSketch(workbench);
  // Clear of the axes and the constraint panel (top right).
  const lines: [P, P][] = [
    [
      { x: 450, y: 250 },
      { x: 650, y: 320 },
    ],
    [
      { x: 800, y: 250 },
      { x: 1000, y: 320 },
    ],
    [
      { x: 800, y: 560 },
      { x: 1000, y: 630 },
    ],
  ];
  for (const [index, line] of lines.entries())
    await drawChain(workbench, line, `${index + 1} entities staged`);
  const horizontalBefore = await countOf(
    workbench,
    "constraints",
    "horizontal",
  );

  await selectLines(
    workbench,
    lines.map(([from, to]) => mid(from, to)),
  );
  await workbench.activateTool(HORIZONTAL_TOOL);
  await expect
    .poll(() => countOf(workbench, "constraints", "horizontal"))
    .toBe(horizontalBefore + 3);
  await expect.poll(() => command(workbench)).toBe("sketch");
});
