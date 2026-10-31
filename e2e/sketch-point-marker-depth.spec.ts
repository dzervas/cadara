import { expect, test, type Page } from "@playwright/test";
import * as THREE from "three";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

// Lane: e2e (docs/testing.md). Seam: the depth test and face culling of the
// drawn sketch point marker. Whether the part's depth buffer clips the
// marker, or the marker is culled from beneath its sketch plane, exists
// only in the rendered WebGL frame, so the spec reads frame pixels: no
// sample inside the point's dot, taken all around its centre, may show the
// backdrop seen between the dot and its ring. A camera-facing marker
// depth-tested against the coplanar face loses half its dot once the view
// is oblique; a marker laid into the plane must still face the camera.
test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 900 } });

type ViewportPoint = { x: number; y: number };
type Rgb = readonly [number, number, number];

/**
 * A Point entity draws a ~4.5 px dot inside a ring of twice its radius
 * (`createScreenSpacePointMarkerGeometry`). Dot samples stay off its
 * anti-aliased rim; gap samples fall between the dot and the ring.
 */
const DOT_SAMPLE_RADII = [1.5, 2.5] as const;
const GAP_SAMPLE_RADIUS = 6.5;
const SAMPLE_DIRECTIONS = 12;

for (const projection of ["Orthographic", "Perspective"] as const) {
  test(`${projection}: a sketch point on a part face stays fully drawn over that face when the view is oblique to the sketch plane`, async ({
    page,
  }) => {
    const workbench = new FeatureWorkbenchHarness(page);
    await workbench.openWithBaseExtrudeFixture();
    if (projection === "Perspective") {
      await page
        .getByRole("button", { name: "Viewport projection: Orthographic" })
        .click();
      await page
        .getByRole("menuitem", { name: "Perspective", exact: true })
        .click();
    }
    await workbench.waitForRenderIdle();
    await settledCamera(workbench);
    await workbench.activateTool("Start a new sketch.");
    const faceId = await firstVisibleFace(page);
    const faceAt = (await project(page, faceId))!;
    await expect
      .poll(
        async () => {
          await workbench.hoverViewportAtReal(faceAt);
          return workbench.currentHoverTarget();
        },
        { timeout: 10_000 },
      )
      .toContain(faceId);
    await workbench.clickViewportAtReal(faceAt);
    await workbench.expectMachine("editingSketch");
    // Sketch entry looks along the face normal.
    const facing = await settledCamera(workbench);

    // Orbit (right drag) away from the face-normal sketch entry view.
    const box = (await workbench.viewport().boundingBox())!;
    await page.mouse.move(box.x + 900, box.y + 450);
    await page.mouse.down({ button: "right" });
    for (let step = 1; step <= 5; step += 1) {
      await page.mouse.move(box.x + 900 + step * 20, box.y + 450 + step * 8);
    }
    await page.mouse.up({ button: "right" });
    const oblique = await settledCamera(workbench);
    expect(
      viewAngleDegrees(facing, oblique),
      "premise: the view is oblique to the sketch plane",
    ).toBeGreaterThan(25);

    // The centroid of the convex, front-facing sketch face lies on it.
    const pointAt = (await project(page, faceId))!;
    const away = { x: 420, y: 700 };
    await workbench.activateTool("Create a sketch point.");
    await workbench.clickViewportAtReal(pointAt);
    await expect
      .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
      .toContain("1 entities staged");
    await page.keyboard.press("Escape");
    await workbench.hoverViewportAtReal(away);
    const pointId = await page.evaluate(
      () => window.__cadaraDebug?.getSketchSnapshot()?.points[0]?.id ?? null,
    );
    // Placement may snap a few pixels: sample around the drawn point itself.
    const drawnAt = (await project(page, `sketch_draft.${pointId}`))!;
    expect(
      Math.hypot(drawnAt.x - pointAt.x, drawnAt.y - pointAt.y),
      "premise: the point is placed where it was clicked, on the face",
    ).toBeLessThan(12);

    await expectDotFilled(workbench, drawnAt, "the face");
  });
}

test("a sketch point on the Top Plane stays drawn when the view is from beneath the plane", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  await workbench.activateTool("Create a sketch point.");
  await workbench.clickViewportAtReal({ x: 400, y: 300 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("1 entities staged");
  await page.keyboard.press("Escape");
  const pointId = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot()?.points[0]?.id ?? null,
  );

  // Orbit (right drag) under the plane, whose normal is +Z. Sketch entry
  // orbits about the plane's in-plane up axis, so a sideways drag swings
  // the camera round to the far side.
  const box = (await workbench.viewport().boundingBox())!;
  await page.mouse.move(box.x + 700, box.y + 450);
  await page.mouse.down({ button: "right" });
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(box.x + 700 + step * 30, box.y + 450 + step * 2);
  }
  await page.mouse.up({ button: "right" });
  const beneath = await settledCamera(workbench);
  expect(
    beneath.position[2]! - beneath.target[2]!,
    "premise: the camera looks at the plane from beneath",
  ).toBeLessThan(0);

  await workbench.hoverViewportAtReal({ x: 60, y: 700 });
  const drawnAt = (await project(page, `sketch_draft.${pointId}`))!;
  await expectDotFilled(workbench, drawnAt, "the background");
});

