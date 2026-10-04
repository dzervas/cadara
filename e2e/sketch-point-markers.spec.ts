import { expect, test, type Page } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

// Lane: e2e (docs/testing.md). Seam: the browser workbench's drawn sketch
// point markers (T11f, T11-D8). Whether a marker is drawn exists only in the
// rendered WebGL frame, so the spec reads frame pixels: an end-point sample
// is a pixel just beside the point (3 px beyond it, above and below it:
// inside the ≥ 3 px marker radius, off the ~1 px stroke), compared with the
// same pixel while nothing is hovered or selected (the marker hidden).
test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 900 } });

type ViewportPoint = { x: number; y: number };
type Rgb = readonly [number, number, number];

const lineStart = { x: 800, y: 330 };
const lineEnd = { x: 1000, y: 330 };
const lineMiddle = { x: 900, y: 330 };
const constructionStart = { x: 760, y: 330 };
const constructionEnd = { x: 1080, y: 330 };
const freePoint = { x: 640, y: 250 };
const away = { x: 420, y: 700 };
const constructionToggle =
  "Toggle sketch geometry construction-only or mark new sketch geometry as construction.";

test("hovering a line shows its end-point markers, moving away hides them, selecting keeps them; a free point always shows", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  await drawLine(workbench, lineStart, lineEnd, "1 entities");
  await workbench.activateTool("Create a sketch point.");
  await workbench.clickViewportAt(freePoint);
  await workbench.clickViewportAt(freePoint);
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("2 entities staged");
  await workbench.page.keyboard.press("Escape");
  await clearSelection(workbench);
  const ends = [lineStart, lineEnd];

  await workbench.hoverViewportAt(away);
  await expectHover(workbench, "none", "Nothing is hovered away from both.");
  const hidden = await sampleBeside(workbench, ends);
  await expectFreePointDrawn(workbench, "with nothing hovered or selected");

  await workbench.hoverViewportAt(lineMiddle);
  await expectHover(workbench, "sketch_entity_1_line", "The line is hovered.");
  await expectBesideDrawn(workbench, hidden, ends, true, "while hovered");

  await workbench.hoverViewportAt(away);
  await expectHover(workbench, "none", "Moving away clears the hover.");
  await expectBesideDrawn(workbench, hidden, ends, false, "after moving away");

  await workbench.clickViewportAt(lineMiddle);
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toContain("sketch_entity_1_line");
  await workbench.hoverViewportAt(away);
  await expectHover(workbench, "none", "The pointer is away again.");
  await expectBesideDrawn(
    workbench,
    hidden,
    ends,
    true,
    "while the line is selected and nothing is hovered",
  );
  await expectFreePointDrawn(workbench, "while the line is selected");
});

