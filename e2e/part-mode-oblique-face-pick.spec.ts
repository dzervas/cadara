import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import * as THREE from "three";

import { openDocumentCopy } from "./helpers/document-files";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(300_000);

// cadara-1lzw. Lane: e2e (docs/testing.md). Seam: part-mode picking on the
// wheel example after a view-cube corner click: the real camera transition,
// the raycast, the projected feature-vertex candidates and the resolver.
// From a corner the disk's hidden bottom-rim vertices project onto its top
// face and its own vertices' 48 px reach covered most of it, so a click on
// the top face picked a vertex. Only the browser composes the cube, the
// camera and the pick candidates.

const WHEEL_TOP_FACE =
  "body_feature_extrude-1.face_body_feature_extrude-1_g8ad88683da3b0018";
const WHEEL_EDGE = /^body_feature_extrude-1\.edge_body_feature_extrude-1_/;
/**
 * Three vertices of the top face (z = 8): the outer rim's seam vertex and
 * the outer corners of the slot at 90° and -90°. Under the orthographic
 * camera a point of the face is the same affine combination of their
 * screen points as of their world points.
 */
const TOP_FACE_FRAME = {
  rimSeam: {
    id: "body_feature_extrude-1.vertex_body_feature_extrude-1_g1aa663c0703247b1",
    at: [39.2, 0],
  },
  slotPositive: {
    id: "body_feature_extrude-1.vertex_body_feature_extrude-1_ge2f2fa6e0f15b568",
    at: [6, 29],
  },
  slotNegative: {
    id: "body_feature_extrude-1.vertex_body_feature_extrude-1_g4f1eb2f94d872fa5",
    at: [6, -29],
  },
} as const;
const TOP_RIM_RADIUS = 39.2;
/** Between the slots' outer ends (r = 29.61) and the rim, mid-spoke. */
const INTERIOR_RADIUS = 34.4;

/** The four top corners, each with the spoke angle facing the camera. */
const TOP_CORNERS = [
  { name: "frontRightTop", direction: [1, -1, 1], spokeDegrees: -60 },
  { name: "backRightTop", direction: [1, 1, 1], spokeDegrees: 60 },
  { name: "backLeftTop", direction: [-1, 1, 1], spokeDegrees: 120 },
  { name: "frontLeftTop", direction: [-1, -1, 1], spokeDegrees: -120 },
] as const;

/** The harness's settled camera, once two successive reads agree. */
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

/**
 * Clicks the view cube where `point` (cube units, half size 0.58) shows:
 * the cube's camera looks at its centre along the viewport camera's
 * orbit offset (`three-cad-viewport.tsx`, `renderCube`). Mirrors the cube
 * camera of `createViewCubeScene` (`three-cad-viewport-view-cube.ts`:
 * PerspectiveCamera(35, …) at distance 4): keep in step with it.
 */
async function clickViewCubeAt(
  workbench: FeatureWorkbenchHarness,
  point: readonly [number, number, number],
) {
  const page = workbench.page;
  const box = (await page
    .locator('[data-testid="view-cube"] canvas')
    .boundingBox())!;
  const frame = await settledCamera(workbench);
  const camera = new THREE.PerspectiveCamera(
    35,
    box.width / box.height,
    0.1,
    100,
  );
  camera.position
    .fromArray(frame.position)
    .sub(new THREE.Vector3().fromArray(frame.target))
    .setLength(4);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const ndc = new THREE.Vector3(...point).project(camera);
  await page.mouse.click(
    box.x + ((ndc.x + 1) / 2) * box.width,
    box.y + ((1 - ndc.y) / 2) * box.height,
  );
}