/**
 * No sample inside the point's dot shows the backdrop seen in the gap
 * between the dot and its ring: the dot is drawn and not partly clipped.
 */
async function expectDotFilled(
  workbench: FeatureWorkbenchHarness,
  drawnAt: ViewportPoint,
  backdrop: string,
) {
  await expect
    .poll(
      async () => {
        await workbench.waitForAnimationFrames(4);
        const crop = await cropAround(workbench, drawnAt);
        const gapColor = medianColor(
          ringSamples(drawnAt, GAP_SAMPLE_RADIUS).map((sample) =>
            pixelAt(crop, sample),
          ),
        );
        const dot = ringSamples(drawnAt, ...DOT_SAMPLE_RADII).map((sample) =>
          colorDistance(pixelAt(crop, sample), gapColor),
        );
        return {
          dotSamples: dot.length,
          backdropShowingThroughDot: dot.filter((distance) => distance < 40)
            .length,
        };
      },
      {
        message: `The point's dot is drawn over ${backdrop} and filled all around its centre (no sample shows ${backdrop} through it).`,
        timeout: 10_000,
      },
    )
    .toEqual({ dotSamples: 24, backdropShowingThroughDot: 0 });
}

async function project(page: Page, targetId: string) {
  return page.evaluate(
    (id) => window.__cadProjectToScreen?.(id) ?? null,
    targetId,
  );
}

/** A body face whose centroid projects inside the viewport. */
async function firstVisibleFace(page: Page) {
  const faceId = await page.evaluate(() => {
    const targets = window.__cadaraDebug?.getState()?.selectableTargets ?? [];
    return targets.find((target) => {
      if (!/^body_feature_extrude-1\.face_/.test(target)) return false;
      const at = window.__cadProjectToScreen?.(target);
      return Boolean(
        at && at.x > 200 && at.x < 900 && at.y > 150 && at.y < 650,
      );
    });
  });
  if (!faceId) throw new Error("No body face projects inside the viewport.");
  return faceId;
}

async function settledCamera(workbench: FeatureWorkbenchHarness) {
  let previous = "";
  let current = "";
  await expect
    .poll(
      async () => {
        await workbench.page.waitForTimeout(150);
        previous = current;
        current = JSON.stringify(await workbench.settledCamera());
        return current === previous;
      },
      { message: "the camera settled", timeout: 30_000 },
    )
    .toBe(true);
  return JSON.parse(current) as Awaited<
    ReturnType<FeatureWorkbenchHarness["settledCamera"]>
  >;
}

function viewAngleDegrees(
  left: { position: number[]; target: number[] },
  right: { position: number[]; target: number[] },
) {
  const direction = (frame: { position: number[]; target: number[] }) =>
    new THREE.Vector3()
      .fromArray(frame.target)
      .sub(new THREE.Vector3().fromArray(frame.position))
      .normalize();
  return THREE.MathUtils.radToDeg(direction(left).angleTo(direction(right)));
}

type ViewportCrop = { origin: ViewportPoint; pixels: Rgb[][] };

/** A 64 × 64 frame crop centred on a viewport-surface point. */
async function cropAround(
  workbench: FeatureWorkbenchHarness,
  center: ViewportPoint,
): Promise<ViewportCrop> {
  // `__cadProjectToScreen` points are relative to the viewport surface.
  const box = await workbench.viewportSurface().boundingBox();
  if (!box) throw new Error("Viewport surface is not visible.");
  const x = Math.round(box.x + center.x) - 32;
  const y = Math.round(box.y + center.y) - 32;
  const pixels = await readPixels(
    workbench.page,
    await workbench.page.screenshot({
      scale: "css",
      clip: { x, y, width: 64, height: 64 },
    }),
  );
  return { origin: { x: x - box.x, y: y - box.y }, pixels };
}

/** Points on circles of the given radii around a viewport-surface point. */
function ringSamples(center: ViewportPoint, ...radii: readonly number[]) {
  return radii.flatMap((radius) =>
    Array.from({ length: SAMPLE_DIRECTIONS }, (_, index) => {
      const angle = (index / SAMPLE_DIRECTIONS) * Math.PI * 2;
      return {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
    }),
  );
}

function pixelAt(crop: ViewportCrop, point: ViewportPoint) {
  // Pixel (i, j) covers [i, i + 1) from the crop origin.
  return crop.pixels[Math.floor(point.y - crop.origin.y)]![
    Math.floor(point.x - crop.origin.x)
  ]!;
}

/** Per-channel median: the face colour despite a dashed axis crossing it. */
function medianColor(pixels: readonly Rgb[]): Rgb {
  const channel = (index: number) => {
    const values = pixels.map((pixel) => pixel[index]!).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)]!;
  };
  return [channel(0), channel(1), channel(2)];
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
