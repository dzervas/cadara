import { expect, test } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

const MODELING_OPERATION_HISTORY_STORAGE_KEY =
  "cad.modeling.operationHistory.doc_workspace.v1";

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md) — what the user reads before a click is the
// rendered snap badge, and what the click authors is the committed sketch;
// only the real workbench joins the two through the viewport's screen
// scale. Seam (T13-D15): the badge text shown before each click names
// exactly the constraints the commit authors.
const CENTER = { x: 720, y: 480 };
const OTHER_END = { x: 800, y: 400 };
// Near the line's midpoint (760, 440), off both axes.
const NEAR_MIDPOINT = { x: 763, y: 442 };
// On the line a quarter from the origin, 2.8 px off it, far from its ends,
// its midpoint and both axes.
const NEAR_LINE = { x: 742, y: 462 };

async function badgeTexts(workbench: SketchWorkbenchHarness) {
  return workbench.page
    .locator('[data-sketch-viewport-overlay="snapIndicator"]')
    .allInnerTexts();
}

/** Hovers, records the live badge (rendered first), then clicks. */
async function hoverAndClick(
  workbench: SketchWorkbenchHarness,
  point: { x: number; y: number },
) {
  await workbench.hoverViewportAt(point);
  await workbench.waitForAnimationFrames(3);
  const [shown = null] = await badgeTexts(workbench);
  await workbench.clickViewportAt(point);
  return shown;
}

/** The constraint kind a badge text names (T13-D15 text table). */
function kindOfText(text: string) {
  if (text === "Coincident · Sketch origin") return "coincidentProjectedPoint";
  if (text.startsWith("Coincident · ")) return "coincident";
  if (text.startsWith("Midpoint of ")) return "midpoint";
  if (text.startsWith("On Sketch ")) return "pointOnProjectedCurve";
  if (text.startsWith("On ")) return "pointOnCurve";
  throw new Error(`Unexpected badge text: ${text}`);
}

test("T13g: the badge shown before each click names exactly the constraints the commit authors", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();

  const shown: (string | null)[] = [];
  await workbench.activateTool("Create line geometry.");
  shown.push(await hoverAndClick(workbench, OTHER_END));
  shown.push(await hoverAndClick(workbench, CENTER));
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("collecting");

  await workbench.activateTool("Create a sketch point.");
  shown.push(await hoverAndClick(workbench, NEAR_MIDPOINT));
  shown.push(await hoverAndClick(workbench, NEAR_LINE));
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("3 entities staged");

  expect(shown, "the badges the user read before each click").toEqual([
    null,
    "Coincident · Sketch origin",
    "Midpoint of Line 1",
    "On Line 1",
  ]);

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");
  const committedKinds = await page.evaluate((storageKey) => {
    const payload = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as {
      entries?: Array<{
        kind: string;
        payload?: { definition?: { constraints?: Array<{ kind: string }> } };
      }>;
    };
    return (
      payload.entries
        ?.filter((entry) => entry.kind === "commitSketch")
        .at(-1)
        ?.payload?.definition?.constraints?.map(({ kind }) => kind) ?? []
    );
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);

  expect(
    [...committedKinds].sort(),
    "the committed constraints are exactly the ones the badges named",
  ).toEqual(
    shown
      .filter((text): text is string => text !== null)
      .map(kindOfText)
      .sort(),
  );
});
