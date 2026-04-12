import { expect, test } from '@playwright/test'

import { FeatureWorkbenchHarness } from './helpers/feature-workbench'

test.setTimeout(90_000)

function countBufferDiff(left: Buffer, right: Buffer) {
  const limit = Math.min(left.length, right.length)
  let diff = 0

  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) {
      diff += 1
    }
  }

  return diff + Math.abs(left.length - right.length)
}

test('viewport hover and selection transition from none to durable solid targets', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.open()
  await workbench.createBaseExtrudeFixture()

  await workbench.clearHoverByLeavingViewport()
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe('none')
  const baseViewport = await workbench.viewportSurface().screenshot()

  const hoveredFace = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.face_.+$/)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(hoveredFace.targetId)
  const hoveredFaceViewport = await workbench.viewportSurface().screenshot()
  expect(countBufferDiff(baseViewport, hoveredFaceViewport)).toBeGreaterThan(5_000)
  await workbench.clickViewportAtReal(hoveredFace.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredFace.targetId)
  const selectedFaceViewport = await workbench.viewportSurface().screenshot()
  expect(countBufferDiff(hoveredFaceViewport, selectedFaceViewport)).toBeGreaterThan(5_000)

  await workbench.clearHoverByLeavingViewport()
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe('none')
  const clearedViewport = await workbench.viewportSurface().screenshot()
  expect(countBufferDiff(selectedFaceViewport, clearedViewport)).toBeGreaterThan(5_000)

  const hoveredEdge = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.edge_.+$/)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(hoveredEdge.targetId)
  const hoveredEdgeViewport = await workbench.viewportSurface().screenshot()
  expect(countBufferDiff(clearedViewport, hoveredEdgeViewport)).toBeGreaterThan(5_000)
  await workbench.clickViewportAtReal(hoveredEdge.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredEdge.targetId)
  const selectedEdgeViewport = await workbench.viewportSurface().screenshot()
  expect(countBufferDiff(hoveredEdgeViewport, selectedEdgeViewport)).toBeGreaterThan(5_000)
})