test("a non-top hover-stack entry shows its markers: hovering a line over a longer construction line shows the construction line's end points", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await openSketch(workbench);
  await workbench.activateTool(constructionToggle);
  // The toggle marks only the next geometry as construction.
  await drawLine(workbench, constructionStart, constructionEnd, "1 entities");
  await drawLine(workbench, lineStart, lineEnd, "2 entities");
  await clearSelection(workbench);
  const ends = [constructionStart, constructionEnd];

  await workbench.hoverViewportAt(away);
  await expectHover(workbench, "none", "Nothing is hovered away from both.");
  const hidden = await sampleBeside(workbench, ends);

  await workbench.hoverViewportAt(lineMiddle);
  await expectHover(
    workbench,
    "sketch_entity_2_line",
    "The ordinary line is the hover target (the top of the stack).",
  );
  await expect(
    page.getByTestId("sketch-pick-hint"),
    "premise: the construction line is another entry of the same stack",
  ).toContainText("more here");
  await expectBesideDrawn(
    workbench,
    hidden,
    ends,
    true,
    "while the construction line is a non-top stack entry",
  );

  await workbench.hoverViewportAt(away);
  await expectHover(workbench, "none", "Moving away clears the hover.");
  await expectBesideDrawn(workbench, hidden, ends, false, "after moving away");
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

/** A line between two viewport points; Escape leaves Line. */
async function drawLine(
  workbench: SketchWorkbenchHarness,
  start: ViewportPoint,
  end: ViewportPoint,
  staged: string,
) {
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt(start);
  await workbench.clickViewportAt(end);
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain(`${staged} staged`);
  await workbench.page.keyboard.press("Escape");
}

async function clearSelection(workbench: SketchWorkbenchHarness) {
  await workbench.page.evaluate(() => window.__cadaraDebug?.clearSelection());
  await expect
    .poll(() => workbench.currentEditorSelection(), { timeout: 10_000 })
    .toBe("Nothing selected");
}

/** A 32 × 32 frame crop centred on a canvas point (centre pixel 16, 16). */
async function crop(workbench: SketchWorkbenchHarness, point: ViewportPoint) {
  const box = await workbench.viewport().boundingBox();
  if (!box) throw new Error("Viewport canvas is not visible.");
  // Canvas coordinates, as `clickViewportAt` and `hoverViewportAt` use;
  // CSS-pixel scale keeps the 32 × 32 indexing at any device pixel ratio.
  return readPixels(
    workbench.page,
    await workbench.page.screenshot({
      scale: "css",
      clip: {
        x: Math.round(box.x + point.x - 16),
        y: Math.round(box.y + point.y - 16),
        width: 32,
        height: 32,
      },
    }),
  );
}

/**
 * The pixels beside the two ends of a horizontal line (left end first):
 * 3 px beyond each end, and 3 px above and below it.
 */
async function sampleBeside(
  workbench: SketchWorkbenchHarness,
  ends: readonly ViewportPoint[],
) {
  await workbench.waitForAnimationFrames(4);
  const crops = await Promise.all(ends.map((end) => crop(workbench, end)));
  return crops.flatMap((pixels, index) => {
    const beyond = index === 0 ? -3 : 3;
    return [pixels[16]![16 + beyond]!, pixels[13]![16]!, pixels[19]![16]!];
  });
}

async function expectBesideDrawn(
  workbench: SketchWorkbenchHarness,
  hidden: readonly Rgb[],
  ends: readonly ViewportPoint[],
  drawn: boolean,
  when: string,
) {
  await expect
    .poll(
      async () =>
        (await sampleBeside(workbench, ends)).every((pixel, index) => {
          const distance = colorDistance(pixel, hidden[index]!);
          return drawn ? distance > 60 : distance < 12;
        }),
      {
        message: `Both end-point markers are ${drawn ? "drawn" : "hidden"} ${when}.`,
        timeout: 10_000,
      },
    )
    .toBe(true);
}

/** A free point has no curve to hover: its marker is always drawn. */
async function expectFreePointDrawn(
  workbench: SketchWorkbenchHarness,
  when: string,
) {
  await workbench.waitForAnimationFrames(4);
  const pixels = await crop(workbench, freePoint);
  expect(
    colorDistance(pixels[16]![16]!, pixels[2]![2]!),
    `The free point's marker is drawn ${when}.`,
  ).toBeGreaterThan(60);
}

async function expectHover(
  workbench: SketchWorkbenchHarness,
  expected: string,
  message: string,
) {
  await expect
    .poll(() => workbench.currentHoverTarget(), { message, timeout: 10_000 })
    .toContain(expected);
}

function colorDistance(left: Rgb, right: Rgb) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

/** Decodes a PNG screenshot in the page into rows of RGB pixels. */
async function readPixels(page: Page, png: Buffer): Promise<Rgb[][]> {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    return Array.from({ length: image.height }, (_, y) =>
      Array.from({ length: image.width }, (_, x) => {
        const index = (y * image.width + x) * 4;
        return [data[index]!, data[index + 1]!, data[index + 2]!] as const;
      }),
    );
  }, png.toString("base64"));
}
