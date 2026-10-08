import { expect, test } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

const MODELING_OPERATION_HISTORY_STORAGE_KEY =
  "cad.modeling.operationHistory.doc_workspace.v1";

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam (T13i, D24 with T13 review R-3): a
// spline crossing a line → the exact edit-intersection service in the real
// derivation worker's `snapQuery` lane → the hover badge before the click
// names the intersection → the Line click authors exactly those two
// `pointOnCurve`. Only the browser composes the module worker, the session,
// the viewport's screen scale and the published commit.

async function expectStaged(workbench: SketchWorkbenchHarness, count: number) {
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 15_000 })
    .toContain(`${count} entities staged`);
}

test("T13i: hovering where a spline crosses a line shows the intersection; a Line click there authors its two pointOnCurve", async ({
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

  // A 3-point spline arch, finalized with Enter (T11i).
  await workbench.activateTool("Create spline geometry.");
  await workbench.clickViewportAt({ x: 540, y: 620 });
  await workbench.clickViewportAt({ x: 760, y: 360 });
  await workbench.clickViewportAt({ x: 980, y: 620 });
  await page.keyboard.press("Enter");
  await expectStaged(workbench, 1);
  // A vertical line crossing the arch once, its ends well off it.
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 640, y: 330 });
  await workbench.clickViewportAt({ x: 640, y: 700 });
  await expectStaged(workbench, 2);
  const basisAt = Date.now();
  await page.keyboard.press("Escape");

  // Line armed: scan down the line until the badge offers the spline
  // intersection (the snap query answers in the background; while pending
  // it is not offered, so the scan repeats until it is).
  await workbench.activateTool("Create line geometry.");
  const badge = page.locator('[data-sketch-snap-kind="intersection"]');
  let hovered: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        for (let y = 380; y <= 600; y += 6) {
          await workbench.hoverViewportAt({ x: 646, y });
          await workbench.waitForAnimationFrames(2);
          // The line also crosses the sketch X axis: only the spline's
          // crossing counts.
          const [label = ""] = await page
            .locator('[data-sketch-viewport-overlay="snapIndicator"]')
            .allInnerTexts();
          if ((await badge.count()) > 0 && label.includes("Spline")) {
            hovered = { x: 646, y };
            return true;
          }
        }
        return false;
      },
      { timeout: 60_000, intervals: [250] },
    )
    .toBe(true);
  // Latency evidence (P12): line commit → first intersection badge, an upper
  // bound (it includes the hover scan).
  test.info().annotations.push({
    type: "t13i-snap-ready-ms",
    description: String(Date.now() - basisAt),
  });
  // The rendered label of the live snap badge (the only one before a click).
  const [text = ""] = await page
    .locator('[data-sketch-viewport-overlay="snapIndicator"]')
    .allInnerTexts();
  expect(
    text.trim().split(", ").sort(),
    "the badge names both curves of the intersection",
  ).toEqual(["On Line 2", "On Spline 1"]);

  await workbench.clickViewportAt(hovered!);
  await workbench.clickViewportAt({ x: 1100, y: 250 });
  await expectStaged(workbench, 3);
  await page.keyboard.press("Escape");

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");
  const committed = await page.evaluate((storageKey) => {
    const payload = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            entities?: Array<{
              entityId: string;
              kind: string;
              label: string;
              startPointId?: string;
              endPointId?: string;
            }>;
            constraints?: Array<{
              kind: string;
              point?: { pointId: string };
              curve?: { entityId: string };
            }>;
          };
        };
      }>;
    };
    const definition = payload.entries
      ?.filter((entry) => entry.kind === "commitSketch")
      .at(-1)?.payload?.definition;
    const entities = definition?.entities ?? [];
    const labelOf = (entityId: string | undefined) =>
      entities.find((entity) => entity.entityId === entityId)?.label ?? null;
    const newLine = entities.find((entity) => entity.label === "Line 3");
    const newLineIds = [
      newLine?.entityId,
      newLine?.startPointId,
      newLine?.endPointId,
    ];
    return {
      onNewLine: (definition?.constraints ?? [])
        .filter((constraint) =>
          newLineIds.some(
            (id) => id !== undefined && JSON.stringify(constraint).includes(id),
          ),
        )
        .map(({ kind }) => kind),
      onNewLineStart: (definition?.constraints ?? [])
        .filter(
          (constraint) =>
            constraint.kind === "pointOnCurve" &&
            constraint.point?.pointId === newLine?.startPointId,
        )
        .map((constraint) => labelOf(constraint.curve?.entityId)),
    };
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);

  expect(
    [...committed.onNewLineStart].sort(),
    "the new line's start is on exactly the two curves the badge named",
  ).toEqual(["Line 2", "Spline 1"]);
  expect(
    committed.onNewLine,
    "nothing else was authored on the new line",
  ).toEqual(["pointOnCurve", "pointOnCurve"]);
});