/** Screen points of the top face (z = 8) at polar (radius, degrees). */
async function topFaceProjector(workbench: FeatureWorkbenchHarness) {
  const ids = Object.values(TOP_FACE_FRAME).map((vertex) => vertex.id);
  const screen = await workbench.page.evaluate(
    (targets) => targets.map((id) => window.__cadProjectToScreen?.(id) ?? null),
    ids,
  );
  if (screen.some((point) => point === null)) {
    throw new Error(`Unprojected top-face vertices: ${JSON.stringify(screen)}`);
  }
  const [r, a, b] = screen as { x: number; y: number }[];
  const [rw, aw, bw] = Object.values(TOP_FACE_FRAME).map((vertex) => vertex.at);
  // Solve world = r + s (a - r) + t (b - r) for (s, t) in the face plane.
  const ax = aw[0] - rw[0];
  const ay = aw[1] - rw[1];
  const bx = bw[0] - rw[0];
  const by = bw[1] - rw[1];
  const determinant = ax * by - ay * bx;
  return (radius: number, degrees: number) => {
    const angle = THREE.MathUtils.degToRad(degrees);
    const px = radius * Math.cos(angle) - rw[0];
    const py = radius * Math.sin(angle) - rw[1];
    const s = (px * by - py * bx) / determinant;
    const t = (ax * py - ay * px) / determinant;
    return {
      x: r!.x + s * (a!.x - r!.x) + t * (b!.x - r!.x),
      y: r!.y + s * (a!.y - r!.y) + t * (b!.y - r!.y),
    };
  };
}

test("cadara-1lzw: from every top view-cube corner the wheel's top face is picked between its corners and its rim edge within a few px of the rim", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithRepository();
  const wheel: unknown = JSON.parse(
    await readFile("landing/examples/wheel/model.cadara", "utf8"),
  );
  await openDocumentCopy(page, wheel, "wheel.cadara");
  await expect(
    page.getByRole("status", { name: "Initial model render pending" }),
  ).toHaveCount(0, { timeout: 180_000 });
  await workbench.waitForRenderIdle(60_000);

  for (const corner of TOP_CORNERS) {
    // Every top corner is on screen from the top view.
    await clickViewCubeAt(workbench, [0, 0, 0.58]);
    await settledCamera(workbench);
    await clickViewCubeAt(
      workbench,
      corner.direction.map((value) => value * 0.48) as [number, number, number],
    );
    const frame = await settledCamera(workbench);
    const offset = new THREE.Vector3()
      .fromArray(frame.position)
      .sub(new THREE.Vector3().fromArray(frame.target))
      .normalize();
    expect(
      offset.angleTo(new THREE.Vector3(...corner.direction).normalize()),
      `premise: the ${corner.name} corner click looks along its diagonal`,
    ).toBeLessThan(1e-3);
    await workbench.waitForRenderIdle(30_000);

    const project = await topFaceProjector(workbench);
    const interior = project(INTERIOR_RADIUS, corner.spokeDegrees);
    // cadara-h026.1: clicks add to the selection; Escape clears it first.
    await page.keyboard.press("Escape");
    await workbench.hoverViewportAtReal(interior);
    await workbench.clickViewportAtReal(interior);
    await expect
      .poll(() => workbench.currentEditorSelection(), {
        message: `${corner.name}: the top face between the slots is selected`,
        timeout: 10_000,
      })
      .toBe(WHEEL_TOP_FACE);

    // 3 px inside the rim, towards the interior point.
    const rim = project(TOP_RIM_RADIUS, corner.spokeDegrees);
    const inward = Math.hypot(interior.x - rim.x, interior.y - rim.y);
    const nearRim = {
      x: rim.x + ((interior.x - rim.x) * 3) / inward,
      y: rim.y + ((interior.y - rim.y) * 3) / inward,
    };
    await page.keyboard.press("Escape");
    await workbench.hoverViewportAtReal(nearRim);
    await workbench.clickViewportAtReal(nearRim);
    await expect
      .poll(() => workbench.currentEditorSelection(), {
        message: `${corner.name}: 3 px inside the rim selects the rim edge`,
        timeout: 10_000,
      })
      .toMatch(WHEEL_EDGE);
  }
});
