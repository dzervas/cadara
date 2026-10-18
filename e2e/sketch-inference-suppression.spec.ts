import { expect, test } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

const MODELING_OPERATION_HISTORY_STORAGE_KEY =
  "cad.modeling.operationHistory.doc_workspace.v1";
const FREE = "Free placement (inference off)";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md) — T13-D22/D23 join real keyboard focus,
// window blur, OrbitControls' button handling and the Finish shortcut with
// the reducer; only the browser exercises those together. Seam: what the
// user reads at the pointer, what is placed, and what Finish publishes.
const CENTER = { x: 720, y: 480 };
const OTHER_END = { x: 800, y: 400 };
// 3.6 px from the line's free end: inside the 12 px point snap radius.
const NEAR_END = { x: 803, y: 402 };

async function openSketchWithLine(workbench: SketchWorkbenchHarness) {
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await workbench.page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt(OTHER_END);
  await workbench.clickViewportAt(CENTER);
  await expectStaged(workbench, 1);
  await workbench.page.keyboard.press("Escape");
  await expect.poll(() => workbench.currentPhase()).toBe("collecting");
}

async function expectStaged(workbench: SketchWorkbenchHarness, count: number) {
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain(`${count} entities staged`);
}

/** The live placement text: the offset inference detail or the free label. */
function pointerText(workbench: SketchWorkbenchHarness) {
  return workbench.page.evaluate(() => {
    const snap = document.querySelector(
      '[data-sketch-viewport-overlay="constraintPreview"] > span:last-child',
    );
    if (snap) return snap.textContent;
    const free = [
      ...document.querySelectorAll(
        '[data-sketch-viewport-overlay="referenceLabel"]',
      ),
    ].find((element) => element.textContent?.startsWith("Free placement"));
    return free?.textContent ?? null;
  });
}

test("T13h: holding Shift frees the placement without moving; release and blur restore inference; the toggle does the same", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketchWithLine(workbench);
  await workbench.activateTool("Create a sketch point.");
  await workbench.hoverViewportAt(NEAR_END);
  await expect
    .poll(() => pointerText(workbench), { message: "premise: the end snap" })
    .toMatch(/^Coincident · /);
  const snapped = await pointerText(workbench);

  await page.keyboard.down("Shift");
  await expect
    .poll(() => pointerText(workbench), {
      message: "Shift alone frees the placement, with no pointer motion.",
    })
    .toBe(FREE);
  await page.keyboard.up("Shift");
  await expect
    .poll(() => pointerText(workbench), { message: "Release restores." })
    .toBe(snapped);

  await page.keyboard.down("Shift");
  await expect.poll(() => pointerText(workbench)).toBe(FREE);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect
    .poll(() => pointerText(workbench), {
      message: "A window blur resets the held state.",
    })
    .toBe(snapped);
  await page.keyboard.up("Shift");

  // Shift held while clicking places the point free: no relation authored.
  await page.keyboard.down("Shift");
  await workbench.clickViewportAt(NEAR_END);
  await page.keyboard.up("Shift");
  await expectStaged(workbench, 2);

  // The visible toggle suppresses like Shift.
  const toggle = page.getByRole("switch", { name: "Snap & infer" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await workbench.hoverViewportAt({ x: 790, y: 410 });
  await workbench.hoverViewportAt(NEAR_END);
  await expect
    .poll(() => pointerText(workbench), { message: "The toggle frees it." })
    .toBe(FREE);
  await toggle.click();
  await expect(toggle).toBeChecked();
  await workbench.hoverViewportAt({ x: 790, y: 410 });
  await workbench.hoverViewportAt(NEAR_END);
  await expect
    .poll(() => pointerText(workbench), {
      message: "Inference is back (the free point placed above is nearest).",
    })
    .toMatch(/^Coincident · /);

  // T13h review A-1: the switch hands the shortcuts back once flipped.
  const activeCommand = () =>
    page.evaluate(() => window.__cadaraDebug?.getState()?.command ?? "");
  expect(await activeCommand(), "premise").toBe("point");
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.keyboard.press("Escape");
  await expect
    .poll(activeCommand, { message: "Escape reaches the shortcuts" })
    .not.toBe("point");

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
    committedKinds,
    "Only the line's origin coincident: the Shift-click authored nothing.",
  ).toEqual(["coincidentProjectedPoint"]);
});

test("T13h: a right-drag with Shift held still moves the camera and places nothing", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketchWithLine(workbench);
  await workbench.activateTool("Create a sketch point.");
  const far = { x: 300, y: 700 };
  await workbench.hoverViewportAt({ x: 1100, y: 300 });
  await workbench.waitForAnimationFrames(3);
  const before = await workbench.viewportCrop(far, 120);

  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport canvas is not visible.");
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 1100, box.y + 300);
  await page.mouse.down({ button: "right" });
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(box.x + 1100 - step * 15, box.y + 300 + step * 8);
  }
  await page.mouse.up({ button: "right" });
  await page.keyboard.up("Shift");
  await workbench.waitForAnimationFrames(3);

  const after = await workbench.viewportCrop(far, 120);
  expect(after.equals(before), "The camera moved.").toBe(false);
  await expectStaged(workbench, 1);
  expect(await workbench.currentPhase(), "Nothing was placed.").toBe(
    "collecting",
  );
});

test("T13h: Shift+Enter with a 3-point spline draft keeps the spline and finishes the sketch (D23)", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketchWithLine(workbench);
  await workbench.activateTool("Create spline geometry.");
  for (const point of [
    { x: 500, y: 600 },
    { x: 600, y: 680 },
    { x: 700, y: 620 },
  ]) {
    await workbench.clickViewportAt(point);
  }
  await expect.poll(() => workbench.currentPhase()).toBe("editing");

  await page.keyboard.press("Shift+Enter");
  await workbench.expectMachine("idle");
  const splines = await page.evaluate((storageKey) => {
    const payload = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            entities?: Array<{ kind: string; pointOccurrences?: unknown[] }>;
          };
        };
      }>;
    };
    return (
      payload.entries
        ?.filter((entry) => entry.kind === "commitSketch")
        .at(-1)
        ?.payload?.definition?.entities?.filter(
          (entity) => entity.kind === "spline",
        )
        .map((entity) => entity.pointOccurrences?.length ?? 0) ?? []
    );
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);
  expect(splines, "The 3-point spline was published.").toEqual([3]);
});
