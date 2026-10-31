import type { Page } from "@playwright/test";
import * as THREE from "three";

/**
 * Clicks the view cube where `point` (cube units, half size 0.58) shows,
 * given the viewport's settled camera `frame`: the cube's camera looks at
 * its centre along the viewport camera's orbit offset
 * (`three-cad-viewport.tsx`, `renderCube`). Mirrors the cube camera of
 * `createViewCubeScene` (`three-cad-viewport-view-cube.ts`:
 * PerspectiveCamera(35, …) at distance 4): keep in step with it.
 */
export async function clickViewCubeAt(
  page: Page,
  frame: { position: readonly number[]; target: readonly number[] },
  point: readonly [number, number, number],
) {
  const box = (await page
    .locator('[data-testid="view-cube"] canvas')
    .boundingBox())!;
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
