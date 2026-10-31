import { expect, test, type Page } from "@playwright/test";
import * as THREE from "three";

import { toggleVisibility } from "./helpers/acceptance";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { clickViewCubeAt } from "./helpers/view-cube";

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

for (const projection of ["Orthographic", "Perspective"] as const) {
  test(`${projection}: a published sketch point on a part face is drawn as a full disc over that face when the part-mode view is oblique to the sketch plane`, async ({
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

    // The face-normal view's face centroid lies on the face.
    await workbench.activateTool("Create a sketch point.");
    await workbench.clickViewportAtReal((await project(page, faceId))!);
    await expect
      .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
      .toContain("1 entities staged");
    await page.keyboard.press("Escape");
    const pointId = await page.evaluate(
      () => window.__cadaraDebug?.getSketchSnapshot()?.points[0]?.id ?? null,
    );
    await workbench.activateTool("Exit the active sketch.");
    await workbench.expectMachine("idle", 60_000);
    await workbench.waitForRenderIdle();
    const pointTarget = await page.evaluate(
      (id) =>
        (window.__cadaraDebug?.getState()?.selectableTargets ?? []).find(
          (target) => target.endsWith(`.${id}`),
        ) ?? null,
      pointId,
    );
    expect(pointTarget, "premise: the point is published").not.toBeNull();

    // Exit restores the part-mode view. Look from the view-cube corner on
    // the face's side, oblique to the face (about 55° from its normal),
    // then zoom in on the point so its world-sized dot spans enough pixels
    // to measure.
    const normal = new THREE.Vector3()
      .fromArray(facing.position)
      .sub(new THREE.Vector3().fromArray(facing.target))
      .normalize();
    const restored = await settledCamera(workbench);
    const restoredOffset = new THREE.Vector3()
      .fromArray(restored.position)
      .sub(new THREE.Vector3().fromArray(restored.target));
    const corner = normal
      .toArray()
      .map(
        (component, axis) =>
          Math.sign(
            Math.abs(component) > 0.5
              ? component
              : restoredOffset.getComponent(axis),
          ) * 0.48,
      ) as [number, number, number];
    await clickViewCubeAt(page, restored, corner);
    await settledCamera(workbench);
    const surface = (await workbench.viewportSurface().boundingBox())!;
    for (let notch = 0; notch < 8; notch += 1) {
      const at = (await project(page, pointTarget!))!;
      await page.mouse.move(surface.x + at.x, surface.y + at.y);
      await page.mouse.wheel(0, -120);
      await settledCamera(workbench);
    }
    const oblique = await settledCamera(workbench);
    expect(
      viewAngleDegrees(facing, oblique),
      "premise: the view is oblique to the sketch plane, well short of edge-on",
    ).toBeGreaterThan(40);
    expect(viewAngleDegrees(facing, oblique)).toBeLessThan(70);

    const drawnAt = (await project(page, pointTarget!))!;
    await workbench.hoverViewportAtReal({ x: 60, y: 700 });
    await expectRoundDot(workbench, drawnAt);

    // Picking still finds the point where its disc is drawn. The datum
    // planes are hidden: one can stand between the camera and the face.
    for (const plane of ["Top Plane", "Right Plane", "Front Plane"])
      await toggleVisibility(page, "Hide", plane);
    await expect
      .poll(
        async () => {
          await workbench.hoverViewportAtReal(drawnAt);
          return workbench.currentHoverTarget();
        },
        { message: "the drawn point is picked", timeout: 10_000 },
      )
      .toContain(pointTarget!);

    // From the corner across the face plane the body stands between the
    // camera and the point, which stays hidden.
    await workbench.hoverViewportAtReal({ x: 60, y: 700 });
    const behind = corner.map((component, axis) =>
      Math.abs(normal.getComponent(axis)) > 0.5 ? -component : component,
    ) as [number, number, number];
    await clickViewCubeAt(page, oblique, behind);
    await settledCamera(workbench);
    const hiddenAt = (await project(page, pointTarget!))!;
    expect(
      hiddenAt.x > 40 &&
        hiddenAt.x < surface.width - 40 &&
        hiddenAt.y > 40 &&
        hiddenAt.y < surface.height - 40,
      "premise: the point projects inside the viewport from behind the body",
    ).toBe(true);
    await expect
      .poll(
        async () => {
          await workbench.waitForAnimationFrames(4);
          const crop = await cropAround(workbench, hiddenAt);
          const bodyColor = medianColor(
            ringSamples(hiddenAt, 12).map((sample) => pixelAt(crop, sample)),
          );
          return colorDistance(pixelAt(crop, hiddenAt), bodyColor) < 20;
        },
        {
          message:
            "the point is hidden behind the body (its centre shows the body around it, not the dot)",
          timeout: 10_000,
        },
      )
      .toBe(true);
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

/**
 * The dot around `drawnAt` is a full disc: walking out from its centre, it
 * ends at the same radius in every direction. A sphere depth-clipped by the
 * coplanar face keeps only its near half, which ends early on one side.
 */
async function expectRoundDot(
  workbench: FeatureWorkbenchHarness,
  drawnAt: ViewportPoint,
) {
  await expect
    .poll(
      async () => {
        await workbench.waitForAnimationFrames(4);
        const crop = await cropAround(workbench, drawnAt);
        const dotColor = pixelAt(crop, drawnAt);
        const extents = Array.from({ length: 24 }, (_, index) => {
          const angle = (index / 24) * Math.PI * 2;
          let radius = 0;
          while (radius < 30) {
            const next = radius + 0.5;
            const sample = {
              x: drawnAt.x + Math.cos(angle) * next,
              y: drawnAt.y + Math.sin(angle) * next,
            };
            if (colorDistance(pixelAt(crop, sample), dotColor) > 40) break;
            radius = next;
          }
          return radius;
        });
        const shortest = Math.min(...extents);
        const longest = Math.max(...extents);
        return {
          dotLargeEnoughToMeasure: longest >= 6,
          round: shortest / longest >= 0.8,
          extents,
        };
      },
      {
        message:
          "The published point's dot is drawn whole over the face (equal extent in every direction).",
        timeout: 10_000,
      },
    )
    .toMatchObject({ dotLargeEnoughToMeasure: true, round: true });
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
